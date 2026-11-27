// Walls: lines you draw on the map that block what a token can see, where it can walk, and where a spell can spread.
//
// A wall is a straight segment. Doors and windows are walls that can be opened (both start shut). A shut window can be seen and cast through
// but not walked through; an open one can be walked through too.
// Every wall can also be left undrawn for the players ("invisible"); it still does its job. A wall can be ONE-WAY (a cliff edge: it
// stops what is on one side of it and lets what is on the other side through) and can have a HEIGHT (what is higher than the top of it
// sees and moves over it). All geometry here is plain numbers, so it can be tested without a browser.

import type { GridSettings, Vec } from '../types';
import { hexEdgeMid, isHex } from './hex';
import { snapToCorner } from './geometry';
import { terrainSight } from './terrainSight';

export type WallKind = 'wall' | 'door' | 'window';
/** 0 is a wall that stops both sides. 1 or -1 stops only what stands on that side of the line (see `sideOf`). */
export type Side = 0 | 1 | -1;

export interface Wall {
  /** Stored cut along a terrain contour; shared by rendering, movement and exploration. */
  gap?: true;
  /** Effective terrain face, generated from the painted ground. */
  face?: import('./terrainEdges').TerrainEdge;
  id: string;
  a: Vec;
  b: Vec;
  k: WallKind;
  /** doors and windows only: standing open (a plain wall never opens) */
  open: boolean;
  /** drawn for the players too (the DM always sees every wall) */
  vis: boolean;
  /** one-way: stops only what is on this side of it (0: both sides) */
  one: Side;
  /** how tall it is in feet, measured from the ground it stands on (0: too tall for anything to pass over) */
  h: number;
}

export interface Seg {
  passage?: boolean;
  /** Painted terrain carries the scale used to measure how far its near face can be seen. */
  terrainPxPerFt?: number;
  low?: number;
  climbable?: boolean;
  /** Height above the local ground for an authored wall. Cliffs carry only an absolute top. */
  wallHeight?: number;
  a: Vec;
  b: Vec;
  /** one-way: stops only what is on this side */
  one?: Side;
  /** how high its top is above the map's base level; whatever is higher than this sees and moves over it (undefined: no limit) */
  top?: number;
}

export const WALL_KINDS: WallKind[] = ['wall', 'door', 'window'];
export const WALL_NAME: Record<WallKind, string> = { wall: 'Wall', door: 'Door', window: 'Window' };
/** Players see doors and windows by default, but not plain walls: the map picture already shows those. */
export const wallVisDefault = (k: WallKind): boolean => k !== 'wall';

/** Doors and windows are the kinds that open and close. */
export const canOpen = (w: Pick<Wall, 'k'>): boolean => w.k !== 'wall';
/** A wall (or a closed door) stops anyone seeing past it. A window never does, open or shut. */
export const blocksSight = (w: Pick<Wall, 'k' | 'open'>): boolean => w.k === 'wall' || (w.k === 'door' && !w.open);
/** Walls, shut windows and closed doors stop anyone walking through. */
export const blocksMove = (w: Pick<Wall, 'k' | 'open'>): boolean => w.k === 'wall' || !w.open;
/** Spells spread through windows and open doors but not through a wall or a closed door. */
export const blocksSpell = blocksSight;

const KIND_CODE: Record<WallKind, string> = { wall: 'w', door: 'd', window: 'n' };
const CODE_KIND: Record<string, WallKind> = { w: 'wall', d: 'door', n: 'window' };

const r1 = (n: number) => Math.round(n * 10) / 10;

export function wallToWire(w: Pick<Wall, 'a' | 'b' | 'k' | 'open' | 'vis'> & Partial<Pick<Wall, 'one' | 'h' | 'gap' | 'face'>>): Record<string, unknown> {
  return {
    p: [w.a.x,w.a.y,w.b.x,w.b.y].map(n=>w.gap || w.face ? n : r1(n)).join(','),
    ...(w.gap ? {gap:1} : {}),
    ...(w.face ? {face:[w.face.low,w.face.one,w.face.terrainPxPerFt]} : {}),
    k: KIND_CODE[w.k],
    ...(w.k !== 'wall' && w.open ? { o: 1 } : {}),
    ...(w.vis ? { v: 1 } : {}),
    ...(w.one ? { s: w.one } : {}),
    ...(w.h && w.h > 0 ? { h: w.face ? w.h : Math.round(w.h) } : {}),
  };
}

