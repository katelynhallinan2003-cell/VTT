import type { GridSettings, Vec } from '../types';
import { currentOverlay } from './gridOverlay';
import { cellCentersIn } from './cells';
import { snapToCellCenter } from './geometry';

export interface WalkCtx {
  ground: (p: Vec) => number;
  rough: (p: Vec) => boolean;
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

/** Extra feet spent crossing difficult ground on this leg. */
export function roughDistance(grid: GridSettings, a: Vec, b: Vec, rough: WalkCtx['rough']): number {
  if (currentOverlay(grid) !== 'none') return cellsOnLine(grid,a,b).slice(1).filter(rough).length * grid.ft;
  const length = Math.hypot(b.x-a.x,b.y-a.y);
  const count = Math.max(1,Math.min(4096,Math.ceil(length / (grid.cell / 8))));
  let inside = 0;
  for (let i = 0; i < count; i++) {
    const t = (i+0.5)/count;
    if (rough({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t})) inside++;
  }
  return inside/count * length/grid.cell * grid.ft;
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
