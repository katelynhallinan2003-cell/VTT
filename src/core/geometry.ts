import type { DistanceRule, GridSettings, Rect, Token, Vec } from '../types';
import { gridPeriod, hexCenter, hexCorner, hexDistance, isHex } from './hex';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Snap a token's centre so its top-left corner lands on a grid line (tiny tokens snap to half squares). */
export function snapTokenCenter(grid: GridSettings, size: number, p: Vec): Vec {
  if (isHex(grid)) {
    // odd sizes sit on the middle of a hex; even ones (a Large creature takes three hexes) on the corner where they meet
    const n = Math.round(size);
    return n >= 2 && n % 2 === 0 ? hexCorner(grid, p) : hexCenter(grid, p);
  }
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
  if (isHex(grid)) return hexCorner(grid, p);
  return {
    x: Math.round((p.x - grid.ox) / grid.cell) * grid.cell + grid.ox,
    y: Math.round((p.y - grid.oy) / grid.cell) * grid.cell + grid.oy,
  };
}

/** Snap a free point to the centre of the square it is in. */
export function snapToCellCenter(grid: GridSettings, p: Vec): Vec {
  if (isHex(grid)) return hexCenter(grid, p);
  return {
    x: Math.floor((p.x - grid.ox) / grid.cell) * grid.cell + grid.ox + grid.cell / 2,
    y: Math.floor((p.y - grid.oy) / grid.cell) * grid.cell + grid.oy + grid.cell / 2,
  };
}

/**
 * Distance between two world points in feet according to the table's diagonal rule.
 * `dzFt` is how much higher one end is than the other: the rule is applied between the flat distance and the height, so
 * flying 30 feet up and 30 across costs 30 (or 45 on the 5-10-5 rule, 42.4 with straight lines).
 */
export function distanceFt(grid: GridSettings, a: Vec, b: Vec, rule: DistanceRule = grid.rule, dzFt = 0): number {
  const hex = isHex(grid);
  const dx = Math.abs(b.x - a.x) / grid.cell;
  const dy = Math.abs(b.y - a.y) / grid.cell;
  const dz = Math.abs(dzFt) / grid.ft;
  let squares: number;
  if (rule === 'euclid') squares = Math.hypot(dx, dy, dz);
  else {
    // on hexes every step is the same length, so there is no diagonal to argue about
    const hi = Math.round(Math.max(dx, dy) * 1000) / 1000;
    const lo = Math.round(Math.min(dx, dy) * 1000) / 1000;
    const flat = hex ? hexDistance(grid, a, b) : rule === 'alt' ? hi + Math.floor(lo / 2) : hi;
    if (!dz) squares = flat;
    else {
      const big = Math.max(flat, dz);
      const small = Math.min(flat, dz);
      squares = rule === 'alt' ? big + Math.floor(small / 2) : big;
    }
  }
  return Math.round(squares * grid.ft * 10) / 10;
}

/**
 * The length in feet of a path through several points, by the table's diagonal rule. On the 5-10-5 rule every second diagonal step costs double
 * along the whole path (not once per leg), so a path of two diagonal legs costs what one long diagonal does.
 * `rise[i]` is how much higher point i+1 is than point i (a leg that climbs or falls is measured with the height, and does not carry).
 */
export function pathFt(grid: GridSettings, pts: Vec[], rise: number[] = []): number {
  let total = 0;
  let diag = 0; // diagonal steps taken so far
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dz = rise[i - 1] ?? 0;
    if (grid.rule === 'alt' && !isHex(grid) && !dz) {
      const dx = Math.abs(b.x - a.x) / grid.cell;
      const dy = Math.abs(b.y - a.y) / grid.cell;
      const hi = Math.round(Math.max(dx, dy) * 1000) / 1000;
      const lo = Math.round(Math.min(dx, dy) * 1000) / 1000;
      total += (hi + Math.floor((diag + lo) / 2) - Math.floor(diag / 2)) * grid.ft;
      diag += lo;
    } else total += distanceFt(grid, a, b, grid.rule, dz);
  }
  return Math.round(total * 10) / 10;
}

/**
 * Derive grid settings from a rectangle the DM dragged over a block of squares.
 * `cols` x `rows` is how many squares the rectangle covers (1x1 by default).
 */
export function gridFromRect(rect: Rect, cols = 1, rows = 1, shape: GridSettings['shape'] = 'square'): { cell: number; ox: number; oy: number } {
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  const x = rect.w < 0 ? rect.x + rect.w : rect.x;
  const y = rect.h < 0 ? rect.y + rect.h : rect.y;
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  if (shape === 'pointy' || shape === 'flat') {
    // the box goes around hexes: along one row of pointy hexes (a width of `cols` hexes), or down one column of flat ones
    const cell = shape === 'pointy' ? w / Math.max(1, cols) : h / Math.max(1, rows);
    const per = gridPeriod({ cell, shape });
    return { cell, ox: mod(x, per.x), oy: mod(y, per.y) };
  }
  const cell = (w / Math.max(1, cols) + h / Math.max(1, rows)) / 2;
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

/** The room the scene takes up: the main map and every extra map, at their current places and sizes (null when there is no map at all). */
export function sceneRect(meta: { mapX: number; mapY: number; mapW: number; mapH: number; mapScale: number; maps?: { x: number; y: number; w: number; h: number; scale: number }[] }): Rect | null {
  const rects: Rect[] = [];
  if (meta.mapW > 0) rects.push(mapRect(meta));
  for (const m of meta.maps ?? []) rects.push({ x: m.x, y: m.y, w: m.w * m.scale, h: m.h * m.scale });
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Largest world-rect the scene occupies (the map, at its current transform). */
export function mapRect(meta: { mapX: number; mapY: number; mapW: number; mapH: number; mapScale: number }): Rect {
  return { x: meta.mapX, y: meta.mapY, w: meta.mapW * meta.mapScale, h: meta.mapH * meta.mapScale };
}
