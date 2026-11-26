// Walking on uneven ground: what it costs to go up a stair or through rough ground, and where a big drop is a cliff.
//
// - A STAIR is a step between two neighbouring squares whose ground differs by `stairFt` (5 ft) or less. It costs like a diagonal step,
//   whatever way the move runs, so what it costs follows the table's distance rule (5-10-5: every second one costs double; 5-5-5: no extra).
// - DIFFICULT GROUND costs one extra square for every square of it that is entered.
// - A CLIFF is the edge between two neighbouring squares whose ground differs by more than the cliff height (10 ft by default). It is a wall for
//   whatever is lower than the top of it (sight, walking and spells stop there) and nothing at all for what is on the high side.
// All plain numbers, so it can be tested without a browser.
import type { GridSettings, Vec } from '../types';
import { STAIR_FT, heightChangeNote } from './height';
import { currentOverlay } from './gridOverlay';
import { cellCentersIn, cellPoly } from './cells';
import { snapToCellCenter } from './geometry';
import { HEX_DIRS, hexAt, hexToPx, isHex } from './hex';
import { sideOf, type Seg } from './walls';

export { STAIR_FT };
/** Drops of more than this many feet are cliffs unless the scene says otherwise (0 turns cliffs off). */
export const DEFAULT_CLIFF_FT = 10;

export interface WalkCtx {
  /** how high the ground is at a point, in feet */
  ground: (p: Vec) => number;
  /** is the ground at a point difficult? */
  rough: (p: Vec) => boolean;
  /** Continuous elevation along a freehand route. */
  surface?: (p: Vec) => number;
  stairAt?: (from: Vec, to: Vec) => boolean;
}

export interface WalkExtra {
  /** feet to add to the plain distance */
  extraFt: number;
  /** squares of difficult ground entered */
  rough: number;
  /** stairs climbed or descended */
  stairs: number;
  stairRise: number;
  ledges: number[];
  straightStairs: number;
}

const key = (p: Vec) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;

/** The squares (or hexes) a straight move passes through, in order, the one it starts in first. */
export function cellsOnLine(grid: GridSettings, a: Vec, b: Vec): Vec[] {
  const first = snapToCellCenter(grid, a);
  const out: Vec[] = [first];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(L / (grid.cell * 0.25)));
  let last = key(first);
  for (let i = 1; i <= steps; i++) {
    const c = snapToCellCenter(grid, { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
    const k = key(c);
    if (k !== last) { out.push(c); last = k; }
  }
  return out;
}

/** What walking in a straight line from `a` to `b` costs beyond its plain distance, because of stairs and difficult ground. */
export function walkExtra(grid: GridSettings, a: Vec, b: Vec, ctx: WalkCtx, previousStraight = 0): WalkExtra {
  const ex: WalkExtra = { extraFt: 0, rough: 0, stairs: 0, stairRise: 0, ledges: [], straightStairs: 0 };
  const free = currentOverlay(grid) === 'none';
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return ex;
  const count = Math.min(4096, Math.ceil(length / (grid.cell / 8)));
  const points = free ? Array.from({ length: count + 1 }, (_, i) => ({
    x: a.x + (b.x - a.x) * i / count, y: a.y + (b.y - a.y) * i / count,
  })) : cellsOnLine(grid, a, b);
  const run = length / grid.cell * grid.ft / count;
  const surface = ctx.surface ?? ctx.ground;
  let prevRaw = ctx.ground(points[0]), prevSurface = free ? surface(points[0]) : prevRaw;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i];
    const raw = ctx.ground(q), z = free ? surface(q) : raw;
    const jump = raw - prevRaw;
    if (free) {
      if (ctx.rough({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })) ex.rough += run / grid.ft;
    } else if (ctx.rough(q)) ex.rough++;
    if (jump && (ctx.stairAt ? !ctx.stairAt(p,q) : Math.abs(jump) > STAIR_FT)) {
      ex.ledges.push(jump);
    } else {
      const rise = Math.abs(z - prevSurface);
      if (rise) {
        ex.stairs++;
        ex.stairRise += rise;
        if (free) ex.extraFt += Math.hypot(run, rise) - run;
        else if (!isHex(grid) && (Math.abs(q.x - p.x) < grid.cell * 0.5 || Math.abs(q.y - p.y) < grid.cell * 0.5)) {
          ex.straightStairs++;
          if (grid.rule === 'euclid') ex.extraFt += Math.hypot(grid.ft, rise) - grid.ft;
        }
      }
    }
    prevRaw = raw; prevSurface = z;
  }
  if (!free && grid.rule === 'alt') {
    ex.extraFt += (Math.floor((previousStraight + ex.straightStairs) / 2) - Math.floor(previousStraight / 2)) * grid.ft;
  }
  ex.extraFt += ex.rough * grid.ft;
  return ex;
}

