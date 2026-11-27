import { boundsOf } from './draw';
import { rectContains } from './geometry';
import clip, { type MultiPolygon, type Pair, type Polygon } from 'polygon-clipping';
import type { GridSettings, Rect, Vec } from '../types';
import { snapToCellCenter } from './geometry';
import { cellPoly } from './cells';
import { areaAt, newAreaId, groundAtTerrain, surfaceHeight, type Area, type Terrain, type TStroke } from './terrain';
import type { SightRegion, SightSegments } from './terrainSight';
import { type Seg } from './walls';

export interface TerrainEdge extends Seg { low: number; top: number; one: 1 | -1 }
export const inRegion = (polygon: Polygon, p: Vec): boolean => {
  let inside = false;
  for (const ring of polygon) for (let i = 0, j = ring.length-1; i < ring.length; j = i++) {
    const [x,y] = ring[i], [xx,yy] = ring[j];
    if ((y > p.y) !== (yy > p.y) && p.x < (xx-x)*(p.y-y)/(yy-y)+x) inside = !inside;
  }
  return inside;
};

const pair = (p: Vec): Pair => [p.x, p.y];

function brushFootprint(grid: GridSettings, pts: Vec[], radius: number, cells: boolean): MultiPolygon {
  const bounds = {x:0,y:0,w:0,h:0};
  return footprint({kind:cells ? 'cells' : 'free',pts,r:radius,b:bounds},grid);
}

/** Null keeps the compact stroke format; an empty intersection adds no terrain. */
export function clippedBrush(grid: GridSettings, pts: Vec[], width: number, cells: boolean, maps: Rect[]): MultiPolygon | null {
  if (!maps.length || !pts.length) return null;
  const r = cells ? grid.cell * 0.6 : width / 2;
  if (maps.some(m => pts.every(p => p.x-r >= m.x && p.y-r >= m.y && p.x+r <= m.x+m.w && p.y+r <= m.y+m.h))) return null;
  const rectangles: Polygon[] = maps.map(({x,y,w,h}) => [[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]]);
  return clip.intersection(brushFootprint(grid,pts,width/2,cells),clip.union(rectangles));
}

function footprint(s: Pick<TStroke,'kind'|'pts'|'r'|'b'|'rings'>, grid: GridSettings): MultiPolygon {
  const { x, y, w, h } = s.b;
  if (s.kind === 'polygon') return [s.rings!.map(r => r.map(pair))];
  if (s.kind === 'rect') return [[[[x,y], [x+w,y], [x+w,y+h], [x,y+h]]]];
  const shapes: Polygon[] = [];
  if (s.kind === 'cells') {
    for (const p of s.pts) shapes.push([cellPoly(grid, snapToCellCenter(grid,p)).map(({x,y}): Pair => [Math.round(x*1e7)/1e7, Math.round(y*1e7)/1e7])]);
  } else {
    const ellipse = s.kind === 'ellipse';
    const rx = ellipse ? w / 2 : s.r, ry = ellipse ? h / 2 : s.r;
    const tolerance = grid.cell / 600;
    const angle = Math.acos(1 - Math.min(1, tolerance / Math.max(rx, ry, 0.01)));
    const count = Math.min(512, Math.max(4, 4 * Math.ceil(Math.PI / (4 * angle))));
    const rim = Array.from({length: count}, (_, i) => {
      const a = 2 * Math.PI * i / count;
      return {x: rx * Math.cos(a), y: ry * Math.sin(a)};
    });
    const centers = ellipse ? [{x:x+w/2,y:y+h/2}] : s.pts;
    if (!centers.length) return [];
    const vertex = (p: Vec, i: number): Pair => [p.x + rim[i].x, p.y + rim[i].y];
    for (let i = 1; i < centers.length; i++) {
      const a = centers[i-1], b = centers[i];
      const dx = b.x-a.x, dy = b.y-a.y;
      if (!dx && !dy) continue;
      // Sweep the polygonal brush tip as one closed capsule. Joining a separate
      // tangent rectangle to two disks can leave microscopic gaps on diagonals.
      const normal = rim.map(p => dx*p.y - dy*p.x);
      const top = normal.indexOf(Math.max(...normal)), bottom = (top + count/2) % count;
      const ring: Pair[] = [];
      for (let k=0; k<=count/2; k++) ring.push(vertex(a,(top+k)%count));
      for (let k=0; k<=count/2; k++) ring.push(vertex(b,(bottom+k)%count));
      shapes.push([ring]);
    }
    if (!shapes.length) return [[rim.map((_,i) => vertex(centers[0],i))]];
  }
  return shapes.length ? clip.union(shapes) : [];
}