export function normalizeWall(id: string, raw: any): Wall | null {
  if (!raw || typeof raw.p !== 'string') return null;
  const n = raw.p.split(',').map(Number);
  if (n.length < 4 || n.slice(0, 4).some((v: number) => !Number.isFinite(v))) return null;
  const k = CODE_KIND[raw.k as string] ?? 'wall';
  const one: Side = raw.s === 1 ? 1 : raw.s === -1 ? -1 : 0;
  const h = Number(raw.h);
  const a={x:n[0],y:n[1]}, b={x:n[2],y:n[3]};
  const f=raw.face;
  const face = k==='wall' && h>0 && Array.isArray(f) && Number.isFinite(f[0]) && (f[1]===1 || f[1]===-1) && Number.isFinite(f[2]) && f[2]>0
    ? {a,b,low:f[0],top:f[0]+h,one:f[1] as 1|-1,terrainPxPerFt:f[2]} : undefined;
  return { id, ...(face ? {face} : {}), ...(raw.gap === 1 ? {gap:true as const} : {}), a, b, k, open: k !== 'wall' && !!raw.o, vis: !!raw.v, one, h: Number.isFinite(h) && h > 0 ? (face ? h : Math.min(1000, Math.round(h))) : 0 };
}

/** The pieces of wall that block something, with what it takes to get past each. `topOf` says how high a wall's top is (feet above the map's base). */
export const segsOf = (walls: Iterable<Wall>, blocks: (w: Wall) => boolean, topOf?: (w: Wall) => number): Seg[] => {
  const out: Seg[] = [];
  for (const w of walls) {
    if (!blocks(w)) continue;
    const s: Seg = { a: w.a, b: w.b };
    if (w.one) s.one = w.one;
    if (w.h > 0 && topOf) { s.top = topOf(w); s.wallHeight = w.h; }
    if (w.h > 0 && w.k === 'wall') s.climbable = true;
    out.push(s);
  }
  return out;
};
export const sightSegs = (walls: Iterable<Wall>, topOf?: (w: Wall) => number): Seg[] => segsOf(walls, blocksSight, topOf);
export const moveSegs = (walls: Iterable<Wall>, topOf?: (w: Wall) => number): Seg[] => segsOf(walls, blocksMove, topOf);

/** Which side of a wall's line a point is on: 1 where the wall's "right" is (turning clockwise on the screen from a toward b), -1 the other side, 0 right on it. */
export function sideOf(s: Pick<Seg, 'a' | 'b'>, p: Vec): Side {
  const c = cross(s.b.x - s.a.x, s.b.y - s.a.y, p.x - s.a.x, p.y - s.a.y);
  return c > 1e-9 ? 1 : c < -1e-9 ? -1 : 0;
}

/** The pieces that really stop something standing at `o`, `alt` feet up: a one-way wall only stops it from its blocking side, and a wall lower than `alt` does not stop it at all. */
export function segsFrom(segs: Seg[], o: Vec, alt?: number): Seg[] {
  let special = false;
  for (const s of segs) if (s.one || s.top !== undefined) { special = true; break; }
  if (!special) return segs;
  return segs.filter((s) => {
    if (s.top !== undefined && alt !== undefined && alt > s.top) return false;
    if (s.one) { const side = sideOf(s, o); if (side !== 0 && side !== s.one) return false; }
    return true;
  });
}

export const wallMid = (w: Pick<Wall, 'a' | 'b'>): Vec => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
export const wallLength = (w: Pick<Wall, 'a' | 'b'>): number => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

// ------------------------------------------------------------------ geometry
function cross(ax: number, ay: number, bx: number, by: number): number { return ax * by - ay * bx; }

