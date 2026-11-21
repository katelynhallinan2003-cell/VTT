/**
 * Magic wand helpers for the token maker. Everything here works on plain pixel arrays so it can be tested
 * without a browser: a selection is a Uint8Array with one byte per pixel (1 = selected).
 */

/** Largest possible distance between two RGBA colours (every channel 0 against 255). */
const MAX_DIST = 510;

/**
 * Flood-fill from (sx, sy): selects every connected pixel whose colour is close to the starting pixel.
 * `sensitivity` runs 0 (only the exact colour) to 100 (everything). Transparent pixels all count as one colour.
 */
export function wandSelect(data: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, sensitivity: number): Uint8Array {
  const out = new Uint8Array(w * h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const s = (sy * w + sx) * 4;
  const a0 = data[s + 3];
  const r0 = (data[s] * a0) / 255, g0 = (data[s + 1] * a0) / 255, b0 = (data[s + 2] * a0) / 255;
  const lim = (Math.max(0, Math.min(100, sensitivity)) / 100) * MAX_DIST;
  const lim2 = lim * lim;
  const near = (i: number): boolean => {
    const p = i * 4;
    const a = data[p + 3];
    const dr = (data[p] * a) / 255 - r0, dg = (data[p + 1] * a) / 255 - g0, db = (data[p + 2] * a) / 255 - b0, da = a - a0;
    return dr * dr + dg * dg + db * db + da * da <= lim2;
  };
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const start = sy * w + sx;
  out[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0 && !out[i - 1] && near(i - 1)) { out[i - 1] = 1; queue[tail++] = i - 1; }
    if (x < w - 1 && !out[i + 1] && near(i + 1)) { out[i + 1] = 1; queue[tail++] = i + 1; }
    if (i >= w && !out[i - w] && near(i - w)) { out[i - w] = 1; queue[tail++] = i - w; }
    if (i < w * (h - 1) && !out[i + w] && near(i + w)) { out[i + w] = 1; queue[tail++] = i + w; }
  }
  return out;
}

/** Everything selected in either mask. */
export function unionMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < out.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

export function maskCount(m: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) n++;
  return n;
}

/**
 * Turns a selection into two RGBA pixel buffers:
 *  - `clip`: opaque wherever painting is allowed (inside the selection, or outside it when inverted);
 *  - `overlay`: what to show on top of the token: a light tint over the allowed area with a dashed edge.
 */
export function selectionPixels(sel: Uint8Array, inverted: boolean, w: number, h: number, edge = 2): { clip: Uint8ClampedArray<ArrayBuffer>; overlay: Uint8ClampedArray<ArrayBuffer> } {
  const clip = new Uint8ClampedArray(w * h * 4);
  const overlay = new Uint8ClampedArray(w * h * 4);
  const allowed = (x: number, y: number) => (inverted ? !sel[y * w + x] : !!sel[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!allowed(x, y)) continue;
      const p = (y * w + x) * 4;
      clip[p + 3] = 255;
      let onEdge = false;
      for (let d = 1; d <= edge && !onEdge; d++) {
        if ((x - d >= 0 && !allowed(x - d, y)) || (x + d < w && !allowed(x + d, y)) || (y - d >= 0 && !allowed(x, y - d)) || (y + d < h && !allowed(x, y + d))) onEdge = true;
      }
      if (onEdge) {
        const bright = ((x + y) >> 3) & 1;
        overlay[p] = bright ? 255 : 20; overlay[p + 1] = bright ? 255 : 90; overlay[p + 2] = bright ? 255 : 220; overlay[p + 3] = 255;
      } else {
        overlay[p] = 70; overlay[p + 1] = 150; overlay[p + 2] = 255; overlay[p + 3] = 70;
      }
    }
  }
  return { clip, overlay };
}

/** How far to push the sensitivity while dragging: farther from where you clicked means more is selected. */
export function sensitivityForDrag(distPx: number): number {
  return Math.max(0, Math.min(100, Math.round(distPx * 0.6)));
}
