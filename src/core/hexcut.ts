// Finding and hiding a HEX grid that is printed on a map picture (squares are in gridcut.ts).
//
// The edges of a hex grid lie on three families of parallel straight lines, 60 degrees apart. In each family the lines are p/2 apart
// (p being the distance between the centres of two neighbouring hexes), but along a line the edge only shows up for a third of the way:
// the rest of the line is where the hexes' other sides meet it. We look for each family by comparing every pixel with the pixels either
// side of it across the line, adding that up along the line direction (a "profile" across the family), and searching for the spacing and
// offsets where the three profiles' peaks line up. The three families have to agree with each other, which is what makes this solid.
//
// Those lines make a triangular lattice, and a hex lattice uses two thirds of its points as corners and one third as centres. Which third
// is the centres is decided by checking which choice puts the hexes' sides on real lines. Hiding the lines means marking every pixel near
// a hex side and filling it in from the unmarked pixels around it, so the picture itself is never changed: only the copy on screen.
//
// Everything here works on plain pixel arrays so it can be tested without a browser.
import type { GridSettings } from '../types';
import { hexCentersIn, hexCorners, S3 } from './hex';
import { exact, luma, medianAbs, round2, thickness, type Found, type GridCut, type PixelImage } from './gridcut';

type HexShape = 'pointy' | 'flat';
type Vec = { x: number; y: number };

/** Lines of this strength (in brightness levels, 0 to 255) are the least we call a grid. Fainter than squares since only part of each line shows. */
const MIN_CONTRAST_HEX = 1.6;

/** The directions across the three families of lines, `a` being the sum of `b` and `c`. */
function normals(shape: HexShape): [Vec, Vec, Vec] {
  return shape === 'pointy'
    ? [{ x: 0.5, y: S3 / 2 }, { x: 1, y: 0 }, { x: -0.5, y: S3 / 2 }]
    : [{ x: 0, y: 1 }, { x: S3 / 2, y: 0.5 }, { x: -S3 / 2, y: 0.5 }];
}

/** The grid the app would have to describe these hexes (so the shared hex helpers can be used on a picture). */
function asGrid(cut: Pick<GridCut, 'p' | 'x' | 'y'>, shape: HexShape): GridSettings {
  return { shape, cell: cut.p, ox: cut.x, oy: cut.y, visible: true, color: '#000', opacity: 1, ft: 5, rule: 'chebyshev', snap: true };
}

/** Every side of every hex that touches the picture, once each (three of each hex's six). */
export function hexSides(cut: Pick<GridCut, 'p' | 'x' | 'y'>, shape: HexShape, W: number, H: number, every = 1): [Vec, Vec][] {
  const g = asGrid(cut, shape);
  const out: [Vec, Vec][] = [];
  const centres = hexCentersIn(g, { x: -cut.p, y: -cut.p, w: W + cut.p * 2, h: H + cut.p * 2 });
  for (let i = 0; i < centres.length; i += every) {
    const c = hexCorners(g, centres[i]);
    for (let k = 0; k < 3; k++) out.push([c[k], c[k + 1]]);
  }
  return out;
}

interface Profiles {
  /** across each family, one number per pixel of distance (average of how much darker the pixels are than their neighbours either side) */
  prof: Float32Array[];
  /** the whole-number distance each profile starts at */
  base: number[];
  noise: number[];
}

function profiles(img: PixelImage, L: Uint8Array, shape: HexShape, d: number, sign: number): Profiles {
  const { width: W, height: H } = img;
  const ns = normals(shape);
  const prof: Float32Array[] = [], base: number[] = [], noise: number[] = [];
  for (const n of ns) {
    const dx = Math.round(d * n.x), dy = Math.round(d * n.y);
    const corners = [0, W - 1].flatMap((x) => [0, H - 1].map((y) => x * n.x + y * n.y));
    const lo = Math.floor(Math.min(...corners)), hi = Math.ceil(Math.max(...corners));
    const len = hi - lo + 1;
    const sum = new Float32Array(len), cnt = new Uint32Array(len);
    for (let y = 0; y < H; y++) {
      const ya = Math.max(0, Math.min(H - 1, y - dy)) * W, yb = Math.max(0, Math.min(H - 1, y + dy)) * W, yc = y * W;
      for (let x = 0; x < W; x++) {
        const xa = x - dx < 0 ? 0 : x - dx >= W ? W - 1 : x - dx;
        const xb = x + dx < 0 ? 0 : x + dx >= W ? W - 1 : x + dx;
        const v = (L[ya + xa] + L[yb + xb]) / 2 - L[yc + x];
        const bin = Math.round(x * n.x + y * n.y) - lo;
        sum[bin] += v;
        cnt[bin]++;
      }
    }
    const p = new Float32Array(len);
    for (let i = 0; i < len; i++) p[i] = cnt[i] ? (sign * sum[i]) / cnt[i] : 0;
    prof.push(p); base.push(lo); noise.push(medianAbs(p));
  }
  return { prof, base, noise };
}