/** How far along a ray (in steps of its direction) it meets a segment, or Infinity. Hits right at the start are ignored. */
export function rayHit(o: Vec, dx: number, dy: number, s: Seg): number {
  const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y;
  const den = cross(dx, dy, ex, ey);
  if (Math.abs(den) < 1e-12) return Infinity;
  const ax = s.a.x - o.x, ay = s.a.y - o.y;
  const t = cross(ax, ay, ex, ey) / den;
  const u = cross(ax, ay, dx, dy) / den;
  return t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

export function distToSeg(p: Vec, s: Seg): number {
  const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y;
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - s.a.x) * ex + (p.y - s.a.y) * ey) / l2)) : 0;
  return Math.hypot(p.x - (s.a.x + ex * t), p.y - (s.a.y + ey * t));
}

/** The point on a segment nearest to p. */
export function nearestOnSeg(p: Vec, s: Seg): Vec {
  const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y;
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - s.a.x) * ex + (p.y - s.a.y) * ey) / l2)) : 0;
  return { x: s.a.x + ex * t, y: s.a.y + ey * t };
}

/**
 * How far along from→to (0 to 1) the first of the segments is crossed, or null if none is.
 * Touching a wall's end counts, so nobody squeezes through where two walls meet.
 */
export function firstCrossing(from: Vec, to: Vec, segs: Seg[], alt?: number): number | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  let best = Infinity;
  for (const s of segsFrom(segs, from, alt)) {
    const t = rayHit(from, dx, dy, s);
    if (t <= 1 && t < best) best = t;
  }
  return best === Infinity ? null : best;
}

export const pathBlocked = (from: Vec, to: Vec, segs: Seg[], alt?: number): boolean => firstCrossing(from, to, segs, alt) !== null;

/** Can something at `a` (`alt` feet up) see (or, for a spell, reach) `b` in a straight line? */
export const lineOfSight = (a: Vec, b: Vec, segs: Seg[], alt?: number): boolean => !pathBlocked(a, b, segs, alt);

/** The end of a move from→to that stops short of the first wall in the way, `gap` pixels before it. */
export function clampMove(from: Vec, to: Vec, segs: Seg[], gap: number, alt?: number): Vec {
  const t = firstCrossing(from, to, segs, alt);
  if (t === null) return to;
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const f = len > 0 ? Math.max(0, t - gap / len) : 0;
  return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
}

export interface Visibility {
  /** the outline of what can be seen, in order around the viewer */
  poly: Vec[];
  /** Higher faces that rise back into view beyond a hidden stretch of ground. */
  faces: Vec[][];
  /** nothing was in the way: it is a plain circle */
  free: boolean;
}

/** Close angular gaps in the combined shadow at each distance. Neighbours still in
 * the ring when a ray is removed reach at least as far as that ray. */
export function closeNarrowShadows(angles: number[], reach: number[]): void {
  const n = reach.length;
  const order = reach.map((_, i) => i).sort((a, b) => reach[a] - reach[b]);
  const prev = order.map((_, i) => (i + n - 1) % n);
  const next = order.map((_, i) => (i + 1) % n);
  for (const i of order) {
    next[prev[i]] = next[i];
    prev[next[i]] = prev[i];
  }
  for (let k = n - 2; k >= 0; k--) {
    const i = order[k], left = prev[i], right = next[i];
    if (left === right) continue;
    let span = angles[right] - angles[left];
    if (span < 0) span += 2 * Math.PI;
    if (span < Math.PI / 18) reach[i] = Math.min(reach[left], reach[right]);
  }
}

