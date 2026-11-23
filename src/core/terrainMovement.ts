import type { Rect, Vec } from '../types';
import { cellPoly } from './cells';
import { STAIR_FT } from './height';
import { groundAtTerrain, type Terrain } from './terrain';
import { boxSegments, rayHit } from './walls';

/** Check the finished paint along a walk, including one cliff-height of run on either side.
 * The extra distance lets a short mouse event see the same cliff as a long drag. */
export function paintedCliffBlocks(terrain: Terrain, from: Vec, to: Vec, cliffFt: number, flyingAt = -Infinity): boolean {
  if (cliffFt <= 0 || !terrain.areas.length) return false;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!length) return false;
  const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length;
  const limit = Math.max(STAIR_FT, cliffFt);
  const reach = terrain.grid.cell * limit / Math.max(0.01, terrain.grid.ft);
  const at = (d: number) => ({ x: from.x + ux * d, y: from.y + uy * d });
  const start = at(-reach), end = at(length + reach);
  const overlaps = (b: Rect) => Math.max(start.x, end.x) >= b.x && Math.min(start.x, end.x) <= b.x + b.w
    && Math.max(start.y, end.y) >= b.y && Math.min(start.y, end.y) <= b.y + b.h;
  const cuts = new Set<number>([-reach, 0, length, length + reach]);
  const cut = (d: number) => { if (d > -reach && d < length + reach) cuts.add(d); };
  const edge = (a: Vec, b: Vec) => cut(rayHit(start, ux, uy, { a, b }) - reach);
  const ellipse = (p: Vec, rx: number, ry: number) => {
    if (!rx || !ry) return;
    const x = (from.x - p.x) / rx, y = (from.y - p.y) / ry;
    const dx = ux / rx, dy = uy / ry, a = dx * dx + dy * dy;
    const mid = -(x * dx + y * dy) / a;
    const halfSquared = (1 - (x * dy - y * dx) ** 2 / a) / a;
    if (halfSquared <= 0) return;
    const half = Math.sqrt(halfSquared);
    cut(mid - half);
    cut(mid + half);
  };
  for (const area of terrain.areas) {
    if (!overlaps(area.b)) continue;
    for (const s of area.strokes) {
      if (!overlaps(s.b)) continue;
      const { x, y, w, h } = s.b;
      if (s.kind === 'rect') {
        for (const seg of boxSegments({ x, y }, { x: x + w, y: y + h })) edge(seg.a, seg.b);
      } else if (s.kind === 'ellipse') {
        ellipse({ x: x + w / 2, y: y + h / 2 }, w / 2, h / 2);
      } else if (s.kind === 'cells') {
        for (const p of s.pts) {
          if (!overlaps({ x: p.x - s.r, y: p.y - s.r, w: 2 * s.r, h: 2 * s.r })) continue;
          const corners = cellPoly(terrain.grid, p);
          corners.forEach((v, i) => edge(v, corners[(i + 1) % corners.length]));
        }
      } else {
        // A round brush is a disk at each point joined by straight, parallel sides.
        for (let i = 0; i < s.pts.length; i++) {
          const p = s.pts[i];
          ellipse(p, s.r, s.r);
          if (!i) continue;
          const q = s.pts[i - 1];
          const l = Math.hypot(p.x - q.x, p.y - q.y);
          if (!l) continue;
          const nx = (p.y - q.y) * s.r / l, ny = (q.x - p.x) * s.r / l;
          for (const sign of [-1, 1]) {
            edge({ x: p.x + sign * nx, y: p.y + sign * ny }, { x: q.x + sign * nx, y: q.y + sign * ny });
          }
        }
      }
    }
  }
  // Paint membership is constant between consecutive boundary intersections. Sample
  // those intervals so even a narrow rim or an erased gap survives the test.
  const bounds = [...cuts].sort((a, b) => a - b);
  const rises: { d: number; base: number }[] = [];
  let first = 0, previous: number | undefined, lastCrossed = -Infinity;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const d = bounds[i];
    if (bounds[i + 1] - d < 1e-7) continue;
    const h = groundAtTerrain(terrain, at((d + bounds[i + 1]) / 2));
    if (previous !== undefined && h > previous) {
      rises.push({ d, base: previous });
      while (first < rises.length - 1 && d - rises[first].d >= reach - 1e-7) first++;
      if (d >= -1e-7 && d <= length + 1e-7
        && (d > 1e-7 || groundAtTerrain(terrain, from) < h)
        && (d < length - 1e-7 || groundAtTerrain(terrain, to) > previous)) lastCrossed = d;
      if (lastCrossed >= rises[first].d && h - rises[first].base > limit && flyingAt <= h) return true;
    } else if (previous !== undefined && h < previous) {
      rises.length = 0;
      first = 0;
      lastCrossed = -Infinity;
    }
    previous = h;
  }
  return false;
}
