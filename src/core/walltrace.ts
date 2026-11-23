// Drafting walls from a map picture. The DM picks a bit of wall colour; everything near that colour counts as wall. The wall pixels are
// cleaned up (thin printed lines and small blobs such as furniture and text are dropped), thinned to centre lines, followed from end
// to end into straight pieces, and tidied (ends that meet are joined, ends near a grid corner snap to it, near-straight pieces are made straight).
// Everything works on plain pixel arrays so it can be tested without a browser. Distances are in picture pixels until `tidy`, which works in
// whatever units the segments are already in.

import type { PixelImage } from './gridcut';
import type { Vec } from '../types';

export interface Piece { a: Vec; b: Vec }

/** Largest possible distance between two RGB colours. */
const MAX_DIST = Math.sqrt(3) * 255;

export type Rgb = [number, number, number];

/**
 * A good first guess at the colour of the walls: most maps draw them dark, so take the darkest tight cluster of colour
 * (the first real peak in the brightness counts, reading up from black), or failing that the darkest few pixels.
 */
export function guessWallColor(img: PixelImage): Rgb {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const luma = new Uint8Array(n);
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const l = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    luma[i] = l;
    hist[l]++;
  }
  const smooth = new Float64Array(256);
  for (let l = 0; l < 256; l++) { let s = 0, c = 0; for (let k = -3; k <= 3; k++) if (l + k >= 0 && l + k < 256) { s += hist[l + k]; c++; } smooth[l] = s / c; }
  const need = Math.max(30, n * 0.0015);
  let peak = -1;
  for (let l = 1; l < 200 && peak < 0; l++) if (smooth[l] >= need && smooth[l] >= smooth[l - 1] && smooth[l] >= smooth[l + 1]) peak = l;
  let lo: number, hi: number;
  if (peak >= 0) { lo = peak - 14; hi = peak + 14; }
  else { let cut = 0, acc = 0; for (; cut < 255 && acc < n * 0.05; cut++) acc += hist[cut]; lo = 0; hi = cut; }
  let sr = 0, sg = 0, sb = 0, c = 0;
  for (let i = 0; i < n; i++) {
    if (luma[i] < lo || luma[i] > hi) continue;
    const p = i * 4;
    sr += data[p]; sg += data[p + 1]; sb += data[p + 2]; c++;
  }
  return c ? [Math.round(sr / c), Math.round(sg / c), Math.round(sb / c)] : [30, 30, 30];
}

/** The colour at a point (a small square around it averaged, so one stray pixel does not decide). */
export function colorAt(img: PixelImage, x: number, y: number, r = 1): Rgb {
  const { data, width: w, height: h } = img;
  let sr = 0, sg = 0, sb = 0, c = 0;
  for (let yy = Math.max(0, Math.floor(y) - r); yy <= Math.min(h - 1, Math.floor(y) + r); yy++) {
    for (let xx = Math.max(0, Math.floor(x) - r); xx <= Math.min(w - 1, Math.floor(x) + r); xx++) {
      const p = (yy * w + xx) * 4;
      sr += data[p]; sg += data[p + 1]; sb += data[p + 2]; c++;
    }
  }
  return c ? [Math.round(sr / c), Math.round(sg / c), Math.round(sb / c)] : [0, 0, 0];
}

/** Every pixel whose colour is near `color`. `sensitivity` runs 0 (exactly that colour) to 100 (everything). Transparent pixels never count. */
export function wallMask(img: PixelImage, color: Rgb, sensitivity: number): Uint8Array {
  const { data, width: w, height: h } = img;
  const out = new Uint8Array(w * h);
  const lim = (Math.max(0, Math.min(100, sensitivity)) / 100) * MAX_DIST;
  const lim2 = lim * lim;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (data[p + 3] < 128) continue;
    const dr = data[p] - color[0], dg = data[p + 1] - color[1], db = data[p + 2] - color[2];
    if (dr * dr + dg * dg + db * db <= lim2) out[i] = 1;
  }
  return out;
}

/** Take away lines thinner than about 2r+1 pixels (a printed grid), keeping what is thicker: shrink r times, then grow r times. */
export function openMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  let cur = mask;
  const pass = (src: Uint8Array, want: number): Uint8Array => {
    const dst = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // cross-shaped neighbourhood: for erosion all five must be set, for dilation any one
        const c = src[i], l = x > 0 ? src[i - 1] : 0, rr = x < w - 1 ? src[i + 1] : 0, u = y > 0 ? src[i - w] : 0, d = y < h - 1 ? src[i + w] : 0;
        dst[i] = want ? (c | l | rr | u | d) : (c & l & rr & u & d);
      }
    }
    return dst;
  };
  for (let k = 0; k < r; k++) cur = pass(cur, 0);
  for (let k = 0; k < r; k++) cur = pass(cur, 1);
  return cur;
}

