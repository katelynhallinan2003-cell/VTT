// Finding and hiding the grid that is printed on a map picture.
//
// A printed grid is a set of thin lines, evenly spaced, running straight across the picture. Real maps make that hard to see:
// walls and the edges of rooms are far stronger than the grid, the grid is often only drawn on the floor, furniture sits on
// top of it, and the lines can be dashes, corner marks or barely there. So the finder works in four steps:
//
//  1. The picture is cut into bands. In each band every column is compared with the pixels a few steps to either side, and
//     only counts when it is darker (or lighter) than BOTH sides: that is what a thin line looks like, and it is what an edge
//     (a wall, a shadow, the border of the map) does not look like.
//  2. Each band names the columns where it sees a line. A real grid line is seen by many bands; a wall or a table by one or two.
//     So one big feature cannot outvote the grid, however strong it is.
//  3. Every spacing is tried against that list of lines and marked on two things at once: how much of what was seen lies on the
//     spacing, and how many of the spacing's own lines were seen. Twice the real spacing explains only half of what was seen and
//     half the real spacing has every other line missing, so the real one wins without any special rule.
//  4. The spacing and where the lines start are then fitted to the measured middle of every line, to a small fraction of a pixel.
//
// Hiding the lines means filling each one in from the pixels right beside it, so the picture itself is never changed: only the
// copy on screen. This file is for squares (see hexcut.ts for hexes). Everything works on plain pixel arrays so it can be tested
// without a browser.

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
  /** how sure we are, from 0 to 10: see AUTO_GRID_STRENGTH in mapgrid.ts for what counts as "clearly there" */
  strength: number;
  /** what the answer rests on (for tests and for working out why a map went wrong) */
  info?: GridInfo;
}

export interface GridInfo {
  /** how many of the grid's lines were seen, up and down and across */
  linesX: number;
  linesY: number;
  /** of everything line-like that was seen, the part that lies on the grid (0 to 1) */
  explained: number;
  /** of the grid's own lines between the first and last one seen, the part that was seen (0 to 1) */
  present: number;
  /** the part of the picture the grid reaches over (0 to 1) */
  cover: number;
  /** how many brightness levels the lines differ from the ground beside them */
  contrast: number;
  /** the lines only showed when bigger parts of the picture were averaged together */
  faint?: boolean;
}

export const luma = (img: PixelImage): Uint8Array => {
  const n = img.width * img.height;
  const L = new Uint8Array(n);
  const d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return L;
};

export const medianAbs = (a: Float32Array): number => {
  const v = Float32Array.from(a, Math.abs).sort();
  return v[v.length >> 1] || 1e-3;
};

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

// ------------------------------------------------------------------ finding

/** Brightness levels (0 to 255) a line has to differ from the ground beside it before we call it a grid. */
export const MIN_CONTRAST = 3;
/** The search is done on a copy no bigger than this on its long side: quicker, and very thick lines on huge maps become ordinary ones. */
export const WORK_SIDE = 2048;
/** How far to either side a pixel is compared with (in the working copy). Lines up to about twice this wide are seen. */
const REACH = 5;
/** One pixel never counts for more than this many levels, so a black wall is not worth ten grid lines. */
export const CLIP = 64;
/** A band sees a line where its profile stands this many times above its own unevenness. */
const PEAK_SIGMA = 4.5;
/** How far (pixels) a seen line may be from where the spacing puts it and still count as on it. */
const TOL = 1.5;

export type Lum = Uint8Array | Float32Array;

/** A smaller copy: every `f` by `f` block of pixels becomes one, by averaging. */
export function shrink(L: Lum, W: number, H: number, f: number): { L: Float32Array; W: number; H: number } {
  const w = Math.floor(W / f), h = Math.floor(H / f);
  const out = new Float32Array(w * h);
  const k = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let yy = 0; yy < f; yy++) {
      const o = (y * f + yy) * W, oo = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0;
        const b = o + x * f;
        for (let xx = 0; xx < f; xx++) s += L[b + xx];
        out[oo + x] += s * k;
      }
    }
  }
  return { L: out, W: w, H: h };
}

/** What each band of the picture sees along one direction: one profile per band, for dark lines, for light lines, and a plain one for measuring width. */
interface Bands {
  /** length of each profile */
  n: number;
  dark: Float32Array[];
  light: Float32Array[];
  plain: Float32Array[];
}

const bandCount = (len: number) => Math.max(3, Math.min(16, Math.round(len / 120)));
const clip = (v: number) => (v > CLIP ? CLIP : v < -CLIP ? -CLIP : v);

/**
 * For lines running down the picture (`x`) and across it (`y`): the picture is cut into bands along the lines, and in each band
 * every position gets the average of how much darker it is than BOTH the pixels `d` steps either side of it (and how much lighter,
 * and the plain difference from their average). A thin line scores its full contrast; an edge between light and dark scores nothing.
 */
