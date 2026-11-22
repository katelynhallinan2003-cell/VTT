// Made-up map pictures for testing the printed-grid finder, built to have the things real battle maps have that make
// the job hard: painted ground that changes a lot, a grid that only shows on the floor of the rooms, thick walls, furniture
// drawn over the lines, dashed lines and corner marks, soft or see-through lines, borders, tiled floors that are not the
// grid, and the blockiness of a saved JPEG. Everything is drawn from a seed, so a picture is the same every run.
import { hexSides } from '../../src/core/hexcut';
import { hexCentersIn } from '../../src/core/hex';
import type { GridCut, PixelImage } from '../../src/core/gridcut';

export const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export type Shape = 'square' | 'pointy' | 'flat';

export interface GridSpec {
  shape: Shape;
  /** distance between lines (squares) or hex centres */
  p: number;
  /** squares: a vertical line's middle is at ox, a horizontal one's at oy. Hexes: the corner of the box round the first hex. */
  ox: number;
  oy: number;
  /** line thickness */
  t: number;
  /** how many brightness levels the line differs from the ground (or, with `mul`, what part of 255 it is see-through by) */
  contrast: number;
  light?: boolean;
  style?: 'solid' | 'dashed' | 'dotted' | 'corners';
  /** a see-through line: its strength follows the brightness of the ground under it */
  mul?: boolean;
  /** squares only: every so-many-th line is drawn heavier, like graph paper */
  major?: number;
}

export interface MapSpec {
  W: number;
  H: number;
  seed?: number;
  ground?: 'stone' | 'painted' | 'paper' | 'dark' | 'grass';
  grid?: GridSpec;
  /** a dungeon: the grid only shows inside rooms, the rest is solid `fill` (0 to 255), with walls `walls` pixels thick round each room */
  rooms?: { count: number; fill: number; walls?: number };
  /** a plain border this many pixels wide with no grid in it */
  margin?: number;
  /** things drawn on top of the grid (furniture, trees, rocks): how many */
  clutter?: number;
  /** a floor of tiles that has nothing to do with the grid: lines every `q` pixels inside this part of the picture */
  tiles?: { x: number; y: number; w: number; h: number; q: number; contrast: number };
  /** floorboards: lines running one way only, every `q` pixels */
  planks?: { q: number; contrast: number };
  /** thin pen strokes scattered about (hatching, lettering, cracks): how many. A third run straight up or straight across. */
  strokes?: number;
  /** long thick dark walls that do not follow the grid: how many */
  offWalls?: number;
  /** the map only fills this part of the picture; the rest is a dark panel (a legend, a title) */
  only?: { x: number; y: number; w: number; h: number };
  /** soften the whole picture (pixels) */
  blur?: number;
  /** squash it like a JPEG: 0 none, 1 mild, 3 heavy */
  jpeg?: number;
}

/** Smooth random ground: a few layers of blurry noise on top of each other. */
function fbm(W: number, H: number, r: () => number, scales: number[], amps: number[]): Float32Array {
  const out = new Float32Array(W * H);
  scales.forEach((s, li) => {
    const gw = Math.ceil(W / s) + 2, gh = Math.ceil(H / s) + 2;
    const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = r() - 0.5;
    const a = amps[li];
    for (let y = 0; y < H; y++) {
      const fy = y / s, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < W; x++) {
        const fx = x / s, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const i = y0 * gw + x0;
        const top = g[i] + (g[i + 1] - g[i]) * sx, bot = g[i + gw] + (g[i + gw + 1] - g[i + gw]) * sx;
        out[y * W + x] += (top + (bot - top) * sy) * a;
      }
    }
  });
  return out;
}

function blurInPlace(L: Float32Array, W: number, H: number, sigma: number) {
  const R = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * R + 1);
  let sum = 0;
  for (let i = -R; i <= R; i++) { k[i + R] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + R]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let i = -R; i <= R; i++) s += L[y * W + Math.max(0, Math.min(W - 1, x + i))] * k[i + R];
    tmp[y * W + x] = s;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let i = -R; i <= R; i++) s += tmp[Math.max(0, Math.min(H - 1, y + i)) * W + x] * k[i + R];
    L[y * W + x] = s;
  }
}

const COS = (() => { const c = new Float32Array(64); for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) c[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1) / 2; return c; })();
const QTAB = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];