/** Fold the paint in drawing order, retaining the boundaries of each finished elevation. */
interface Plan { surfaces: Map<number, { area: Area; offset: number }>; regions: Map<number, MultiPolygon>; layers: { area: Area; shape: MultiPolygon }[] }
const layerCache = new WeakMap<Terrain, Plan['layers']>();
const footprints = new WeakMap<TStroke, MultiPolygon>();
const areaMasks = new WeakMap<TStroke,{strokes:TStroke[]; mask:MultiPolygon}>();
export function terrainLayers(t: Terrain) {
  const cached = layerCache.get(t);
  if (cached) return cached;
  const layers: Plan['layers'] = [];
  for (const area of t.areas) {
    let mask: MultiPolygon = [];
    const prior=areaMasks.get(area.paint[0]);
    let start=0;
    if (prior && prior.strokes.length<=area.strokes.length && prior.strokes.every((s,i)=>s===area.strokes[i])) {
      mask=prior.mask;
      start=prior.strokes.length;
    }
    for (let i=start;i<area.strokes.length;i++) {
      const s=area.strokes[i];
      let shape = footprints.get(s);
      if (!shape) { shape = footprint(s, t.grid); footprints.set(s, shape); }
      mask = s.erase ? clip.difference(mask, shape) : clip.union(mask, shape);
    }
    areaMasks.set(area.paint[0],{strokes:area.strokes,mask});
    if (!mask.length) continue;
    layers.push({area, shape: mask});
  }
  layerCache.set(t,layers);
  return layers;
}
const plans = new WeakMap<Terrain, Plan>();
// Reuse the finished flat layers below the first edit. Only retain the latest stack.
let flatPrefix: {mask:MultiPolygon; h:number; add:boolean; regions:Plan['regions']}[]=[];
function heightRegions(t: Terrain): Plan {
  const cached = plans.get(t);
  if (cached) return cached;
  const layers = terrainLayers(t);
  const surfaces: Plan['surfaces'] = new Map();
  const keys = new Map<string, number>();
  // Negative sentinel keys keep different continuous surfaces distinct in the polygon overlay.
  const surfaceKey = (area: Area, offset: number) => {
    const name = JSON.stringify([area.id,offset]);
    let key = keys.get(name);
    if (key === undefined) {
      key = -1e12 - keys.size;
      keys.set(name,key);
      surfaces.set(key,{area,offset});
    }
    return key;
  };
  let regions = new Map<number, MultiPolygon>();
  const saved=flatPrefix;
  const nextPrefix:typeof flatPrefix=[];
  let same=true, flat=true;
  for (const {area,shape:mask} of layers) {
    const gradient=!!area.gradientEnabled;
    flat=flat && !gradient;
    const prior=saved[nextPrefix.length];
    same=same && flat && !!prior && prior.mask===mask && prior.h===area.h && prior.add===area.add;
    if (same) { regions=prior.regions; nextPrefix.push(prior); continue; }
    const next = new Map<number, MultiPolygon>();
    const add = (z: number, shape: MultiPolygon) => {
      if (!shape.length) return;
      const current = next.get(z);
      next.set(z, current ? clip.union(current, shape) : shape);
    };
    const adds = area.add && (area.gradient?.length ?? 0)<2;
    let bare = mask;
    for (const [z, region] of regions) {
      add(z, clip.difference(region, mask));
      if (adds) {
        const below = surfaces.get(z);
        add(below ? surfaceKey(below.area,below.offset + area.h) : gradient ? surfaceKey(area,z) : z + area.h, clip.intersection(region, mask));
        bare = clip.difference(bare, region);
      }
    }
    add(gradient ? surfaceKey(area,0) : area.h, bare);
    regions = next;
    if (flat) nextPrefix.push({mask,h:area.h,add:area.add,regions});
  }
  flatPrefix=nextPrefix;
  const plan = { regions, layers, surfaces };
  plans.set(t,plan);
  return plan;
}

