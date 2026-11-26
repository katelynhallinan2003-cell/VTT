import type { GridSettings, Vec } from '../types';
import { currentOverlay } from './gridOverlay';
import { snapToCellCenter } from './geometry';

export interface WalkCtx {
  ground: (p: Vec) => number;
  rough: (p: Vec) => boolean;
  slope?: (p: Vec) => ((at: Vec) => number) | undefined;
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
