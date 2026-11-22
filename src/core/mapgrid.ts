import type { GridSettings } from '../types';
import { gridPeriod } from './hex';
import { findGrid, round2, type Found, type GridCut, type PixelImage } from './gridcut';
import { findHexGrid, hexGridFor } from './hexcut';

/** The app grid that would sit exactly on a printed one: its shape, size and where it starts, in the scene's own pixels. */
export type ImpliedGrid = { shape: GridSettings['shape']; cell: number; ox: number; oy: number };

const mod = (v: number, m: number) => ((v % m) + m) % m;

/**
 * Where the app's grid has to be to land on the lines printed on the map picture.
 * `k` is how many scene pixels one picture pixel takes up (the map's size on the board, times how much the picture was shrunk to load it),
 * and (`mapX`, `mapY`) is where the picture's corner is.
 */
export function impliedGrid(cut: GridCut, k: number, mapX: number, mapY: number): ImpliedGrid {
  if (cut.hex) return hexGridFor(cut, k, mapX, mapY)!;
  return { shape: 'square', cell: round2(cut.p * k), ox: round2(mod(mapX + (cut.x + 0.5) * k, cut.p * k)), oy: round2(mod(mapY + (cut.y + 0.5) * k, cut.p * k)) };
}

/** Does the app's grid already sit on the printed one (to within a pixel or so)? */
export function gridMatches(g: Pick<GridSettings, 'shape' | 'cell' | 'ox' | 'oy'>, implied: ImpliedGrid): boolean {
  if (implied.shape !== g.shape || Math.abs(g.cell - implied.cell) >= 0.5) return false;
  const per = gridPeriod(implied);
  const near = (d: number, m: number) => Math.min(Math.abs(mod(d, m)), Math.abs(m - mod(d, m))) < 1.5;
  const dx = g.ox - implied.ox, dy = g.oy - implied.oy;
  // a hex grid looks the same shifted half a box across and half a box down
  return (near(dx, per.x) && near(dy, per.y)) || (implied.shape !== 'square' && near(dx - per.x / 2, per.x) && near(dy - per.y / 2, per.y));
}

/**
 * A printed grid is only set up and hidden without being asked when it is clearly there. Both finders mark what they find from 0 to 10
 * (10: every line is there, right across the picture, and nothing else in the picture looks like a line). Anything from here up is
 * acted on; below it, the grid is still found when the DM presses "Find and hide it". Grids that only reach over a small part of the
 * picture, very faint ones, and textures finer than any battle grid never get this far (see findGrid).
 */
export const AUTO_GRID_STRENGTH = 6;

export interface DetectOpts {
  /** the spacing you expect, in pixels of this picture (the size of the grid the scene already has) */
  hint?: number;
  /** the shape the scene's grid has now: that kind is looked for first */
  shape?: GridSettings['shape'];
  /** nothing has been set up for this picture yet, so squares and hexes both get a look and the clearer one wins */
  any?: boolean;
}

/**
 * Look for a grid printed on a picture, squares or hexes. This is the whole decision, kept apart from the screen so it can be tested
 * on plain pixels. Null when no evenly spaced lines are there.
 */
export function detectPrintedGrid(img: PixelImage, opts: DetectOpts = {}): Found | null {
  // the size of the grid the scene has only helps when someone set it for this picture: on a fresh map it is just the default
  const hint = !opts.any && opts.hint && opts.hint >= 10 ? opts.hint : undefined;
  const hexFirst = !!opts.shape && opts.shape !== 'square';
  // squares are found from the picture alone: the size of the grid the scene happens to have says nothing about the picture
  const squares = () => findGrid(img);
  const first = hexFirst ? (opts.shape as 'pointy' | 'flat') : 'pointy';
  // a grid size that is far off the printed one can make some other spacing look like hexes, so the hint only wins when it fits as well as looking at everything
  const hexes = () => {
    const a = hint ? findHexGrid(img, hint, first) : null;
    const b = findHexGrid(img, undefined, first);
    return a && b ? (a.strength >= b.strength * 0.9 ? a : b) : a ?? b;
  };
  const either = () => {
    const s = squares(), h = hexes();
    return s && h ? (h.strength > s.strength * 1.1 ? h : s) : s ?? h;
  };
  return opts.any ? either() : hexFirst ? hexes() ?? squares() : squares() ?? hexes();
}
