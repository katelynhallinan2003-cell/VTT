// A terrain sightline can reveal several separate stretches of ground. Work with
// those stretches directly so crossing a brush segment endpoint never opens a seam.
import type { Rect, Vec } from '../types';
import { closeNarrowShadows, rayHit, simplifyPoly, type Seg, type Visibility } from './walls';

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

export type SightRegion = {bounds:Rect; rings: Vec[][]; height: number | ((x:number,y:number) => number)};
type Surface = {regions: SightRegion[]; scale: number; openings: Seg[]};
export type SightSegments = Seg[] & {surface?: Surface};
export function nearbySurface(surface:Surface | undefined, o:Vec, r:number): Surface | undefined {
  if (!surface) return;
  const regions=surface.regions.filter(({bounds:b})=>
    o.x+r>=b.x && o.y+r>=b.y && o.x-r<=b.x+b.w && o.y-r<=b.y+b.h);
  return regions.some(region=>typeof region.height==='function') ? {...surface,regions} : undefined;
}
type Hit = Edge & {d:number; incidence:number};
type Span = {lo:number; hi:number; height:SightRegion['height']};

// Intersect the finished polygons, counting each shared vertex once. Pairing
// from the far end also handles an eye inside a region or inside one of its holes.
function surfaceSpans(surface:Surface, o:Vec, radius:number, directions:Vec[]): Span[][] {
  const n=directions.length, step=TAU/n;
  const rows:Span[][]=Array.from({length:n},()=>[]);
  for (const {rings,height} of surface.regions) {
    const hits:number[][]=Array.from({length:n},()=>[]);
    for (const ring of rings) for (let i=1;i<ring.length;i++) {
      const seg={a:ring[i-1],b:ring[i]};
      const a=Math.atan2(seg.a.y-o.y,seg.a.x-o.x);
      const delta=wrap(Math.atan2(seg.b.y-o.y,seg.b.x-o.x)-a+Math.PI)-Math.PI;
      const start=wrap(a+Math.min(0,delta));
      const end=Math.ceil((start+Math.abs(delta))/step-1e-9);
      for(let k=Math.ceil(start/step-1e-9);k<end;k++) {
        const index=k%n, dir=directions[index];
        const d=rayHit(o,dir.x,dir.y,seg);
        if (Number.isFinite(d)) hits[index].push(d);
      }
    }
    for(let i=0;i<n;i++) {
      const crossings=hits[i].sort((a,b)=>a-b);
      for (let j=crossings.length-1;j>=0;j-=2) {
        const lo=crossings[j-1] ?? 0, hi=Math.min(crossings[j],radius);
        if (hi>lo) rows[i].push({lo,hi,height});
      }
    }
  }
  for (const row of rows) row.sort((a,b)=>a.lo-b.lo);
  return rows;
}

function groundRelief(height:number, eye:number) {
  // Half a foot of ground detail downhill, up to the middle of a standing
  // Medium creature uphill. Vary continuously as the viewer changes height.
  return Math.max(.5,Math.min(2.5,(height-eye+5)/2));
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
  const walls=hits.filter(h=>h.seg.terrainPxPerFt===undefined && h.seg.top!==undefined);
  let skyline=-Infinity, wall=0, at=0;
  const sweep=(lo:number,hi:number,height:SightRegion['height']) => {
    while (lo<hi) {
      while (wall<walls.length && walls[wall].d<=lo) {
        const hit=walls[wall++];
        skyline=Math.max(skyline,(hit.seg.top!-eye)/hit.d);
      }

      const end=Math.min(hi,walls[wall]?.d ?? hi);
      const get=(d:number)=>typeof height==='number' ? height : height(o.x+x*d,o.y+y*d);
      const steps=typeof height==='number' ? 1 : Math.min(512,Math.ceil((end-lo)/surface.scale));
      let d=lo,h=get(lo);
      for (let j=1;j<=steps;j++) {
        const next=lo+(end-lo)*j/steps, hNext=get(next);
        if (d>0) skyline=Math.max(skyline,(h-eye)/d);
        const a=skyline===-Infinity ? 1 : h+groundRelief(h,eye)-eye-skyline*d;
        const b=skyline===-Infinity ? 1 : hNext+groundRelief(hNext,eye)-eye-skyline*next;
        if (a>=0 && b>=0) show(d,next);
        else if ((a>=0)!==(b>=0)) {
          const cross=d+(next-d)*a/(a-b);
          if (a>=0) show(d,cross); else show(cross,next);
        }
        skyline=Math.max(skyline,(hNext-eye)/next);
        d=next; h=hNext;
      }
      lo=end;
    }
  };
  let floor:number | undefined, previous=0, cut=0;
  const interval=(lo:number,hi:number,height:SightRegion['height'])=>{
    if (hi<=lo) return;
    if (!cuts.length) { sweep(lo,hi,height); return; }
    const start=typeof height==='number' ? height : height(o.x+x*lo,o.y+y*lo);
    while(cut<cuts.length && cuts[cut]<lo-1e-5) cut++;
    const opened=cut<cuts.length && Math.abs(cuts[cut]-lo)<=1e-5;
    // Enter under a deck only through an erased uphill edge. At a still-solid
    // exit its back wall blocks sight; through an open exit resume ground sight.
    if (opened && start>previous+.001) floor ??= previous;
    if (floor!==undefined && !opened && Math.abs(start-previous)>.001) {
      if (lo>0) skyline=Math.max(skyline,(previous-eye)/lo);
      floor=undefined;
    }
    if (floor!==undefined && start<=floor+.001) floor=undefined;
    sweep(lo,hi,floor ?? height);
    previous=typeof height==='number' ? height : height(o.x+x*hi,o.y+y*hi);
  };
  for (const s of spans) {
    if (s.lo>at) interval(at,s.lo,0);
    if (s.hi>at) interval(Math.max(at,s.lo),s.hi,s.height);
    at=Math.max(at,s.hi);
  }
  interval(at,r,0);
  return visible;
}

