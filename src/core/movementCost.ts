import type { GridSettings, Vec } from '../types';
import { pathFt } from './geometry';
import { currentOverlay } from './gridOverlay';
import { STAIR_FT, walkExtra, type WalkCtx } from './walk';
import type { TerrainEdge } from './terrainEdges';
import { sideOf, type Seg } from './walls';

const rounded = (n: number) => Math.round(n * 10) / 10;
const EPS = 1e-7;
type AirPoint = { run: number; z: number };

/** Shortest flight above the terrain along the chosen horizontal route. A ridge
 * sets a minimum altitude, while a valley between ridges can be flown over. */
function airDistance(points: AirPoint[]): number {
  if (points.length < 2) return 0;
  const start = points[0].z, end = points[points.length - 1].z;
  const hull: AirPoint[] = [];
  for (const point of points) {
    const last = hull[hull.length - 1];
    if (last && Math.abs(point.run - last.run) < EPS) {
      point.z = Math.max(point.z, last.z);
      hull.pop();
    }
    while (hull.length >= 2) {
      const a = hull[hull.length-2], b = hull[hull.length-1];
      if ((b.z-a.z)*(point.run-b.run) > (point.z-b.z)*(b.run-a.run)) break;
      hull.pop();
    }
    hull.push(point);
  }
  const vertical = hull[0].z - start + hull[hull.length - 1].z - end;
  return hull.slice(1).reduce((ft,p,i) => ft + Math.hypot(p.run-hull[i].run,p.z-hull[i].z),vertical);
}

/** Fraction along an infinite route line. A half-open endpoint rule counts a shared
 * contour vertex once. Signed rises cancel when the route grazes a corner. */
function crossing(a: Vec, b: Vec, edge: Seg): number | null {
  const dx = b.x-a.x, dy = b.y-a.y;
  const side = (p: Vec) => dx*(p.y-a.y) - dy*(p.x-a.x);
  const s = side(edge.a), e = side(edge.b);
  if ((s > EPS) === (e > EPS)) return null;
  const u = s/(s-e);
  return ((edge.a.x+u*(edge.b.x-edge.a.x)-a.x)*dx + (edge.a.y+u*(edge.b.y-edge.a.y)-a.y)*dy)/(dx*dx+dy*dy);
}

export function movementCost(grid: GridSettings, path: Vec[], flyer: number | null, ctx: WalkCtx,
  edges: TerrainEdge[], walls: Seg[]) {
  const flightRuns: number[] | undefined = flyer === null ? undefined : [];
  const flat = pathFt(grid, path, [], flightRuns);
  const free = currentOverlay(grid) === 'none';
  let extra = 0, climb = 0, straight = 0, rough = 0, run = 0;
  const air: AirPoint[] = [];
  const surface = ctx.surface ?? ctx.ground;
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i], dx = b.x-a.x, dy = b.y-a.y;
    const length = Math.hypot(dx,dy);
    if (!length) continue;
    const ft = flightRuns ? flightRuns[i - 1] - run : length * grid.ft / grid.cell;
    const hits = new Map<number, { rise: number; wallRise: number; wall: number }>();
    const hit = (t: number) => {
      const key = Math.max(0, Math.min(1, Math.round(t*1e9)/1e9));
      let h = hits.get(key);
      if (!h) { h = {rise:0, wallRise:0, wall:0}; hits.set(key,h); }
      return h;
    };
    const gradients: { t: number; slope: number }[] = [];
    for (const e of edges) {
      const t = crossing(a,b,e);
      if (t === null) continue;
      const ex = e.b.x-e.a.x, ey = e.b.y-e.a.y;
      const normal = (ex*dy-ey*dx)/(Math.hypot(ex,ey)*length);
      const rise = -e.one * Math.sign(normal) * (e.top-e.low);
      if (t >= -EPS && t <= 1+EPS) {
        const h = hit(t);
        h.rise += rise;
        if (!e.stair) h.wallRise += rise;
      }
      if (free && flyer === null && e.stair && normal) {
        const width = STAIR_FT/Math.abs(normal);
        const lo = Math.max(0,t-width/(2*ft)), hi = Math.min(1,t+width/(2*ft));
        if (lo < hi) gradients.push({t:lo,slope:rise/width},{t:hi,slope:-rise/width});
      }
    }
    for (const w of walls) {
      if (!w.climbable || !w.wallHeight || (w.one && sideOf(w,a) && sideOf(w,a) !== w.one)) continue;
      const t = crossing(a,b,w);
      if (t === null || t < -EPS || t > 1+EPS) continue;
      const h = hit(t);
      h.wall = Math.max(h.wall,w.wallHeight);
    }
    const atStart = ctx.ground(a), atEnd = ctx.ground(b);
    if (flyer !== null) air.push({run,z:Math.max(flyer,surface(a))});
    let height = atStart;
    for (const [t,h] of [...hits].sort((x,y)=>x[0]-y[0])) {
      // A route ending exactly on a terrain edge uses the actual endpoint elevation.
      let rise = h.rise;
      if (t === 0) rise = ctx.ground({x:a.x+dx*1e-6,y:a.y+dy*1e-6})-atStart;
      if (t === 1) rise = atEnd-height;
      const next = height + rise;
      const low = Math.min(height,next), high = Math.max(height,next);
      const summit = Math.max(high,low+h.wall);
      if (flyer !== null) {
        if (rise || h.wall) air.push({run:run+t*ft,z:Math.max(flyer,summit)});
      } else {
        if (h.wallRise && rise) climb += Math.min(Math.abs(h.wallRise),Math.abs(rise));
        if (h.wall) {
          // On level ground a freestanding wall costs both faces. A wall along
          // a platform edge adds only the part above the platform.
          const above = summit-high;
          climb += above * (t === 0 || t === 1 ? 1 : 2);
          if (!h.wallRise) climb += Math.abs(rise);
        }
      }
      height = next;
    }
    if (flyer !== null) {
      run += ft;
      air.push({run,z:Math.max(flyer,surface(b))});
      continue;
    }
    if (free) {
      let slope = 0, prev = 0;
      for (const g of gradients.sort((a,b)=>a.t-b.t)) {
        extra += (Math.hypot(1,slope)-1)*(g.t-prev)*ft;
        slope += g.slope; prev = g.t;
      }
    }
    const e = walkExtra(grid,a,b,{ ...ctx, ground: free ? () => 0 : ctx.ground, surface: undefined,
      stairAt: (p,q) => !edges.some(edge => {
        if (edge.stair) return false;
        const t = crossing(p,q,edge);
        return t !== null && t > EPS && t <= 1+EPS;
      }) },straight);
    extra += e.extraFt; straight += e.straightStairs; rough += e.rough*grid.ft;
  }
  if (flyer !== null) {
    return {ft:rounded(airDistance(air)),note:''};
  }
  const normal = rounded(flat+extra), climbing = rounded(climb);
  const note = climbing ? `${normal} ft normal + ${climbing} ft climbing` : rough ? `difficult ground +${rounded(rough)} ft` : '';
  return {ft:rounded(normal+climbing),note};
}