/** Remove blobs whose longest side is under `minSide` pixels (furniture, text, specks). Walls are long, so they stay. */
export function dropSmall(mask: Uint8Array, w: number, h: number, minSide: number): Uint8Array {
  if (minSide <= 1) return mask;
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let head = 0, tail = 0;
    queue[tail++] = s; seen[s] = 1;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !seen[j]) { seen[j] = 1; queue[tail++] = j; }
        }
      }
    }
    if (Math.max(x1 - x0, y1 - y0) + 1 < minSide) for (let k = 0; k < tail; k++) out[queue[k]] = 0;
  }
  return out;
}

/** Thin shapes to one-pixel centre lines (the Zhang-Suen method). */
export function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const W = w + 2, H = h + 2;
  const a = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[(y + 1) * W + x + 1] = mask[y * w + x];
  const del: number[] = [];
  let changed = true;
  for (let iter = 0; changed && iter < 200; iter++) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y <= h; y++) {
        for (let x = 1; x <= w; x++) {
          const i = y * W + x;
          if (!a[i]) continue;
          const p2 = a[i - W], p3 = a[i - W + 1], p4 = a[i + 1], p5 = a[i + W + 1], p6 = a[i + W], p7 = a[i + W - 1], p8 = a[i - 1], p9 = a[i - W - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (!p2 && p3 ? 1 : 0) + (!p3 && p4 ? 1 : 0) + (!p4 && p5 ? 1 : 0) + (!p5 && p6 ? 1 : 0)
            + (!p6 && p7 ? 1 : 0) + (!p7 && p8 ? 1 : 0) + (!p8 && p9 ? 1 : 0) + (!p9 && p2 ? 1 : 0);
          if (A !== 1) continue;
          if (step === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue; }
          else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          del.push(i);
        }
      }
      if (del.length) changed = true;
      for (const i of del) a[i] = 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = a[(y + 1) * W + x + 1];
  return out;
}

interface Edge { a: number; b: number; pts: Vec[] }

