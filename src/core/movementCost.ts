import type { GridSettings, Vec } from '../types';
import { pathFt } from './geometry';
import { roughDistance, type WalkCtx } from './walk';
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
  edges: Seg[], walls: Seg[], stops: number[] = []) {
  const flightRuns: number[] | undefined = flyer === null && !ctx.slope ? undefined : [];
  const flat = pathFt(grid, path, [], flightRuns);
  if (path.length < 2) return {ft:0, note:''};
  let slopeExtra = 0;
  let rough = 0, run = 0, wallAtJoin = 0;
  // Each interval describes the surface actually traversed after its entry point.
  const profile: {run: number; ground: number; endGround?: number; endRun?: number; wall: number; passage?: boolean; landing?:boolean; solid?:boolean; slopeExtra?:number}[] = [];
  let passageAtJoin = false, solidAtJoin = false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i], dx = b.x-a.x, dy = b.y-a.y;
    const length = Math.hypot(dx,dy);
    if (!length) continue;
    const ft = flightRuns ? flightRuns[i-1] - run : length * grid.ft / grid.cell;
    const cuts = new Map<number, number>([[0,wallAtJoin],[1,0]]);
    const passages: Set<number> = new Set(passageAtJoin ? [0] : []);
    const solid: Set<number> = new Set<number>(solidAtJoin ? [0] : []);
    if (stops.includes(i-1)) profile.push({run,ground:ctx.ground(a),wall:0,landing:true});
    const cut = (edge: Seg, wall: number) => {
      const t = crossing(a,b,edge);
      if (t === null || t < -EPS || t > 1+EPS) return;
      const key = Math.max(0, Math.min(1, Math.round(t*1e9)/1e9));
      (edge.passage ? passages : solid).add(key);
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
      const at = (t: number) => ({x:a.x+dx*t,y:a.y+dy*t});
      const slope = ctx.slope?.(at(mid));
      if (!slope) {
        profile.push({run:run+ft*from,ground:ctx.ground(at(mid)),passage:passages.has(from) && !solid.has(from),solid:solid.has(from),wall:cuts.get(from)!});
        continue;
      }
      const span = stations[j]-from;
      const steps = Math.max(1,Math.ceil(length*span/(grid.cell/4)));
      let ground = slope(at(from));
      for (let k=0; k<steps; k++) {
        const t=from+span*(k+1)/steps, endGround=slope(at(t)), across=ft*span/steps;
        const extra=Math.hypot(across,endGround-ground)-across;
        const cost=extra * (flyer===null && ctx.rough(at(t-span/(2*steps))) ? 2 : 1);
        slopeExtra+=cost;
        profile.push({run:run+ft*(t-span/steps),ground,endGround,endRun:run+ft*t,slopeExtra:cost,passage:k===0 && passages.has(from) && !solid.has(from),solid:k===0 && solid.has(from),wall:k===0 ? cuts.get(from)! : 0});
        ground=endGround;
      }
    }
    wallAtJoin = cuts.get(1)!;
    passageAtJoin=passages.has(1); solidAtJoin=solid.has(1);
    if (flyer === null) rough += roughDistance(grid,a,b,ctx.rough);
    run += ft;
  }
  if (!profile.length) return {ft:0, note:''};
  let height = ctx.ground(path[0]), ascent = 0, descent = 0;
  const air: AirPoint[] = [];
  if (flyer !== null) air.push({run:0,z:Math.max(flyer,height)});
  profile.push({run, ground:ctx.ground(path[path.length-1]), wall:wallAtJoin,passage:passageAtJoin && !solidAtJoin});
  // Within a run of open faces, a raised deck can be passed underneath. Pin the
  // ground at both ends, at deliberate stops, and on both sides of an intact face.
  if (profile.some(s=>s.passage)) {
    // A sloping deck also has an underside. Between two open faces at the same
    // floor level its surface samples do not add ramp distance to the walk below.
    let entered=-1, floor=height;
    for (let i=0;i<profile.length;i++) {
      const step=profile[i], before=i ? profile[i-1].endGround ?? profile[i-1].ground : height;
      if (step.landing || step.solid) entered=-1;
      if (!step.passage) continue;
      if (entered>=0 && Math.abs(step.ground-floor)<EPS && before>floor+EPS) {
        const deck=profile.slice(entered,i);
        if (deck.some(s=>s.endGround!==undefined) && deck.every(s=>Math.min(s.ground,s.endGround ?? s.ground)>=floor-EPS)) {
          for (const s of deck) { slopeExtra-=s.slopeExtra ?? 0; s.ground=floor; s.endGround=undefined; s.endRun=undefined; }
        }
      }
      entered=step.ground>before+EPS ? i : -1;
      floor=before;
    }
    const levels=[{run:0,ground:height,wall:0},...profile];
    let first=0;
    for (let i=1;i<=levels.length;i++) {
      const s=levels[i], prev=levels[i-1];
      if (s && !s.landing && !prev.landing && s.endGround===undefined && prev.endGround===undefined &&
          (s.passage || Math.abs(prev.ground-s.ground)<EPS)) continue;
      let floor=levels[first].ground;
      const fromLeft:number[]=[];
      for (let j=first;j<i;j++) { floor=Math.min(floor,levels[j].ground); fromLeft.push(floor); }
      floor=levels[i-1].ground;
      for (let j=i-1;j>=first;j--) {
        floor=Math.min(floor,levels[j].ground);
        levels[j].ground=Math.max(floor,fromLeft[j-first]);
      }
      first=i;
    }
  }
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
    height = station.endGround ?? station.ground;
    if (flyer !== null && station.endRun !== undefined) air.push({run:station.endRun,z:Math.max(flyer,height)});
  }
  if (flyer !== null) {
    air.push({run,z:Math.max(flyer,height)});
    return {ft:rounded(airDistance(air)),note:''};
  }
  const normal = rounded(flat+rough+slopeExtra), climbing = rounded(ascent+descent);
  const directions = ascent && descent ? ` (${Math.round(ascent)} ft up, ${Math.round(descent)} ft down)` : '';
  const note = climbing ? `${Math.round(normal)} ft normal + ${Math.round(climbing)} ft climbing${directions}` : rough ? `difficult terrain +${Math.round(rough)} ft` : '';
  return {ft:rounded(normal+climbing),note};
}
