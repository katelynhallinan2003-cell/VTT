import clip, { type MultiPolygon, type Pair, type Polygon } from 'polygon-clipping';
import type { GridSettings, Vec } from '../types';
import { snapToCellCenter } from './geometry';
import { cellPoly } from './cells';
import { areaAt, groundAtTerrain, type Area, type Terrain, type TStroke } from './terrain';
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

function footprint(s: Pick<TStroke,'kind'|'pts'|'r'|'b'|'rings'>, grid: GridSettings): MultiPolygon {
  const { x, y, w, h } = s.b;
  if (s.kind === 'polygon') return [s.rings!.map(r => r.map(pair))];
  if (s.kind === 'rect') return [[[[x,y], [x+w,y], [x+w,y+h], [x,y+h]]]];
  const shapes: Polygon[] = [];
  const oval = (p: Vec, rx: number, ry: number) => {
    const tolerance = grid.cell / 600;
    const angle = Math.acos(1 - Math.min(1, tolerance / Math.max(rx, ry, 0.01)));
    const count = Math.min(512, Math.max(4, 4 * Math.ceil(Math.PI / (4 * angle))));
    shapes.push([Array.from({length: count}, (_, i): Pair => {
      const a = 2 * Math.PI * i / count;
      return [p.x + rx * Math.cos(a), p.y + ry * Math.sin(a)];
    })]);
  };
  if (s.kind === 'cells') {
    for (const p of s.pts) shapes.push([cellPoly(grid, snapToCellCenter(grid,p)).map(({x,y}): Pair => [Math.round(x*1e7)/1e7, Math.round(y*1e7)/1e7])]);
  } else if (s.kind === 'ellipse') {
    oval({ x: x + w / 2, y: y + h / 2 }, w / 2, h / 2);
  } else {
    s.pts.forEach((p, i) => {
      oval(p, s.r, s.r);
      if (!i) return;
      const q = s.pts[i - 1], len = Math.hypot(p.x - q.x, p.y - q.y);
      if (!len) return;
      const nx = (p.y - q.y) * s.r / len, ny = (q.x - p.x) * s.r / len;
      shapes.push([[[q.x+nx,q.y+ny],[p.x+nx,p.y+ny],[p.x-nx,p.y-ny],[q.x-nx,q.y-ny]]]);
    });
  }
  return shapes.length ? clip.union(shapes) : [];
}

/** Fold the paint in drawing order, retaining the boundaries of each finished elevation. */
interface Plan { regions: Map<number, MultiPolygon>; layers: { area: Area; shape: MultiPolygon }[] }
const plans = new WeakMap<Terrain, Plan>();
function heightRegions(t: Terrain): Plan {
  const cached = plans.get(t);
  if (cached) return cached;
  const layers: Plan['layers'] = [];
  let regions = new Map<number, MultiPolygon>();
  const footprints = new Map<TStroke, MultiPolygon>();
  for (const area of t.areas) {
    let mask: MultiPolygon = [];
    for (const s of area.strokes) {
      let shape = footprints.get(s);
      if (!shape) { shape = footprint(s, t.grid); footprints.set(s, shape); }
      mask = s.erase ? clip.difference(mask, shape) : clip.union(mask, shape);
    }
    if (!mask.length) continue;
    layers.push({area, shape: mask});
    const next = new Map<number, MultiPolygon>();
    const add = (z: number, shape: MultiPolygon) => {
      if (!shape.length) return;
      const current = next.get(z);
      next.set(z, current ? clip.union(current, shape) : shape);
    };
    let bare = mask;
    for (const [z, region] of regions) {
      add(z, clip.difference(region, mask));
      if (area.add) {
        add(z + area.h, clip.intersection(region, mask));
        bare = clip.difference(bare, region);
      }
    }
    add(area.h, bare);
    regions = next;
  }
  const plan = { regions, layers };
  plans.set(t,plan);
  return plan;
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
  if (!areaAt(t,point)) return null;
  const { regions, layers } = heightRegions(t);
  const height = groundAtTerrain(t,point);
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
    const same = !area.add && area.h === height;
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

/** Limit a brush erasure to the selected surface, even if another island shares its stroke. */
export function brushCuts(patches: HeightPatch[], grid: GridSettings, pts: Vec[], width: number, cells: boolean) {
  const brush = brushFootprint(grid,pts,width/2,cells);
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
export function terrainEdges(t: Terrain): TerrainEdge[] {
  type Event = { s: number; left: number; right: number };
  const lines = new Map<string, { ux: number; uy: number; offset: number; events: Event[] }>();
  for (const [height, region] of heightRegions(t).regions) for (const polygon of region) for (const ring of polygon) {
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
    events.sort((a,b) => a.s-b.s);
    let left = 0, right = 0;
    const at = (s: number, n = 0) => ({x: ux*s-uy*(offset+n), y: uy*s+ux*(offset+n)});
    for (let i = 0; i+1 < events.length; i++) {
      left += events[i].left; right += events[i].right;
      const start = events[i].s, len = events[i+1].s-start;
      if (left === right || len < 1e-6) continue;
      const one = left < right ? 1 : -1;
      const low = Math.min(left,right), top = Math.max(left,right);
      out.push({ a: at(start), b: at(start+len), one, low, top });
    }
  }
  return out;
}