/** Follow a one-pixel skeleton from end to end: lines of points that run between line ends and crossings. */
export function tracePaths(skel: Uint8Array, w: number, h: number, spur: number): Vec[][] {
  const N = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const nbrs = (i: number): number[] => {
    const x = i % w;
    const r: number[] = [];
    for (let k = 0; k < 8; k++) {
      const dx = DX[k];
      if (x + dx < 0 || x + dx >= w) continue;
      const j = i + N[k];
      if (j >= 0 && j < w * h && skel[j]) r.push(j);
    }
    return r;
  };
  const deg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (skel[i]) deg[i] = nbrs(i).length;

  // crossings: pixels with three or more neighbours, grouped into one node per touching cluster; line ends are nodes of their own
  const nodeOf = new Int32Array(w * h).fill(-1);
  const nodes: Vec[] = [];
  const grow = (s: number, id: number, test: (i: number) => boolean) => {
    const q = [s]; nodeOf[s] = id;
    let sx = 0, sy = 0, c = 0;
    while (q.length) {
      const i = q.pop()!;
      sx += i % w; sy += Math.floor(i / w); c++;
      for (const j of nbrs(i)) if (nodeOf[j] < 0 && test(j)) { nodeOf[j] = id; q.push(j); }
    }
    nodes[id] = { x: sx / c + 0.5, y: sy / c + 0.5 };
  };
  for (let i = 0; i < w * h; i++) {
    if (!skel[i] || nodeOf[i] >= 0) continue;
    if (deg[i] >= 3) grow(i, nodes.length, (j) => deg[j] >= 3);
    else if (deg[i] === 1) { nodeOf[i] = nodes.length; nodes.push({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 }); }
  }

  const edges: Edge[] = [];
  const visited = new Uint8Array(w * h);
  const walk = (startNode: number, from: number, first: number) => {
    const pts: Vec[] = [nodes[startNode]];
    let prev = from, cur = first;
    while (nodeOf[cur] < 0) {
      visited[cur] = 1;
      pts.push({ x: (cur % w) + 0.5, y: Math.floor(cur / w) + 0.5 });
      const next = nbrs(cur).filter((j) => j !== prev && !(nodeOf[j] < 0 && visited[j]))
        .sort((p, q) => (Math.abs((p % w) - (cur % w)) + Math.abs(Math.floor(p / w) - Math.floor(cur / w))) - (Math.abs((q % w) - (cur % w)) + Math.abs(Math.floor(q / w) - Math.floor(cur / w))))[0];
      if (next === undefined) return { end: -1, pts };
      prev = cur; cur = next;
    }
    pts.push(nodes[nodeOf[cur]]);
    return { end: nodeOf[cur], pts };
  };
  for (let i = 0; i < w * h; i++) {
    const n = nodeOf[i];
    if (n < 0) continue;
    for (const j of nbrs(i)) {
      if (nodeOf[j] === n || visited[j]) continue;
      if (nodeOf[j] >= 0) continue; // two nodes touching: nothing between them to follow
      const r = walk(n, i, j);
      if (r.end >= 0) edges.push({ a: n, b: r.end, pts: r.pts });
      else edges.push({ a: n, b: -1, pts: r.pts });
    }
  }
  // rings with no crossing or end (a round room): follow from any pixel left over
  for (let i = 0; i < w * h; i++) {
    if (!skel[i] || visited[i] || nodeOf[i] >= 0) continue;
    const ns = nbrs(i);
    if (ns.length < 2) continue;
    const pts: Vec[] = [];
    let prev = ns[0], cur = i;
    for (let guard = 0; guard < w * h; guard++) {
      visited[cur] = 1;
      pts.push({ x: (cur % w) + 0.5, y: Math.floor(cur / w) + 0.5 });
      const next = nbrs(cur).find((j) => j !== prev && !visited[j] && nodeOf[j] < 0);
      if (next === undefined) break;
      prev = cur; cur = next;
    }
    if (pts.length > 3) { pts.push(pts[0]); edges.push({ a: -1, b: -1, pts }); }
  }

  const length = (pts: Vec[]) => { let s = 0; for (let k = 1; k < pts.length; k++) s += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y); return s; };
  // spurs: short branches that end in the open are skeleton fuzz, not walls
  const gone = new Set<Edge>();
  for (let pass = 0; pass < 3; pass++) {
    const count = new Map<number, number>();
    for (const e of edges) if (!gone.has(e)) { count.set(e.a, (count.get(e.a) ?? 0) + 1); count.set(e.b, (count.get(e.b) ?? 0) + 1); }
    let any = false;
    for (const e of edges) {
      if (gone.has(e)) continue;
      const freeEnd = e.b < 0 || e.a < 0 || (count.get(e.a) ?? 0) === 1 || (count.get(e.b) ?? 0) === 1;
      const joined = (e.a >= 0 && (count.get(e.a) ?? 0) >= 3) || (e.b >= 0 && (count.get(e.b) ?? 0) >= 3);
      if (freeEnd && joined && length(e.pts) < spur) { gone.add(e); any = true; }
    }
    if (!any) break;
  }
  const live = edges.filter((e) => !gone.has(e));
  // a node left with two lines is not a crossing any more: join them into one
  for (let guard = 0; guard < 10000; guard++) {
    const at = new Map<number, Edge[]>();
    for (const e of live) for (const n of [e.a, e.b]) if (n >= 0) at.set(n, [...(at.get(n) ?? []), e]);
    let merged = false;
    for (const [n, es] of at) {
      if (es.length !== 2 || es[0] === es[1]) continue;
      const [p, q] = es;
      const pp = p.b === n ? p.pts : [...p.pts].reverse();
      const qq = q.a === n ? q.pts : [...q.pts].reverse();
      const pa = p.b === n ? p.a : p.b, qb = q.a === n ? q.b : q.a;
      live.splice(live.indexOf(p), 1); live.splice(live.indexOf(q), 1);
      live.push({ a: pa, b: qb, pts: [...pp, ...qq.slice(1)] });
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return live.map((e) => e.pts);
}

/** Fewer points for the same line: keep a point only if dropping it would move the line more than `tol`. */
export function simplify(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = pts[s], b = pts[e];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let far = -1, fd = tol;
    for (let i = s + 1; i < e; i++) {
      const d = len < 1e-9 ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y) : Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([s, far], [far, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * How near the colour a pixel has to be, picked from the picture itself. A flat colour (ink, solid rock) shows up in the colour distances as a
 * tall narrow peak that drops to the level of everything else within a short distance; the setting goes just past that drop. A fixed value
 * cannot do this: dark rock that fades into the floor needs a tight setting, flat ink a wide one. `clear` is false when there is no such peak
 * (the colour is spread through the picture like texture), and then `sens` is only the usual default. `sens` is on the 0 to 100 scale.
 */
export function suggestSensitivity(img: PixelImage, color: Rgb, lo = 4, hi = 30, fallback = 22): { sens: number; clear: boolean } {
  const { data, width: w, height: h } = img;
  const bins = new Float64Array(Math.ceil(MAX_DIST) + 1);
  let n = 0;
  for (let i = 0; i < w * h; i += 2) { // every other pixel is plenty
    const p = i * 4;
    if (data[p + 3] < 128) continue;
    const dr = data[p] - color[0], dg = data[p + 1] - color[1], db = data[p + 2] - color[2];
    bins[Math.round(Math.sqrt(dr * dr + dg * dg + db * db))]++;
    n++;
  }
  const none = { sens: fallback, clear: false };
  if (n < 100) return none;
  const dens = new Float64Array(bins.length);
  for (let d = 0; d < bins.length; d++) {
    let sum = 0, k = 0;
    for (let j = -2; j <= 2; j++) if (d + j >= 0 && d + j < bins.length) { sum += bins[d + j]; k++; }
    dens[d] = (sum / k / n) * 100;
  }
  let pi = 0;
  for (let d = 1; d <= 60; d++) if (dens[d] > dens[pi]) pi = d;
  const peak = dens[pi];
  // a real flat colour holds a good part of the picture in a narrow band; texture does not
  let near = 0;
  for (let d = 0; d <= 30; d++) near += dens[d];
  if (near < 3) return none;
  let knee = -1;
  for (let d = pi; d <= 90; d++) if (dens[d] <= peak * 0.06) { knee = d; break; }
  if (knee < 0) return none;
  return { sens: Math.max(lo, Math.min(hi, ((knee * 1.6) / MAX_DIST) * 100)), clear: true };
}

/** Fill narrow gaps and notches: grow r times, then shrink r times. */
export function closeMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const o = openMask(inv, w, h, r);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = o[i] ? 0 : 1;
  return out;
}

/**
 * The outlines of the shapes in a mask, as lines of points on the pixel corners. A shape that runs off the picture gives a line that stops at
 * the picture's edge (the border itself is not an outline). Closed outlines end where they began.
 */
export function traceContours(mask: Uint8Array, w: number, h: number): Vec[][] {
  const W = w + 1;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // 0 right, 1 down, 2 left, 3 up: clockwise round a shape on the screen
  const has = new Uint8Array(W * (h + 1));
  const into = new Uint8Array(W * (h + 1));
  const add = (x: number, y: number, d: number) => { has[y * W + x] |= 1 << d; into[(y + DY[d]) * W + x + DX[d]]++; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (y > 0 && !mask[i - w]) add(x, y, 0);
      if (x < w - 1 && !mask[i + 1]) add(x + 1, y, 1);
      if (y < h - 1 && !mask[i + w]) add(x + 1, y + 1, 2);
      if (x > 0 && !mask[i - 1]) add(x, y + 1, 3);
    }
  }
  const out: Vec[][] = [];
  const follow = (sx: number, sy: number, d0: number) => {
    const pts: Vec[] = [{ x: sx, y: sy }];
    let x = sx, y = sy, d = d0;
    for (;;) {
      has[y * W + x] &= ~(1 << d);
      x += DX[d]; y += DY[d];
      pts.push({ x, y });
      if (x === sx && y === sy) break;
      const bits = has[y * W + x];
      const nd = [(d + 1) % 4, d, (d + 3) % 4].find((k) => bits & (1 << k));
      if (nd === undefined) break;
      d = nd;
    }
    if (pts.length > 3) out.push(pts);
  };
  // lines that run off the picture first (they begin where nothing comes in), then the closed ones
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    const v = y * W + x;
    if (!has[v] || into[v]) continue;
    for (let d = 0; d < 4; d++) while (has[v] & (1 << d)) follow(x, y, d);
  }
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    const v = y * W + x;
    for (let d = 0; d < 4; d++) while (has[v] & (1 << d)) follow(x, y, d);
  }
  return out;
}