function bandProfiles(L: Lum, W: number, H: number, d: number): { x: Bands; y: Bands } {
  const mk = (n: number, S: number): Bands => ({ n, dark: Array.from({ length: S }, () => new Float32Array(n)), light: Array.from({ length: S }, () => new Float32Array(n)), plain: Array.from({ length: S }, () => new Float32Array(n)) });
  const Sx = bandCount(H), Sy = bandCount(W);
  const X = mk(W, Sx), Y = mk(H, Sy);
  const rows = new Uint32Array(Sx);
  for (let y = 0; y < H; y++) {
    const s = Math.min(Sx - 1, Math.floor((y * Sx) / H));
    rows[s]++;
    const dk = X.dark[s], lt = X.light[s], pl = X.plain[s];
    const o = y * W;
    for (let x = d; x < W - d; x++) {
      const a = L[o + x - d], b = L[o + x + d], c = L[o + x];
      dk[x] += clip((a < b ? a : b) - c);
      lt[x] += clip(c - (a > b ? a : b));
      pl[x] += clip((a + b) / 2 - c);
    }
  }
  for (let s = 0; s < Sx; s++) {
    const k = 1 / Math.max(1, rows[s]);
    for (let x = 0; x < W; x++) { X.dark[s][x] *= k; X.light[s][x] *= k; X.plain[s][x] *= k; }
  }
  const edges = Array.from({ length: Sy + 1 }, (_, s) => Math.floor((s * W) / Sy));
  for (let y = d; y < H - d; y++) {
    const oa = (y - d) * W, ob = (y + d) * W, oc = y * W;
    for (let s = 0; s < Sy; s++) {
      const x0 = edges[s], x1 = edges[s + 1];
      let sd = 0, sl = 0, sp = 0;
      for (let x = x0; x < x1; x++) {
        const a = L[oa + x], b = L[ob + x], c = L[oc + x];
        sd += clip((a < b ? a : b) - c);
        sl += clip(c - (a > b ? a : b));
        sp += clip((a + b) / 2 - c);
      }
      const k = 1 / Math.max(1, x1 - x0);
      Y.dark[s][y] = sd * k; Y.light[s][y] = sl * k; Y.plain[s][y] = sp * k;
    }
  }
  return { x: X, y: Y };
}

/** A line as one band sees it. */
interface Peak { pos: number; h: number; band: number }

const median = (v: Float32Array | number[]): number => {
  if (!v.length) return 0;
  const s = Float32Array.from(v).sort();
  return s[s.length >> 1];
};

/** The places where each band's profile stands clear of its own level: where, how high, and in which band. */
function findPeaks(profs: Float32Array[], n: number, d: number): Peak[] {
  const out: Peak[] = [];
  profs.forEach((prof, band) => {
    const body = prof.subarray(d, n - d);
    const med = median(body);
    const sigma = 1.4826 * median(Float32Array.from(body, (v) => Math.abs(v - med)));
    const thr = Math.max(PEAK_SIGMA * sigma, MIN_CONTRAST * 0.8);
    for (let i = d + 2; i < n - d - 2; i++) {
      const v = prof[i] - med;
      if (v < thr || !(prof[i] > prof[i - 1] && prof[i] >= prof[i + 1] && prof[i] > prof[i - 2] && prof[i] >= prof[i + 2])) continue;
      // the middle of the line: weighted by height, with the low skirt left out
      const base = med + v * 0.3;
      let w = 0, m = 0;
      for (let j = i - 3; j <= i + 3; j++) { const u = prof[j] - base; if (u > 0) { w += u; m += u * j; } }
      out.push({ pos: w > 0 ? m / w : i, h: v, band });
    }
  });
  return out;
}

/** A line as the whole picture sees it: where it is and how many bands saw it. */
interface Line { pos: number; w: number }

function gather(peaks: Peak[]): Line[] {
  const sorted = peaks.slice().sort((a, b) => a.pos - b.pos);
  const out: Line[] = [];
  let i = 0;
  while (i < sorted.length) {
    let sum = sorted[i].pos, cnt = 1, j = i + 1;
    const bands = new Set([sorted[i].band]);
    while (j < sorted.length && sorted[j].pos - sum / cnt <= 1.25) { sum += sorted[j].pos; cnt++; bands.add(sorted[j].band); j++; }
    out.push({ pos: sum / cnt, w: bands.size });
    i = j;
  }
  return out;
}

/** How well one spacing fits the lines seen along one direction. */
interface Comb {
  /** where a line of the spacing passes */
  o: number;
  /** how many of the spacing's lines were seen, and over how many in a row */
  hits: number;
  span: number;
  /** the part of what was seen that lies on the spacing, and the part of the spacing's lines that were seen (both with luck taken off) */
  explained: number;
  present: number;
  /** both at once: high only when the spacing explains what was seen AND its own lines are there */
  fit: number;
}

function comb(lines: Line[], total: number, len: number, p: number, tol: number): Comb | null {
  const n = lines.length;
  if (n < 3) return null;
  // the offset that most of the weight agrees on: slide a window over where each line falls within one spacing
  const idx = lines.map((_, i) => i);
  const res = lines.map((l) => ((l.pos % p) + p) % p);
  idx.sort((a, b) => res[a] - res[b]);
  let best = -1, bestI = 0, bestJ = 0, acc = 0, j = 0;
  for (let i = 0; i < n; i++) {
    if (j < i) { j = i; acc = 0; }
    while (j < i + n) {
      const r = res[idx[j % n]] + (j >= n ? p : 0);
      if (r - res[idx[i]] > 2 * tol) break;
      acc += lines[idx[j % n]].w;
      j++;
    }
    if (acc > best) { best = acc; bestI = i; bestJ = j; }
    acc -= lines[idx[i]].w;
  }
  let so = 0, sw = 0;
  for (let k = bestI; k < bestJ; k++) { const l = lines[idx[k % n]]; so += (res[idx[k % n]] + (k >= n ? p : 0)) * l.w; sw += l.w; }
  const o = (((so / sw) % p) + p) % p;
  // which of the spacing's lines were seen
  let hits = 0, kmin = Infinity, kmax = -Infinity, last = NaN, M = 0;
  for (const l of lines) {
    const k = Math.round((l.pos - o) / p);
    if (Math.abs(l.pos - o - k * p) > tol) continue;
    M += l.w;
    if (k !== last) { hits++; last = k; }
    if (k < kmin) kmin = k;
    if (k > kmax) kmax = k;
  }
  if (hits < 3) return null;
  const span = kmax - kmin + 1;
  // lines scattered at random would land on the spacing this often by luck alone: only what is beyond that counts
  const luckE = Math.min(0.9, (2 * tol) / p);
  const luckP = 1 - Math.exp((-n / len) * 2 * tol);
  const explained = Math.max(0, (M / total - luckE) / (1 - luckE));
  const present = Math.max(0, (hits / span - luckP) / (1 - luckP));
  return { o, hits, span, explained, present, fit: explained + present > 0 ? (2 * explained * present) / (explained + present) : 0 };
}