/** Describe the terrain crossed, keeping a stair's elevation change separate from movement cost. */
export function walkNote(grid: GridSettings, ex: WalkExtra): string {
  const parts = ex.ledges.map(jump => heightChangeNote(0, jump));
  const stairs = Math.round(ex.stairRise * 10) / 10;
  if (stairs) parts.push(`${stairs} ft of stairs`);
  const rough = Math.round(ex.rough * grid.ft * 10) / 10;
  if (rough) parts.push(`difficult ground +${rough} ft`);
  return parts.join(', ');
}

// ------------------------------------------------------------------ cliffs
/** The two corners two neighbouring cells have in common (their shared edge), or null. */
function sharedEdge(grid: GridSettings, p: Vec, q: Vec): [Vec, Vec] | null {
  const a = cellPoly(grid, p), b = cellPoly(grid, q);
  const tol = Math.max(0.5, grid.cell * 0.02);
  const common = a.filter((u) => b.some((v) => Math.hypot(u.x - v.x, u.y - v.y) <= tol));
  return common.length >= 2 ? [common[0], common[1]] : null;
}

/** The centres of the neighbours of a cell that sit "after" it, so every pair of neighbours is seen once. */
function laterNeighbours(grid: GridSettings, c: Vec): Vec[] {
  if (isHex(grid)) {
    const h = hexAt(grid, c);
    return [HEX_DIRS[0], HEX_DIRS[1], HEX_DIRS[2]].map(([dq, dr]) => hexToPx(grid, h.q + dq, h.r + dr));
  }
  return [{ x: c.x + grid.cell, y: c.y }, { x: c.x, y: c.y + grid.cell }];
}

/** Most squares looked at when working out where the cliffs are (a huge map with ground painted all over it stays quick). */
const MAX_CLIFF_CELLS = 60000;

/**
 * The edges between neighbouring cells whose ground differs by more than `cliffFt`. Each is a wall piece that only stops what is on the low side
 * and is lower than the top of the high side. `area` is where ground has been painted (nothing outside it can be a cliff).
 */
export function cliffSegs(grid: GridSettings, area: { x: number; y: number; w: number; h: number } | null, ground: (p: Vec) => number, cliffFt: number): Seg[] {
  if (!area || cliffFt <= 0 || area.w <= 0 || area.h <= 0) return [];
  const pad = grid.cell;
  const cells = cellCentersIn(grid, { x: area.x - pad, y: area.y - pad, w: area.w + pad * 2, h: area.h + pad * 2 });
  if (cells.length > MAX_CLIFF_CELLS) return [];
  const heights = new Map<string, number>();
  const at = (p: Vec) => { const k = key(p); let v = heights.get(k); if (v === undefined) { v = ground(p); heights.set(k, v); } return v; };
  const out: Seg[] = [];
  for (const c of cells) {
    const hc = at(c);
    for (const n of laterNeighbours(grid, c)) {
      const hn = at(n);
      if (Math.abs(hc - hn) <= Math.max(STAIR_FT, cliffFt)) continue;
      const edge = sharedEdge(grid, c, n);
      if (!edge) continue;
      const lowIsC = hc < hn;
      const side = sideOf({ a: edge[0], b: edge[1] }, lowIsC ? c : n);
      if (side === 0) continue;
      out.push({ a: edge[0], b: edge[1], one: side, top: Math.max(hc, hn) });
    }
  }
  return out;
}

/**
 * The squares of a ramp: from `a` (ground `from` ft) to `b` (ground `to` ft), `width` squares wide, in steps of `step` feet.
 * Returns one entry per height, each with the squares at that height, lowest first.
 */
export function rampCells(grid: GridSettings, a: Vec, b: Vec, from: number, to: number, width: number, step = 5): { h: number; cells: Vec[] }[] {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < grid.cell * 0.4) return [];
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  const half = (Math.max(1, width) * grid.cell) / 2;
  const eps = grid.cell * 0.02;
  const pad = half + grid.cell;
  const box = { x: Math.min(a.x, b.x) - pad, y: Math.min(a.y, b.y) - pad, w: Math.abs(b.x - a.x) + pad * 2, h: Math.abs(b.y - a.y) + pad * 2 };
  const q = Math.max(1, step);
  const byH = new Map<number, Vec[]>();
  for (const p of cellCentersIn(grid, box)) {
    const s = (p.x - a.x) * ux + (p.y - a.y) * uy; // how far along
    const d = Math.abs(-(p.x - a.x) * uy + (p.y - a.y) * ux); // how far to the side
    if (d > half + eps || s < -grid.cell / 2 - eps || s > L + grid.cell / 2 + eps) continue;
    const t = Math.max(0, Math.min(1, s / L));
    const h = Math.round((from + (to - from) * t) / q) * q;
    const list = byH.get(h);
    if (list) list.push(p); else byH.set(h, [p]);
  }
  return [...byH].sort((x, y) => x[0] - y[0]).map(([h, cells]) => ({ h, cells }));
}