/** Smooth the stair-steps of a pixel outline: each point becomes the average of the points round it (a closed line wraps; an open one keeps its ends). */
export function smoothPath(pts: Vec[], half: number): Vec[] {
  const n = pts.length;
  if (half < 1 || n < 4) return pts;
  const closed = Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y) < 1e-9;
  const m = closed ? n - 1 : n;
  const out: Vec[] = [];
  for (let i = 0; i < m; i++) {
    if (!closed && (i === 0 || i === m - 1)) { out.push(pts[i]); continue; }
    let sx = 0, sy = 0, c = 0;
    const k = closed ? half : Math.min(half, i, m - 1 - i);
    for (let j = -k; j <= k; j++) {
      const q = pts[closed ? (((i + j) % m) + m) % m : i + j];
      sx += q.x; sy += q.y; c++;
    }
    out.push({ x: sx / c, y: sy / c });
  }
  if (closed) out.push(out[0]);
  return out;
}

/** Does the colour fill big areas (solid rock round the rooms) rather than draw thin lines? Then the walls are along its edges. */
export function looksSolid(img: PixelImage, color: Rgb, sensitivity: number, radius: number): boolean {
  const { width: w, height: h } = img;
  const m = wallMask(img, color, sensitivity);
  let total = 0;
  for (let i = 0; i < m.length; i++) total += m[i];
  if (total === 0) return false;
  // shrink by `radius`: a line has nothing left, a filled area keeps most of its middle
  const left = openMask(m, w, h, Math.max(1, Math.round(radius)));
  let kept = 0;
  for (let i = 0; i < left.length; i++) kept += left[i];
  return kept / total > 0.4;
}