interface Match { p: number; x: Comb; y: Comb; score: number }

/** Try every spacing from `lo` to `hi` (each `step` times the last) on the lines seen both ways; the same spacing has to fit both. */
function search(X: Line[], Y: Line[], W: number, H: number, lo: number, hi: number, step: number, tol: number): Match | null {
  const tx = X.reduce((s, l) => s + l.w, 0), ty = Y.reduce((s, l) => s + l.w, 0);
  let best: Match | null = null;
  for (let p = lo; p <= hi; p *= step) {
    const x = comb(X, tx, W, p, tol);
    if (!x) continue;
    const y = comb(Y, ty, H, p, tol);
    if (!y) continue;
    const score = Math.sqrt(x.fit * y.fit);
    if (!best || score > best.score) best = { p, x, y, score };
  }
  return best;
}

/**
 * Pin the spacing and both starting points down from the measured middle of every line in every band (one straight-line fit for
 * the three numbers together). Lines seen in many bands count many times; a wall beside a line is too far off to be used.
 */
function fit(px: Peak[], py: Peak[], p0: number, ox0: number, oy0: number): { p: number; ox: number; oy: number; contrast: number } {
  let p = p0, ox = ox0, oy = oy0;
  const heights: number[] = [];
  for (const tol of [TOL, 1.1, 0.8]) {
    let num = 0, den = 0;
    const sums = [px, py].map((peaks, a) => {
      const o = a ? oy : ox;
      let S = 0, K = 0, Q = 0, U = 0, V = 0;
      for (const pk of peaks) {
        const k = Math.round((pk.pos - o) / p);
        if (Math.abs(pk.pos - o - k * p) > tol) continue;
        const w = Math.min(pk.h, CLIP / 2);
        S += w; K += w * k; Q += w * k * k; U += w * pk.pos; V += w * k * pk.pos;
        if (tol === 0.8) heights.push(pk.h);
      }
      if (S > 0) { num += V - (U * K) / S; den += Q - (K * K) / S; }
      return { S, K, U };
    });
    if (den <= 0) break;
    p = num / den;
    if (sums[0].S > 0) ox = (sums[0].U - p * sums[0].K) / sums[0].S;
    if (sums[1].S > 0) oy = (sums[1].U - p * sums[1].K) / sums[1].S;
  }
  return { p, ox: ((ox % p) + p) % p, oy: ((oy % p) + p) % p, contrast: median(heights) };
}

/** How wide the lines are: the average shape of a line across its width, from every band that saw it, measured where it is 40% as strong as its peak. */
function lineWidth(bands: Bands, peaks: Peak[], sign: number, p: number, o: number): number {
  const R = 14, Q = 4;
  const acc = new Float32Array(2 * R * Q + 1);
  let cnt = 0;
  for (const pk of peaks) {
    const k = Math.round((pk.pos - o) / p), c = o + k * p;
    if (Math.abs(pk.pos - c) > 0.8 || c < R + 1 || c > bands.n - R - 2) continue;
    const prof = bands.plain[pk.band];
    for (let j = 0; j < acc.length; j++) acc[j] += sign * at(prof, c + (j - R * Q) / Q);
    cnt++;
  }
  if (!cnt) return 2;
  let pk = 0;
  for (let j = (R - 2) * Q; j <= (R + 2) * Q; j++) if (acc[j] > pk) pk = acc[j];
  if (pk <= 0) return 2;
  let w = 0;
  for (let j = R * Q; j < acc.length && acc[j] >= pk * 0.4; j++) w++;
  for (let j = R * Q - 1; j >= 0 && acc[j] >= pk * 0.4; j--) w++;
  return w / Q;
}

/** The same bands joined in groups of `k`: more of the picture is averaged together, so fainter lines stand out (and big features count for more). */
function joinBands(b: Bands, k: number): Bands {
  const join = (profs: Float32Array[]) => {
    const out: Float32Array[] = [];
    for (let i = 0; i < profs.length; i += k) {
      const group = profs.slice(i, i + k);
      const m = new Float32Array(b.n);
      for (const g of group) for (let j = 0; j < b.n; j++) m[j] += g[j] / group.length;
      out.push(m);
    }
    return out;
  };
  return { n: b.n, dark: join(b.dark), light: join(b.light), plain: join(b.plain) };
}

interface Seen { sign: number; m: Match; X: Line[]; Y: Line[]; px: Peak[]; py: Peak[] }

