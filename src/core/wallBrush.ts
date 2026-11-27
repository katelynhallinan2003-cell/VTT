import type { Vec } from '../types';
import type { TerrainEdge } from './terrainEdges';
import type { Seg, Wall } from './walls';

type Interval = [number, number];
const EPS = 1e-8;
const at = (s: Seg,t: number) => ({x:s.a.x+(s.b.x-s.a.x)*t,y:s.a.y+(s.b.y-s.a.y)*t});

/** Alternate the retained and erased intervals on a wall. Overlapping passes count once. */
function partition(s: Seg, ranges: Interval[]) {
  const kept: Pick<Seg,'a'|'b'>[] = [], cut: typeof kept = [];
  let t = 0;
  for (const [first,last] of ranges.sort((a,b)=>a[0]-b[0])) {
    const lo = Math.max(0,first), hi = Math.min(1,last);
    if (hi <= Math.max(t,lo)+EPS) continue;
    if (lo > t+EPS) kept.push({a:at(s,t),b:at(s,lo)});
    if (cut.length && lo <= t+EPS) cut[cut.length-1].b=at(s,hi);
    else cut.push({a:at(s,lo),b:at(s,hi)});
    t = hi;
  }
  if (t < 1-EPS) kept.push({a:at(s,t),b:s.b});
  return {kept,cut};
}

/** Intersect a wall with the swept round brush, including fast drags between pointer samples. */
export function brushWall(w: Seg, path: Vec[], radius: number) {
  const dx=w.b.x-w.a.x, dy=w.b.y-w.a.y, length=Math.hypot(dx,dy);
  const ranges: Interval[]=[];
  if (!length || !path.length) return partition(w,ranges);
  for (let i=0;i<path.length;i++) {
    const p=path[i], q=path[i-1] ?? p;
    if (Math.max(p.x,q.x)+radius<Math.min(w.a.x,w.b.x) || Math.min(p.x,q.x)-radius>Math.max(w.a.x,w.b.x) ||
        Math.max(p.y,q.y)+radius<Math.min(w.a.y,w.b.y) || Math.min(p.y,q.y)-radius>Math.max(w.a.y,w.b.y)) continue;
    const x=p.x-w.a.x, y=p.y-w.a.y;
    const center=(x*dx+y*dy)/(length*length), dist=(x*dy-y*dx)/length;
    if (Math.abs(dist)<radius) {
      const reach=Math.sqrt(radius*radius-dist*dist)/length;
      ranges.push([center-reach,center+reach]);
    }
    const len=Math.hypot(q.x-p.x,q.y-p.y);
    if (!len) continue;
    const ux=(q.x-p.x)/len, uy=(q.y-p.y)/len;
    let lo=0, hi=1;
    const slab=(start:number,delta:number,min:number,max:number) => {
      if (Math.abs(delta)<EPS) { if (start<min || start>max) hi=-1; return; }
      const a=(min-start)/delta, b=(max-start)/delta;
      lo=Math.max(lo,Math.min(a,b)); hi=Math.min(hi,Math.max(a,b));
    };
    slab(-x*ux-y*uy,dx*ux+dy*uy,0,len);
    slab(x*uy-y*ux,dy*ux-dx*uy,-radius,radius);
    if (hi>lo) ranges.push([lo,hi]);
  }
  return partition(w,ranges);
}

// Cuts follow the line even if repainting splits an adjacent contour into different segments.
function lineKey(s: Seg) {
  const dx=s.b.x-s.a.x, dy=s.b.y-s.a.y;
  const len=Math.hypot(dx,dy) * (dx<0 || (!dx && dy<0) ? -1 : 1);
  const ux=dx/len, uy=dy/len;
  return [Math.round(ux*1e7),Math.round(uy*1e7),Math.round((ux*s.a.y-uy*s.a.x)*1e5)].join(':');
}

export function resolveWalls(edges: TerrainEdge[], stored: Iterable<Wall>) {
  const walls=new Map<string,Wall>(), terrain:TerrainEdge[]=[], openings:Seg[]=[];
  const gaps=new Map<string,Seg[]>();
  for (const w of stored) {
    if (!w.gap) { walls.set(w.id,w); if (w.face) terrain.push(w.face); continue; }
    const key=lineKey(w);
    if (!gaps.has(key)) gaps.set(key,[]);
    gaps.get(key)!.push(w);
  }
  for (const edge of edges) {
    const collinear=gaps.get(lineKey(edge));
    let kept: Pick<Seg,'a'|'b'>[]=[edge];
    if (collinear) {
      const dx=edge.b.x-edge.a.x,dy=edge.b.y-edge.a.y;
      const along=(p:Vec)=>((p.x-edge.a.x)*dx+(p.y-edge.a.y)*dy)/(dx*dx+dy*dy);
      const slices=partition(edge,collinear.map(s=>{const a=along(s.a),b=along(s.b);return [Math.min(a,b),Math.max(a,b)];}));
      kept=slices.kept;
      for (const s of slices.cut) openings.push({...s,passage:true});
    }
    for (const s of kept) {
      const id='terrain:'+ [s.a.x,s.a.y,s.b.x,s.b.y].map(n=>Math.round(n*1e7)).join(':');
      const face={...edge,...s};
      terrain.push(face);
      walls.set(id,{id,...s,k:'wall',open:false,vis:false,h:edge.top-edge.low,one:0,face});
    }
  }
  return {walls,terrain,openings};
}

/**
 * Terrain walls come from the painted contours in short pieces (a new piece at every corner of the outline and every
 * half square along a slope). Join pieces that meet end to end into runs, broken where three or more meet or the
 * kind of step changes direction (a run is one cliff edge as the DM sees it). Returns each run's piece ids in order,
 * keyed by the id of its first piece; authored walls are runs of one.
 */
export function wallChains(walls: Iterable<Wall>): Map<string, string[]> {
  const list = [...walls];
  const key = (p: Vec) => `${Math.round(p.x * 64)},${Math.round(p.y * 64)}`;
  const at = new Map<string, Wall[]>();
  for (const w of list) {
    if (!w.face) continue;
    for (const p of [w.a, w.b]) { const k = key(p); const l = at.get(k); if (l) l.push(w); else at.set(k, [w]); }
  }
  const joins = (w: Wall, p: Vec): Wall | undefined => {
    const here = at.get(key(p));
    if (!here || here.length !== 2) return undefined;
    const other = here[0] === w ? here[1] : here[0];
    // A run keeps one side up: the higher ground stays on the same side as it goes on.
    const sameWay = (other.a === p || key(other.a) === key(p)) === (w.b === p || key(w.b) === key(p));
    return sameWay === (other.face!.one === w.face!.one) ? other : undefined;
  };
  const out = new Map<string, string[]>();
  const done = new Set<Wall>();
  for (const w of list) {
    if (done.has(w)) continue;
    if (!w.face) { out.set(w.id, [w.id]); done.add(w); continue; }
    // Walk back to the start of the run (or round a closed loop once), then forward.
    let first = w, end: Vec = w.a;
    for (let guard = 0; guard < list.length; guard++) {
      const prev = joins(first, end);
      if (!prev || prev === w || done.has(prev)) break;
      end = key(prev.a) === key(end) ? prev.b : prev.a;
      first = prev;
    }
    const run: string[] = [];
    let cur: Wall | undefined = first, from = end;
    while (cur && !done.has(cur)) {
      done.add(cur);
      run.push(cur.id);
      const next: Vec = key(cur.a) === key(from) ? cur.b : cur.a;
      cur = joins(cur, next);
      from = next;
    }
    out.set(run[0], run);
  }
  return out;
}