/** What saving as a JPEG does to the brightness: every 8 by 8 block is rounded off in its own way, which leaves faint edges every 8 pixels. */
function jpegInPlace(L: Float32Array, W: number, H: number, strength: number) {
  const b = new Float32Array(64), t = new Float32Array(64);
  for (let by = 0; by + 8 <= H; by += 8) for (let bx = 0; bx + 8 <= W; bx += 8) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b[y * 8 + x] = L[(by + y) * W + bx + x] - 128;
    // rows then columns
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += b[y * 8 + x] * COS[u * 8 + x]; t[y * 8 + u] = s; }
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += t[y * 8 + u] * COS[v * 8 + y]; b[v * 8 + u] = s; }
    for (let i = 0; i < 64; i++) { const q = Math.max(1, QTAB[i] * strength); b[i] = Math.round(b[i] / q) * q; }
    for (let u = 0; u < 8; u++) for (let y = 0; y < 8; y++) { let s = 0; for (let v = 0; v < 8; v++) s += b[v * 8 + u] * COS[v * 8 + y]; t[y * 8 + u] = s; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += t[y * 8 + u] * COS[u * 8 + x]; L[(by + y) * W + bx + x] = s + 128; }
  }
}

/** How much of each pixel a grid line covers (0 to 1). */
function gridCover(W: number, H: number, g: GridSpec): Float32Array {
  const C = new Float32Array(W * H);
  const half = g.t / 2;
  const style = g.style ?? 'solid';
  if (g.shape === 'square') {
    const across = (x: number, o: number) => {
      const k = Math.round((x - o) / g.p), c = o + k * g.p;
      const h = g.major && k % g.major === 0 ? half * 2.5 : half;
      return Math.min(1, Math.max(0, Math.min(x + 0.5, c + h) - Math.max(x - 0.5, c - h)));
    };
    // along a line: all of it, dashes, or only a little way out from each crossing
    const along = (v: number, o: number) => {
      if (style === 'solid') return 1;
      if (style === 'dotted') return v % 4 < 2 ? 1 : 0;
      const d = Math.abs(v - (o + Math.round((v - o) / g.p) * g.p));
      if (style === 'corners') return d < g.p * 0.14 ? 1 : 0;
      const dash = g.p / 6;
      return (((v - o) % dash) + dash) % dash < dash * 0.55 ? 1 : 0;
    };
    const cx = new Float32Array(W), ax = new Float32Array(W), cy = new Float32Array(H), ay = new Float32Array(H);
    for (let x = 0; x < W; x++) { cx[x] = across(x, g.ox); ax[x] = along(x, g.ox); }
    for (let y = 0; y < H; y++) { cy[y] = across(y, g.oy); ay[y] = along(y, g.oy); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) C[y * W + x] = Math.min(1, cx[x] * ay[y] + cy[y] * ax[x]);
    return C;
  }
  for (const [a, b] of hexSides({ p: g.p, x: g.ox, y: g.oy }, g.shape, W, H)) {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - half - 2)), x1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) + half + 2));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - half - 2)), y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) + half + 2));
    const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey, len = Math.sqrt(l2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const s = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2));
      if (style === 'corners' && s > 0.28 && s < 0.72) continue;
      if (style === 'dashed' && ((s * len) % (len / 3)) > (len / 3) * 0.6) continue;
      const d = Math.hypot(x - (a.x + ex * s), y - (a.y + ey * s));
      const c = Math.max(0, Math.min(1, half + 0.5 - d));
      if (c > C[y * W + x]) C[y * W + x] = c;
    }
  }
  return C;
}

