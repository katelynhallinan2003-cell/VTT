import type { MultiPolygon, Pair } from 'polygon-clipping';
import type { Vec } from '../types';
import { inRegion } from './terrainEdges';

const distance = (a: Vec,b: Vec) => Math.hypot(a.x-b.x,a.y-b.y);
const point = ([x,y]: Pair): Vec => ({x,y});

export function locate(shape: MultiPolygon, p: Vec, tolerance: number) {
  let best = tolerance;
  let edge: { ring: Pair[]; index: number; at: Vec } | null = null;
  for (const polygon of shape) for (const ring of polygon) {
    for (let i=0; i+1<ring.length; i++) {
      const [x,y] = ring[i], dx = ring[i+1][0]-x, dy = ring[i+1][1]-y;
      const t = Math.max(0,Math.min(1,((p.x-x)*dx+(p.y-y)*dy)/(dx*dx+dy*dy || 1)));
      const at = {x:x+t*dx,y:y+t*dy}, d = distance(p,at);
      if (d <= best) { best=d; edge={ring,index:i,at}; }
    }
  }
  return edge ? {at:edge.at,edge} : shape.some(poly => inRegion(poly,p)) ? {at:p,edge:null} : null;
}

type Edge = NonNullable<NonNullable<ReturnType<typeof locate>>['edge']>;

const contours=new WeakMap<Pair[],ReturnType<typeof measureContour>>();
function contour(ring:Pair[]) {
  let measured=contours.get(ring);
  if (!measured) { measured=measureContour(ring); contours.set(ring,measured); }
  return measured;
}

function measureContour(ring: Pair[]) {
  const offsets = [0];
  for (let i=1;i<ring.length;i++) offsets.push(offsets[i-1]+distance(point(ring[i-1]),point(ring[i])));
  const length = offsets[offsets.length-1];
  const wrap = (s:number) => ((s%length)+length)%length;
  const station = (edge:Edge) => offsets[edge.index]+distance(point(ring[edge.index]),edge.at);
  const segment=(t:number)=>{
    let lo=0, hi=ring.length-1;
    while (hi-lo>1) {
      const mid=Math.floor((lo+hi)/2);
      if (offsets[mid]<=t) lo=mid; else hi=mid;
    }
    return lo;
  };
  const at = (s:number) => {
    const t=wrap(s), i=segment(t);
    const f=(t-offsets[i])/(offsets[i+1]-offsets[i] || 1);
    return {x:ring[i][0]+f*(ring[i+1][0]-ring[i][0]),y:ring[i][1]+f*(ring[i+1][1]-ring[i][1])};
  };
  const arc = (start:number,span:number): Vec[] => {
    if (span<0) return arc(start+span,-span).reverse();
    const result=[at(start)], count=ring.length-1;
    const first=segment(wrap(start));
    for (let j=1;j<=count;j++) {
      const index=(first+j)%count, d=wrap(offsets[index]-start);
      if (d>=span-1e-6) break;
      if (d>1e-6) result.push(point(ring[index]));
    }
    result.push(at(start+span));
    return result;
  };
  return {length,station,wrap,arc};
}

export function initialGradientLine(shape:MultiPolygon, p:Vec, reach:number):Vec[] | null {
  const anchor=locate(shape,p,1e-4);
  if (!anchor) return null;
  if (anchor.edge) {
    const c=contour(anchor.edge.ring);
    return c.arc(c.station(anchor.edge),Math.min(reach,c.length/5));
  }
  for (let r=reach;r>1e-5;r/=2) for (let i=0;i<8;i++) {
    const angle=i*Math.PI/4;
    const path=gradientPath(shape,p,{x:p.x+r*Math.cos(angle),y:p.y+r*Math.sin(angle)},0);
    if (path) return path;
  }
  return null;
}

