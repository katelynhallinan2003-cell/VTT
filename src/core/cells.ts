// Which grid cells an area covers, and what a cell looks like. Spell templates use this to light up the squares they affect.
// Everything that depends on the shape of the grid lives here, so a hex grid only has to change this file.
import type { DrawKind, GridSettings, Rect, Vec } from '../types';
import { boundsOf, distToSegment, pointInPoly, templateGeom } from './draw';

/** Centres of every cell whose centre lies inside `r`. */
export function cellCentersIn(grid: GridSettings, r: Rect): Vec[] {
  const c = grid.cell;
  const out: Vec[] = [];
  const i0 = Math.floor((r.x - grid.ox) / c) - 1, i1 = Math.ceil((r.x + r.w - grid.ox) / c) + 1;
  const j0 = Math.floor((r.y - grid.oy) / c) - 1, j1 = Math.ceil((r.y + r.h - grid.oy) / c) + 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const p = { x: grid.ox + (i + 0.5) * c, y: grid.oy + (j + 0.5) * c };
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) out.push(p);
    }
  }
  return out;
}

/** The corners of the cell centred at `c`. */
export function cellPoly(grid: GridSettings, c: Vec): Vec[] {
  const h = grid.cell / 2;
  return [{ x: c.x - h, y: c.y - h }, { x: c.x + h, y: c.y - h }, { x: c.x + h, y: c.y + h }, { x: c.x - h, y: c.y + h }];
}

/** Most cells a single template may light up (so a huge, mistaken drag never freezes the board). */
export const MAX_COVERED = 2500;

/**
 * Centres of the cells a template covers: a cell counts when its middle is inside the area.
 * An emanation leaves out the square it comes out of.
 */
export function coveredCells(grid: GridSettings, kind: DrawKind, a: Vec, b: Vec, widthPx: number): Vec[] {
  const g = templateGeom(kind, a, b, widthPx);
  const bounds = g.type === 'circle' ? { x: g.c.x - g.r, y: g.c.y - g.r, w: g.r * 2, h: g.r * 2 } : boundsOf(g.pts);
  const eps = 0.5;
  const out: Vec[] = [];
  for (const p of cellCentersIn(grid, bounds)) {
    let inside: boolean;
    if (g.type === 'circle') inside = Math.hypot(p.x - g.c.x, p.y - g.c.y) <= g.r + eps;
    else inside = pointInPoly(p, g.pts) || g.pts.some((q, i) => distToSegment(p, q, g.pts[(i + 1) % g.pts.length]) < eps);
    if (!inside) continue;
    if (kind === 'emanation' && Math.hypot(p.x - a.x, p.y - a.y) < grid.cell * 0.25) continue;
    out.push(p);
    if (out.length >= MAX_COVERED) break;
  }
  return out;
}
