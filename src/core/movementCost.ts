import type { GridSettings, Vec } from '../types';
import { pathFt } from './geometry';
import { roughDistance, type WalkCtx } from './walk';
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
  if (path.length < 2) return {ft:0, note:''};
  let rough = 0, run = 0, wallAtJoin = 0;
  // Each interval describes the surface actually traversed after its entry point.
  const profile: {run: number; ground: number; wall: number}[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i], dx = b.x-a.x, dy = b.y-a.y;
    const length = Math.hypot(dx,dy);
    if (!length) continue;
    const ft = flightRuns ? flightRuns[i-1] - run : length * grid.ft / grid.cell;
    const cuts = new Map<number, number>([[0,wallAtJoin],[1,0]]);
    const cut = (edge: Seg, wall: number) => {
      const t = crossing(a,b,edge);
      if (t === null || t < -EPS || t > 1+EPS) return;
      const key = Math.max(0, Math.min(1, Math.round(t*1e9)/1e9));
      cuts.set(key, Math.max(cuts.get(key) ?? 0, wall));
    };
    for (const edge of edges) cut(edge,0);
    for (const w of walls) {
      if (!w.climbable || !w.wallHeight || (w.one && sideOf(w,a) && sideOf(w,a) !== w.one)) continue;
      cut(w,w.wallHeight);
    }
    const stations = [...cuts.keys()].sort((x,y) => x-y);
    for (let j = 1; j < stations.length; j++) {
      const from = stations[j-1], mid = (from + stations[j])/2;
      const ground = ctx.ground({x:a.x+dx*mid, y:a.y+dy*mid});
      profile.push({run:run+ft*from, ground, wall:cuts.get(from)!});
    }
    wallAtJoin = cuts.get(1)!;
    if (flyer === null) rough += roughDistance(grid,a,b,ctx.rough);
    run += ft;
  }
  if (!profile.length) return {ft:0, note:''};
  let height = ctx.ground(path[0]), ascent = 0, descent = 0;
  const air: AirPoint[] = [];
  if (flyer !== null) air.push({run:0,z:Math.max(flyer,height)});
  profile.push({run, ground:ctx.ground(path[path.length-1]), wall:wallAtJoin});
  for (const [i, station] of profile.entries()) {
    const low = Math.min(height,station.ground), high = Math.max(height,station.ground);
    const summit = Math.max(high,low+station.wall);
    if (flyer !== null) {
      air.push({run:station.run,z:Math.max(flyer,summit)});
    } else {
      ascent += Math.max(0, station.ground-height);
      descent += Math.max(0, height-station.ground);
      // Count each exposed face of a drawn wall, or one face if the move starts or ends on it.
      if (i > 0) ascent += summit-high;
      if (i < profile.length-1) descent += summit-high;
    }
    height = station.ground;
  }
  if (flyer !== null) {
    air.push({run,z:Math.max(flyer,height)});
    return {ft:rounded(airDistance(air)),note:''};
  }
  const normal = rounded(flat+rough), climbing = rounded(ascent+descent);
  const directions = ascent && descent ? ` (${rounded(ascent)} ft up, ${rounded(descent)} ft down)` : '';
  const note = climbing ? `${normal} ft normal + ${climbing} ft climbing${directions}` : rough ? `difficult ground +${rounded(rough)} ft` : '';
  return {ft:rounded(normal+climbing),note};
}
