import type { GridSettings } from '../types';
import { gridPeriod } from './hex';
import { round2, type GridCut } from './gridcut';
import { hexGridFor } from './hexcut';

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

/** A printed grid is only set up and hidden without being asked when the lines are clearly there (faint texture can look like lines). */
export const AUTO_GRID_STRENGTH = 8;
