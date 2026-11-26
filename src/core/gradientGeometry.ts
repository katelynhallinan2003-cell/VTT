import type { MultiPolygon, Pair } from 'polygon-clipping';
import type { Vec } from '../types';
import { inRegion } from './terrainEdges';

const distance = (a: Vec,b: Vec) => Math.hypot(a.x-b.x,a.y-b.y);
const point = ([x,y]: Pair): Vec => ({x,y});

function locate(shape: MultiPolygon, p: Vec, tolerance: number) {
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
