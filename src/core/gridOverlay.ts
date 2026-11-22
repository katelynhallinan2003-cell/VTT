import type { GridSettings } from '../types';
import { gridPeriod } from './hex';

export type GridOverlay = GridSettings['shape'] | 'none';

export function currentOverlay(g: GridSettings): GridOverlay {
  return !g.visible && !g.snap ? 'none' : g.shape;
}

export function overlaySettings(g: GridSettings, choice: GridOverlay): Partial<GridSettings> {
  if (choice === 'none') return { visible: false, snap: false, rule: 'euclid' };
  const period = gridPeriod({ cell: g.cell, shape: choice });
  const wrap = (v: number, p: number) => Math.round(((v % p + p) % p) * 100) / 100;
  return { shape: choice, visible: true, snap: currentOverlay(g) === 'none' || g.snap,
    ox: wrap(g.ox, period.x), oy: wrap(g.oy, period.y) };
}
