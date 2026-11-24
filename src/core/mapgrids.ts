// A grid of its own for an added map or empty grid: its own square size, its own colour, switched on and off on its own.
//
// An added map that has nothing set just shows the scene's grid, like the main map. One that has any of the three set (squares, colour, on or off) draws its own
// grid inside its edges instead, with the first line on the map's top left corner, and the scene's grid is not drawn there.
// Everything else about a square (its length in feet, the way diagonals count, hex or square) stays the scene's.
import type { ExtraMap, GridSettings, Rect } from '../types';

/** Where an added map is on the board, in world pixels. */
export const extraRect = (m: Pick<ExtraMap, 'x' | 'y' | 'w' | 'h' | 'scale'>): Rect => ({ x: m.x, y: m.y, w: m.w * m.scale, h: m.h * m.scale });

type GridFields = Pick<ExtraMap, 'gs' | 'gv' | 'gc'>;

/** Does this map draw its own grid (rather than showing the scene's)? */
export const hasOwnGrid = (m: GridFields): boolean => m.gs != null || !!m.gc || m.gv != null;

/** The grid of one added map: the scene's, with this map's square size, colour and corner. Null when the map just shows the scene's grid. */
export function ownGrid(base: GridSettings, m: Pick<ExtraMap, 'x' | 'y' | 'gs' | 'gv' | 'gc'>): GridSettings | null {
  if (!hasOwnGrid(m)) return null;
  return { ...base, cell: m.gs != null && m.gs >= 4 ? m.gs : base.cell, ox: m.x, oy: m.y, color: m.gc || base.color, visible: m.gv ?? base.visible };
}

/** What one square measures on this map, in pixels. */
export const mapCell = (base: Pick<GridSettings, 'cell'>, m: Pick<ExtraMap, 'gs'>): number => (m.gs != null && m.gs >= 4 ? m.gs : base.cell);

const inside = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export interface MapGrid {
  id: string;
  rect: Rect;
  grid: GridSettings;
}

/** Every added map that has a grid of its own, in the order they were added (later ones lie on top). */
export function ownGrids(base: GridSettings, maps: readonly ExtraMap[]): MapGrid[] {
  const out: MapGrid[] = [];
  for (const m of maps) {
    const grid = ownGrid(base, m);
    if (grid) out.push({ id: m.id, rect: extraRect(m), grid });
  }
  return out;
}

/** The grid that counts at a spot: that of the added map lying there when it has one of its own, else the scene's. The same object when nothing has one. */
export function gridAtPoint(base: GridSettings, own: readonly MapGrid[], p: { x: number; y: number }): GridSettings {
  for (let i = own.length - 1; i >= 0; i--) if (inside(own[i].rect, p)) return own[i].grid;
  return base;
}

/** The pieces of the line from `from` to `to` that are left once the `holes` (across the line, at `at`) are taken out. */
export function cutLine(from: number, to: number, holes: readonly [number, number][]): [number, number][] {
  let pieces: [number, number][] = [[from, to]];
  for (const [a, b] of holes) {
    const next: [number, number][] = [];
    for (const [s, e] of pieces) {
      if (b <= s || a >= e) { next.push([s, e]); continue; }
      if (a > s) next.push([s, a]);
      if (b < e) next.push([b, e]);
    }
    pieces = next;
  }
  return pieces;
}

export interface LinePieces {
  /** vertical lines: x, from y, to y */
  v: [number, number, number][];
  /** horizontal lines: y, from x, to x */
  h: [number, number, number][];
}

/** The square grid lines of `grid` inside `r`, with the `holes` (patches that have a grid of their own) left empty. */
export function squareLines(grid: Pick<GridSettings, 'cell' | 'ox' | 'oy'>, r: Rect, holes: readonly Rect[]): LinePieces {
  const { cell, ox, oy } = grid;
  const e = 0.01;
  const out: LinePieces = { v: [], h: [] };
  for (let i = Math.ceil((r.x - ox) / cell); ox + i * cell <= r.x + r.w + e; i++) {
    const x = ox + i * cell;
    const gaps = holes.filter((h) => x > h.x + e && x < h.x + h.w - e).map((h): [number, number] => [h.y, h.y + h.h]);
    for (const [a, b] of cutLine(r.y, r.y + r.h, gaps)) out.v.push([x, a, b]);
  }
  for (let j = Math.ceil((r.y - oy) / cell); oy + j * cell <= r.y + r.h + e; j++) {
    const y = oy + j * cell;
    const gaps = holes.filter((h) => y > h.y + e && y < h.y + h.h - e).map((h): [number, number] => [h.x, h.x + h.w]);
    for (const [a, b] of cutLine(r.x, r.x + r.w, gaps)) out.h.push([y, a, b]);
  }
  return out;
}
