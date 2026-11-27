// A terrain sightline can reveal several separate stretches of ground. Work with
// those stretches directly so crossing a brush segment endpoint never opens a seam.
import type { Vec } from '../types';
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

function sampleSight(o: Vec, r: number, near: Edge[], eye: number, scale: number, n: number) {
  const angleStep = TAU/n;
  const buckets: Edge[][] = Array.from({length:n},() => []);
  for (const edge of near) {
    const {a,b} = edge.seg;
    let start = wrap(Math.atan2(a.y-o.y,a.x-o.x));
    let span = wrap(Math.atan2(b.y-o.y,b.x-o.x)-start);
    if (span > Math.PI) { start = wrap(start+span); span = TAU-span; }
    const end = Math.floor((start+span)/angleStep+1e-9);
    for (let i=Math.ceil(start/angleStep-1e-9); i<=end; i++) buckets[(i+n)%n].push(edge);
  }

  const angles = buckets.map((_,i) => i*angleStep);
  const caps: number[] = [], reaches: number[] = [];
  const downhill: (Band[] | undefined)[] = [];
  const bands = buckets.map((edges,i) => {
    const x = Math.cos(angles[i]), y = Math.sin(angles[i]);
    const crossings = edges.map(e => ({...e,d:rayHit(o,x,y,e.seg)})).filter(h => h.d<r).sort((a,b) => a.d-b.d);
    const hasLowTerrain = crossings.some(h => h.groundAfter !== undefined && h.seg.top! <= eye);
    downhill.push(hasLowTerrain ? downhillView(crossings,eye,r) : undefined);
    const hits = hasLowTerrain ? crossings.filter(h => h.groundAfter === undefined || h.seg.top! > eye) : crossings;
    let reach = r, cap = r;
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
        const inner = Math.max(previous,d-rise*scale);
        const outer = Math.min(d+inset,hits[j+1]?.d ?? r,horizon>0 ? (seg.top-eye)/horizon : r);
        if (outer > inner) visible.push([inner,outer]);
      }
      horizon = Math.max(horizon,(seg.top-eye)/d);
      previous = d;
    }
    return visible;
  });
  closeNarrowShadows(angles,reaches);
  closeNarrowShadows(angles,caps);
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

  return rows;
}

type Profile = Band[][];

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

type ViewCache = {views: Map<string,Visibility>; projections: Map<string,Profile>};
// The board replaces the segment array whenever its terrain or walls change.
const profiles = new WeakMap<Seg[], ViewCache>();

function cached<T>(cache: Map<string,T>, key: string, create: () => T): T {
  let entry = cache.get(key);
  if (!entry) {
    entry=create();
    if (cache.size>=48) cache.delete(cache.keys().next().value!);
    cache.set(key,entry);
  }
  return entry;
}

// Express each viewpoint on the same stationary map rays before interpolation.
// The half-open bearing interval assigns a shared polygon vertex to one edge.
function project(view: Visibility, origin: Vec, n: number): Profile {
  const buckets: {d:number; step:number}[][] = Array.from({length:n},() => []);
  const angleStep=TAU/n;
  for (const poly of [view.poly,...view.faces]) {
    for (let i=0,a=poly[poly.length-1];i<poly.length;a=poly[i++]) {
      const b=poly[i], seg={a,b};
      let start=wrap(Math.atan2(a.y-origin.y,a.x-origin.x));
      let span=wrap(Math.atan2(b.y-origin.y,b.x-origin.x)-start);
      const step=span>Math.PI ? -1 : 1;
      if (step<0) { start=wrap(start+span); span=TAU-span; }
      const end=Math.ceil((start+span)/angleStep-1e-9);
      for (let k=Math.ceil(start/angleStep-1e-9);k<end;k++) {
        const j=(k+n)%n, angle=j*angleStep;
        const d=rayHit(origin,Math.cos(angle),Math.sin(angle),seg);
        if (Number.isFinite(d)) buckets[j].push({d,step});
      }
    }
  }
  return buckets.map(hits => {
    hits.sort((a,b) => b.d-a.d);
    let winding=0, far=0;
    const row: Band[]=[];
    for (const {d,step} of hits) {
      if (!winding) far=d;
      winding+=step;
      if (!winding && far>d) row.push([d,far]);
    }
    row.push([0,winding ? far : 0]);
    return merge(row);
  });
}