export function makeMap(spec: MapSpec): PixelImage {
  const { W, H } = spec;
  const r = rng(spec.seed ?? 1);
  const kind = spec.ground ?? 'stone';
  const base = { stone: 150, painted: 125, paper: 236, dark: 48, grass: 112 }[kind];
  const L = kind === 'painted' ? fbm(W, H, r, [260, 90, 28, 7], [150, 70, 36, 18])
    : kind === 'paper' ? fbm(W, H, r, [200, 40], [10, 6])
    : kind === 'dark' ? fbm(W, H, r, [120, 30, 8], [30, 16, 10])
    : kind === 'grass' ? fbm(W, H, r, [150, 20, 5, 2.2], [50, 40, 40, 36])
    : fbm(W, H, r, [140, 37, 9], [40, 26, 14]);
  const grain = { stone: 30, painted: 14, paper: 5, dark: 10, grass: 30 }[kind];
  for (let i = 0; i < L.length; i++) L[i] = base + L[i] + (r() - 0.5) * grain;

  if (spec.planks) {
    const { q, contrast } = spec.planks;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x % q < 2) L[y * W + x] -= contrast;
  }
  if (spec.tiles) {
    const { x: tx, y: ty, w, h, q, contrast } = spec.tiles;
    for (let y = ty; y < Math.min(H, ty + h); y++) for (let x = tx; x < Math.min(W, tx + w); x++) if ((x - tx) % q < 2 || (y - ty) % q < 2) L[y * W + x] -= contrast;
  }

  // where the grid shows
  const g = spec.grid;
  let show: Uint8Array | null = null;
  const rooms: { x0: number; y0: number; x1: number; y1: number }[] = [];
  if (spec.rooms) {
    show = new Uint8Array(W * H);
    const p = g?.p ?? 60, ox = g?.ox ?? 0, oy = g?.oy ?? 0;
    const snap = (v: number, o: number) => (g && g.shape === 'square' ? o + Math.round((v - o) / p) * p : v);
    for (let i = 0; i < spec.rooms.count; i++) {
      const w = (3 + Math.floor(r() * 7)) * p, h = (3 + Math.floor(r() * 6)) * p;
      const x0 = Math.round(snap(r() * Math.max(1, W - w), ox)), y0 = Math.round(snap(r() * Math.max(1, H - h), oy));
      const room = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(W, Math.round(x0 + w)), y1: Math.min(H, Math.round(y0 + h)) };
      rooms.push(room);
      for (let y = room.y0; y < room.y1; y++) show.fill(1, y * W + room.x0, y * W + room.x1);
    }
  }
  if (spec.margin) {
    show ??= new Uint8Array(W * H).fill(1);
    const m = spec.margin;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < m || y < m || x >= W - m || y >= H - m) show[y * W + x] = 0;
  }
  if (spec.only) {
    show ??= new Uint8Array(W * H).fill(1);
    const o = spec.only;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < o.x || y < o.y || x >= o.x + o.w || y >= o.y + o.h) show[y * W + x] = 0;
  }

  if (g) {
    const C = gridCover(W, H, g);
    for (let i = 0; i < L.length; i++) {
      if (!C[i] || (show && !show[i])) continue;
      if (g.mul) L[i] = g.light ? L[i] + (255 - L[i]) * (g.contrast / 255) * C[i] : L[i] * (1 - (g.contrast / 255) * C[i]);
      else L[i] += (g.light ? g.contrast : -g.contrast) * C[i];
    }
  }

  if (spec.rooms) {
    const fill = spec.rooms.fill, wt = spec.rooms.walls ?? 0;
    for (let i = 0; i < L.length; i++) if (!show![i]) L[i] = fill + (r() - 0.5) * 6;
    // walls: a dark band just inside the edge of every room, where no other room carries on
    if (wt) for (const rm of rooms) {
      for (let y = rm.y0; y < rm.y1; y++) for (let x = rm.x0; x < rm.x1; x++) {
        const edge = x - rm.x0 < wt || rm.x1 - 1 - x < wt || y - rm.y0 < wt || rm.y1 - 1 - y < wt;
        if (edge) L[y * W + x] = 22 + (r() - 0.5) * 8;
      }
    }
  } else if (spec.margin || spec.only) {
    const v = spec.only ? 30 : 228;
    for (let i = 0; i < L.length; i++) if (!show![i]) L[i] = v + (r() - 0.5) * 4;
  }

  for (let i = 0; i < (spec.offWalls ?? 0); i++) {
    const upright = r() < 0.5, len = 200 + r() * 500, th = 5 + Math.floor(r() * 5);
    const x0 = Math.floor(r() * W), y0 = Math.floor(r() * H);
    const x1 = Math.min(W, x0 + (upright ? th : len)), y1 = Math.min(H, y0 + (upright ? len : th));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) L[y * W + x] = 20 + (r() - 0.5) * 8;
  }
  for (let i = 0; i < (spec.strokes ?? 0); i++) {
    const kind3 = r();
    const ang = kind3 < 0.17 ? 0 : kind3 < 0.34 ? Math.PI / 2 : r() * Math.PI;
    const len = 12 + r() * 60, cx = r() * W, cy = r() * H, th = 1 + r() * 1.5, v = r() < 0.85 ? -(60 + r() * 120) : 60 + r() * 80;
    const ex = Math.cos(ang), ey = Math.sin(ang);
    const x0 = Math.max(0, Math.floor(cx - len / 2 - 2)), x1 = Math.min(W - 1, Math.ceil(cx + len / 2 + 2));
    const y0 = Math.max(0, Math.floor(cy - len / 2 - 2)), y1 = Math.min(H - 1, Math.ceil(cy + len / 2 + 2));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const s = (x - cx) * ex + (y - cy) * ey;
      if (Math.abs(s) > len / 2) continue;
      const d = Math.abs(-(x - cx) * ey + (y - cy) * ex);
      const c = Math.max(0, Math.min(1, th / 2 + 0.5 - d));
      if (c > 0) L[y * W + x] = Math.max(0, Math.min(255, L[y * W + x] + v * c));
    }
  }

  // furniture, trees and rocks drawn over everything
  for (let i = 0; i < (spec.clutter ?? 0); i++) {
    const cx = r() * W, cy = r() * H, rad = 12 + r() * 70, round = r() < 0.6, v = 40 + r() * 190, soft = 2 + r() * 6;
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(W - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(H - 1, Math.ceil(cy + rad));
    const asp = 0.5 + r();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = round ? rad - Math.hypot(x - cx, (y - cy) / asp) : Math.min(rad - Math.abs(x - cx), rad * asp - Math.abs(y - cy));
      if (d <= 0) continue;
      const a = Math.min(1, d / soft);
      L[y * W + x] = L[y * W + x] * (1 - a) + (v + (r() - 0.5) * 14) * a;
    }
  }

  if (spec.blur) blurInPlace(L, W, H, spec.blur);
  if (spec.jpeg) jpegInPlace(L, W, H, spec.jpeg);

  const data = new Uint8ClampedArray(W * H * 4);
  const tint = { stone: [1, 0.93, 0.8], painted: [1, 0.96, 0.82], paper: [1, 0.98, 0.9], dark: [0.85, 0.92, 1], grass: [0.8, 1, 0.62] }[kind];
  for (let i = 0, j = 0; i < L.length; i++, j += 4) {
    data[j] = L[i] * tint[0]; data[j + 1] = L[i] * tint[1]; data[j + 2] = L[i] * tint[2]; data[j + 3] = 255;
  }
  return { data, width: W, height: H };
}

