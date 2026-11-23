// An empty grid: a scene (or a piece beside a map) that is just squares, with no picture behind it.
//
// The scene's own page is `mapUrl: null` with a size in `mapW` and `mapH`. A piece beside a map is an extra map whose url is BLANK_MAP.
// Both are drawn as plain paper, and the scene's grid is drawn over them like over any map.
import type { GridSettings, Rect } from '../types';
import { colorNum } from './colornum';

/** The "picture" of an extra map that is only an empty grid. */
export const BLANK_MAP = 'blank:';
export const isBlankMap = (url: string | null | undefined): boolean => url === BLANK_MAP;

/** What a new empty grid measures, in squares (across by down), and the most one can be. */
export const BLANK_COLS = 30;
export const BLANK_ROWS = 20;
export const MAX_BLANK_SQUARES = 200;

/** The background an empty-grid scene starts with, so the grid lines show (the usual white one would hide them). */
export const BLANK_BG = '#20242e';

export const clampSquares = (n: number): number => Math.max(1, Math.min(MAX_BLANK_SQUARES, Math.round(Number.isFinite(n) ? n : 1)));

/** Is the scene's own page an empty grid (no map picture, but a size)? */
export const isBlankPage = (m: { mapUrl: string | null; mapW: number; mapH: number }): boolean => !m.mapUrl && m.mapW > 0 && m.mapH > 0;

/** Squares across and down for a page of this size in pixels. */
export const squaresOf = (grid: Pick<GridSettings, 'cell'>, w: number, h: number): { cols: number; rows: number } => ({
  cols: Math.max(1, Math.round(w / grid.cell)),
  rows: Math.max(1, Math.round(h / grid.cell)),
});

/**
 * The paper of an empty grid. It is picked so the grid's own lines show on it: dark paper under light lines (the usual white ones),
 * light paper under dark lines. The colour behind the map does not come into it.
 */
export function paperColour(gridColor: string): number {
  const n = colorNum(gridColor);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum >= 128 ? 0x2b3040 : 0xf1efe8;
}

/**
 * Where an empty grid goes: just to the right of what the scene already takes up, on the grid's lines (so its squares match the map's),
 * level with the top of it.
 */
export function blankSpot(grid: GridSettings, here: Rect | null): { x: number; y: number } {
  if (!here) return { x: grid.ox, y: grid.oy };
  const c = grid.cell;
  return {
    x: grid.ox + Math.ceil((here.x + here.w - grid.ox - 1e-6) / c) * c,
    y: grid.oy + Math.round((here.y - grid.oy) / c) * c,
  };
}