/** Whether the lines are darker (1) or lighter (-1) than the ground: the side with the bigger peaks. */
function polarity(prof: Float32Array[]): number {
  let pos = 0, neg = 0;
  for (const p of prof) {
    const v = Float32Array.from(p).sort();
    pos += v[Math.floor(v.length * 0.99)];
    neg += -v[Math.floor(v.length * 0.01)];
  }
  return pos >= neg ? 1 : -1;
}

/** Average strength of a profile at positions o, o+q, o+2q… (looking a bin either side to allow for rounding). */
function comb(prof: Float32Array, q: number, o: number): number {
  const n = prof.length;
  let sum = 0, cnt = 0;
  for (let c = o; c < n; c += q) {
    const i = Math.round(c);
    if (i < 1 || i >= n - 1) continue;
    const a = prof[i - 1], b = prof[i], e = prof[i + 1];
    sum += a > b ? (a > e ? a : e) : b > e ? b : e;
    cnt++;
  }
  return cnt >= 3 ? sum / cnt : -Infinity;
}

const mod = (v: number, m: number) => ((v % m) + m) % m;

interface Cand { p: number; ub: number; uc: number; score: number }

/** Try one spacing: the best matching offsets for the three families, which have to agree with each other. */
function tryHexSpacing(P: Profiles, p: number): Cand | null {
  const q = p / 2;
  const n = Math.max(6, Math.round(q / (q > 40 ? 1 : 0.5)));
  const step = q / n;
  const [pa, pb, pc] = P.prof;
  const Sa = new Float32Array(n), Sb = new Float32Array(n), Sc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = comb(pa, q, i * step), b = comb(pb, q, i * step), c = comb(pc, q, i * step);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
    Sa[i] = a / P.noise[0]; Sb[i] = b / P.noise[1]; Sc[i] = c / P.noise[2];
  }
  // the offsets are tied together: where the lines of two families cross, a line of the third family passes too
  const delta = Math.round(mod(P.base[1] + P.base[2] - P.base[0], q) / step);
  let best: Cand | null = null;
  for (let ib = 0; ib < n; ib++) {
    for (let ic = 0; ic < n; ic++) {
      const s = Sb[ib] + Sc[ic] + Sa[(ib + ic + delta) % n];
      if (!best || s > best.score) best = { p, ub: ib * step, uc: ic * step, score: s };
    }
  }
  return best;
}

/** How strongly the three families' lines show at spacing p and these offsets (more exact than the search, for the final adjustment). */
function exactScore(P: Profiles, p: number, ub: number, uc: number): number {
  const q = p / 2;
  const ua = mod(ub + uc + P.base[1] + P.base[2] - P.base[0], q);
  return exact(P.prof[0], q, ua) / P.noise[0] + exact(P.prof[1], q, ub) / P.noise[1] + exact(P.prof[2], q, uc) / P.noise[2];
}

function refineHex(P: Profiles, c: Cand): Cand {
  let best = { ...c, score: exactScore(P, c.p, c.ub, c.uc) };
  for (let k = -40; k <= 40; k++) {
    const p = c.p * (1 + k * 0.00015);
    for (let a = -1.5; a <= 1.5; a += 0.25) {
      for (let b = -1.5; b <= 1.5; b += 0.25) {
        const s = exactScore(P, p, mod(c.ub + a, p / 2), mod(c.uc + b, p / 2));
        if (s > best.score) best = { p, ub: mod(c.ub + a, p / 2), uc: mod(c.uc + b, p / 2), score: s };
      }
    }
  }
  return best;
}

