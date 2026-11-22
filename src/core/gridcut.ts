// Finding and hiding the grid that is printed on a map picture.
//
// A printed grid is a set of thin lines, evenly spaced, running straight across the picture. We look for them by
// comparing every column (and row) of the picture with the pixels a few steps to either side of it: ground that is
// the same all along the column cancels out, and a line shows up as a steady difference. Then we search for the
// spacing and offset where those differences line up best. Hiding the lines means filling each one in from the
// pixels right beside it, so the picture itself is never changed: only the copy on screen.
//
// This file is for squares (see hexcut.ts for hexes). Everything here works on plain pixel arrays so it can be tested without a browser.

export interface PixelImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Where the lines are, in pixels of the picture it was found in.
 * For squares: `p` is the distance between lines, a vertical line passes through `x` and a horizontal one through `y`.
 * For hexes (`hex` is set): `p` is the distance between the centres of two neighbouring hexes, and (`x`, `y`) is the top-left corner
 * of the box around the hex at the origin, the same way the app's own hex grid is described.
 */
export interface GridCut {
  /** hidden right now */
  on: boolean;
  /** distance between lines (squares) or between hex centres (hexes) */
  p: number;
  x: number;
  y: number;
  /** how thick the lines are */
  t: number;
  /** the lines are the edges of hexes: with a point at the top ('pointy') or a flat top ('flat') */
  hex?: 'pointy' | 'flat';
}

export interface Found {
  cut: GridCut;
  /** how much stronger the lines are than the rest of the picture (higher is surer) */
  strength: number;
}

export const luma = (img: PixelImage): Uint8Array => {
  const n = img.width * img.height;
  const L = new Uint8Array(n);
  const d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return L;
};

/**
 * Across each column: how much darker (positive) or lighter (negative) it is than the columns `d` steps either side, averaged down the picture.
 * Rows the same way. Picture that is the same all along cancels out; a printed line does not.
 */
export function contrastProfiles(img: PixelImage, d: number): { col: Float32Array; row: Float32Array } {
  const { width: W, height: H } = img;
  const L = luma(img);
  const col = new Float32Array(W);
  const row = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      const a = L[o + (x - d < 0 ? 0 : x - d)];
      const b = L[o + (x + d >= W ? W - 1 : x + d)];
      col[x] += (a + b) / 2 - L[o + x];
    }
  }
  for (let x = 0; x < W; x++) col[x] /= H;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    const oa = (y - d < 0 ? 0 : y - d) * W;
    const ob = (y + d >= H ? H - 1 : y + d) * W;
    let s = 0;
    for (let x = 0; x < W; x++) s += (L[oa + x] + L[ob + x]) / 2 - L[o + x];
    row[y] = s / W;
  }
  return { col, row };
}

export const medianAbs = (a: Float32Array): number => {
  const v = Float32Array.from(a, Math.abs).sort();
  return v[v.length >> 1] || 1e-3;
};

/** Average strength of a profile at x = o, o+p, o+2p… (looking one step either side to allow for rounding). */
function comb(prof: Float32Array, p: number, o: number): number {
  const n = prof.length;
  let sum = 0, cnt = 0;
  for (let c = o; c < n; c += p) {
    const i = Math.round(c);
    if (i < 1 || i >= n - 1) continue;
    const a = prof[i - 1], b = prof[i], e = prof[i + 1];
    sum += a > b ? (a > e ? a : e) : b > e ? b : e;
    cnt++;
  }
  return cnt >= 3 ? sum / cnt : -Infinity;
}

function bestOffset(prof: Float32Array, p: number): { o: number; s: number } {
  let o = 0, s = -Infinity;
  const step = p > 40 ? 1 : 0.5;
  for (let k = 0; k < p; k += step) {
    const v = comb(prof, p, k);
    if (v > s) { s = v; o = k; }
  }
  return { o, s };
}

/**
 * Look for a printed grid. `hint` is the spacing you expect (in pixels of this picture): with it we only try spacings close to it.
 * Without it every spacing from 12 pixels up is tried. Returns null when nothing regular enough is there.
 */