/** The edge pixels of the shapes in a mask (shape pixels that touch a gap). The picture's own border is not an edge. */
export function edgesOf(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if ((x > 0 && !mask[i - 1]) || (x < w - 1 && !mask[i + 1]) || (y > 0 && !mask[i - w]) || (y < h - 1 && !mask[i + w])) out[i] = 1;
    }
  }
  return out;
}

export interface TraceOpts {
  color: Rgb;
  /** 'lines': the colour draws the walls themselves. 'edges': the colour fills the rock round the rooms, so walls run along its edge. */
  mode?: 'lines' | 'edges';
  /** 0 to 100: how near the wall colour a pixel has to be */
  sensitivity: number;
  /** drop lines thinner than about 2r+1 pixels (0: keep all) */
  thinPx: number;
  /** drop pieces shorter than this many pixels */
  minLen: number;
  /** how far a straight piece may stray from the drawn line, in pixels */
  tol: number;
  /** 'edges' only: ragged edges (a rocky fringe, crystals) are smoothed over this many pixels before the walls are drawn along them */
  smoothPx?: number;
}

/** Straight pieces along the walls in a picture, in pixels of that picture. */
export function detectPieces(img: PixelImage, o: TraceOpts): Piece[] {
  const { width: w, height: h } = img;
  let m = wallMask(img, o.color, o.sensitivity);
  m = openMask(m, w, h, o.thinPx);
  m = dropSmall(m, w, h, o.minLen);
  let paths: Vec[][];
  if (o.mode === 'edges') {
    // fill small holes (furniture and floor marks inside the rock) so only real room outlines remain
    const inv = new Uint8Array(m.length);
    for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
    const big = dropSmall(inv, w, h, o.minLen);
    for (let i = 0; i < m.length; i++) m[i] = big[i] ? 0 : 1;
    // round off the ragged fringe, then follow the outline of each shape directly (no centre-line step, so nothing is lost at the joins)
    const r = Math.max(0, Math.round(o.smoothPx ?? 0));
    m = closeMask(openMask(m, w, h, r), w, h, r);
    paths = traceContours(m, w, h).map((p) => smoothPath(p, Math.round(r * 1.5)))
      .filter((p) => { let len = 0; for (let k = 1; k < p.length; k++) len += Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y); return len >= o.minLen; });
  } else paths = tracePaths(thin(m, w, h), w, h, Math.max(3, o.minLen * 0.6));
  const out: Piece[] = [];
  for (const p of paths) {
    const s = simplify(p, o.tol);
    for (let k = 1; k < s.length; k++) if (Math.hypot(s[k].x - s[k - 1].x, s[k].y - s[k - 1].y) >= 1) out.push({ a: s[k - 1], b: s[k] });
  }
  return out;
}

export interface TidyOpts {
  /** ends closer than this are one point */
  join: number;
  /** a point this close to a grid corner snaps to it (needs `snap`) */
  snapTol: number;
  snap?: (p: Vec) => Vec;
  /** pieces within this many degrees of straight across or up and down are made straight */
  straightDeg: number;
  /** drop pieces shorter than this */
  minLen: number;
}