function nearSightEdges(o: Vec, r: number, segs: Seg[], alt?: number) {
  const near: { seg: Seg; inset: number; groundAfter?: number }[] = [];
  for (const seg of segs) {
    if (distToSeg(o, seg) >= r) continue;
    const side = seg.one ? sideOf(seg, o) : 0;
    const back = side !== 0 && side !== seg.one;
    let inset = 0;
    let groundAfter: number | undefined;
    if (seg.terrainPxPerFt !== undefined && seg.top !== undefined) {
      const rise = seg.top - (alt ?? 0);
      if (seg.one && seg.low !== undefined && seg.low < seg.top) groundAfter = back ? seg.low : seg.top;
      if (rise <= 0 && groundAfter === undefined) continue;
      // Show a strip of the near face. Its far edge, and any wall in front, still stop the ray.
      if (!back && rise > 0) inset = seg.terrainPxPerFt * 10 / (1 + rise / 10);
    } else if (back || (alt !== undefined && seg.top !== undefined && alt >= seg.top)) continue;
    near.push({seg, inset, groundAfter});
  }
  return near;
}

/**
 * What a viewer at `o` can see out to distance `r`: a ring around them, cut back wherever a wall gets in the way.
 * Rays are cast at both sides of every wall end in range (so the outline hugs corners exactly) and at regular steps (so open ground stays round).
 */
export function visibilityPolygon(o: Vec, r: number, segs: Seg[], steps = 64, alt?: number): Visibility {
  const near = nearSightEdges(o,r,segs,alt);
  const ring = (n: number): Vec[] => Array.from({ length: n }, (_, i) => ({ x: o.x + Math.cos((i / n) * Math.PI * 2) * r, y: o.y + Math.sin((i / n) * Math.PI * 2) * r }));
  if (!near.length) return { poly: ring(steps), faces: [], free: true };
  if (near.some(n => n.seg.terrainPxPerFt !== undefined)) {
    return terrainSight(o,r,near,alt ?? 0,steps,segs,(p,range) => nearSightEdges(p,range,segs,alt));
  }
  const angles: number[] = [];
  for (let i = 0; i < steps; i++) angles.push((i / steps) * Math.PI * 2 - Math.PI);
  const EPS = 1e-4;
  for (const {seg} of near) for (const p of [seg.a, seg.b]) {
    if (Math.hypot(p.x - o.x, p.y - o.y) > r * 1.001) continue;
    const a = Math.atan2(p.y - o.y, p.x - o.x);
    for (const angle of [a-EPS, a, a+EPS]) angles.push(angle >= Math.PI ? angle-2*Math.PI : angle < -Math.PI ? angle+2*Math.PI : angle);
  }
  angles.sort((a, b) => a - b);
  const bearings = angles.filter((a, i) => !i || a - angles[i-1] >= 1e-7);
  const directions = bearings.map(a => ({x: Math.cos(a), y: Math.sin(a)}));
  const reach = directions.map(({x,y}) => {
    let d = r;
    for (const {seg} of near) d = Math.min(d,rayHit(o,x,y,seg));
    return d;
  });
  closeNarrowShadows(bearings,reach);
  if (reach.every(d => d === r)) return {poly:ring(steps),faces:[],free:true};
  return {poly:directions.map((v,i) => ({x:o.x+v.x*reach[i],y:o.y+v.y*reach[i]})), faces:[], free:false};
}

/** Drop points that do not change the outline by more than `tol` pixels (Douglas-Peucker, around the closed shape). */
export function simplifyPoly(poly: Vec[], tol = 0.5): Vec[] {
  if (poly.length < 5) return poly;
  // split the loop at the point farthest from the first, and simplify each half on its own
  let far = 1, fd = -1;
  for (let i = 1; i < poly.length; i++) { const d = Math.hypot(poly[i].x - poly[0].x, poly[i].y - poly[0].y); if (d > fd) { fd = d; far = i; } }
  const keep = new Array<boolean>(poly.length).fill(false);
  keep[0] = keep[far] = true;
  const run = (lo: number, hi: number) => {
    // iterate over an explicit stack so long outlines cannot overflow the call stack
    const stack: [number, number][] = [[lo, hi]];
    while (stack.length) {
      const [i0, i1] = stack.pop()!;
      let worst = -1, wd = tol;
      for (let i = i0 + 1; i < i1; i++) { const d = distToSeg(poly[i], { a: poly[i0], b: poly[i1 % poly.length] }); if (d > wd) { wd = d; worst = i; } }
      if (worst >= 0) { keep[worst] = true; stack.push([i0, worst], [worst, i1]); }
    }
  };
  run(0, far);
  run(far, poly.length);
  const out = poly.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : poly;
}