/** The best spacing for what the bands see, looking for dark lines and for light lines apart. */
function look(B: { x: Bands; y: Bands }, W: number, H: number, d: number, lo: number, hi: number, step: number, only?: number, reduction = 1): Seen | null {
  let top: Seen | null = null;
  for (const sign of only ? [only] : [1, -1]) {
    const px = findPeaks(sign === 1 ? B.x.dark : B.x.light, W, d), py = findPeaks(sign === 1 ? B.y.dark : B.y.light, H, d);
    const X = gather(px), Y = gather(py);
    // Downsampling can weaken alternating thin lines where their centres straddle sample boundaries.
    // At native resolution, let all the recovered lines vote on the spacing within that repeat.
    for (let divisor = 1; divisor <= reduction && hi / divisor >= 8; divisor++) {
      const m = search(X, Y, W, H, Math.max(8, lo / divisor), hi / divisor, step, TOL);
      if (m && (!top || m.score > top.m.score)) top = { sign, m, X, Y, px, py };
    }
  }
  return top;
}

/**
 * Look for a printed square grid. Returns null when nothing regular enough is there.
 * `strength` runs from 0 to 10: it is high when nearly everything line-like in the picture lies on the grid, nearly all of the grid's
 * lines are there, and the grid reaches over most of the picture.
 */
export function findGrid(img: PixelImage): Found | null {
  const { width: W0, height: H0 } = img;
  if (W0 < 60 || H0 < 60) return null;
  const L0 = luma(img);
  const f = Math.max(1, Math.ceil(Math.max(W0, H0) / WORK_SIDE));
  const reduced = findAtResolution(L0, W0, H0, f);
  const faintRepeat = reduced?.info?.faint && reduced.info.explained > 0.85 && reduced.info.contrast >= 10;
  if ((reduced && !faintRepeat) || f === 1 || Math.max(W0, H0) > 2 * WORK_SIDE) return reduced;
  // A one-pixel stroke can disappear during averaging. Verify at native resolution on the bounded scan canvas.
  const native = findAtResolution(L0, W0, H0, 1);
  return native && (!reduced || native.strength > reduced.strength) ? native : reduced;
}

function findAtResolution(L0: Uint8Array, W0: number, H0: number, f: number): Found | null {
  const small = f > 1 ? shrink(L0, W0, H0, f) : { L: L0 as Lum, W: W0, H: H0 };
  const { W, H } = small;
  const B = bandProfiles(small.L, W, H, REACH);
  let full: { x: Bands; y: Bands } | null = f > 1 ? null : B;
  // lines that are faint on busy ground only stand out when more of the picture is averaged together: if nothing is found,
  // look again with the bands joined in twos, then in fours
  for (const join of [1, 2, 4]) {
    if (join > 1 && Math.min(B.x.dark.length, B.y.dark.length) / join < 1.5) break;
    const bands = join === 1 ? B : { x: joinBands(B.x, join), y: joinBands(B.y, join) };
    const seen = look(bands, W, H, REACH, 8, Math.min(W, H) / 3, 1.0015);
    if (!seen) continue;
    let { m, X, Y, px, py } = seen;
    let at0 = bands;
    let r = fit(px, py, m.p, m.x.o, m.y.o);
    if (f > 1) {
      // the search was on a small copy: measure the lines again on the picture itself, near where the small copy says they are
      full ??= bandProfiles(L0, W0, H0, REACH * f);
      at0 = join === 1 ? full : { x: joinBands(full.x, join), y: joinBands(full.y, join) };
      const again = look(at0, W0, H0, REACH * f, r.p * f * 0.985, r.p * f * 1.015, 1.0002, seen.sign, f);
      if (!again) continue;
      ({ m, X, Y, px, py } = again);
      r = fit(px, py, m.p, m.x.o, m.y.o);
    }
    // how the fitted grid does against everything that was seen
    const tx = X.reduce((s, l) => s + l.w, 0), ty = Y.reduce((s, l) => s + l.w, 0);
    const cx = comb(X, tx, W0, r.p, 1.1), cy = comb(Y, ty, H0, r.p, 1.1);
    if (!cx || !cy || r.contrast < MIN_CONTRAST) continue;
    const cover = Math.min(1, (cx.span * r.p) / W0) * Math.min(1, (cy.span * r.p) / H0);
    const info: GridInfo = { linesX: cx.hits, linesY: cy.hits, explained: Math.min(cx.explained, cy.explained), present: Math.min(cx.present, cy.present), cover, contrast: round2(r.contrast), faint: join > 1 };
    // a grid has its lines there, is a fair part of what looks like a line in the picture, and is more than a patch of floor tiles in one room;
    // with only a handful of lines to go on, it has to be nearly all there is
    const few = cx.hits + cy.hits < 8;
    if (info.present < (few ? 0.9 : 0.55) || info.explained < (few ? 0.6 : 0.25) || cover < 0.12) continue;
    let strength = 10 * Math.sqrt(cx.fit * cy.fit) * Math.max(0, Math.min(1, (cover - 0.1) / 0.4)) * Math.min(1, (cx.hits + cy.hits) / 8);
    // never sure enough to act without being asked: lines that only showed with the bands joined, squares too small to stand a token on,
    // or more squares across than any battle map has (that is a texture, like floor tiles, not a grid)
    if (join > 1 || r.p < 16 || Math.max(W0, H0) / r.p > 120) strength = Math.min(strength, 4);
    const t = Math.max(1, Math.min(12, (lineWidth(at0.x, px, seen.sign, r.p, r.ox) + lineWidth(at0.y, py, seen.sign, r.p, r.oy)) / 2));
    return { cut: { on: true, p: round2(r.p), x: round2(r.ox), y: round2(r.oy), t: round2(t) }, strength: round2(strength), info };
  }
  return null;
}