function sampleSight(o: Vec, r: number, near: Edge[], eye: number, scale: number, n: number, surface?:Surface) {
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
  const dirs=angles.map(a=>({x:Math.cos(a),y:Math.sin(a)}));
  const spans=surface && surfaceSpans(surface,o,r,dirs);
  const caps: number[] = [], reaches: number[] = [];
  const downhill: (Band[] | undefined)[] = [];
  const bands = buckets.map((edges,i) => {
    const {x,y} = dirs[i];
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
    }).filter(h => h.d<r).sort((a,b) => a.d-b.d);
    const profiled=surface && surfaceView(o,x,y,r,eye,surface,spans![i],crossings);
    if (profiled) {
      const row=profiled[0]?.[0]===0 ? profiled : [[0,0] as Band,...profiled];
      caps.push(crossings.find(h=>h.seg.top===undefined)?.d ?? r);
      reaches.push(row[0][1]); downhill.push(undefined);
      return row;
    }
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
  if (surface) return cleanSurfaceBands(bands,caps,scale,angleStep);
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
  return rows.map((row,i) => {
    const limit = Math.min(edgeRange,caps[i]);
    const beside = intersect(merge([...rows[(i+n-1)%n],...rows[(i+1)%n]]),[[0,limit]]);
    return merge([...row,...beside]);
  });
}

// Compare like distances on either side of a shadow. Using a fixed angle here
// used to erase a much wider strip of terrain as the viewer backed away.
function cleanSurfaceBands(bands: Band[][], caps: number[], scale:number, angleStep:number): Band[][] {
  const radius=caps.reduce((a,b)=>Math.max(a,b),0);
  const width=2*scale;
  const outside=(row:Band[]):Band[]=>{
    const gaps:Band[]=[];
    let end=0;
    for(const [lo,hi] of row) {
      if (lo>end) gaps.push([end,lo]);
      end=hi;
    }
    if (end<radius) gaps.push([end,radius]);
    return gaps;
  };
  const dilate=(rows:Band[][]) => {
    const radial=rows.map(row=>merge(row.map(([a,b])=>[Math.max(0,a-width),Math.min(radius,b+width)])));
    const n=rows.length, half=Math.ceil(n/36);
    return radial.map((row,i)=>{
      const spans=[...row];
      for(let k=1;k<=half;k++){
        const limit=width/Math.sin(k*angleStep);
        for(const j of [(i+n-k)%n,(i+k)%n]) {
          for(const [lo,hi] of radial[j]) {
            if(lo>=limit) break;
            spans.push([lo,Math.min(hi,limit)]);
          }
        }
      }
      return merge(spans);
    });
  };
  const expanded=dilate(bands);
  const hidden=dilate(expanded.map(outside));
  return hidden.map((row,i)=>intersect(merge([...bands[i],...outside(row)]),[[0,caps[i]]]));
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

export function terrainSight(o: Vec, r: number, near: Edge[], eye: number, steps: number, surface?: Surface): Visibility {
  const scale = surface?.scale ?? near.find(e => e.seg.terrainPxPerFt !== undefined)!.seg.terrainPxPerFt!;
  const n = Math.max(steps,360,Math.min(720,Math.ceil(TAU*r/Math.max(1,scale))));
  return outline(o,r,scale,clearTerrainPockets(sampleSight(o,r,near,eye,scale,n,surface),scale));
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
