// A terrain sightline can reveal several separate stretches of ground. Work with
// those stretches directly so crossing a brush segment endpoint never opens a seam.
import type { Rect, Vec } from '../types';
import { closeNarrowShadows, distToSeg, rayHit, simplifyPoly, type Seg, type Visibility } from './walls';

type Edge = {seg: Seg; inset: number; groundAfter?: number};
type Band = [number, number];
const TAU = 2*Math.PI;
const wrap = (a: number) => a-TAU*Math.floor(a/TAU);

function merge(bands: Band[], gap = 0): Band[] {
  const out: Band[] = [];
  for (const [lo,hi] of bands.sort((a,b) => a[0]-b[0])) {
    const last = out.at(-1);
    if (last && lo <= last[1]+gap) last[1] = Math.max(hi,last[1]);
    else out.push([lo,hi]);
  }
  return out;
}

function intersect(a: Band[], b: Band[]): Band[] {
  const out: Band[] = [];
  for (let i=0,j=0; i<a.length && j<b.length;) {
    const lo = Math.max(a[i][0],b[j][0]), hi = Math.min(a[i][1],b[j][1]);
    if (lo < hi) out.push([lo,hi]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

// Follow the sightline tangent to each descending rim. A lower terrace comes
// back into view where that line meets its surface, or where the ground rises.
function downhillView(hits: (Edge & {d: number})[], eye: number, radius: number): Band[] | undefined {
  let horizon = -Infinity, visibleFrom = 0;
  const visible: Band[] = [];
  const terrain = hits.filter(hit => hit.groundAfter !== undefined);
  for (let i=0; i<terrain.length; i++) {
    const {seg, groundAfter, d} = terrain[i];
    const ground = groundAfter!, rim = seg.top!;
    if (ground === seg.low && rim <= eye) horizon = Math.max(horizon,(rim-eye)/d);
    if (horizon === -Infinity || ground >= eye) continue;
    const recovery = horizon === 0 ? radius : (ground-eye)/horizon;
    const until = Math.min(recovery,terrain[i+1]?.d ?? radius);
    if (until <= d) continue;
    if (visibleFrom < d) visible.push([visibleFrom,d]);
    visibleFrom = until;
  }
  if (!visibleFrom) return;
  if (visibleFrom < radius) visible.push([visibleFrom,radius]);
  return visible;
}

const TILE=16, TS=TILE+1;

/**
 * Heights of one smooth surface on a regular grid in map coordinates, built a
 * tile at a time the first time a sightline reaches it and kept. Each tile
 * also knows its lowest and highest sample, so a sightline can pass over a
 * tile it is certainly above, or below, without sampling it.
 */
export class HeightField {
  private tiles: (Float32Array | undefined)[];
  private lows: Float32Array;
  private highs: Float32Array;
  private readonly tw: number;
  private readonly th: number;
  constructor(readonly x0:number, readonly y0:number, readonly step:number, private nx:number, private ny:number, private fn:(x:number,y:number)=>number) {
    this.tw=Math.ceil(nx/TILE); this.th=Math.ceil(ny/TILE);
    this.tiles=new Array(this.tw*this.th);
    this.lows=new Float32Array(this.tw*this.th);
    this.highs=new Float32Array(this.tw*this.th);
  }
  private build(t:number):Float32Array {
    const tx=t%this.tw, ty=(t-tx)/this.tw;
    const out=new Float32Array(TS*TS);
    let lo=Infinity, hi=-Infinity;
    for (let j=0;j<TS;j++) for (let i=0;i<TS;i++) {
      const h=this.fn(this.x0+(tx*TILE+i)*this.step,this.y0+(ty*TILE+j)*this.step);
      out[j*TS+i]=h;
      if (h<lo) lo=h;
      if (h>hi) hi=h;
    }
    this.lows[t]=lo; this.highs[t]=hi;
    return this.tiles[t]=out;
  }
  /** The tile under a point (clamped to the grid). */
  tileAt(x:number,y:number):number {
    const ix=Math.max(0,Math.min(this.nx-1,Math.floor((x-this.x0)/this.step)));
    const iy=Math.max(0,Math.min(this.ny-1,Math.floor((y-this.y0)/this.step)));
    return ((iy/TILE)|0)*this.tw+((ix/TILE)|0);
  }
  /** Map rectangle of a tile, and the range of heights inside it. */
  tileInfo(t:number):{x0:number; y0:number; x1:number; y1:number; lo:number; hi:number} {
    if (!this.tiles[t]) this.build(t);
    const tx=t%this.tw, ty=(t-tx)/this.tw, side=TILE*this.step;
    const x0=this.x0+tx*side, y0=this.y0+ty*side;
    // The first and last tiles also hold points clamped onto the grid.
    return {x0:tx ? x0 : -Infinity, y0:ty ? y0 : -Infinity, x1:tx<this.tw-1 ? x0+side : Infinity, y1:ty<this.th-1 ? y0+side : Infinity, lo:this.lows[t], hi:this.highs[t]};
  }
  at(x:number,y:number):number {
    const u=(x-this.x0)/this.step, v=(y-this.y0)/this.step;
    let ix=Math.floor(u), iy=Math.floor(v);
    if (ix<0) ix=0; else if (ix>this.nx-1) ix=this.nx-1;
    if (iy<0) iy=0; else if (iy>this.ny-1) iy=this.ny-1;
    const fx=Math.max(0,Math.min(1,u-ix)), fy=Math.max(0,Math.min(1,v-iy));
    const t=((iy/TILE)|0)*this.tw+((ix/TILE)|0);
    const tile=this.tiles[t] ?? this.build(t);
    const k=(iy%TILE)*TS+(ix%TILE);
    const a=tile[k], b=tile[k+1], c=tile[k+TS], d=tile[k+TS+1];
    return (1-fy)*((1-fx)*a+fx*b)+fy*((1-fx)*c+fx*d);
  }
}

/** `sliver`: an unpainted crack enclosed by painted ground, less than half a foot wide on average. Sight runs over it like a seam. */
export type SightRegion = {bounds:Rect; rings: Vec[][]; corners: Vec[]; height: number | ((x:number,y:number) => number); field?: HeightField; sliver?: boolean};
type Surface = {regions: SightRegion[]; scale: number; openings: Seg[]; gradientVision: boolean; terraced:boolean};
export type SightSegments = Seg[] & {surface?: Surface};
export function nearbySurface(surface:Surface | undefined, o:Vec, r:number, box?:Rect): Surface | undefined {
  if (!surface) return;
  // A region wholly outside the traced box only adds crossings beyond every
  // ray's end, which pair among themselves and change nothing.
  const regions=surface.regions.filter(({bounds:b})=>
    o.x+r>=b.x && o.y+r>=b.y && o.x-r<=b.x+b.w && o.y-r<=b.y+b.h &&
    (!box || box.x<=b.x+b.w && box.y<=b.y+b.h && box.x+box.w>=b.x && box.y+box.h>=b.y));
  return regions.length ? {...surface,regions,gradientVision:surface.gradientVision && regions.some(region=>typeof region.height==='function')} : undefined;
}
type Hit = Edge & {d:number; incidence:number};
type Span = {lo:number; hi:number; height:SightRegion['height']; field?:HeightField; sliver?:boolean};

function firstBearing(angles:number[], angle:number):number {
  let lo=0, hi=angles.length;
  while (lo<hi) {
    const mid=(lo+hi)>>>1;
    if (angles[mid]<angle) lo=mid+1; else hi=mid;
  }
  return lo;
}

function eachBearing(angles:number[], a:number, delta:number, visit:(index:number)=>void) {
  const start=wrap(a+Math.min(0,delta)), end=start+Math.abs(delta);
  for (let k=firstBearing(angles,start);k<angles.length && angles[k]<end;k++) visit(k);
  if (end>TAU) for(let k=0;k<angles.length && angles[k]<end-TAU;k++) visit(k);
}

// Intersect the finished polygons, counting each shared vertex once. Pairing
// from the far end also handles an eye inside a region or inside one of its holes.
function surfaceSpans(surface:Surface, o:Vec, lims:number[], directions:Vec[], angles:number[]): Span[][] {
  const n=directions.length;
  const rows:Span[][]=Array.from({length:n},()=>[]);
  const hits:number[][]=Array.from({length:n},()=>[]);
  const touched:number[]=[];
  for (const {rings,height,field,sliver} of surface.regions) {
    for (const ring of rings) {
      // One bearing per vertex; each edge visits the rays between its ends.
      let pa=ring[0], aa=Math.atan2(pa.y-o.y,pa.x-o.x);
      for (let i=1;i<ring.length;i++) {
        const pb=ring[i], ab=Math.atan2(pb.y-o.y,pb.x-o.x);
        const delta=wrap(ab-aa+Math.PI)-Math.PI;
        const start=wrap(aa+Math.min(0,delta)), end=start+Math.abs(delta);
        const ex=pb.x-pa.x, ey=pb.y-pa.y, ax=pa.x-o.x, ay=pa.y-o.y;
        const visit=(k:number)=>{
          const dir=directions[k];
          const den=dir.x*ey-dir.y*ex;
          if (Math.abs(den)<1e-12) return;
          const t=(ax*ey-ay*ex)/den, u=(ax*dir.y-ay*dir.x)/den;
          if (t>1e-6 && u>=-1e-9 && u<=1+1e-9) {
            const list=hits[k];
            if (!list.length) touched.push(k);
            list.push(t);
          }
        };
        for (let k=firstBearing(angles,start);k<n && angles[k]<end;k++) visit(k);
        if (end>TAU) for (let k=0;k<n && angles[k]<end-TAU;k++) visit(k);
        pa=pb; aa=ab;
      }
    }
    // Pairing from the far end also handles an eye inside a region or inside
    // one of its holes, and an eye standing right on its edge.
    for (const i of touched) {
      const crossings=hits[i];
      crossings.sort((a,b)=>a-b);
      for (let j=crossings.length-1;j>=0;j-=2) {
        const lo=crossings[j-1] ?? 0, hi=Math.min(crossings[j],lims[i]);
        if (hi>lo) rows[i].push({lo,hi,height,field,sliver});
      }
      crossings.length=0;
    }
    touched.length=0;
  }
  for (const row of rows) if (row.length>1) row.sort((a,b)=>a.lo-b.lo);
  return rows;
}

/**
 * How much of a downhill terrain step to ignore for sight, in feet. A step under
 * a foot, seen from above, hides nothing a player could read: at a distance it
 * only drew a hairline shadow along a painted contour. Steps of two feet or more
 * count in full, and the blend in between keeps the shadow growing smoothly.
 */
export const SIGHT_STEP = 1;
export function softStep(step:number):number {
  if (step<=0) return 0;
  if (step<=SIGHT_STEP) return step;
  return Math.max(0,2*SIGHT_STEP-step);
}

function groundRelief(height:number, eye:number, flat:boolean) {
  // Flat terrace art includes its near face. Slopes use a smaller allowance;
  // downhill, the target is a detail half a foot above the ground.
  return Math.max(.5,Math.min(flat ? 7 : 2.5,(height-eye+5)/2));
}

// Follow the skyline across the actual painted surface. Flat intervals have
// an analytic crossing; smooth intervals use contiguous linear pieces. Both
// sides of a discontinuity are evaluated at the exact contour distance.
function surfaceView(o: Vec, x: number, y: number, r:number, eye:number, surface:Surface, spans:Span[], hits:Hit[]): Band[] {
  const cuts=surface.openings.map(s=>rayHit(o,x,y,s)).filter(d=>d<r).sort((a,b)=>a-b);
  const visible: Band[]=[];
  const show=(a:number,b:number) => {
    if (b<=a) return;
    const last=visible.at(-1);
    if (last && a<=last[1]+1e-6) last[1]=Math.max(last[1],b);
    else visible.push([a,b]);
  };

  // A hairline crack left unpainted between two painted surfaces is a slip
  // of the brush, not a fin of bare rock at 0 ft. Sight runs over it like a
  // seam; one step stands where it ends, between the ground on either side.
  const slivers:Band[]=[];
  const solid:Span[]=[];
  for (const s of spans) {
    if (!s.sliver) { solid.push(s); continue; }
    const last=slivers.at(-1);
    if (last && s.lo<=last[1]+1e-4) last[1]=Math.max(last[1],s.hi);
    else slivers.push([s.lo,s.hi]);
  }
  const inSliver=(d:number)=>slivers.some(([a,b])=>d>=a-1e-4 && d<=b+1e-4);
  const heightAt=(s:Span,d:number)=>typeof s.height==='number' ? s.height : s.height(o.x+x*d,o.y+y*d);
  const steps:Hit[]=[];
  if (!surface.gradientVision) for (const [a,b] of slivers) {
    const before=solid.filter(s=>s.hi<=a+1e-4).at(-1), after=solid.find(s=>s.lo>=b-1e-4);
    const near=before && before.hi>=a-1e-4 ? heightAt(before,before.hi) : 0;
    const far=after && after.lo<=b+1e-4 ? heightAt(after,after.lo) : 0;
    if (Math.abs(near-far)<=.05) continue;
    const p={x:o.x+x*b,y:o.y+y*b};
    steps.push({d:b,inset:0,incidence:1,seg:{a:p,b:p,top:Math.max(near,far),low:Math.min(near,far),terrainPxPerFt:surface.scale}});
  }
  const walls=hits.filter(h=>h.seg.top!==undefined && (h.seg.terrainPxPerFt===undefined ||
    (!surface.gradientVision && (h.seg.sightCrest || h.seg.top-(h.seg.low ?? -Infinity)>.05) && !(slivers.length && inSliver(h.d)))))
    .concat(steps).sort((p,q)=>p.d-q.d);
  let skyline=-Infinity, wall=0, at=0;
  // With gradients blocking, the last ground before a change of surface sets
  // the skyline only once the ground after it is known (see softStep).
  let rim:{h:number; d:number} | null=null;
  const terraced=surface.terraced, gradient=surface.gradientVision;
  const fOf=(h:number)=>h+groundRelief(h,eye,terraced);
  const sweep=(lo:number,hi:number,height:SightRegion['height'],field?:HeightField) => {
    while (lo<hi) {
      while (wall<walls.length && walls[wall].d<=lo) {
        const hit=walls[wall++];
        const at={x:o.x+x*hit.d,y:o.y+y*hit.d};
        let top=hit.seg.sightCrest ? hit.seg.sightCrest(at) : hit.seg.top;
        if (top!==undefined && hit.seg.terrainPxPerFt!==undefined && top<=eye) {
          const low=hit.seg.sightLow ? hit.seg.sightLow(at) : hit.seg.low;
          if (low!==undefined) top-=softStep(top-low);
        }
        if (top!==undefined) skyline=Math.max(skyline,(top-eye)/hit.d);
      }

      const end=Math.min(hi,walls[wall]?.d ?? hi);
      if (!gradient && skyline===-Infinity) {
        show(lo,end);
        lo=end;
        continue;
      }
      if (typeof height==='number') {
        // Flat ground: one linear piece.
        const f=fOf(height);
        const a=skyline===-Infinity ? 1 : f-eye-skyline*lo;
        if (gradient && lo>0) skyline=Math.max(skyline,(height-eye)/lo);
        const a2=skyline===-Infinity ? 1 : f-eye-skyline*lo;
        const b=skyline===-Infinity ? 1 : f-eye-skyline*end;
        const first=gradient ? a2 : a;
        if (first>=0 && b>=0) show(lo,end);
        else if ((first>=0)!==(b>=0)) {
          const cross=lo+(end-lo)*first/(first-b);
          if (first>=0) show(lo,cross); else show(cross,end);
        }
        if (gradient) {
          if (end>=hi) rim={h:height,d:end};
          else skyline=Math.max(skyline,(height-eye)/end);
        }
        lo=end;
        continue;
      }
      const get=field ? (d:number)=>field.at(o.x+x*d,o.y+y*d) : (d:number)=>height(o.x+x*d,o.y+y*d);
      // Anchor samples to map coordinates. Redistributing all the samples
      // across a slope whenever its step count changed made crests shimmer.
      const horizontal=Math.abs(x)>=Math.abs(y);
      const dir=horizontal ? x : y, origin=horizontal ? o.x : o.y;
      const spacing=Math.max(surface.scale*.5, (end-lo)/1024);
      const stride=spacing/Math.abs(dir);
      const firstPlane=(from:number)=>{
        const phase=(origin+dir*from)/spacing;
        const plane=dir>0 ? Math.floor(phase)+1 : Math.ceil(phase)-1;
        let c=(plane*spacing-origin)/dir;
        if (c<=from+1e-8) c+=stride;
        return c;
      };
      let crossing=firstPlane(lo);
      let d=lo,h=get(lo);
      // Tiles the sightline is certainly above, or below, need no samples:
      // marching through them could only give the same answer.
      let skipFrom=lo;
      while (d<end) {
        if (field && d>=skipFrom && skyline!==-Infinity) {
          const px=o.x+x*d+x*1e-6, py=o.y+y*d+y*1e-6;
          const info=field.tileInfo(field.tileAt(px,py));
          const ex=x>0 ? (info.x1-o.x)/x : x<0 ? (info.x0-o.x)/x : Infinity;
          const ey=y>0 ? (info.y1-o.y)/y : y<0 ? (info.y0-o.y)/y : Infinity;
          const exit=Math.min(end,ex,ey);
          if (exit>d+stride) {
            if (gradient && d>0) skyline=Math.max(skyline,(h-eye)/d);
            const l0=eye+skyline*d, l1=eye+skyline*exit;
            const fmax=fOf(info.hi);
            let skipped=false;
            if (fmax<Math.min(l0,l1) && (!gradient || d>0 && Math.max((info.hi-eye)/d,(info.hi-eye)/exit)<=skyline)) skipped=true;
            else if (!gradient && fOf(info.lo)>=Math.max(l0,l1)) { show(d,exit); skipped=true; }
            if (skipped) {
              d=exit;
              if (d>=end) break;
              h=get(d);
              crossing=firstPlane(d);
              continue;
            }
          }
          skipFrom=exit;
        }
        const next=Math.min(end,crossing), hNext=get(next);
        crossing+=stride;
        if (gradient && d>0) skyline=Math.max(skyline,(h-eye)/d);
        const a=skyline===-Infinity ? 1 : fOf(h)-eye-skyline*d;
        const b=skyline===-Infinity ? 1 : fOf(hNext)-eye-skyline*next;
        if (a>=0 && b>=0) show(d,next);
        else if ((a>=0)!==(b>=0)) {
          const cross=d+(next-d)*a/(a-b);
          if (a>=0) show(d,cross); else show(cross,next);
        }
        if (gradient) {
          if (next>=hi) rim={h:hNext,d:next};
          else skyline=Math.max(skyline,(hNext-eye)/next);
        }
        d=next; h=hNext;
      }
      lo=end;
    }
  };
  let floor:number | undefined, previous=0, cut=0;
  const interval=(lo:number,hi:number,height:SightRegion['height'],field?:HeightField)=>{
    if (hi<=lo) return;
    const start=typeof height==='number' ? height : height(o.x+x*lo,o.y+y*lo);
    if (rim) {
      const drop=rim.h<=eye ? softStep(rim.h-start) : 0;
      if (rim.d>0) skyline=Math.max(skyline,(rim.h-drop-eye)/rim.d);
      rim=null;
    }
    if (!cuts.length) { sweep(lo,hi,height,field); return; }
    while(cut<cuts.length && cuts[cut]<lo-1e-5) cut++;
    const opened=cut<cuts.length && Math.abs(cuts[cut]-lo)<=1e-5;
    // Enter under a deck only through an erased uphill edge. At a still-solid
    // exit its back wall blocks sight; through an open exit resume ground sight.
    if (opened && start>previous+.001) floor ??= previous;
    if (floor!==undefined && !opened && Math.abs(start-previous)>.001) {
      if (surface.gradientVision && lo>0) skyline=Math.max(skyline,(previous-eye)/lo);
      floor=undefined;
    }
    if (floor!==undefined && start<=floor+.001) floor=undefined;
    sweep(lo,hi,floor ?? height,floor===undefined ? field : undefined);
    previous=typeof height==='number' ? height : height(o.x+x*hi,o.y+y*hi);
  };
  // Two independently clipped rings can cross the same contour a few ulps
  // apart. In a below-zero valley treating that numerical gap as a real strip
  // of zero-foot ground creates an entire phantom ridge.
  const seam=Math.max(1e-6,r*1e-11);
  for (const s of solid) {
    const start=s.lo>at+seam && !slivers.some(([a,b])=>a<=at+1e-4 && b>=s.lo-1e-4) ? s.lo : at;
    if (start>at) interval(at,start,0);
    if (s.hi>start+seam) interval(start,s.hi,s.height,s.field);
    at=Math.max(at,s.hi);
  }
  interval(at,r,0);
  return visible;
}

function sampleSight(o: Vec, r: number, near: Edge[], eye: number, scale: number, n: number, surface?:Surface, box?:Rect) {
  const angleStep = TAU/n;
  const bearings = Array.from({length:n},(_,i)=>i*angleStep);
  // Follow the actual ends of walls and terrain contours as the eye moves.
  // Otherwise a single ray gaining/losing a distant shelf flips a whole wedge.
  const addVertex=(p:Vec)=>{
    if (Math.hypot(p.x-o.x,p.y-o.y)>r) return;
    if (box && (p.x<box.x || p.y<box.y || p.x>box.x+box.w || p.y>box.y+box.h)) return;
    const a=Math.atan2(p.y-o.y,p.x-o.x);
    bearings.push(wrap(a-1e-6),wrap(a+1e-6));
  };
  if (surface) {
    for(const region of surface.regions) if (!region.sliver) for(const p of region.corners) addVertex(p);
    for(const s of surface.openings) { addVertex(s.a); addVertex(s.b); }
    for(const {seg} of near) if (seg.terrainPxPerFt===undefined) { addVertex(seg.a); addVertex(seg.b); }
  }
  bearings.sort((a,b)=>a-b);
  const angles=bearings.filter((a,i)=>!i || a-bearings[i-1]>1e-9);
  const buckets: Edge[][] = angles.map(()=>[]);
  for (const edge of near) {
    if (surface?.gradientVision && edge.seg.terrainPxPerFt!==undefined) continue;
    const {a,b}=edge.seg;
    const start=Math.atan2(a.y-o.y,a.x-o.x);
    const delta=wrap(Math.atan2(b.y-o.y,b.x-o.x)-start+Math.PI)-Math.PI;
    eachBearing(angles,start,delta,i=>buckets[i].push(edge));
  }
  const dirs=angles.map(a=>({x:Math.cos(a),y:Math.sin(a)}));
  // Each ray ends where it leaves the traced box (the whole circle without one).
  const lims=dirs.map(({x,y})=>{
    if (!box) return r;
    const ex=x>0 ? (box.x+box.w-o.x)/x : x<0 ? (box.x-o.x)/x : Infinity;
    const ey=y>0 ? (box.y+box.h-o.y)/y : y<0 ? (box.y-o.y)/y : Infinity;
    return Math.max(0,Math.min(r,ex,ey));
  });
  const spans=surface && surfaceSpans(surface,o,lims,dirs,angles);
  const caps: number[] = [], reaches: number[] = [];
  const downhill: (Band[] | undefined)[] = [];
  const bands = buckets.map((edges,i) => {
    const {x,y} = dirs[i], lim = lims[i];
    const crossings = edges.map(edge => {
      const d = rayHit(o,x,y,edge.seg);
      const {a,b} = edge.seg;
      const ex = b.x-a.x, ey = b.y-a.y;
      // The painted face has width across its contour. A grazing ray spends
      // more distance crossing it, bounded near the ends of short segments.
      const incidence = edge.inset ? Math.max(.5,Math.abs(x*ey-y*ex)/Math.hypot(ex,ey)) : 1;
      const faceDepth = edge.inset/incidence;
      // A one-foot detail on a terrace clears the near lip by similar triangles.
      const inset = faceDepth && edge.groundAfter !== undefined
        ? Math.max(faceDepth, d/(edge.seg.top!-eye)) : faceDepth;
      return {...edge,d,inset,incidence};
    }).filter(h => h.d<lim).sort((a,b) => a.d-b.d);
    const profiled=surface && surfaceView(o,x,y,lim,eye,surface,spans![i],crossings);
    if (profiled) {
      const row=profiled[0]?.[0]===0 ? profiled : [[0,0] as Band,...profiled];
      caps.push(crossings.find(h=>h.seg.top===undefined)?.d ?? lim);
      reaches.push(row[0][1]); downhill.push(undefined);
      return row;
    }
    const hasLowTerrain = crossings.some(h => h.groundAfter !== undefined && h.seg.top! <= eye);
    downhill.push(hasLowTerrain ? downhillView(crossings,eye,lim) : undefined);
    const hits = hasLowTerrain ? crossings.filter(h => h.groundAfter === undefined || h.seg.top! > eye) : crossings;
    let reach = lim, cap = lim;
    for (const {seg,inset,d} of hits) {
      reach = Math.min(reach,d+inset);
      if (seg.top === undefined) cap = Math.min(cap,d);
    }
    caps.push(cap);
    reaches.push(reach);
    const visible: Band[] = [[0,reach]];
    let horizon = -Infinity, previous = 0;
    for (let j=0;j<hits.length;j++) {
      const {seg,inset,d} = hits[j];
      if (seg.top === undefined) break;
      const rise = seg.top-Math.max(seg.low ?? eye,eye+horizon*d);
      if (inset > 0 && previous > 0 && d+inset > reach && rise > 0) {
        const inner = Math.max(previous,d-rise*scale/hits[j].incidence);
        const outer = Math.min(d+inset,hits[j+1]?.d ?? r,horizon>0 ? (seg.top-eye)/horizon : r);
        if (outer > inner) visible.push([inner,outer]);
      }
      horizon = Math.max(horizon,(seg.top-eye)/d);
      previous = d;
    }
    return visible;
  });
  closeNarrowShadows(angles,caps);
  if (surface) {
    // Resolve narrow radial cracks continuously. Angular or connected-component
    // thresholds can switch a distant patch all at once as the token moves.
    const rows=bands.map((row,i)=>intersect(merge(row,scale*.15),[[0,caps[i]]]));
    return {angles,rows:smoothBoundaries(openNarrowFaces(rows,angles,scale),angles,caps,r,scale)};
  }
  closeNarrowShadows(angles,reaches);
  // A shadow needs a patch of ground both wide and deep enough to hide.
  // Dilate then erode in two dimensions so diagonal slivers and attached tips
  // disappear too. Restore the exact range and solid-wall limits afterwards.
  const margin = scale;
  const radial = bands.map((row,i) => {
    row[0][1] = reaches[i];
    const clear = downhill[i];
    const visible = clear ? intersect(merge(row),clear) : row;
    return merge(visible.map(([lo,hi]) => [lo-margin,hi+margin]));
  });
  const half = Math.max(1,Math.floor(n*5/360));
  const dilated = radial.map((_,i) => {
    const around: Band[] = [];
    for (let k=-half;k<=half;k++) around.push(...radial[(i+k+n)%n]);
    return merge(around);
  });
  const rows = dilated.map((_,i) => {
    let open: Band[] = [[-margin,r+margin]];
    for (let k=-half;k<=half;k++) open = intersect(open,dilated[(i+k+n)%n]);
    return merge(open.map(([lo,hi]): Band => [Math.max(0,lo+margin),Math.min(caps[i],hi-margin)])
      .filter(([lo,hi]) => hi>lo),2*margin);
  });

  // Remove the last half-foot of an angular stair step along a terrain
  // silhouette. Limit the borrowed band by its *map distance* from the ray
  // and by actual wall hits. Large distances never get a wider allowance.
  const edgeRange = scale*.5/Math.sin(angleStep);
  return {angles,rows:rows.map((row,i) => {
    const limit = Math.min(edgeRange,caps[i]);
    const beside = intersect(merge([...rows[(i+n-1)%n],...rows[(i+1)%n]]),[[0,limit]]);
    return merge([...row,...beside]);
  })};
}

type Profile = Band[][];

/**
 * Ground seen through a crack between two obstacles shows up far away as a
 * sliver one or two sightlines wide: a bright hairline with nothing on screen
 * to explain it. Measure each patch that is not joined to the ground around
 * the viewer by how wide it is across the sightlines, drop it below a foot and
 * let it grow back to full length by two and a half feet, so it never pops.
 */
function openNarrowFaces(rows:Profile, angles:number[], scale:number):Profile {
  const n=rows.length;
  if (n<3) return rows;
  const lo=scale, hi=2.5*scale;
  const gap=(i:number)=>{
    const prev=angles[(i+n-1)%n], next=angles[(i+1)%n];
    return (wrap(next-angles[i])+wrap(angles[i]-prev))/2;
  };
  const seen=rows.map(row=>new Uint8Array(row.length));
  let changed=false;
  for (let i=0;i<n;i++) for (let j=1;j<rows[i].length;j++) {
    if (seen[i][j]) continue;
    const patch:[number,number][]=[[i,j]];
    seen[i][j]=1;
    let attached=false;
    for (let k=0;k<patch.length;k++) {
      const [ray,band]=patch[k], [a,b]=rows[ray][band];
      for (const next of [(ray+n-1)%n,(ray+1)%n]) rows[next].forEach(([c,d],m)=>{
        if (d<a || c>b) return;
        if (m===0) { attached=true; return; }
        if (seen[next][m]) return;
        seen[next][m]=1;
        patch.push([next,m]);
      });
    }
    if (attached) continue;
    // Width across the sightlines at each ray's own distance, summed over rays.
    const across=new Map<number,number>();
    for (const [ray,band] of patch) {
      const [a,b]=rows[ray][band];
      across.set(ray,Math.max(across.get(ray) ?? 0,gap(ray)*(a+b)/2));
    }
    let width=0;
    for (const w of across.values()) width+=w;
    if (width>=hi) continue;
    const t=Math.max(0,(width-lo)/(hi-lo)), keep=t*t*(3-2*t);
    for (const [ray,band] of patch) {
      const [a,b]=rows[ray][band], mid=(a+b)/2, half=(b-a)/2*keep;
      rows[ray][band]=[mid-half,mid+half];
    }
    changed=true;
  }
  return changed ? rows.map(row=>row.filter(([a,b],j)=>j===0 || b-a>1e-6)) : rows;
}

// Measure enclosed shadows on the finished terrain mask. A shallow
// pocket between shelves can survive the line-width filter on every ray yet
// occupy very little ground. Leave the continuous shadow beyond the hill alone.
function clearTerrainPockets(rows: Profile, scale: number): Profile {
  const n = rows.length;
  const gaps = rows.map((row,ray) => row.slice(1).map(([hi],j) => ({
    ray, j, lo:row[j][1], hi, visited:false
  })));
  for (const rayGaps of gaps) for (const first of rayGaps) {
    if (first.visited) continue;
    const pocket = [first];
    let exterior = false, area = 0;
    first.visited = true;
    for (let k=0;k<pocket.length;k++) {
      const {ray,lo,hi} = pocket[k];
      area += (hi-lo)*(hi+lo)*Math.PI/n;
      for (const next of [(ray+n-1)%n,(ray+1)%n]) {
        if (hi>(rows[next].at(-1)?.[1] ?? 0)) exterior = true;
        for (const gap of gaps[next]) {
          if (gap.visited || lo>=gap.hi || hi<=gap.lo) continue;
          gap.visited = true;
          pocket.push(gap);
        }
      }
    }
    if (exterior) continue;
    // Clear up to two 5-ft squares and taper to full size over the next two.
    // Stepping closer changes the apparent angle even for the same small patch.
    const size = (area/(scale*scale)-50)/50;
    if (size>=1) continue;
    const t = Math.max(0,size);
    const shrink = (1-t*t*(3-2*t))/2;
    for (const {ray,j,lo,hi} of pocket) {
      const inset = (hi-lo)*shrink;
      if (hi-lo-2*inset < scale/4) {
        // Fully close the last few inches so tapering cannot leave a black line.
        rows[ray][j][1] = rows[ray][j+1][0] = (lo+hi)/2;
      } else {
        rows[ray][j][1] = lo+inset;
        rows[ray][j+1][0] = hi-inset;
      }
    }
  }
  return rows.map(row => merge(row));
}

// Interpolate boundaries only when each visible face AND the intervening
// shadow have a common range in every sample. Otherwise interpolation can
// invent a shadow between unrelated ledges, on ground all the samples see.
function matchingBands(rows: Band[][]): boolean {
  const count = rows[0].length;
  if (rows.some(row => row.length!==count)) return false;
  if (count===1) return true; // The first band always starts at the origin.
  let previousEnd = -Infinity;
  for (let j=0;j<count;j++) {
    let firstStart=Infinity, lastStart=-Infinity, firstEnd=Infinity, lastEnd=-Infinity;
    for (const row of rows) {
      const [start,end] = row[j];
      firstStart=Math.min(firstStart,start);
      lastStart=Math.max(lastStart,start);
      firstEnd=Math.min(firstEnd,end);
      lastEnd=Math.max(lastEnd,end);
    }
    if (lastStart>firstEnd || previousEnd>=firstStart) return false;
    previousEnd=lastEnd;
  }
  return true;
}

// Smooth small kinks in a continuous outline against the chord between its
// neighbours. A straight wall lies on that chord. Keep range, wall ends,
// separate terraces and angular discontinuities pinned to their true limits.
function smoothBoundaries(rows:Profile, angles:number[], caps:number[], radius:number, scale:number):Profile {
  const n=rows.length;
  return rows.map((row,i)=>{
    const prev=(i+n-1)%n, next=(i+1)%n, left=rows[prev], right=rows[next];
    if (!row.length || !matchingBands([left,row,right])) return row;
    const a=wrap(angles[i]-angles[prev]), b=wrap(angles[next]-angles[i]);
    if (Math.min(a,b)<1e-5) return row;
    const smooth=(j:number,side:0|1)=>{
      const d=row[j][side], l=left[j][side], r=right[j][side];
      if (d===0 || d===radius || d===caps[i] || l<=0 || r<=0) return d;
      const chord=l*r*Math.sin(a+b)/(l*Math.sin(a)+r*Math.sin(b));
      const bend=chord-d;
      const weight=Math.max(0,1-Math.abs(bend)/(1.5*scale));
      return d+.6*weight*bend;
    };
    return merge(row.map((_,j):Band=>[smooth(j,0),Math.min(caps[i],smooth(j,1))])
      .filter(([lo,hi])=>hi>lo));
  });
}

export function terrainSight(o: Vec, r: number, near: Edge[], eye: number, steps: number, surface?: Surface, box?: Rect): Visibility {
  const scale = surface?.scale ?? near.find(e => e.seg.terrainPxPerFt !== undefined)!.seg.terrainPxPerFt!;
  const n = Math.max(steps,360,Math.min(surface ? 1440 : 720,Math.ceil(TAU*r/Math.max(1,scale))));
  const {angles,rows}=sampleSight(o,r,near,eye,scale,n,surface,box);
  // Intersecting with a wall cap can remove the zero-length origin band.
  // Keep a detached visible ledge separate from the central sight polygon.
  const profile=(surface ? rows : clearTerrainPockets(rows,scale)).map(row =>
    row.length && row[0][0]>0 ? [[0,0] as Band,...row] : row);
  const vis=outline(o,r,scale,profile,angles);
  if (box) vis.free=false;
  return vis;
}

function outline(o: Vec, r: number, scale: number, rows: Profile, angles:number[]): Visibility {
  const n=rows.length;
  // Keep continuous bands together across segment joins. At a split or merge,
  // both outlines end on the same bearing, including at the 0/360-degree seam.
  const poly: Vec[] = [], faces: Vec[][] = [];
  let strips: {inner: Vec[]; outer: Vec[]}[] = [];
  const tol = Math.min(0.1,scale/16,r/200);
  // The same ground as triangles between neighbouring bearings: a fan for the
  // band at the viewer and a quad for each band beyond. No triangulation.
  let tri = new Float32Array(4096), k = 0;
  const put = (ax:number,ay:number,bx:number,by:number,cx:number,cy:number) => {
    if (k+6 > tri.length) { const grown = new Float32Array(tri.length*2); grown.set(tri); tri = grown; }
    tri[k++]=ax; tri[k++]=ay; tri[k++]=bx; tri[k++]=by; tri[k++]=cx; tri[k++]=cy;
  };
  let lastAngle = 0, lastRow: Band[] = rows[0];
  const append = (angle: number, row: Band[]) => {
    const x = Math.cos(angle), y = Math.sin(angle);
    const at = (d: number) => ({x:o.x+x*d,y:o.y+y*d});
    poly.push(at(row[0]?.[1] ?? 0));
    for (let j=1;j<row.length;j++) {
      const s = strips[j-1] ??= {inner:[],outer:[]};
      s.inner.push(at(row[j][0]));
      s.outer.push(at(row[j][1]));
    }
  };
  // Fill the wedge from the last bearing to `angle`, both sides with `row`'s
  // bands (the caller only pairs rows whose bands match).
  const wedge = (a0: number, r0: Band[], a1: number, r1: Band[]) => {
    const x0 = Math.cos(a0), y0 = Math.sin(a0), x1 = Math.cos(a1), y1 = Math.sin(a1);
    const m = Math.min(r0.length, r1.length);
    for (let j=0;j<m;j++) {
      const [p0,q0] = r0[j], [p1,q1] = r1[j];
      if (q0<=p0 && q1<=p1) continue;
      const ax=o.x+x0*p0, ay=o.y+y0*p0, bx=o.x+x0*q0, by=o.y+y0*q0;
      const cx=o.x+x1*q1, cy=o.y+y1*q1, dx=o.x+x1*p1, dy=o.y+y1*p1;
      put(ax,ay,bx,by,cx,cy);
      if (p0>0 || p1>0) put(ax,ay,cx,cy,dx,dy);
    }
  };
  const step = (angle: number, row: Band[]) => {
    wedge(lastAngle,lastRow,angle,row);
    lastAngle = angle; lastRow = row;
  };
  const finish = () => {
    for (const s of strips) faces.push(simplifyPoly(s.outer.concat(s.inner.reverse()),tol));
    strips = [];
  };
  append(0,rows[0]);
  for (let i=1;i<=n;i++) {
    const prev = rows[i-1], next = rows[i%n];
    const a = angles[i] ?? TAU;
    if (!matchingBands([prev,next])) {
      const mid = (angles[i-1]+a)/2;
      append(mid,prev);
      step(mid,prev);
      finish();
      append(mid,next);
      lastRow = next;
    }
    append(a,next);
    step(a,next);
  }
  finish();
  poly.pop();
  return {poly:simplifyPoly(poly,tol),faces,free:rows.every(row => row[0]?.[1] === r),fill:tri.slice(0,k)};
}