// Geometry for sight on continuous ground. The rings retain exact cliffs and
// holes. Cache heights for each smooth surface separately so interpolation never
// averages the two sides of a cliff. Only samples visited by a viewer are built.
const sightRegions = new WeakMap<Terrain, SightRegion[]>();
export function withSightTerrain(segs: Seg[], t: Terrain, openings: Seg[]): SightSegments {
  if (!t.areas.some(a => (a.gradient?.length ?? 0) >= 2)) return segs;
  let regions = sightRegions.get(t);
  const scale = t.grid.cell/t.grid.ft;
  if (!regions) {
    regions = [];
    const plan = heightRegions(t);
    for (const [key,shape] of plan.regions) {
      const surface = plan.surfaces.get(key);
      let height: SightRegion['height'] = key;
      if (surface) {
        const {area,offset} = surface;
        // At most 512 steps across a region, even on very large maps.
        const step = Math.max(2*scale,area.b.w/512,area.b.h/512);
        const stride = Math.ceil(area.b.w/step)+3;
        const samples = new Map<number,number>();
        const sample = (ix:number,iy:number) => {
          const k = iy*stride+ix;
          let h = samples.get(k);
          if (h === undefined) {
            h = surfaceHeight(area,{x:area.b.x+ix*step,y:area.b.y+iy*step})+offset;
            samples.set(k,h);
          }
          return h;
        };
        height = (x,y) => {
          const u=(x-area.b.x)/step, v=(y-area.b.y)/step;
          const ix=Math.floor(u), iy=Math.floor(v), fx=u-ix, fy=v-iy;
          return (1-fy)*((1-fx)*sample(ix,iy)+fx*sample(ix+1,iy))
            + fy*((1-fx)*sample(ix,iy+1)+fx*sample(ix+1,iy+1));
        };
      }
      for (const poly of shape) {
        const rings=poly.map(r=>r.map(([x,y])=>({x,y})));
        regions.push({height,rings,bounds:boundsOf(rings[0])});
      }
    }
    sightRegions.set(t,regions);
  }
  return Object.assign(segs,{surface:{regions,scale,openings}});
}

// Cache by paint geometry so dragging a height control does not repeat polygon clipping.
const exposedMasks = new WeakMap<MultiPolygon,{covers:MultiPolygon[]; shape:MultiPolygon}>();

export function areaShape(t: Terrain, id: string): MultiPolygon {
  const layers=terrainLayers(t);
  const layer=layers.find(l=>l.area.id===id);
  if (!layer) return [];
  if (!layer.area.gradientEnabled) return layer.shape;
  const b=layer.area.b;
  const covers=layers.filter(({area})=>area.order>layer.area.order &&
    area.b.x < b.x+b.w && b.x < area.b.x+area.b.w &&
    area.b.y < b.y+b.h && b.y < area.b.y+area.b.h).map(l=>l.shape);
  if (!covers.length) return layer.shape;
  const cached=exposedMasks.get(layer.shape);
  if (cached && covers.length===cached.covers.length && covers.every((c,i)=>c===cached.covers[i])) return cached.shape;
  const shape=clip.difference(layer.shape,...covers);
  exposedMasks.set(layer.shape,{covers,shape});
  return shape;
}

export interface HeightPatch {
  polygon: Polygon;
  height: number;
  /** Strokes to cut away if this patch is moved, deleted or reshaped. */
  cuts: { group: string; shape: MultiPolygon }[];
  ids: string[];
  whole: boolean;
  sig: string;
}