export function findGrid(img: PixelImage, hint?: number): Found | null {
  const { width: W, height: H } = img;
  if (W < 60 || H < 60) return null;
  const d = hint ? Math.max(3, Math.min(8, Math.round(hint * 0.07))) : 5;
  const { col, row } = contrastProfiles(img, d);
  const nc = medianAbs(col), nr = medianAbs(row);
  const maxP = Math.min(W, H) / 3;
  const lo = hint ? hint * 0.93 : 12;
  const hi = hint ? hint * 1.07 : maxP;
  if (hi <= lo) return null;
  type Cand = { p: number; sign: number; ox: number; oy: number; score: number; sx: number; sy: number; ax: number; ay: number };
  const cands: Cand[] = [];
  for (const sign of [1, -1]) {
    const pc = sign === 1 ? col : Float32Array.from(col, (v) => -v);
    const pr = sign === 1 ? row : Float32Array.from(row, (v) => -v);
    const grow = 1 + (hint ? Math.max(0.00005, 0.4 / Math.max(W, H)) : 0.0008);
    for (let p = lo; p <= hi; p *= grow) {
      const a = bestOffset(pc, p), b = bestOffset(pr, p);
      if (!Number.isFinite(a.s) || !Number.isFinite(b.s)) continue;
      cands.push({ p, sign, ox: a.o, oy: b.o, sx: a.s / nc, sy: b.s / nr, ax: a.s, ay: b.s, score: a.s / nc + b.s / nr });
    }
  }
  if (!cands.length) return null;
  let best = cands[0];
  for (const c of cands) if (c.score > best.score) best = c;
  // a spacing of 2p or 3p scores as well as p does: take the smallest one that is nearly as good
  for (const c of cands) if (c.p < best.p * 0.97 && c.sign === best.sign && c.score >= best.score * 0.93) {
    const ratio = best.p / c.p;
    if (Math.abs(ratio - Math.round(ratio)) < 0.03 && Math.round(ratio) >= 2) best = c;
  }
  // both directions need to show clear lines
  // (and strong in plain terms too: a line a couple of shades off the ground is not worth hiding, and texture alone can look like one)
  if (best.sx < 3 || best.sy < 3 || best.ax < MIN_CONTRAST || best.ay < MIN_CONTRAST) return null;
  const pc = best.sign === 1 ? col : Float32Array.from(col, (v) => -v);
  const pr = best.sign === 1 ? row : Float32Array.from(row, (v) => -v);
  // the search above forgives a pixel either way; now pin the spacing and offsets down to a fraction of a pixel
  const fine = refine(pc, pr, best.p, best.ox, best.oy);
  best = { ...best, ...wholeSpacing(pc, pr, fine) };
  // measure where the lines really are and fit the spacing to them: it keeps lines far from the first one on target
  const fx = fitSpacing(pc, best.p, best.ox), fy = fitSpacing(pr, best.p, best.oy);
  if (fx && fy && fx.rms < 0.8 && fy.rms < 0.8 && Math.abs(fx.p - fy.p) < best.p * 0.003 && Math.abs((fx.p * fx.n + fy.p * fy.n) / (fx.n + fy.n) - best.p) < best.p * 0.004) {
    best = { ...best, p: (fx.p * fx.n + fy.p * fy.n) / (fx.n + fy.n) };
  }
  const t = Math.max(1, Math.min(12, (thickness(pc, best.p, best.ox) + thickness(pr, best.p, best.oy)) / 2));
  // put the offset on the middle of the line rather than on its strongest pixel
  const x = centre(pc, best.p, best.ox), y = centre(pr, best.p, best.oy);
  return { cut: { on: true, p: round2(best.p), x: round2(x), y: round2(y), t: round2(t) }, strength: Math.min(best.sx, best.sy) };
}

/** Brightness levels (0 to 255) a line has to differ from the ground by before we call it a grid. */
export const MIN_CONTRAST = 3;

/**
 * Looking for lines near an expected spacing can land on half of the real one (or a third), where every other line is missing.
 * If lines at 2x, 3x or 4x the spacing are clearly stronger on average than at 1x, that is the real spacing.
 */
function wholeSpacing(pc: Float32Array, pr: Float32Array, f: { p: number; ox: number; oy: number }): { p: number; ox: number; oy: number } {
  const base = exact(pc, f.p, f.ox) + exact(pr, f.p, f.oy);
  let out = f;
  let top = base;
  for (let k = 2; k <= 4; k++) {
    let sx = -Infinity, jx = 0, sy = -Infinity, jy = 0;
    for (let j = 0; j < k; j++) {
      const a = exact(pc, f.p * k, f.ox + j * f.p); if (a > sx) { sx = a; jx = j; }
      const b = exact(pr, f.p * k, f.oy + j * f.p); if (b > sy) { sy = b; jy = j; }
    }
    // a true spacing of k*p has all of its lines strong, so its average is about k times that of p; random variation never gets near 1.4
    if (sx + sy > base * 1.4 && sx + sy > top * 1.4) { out = { p: f.p * k, ox: f.ox + jx * f.p, oy: f.oy + jy * f.p }; top = sx + sy; }
  }
  return out;
}

