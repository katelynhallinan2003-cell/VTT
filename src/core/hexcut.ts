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
import { CLIP, FEATHER, WORK_SIDE, exact, luma, medianAbs, round2, scaleCut, shrink, thickness, type Found, type GridCut, type Lum, type PixelImage } from './gridcut';

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
  /** across each family, one number per pixel of distance: how much darker (or lighter) the pixels are than BOTH their neighbours either side, averaged along the line, with the picture's own level taken off */
  prof: Float32Array[];
  /** the whole-number distance each profile starts at */
  base: number[];
  noise: number[];
}

const clip = (v: number) => (v > CLIP ? CLIP : v < -CLIP ? -CLIP : v);

/**
 * The three families' profiles, for dark lines and for light ones. A pixel only counts when it differs from the pixels on BOTH sides of it
 * (so the edge of a wall, a shadow or the border of the map counts for nothing), and never for more than a set amount (so one black wall is
 * not worth ten grid lines).
 */
function profiles(L: Lum, W: number, H: number, shape: HexShape, d: number): { dark: Profiles; light: Profiles } {
  const ns = normals(shape);
  const dark: Profiles = { prof: [], base: [], noise: [] }, light: Profiles = { prof: [], base: [], noise: [] };
  for (const n of ns) {
    const dx = Math.round(d * n.x), dy = Math.round(d * n.y);
    const corners = [0, W - 1].flatMap((x) => [0, H - 1].map((y) => x * n.x + y * n.y));
    const lo = Math.floor(Math.min(...corners)), hi = Math.ceil(Math.max(...corners));
    const len = hi - lo + 1;
    const sd = new Float32Array(len), sl = new Float32Array(len), cnt = new Uint32Array(len);
    for (let y = 0; y < H; y++) {
      const ya = Math.max(0, Math.min(H - 1, y - dy)) * W, yb = Math.max(0, Math.min(H - 1, y + dy)) * W, yc = y * W;
      for (let x = 0; x < W; x++) {
        const xa = x - dx < 0 ? 0 : x - dx >= W ? W - 1 : x - dx;
        const xb = x + dx < 0 ? 0 : x + dx >= W ? W - 1 : x + dx;
        const a = L[ya + xa], b = L[yb + xb], c = L[yc + x];
        const bin = Math.round(x * n.x + y * n.y) - lo;
        sd[bin] += clip((a < b ? a : b) - c);
        sl[bin] += clip(c - (a > b ? a : b));
        cnt[bin]++;
      }
    }
    for (const [sum, out] of [[sd, dark], [sl, light]] as const) {
      const p = new Float32Array(len);
      for (let i = 0; i < len; i++) p[i] = cnt[i] ? sum[i] / cnt[i] : 0;
      // ground that is not a line scores a little under zero (it is rarely darker than both sides): take that level off
      const level = Float32Array.from(p).sort()[len >> 1];
      for (let i = 0; i < len; i++) p[i] = cnt[i] ? p[i] - level : 0;
      out.prof.push(p); out.base.push(lo); out.noise.push(medianAbs(p));
    }
  }
  return { dark, light };
}

