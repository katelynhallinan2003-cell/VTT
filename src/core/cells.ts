// Which grid cells an area covers, and what a cell looks like. Spell templates use this to light up the squares they affect.
// Everything that depends on the shape of the grid lives here, so a hex grid only has to change this file.
import type { DrawKind, GridSettings, Rect, Vec } from '../types';
import { boundsOf, distToSegment, footprintPoly, pointInPoly, templateGeom } from './draw';
import { hexCentersIn, hexCorners, isHex } from './hex';

/** Centres of every cell whose centre lies inside `r`. */
export function cellCentersIn(grid: GridSettings, r: Rect): Vec[] {
  if (isHex(grid)) return hexCentersIn(grid, r);
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
  if (isHex(grid)) return hexCorners(grid, c);
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
  const hexShape = isHex(grid) ? (grid.shape as 'pointy' | 'flat') : undefined;
  const g = templateGeom(kind, a, b, widthPx, hexShape);
  // a cell whose middle sits right on the edge counts, and stays counted however the pointer wobbles
  const eps = Math.max(0.5, grid.cell * 0.02);
  // the box that is searched is padded by the same amount: without it a cell exactly on the edge (a 20 ft sphere's four end squares) is
  // dropped or kept by a rounding error that depends on which way the pointer points, which showed up as squares flickering
  const raw = g.type === 'circle' ? { x: g.c.x - g.r, y: g.c.y - g.r, w: g.r * 2, h: g.r * 2 } : boundsOf(g.pts);
  const bounds = { x: raw.x - eps, y: raw.y - eps, w: raw.w + eps * 2, h: raw.h + eps * 2 };
  const own = kind === 'emanation' ? footprintPoly(a, Math.max(widthPx, grid.cell), hexShape) : null;
  const out: Vec[] = [];
  for (const p of cellCentersIn(grid, bounds)) {
    let inside: boolean;
    if (g.type === 'circle') inside = Math.hypot(p.x - g.c.x, p.y - g.c.y) <= g.r + eps;
    else inside = pointInPoly(p, g.pts) || g.pts.some((q, i) => distToSegment(p, q, g.pts[(i + 1) % g.pts.length]) < eps);
    if (!inside) continue;
    // an emanation leaves out the space it comes out of
    if (own && pointInPoly(p, own)) continue;
    out.push(p);
    if (out.length >= MAX_COVERED) break;
  }
  return out;
}

/**
 * The cells an aura on a token covers, centred on `centre` (where the token stands, `footprintPx` across).
 * Round auras are measured like a spell: a sphere from the middle, or an emanation from the edge of the token's space; square ones as a box.
 * The token's own space is always part of it.
 */
export function auraCells(grid: GridSettings, centre: Vec, footprintPx: number, a: { r: number; shape: 'circle' | 'square'; edge: boolean }): Vec[] {
  const hexShape = isHex(grid) ? (grid.shape as 'pointy' | 'flat') : undefined;
  const rpx = (a.r / grid.ft) * grid.cell;
  const fp = Math.max(grid.cell * 0.5, footprintPx);
  const eps = Math.max(0.5, grid.cell * 0.02);
  const own = footprintPoly(centre, Math.max(fp, grid.cell), hexShape);
  const ownBounds = boundsOf(own);
  const ownCells = cellCentersIn(grid, ownBounds).filter((p) => pointInPoly(p, own));
  let out: Vec[];
  if (a.shape === 'square') {
    const half = rpx + (a.edge ? fp / 2 : 0) + eps;
    out = cellCentersIn(grid, { x: centre.x - half, y: centre.y - half, w: half * 2, h: half * 2 });
  } else if (a.edge) {
    out = coveredCells(grid, 'emanation', centre, { x: centre.x + fp / 2 + rpx, y: centre.y }, Math.max(fp, grid.cell));
  } else {
    out = coveredCells(grid, 'sphere', centre, { x: centre.x + rpx, y: centre.y }, 0);
  }
  const seen = new Set(out.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
  for (const p of ownCells) if (!seen.has(`${Math.round(p.x)},${Math.round(p.y)}`)) out.push(p);
  return out;
}

/** The sides of these cells that face outside (the outline of the whole group). */
export function outlineEdges(grid: GridSettings, cells: Vec[]): [Vec, Vec][] {
  const seen = new Map<string, { a: Vec; b: Vec; n: number }>();
  const key = (p: Vec) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  for (const c of cells) {
    const poly = cellPoly(grid, c);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ka = key(a), kb = key(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = seen.get(k);
      if (e) e.n++; else seen.set(k, { a, b, n: 1 });
    }
  }
  const out: [Vec, Vec][] = [];
  for (const e of seen.values()) if (e.n === 1) out.push([e.a, e.b]);
  return out;
}
