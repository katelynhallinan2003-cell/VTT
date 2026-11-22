// Walking on uneven ground: what it costs to go up a stair or through rough ground, and where a big drop is a cliff.
//
// - A STAIR is a step between two neighbouring squares whose ground differs by `stairFt` (5 ft) or less. It costs like a diagonal step,
//   whatever way the move runs, so what it costs follows the table's distance rule (5-10-5: every second one costs double; 5-5-5: no extra).
// - DIFFICULT GROUND costs one extra square for every square of it that is entered.
// - A CLIFF is the edge between two neighbouring squares whose ground differs by more than the cliff height (10 ft by default). It is a wall for
//   whatever is lower than the top of it (sight, walking and spells stop there) and nothing at all for what is on the high side.
// All plain numbers, so it can be tested without a browser.
import type { GridSettings, Vec } from '../types';
import { cellCentersIn, cellPoly } from './cells';
import { snapToCellCenter } from './geometry';
import { HEX_DIRS, hexAt, hexToPx, isHex } from './hex';
import { sideOf, type Seg } from './walls';

/** The biggest step that counts as a stair, in feet. */
export const STAIR_FT = 5;
/** Drops of more than this many feet are cliffs unless the scene says otherwise (0 turns cliffs off). */
export const DEFAULT_CLIFF_FT = 10;

export interface WalkCtx {
  /** how high the ground is at a point, in feet */
  ground: (p: Vec) => number;
  /** is the ground at a point difficult? */
  rough: (p: Vec) => boolean;
}

export interface WalkExtra {
  /** feet to add to the plain distance */
  extraFt: number;
  /** squares of difficult ground entered */
  rough: number;
  /** stairs climbed or descended */
  stairs: number;
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
export function walkExtra(grid: GridSettings, a: Vec, b: Vec, ctx: WalkCtx): WalkExtra {
  const cells = cellsOnLine(grid, a, b);
  let rough = 0;
  let stairs = 0;
  let straightStairs = 0;
  const hex = isHex(grid);
  for (let i = 1; i < cells.length; i++) {
    const p = cells[i - 1], q = cells[i];
    if (ctx.rough(q)) rough++;
    const rise = Math.abs(ctx.ground(q) - ctx.ground(p));
    if (rise > 0 && rise <= STAIR_FT) {
      stairs++;
      // a step that already runs diagonally is already paid for as one
      if (!hex && (Math.abs(q.x - p.x) < grid.cell * 0.5 || Math.abs(q.y - p.y) < grid.cell * 0.5)) straightStairs++;
    }
  }
  let stairSq = 0;
  if (!hex) {
    if (grid.rule === 'alt') stairSq = Math.floor(straightStairs / 2);
    else if (grid.rule === 'euclid') stairSq = straightStairs * (Math.SQRT2 - 1);
  }
  return { extraFt: Math.round((rough + stairSq) * grid.ft * 10) / 10, rough, stairs };
}

/** "difficult ground +10 ft" and so on, for the readout of a move, or '' when nothing was extra. */
export function walkNote(grid: GridSettings, ex: WalkExtra): string {
  const parts: string[] = [];
  const roughFt = ex.rough * grid.ft;
  if (roughFt) parts.push(`difficult ground +${roughFt} ft`);
  const stairFt = Math.round((ex.extraFt - roughFt) * 10) / 10;
  if (stairFt > 0) parts.push(`stairs +${stairFt} ft`);
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
      if (Math.abs(hc - hn) <= cliffFt) continue;
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
