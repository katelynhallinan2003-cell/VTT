// Painted light: daylight and dim light the DM paints onto the ground of a dim or dark scene.
//
// What is painted lifts the dark completely (daylight) or by half (dim light). Beyond it the light fades out over the scene's
// "soft edge", like the dim part of a torch: just as strong as the paint at the painted edge (so there is no step), then easing
// away to nothing at the end of the edge. Walls stop that fade: it only travels round them, never through them.
// The numbers are worked out on a coarse grid of pixels (`cover`: how much of each pixel was painted, 0 to 1).

/** How much of the light is left a given share (0 to 1) of the way out along the soft edge: a smooth S-curve, full at the paint, nothing at the end. */
export function fadeAt(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

/** Sight counts ground as lit while at least this share of the light is left, so a token never sees what looks dark. */
export const SIGHT_SHARE = 0.25;

const FAR = 1e9;

/** Squared distance from every pixel to the nearest pixel that is `on` (Felzenszwalb and Huttenlocher). Pixels with nothing `on` anywhere get a huge number. */
export function distanceSquared(on: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = on[i] ? 0 : FAR;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n);
  const line = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -FAR; z[1] = FAR;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = FAR;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    line(h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    line(w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

const SQRT2 = Math.SQRT2, SQRT5 = Math.sqrt(5);
/** Steps to the 16 nearest cells and what each costs. A step is only taken when the cells it passes between are open, so nothing slips through a wall. */
const STEPS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
  [1, 2, SQRT5], [-1, 2, SQRT5], [1, -2, SQRT5], [-1, -2, SQRT5],
  [2, 1, SQRT5], [-2, 1, SQRT5], [2, -1, SQRT5], [-2, -1, SQRT5],
];

/**
 * How far each pixel is from the nearest `on` pixel, walking round the cells marked in `block` (walls) instead of through them.
 * A wall cell can be reached from the open ground beside it, so the light still reaches the wall itself, but it never carries on
 * out the other side. Cells farther than `limit` are left at infinity.
 */
export function walkDistance(on: Uint8Array, block: Uint8Array, w: number, h: number, limit: number): Float32Array {
  const dist = new Float32Array(w * h).fill(Infinity);
  // a binary heap of cells by distance (a cell may be in it twice; the later, longer entry is skipped)
  const heap: number[] = [];
  const key: number[] = [];
  const push = (cell: number, d: number) => {
    let i = heap.length;
    heap.push(cell); key.push(d);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (key[up] <= d) break;
      heap[i] = heap[up]; key[i] = key[up]; i = up;
    }
    heap[i] = cell; key[i] = d;
  };
  const pop = (): [number, number] => {
    const cell = heap[0], d = key[0];
    const lastCell = heap.pop()!, lastKey = key.pop()!;
    const n = heap.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && key[c + 1] < key[c]) c++;
        if (key[c] >= lastKey) break;
        heap[i] = heap[c]; key[i] = key[c]; i = c;
      }
      heap[i] = lastCell; key[i] = lastKey;
    }
    return [cell, d];
  };
  for (let i = 0; i < on.length; i++) if (on[i]) { dist[i] = 0; push(i, 0); }
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !block[y * w + x];
  while (heap.length) {
    const [cell, d] = pop();
    if (d > dist[cell]) continue;
    const x = cell % w, y = (cell - x) / w;
    // light that came into a wall cell only runs along the wall; painted light (distance 0) spreads from wherever it is
    const inWall = block[cell] === 1 && d > 0;
    for (const [dx, dy, cost] of STEPS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nd = d + cost;
      if (nd >= limit) continue;
      const n = ny * w + nx;
      if (nd >= dist[n]) continue;
      if (inWall) {
        if (!block[n] || Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
      } else {
        // the cells the step passes between have to be open
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax === 1 && ay === 1) { if (!free(x + dx, y) || !free(x, y + dy)) continue; }
        else if (ay === 2) { if (!free(x, y + dy / 2) || !free(x + dx, y + dy / 2)) continue; }
        else if (ax === 2) { if (!free(x + dx / 2, y) || !free(x + dx / 2, y + dy)) continue; }
      }
      dist[n] = nd;
      push(n, dist[n]); // the stored (rounded) number, so a cell's own entry is never mistaken for an old one
    }
  }
  return dist;
}

/**
 * How much of the dark painted light lifts at each pixel, 0 to 1. `lift` is what the painted part itself gives (1 for daylight, 0.5 for dim
 * light). `reach` is how many pixels the soft edge runs beyond it, and `block` (optional) marks wall cells the soft edge cannot pass through.
 * `graded` false gives a plain lit-or-not answer (1 where enough light is left to see by), which is what sight needs.
 */
export function liftField(cover: ArrayLike<number>, w: number, h: number, reach: number, lift: number, graded: boolean, block?: Uint8Array | null): Float32Array {
  const out = new Float32Array(w * h);
  const on = new Uint8Array(w * h);
  let any = false;
  for (let i = 0; i < out.length; i++) {
    const c = cover[i];
    if (c >= 0.5) { on[i] = 1; any = true; }
    out[i] = graded ? lift * c : c > 0 ? 1 : 0;
  }
  if (!any || !(reach > 0)) return out;
  let walls = false;
  if (block) for (let i = 0; i < block.length; i++) if (block[i]) { walls = true; break; }
  const near = walls ? walkDistance(on, block!, w, h, reach) : null;
  const dist2 = walls ? null : distanceSquared(on, w, h);
  const r2 = reach * reach;
  for (let i = 0; i < out.length; i++) {
    let t: number;
    if (near) { const d = near[i]; if (!(d > 0) || d >= reach) continue; t = d / reach; }
    else { const d2 = dist2![i]; if (d2 === 0 || d2 > r2) continue; t = Math.sqrt(d2) / reach; }
    const share = fadeAt(t);
    if (graded) {
      const halo = lift * share;
      if (halo > out[i]) out[i] = halo;
    } else if (share >= SIGHT_SHARE) out[i] = 1;
  }
  return out;
}

/** The brighter of two lifts, pixel by pixel (daylight over dim light where they overlap). */
export function maxInto(into: Float32Array, other: Float32Array): void {
  for (let i = 0; i < into.length; i++) if (other[i] > into[i]) into[i] = other[i];
}