/** How far past a line's own width (in pixels) the fill fades out, so the soft edge a printed line has is covered as well and no seam is left. */
export const FEATHER = 1.5;
/** How many pixels on each side are averaged to make the colour a line is filled with. */
export const FILL_BAND = 3;

/**
 * Fill the lines in, on a copy of the picture's pixels (changed in place).
 *
 * Measure the dot rhythm before editing either axis. Then learn the RGB shift at each position across the stroke.
 */
export function hideGrid(img: PixelImage, cut: Pick<GridCut, 'p' | 'x' | 'y' | 't'>): void {
  if (![cut.p, cut.x, cut.y, cut.t].every(Number.isFinite) || cut.p < 2 || cut.t <= 0) return;
  const { width: W, height: H } = img;
  // down the vertical lines, then across the horizontal ones (the crossings are filled from rows that are already clean)
  const vertical = { along: H, alongStride: W * 4, across: W, acrossStride: 4 };
  const horizontal = { along: W, alongStride: 4, across: H, acrossStride: W * 4 };
  const verticalDots = dotPeriod(img.data, vertical, cut.x, cut.y, cut.p, cut.t);
  const horizontalDots = dotPeriod(img.data, horizontal, cut.y, cut.x, cut.p, cut.t);
  repairAxis(img.data, vertical, cut.x, cut.y, cut.p, cut.t, verticalDots);
  repairAxis(img.data, horizontal, cut.y, cut.x, cut.p, cut.t, horizontalDots);
}

interface Axis {
  /** pixels along a line, and how far apart they are in the data */
  along: number;
  alongStride: number;
  /** pixels across the picture in the direction the lines are spaced in, and the data distance between them */
  across: number;
  acrossStride: number;
}

/** Read the ink along parallel strokes. A dotted grid has a short repeating pulse with clear paper between dots. */
function dotPeriod(data: PixelImage['data'], ax: Axis, first: number, crossing: number, p: number, t: number): number {
  const flank = Math.ceil(t / 2) + 1;
  const centres: number[] = [];
  const step = Math.max(1, Math.ceil(ax.across / p / 64)) * p;
  for (let c = first + Math.ceil((flank - first) / p) * p; c < ax.across - flank - 1; c += step) centres.push(Math.round(c) * ax.acrossStride);
  if (centres.length < 5 || ax.along < 48) return 1;
  const brightness = (q: number) => (data[q] + 2 * data[q + 1] + data[q + 2]) / 4;
  const profile = new Float32Array(ax.along);
  const valid = new Uint8Array(ax.along);
  const values: number[] = [];
  const sample = new Float32Array(centres.length);
  const side = flank * ax.acrossStride;
  for (let i = 0; i < ax.along; i++) {
    const delta = i - crossing;
    if (Math.abs(delta - Math.round(delta / p) * p) <= flank) continue;
    for (let j = 0; j < centres.length; j++) {
      const q = i * ax.alongStride + centres[j];
      sample[j] = (brightness(q - side) + brightness(q + side)) / 2 - brightness(q);
    }
    sample.sort();
    profile[i] = sample[sample.length >> 1];
    valid[i] = 1;
    values.push(profile[i]);
  }
  if (values.length < 32) return 1;
  values.sort((a, b) => a - b);
  const lo = values[Math.floor(values.length * 0.12)], hi = values[Math.floor(values.length * 0.88)];
  const sign = Math.abs(hi) >= Math.abs(lo) ? 1 : -1;
  const peak = sign === 1 ? hi : -lo, gap = sign === 1 ? lo : -hi;
  if (peak < 6 || gap > 0.35 * peak) return 1;
  // Compare the pulse to itself. Solid strokes with incidental texture should stay on the solid-line path.
  const threshold = (peak + gap) / 2;
  const ink = Uint8Array.from(profile, v => Number(sign * v > threshold));
  let period = 0, sawMismatch = false;
  for (let lag = 1; lag <= Math.min(24, p / 2); lag++) {
    let mismatches = 0, pairs = 0;
    for (let i = lag; i < ax.along; i++) if (valid[i] && valid[i - lag]) {
      mismatches += Number(ink[i] !== ink[i - lag]);
      pairs++;
    }
    if (pairs < 24) continue;
    if (mismatches / pairs > 0.27) sawMismatch = true;
    if (sawMismatch && mismatches / pairs < 0.12) { period = lag; break; }
  }
  return period || 1;
}

// A translucent stroke shifts each background channel toward the ink color. Fit that shift
// against the clean RGB gradient outside the stroke, separately for its core, edges and dot phases.
class InkFit {
  weight = 0;
  ground = [0, 0, 0];
  shift = [0, 0, 0];
  square = 0;
  product = 0;
  slope = 0;
  support = 0;
  halo = false;
  finish() {
    if (!this.weight) return;
    let variance = this.square / this.weight, covariance = this.product / this.weight;
    for (let k = 0; k < 3; k++) {
      this.ground[k] /= this.weight;
      this.shift[k] /= this.weight;
      variance -= this.ground[k] ** 2;
      covariance -= this.ground[k] * this.shift[k];
    }
    this.slope = Math.max(-0.9, Math.min(0.35, covariance / (Math.max(0, variance) + 160)));
  }
}

