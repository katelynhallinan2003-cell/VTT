import type { DistanceRule, GridSettings, Rect, Token, Vec } from '../types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Snap a token's centre so its top-left corner lands on a grid line (tiny tokens snap to half squares). */
export function snapTokenCenter(grid: GridSettings, size: number, p: Vec): Vec {
  const step = size < 1 ? grid.cell / 2 : grid.cell;
  const half = (size * grid.cell) / 2;
  const tlx = p.x - half;
  const tly = p.y - half;
  return {
    x: Math.round((tlx - grid.ox) / step) * step + grid.ox + half,
    y: Math.round((tly - grid.oy) / step) * step + grid.oy + half,
  };
}

/** Snap a free point to the nearest grid intersection. */
export function snapToCorner(grid: GridSettings, p: Vec): Vec {
  return {
    x: Math.round((p.x - grid.ox) / grid.cell) * grid.cell + grid.ox,
    y: Math.round((p.y - grid.oy) / grid.cell) * grid.cell + grid.oy,
  };
}

/** Snap a free point to the centre of the square it is in. */
export function snapToCellCenter(grid: GridSettings, p: Vec): Vec {
  return {
    x: Math.floor((p.x - grid.ox) / grid.cell) * grid.cell + grid.ox + grid.cell / 2,
    y: Math.floor((p.y - grid.oy) / grid.cell) * grid.cell + grid.oy + grid.cell / 2,
  };
}

/** Distance between two world points in feet according to the table's diagonal rule. */
export function distanceFt(grid: GridSettings, a: Vec, b: Vec, rule: DistanceRule = grid.rule): number {
  const dx = Math.abs(b.x - a.x) / grid.cell;
  const dy = Math.abs(b.y - a.y) / grid.cell;
  let squares: number;
  if (rule === 'euclid') squares = Math.hypot(dx, dy);
  else {
    const hi = Math.round(Math.max(dx, dy) * 1000) / 1000;
    const lo = Math.round(Math.min(dx, dy) * 1000) / 1000;
    squares = rule === 'alt' ? hi + Math.floor(lo / 2) : hi;
  }
  return Math.round(squares * grid.ft * 10) / 10;
}

/**
 * Derive grid settings from a rectangle the DM dragged over a block of squares.
 * `cols` x `rows` is how many squares the rectangle covers (1x1 by default).
 */
export function gridFromRect(rect: Rect, cols = 1, rows = 1): { cell: number; ox: number; oy: number } {
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  const cell = (w / Math.max(1, cols) + h / Math.max(1, rows)) / 2;
  const x = rect.w < 0 ? rect.x + rect.w : rect.x;
  const y = rect.h < 0 ? rect.y + rect.h : rect.y;
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  return { cell, ox: mod(x, cell), oy: mod(y, cell) };
}

export function normRect(a: Vec, b: Vec): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function rectContains(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Token diameter in world pixels. */
export const tokenPx = (t: Pick<Token, 'size'>, grid: GridSettings) => t.size * grid.cell;

export function pointInToken(t: Token, grid: GridSettings, p: Vec): boolean {
  const r = tokenPx(t, grid) / 2;
  if (t.shape === 'circle') return (p.x - t.x) ** 2 + (p.y - t.y) ** 2 <= r * r;
  return Math.abs(p.x - t.x) <= r && Math.abs(p.y - t.y) <= r;
}

/** Camera: screen = world * zoom + (tx, ty). Returns a camera that fits `rect` inside the view. */
export function fitCamera(viewW: number, viewH: number, rect: Rect, pad = 40): { zoom: number; tx: number; ty: number } {
  const zx = (viewW - pad * 2) / Math.max(1, rect.w);
  const zy = (viewH - pad * 2) / Math.max(1, rect.h);
  const zoom = clamp(Math.min(zx, zy), 0.02, 8);
  return {
    zoom,
    tx: viewW / 2 - (rect.x + rect.w / 2) * zoom,
    ty: viewH / 2 - (rect.y + rect.h / 2) * zoom,
  };
}

/** Zoom keeping the world point under the cursor fixed. */
export function zoomAt(cam: { zoom: number; tx: number; ty: number }, sx: number, sy: number, factor: number, min = 0.03, max = 8) {
  const zoom = clamp(cam.zoom * factor, min, max);
  const f = zoom / cam.zoom;
  return { zoom, tx: sx - (sx - cam.tx) * f, ty: sy - (sy - cam.ty) * f };
}

/** Largest world-rect the scene occupies (the map, at its current transform). */
export function mapRect(meta: { mapX: number; mapY: number; mapW: number; mapH: number; mapScale: number }): Rect {
  return { x: meta.mapX, y: meta.mapY, w: meta.mapW * meta.mapScale, h: meta.mapH * meta.mapScale };
}