/** Make the pieces neat: shared corners, grid corners, straight lines, and long pieces rather than lots of short ones. */
export function tidy(pieces: Piece[], o: TidyOpts): Piece[] {
  // 1. ends that meet become one point
  const pts: Vec[] = [];
  const idx = (p: Vec): number => {
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) <= o.join) return i;
    pts.push({ ...p });
    return pts.length - 1;
  };
  let segs = pieces.map((s) => [idx(s.a), idx(s.b)] as [number, number]);
  // move each shared point to the middle of the ends that made it
  const sum = pts.map(() => ({ x: 0, y: 0, n: 0 }));
  pieces.forEach((s, k) => {
    for (const [i, p] of [[segs[k][0], s.a], [segs[k][1], s.b]] as [number, Vec][]) { sum[i].x += p.x; sum[i].y += p.y; sum[i].n++; }
  });
  sum.forEach((s, i) => { if (s.n) pts[i] = { x: s.x / s.n, y: s.y / s.n }; });
  // 2. grid corners
  const fixed = new Set<number>();
  if (o.snap) {
    for (let i = 0; i < pts.length; i++) {
      const c = o.snap(pts[i]);
      if (Math.hypot(c.x - pts[i].x, c.y - pts[i].y) <= o.snapTol) { pts[i] = c; fixed.add(i); }
    }
  }
  // 3. straight pieces: ends of a nearly level piece share one height, ends of a nearly upright one share one position
  //    (levelling and uprighting never fight, as they set different coordinates); a point on a grid corner decides for its group
  const tanLim = Math.tan((o.straightDeg * Math.PI) / 180);
  const levelOf = pts.map((_, i) => i), uprightOf = pts.map((_, i) => i);
  const root = (uf: number[], i: number): number => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
  const join = (uf: number[], i: number, j: number) => { uf[root(uf, i)] = root(uf, j); };
  for (const [i, j] of segs) {
    if (i === j) continue;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    if (Math.abs(dy) <= Math.abs(dx) * tanLim) join(levelOf, i, j);
    else if (Math.abs(dx) <= Math.abs(dy) * tanLim) join(uprightOf, i, j);
  }
  const settle = (uf: number[], axis: 'x' | 'y') => {
    const groups = new Map<number, number[]>();
    pts.forEach((_, i) => { const r = root(uf, i); groups.set(r, [...(groups.get(r) ?? []), i]); });
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const pin = members.find((i) => fixed.has(i));
      const v = pin !== undefined ? pts[pin][axis] : members.reduce((t, i) => t + pts[i][axis], 0) / members.length;
      for (const i of members) if (!fixed.has(i) || Math.abs(pts[i][axis] - v) < 1e-6) pts[i] = { ...pts[i], [axis]: v };
    }
  };
  settle(levelOf, 'y');
  settle(uprightOf, 'x');
  // 4. one piece where a line carries straight on through a point that nothing else touches
  const same = (p: Vec, q: Vec) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  segs = segs.filter(([i, j]) => i !== j && !same(pts[i], pts[j]));
  const key = (s: [number, number]) => (s[0] < s[1] ? `${s[0]}-${s[1]}` : `${s[1]}-${s[0]}`);
  const seen = new Set<string>();
  segs = segs.filter((s) => { const k = key(s); if (seen.has(k)) return false; seen.add(k); return true; });
  for (let guard = 0; guard < 100000; guard++) {
    const at = new Map<number, number[]>();
    segs.forEach((s, k) => { for (const n of s) at.set(n, [...(at.get(n) ?? []), k]); });
    let merged = false;
    for (const [n, ks] of at) {
      if (ks.length !== 2) continue;
      const [s1, s2] = [segs[ks[0]], segs[ks[1]]];
      const o1 = s1[0] === n ? s1[1] : s1[0], o2 = s2[0] === n ? s2[1] : s2[0];
      if (o1 === o2) continue;
      const ux = pts[n].x - pts[o1].x, uy = pts[n].y - pts[o1].y, vx = pts[o2].x - pts[n].x, vy = pts[o2].y - pts[n].y;
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (!lu || !lv) continue;
      const cos = (ux * vx + uy * vy) / (lu * lv);
      if (cos < Math.cos((o.straightDeg * Math.PI) / 180)) continue;
      segs = segs.filter((_, k) => k !== ks[0] && k !== ks[1]);
      segs.push([o1, o2]);
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return segs.map(([i, j]) => ({ a: pts[i], b: pts[j] })).filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) >= o.minLen);
}