export function connectedHeight(t: Terrain, point: Vec): HeightPatch | null {
  const picked = areaAt(t,point);
  if (!picked) return null;
  const { regions, layers } = heightRegions(t);
  const height = groundAtTerrain(t,point);
  if (picked.gradientEnabled || !regions.has(height)) {
    const shape = areaShape(t,picked.id);
    const polygon = shape.find(p => inRegion(p,point));
    if (!polygon) return null;
    return {polygon,height,cuts:[{group:picked.id,shape:[polygon]}],ids:picked.ids,whole:shape.length===1,sig:t.sig};
  }
  const polygon = regions.get(height)?.find(p => inRegion(p,point));
  if (!polygon) return null;
  const cuts: HeightPatch['cuts'] = [];
  const ids = new Set<string>();
  let whole = true;
  let exposed: MultiPolygon = [polygon];
  // An opaque level can hide another stroke at the same height. Include both
  // where they coincide, while preserving the supporting ground below a terrace.
  let duplicates: MultiPolygon = [];
  for (const {area,shape} of [...layers].reverse()) {
    const same = !area.gradientEnabled && !area.add && area.h === height;
    const visible = clip.intersection(exposed,shape);
    const cut = same && duplicates.length ? clip.union(visible,clip.intersection(duplicates,shape)) : visible;
    if (cut.length) {
      if (!same || clip.difference(shape,cut).length) whole = false;
      cuts.push({group:area.id,shape:cut});
      for (const id of area.ids) ids.add(id);
    }
    exposed = clip.difference(exposed,shape);
    duplicates = same ? clip.union(duplicates,visible) : clip.difference(duplicates,shape);
    if (!exposed.length && !duplicates.length) break;
  }
  return {polygon,height,cuts,ids:[...ids],whole,sig:t.sig};
}

/** Only inner rings are candidates. A notch open to the exterior is never filled. */
function enclosedHoles(t:Terrain, ids:string[], patch?:HeightPatch) {
  const layers=terrainLayers(t);
  const picked=layers.filter(l=>ids.includes(l.area.id));
  if (!picked.length) return;
  const one=picked.length===1 ? picked[0] : undefined;
  if (!one && !patch) return;
  const shape:MultiPolygon=patch ? [patch.polygon] : areaShape(t,one!.area.id);
  const rings=shape.flatMap(p=>p.slice(1).map(r=>[r] as Polygon));
  if (!rings.length) return;
  const holes=clip.difference(clip.union(rings),shape);
  const others=layers.filter(l=>!picked.includes(l));
  if (!holes.length) return;
  const bare=others.length ? clip.difference(holes,...others.map(l=>l.shape)) : holes;
  return {one,others,holes,bare};
}

export function terrainHoleOptions(t:Terrain, ids:string[], patch?:HeightPatch) {
  const found=enclosedHoles(t,ids,patch);
  return {bare:!!found?.bare.length,all:!!found?.one?.area.gradientEnabled};
}

export function fillTerrainHoles(t:Terrain, ids:string[], patch:HeightPatch|undefined, all:boolean) {
  const found=enclosedHoles(t,ids,patch);
  if (!found || (all && !found.one?.area.gradientEnabled)) return [];
  const {one,others}=found;
  const holes=all ? found.holes : found.bare;
  if (!holes.length) return [];
  const edits:ReturnType<typeof patchStroke>[]=[];
  if (all && one) for (const other of others) {
    const overlap=clip.intersection(holes,other.shape);
    if (!overlap.length) continue;
    // Keep underlying supporting terrain. Enclosed islands and overlying paint are absorbed.
    if (other.area.order<one.area.order && clip.difference(other.shape,holes).length) continue;
    for (const poly of overlap) edits.push(patchStroke(poly,other.area.id,null));
  }
  const group=one?.area.id ?? newAreaId(), h=one?.area.h ?? patch!.height;
  for (const poly of holes) edits.push(patchStroke(poly,group,h));
  return edits;
}

/** Limit a brush erasure to the selected surface, even if another island shares its stroke. */
export function brushCuts(patches: HeightPatch[], grid: GridSettings, pts: Vec[], width: number, cells: boolean, clipped?: MultiPolygon | null) {
  const brush = clipped ?? brushFootprint(grid,pts,width/2,cells);
  return patches.map(p => ({...p,whole:false,cuts:p.cuts.map(c => ({...c,shape:clip.intersection(c.shape,brush)}))
    .filter(c => c.shape.length)})).filter(p => p.cuts.length);
}