/** True when the point is inside the polygon. */
export function inPoly(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export type RevealShape = { t: 'line'; pts: Vec[]; w: number } | { t: 'poly'; pts: Vec[] };

/**
 * What a token reveals as it walks a route: with no wall anywhere near, one thick line (as before); otherwise
 * what it could see from a spot every `step` pixels along the way, so it does not reveal rooms it only walked past.
 */
export function routeReveal(route: Vec[], r: number, segs: Seg[], step: number, alt?: number | ((p: Vec) => number)): RevealShape[] {
  if (!route.length) return [];
  const samples: Vec[] = [route[0]];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) samples.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const vis = samples.map((s) => visibilityPolygon(s, r, segs, 64, typeof alt === 'function' ? alt(s) : alt));
  if (vis.every((v) => v.free)) return [{ t: 'line', pts: route, w: r * 2 }];
  return vis.flatMap(v => [v.poly,...v.faces].map(p => ({ t: 'poly' as const, pts: simplifyPoly(p, 0.75) })));
}

// ------------------------------------------------------------------ picking and snapping
/** The wall nearest to a point, if one is within `max` pixels. */
export function wallNear(walls: Iterable<Wall>, p: Vec, max: number): { wall: Wall; dist: number; at: Vec } | null {
  let best: { wall: Wall; dist: number; at: Vec } | null = null;
  for (const w of walls) {
    const d = distToSeg(p, w);
    if (d <= max && (!best || d < best.dist)) best = { wall: w, dist: d, at: nearestOnSeg(p, w) };
  }
  return best;
}

/** The wall end nearest to a point (within `max`), if any. */
export function endNear(walls: Iterable<Wall>, p: Vec, max: number): { wall: Wall; end: 'a' | 'b'; dist: number } | null {
  let best: { wall: Wall; end: 'a' | 'b'; dist: number } | null = null;
  for (const w of walls) for (const end of ['a', 'b'] as const) {
    const d = Math.hypot(w[end].x - p.x, w[end].y - p.y);
    if (d <= max && (!best || d < best.dist)) best = { wall: w, end, dist: d };
  }
  return best;
}

export type WallSnap = 'corner' | 'half' | 'off';

/**
 * Where a wall point goes: onto the end of a wall that is already there (so rooms close up), else onto the grid.
 * 'corner' snaps to grid intersections, 'half' also to the middle of each side.
 */
export function snapWallPoint(grid: GridSettings, p: Vec, ends: Vec[], mode: WallSnap, magnet: number): Vec {
  let best: Vec | null = null, bd = magnet;
  for (const e of ends) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d <= bd) { bd = d; best = e; } }
  if (best) return best;
  if (mode === 'off') return p;
  const corner = snapToCorner(grid, p);
  if (mode === 'corner') return corner;
  if (isHex(grid)) {
    const mid = hexEdgeMid(grid, p);
    return Math.hypot(mid.x - p.x, mid.y - p.y) < Math.hypot(corner.x - p.x, corner.y - p.y) ? mid : corner;
  }
  const h = grid.cell / 2;
  return { x: Math.round((p.x - grid.ox) / h) * h + grid.ox, y: Math.round((p.y - grid.oy) / h) * h + grid.oy };
}