// Signed distance along a ray is linear between band boundaries and the
// midpoints between them. Blend the distances to let bands split or disappear.
function blendBands(input: Band[][], weights: number[], r: number, scale: number): Band[] {
  const first = input[0];
  if (matchingBands(input)) {
    return first.map((_,j) => [
      input.reduce((v,row,k) => v+row[j][0]*weights[k],0),
      input.reduce((v,row,k) => v+row[j][1]*weights[k],0)
    ]);
  }
  const stops = new Set<number>([0,r]);
  const edges = input.map(row => {
    const cuts: number[] = [];
    for (const [lo,hi] of row) {
      if (lo>0) cuts.push(lo);
      if (hi<r) cuts.push(hi);
    }
    cuts.forEach((x,j) => { stops.add(x); if (j) stops.add((x+cuts[j-1])/2); });
    return cuts;
  });
  const sorted = [...stops].sort((a,b) => a-b);
  const result: Band[] = [];
  let start = 0, previous = 0, previousValue = 0;
  for (const x of sorted) {
    let value = 0;
    for (let k=0;k<input.length;k++) {
      let distance = edges[k].length ? Infinity : scale*2;
      for (const cut of edges[k]) distance = Math.min(distance,Math.abs(cut-x));
      value += weights[k]*distance*(input[k].some(([lo,hi]) => x>=lo && x<=hi) ? 1 : -1);
    }
    if (x && (value>=0)!==(previousValue>=0)) {
      const crossing = previous+(x-previous)*previousValue/(previousValue-value);
      if (value>=0) start = crossing;
      else if (crossing>start) result.push([start,crossing]);
    }
    previous=x; previousValue=value;
  }
  if (previousValue>=0 && r>start) result.push([start,r]);
  if (!result.length || result[0][0]>0) result.unshift([0,0]);
  return result;
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

export function terrainSight(o: Vec, r: number, near: Edge[], eye: number, steps: number, geometry: Seg[],
  nearAt: (p: Vec, range: number) => Edge[]): Visibility {
  const scale = near.find(e => e.seg.terrainPxPerFt !== undefined)!.seg.terrainPxPerFt!;
  const n = Math.max(steps,360,Math.min(720,Math.ceil(TAU*r/Math.max(1,scale))));
  const angleStep = TAU/n;
  // Adjacent positions share the four corner views. Short sight ranges need
  // closer samples to distinguish a nearby shelf from the face beyond it.
  const spacing = Math.min(6*scale,r/16);
  const gx=o.x/spacing, gy=o.y/spacing, ix=Math.floor(gx), iy=Math.floor(gy);
  const fx=gx-ix, fy=gy-iy;
  const corners = [[ix,iy,(1-fx)*(1-fy)],[ix+1,iy,fx*(1-fy)],
    [ix,iy+1,(1-fx)*fy],[ix+1,iy+1,fx*fy]].filter(c => c[2]>0);
  const direct = () => outline(o,r,scale,sampleSight(o,r,near,eye,scale,n));
  const origin={x:(ix+.5)*spacing,y:(iy+.5)*spacing};
  const dx=o.x-origin.x, dy=o.y-origin.y;
  const offsetDistance=Math.hypot(dx,dy);
  const authored=near.filter(e => e.seg.terrainPxPerFt===undefined);
  // Keep the exact shadow of a drawn wall or door. Its bearing from the
  // stationary rays can differ from its bearing at the viewer by this margin.
  const exactBearings=new Uint8Array(n);
  for (const {seg} of authored) {
    const distance=distToSeg(o,seg);
    if (distance<=offsetDistance) return direct();
    const margin=Math.asin(offsetDistance/distance)+angleStep;
    const a=Math.atan2(seg.a.y-o.y,seg.a.x-o.x);
    const b=Math.atan2(seg.b.y-o.y,seg.b.x-o.x);
    const span=wrap(b-a+Math.PI)-Math.PI;
    const start=Math.floor((a+Math.min(0,span)-margin)/angleStep);
    const end=Math.ceil((a+Math.max(0,span)+margin)/angleStep);
    for (let i=start;i<=end;i++) exactBearings[(i%n+n)%n]=1;
  }
  const padded=r+2*spacing;
  let cache = profiles.get(geometry);
  if (!cache) { cache={views:new Map(),projections:new Map()}; profiles.set(geometry,cache); }
  const weights=corners.map(c => c[2]);
  const samples=corners.map(([x,y]) => {
    const key=[r,n,eye,scale,x,y].join(',');
    return cached(cache.projections,key+'|'+ix+','+iy,() => {
      const view=cached(cache.views,key,() => {
        const p={x:x*spacing,y:y*spacing};
        const terrain=nearAt(p,padded).filter(e => e.seg.terrainPxPerFt!==undefined);
        const rows=sampleSight(p,padded,terrain,eye,scale,n);
        return outline(p,padded,scale,rows);
      });
      return project(view,origin,n);
    });
  });
  const blended = samples[0].map((_,i) => blendBands(samples.map(s => s[i]),weights,padded+spacing,scale));
  // A notch in the far edge can appear where neighboring views meet. Bridge
  // only the ground visible from both sides, keeping intervening shelves.
  const reaches = blended.map(row => row.at(-1)![1]);
  closeNarrowShadows(blended.map((_,i) => i*angleStep),reaches);
  const bridged = blended.map((row,i) => {
    const end=row.at(-1)![1];
    if (end>=reaches[i]) return row;
    let left=i, right=i;
    while (blended[left].at(-1)![1]<reaches[i]) left=(left+n-1)%n;
    while (blended[right].at(-1)![1]<reaches[i]) right=(right+1)%n;
    const common=intersect(blended[left],blended[right]);
    return merge([...row,...intersect(common,[[end,reaches[i]]])]);
  });
  const terrainRows = clearTerrainPockets(bridged,scale);
  let directRows: Profile | undefined;
  const rows=terrainRows.map((row,i) => {
    const angle=i*angleStep, x=Math.cos(angle), y=Math.sin(angle);
    if (exactBearings[i]) {
      directRows ??= project(direct(),origin,n);
      return directRows[i];
    }
    const offset=dx*x+dy*y;
    const limit=offset+Math.sqrt(r*r-dx*dx-dy*dy+offset*offset);
    return row.filter(([a]) => a<limit).map(([a,b]): Band => [a,Math.min(b,limit)]);
  });
  const result=outline(origin,r,scale,rows);
  result.free=!authored.length && samples.every(sample => sample.every(row => row.length===1 && row[0][1]>=r+spacing));
  return result;
}

function outline(o: Vec, r: number, scale: number, rows: Profile): Visibility {
  const n=rows.length, angleStep=TAU/n;
  // Keep continuous bands together across segment joins. At a split or merge,
  // both outlines end on the same bearing, including at the 0/360-degree seam.
  const poly: Vec[] = [], faces: Vec[][] = [];
  let strips: {inner: Vec[]; outer: Vec[]}[] = [];
  const tol = Math.min(0.1,scale/16,r/200);
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
  const finish = () => {
    for (const s of strips) faces.push(simplifyPoly(s.outer.concat(s.inner.reverse()),tol));
    strips = [];
  };
  append(0,rows[0]);
  for (let i=1;i<=n;i++) {
    const prev = rows[i-1], next = rows[i%n];
    if (!matchingBands([prev,next])) {
      const mid = (i-.5)*angleStep;
      append(mid,prev);
      finish();
      append(mid,next);
    }
    append(i*angleStep,next);
  }
  finish();
  poly.pop();
  return {poly:simplifyPoly(poly,tol),faces,free:rows.every(row => row[0]?.[1] === r)};
}