export function patchStroke(polygon: Polygon, group: string, height: number | null, dx = 0, dy = 0) {
  return {
    k: 'terrain' as const, hg: group, hz: height, he: height === null,
    hr: polygon.map(ring => ring.length).join(','),
    p: polygon.flatMap(ring => ring.flatMap(([x,y]) => [x+dx,y+dy])).join(','),
    color: '#aa8855', w: 1, fill: 0, dash: false, txt: '', fs: 28, bw: 5,
  };
}

/** Sweep both sides of each contour line together. This splits a long edge wherever
 * a neighbouring terrace ends, even when the polygon on the opposite side has no vertex there. */
export function terrainEdges(t: Terrain, levelJoins?: Seg[], maps:Rect[]=[]): TerrainEdge[] {
  type Event = { s: number; left: number; right: number };
  const lines = new Map<string, { ux: number; uy: number; offset: number; events: Event[] }>();
  const {regions,surfaces} = heightRegions(t);
  for (const [height, region] of regions) for (const polygon of region) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const [x,y] = ring[i-1], [x2,y2] = ring[i];
      const len = Math.hypot(x2-x,y2-y);
      if (len < 1e-6) continue;
      const sign = x2 > x || (x2 === x && y2 > y) ? 1 : -1;
      const ux = (x2-x) / len * sign, uy = (y2-y) / len * sign, offset = ux*y-uy*x;
      const key = [Math.round(ux*1e8), Math.round(uy*1e8), Math.round(offset*1e5)].join(',');
      let line = lines.get(key);
      if (!line) { line = {ux, uy, offset, events: []}; lines.set(key,line); }
      const s = ux*x+uy*y, e = ux*x2+uy*y2;
      const left = sign > 0 ? height : 0, right = sign < 0 ? height : 0;
      line.events.push({s: Math.min(s,e), left, right}, {s: Math.max(s,e), left: -left, right: -right});
    }
  }
  const out: TerrainEdge[] = [];
  for (const {ux,uy,offset,events} of lines.values()) {
    const rim=maps.some(r=> (uy===0 && (Math.abs(offset-r.y)<1e-6 || Math.abs(offset-r.y-r.h)<1e-6)) ||
      (ux===0 && (Math.abs(-offset-r.x)<1e-6 || Math.abs(-offset-r.x-r.w)<1e-6)));
    if (rim) for(const r of maps) {
      const from=ux===0 ? r.y : r.x, extent=ux===0 ? r.h : r.w;
      events.push({s:from,left:0,right:0},{s:from+extent,left:0,right:0});
    }
    events.sort((a,b) => a.s-b.s);
    let left = 0, right = 0;
    const at = (s: number, n = 0) => ({x: ux*s-uy*(offset+n), y: uy*s+ux*(offset+n)});
    for (let i = 0; i+1 < events.length; i++) {
      left += events[i].left; right += events[i].right;
      const start = events[i].s, len = events[i+1].s-start;
      if (left === right || len < 1e-6) continue;
      if(rim) {
        const mid=start+len/2;
        if(!maps.some(r=>rectContains(r,at(mid,1e-5))) || !maps.some(r=>rectContains(r,at(mid,-1e-5)))) continue;
      }
      const ls = surfaces.get(left), rs = surfaces.get(right);
      const pieces = ls || rs ? Math.max(1,Math.ceil(len / (t.grid.cell / 2))) : 1;
      for (let j=0; j<pieces; j++) {
        const middle = at(start+len*(j+0.5)/pieces);
        const lh = ls ? surfaceHeight(ls.area,middle)+ls.offset : left;
        const rh = rs ? surfaceHeight(rs.area,middle)+rs.offset : right;
        if (Math.abs(lh-rh) < 0.001) {
          levelJoins?.push({a:at(start+len*j/pieces),b:at(start+len*(j+1)/pieces)});
          continue;
        }
        out.push({a:at(start+len*j/pieces), b:at(start+len*(j+1)/pieces),
          low:Math.min(lh,rh), top:Math.max(lh,rh), one:lh<rh ? 1 : -1, terrainPxPerFt:t.grid.cell/t.grid.ft});
      }
    }
  }
  return out;
}