/** How much darker the pixels on a hex's sides are than the ground either side of them, averaged over a spread of sides across the picture. */
function sidesScore(L: Uint8Array, W: number, H: number, cut: Pick<GridCut, 'p' | 'x' | 'y'>, shape: HexShape, d: number, sign: number): number {
  const all = hexSides(cut, shape, W, H);
  const stride = Math.max(1, Math.floor(all.length / 900));
  let sum = 0, cnt = 0;
  const px = (x: number, y: number) => L[Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)))];
  for (let i = 0; i < all.length; i += stride) {
    const [a, b] = all[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    for (const t of [0.25, 0.4, 0.5, 0.6, 0.75]) {
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (x < d || y < d || x >= W - d || y >= H - d) continue;
      sum += sign * ((px(x + nx * d, y + ny * d) + px(x - nx * d, y - ny * d)) / 2 - px(x, y));
      cnt++;
    }
  }
  return cnt >= 10 ? sum / cnt : -Infinity;
}

/** Search one orientation. `hint` is the spacing you expect (pixels of this picture between hex centres), or none to try them all. */
function findOne(img: PixelImage, L: Uint8Array, shape: HexShape, hint?: number): Found | null {
  const { width: W, height: H } = img;
  const d = hint ? Math.max(3, Math.min(8, Math.round(hint * 0.07))) : 5;
  // which way the lines go (dark or light) comes from a first look
  const first = profiles(img, L, shape, d, 1);
  const sign = polarity(first.prof);
  const P = sign === 1 ? first : { ...first, prof: first.prof.map((p) => Float32Array.from(p, (v) => -v)), noise: first.noise };
  const lo = hint ? hint * 0.93 : 24;
  const hi = hint ? hint * 1.07 : Math.min(W, H) / 6;
  if (hi <= lo) return null;
  const grow = 1 + (hint ? Math.max(0.0001, 0.5 / Math.max(W, H)) : 0.004);
  let best: Cand | null = null;
  for (let p = lo; p <= hi; p *= grow) {
    const c = tryHexSpacing(P, p);
    if (c && (!best || c.score > best.score)) best = c;
  }
  if (!best) return null;
  // the search forgives a pixel either way; pin the spacing and offsets down to a fraction of a pixel
  const fine = refineHex(P, best);
  const q = fine.p / 2;
  const ob = mod(fine.ub + P.base[1], q), oc = mod(fine.uc + P.base[2], q); // where lines of two of the families run, in picture pixels across them
  const per = P.prof.map((pr, i) => exact(pr, q, [mod(fine.ub + fine.uc + P.base[1] + P.base[2] - P.base[0], q), fine.ub, fine.uc][i]) / P.noise[i]);
  const raw = P.prof.map((pr, i) => exact(pr, q, [mod(fine.ub + fine.uc + P.base[1] + P.base[2] - P.base[0], q), fine.ub, fine.uc][i]));
  if (Math.min(...per) < 1.8 || Math.min(...raw) < MIN_CONTRAST_HEX * 0.5) return null;
  // a point where lines of the three families cross: solve  Q.nb = ob,  Q.nc = oc
  const [, nb, nc] = normals(shape);
  const det = nb.x * nc.y - nb.y * nc.x;
  const Q = { x: (ob * nc.y - oc * nb.y) / det, y: (nb.x * oc - nc.x * ob) / det };
  // the crossings are hex corners (two in three) and hex centres (one in three): walk along a line to find which, by seeing where the sides are drawn
  const s = fine.p / S3;
  const tb = { x: -nb.y, y: nb.x };
  const t = Math.max(1, Math.min(12, (thickness(P.prof[0], q, mod(fine.ub + fine.uc + P.base[1] + P.base[2] - P.base[0], q)) + thickness(P.prof[1], q, fine.ub) + thickness(P.prof[2], q, fine.uc)) / 3));
  let top: { cut: GridCut; score: number } | null = null;
  for (let j = 0; j < 3; j++) {
    const C = { x: Q.x + tb.x * s * j, y: Q.y + tb.y * s * j };
    const origin = shape === 'pointy' ? { x: C.x - fine.p / 2, y: C.y - fine.p / S3 } : { x: C.x - fine.p / S3, y: C.y - fine.p / 2 };
    const per = shape === 'pointy' ? { x: fine.p, y: fine.p * S3 } : { x: fine.p * S3, y: fine.p };
    const cut: GridCut = { on: true, p: round2(fine.p), x: round2(mod(origin.x, per.x)), y: round2(mod(origin.y, per.y)), t: round2(t), hex: shape };
    const sc = sidesScore(L, W, H, cut, shape, Math.max(2, Math.round(t) + 2), sign);
    if (!top || sc > top.score) top = { cut, score: sc };
  }
  if (!top || top.score < MIN_CONTRAST_HEX) return null;
  const found: Found = { cut: top.cut, strength: top.score / ((P.noise[0] + P.noise[1] + P.noise[2]) / 3) };
  // looking at every spacing, twice (or three times) the real one scores just as well on the lines alone: the real hexes are the smaller ones
  // if their sides sit on drawn lines much better than the bigger ones' do
  if (!hint) {
    let best = found;
    for (const k of [2, 3]) {
      if (found.cut.p / k < 24) continue;
      const sub = findOne(img, L, shape, found.cut.p / k);
      if (sub && sub.strength > best.strength * 0.8) best = sub;
    }
    return best;
  }
  return found;
}