const near = (d: number, m: number) => { const v = ((d % m) + m) % m; return Math.min(v, m - v); };

/**
 * How far off the found grid is from the true one, in pixels, at its worst anywhere on the picture
 * (a small mistake in the spacing adds up over the picture, so this is what decides whether the app's grid sits on the printed one).
 * Infinity when the shape is wrong.
 */
export function gridError(found: GridCut, truth: GridSpec, W: number, H: number): number {
  const shape: Shape = found.hex ?? 'square';
  if (shape !== truth.shape) return Infinity;
  if (shape === 'square') {
    let worst = 0;
    // Compare in both directions so that extra lines between every pair of true lines also fail.
    const checkLines = (from: number, step: number, to: number, period: number, limit: number) => {
      for (let c = ((from % step) + step) % step; c < limit; c += step) worst = Math.max(worst, near(c - to, period));
    };
    for (const [actual, expected, limit] of [[found.x, truth.ox, W], [found.y, truth.oy, H]]) {
      checkLines(expected, truth.p, actual, found.p, limit);
      checkLines(actual, found.p, expected, truth.p, limit);
    }
    return worst;
  }
  const mk = (c: { p: number; x: number; y: number }) => ({ shape, cell: c.p, ox: c.x, oy: c.y, visible: true, color: '#000', opacity: 1, ft: 5, rule: 'chebyshev' as const, snap: true });
  const real = hexCentersIn(mk({ p: truth.p, x: truth.ox, y: truth.oy }), { x: 0, y: 0, w: W, h: H });
  const got = hexCentersIn(mk(found), { x: -found.p, y: -found.p, w: W + 2 * found.p, h: H + 2 * found.p });
  let worst = 0;
  const step = Math.max(1, Math.floor(real.length / 60));
  for (let i = 0; i < real.length; i += step) {
    let best = Infinity;
    for (const q of got) best = Math.min(best, Math.hypot(q.x - real[i].x, q.y - real[i].y));
    worst = Math.max(worst, best);
  }
  return worst;
}
