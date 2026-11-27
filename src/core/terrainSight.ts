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

export type SightRegion = {bounds:Rect; rings: Vec[][]; corners: Vec[]; height: number | ((x:number,y:number) => number)};
type Surface = {regions: SightRegion[]; scale: number; openings: Seg[]; gradientVision: boolean; terraced:boolean};
export type SightSegments = Seg[] & {surface?: Surface};
export function nearbySurface(surface:Surface | undefined, o:Vec, r:number): Surface | undefined {
  if (!surface) return;
  const regions=surface.regions.filter(({bounds:b})=>
    o.x+r>=b.x && o.y+r>=b.y && o.x-r<=b.x+b.w && o.y-r<=b.y+b.h);
  return regions.length ? {...surface,regions,gradientVision:surface.gradientVision && regions.some(region=>typeof region.height==='function')} : undefined;
}
type Hit = Edge & {d:number; incidence:number};
type Span = {lo:number; hi:number; height:SightRegion['height']};

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
function surfaceSpans(surface:Surface, o:Vec, radius:number, directions:Vec[], angles:number[]): Span[][] {
  const n=directions.length;
  const rows:Span[][]=Array.from({length:n},()=>[]);
  for (const {rings,height} of surface.regions) {
    const hits=new Map<number,number[]>();
    for (const ring of rings) for (let i=1;i<ring.length;i++) {
      const seg={a:ring[i-1],b:ring[i]};
      const a=Math.atan2(seg.a.y-o.y,seg.a.x-o.x);
      const delta=wrap(Math.atan2(seg.b.y-o.y,seg.b.x-o.x)-a+Math.PI)-Math.PI;
      eachBearing(angles,a,delta,index=>{
        const dir=directions[index];
        const d=rayHit(o,dir.x,dir.y,seg);
        if (Number.isFinite(d)) {
          const list=hits.get(index);
          if (list) list.push(d); else hits.set(index,[d]);
        }
      });
    }
    for(const [i,crossings] of hits) {
      crossings.sort((a,b)=>a-b);
      for (let j=crossings.length-1;j>=0;j-=2) {
        const lo=crossings[j-1] ?? 0, hi=Math.min(crossings[j],radius);
        if (hi>lo) rows[i].push({lo,hi,height});
      }
    }
  }
  for (const row of rows) row.sort((a,b)=>a.lo-b.lo);
  return rows;
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

  const walls=hits.filter(h=>h.seg.top!==undefined && (h.seg.terrainPxPerFt===undefined ||
    (!surface.gradientVision && h.seg.top-(h.seg.low ?? -Infinity)>.05)));
  let skyline=-Infinity, wall=0, at=0;
  const sweep=(lo:number,hi:number,height:SightRegion['height']) => {
    while (lo<hi) {
      while (wall<walls.length && walls[wall].d<=lo) {
        const hit=walls[wall++];
        skyline=Math.max(skyline,(hit.seg.top!-eye)/hit.d);
      }

      const end=Math.min(hi,walls[wall]?.d ?? hi);
      if (!surface.gradientVision && skyline===-Infinity) {
        show(lo,end);
        lo=end;
        continue;
      }
      const get=(d:number)=>typeof height==='number' ? height : height(o.x+x*d,o.y+y*d);
      // Anchor samples to map coordinates. Redistributing all the samples
      // across a slope whenever its step count changed made crests shimmer.
      const horizontal=Math.abs(x)>=Math.abs(y);
      const dir=horizontal ? x : y, origin=horizontal ? o.x : o.y;
      const spacing=Math.max(surface.scale*.5, (end-lo)/1024);
      const stride=spacing/Math.abs(dir), phase=(origin+dir*lo)/spacing;
      const plane=dir>0 ? Math.floor(phase)+1 : Math.ceil(phase)-1;
      let crossing=typeof height==='number' ? end : (plane*spacing-origin)/dir;
      if (crossing<=lo+1e-8) crossing+=stride;
      let d=lo,h=get(lo);
      while (d<end) {
        const next=Math.min(end,crossing), hNext=get(next);
        crossing+=stride;
        if (surface.gradientVision && d>0) skyline=Math.max(skyline,(h-eye)/d);
        const a=skyline===-Infinity ? 1 : h+groundRelief(h,eye,surface.terraced)-eye-skyline*d;
        const b=skyline===-Infinity ? 1 : hNext+groundRelief(hNext,eye,surface.terraced)-eye-skyline*next;
        if (a>=0 && b>=0) show(d,next);
        else if ((a>=0)!==(b>=0)) {
          const cross=d+(next-d)*a/(a-b);
          if (a>=0) show(d,cross); else show(cross,next);
        }
        if (surface.gradientVision) skyline=Math.max(skyline,(hNext-eye)/next);
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
      if (surface.gradientVision && lo>0) skyline=Math.max(skyline,(previous-eye)/lo);
      floor=undefined;
    }
    if (floor!==undefined && start<=floor+.001) floor=undefined;
    sweep(lo,hi,floor ?? height);
    previous=typeof height==='number' ? height : height(o.x+x*hi,o.y+y*hi);
  };
  // Two independently clipped rings can cross the same contour a few ulps
  // apart. In a below-zero valley treating that numerical gap as a real strip
  // of zero-foot ground creates an entire phantom ridge.
  const seam=Math.max(1e-6,r*1e-11);
  for (const s of spans) {
    const start=s.lo>at+seam ? s.lo : at;
    if (start>at) interval(at,start,0);
    if (s.hi>start+seam) interval(start,s.hi,s.height);
    at=Math.max(at,s.hi);
  }
  interval(at,r,0);
  return visible;
}

function sampleSight(o: Vec, r: number, near: Edge[], eye: number, scale: number, n: number, surface?:Surface) {
  const angleStep = TAU/n;
  const bearings = Array.from({length:n},(_,i)=>i*angleStep);
  // Follow the actual ends of walls and terrain contours as the eye moves.
  // Otherwise a single ray gaining/losing a distant shelf flips a whole wedge.
  const addVertex=(p:Vec)=>{
    if (Math.hypot(p.x-o.x,p.y-o.y)>r) return;
    const a=Math.atan2(p.y-o.y,p.x-o.x);
    bearings.push(wrap(a-1e-6),wrap(a+1e-6));
  };
  if (surface) {
    for(const region of surface.regions) for(const p of region.corners) addVertex(p);
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
  const spans=surface && surfaceSpans(surface,o,r,dirs,angles);
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
  if (surface) {
    // Resolve narrow radial cracks continuously. Angular or connected-component
    // thresholds can switch a distant patch all at once as the token moves.
    const rows=bands.map((row,i)=>intersect(merge(row,scale*.15),[[0,caps[i]]]));
    return {angles,rows:smoothBoundaries(rows,angles,caps,r,scale)};
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

export function terrainSight(o: Vec, r: number, near: Edge[], eye: number, steps: number, surface?: Surface): Visibility {
  const scale = surface?.scale ?? near.find(e => e.seg.terrainPxPerFt !== undefined)!.seg.terrainPxPerFt!;
  const n = Math.max(steps,360,Math.min(surface ? 1440 : 720,Math.ceil(TAU*r/Math.max(1,scale))));
  const {angles,rows}=sampleSight(o,r,near,eye,scale,n,surface);
  // Intersecting with a wall cap can remove the zero-length origin band.
  // Keep a detached visible ledge separate from the central sight polygon.
  const profile=(surface ? rows : clearTerrainPockets(rows,scale)).map(row =>
    row.length && row[0][0]>0 ? [[0,0] as Band,...row] : row);
  return outline(o,r,scale,profile,angles);
}

function outline(o: Vec, r: number, scale: number, rows: Profile, angles:number[]): Visibility {
  const n=rows.length;
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
      const mid = (angles[i-1]+(angles[i] ?? TAU))/2;
      append(mid,prev);
      finish();
      append(mid,next);
    }
    append(angles[i] ?? TAU,next);
  }
  finish();
  poly.pop();
  return {poly:simplifyPoly(poly,tol),faces,free:rows.every(row => row[0]?.[1] === r)};
}