/** Preserve the direction around a ring, even after the dragged end passes the halfway mark. */
export function dragGradient(shape:MultiPolygon,path:Vec[],part:'start'|'end'|'line',from:Vec,to:Vec,snap:number):Vec[] | null {
  if (path.length===1) return gradientPath(shape,to,undefined,snap);
  const start=path[0], end=path[path.length-1];
  const a=locate(shape,start,1e-4)?.edge, b=locate(shape,end,1e-4)?.edge;
  if (a && b && a.ring===b.ring) {
    const c=contour(a.ring), s=c.station(a), e=c.station(b);
    const forward=c.wrap(e-s);
    const length=path.reduce((sum,p,i)=>sum+(i ? distance(p,path[i-1]) : 0),0);
    const forwardPath=c.arc(s,forward);
    // Comparing the first segment also distinguishes the two equal half-perimeters.
    const first=path.find(p=>distance(p,start)>1e-5) ?? end;
    const next=forwardPath[1];
    const sameDirection=(next.x-start.x)*(first.x-start.x)+(next.y-start.y)*(first.y-start.y)>0;
    const span=length>=c.length-1e-5 ? c.length : sameDirection ? forward : forward-c.length;
    const ringShape:MultiPolygon=[[a.ring]];
    const target=locate(ringShape,to,Infinity)!.edge!;
    const t=c.station(target);
    if (part==='line') {
      const old=c.station(locate(ringShape,from,Infinity)!.edge!);
      return c.arc(s+t-old,length>=c.length-1e-5 ? c.length : span);
    }
    const fixed=part==='end' ? s : t, last=part==='end' ? t : e;
    const travel=c.wrap(last-fixed);
    if (travel<1e-5 || c.length-travel<1e-5) return null;
    // Unwrap around the previous span. Crossing the fixed handle reverses the short
    // segment naturally; passing the far side continues a long perimeter line.
    return c.arc(fixed,Math.abs(travel-span)<=Math.abs(travel-c.length-span) ? travel : travel-c.length);
  }
  if (part==='line') {
    const shift=(p:Vec)=>({x:p.x+to.x-from.x,y:p.y+to.y-from.y});
    return gradientPath(shape,shift(start),shift(end),0);
  }
  return part==='end' ? gradientPath(shape,start,to,snap) : gradientPath(shape,to,end,snap,false);
}

/** Snap either endpoint independently. Two endpoints on the same contour follow its shorter arc. */
export function gradientPath(shape: MultiPolygon, start: Vec, end: Vec | undefined, tolerance: number, movingEnd = true): Vec[] | null {
  const a = locate(shape,start,end && movingEnd ? 0.0001 : tolerance);
  if (!a) return null;
  if (!end) return [a.at];
  const b = locate(shape,end,movingEnd ? tolerance : 0.0001);
  if (!b || distance(a.at,b.at)<0.001) return null;
  if (a.edge && b.edge && a.edge.ring === b.edge.ring && a.edge.index !== b.edge.index) {
    const ring = a.edge.ring, count = ring.length-1;
    const arc = (from: number,to: number,first: Vec,last: Vec) => {
      const path = [first];
      for (let i=from; i!==to;) { i=(i+1)%count; path.push(point(ring[i])); }
      path.push(last);
      return path;
    };
    const forward = arc(a.edge.index,b.edge.index,a.at,b.at);
    const back = arc(b.edge.index,a.edge.index,b.at,a.at).reverse();
    const length = (path: Vec[]) => path.reduce((sum,p,i) => sum+(i ? distance(path[i-1],p) : 0),0);
    return length(forward)<=length(back) ? forward : back;
  }
  // Reject a chord that leaves a concave area or crosses a hole.
  const dx=b.at.x-a.at.x, dy=b.at.y-a.at.y, cuts=[0,1];
  for (const poly of shape) for (const ring of poly) for (let i=1;i<ring.length;i++) {
    const [x,y]=ring[i-1], ex=ring[i][0]-x, ey=ring[i][1]-y, det=dx*ey-dy*ex;
    if (Math.abs(det)<1e-10) continue;
    const t=((x-a.at.x)*ey-(y-a.at.y)*ex)/det, u=((x-a.at.x)*dy-(y-a.at.y)*dx)/det;
    if (t>0 && t<1 && u>=0 && u<=1) cuts.push(t);
  }
  cuts.sort((l,r)=>l-r);
  for (let i=1;i<cuts.length;i++) {
    if (cuts[i]-cuts[i-1]<1e-8) continue;
    const t=(cuts[i]+cuts[i-1])/2;
    if (!locate(shape,{x:a.at.x+t*dx,y:a.at.y+t*dy},0.0001)) return null;
  }
  return [a.at,b.at];
}