/**
 * Look for a hex grid printed on the picture. `shape` is the orientation to look for first; the other one is tried if nothing is found.
 * `hint` is the spacing you expect between hex centres in pixels of this picture. Returns null when nothing regular enough is there.
 */
export function findHexGrid(img: PixelImage, hint?: number, shape: HexShape = 'pointy'): Found | null {
  if (img.width < 80 || img.height < 80) return null;
  const L = luma(img);
  const other: HexShape = shape === 'pointy' ? 'flat' : 'pointy';
  // look both ways: lines that are not really hexes can still pass for them the wrong way round, so the better fit wins
  const a = findOne(img, L, shape, hint);
  const b = findOne(img, L, other, hint);
  return a && b ? (b.strength > a.strength * 1.1 ? b : a) : a ?? b;
}

/** Fill the hex sides in from the pixels around them, on a copy of the picture's pixels (changed in place). */
export function hideHexGrid(img: PixelImage, cut: Pick<GridCut, 'p' | 'x' | 'y' | 't' | 'hex'>): void {
  const { width: W, height: H, data } = img;
  const shape = cut.hex ?? 'pointy';
  const half = Math.ceil(cut.t / 2) + 1;
  const mask = new Uint8Array(W * H);
  for (const [a, b] of hexSides(cut, shape, W, H)) {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - half - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) + half + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - half - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) + half + 1));
    const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0;
        if (Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t)) <= half) mask[y * W + x] = 1;
      }
    }
  }
  const src = Uint8ClampedArray.from(data);
  const R = half * 2 + 4;
  const dirs: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      let r = 0, g = 0, b = 0, w = 0;
      for (const [dx, dy, len] of dirs) {
        for (let k = 1; k <= R; k++) {
          const xx = x + dx * k, yy = y + dy * k;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) break;
          const j = yy * W + xx;
          if (mask[j]) continue;
          const wt = 1 / ((k * len) * (k * len));
          const o = j * 4;
          r += src[o] * wt; g += src[o + 1] * wt; b += src[o + 2] * wt; w += wt;
          break;
        }
      }
      if (w > 0) { const o = (y * W + x) * 4; data[o] = r / w; data[o + 1] = g / w; data[o + 2] = b / w; }
    }
  }
}

/** Where the app's own hex grid would have to sit to land on the printed one: the picture's hex lattice in the map's pixels. */
export function hexGridFor(cut: GridCut, k: number, mapX: number, mapY: number): { shape: HexShape; cell: number; ox: number; oy: number } | null {
  if (!cut.hex) return null;
  const cell = cut.p * k;
  const per = cut.hex === 'pointy' ? { x: cell, y: cell * S3 } : { x: cell * S3, y: cell };
  return { shape: cut.hex, cell: round2(cell), ox: round2(mod(mapX + (cut.x + 0.5) * k, per.x)), oy: round2(mod(mapY + (cut.y + 0.5) * k, per.y)) };
}
