import type { Rect } from '../types';

/** One label box inside each connected patch of the finished elevation raster, in raster pixels. */
export function terrainLabelBoxes(height: Float32Array, covered: Uint8Array, width: number, heightPx: number) {
  // Sample in text-shaped tiles. A square of these tiles has room for a short horizontal label.
  const dy = Math.max(1, Math.ceil(Math.max(width, heightPx) / 768));
  const dx = 2 * dy;
  const cols = Math.floor(width / dx), rows = Math.floor(heightPx / dy);
  const size = cols * rows;
  const levels = new Float32Array(size).fill(NaN);
  const side = new Uint16Array(size);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const pixel = (y * dy + (dy >> 1)) * width + x * dx + (dx >> 1);
      if (!covered[pixel]) continue;
      const h = levels[i] = height[pixel];
      // Largest same-height rectangle of the target proportions ending at this tile.
      side[i] = 1;
      if (x && y && levels[i - 1] === h && levels[i - cols] === h && levels[i - cols - 1] === h) {
        side[i] += Math.min(side[i - 1], side[i - cols], side[i - cols - 1]);
      }
    }
  }

  const boxes: (Rect & { elevation: number })[] = [];
  const queue = new Int32Array(size);
  for (let start = 0; start < size; start++) {
    const h = levels[start];
    if (Number.isNaN(h)) continue;
    queue[0] = start;
    levels[start] = NaN;
    let count = 1, sumX = 0, sumY = 0;
    const visit = (i: number) => {
      if (levels[i] === h) { levels[i] = NaN; queue[count++] = i; }
    };
    for (let head = 0; head < count; head++) {
      const i = queue[head], x = i % cols;
      sumX += x + 0.5; sumY += Math.floor(i / cols) + 0.5;
      if (x > 0) visit(i - 1);
      if (x + 1 < cols) visit(i + 1);
      if (i >= cols) visit(i - cols);
      if (i + cols < size) visit(i + cols);
    }
    let best = 0, distance = Infinity, left = 0, top = 0;
    for (let j = 0; j < count; j++) {
      const i = queue[j], n = side[i];
      if (n < best) continue;
      const x = i % cols + 1 - n, y = Math.floor(i / cols) + 1 - n;
      const d = (x + n / 2 - sumX / count) ** 2 + (y + n / 2 - sumY / count) ** 2;
      if (n > best || d < distance) {
        best = n; distance = d; left = x; top = y;
      }
    }
    boxes.push({ elevation: h, x: left * dx, y: top * dy, w: best * dx, h: best * dy });
  }
  return boxes;
}