/** The four walls of a box. */
export const boxSegments = (a: Vec, b: Vec): { a: Vec; b: Vec }[] => {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return [
    { a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
  ];
};


/**
 * Cutting a gap for a door or a window: wherever `cut` runs along a plain wall, that wall is split and the covered part dropped,
 * so the door really stands in an opening instead of sitting on a wall that still blocks everything.
 * `tol` is how far off the line (in pixels) still counts as along it.
 */
export function carveWalls(walls: Iterable<Wall>, cut: Seg, tol: number): { remove: string[]; add: Omit<Wall, 'id'>[] } {
  const remove: string[] = [];
  const add: Omit<Wall, 'id'>[] = [];
  for (const w of walls) {
    if (w.k !== 'wall') continue;
    const len = wallLength(w);
    if (len < tol) continue;
    const ux = (w.b.x - w.a.x) / len, uy = (w.b.y - w.a.y) / len;
    const off = (p: Vec) => Math.abs((p.x - w.a.x) * uy - (p.y - w.a.y) * ux);
    if (off(cut.a) > tol || off(cut.b) > tol) continue;
    const along = (p: Vec) => (p.x - w.a.x) * ux + (p.y - w.a.y) * uy;
    let s0 = along(cut.a), s1 = along(cut.b);
    if (s0 > s1) [s0, s1] = [s1, s0];
    const c0 = Math.max(0, s0), c1 = Math.min(len, s1);
    if (c1 - c0 < tol) continue;
    remove.push(w.id);
    const at = (s: number): Vec => ({ x: w.a.x + ux * s, y: w.a.y + uy * s });
    if (c0 > tol) add.push(wallPiece(w,w.a,at(c0)));
    if (len - c1 > tol) add.push(wallPiece(w,at(c1),w.b));
  }
  return { remove, add };
}

/** The squares a template really reaches: the ones the point it starts from can see in a straight line (walls and closed doors stop it, unless they are lower than where it starts). */
export function reachableCells(cells: Vec[], from: Vec, sight: Seg[] | undefined, alt?: number): Vec[] {
  if (!sight?.length) return cells;
  // a template that starts on a wall is not held back by that wall; a one-way wall only holds it back from its blocking side,
  // and (given `alt`, how high up it starts) a wall lower than the start does not hold it back at all: it spreads over and down the far side
  const segs = segsFrom(sight, from, alt).filter((sg) => distToSeg(from, sg) > 0.75);
  if (!segs.length) return cells;
  return cells.filter((c) => Math.hypot(c.x - from.x, c.y - from.y) < 1 || lineOfSight(from, c, segs));
}

// ------------------------------------------------------------------ freeform shapes
/** Douglas-Peucker for an open line: drops the points that do not bend it by more than `tol` pixels. The ends always stay. */
export function simplifyPath(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let worst = -1, wd = tol;
    for (let i = i0 + 1; i < i1; i++) { const d = distToSeg(pts[i], { a: pts[i0], b: pts[i1] }); if (d > wd) { wd = d; worst = i; } }
    if (worst >= 0) { keep[worst] = true; stack.push([i0, worst], [worst, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** The corners of a round room: `n` points around a circle, going clockwise on the screen and starting at angle `start`. */
export function circlePoints(c: Vec, r: number, n: number, start = 0): Vec[] {
  return Array.from({ length: n }, (_, i) => ({ x: c.x + Math.cos(start + (i / n) * Math.PI * 2) * r, y: c.y + Math.sin(start + (i / n) * Math.PI * 2) * r }));
}

/** The walls that join a list of points one after another (`closed` also joins the last to the first). Points closer than `min` pixels to the one before are skipped. */
export function chainSegments(pts: Vec[], closed: boolean, min = 0): { a: Vec; b: Vec }[] {
  const keep: Vec[] = [];
  for (const p of pts) if (!keep.length || Math.hypot(p.x - keep[keep.length - 1].x, p.y - keep[keep.length - 1].y) > min) keep.push(p);
  const out: { a: Vec; b: Vec }[] = [];
  for (let i = 1; i < keep.length; i++) out.push({ a: keep[i - 1], b: keep[i] });
  if (closed && keep.length > 2) out.push({ a: keep[keep.length - 1], b: keep[0] });
  return out;
}

/**
 * Turn a hand-drawn stroke into corners: the stroke is simplified (more or less, by `tol`), its ends snap onto a nearby wall end or onto each other
 * (a stroke that comes back to where it started closes into a loop). Returns the corners and whether they close.
 */
export function freehandCorners(raw: Vec[], tol: number, magnet: number, ends: Vec[]): { pts: Vec[]; closed: boolean } {
  if (raw.length < 2) return { pts: raw.slice(), closed: false };
  let pts = simplifyPath(raw, tol);
  const near = (p: Vec): Vec | null => { let best: Vec | null = null, bd = magnet; for (const e of ends) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d <= bd) { bd = d; best = e; } } return best; };
  const first = pts[0], last = pts[pts.length - 1];
  const closed = pts.length >= 4 && Math.hypot(last.x - first.x, last.y - first.y) <= magnet * 1.5;
  if (closed) {
    pts = pts.slice(0, -1);
    const s = near(pts[0]);
    if (s) pts[0] = s;
  } else {
    const a = near(first), b = near(last);
    if (a) pts[0] = a;
    if (b) pts[pts.length - 1] = b;
  }
  return { pts, closed };
}

// ------------------------------------------------------------------ one-way marks
/**
 * The little ticks drawn along the blocking side of a one-way wall (like the hatching on a cliff edge): each is a segment
 * starting on the wall and running `len` pixels out to the side that is stopped.
 */
export function hatchTicks(a: Vec, b: Vec, side: Side, spacing: number, len: number): Seg[] {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!side || L < 1) return [];
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  const nx = -uy * side, ny = ux * side; // the blocked side
  const n = Math.max(1, Math.round(L / spacing));
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * L;
    const p = { x: a.x + ux * t, y: a.y + uy * t };
    out.push({ a: p, b: { x: p.x + nx * len, y: p.y + ny * len } });
  }
  return out;
}

/** Is `p` on the blocked side of a one-way wall (or is the wall two-way, which has no free side)? */
export const onBlockedSide = (w: Pick<Wall, 'a' | 'b' | 'one'>, p: Vec): boolean => !w.one || sideOf(w, p) === w.one || sideOf(w, p) === 0;

// ------------------------------------------------------------------ splitting and joining
function wallPiece(w: Wall, a:Vec, b:Vec): Omit<Wall,'id'> {
  return {a,b,k:w.k,open:w.open,vis:w.vis,one:w.one,h:w.h,...(w.face ? {face:{...w.face,a,b}} : {})};
}

/** The two walls a wall becomes when it gets a corner at `at` (a point on it). */
export function splitPieces(w: Wall, at: Vec): [Omit<Wall, 'id'>, Omit<Wall, 'id'>] {
  return [wallPiece(w,w.a,at),wallPiece(w,at,w.b)];
}

/**
 * Take the corner out where exactly two walls meet at `at`: they become one wall between their far ends.
 * Returns null when it is not exactly two walls of the same kind (and, for one-way walls, the same blocked side).
 */
export function joinAt(walls: Iterable<Wall>, at: Vec, tol: number): { remove: [string, string]; add: Omit<Wall, 'id'> } | null {
  const here: { w: Wall; end: 'a' | 'b' }[] = [];
  for (const w of walls) {
    for (const end of ['a', 'b'] as const) if (Math.hypot(w[end].x - at.x, w[end].y - at.y) <= tol) here.push({ w, end });
  }
  if (here.length !== 2 || here[0].w.id === here[1].w.id) return null;
  const [p, q] = here;
  if (p.w.k !== q.w.k || p.w.vis !== q.w.vis || p.w.h !== q.w.h || p.w.open !== q.w.open) return null;
  const far = (x: { w: Wall; end: 'a' | 'b' }) => (x.end === 'a' ? x.w.b : x.w.a);
  // the new wall runs from p's far end to q's far end; each old wall's blocked side is turned to match that direction
  const sideP: Side = p.w.one ? ((p.end === 'b' ? p.w.one : -p.w.one) as Side) : 0;
  const sideQ: Side = q.w.one ? ((q.end === 'a' ? q.w.one : -q.w.one) as Side) : 0;
  if (sideP !== sideQ) return null;
  return { remove: [p.w.id, q.w.id], add: { a: { ...far(p) }, b: { ...far(q) }, k: p.w.k, open: p.w.open, vis: p.w.vis, one: sideP, h: p.w.h } };
}