/**
 * Where each line's middle really is, fitted with a straight line (position = start + number * spacing). The slope is the spacing,
 * true to a small fraction of a pixel however many lines there are. Null when the lines do not sit on a straight comb well enough to trust.
 */
export function fitSpacing(prof: Float32Array, p: number, o: number): { p: number; n: number; rms: number } | null {
  const ks: number[] = [], ys: number[] = [];
  for (let k = 0; ; k++) {
    const c = o + k * p;
    const i = Math.round(c);
    if (i >= prof.length - 4) break;
    if (i < 4) continue;
    // the strength-weighted middle of the line, with the level of the ground beside it taken off
    let floor = Infinity;
    for (let j = i - 4; j <= i + 4; j++) if (prof[j] < floor) floor = prof[j];
    let w = 0, m = 0;
    for (let j = i - 3; j <= i + 3; j++) { const v = Math.max(0, prof[j] - Math.max(0, floor)); w += v; m += v * j; }
    if (w <= 0) continue;
    ks.push(k); ys.push(m / w);
  }
  const n = ks.length;
  if (n < 4) return null;
  const mk = ks.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (ks[i] - mk) ** 2; sxy += (ks[i] - mk) * (ys[i] - my); }
  if (sxx <= 0) return null;
  const slope = sxy / sxx, icpt = my - slope * mk;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - (icpt + slope * ks[i])) ** 2;
  return { p: slope, n, rms: Math.sqrt(ss / n) };
}

/** Strength of a profile at a point between two pixels. */
export const at = (prof: Float32Array, x: number): number => {
  if (x < 0 || x > prof.length - 1) return 0;
  const i = Math.floor(x), f = x - i;
  return prof[i] * (1 - f) + prof[Math.min(prof.length - 1, i + 1)] * f;
};

export function exact(prof: Float32Array, p: number, o: number): number {
  let sum = 0, cnt = 0;
  for (let c = o; c < prof.length - 1; c += p) { sum += at(prof, c); cnt++; }
  return cnt ? sum / cnt : -Infinity;
}

