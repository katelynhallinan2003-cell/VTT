// A terrain sightline can reveal several separate stretches of ground. Work with
// those stretches directly so crossing a brush segment endpoint never opens a seam.
import type { Vec } from '../types';
import { closeNarrowShadows, distToSeg, rayHit, simplifyPoly, type Seg, type Visibility } from './walls';

type Edge = {seg: Seg; inset: number};
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
  const bands = buckets.map((edges,i) => {
    const x = Math.cos(angles[i]), y = Math.sin(angles[i]);
    const hits = edges.map(e => ({...e,d:rayHit(o,x,y,e.seg)})).filter(h => h.d<r).sort((a,b) => a.d-b.d);
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
    return merge(row.map(([lo,hi]) => [lo-margin,hi+margin]));
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
  if (input.every(row => row.length === first.length &&
    row.every(([lo,hi],j) => hi >= first[j][0] && lo <= first[j][1]))) {
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
        return outline(p,padded,scale,sampleSight(p,padded,terrain,eye,scale,n));
      });
      return project(view,origin,n);
    });
  });
  let directRows: Profile | undefined;
  const rows=samples[0].map((_,i) => {
    const angle=i*angleStep, x=Math.cos(angle), y=Math.sin(angle);
    if (exactBearings[i]) {
      directRows ??= project(direct(),origin,n);
      return directRows[i];
    }
    const offset=dx*x+dy*y;
    const limit=offset+Math.sqrt(r*r-dx*dx-dy*dy+offset*offset);
    const row=blendBands(samples.map(s => s[i]),weights,padded+spacing,scale);
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
    if (prev.length!==next.length || prev.some(([lo,hi],j) => j>0 && (hi<next[j][0] || lo>next[j][1]))) {
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