/** Whether the lines are darker (1) or lighter (-1) than the ground: the side with the bigger peaks. */
function polarity(P: { dark: Profiles; light: Profiles }): number {
  const top = (prof: Float32Array[]) => prof.reduce((s, p) => { const v = Float32Array.from(p).sort(); return s + v[Math.floor(v.length * 0.99)]; }, 0);
  return top(P.dark.prof) >= top(P.light.prof) ? 1 : -1;
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

/** How strongly each side of each hex shows, for the three directions the sides run in. */
interface SideStats {
  /** one number per side looked at: how much darker (or lighter) the side is than the ground on BOTH sides of it */
  values: number[][];
  /** the average of those, over the three directions */
  mean: number;
}

/** Look at a spread of hex sides across the picture (only sides that are wholly inside it), a handful of points along each. */
function sideStats(L: Lum, W: number, H: number, cut: Pick<GridCut, 'p' | 'x' | 'y'>, shape: HexShape, d: number, sign: number): SideStats {
  const all = hexSides(cut, shape, W, H);
  // sides come in threes (one of each direction per hex): step over whole hexes so each direction gets the same share
  const stride = Math.max(1, Math.floor(all.length / 3 / 700)) * 3;
  const values: number[][] = [[], [], []];
  const px = (x: number, y: number) => L[Math.round(y) * W + Math.round(x)];
  const m = d + 1;
  for (let i = 0; i < all.length; i += stride) {
    for (let o = 0; o < 3 && i + o < all.length; o++) {
      const [a, b] = all[i + o];
      if (Math.min(a.x, b.x) < m || Math.min(a.y, b.y) < m || Math.max(a.x, b.x) >= W - m || Math.max(a.y, b.y) >= H - m) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = (-(b.y - a.y) / len) * d, ny = ((b.x - a.x) / len) * d;
      let sum = 0;
      for (const t of SIDE_POINTS) {
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const u = px(x + nx, y + ny), v = px(x - nx, y - ny), c = px(x, y);
        sum += clip(sign === 1 ? (u < v ? u : v) - c : c - (u > v ? u : v));
      }
      values[o].push(sum / SIDE_POINTS.length);
    }
  }
  const n = values[0].length + values[1].length + values[2].length;
  return { values, mean: n ? values.reduce((s, v) => s + v.reduce((q, w) => q + w, 0), 0) / n : -Infinity };
}
const SIDE_POINTS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

/**
 * How sure we are that these hexes are printed on the picture, from 0 to 10 (the same scale the square finder uses).
 * It is the part of the hexes' sides that really are drawn, in whichever of the three directions has the fewest, less the part that
 * would pass for drawn anywhere in the picture by luck (found by looking at the same hexes moved off to where no line can be).
 * A square grid has lines in one of the three directions only, so it scores nothing.
 */
function hexStrength(L: Lum, W: number, H: number, cut: Pick<GridCut, 'p' | 'x' | 'y'>, shape: HexShape, d: number, sign: number): { strength: number; contrast: number } {
  const on = sideStats(L, W, H, cut, shape, d, sign);
  const off = sideStats(L, W, H, { p: cut.p, x: cut.x + cut.p / 4, y: cut.y + cut.p / 4 }, shape, d, sign);
  const flat = on.values.flat().sort((a, b) => a - b);
  if (flat.length < 30) return { strength: 0, contrast: 0 };
  // a side is "drawn" when it stands out at least 40% as much as a clearly drawn one does
  const ref = flat[Math.floor(flat.length * 0.7)];
  const thr = Math.max(MIN_CONTRAST_HEX * 1.5, ref * 0.4);
  const part = (v: number[]) => (v.length ? v.filter((x) => x >= thr).length / v.length : 0);
  let least = 1;
  for (let o = 0; o < 3; o++) least = Math.min(least, part(on.values[o]) - part(off.values[o]));
  const drawn = flat.filter((x) => x >= thr);
  return { strength: Math.max(0, least) * 10, contrast: drawn.length ? drawn[drawn.length >> 1] : 0 };
}

/** Search one orientation. `hint` is the spacing you expect (pixels of this picture between hex centres), or none to try them all. */
function findOne(L: Lum, W: number, H: number, shape: HexShape, hint?: number, narrow = 0.07): Found | null {
  const d = hint ? Math.max(3, Math.min(8, Math.round(hint * 0.07))) : 5;
  // which way the lines go (dark or light) comes from a first look
  const both = profiles(L, W, H, shape, d);
  const sign = polarity(both);
  const P = sign === 1 ? both.dark : both.light;
  const lo = hint ? hint * (1 - narrow) : 24;
  const hi = hint ? hint * (1 + narrow) : Math.min(W, H) / 6;
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
  const offs = [mod(fine.ub + fine.uc + P.base[1] + P.base[2] - P.base[0], q), fine.ub, fine.uc];
  const per = P.prof.map((pr, i) => exact(pr, q, offs[i]) / P.noise[i]);
  const raw = P.prof.map((pr, i) => exact(pr, q, offs[i]));
  if (Math.min(...per) < 1.8 || Math.min(...raw) < MIN_CONTRAST_HEX * 0.5) return null;
  // a point where lines of the three families cross: solve  Q.nb = ob,  Q.nc = oc
  const [, nb, nc] = normals(shape);
  const det = nb.x * nc.y - nb.y * nc.x;
  const Q = { x: (ob * nc.y - oc * nb.y) / det, y: (nb.x * oc - nc.x * ob) / det };
  // the crossings are hex corners (two in three) and hex centres (one in three): walk along a line to find which, by seeing where the sides are drawn
  const s = fine.p / S3;
  const tb = { x: -nb.y, y: nb.x };
  const t = Math.max(1, Math.min(12, (thickness(P.prof[0], q, offs[0]) + thickness(P.prof[1], q, offs[1]) + thickness(P.prof[2], q, offs[2])) / 3));
  const reach = Math.max(2, Math.round(t) + 2);
  let top: { cut: GridCut; score: number } | null = null;
  for (let j = 0; j < 3; j++) {
    const C = { x: Q.x + tb.x * s * j, y: Q.y + tb.y * s * j };
    const origin = shape === 'pointy' ? { x: C.x - fine.p / 2, y: C.y - fine.p / S3 } : { x: C.x - fine.p / S3, y: C.y - fine.p / 2 };
    const box = shape === 'pointy' ? { x: fine.p, y: fine.p * S3 } : { x: fine.p * S3, y: fine.p };
    const cut: GridCut = { on: true, p: round2(fine.p), x: round2(mod(origin.x, box.x)), y: round2(mod(origin.y, box.y)), t: round2(t), hex: shape };
    const sc = sideStats(L, W, H, cut, shape, reach, sign).mean;
    if (!top || sc > top.score) top = { cut, score: sc };
  }
  if (!top) return null;
  const sure = hexStrength(L, W, H, top.cut, shape, reach, sign);
  // the sides have to be there in all three directions, and stand out enough to be worth hiding
  const found: Found | null = sure.strength < 1.5 || sure.contrast < MIN_CONTRAST_HEX * 1.5 ? null : { cut: top.cut, strength: round2(sure.strength) };
  if (hint) return found;
  // looking at every spacing, twice (or three times) the real one scores just as well on the lines alone, but hexes that size do not have
  // their sides on drawn lines. So the half and third sizes are looked at too, and the smallest that fits nearly as well as the best is the answer.
  let pick = found;
  for (const k of [2, 3]) {
    if (top.cut.p / k < 24) continue;
    const sub = findOne(L, W, H, shape, top.cut.p / k);
    if (sub && (!pick || sub.strength > pick.strength * 0.8)) pick = sub;
  }
  return pick;
}

/**
 * Look for a hex grid printed on the picture. `shape` is the orientation to look for first; the other one is tried if nothing is found.
 * `hint` is the spacing you expect between hex centres in pixels of this picture. Returns null when nothing regular enough is there.
 * `strength` runs from 0 to 10, like the square finder's.
 */
export function findHexGrid(img: PixelImage, hint?: number, shape: HexShape = 'pointy'): Found | null {
  const { width: W0, height: H0 } = img;
  if (W0 < 80 || H0 < 80) return null;
  const L0 = luma(img);
  // the search is done on a copy of a sensible size (quicker, and thick lines on a huge map become ordinary ones) ...
  const f = Math.max(1, Math.ceil(Math.max(W0, H0) / WORK_SIDE));
  const small = f > 1 ? shrink(L0, W0, H0, f) : { L: L0 as Lum, W: W0, H: H0 };
  const other: HexShape = shape === 'pointy' ? 'flat' : 'pointy';
  // look both ways: lines that are not really hexes can still pass for them the wrong way round, so the better fit wins
  const a = findOne(small.L, small.W, small.H, shape, hint ? hint / f : undefined);
  const b = findOne(small.L, small.W, small.H, other, hint ? hint / f : undefined);
  const best = a && b ? (b.strength > a.strength * 1.1 ? b : a) : a ?? b;
  if (!best || f === 1) return best;
  // ... and then the lines are measured again on the picture itself, close to where the small copy put them
  return findOne(L0, W0, H0, best.cut.hex!, best.cut.p * f, 0.02) ?? { cut: scaleCut(best.cut, f), strength: best.strength };
}

/**
 * Fill the hex sides in from the pixels around them, on a copy of the picture's pixels (changed in place).
 * Like the square version it works to a fraction of a pixel: pixels on a side are replaced, pixels just beyond it only partly (so no
 * seam is left), and the colour comes from the nearest pixels outside in all eight directions, each averaged with the one after it.
 */
export function hideHexGrid(img: PixelImage, cut: Pick<GridCut, 'p' | 'x' | 'y' | 't' | 'hex'>): void {
  const { width: W, height: H, data } = img;
  const shape = cut.hex ?? 'pointy';
  const half = Math.max(0.5, cut.t / 2) + 0.5;
  const reach = half + FEATHER;
  // how much of each pixel is covered by a side (0 to 255): all of it on the side, fading out beyond
  const cov = new Uint8Array(W * H);
  for (const [a, b] of hexSides(cut, shape, W, H)) {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) + reach + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - reach - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) + reach + 1));
    const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0;
        const d = Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t));
        if (d > reach) continue;
        const c = Math.round(255 * (d <= half ? 1 : 1 - (d - half) / FEATHER));
        if (c > cov[y * W + x]) cov[y * W + x] = c;
      }
    }
  }
  const src = Uint8ClampedArray.from(data);
  const R = Math.ceil(reach) * 2 + 4;
  const dirs: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const w0 = cov[y * W + x];
      if (!w0) continue;
      let r = 0, g = 0, b = 0, w = 0;
      for (const [dx, dy, len] of dirs) {
        for (let k = 1; k <= R; k++) {
          const xx = x + dx * k, yy = y + dy * k;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) break;
          const j = yy * W + xx;
          if (cov[j]) continue;
          const wt = 1 / ((k * len) * (k * len));
          let o = j * 4;
          let pr = src[o], pg = src[o + 1], pb = src[o + 2];
          // the pixel after it, if that is clear too, so one speck does not get copied
          const x2 = xx + dx, y2 = yy + dy;
          if (x2 >= 0 && y2 >= 0 && x2 < W && y2 < H && !cov[y2 * W + x2]) {
            o = (y2 * W + x2) * 4;
            pr = (pr + src[o]) / 2; pg = (pg + src[o + 1]) / 2; pb = (pb + src[o + 2]) / 2;
          }
          r += pr * wt; g += pg * wt; b += pb * wt; w += wt;
          break;
        }
      }
      if (w > 0) {
        const a = w0 / 255;
        const o = (y * W + x) * 4;
        data[o] = src[o] * (1 - a) + (r / w) * a;
        data[o + 1] = src[o + 1] * (1 - a) + (g / w) * a;
        data[o + 2] = src[o + 2] * (1 - a) + (b / w) * a;
      }
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