function refine(pc: Float32Array, pr: Float32Array, p0: number, ox0: number, oy0: number): { p: number; ox: number; oy: number } {
  let best = { p: p0, ox: ox0, oy: oy0, s: -Infinity };
  for (let k = -60; k <= 60; k++) {
    const p = p0 * (1 + k * 0.00015);
    let sx = -Infinity, ox = ox0, sy = -Infinity, oy = oy0;
    for (let d = -1.5; d <= 1.5; d += 0.1) {
      const a = exact(pc, p, ox0 + d); if (a > sx) { sx = a; ox = ox0 + d; }
      const b = exact(pr, p, oy0 + d); if (b > sy) { sy = b; oy = oy0 + d; }
    }
    if (sx + sy > best.s) best = { p, ox, oy, s: sx + sy };
  }
  return best;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** How many pixels wide the lines are (counting those that are at least 40% as strong as the peak). */
export function thickness(prof: Float32Array, p: number, o: number): number {
  const widths: number[] = [];
  for (let c = o; c < prof.length; c += p) {
    const i = Math.round(c);
    if (i < 2 || i >= prof.length - 2) continue;
    let pk = i;
    for (let k = i - 1; k <= i + 1; k++) if (prof[k] > prof[pk]) pk = k;
    const lim = prof[pk] * 0.4;
    if (lim <= 0) continue;
    let w = 1;
    for (let k = pk - 1; k >= 0 && prof[k] >= lim; k--) w++;
    for (let k = pk + 1; k < prof.length && prof[k] >= lim; k++) w++;
    widths.push(w);
  }
  if (!widths.length) return 2;
  widths.sort((a, b) => a - b);
  return widths[widths.length >> 1];
}

/** The strength-weighted middle of the line near each comb position, averaged, so the offset sits on the line's centre. */
export function centre(prof: Float32Array, p: number, o: number): number {
  let sum = 0, cnt = 0;
  for (let c = o; c < prof.length; c += p) {
    const i = Math.round(c);
    if (i < 3 || i >= prof.length - 3) continue;
    let w = 0, m = 0;
    for (let k = i - 3; k <= i + 3; k++) { const v = Math.max(0, prof[k]); w += v; m += v * k; }
    if (w > 0) { sum += m / w - c; cnt++; }
  }
  return o + (cnt ? sum / cnt : 0);
}

/** How far past a line's own width (in pixels) the fill fades out, so the soft edge a printed line has is covered as well and no seam is left. */
export const FEATHER = 1.5;
/** How many pixels on each side are averaged to make the colour a line is filled with. */
export const FILL_BAND = 3;

/**
 * Fill the lines in, on a copy of the picture's pixels (changed in place).
 *
 * Each line is worked out to a fraction of a pixel. Every pixel on it is replaced by a blend between the average of a few
 * pixels just outside it on one side and the same on the other (a single neighbour would copy its speck of noise, and one
 * that is still part of the line's soft edge would leave a faint streak). Pixels at the edge of the zone are only partly
 * replaced, so no seam shows where the fill ends.
 */
export function hideGrid(img: PixelImage, cut: Pick<GridCut, 'p' | 'x' | 'y' | 't'>): void {
  const { width: W, height: H } = img;
  // down the vertical lines, then across the horizontal ones (the crossings are filled from rows that are already clean)
  fillLines(img.data, { along: H, alongStride: W * 4, across: W, acrossStride: 4 }, cut.x, cut.p, cut.t);
  fillLines(img.data, { along: W, alongStride: 4, across: H, acrossStride: W * 4 }, cut.y, cut.p, cut.t);
}

interface Axis {
  /** pixels along a line, and how far apart they are in the data */
  along: number;
  alongStride: number;
  /** pixels across the picture in the direction the lines are spaced in, and the data distance between them */
  across: number;
  acrossStride: number;
}

function fillLines(data: Uint8ClampedArray | Uint8Array, ax: Axis, first: number, p: number, t: number): void {
  const half = Math.max(0.5, t / 2) + 0.5;
  const reach = half + FEATHER;
  // where the pixels the fill is taken from begin (kept clear of the next line when the lines are close)
  const gap = Math.max(1, Math.min(reach, p / 2 - 1.5));
  const n = Math.max(1, Math.min(FILL_BAND, Math.floor(p / 2 - gap)));
  const { along, alongStride, across, acrossStride } = ax;
  const px = new Float32Array(3);
  // c walks over every line that could touch the picture (a line starting before it, as well)
  let c = first - Math.ceil((first + reach) / p) * p;
  for (; c < across + reach; c += p) {
    if (c + reach < 0 || c - reach > across - 1) continue;
    const lo = Math.round(c - gap - n + 1), hi = Math.round(c - gap);
    const lo2 = Math.round(c + gap), hi2 = Math.round(c + gap + n - 1);
    const x0 = Math.max(0, Math.ceil(c - reach)), x1 = Math.min(across - 1, Math.floor(c + reach));
    for (let i = 0; i < along; i++) {
      const row = i * alongStride;
      // the average colour just outside the line on each side
      const sideL = new Float32Array(3), sideR = new Float32Array(3);
      let nl = 0, nr = 0;
      for (let k = Math.max(0, lo); k <= Math.min(across - 1, hi); k++) { const q = row + k * acrossStride; sideL[0] += data[q]; sideL[1] += data[q + 1]; sideL[2] += data[q + 2]; nl++; }
      for (let k = Math.max(0, lo2); k <= Math.min(across - 1, hi2); k++) { const q = row + k * acrossStride; sideR[0] += data[q]; sideR[1] += data[q + 1]; sideR[2] += data[q + 2]; nr++; }
      if (!nl && !nr) continue;
      for (let k = 0; k < 3; k++) { if (nl) sideL[k] /= nl; if (nr) sideR[k] /= nr; }
      for (let x = x0; x <= x1; x++) {
        const d = Math.abs(x - c);
        const w = d <= half ? 1 : Math.max(0, 1 - (d - half) / FEATHER);
        if (w <= 0) continue;
        // along the stretch between the two sides the fill slides from one colour to the other
        const f = nl && nr ? Math.min(1, Math.max(0, (x - (c - gap)) / (2 * gap))) : nl ? 0 : 1;
        const q = row + x * acrossStride;
        for (let k = 0; k < 3; k++) {
          px[k] = (nl && nr ? sideL[k] * (1 - f) + sideR[k] * f : nl ? sideL[k] : sideR[k]);
          data[q + k] = data[q + k] * (1 - w) + px[k] * w;
        }
      }
    }
  }
}

/** The same lines, for a picture that is `k` times as big (or small) as the one they were found in. */
export const scaleCut = (c: GridCut, k: number): GridCut => ({ ...c, p: c.p * k, x: c.x * k, y: c.y * k, t: Math.max(1, c.t * k) });
