// Painting ground height from a colour on the map picture: the DM picks a colour (water, a pit, a raised floor) and every grid cell that is
// mostly that colour is marked. Plain pixel arrays, so it can be tested without a browser.

import type { GridSettings, Rect, Vec } from '../types';
import { hexCentersIn, isHex } from './hex';
import type { PixelImage } from './gridcut';
import { wallMask, type Rgb } from './walltrace';

/** Every pixel near `color`; with `only`, just the connected patch that holds (or is nearest to) that point. */
export function colorRegion(img: PixelImage, color: Rgb, sensitivity: number, only?: Vec | null): Uint8Array {
  const { width: w, height: h } = img;
  const mask = wallMask(img, color, sensitivity);
  if (!only) return mask;
  // start from the nearest matching pixel within a few pixels of the click
  let sx = Math.floor(only.x), sy = Math.floor(only.y), best = -1, bd = Infinity;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = sx + dx, y = sy + dy;
    if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) continue;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = y * w + x; }
  }
  const out = new Uint8Array(w * h);
  if (best < 0) return out;
  const q = new Int32Array(w * h);
  let head = 0, tail = 0;
  q[tail++] = best; out[best] = 1;
  while (head < tail) {
    const i = q[head++];
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (mask[j] && !out[j]) { out[j] = 1; q[tail++] = j; }
      }
    }
  }
  return out;
}

export interface ColorPick { color: Rgb; /** where it was clicked on the picture, for "only that patch" (null: the colour wherever it is) */ spot: Vec | null }

/** The union of several picked colours: each one's patch (`onlyPatch`) or every pixel of that colour. */
export function colorsRegion(img: PixelImage, picks: ColorPick[], sensitivity: number, onlyPatch: boolean): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (const p of picks) {
    const m = colorRegion(img, p.color, sensitivity, onlyPatch ? p.spot : null);
    for (let i = 0; i < m.length; i++) if (m[i]) out[i] = 1;
  }
  return out;
}

/** Centres of the grid cells (squares or hexes) whose centre lies inside the box. */
export function cellCentersIn(grid: GridSettings, r: Rect): Vec[] {
  if (isHex(grid)) return hexCentersIn(grid, r);
  const out: Vec[] = [];
  const i0 = Math.floor((r.x - grid.ox) / grid.cell), i1 = Math.floor((r.x + r.w - grid.ox) / grid.cell);
  const j0 = Math.floor((r.y - grid.oy) / grid.cell), j1 = Math.floor((r.y + r.h - grid.oy) / grid.cell);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = { x: grid.ox + (i + 0.5) * grid.cell, y: grid.oy + (j + 0.5) * grid.cell };
    if (c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h) out.push(c);
  }
  return out;
}

/**
 * The cells that are at least `minFrac` (0 to 1) covered by the mask. A cell is sampled at a 5 by 5 spread of points over its middle;
 * `toPx` turns a point on the board into a pixel of the mask.
 */
export function cellsCovered(mask: Uint8Array, w: number, h: number, centers: Vec[], cell: number, toPx: (p: Vec) => Vec, minFrac: number): Vec[] {
  const out: Vec[] = [];
  const need = Math.max(1, Math.ceil(minFrac * 25));
  const offs = [-0.32, -0.16, 0, 0.16, 0.32];
  for (const c of centers) {
    let hit = 0;
    for (const oy of offs) for (const ox of offs) {
      const p = toPx({ x: c.x + ox * cell, y: c.y + oy * cell });
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) hit++;
    }
    if (hit >= need) out.push(c);
  }
  return out;
}