function repairAxis(data: PixelImage['data'], ax: Axis, first: number, crossing: number, p: number, t: number, period: number) {
  const { along, across, alongStride, acrossStride } = ax;
  if (across / p < 5 || along < 64) { fillLines(data, ax, first, p, t); return; }
  const dotted = period > 1;
  // Compression can give alternate dots different soft edges inside an eight-pixel JPEG block.
  const phases = dotted && 8 % period === 0 ? 8 : period;
  const reach = Math.max(1, Math.min(Math.ceil(t / 2) + (dotted ? 7 : 2), Math.floor(p / 2) - 2));
  const span = 2 * reach + 1;
  const block = Math.ceil(along / Math.max(1, Math.round(along / Math.max(384, phases * 64))));
  const jpegGroups = dotted && across / p > 40;
  const groups = jpegGroups ? 8 : Math.abs(p - Math.round(p)) > 0.001 ? 4 : 1;
  const count = Math.ceil(along / block) * groups * phases * span;
  let fits = Array.from({ length: count }, () => new InkFit());
  let prior: InkFit[] | undefined;
  const rgb = [0, 0, 0], shift = [0, 0, 0], expected = [0, 0, 0];
  const centers: number[] = [];
  for (let c = first - Math.ceil((first + reach) / p) * p; c < across + reach; c += p) centers.push(c);
  // The first fit locates the color band. Robust reweighting in the second fit reduces the influence of painted contours.
  for (let pass = 0; pass < 3; pass++) {
    const painting = pass === 2;
    const ringing = painting && dotted && fits.filter(f => f.halo).length > count * 0.015;
    for (const c of centers) {
      const center = Math.round(c);
      const left = center - reach - 1, right = center + reach + 1;
      if (right < 0 || left >= across) continue;
      const x0 = Math.max(0, left + 1), x1 = Math.min(right - 1, across - 1);
      const complete = left >= 0 && right < across;
      if (!complete && !painting) continue;
      const aCol = (left >= 0 ? left : right) * acrossStride, bCol = (right < across ? right : left) * acrossStride;
      const group = jpegGroups ? (center % 8 + 8) % 8 : Math.min(groups - 1, Math.floor((c - center + 0.5) * groups));
      // JPEG ringing is confined to the blocks containing the stroke. Require local evidence
      // that the stroke is present before repairing its softer, sometimes opposite-color ripples.
      const printed = new Uint8Array(Math.ceil(along / 32));
      if (ringing && center >= 0 && center < across) {
        for (let strip = 0; strip < printed.length; strip++) {
          let evidence = 0, samples = 0, pulseEvidence = 0, pulseSamples = 0;
          for (let i = strip * 32; i < Math.min(along, (strip + 1) * 32); i++) {
            const delta = i - crossing;
            if (Math.abs(delta - Math.round(delta / p) * p) < reach) continue;
            const q = i * alongStride, z = q + center * acrossStride;
            const fit = fits[((Math.floor(i / block) * groups + group) * phases + i % phases) * span + reach];
            // A cliff can put the two banks on entirely different colors. In that case test
            // the alternating ink/gap contrast along the stroke itself.
            const halfPeriod = Math.floor(period / 2);
            if (i >= halfPeriod && i + halfPeriod < along) {
              const opposite = fits[((Math.floor(i / block) * groups + group) * phases + (i + halfPeriod) % phases) * span + reach];
              const direction = fit.shift[1] - opposite.shift[1];
              if (Math.abs(direction) >= 3) {
                const delta = data[z + 1] - (data[z - halfPeriod * alongStride + 1] + data[z + halfPeriod * alongStride + 1]) / 2;
                pulseEvidence += Math.max(-1, Math.min(1, Math.sign(direction) * delta / 4));
                pulseSamples++;
              }
            }
            let predicted = 0, projection = 0;
            for (let k = 0; k < 3; k++) {
              const ground = (data[q + aCol + k] + data[q + bCol + k]) / 2;
              const weight = k === 1 ? 2 : 1;
              predicted += weight * (fit.shift[k] + fit.slope * (ground - fit.ground[k]));
              projection += weight * (data[z + k] - ground);
            }
            if (Math.abs(predicted) < 10) continue;
            evidence += Math.min(1, Math.max(-1, projection / predicted));
            samples++;
          }
          printed[strip] = Number((samples >= 2 && evidence / samples > 0.25) ||
            (pulseSamples >= 4 && pulseEvidence / pulseSamples > 0.33));
        }
      }
      if (ringing) {
        cleanDotRipple(data, ax, x0, x1, c, crossing, p, t, phases, printed, fits, group, groups, span, block);
        continue;
      }
      for (let i = 0; i < along; i++) {
        const delta = i - crossing;
        if (!painting && Math.abs(delta - Math.round(delta / p) * p) <= reach + 1) continue;
        const row = i * alongStride;
        let a = row + aCol, b = row + bCol;
        // Continue a slanting outline across the missing pixels by comparing small patches on both banks.
        const crossDist = Math.abs(delta - Math.round(delta / p) * p);
        if (painting && complete && i >= 5 && i < along - 5 && crossDist > reach + 4) {
          let best = Infinity, direction = 0;
          for (const d of [0, -1, 1, -2, 2, -4, 4]) {
            let cost = Math.abs(d) * 9;
            for (let j = -1; j <= 1; j++) for (let k = 0; k < 3; k++) {
              cost += Math.abs(data[a + (j - d) * alongStride + k] - data[b + (j + d) * alongStride + k]);
            }
            if (cost < best) { best = cost; direction = d; }
          }
          a -= direction * alongStride; b += direction * alongStride;
        }
        const edge = Math.max(Math.abs(data[a] - data[b]), Math.abs(data[a+1] - data[b+1]), Math.abs(data[a+2] - data[b+2]));
        const base = ((Math.floor(i / block) * groups + group) * phases + i % phases) * span;
        for (let x = x0; x <= x1; x++) {
          const index = base + x - center + reach, fit = fits[index], q = row + x * acrossStride;
          const f = (x - left) / (right - left);
          const model = painting ? fit : prior?.[index];
          let error = 0, power = 0, dot = 0;
          for (let k = 0; k < 3; k++) {
            rgb[k] = data[a + k] * (1 - f) + data[b + k] * f;
            shift[k] = data[q + k] - rgb[k];
            if (model) {
              expected[k] = model.shift[k] + model.slope * (rgb[k] - model.ground[k]);
              error = Math.max(error, Math.abs(shift[k] - expected[k]));
              power += expected[k] ** 2;
              dot += shift[k] * expected[k];
            }
          }
          if (!painting) {
            const w = 1 / ((1 + (edge / 28) ** 2) * (1 + (error / 18) ** 2));
            fit.weight += w;
            for (let k = 0; k < 3; k++) {
              fit.ground[k] += w * rgb[k]; fit.shift[k] += w * shift[k];
              fit.square += w * rgb[k] ** 2; fit.product += w * rgb[k] * shift[k];
            }
          } else {
            const strength = Math.sqrt(power / 3);
            if (fit.weight < 4 || fit.support === 0) continue;
            // Good color matches use the clean gradient. At a textured edge undo the estimated tint
            // instead, retaining detail in the source pixel. A blank or covered stroke gives no correction.
            const near = Math.max(Math.abs(shift[0]), Math.abs(shift[1]), Math.abs(shift[2]));
            const dr = shift[0] - expected[0], dg = shift[1] - expected[1], db = shift[2] - expected[2];
            const hueError = Math.max(dr, dg, db) - Math.min(dr, dg, db);
            if (dot <= 0 || near <= 2 || hueError > 32 + edge * 0.65 + strength * 0.5) continue;
            const agreement = Math.min(1, 3 * dot / Math.max(1, power));
            const keepDetail = Math.min(1, error / (12 + strength)) * Math.min(1, (edge + error) / 36);
            for (let k = 0; k < 3; k++) {
              const restored = rgb[k] + (shift[k] - expected[k]) / (1 + fit.slope);
              const value = rgb[k] + keepDetail * (restored - rgb[k]);
              data[q + k] = Math.max(0, Math.min(255, Math.round(data[q + k] + agreement * (value - data[q + k]))));
            }
          }
        }
      }
    }
    if (!painting) for (const fit of fits) fit.finish();
    if (pass === 1) {
      for (let base = 0; base < count; base += span * phases) {
        for (let x = 0; x < span; x++) {
          let pulse = 0;
          for (let k = 0; k < 3; k++) {
            let lo = Infinity, hi = -Infinity;
            for (let j = 0; j < phases; j++) {
              const v = fits[base + j * span + x].shift[k];
              lo = Math.min(lo, v); hi = Math.max(hi, v);
            }
            pulse = Math.max(pulse, hi - lo);
          }
          for (let j = 0; j < phases; j++) {
            const fit = fits[base + j * span + x];
            const threshold = Math.max(2.5, 80 / Math.sqrt(Math.max(1, fit.weight)));
            const mean = Math.max(...fit.shift.map(Math.abs));
            fit.support = Number(mean > threshold);
            // Alternating JPEG fringes can reverse color between successive dots. Include the gaps
            // only where that periodic fringe is also visible outside the measured stroke core.
            fit.halo = dotted && Math.abs(x - reach) > t / 2 + 0.5 && pulse > threshold * 2;
            if (fit.halo) fit.support = 1;
          }
        }
        // If this strip has a measured fringe, use the wider color band through its center as well.
        if (dotted && fits.slice(base, base + phases * span).some(fit => fit.halo)) {
          for (let j = 0; j < phases; j++) for (let x = 0; x < span; x++) if (Math.abs(x - reach) <= t / 2 + 1) {
            const fit = fits[base + j * span + x]; fit.halo = true; fit.support = 1;
          }
        }
      }
    }
    if (pass === 0) { prior = fits; fits = Array.from({ length: count }, () => new InkFit()); }
  }
}

