// Painted light: daylight and dim light the DM paints onto the ground of a dim or dark scene.
//
// What is painted lifts the dark completely (daylight) or by half (dim light). Beyond it the light fades out over the scene's
// "soft edge", like the dim part of a torch: half as bright at the painted edge, nothing at the end of the edge.
// The numbers are worked out on a coarse grid of pixels (`cover`: how much of each pixel was painted, 0 to 1).

/** How much of the dark each pixel of painted light lifts at the very edge of what was painted, before it fades out. */
export const EDGE_LIFT = 0.5;

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

/**
 * How much of the dark painted light lifts at each pixel, 0 to 1. `lift` is what the painted part itself gives (1 for daylight, 0.5 for dim
 * light). `reach` is how many pixels the soft edge runs beyond it. `graded` false gives a plain lit-or-not answer (1 where there is any light at all),
 * which is what sight needs.
 */
export function liftField(cover: ArrayLike<number>, w: number, h: number, reach: number, lift: number, graded: boolean): Float32Array {
  const out = new Float32Array(w * h);
  const on = new Uint8Array(w * h);
  let any = false;
  for (let i = 0; i < out.length; i++) {
    const c = cover[i];
    if (c >= 0.5) { on[i] = 1; any = true; }
    out[i] = graded ? lift * c : c > 0 ? 1 : 0;
  }
  if (!any || !(reach > 0)) return out;
  const dist2 = distanceSquared(on, w, h);
  const r2 = reach * reach;
  for (let i = 0; i < out.length; i++) {
    const d2 = dist2[i];
    if (d2 === 0 || d2 > r2) continue;
    const halo = graded ? EDGE_LIFT * (1 - Math.sqrt(d2) / reach) : 1;
    if (halo > out[i]) out[i] = halo;
  }
  return out;
}

/** The brighter of two lifts, pixel by pixel (daylight over dim light where they overlap). */
export function maxInto(into: Float32Array, other: Float32Array): void {
  for (let i = 0; i < into.length; i++) if (other[i] > into[i]) into[i] = other[i];
}