/** Remove the repeated color oscillation along the stroke before using either bank to fill its ink.
 * A wall may also depart sharply from its surroundings, but its contour seldom repeats at the dot phase. */
function cleanDotRipple(data: PixelImage['data'], ax: Axis, x0: number, x1: number, c: number, crossing: number,
  p: number, t: number, phases: number, printed: Uint8Array, fits: InkFit[], group: number, groups: number, span: number, block: number) {
  const { along, alongStride, acrossStride } = ax;
  const half = phases / 2, reach = (span - 1) / 2;
  const nearCross = (i: number) => Math.abs(i - crossing - Math.round((i - crossing) / p) * p) <= t / 2 + 2;
  const cycle = new Float32Array(along * 3), ripple = new Float32Array(along * 3);
  const clamp = (i: number) => Math.max(0, Math.min(along - 1, i));
  for (let x = x0; x <= x1; x++) {
    const col = x * acrossStride;
    for (let i = 0; i < along; i++) {
      let weight = 0;
      for (let d = -Math.floor(half); d <= Math.floor(half); d++) {
        const j = clamp(i + d), w = Math.abs(d) === half ? 0.5 : 1;
        weight += w;
        for (let k = 0; k < 3; k++) cycle[i*3+k] += w * data[col + j*alongStride+k];
      }
      for (let k = 0; k < 3; k++) {
        cycle[i*3+k] /= weight;
        ripple[i*3+k] = data[col+i*alongStride+k] - cycle[i*3+k];
      }
    }
    for (let i = 0; i < along; i++) {
      if (!printed[i >> 5]) continue;
      const estimate = [0, 0, 0];
      let weight = 0;
      for (let d = -3; d <= 3; d++) {
        const j = i + d * phases;
        if (d === 0 || j < 0 || j >= along || nearCross(j)) continue;
        let difference = 0;
        for (let k = 0; k < 3; k++) difference = Math.max(difference, Math.abs(cycle[i*3+k] - cycle[j*3+k]));
        const w = 1 / (Math.abs(d) * (1 + (difference / 10) ** 2));
        weight += w;
        for (let k = 0; k < 3; k++) estimate[k] += w * ripple[j*3+k];
      }
      if (weight < 0.12) continue;
      for (let k = 0; k < 3; k++) {
        const repeated = estimate[k] / weight, here = ripple[i*3+k];
        if (Math.abs(repeated) < 0.8 || here * repeated <= 0) continue;
        const remove = Math.abs(here - repeated) < 5 ? here : Math.sign(repeated) * Math.min(Math.abs(here), Math.abs(repeated));
        const q = col+i*alongStride+k;
        data[q] = Math.max(0, Math.min(255, Math.round(data[q] - remove)));
      }
    }
    cycle.fill(0);
  }
  // The remaining ink is the mean tint across a cycle. Its clean banks are now close to the core.
  const radius = t / 2 + 1;
  const left = Math.max(0, Math.ceil(c-radius)-1), right = Math.min(ax.across-1, Math.floor(c+radius)+1);
  const offset = Math.round(c);
  for (let i = 0; i < along; i++) {
    if (!printed[i >> 5]) continue;
    const row = i*alongStride;
    const a = row + (c-radius < 0 ? right : left)*acrossStride, b = row + (c+radius >= ax.across-1 ? left : right)*acrossStride;
    for (let x = Math.max(x0, Math.ceil(c-radius)); x <= Math.min(x1, Math.floor(c+radius)); x++) {
      const f = (x - left) / Math.max(1, right - left), q = row + x*acrossStride;
      const base = (Math.floor(i/block)*groups+group)*phases*span+x-offset+reach;
      for (let k = 0; k < 3; k++) {
        const ground = data[a+k]*(1-f) + data[b+k]*f;
        let tint = 0;
        for (let j = 0; j < phases; j++) {
          const fit = fits[base+j*span];
          tint += fit.shift[k] + fit.slope*(ground-fit.ground[k]);
        }
        tint /= phases;
        const delta = data[q+k] - ground;
        // Keep the underlying edge when its jump is larger than the plausible ink band.
        if (delta * tint < 0 && Math.abs(delta) > 8) continue;
        const excess = Math.abs(delta - tint);
        const keep = Math.min(1, Math.max(0, (excess - 8) / 18));
        data[q+k] = Math.max(0, Math.min(255, Math.round(ground + keep*(delta-tint))));
      }
    }
  }
  // On smooth ground JPEG quantization can leave a low-contrast checkerboard through the
  // entire affected block. Use its actual boundaries as clean anchors. Limit the adjustment
  // by RGB agreement so lettering and rock contours keep their recovered detail.
  const bankL = Math.floor(Math.ceil(c - t / 2) / 8) * 8 - 1;
  const bankR = Math.floor(Math.floor(c + t / 2) / 8) * 8 + 8;
  if (bankL < 0 || bankR >= ax.across) return;
  const leftRGB = [0, 0, 0], rightRGB = [0, 0, 0];
  for (let i = 0; i < along; i++) {
    if (!printed[i >> 5]) continue;
    leftRGB.fill(0); rightRGB.fill(0);
    let spread = 0;
    for (let k = 0; k < 3; k++) {
      for (const [bank, rgb] of [[bankL, leftRGB], [bankR, rightRGB]] as const) {
        const q = i*alongStride + bank*acrossStride+k;
        const before = data[clamp(i-1)*alongStride+bank*acrossStride+k], after = data[clamp(i+1)*alongStride+bank*acrossStride+k];
        rgb[k] = (before + data[q]*2 + after)/4;
        spread = Math.max(spread, Math.abs(before-after));
      }
    }
    for (let x = Math.max(x0,bankL+1); x <= Math.min(x1,bankR-1); x++) {
      const f = (x-bankL)/(bankR-bankL), q=i*alongStride+x*acrossStride;
      let distance = 0;
      for (let k=0;k<3;k++) distance = Math.max(distance, Math.abs(data[q+k] - (leftRGB[k]*(1-f)+rightRGB[k]*f)));
      const weight = 1 / (1 + (distance/15)**4 + (spread/14)**4);
      for (let k=0;k<3;k++) data[q+k] = Math.round(data[q+k]*(1-weight)+(leftRGB[k]*(1-f)+rightRGB[k]*f)*weight);
    }
  }
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
