// "Auto-add lights": where a DM would put them. Two kinds of place, both only ever *proposed* (the DM sees them and adds them in one step):
//  - lamps and torches already drawn on the map picture (a small, bright, warm blob that stands out from what is round it);
//  - the rooms the walls make: a room with no light gets just enough of them that nearly all of it is lit, and walls stop the light as they do in play.
// Plain arrays and numbers, so it is tested on drawn maps without a browser.

import type { GridSettings, Rect, Vec } from '../types';
import type { PixelImage } from './gridcut';
import { distToSeg, lineOfSight, reachableCells, type Seg } from './walls';

export interface LightSpot {
  x: number;
  y: number;
  /** a lamp seen on the picture, or a light that a walled room needs */
  why: 'lamp' | 'room';
}

// ------------------------------------------------------------------ lamps on the picture
const MAX_LAMPS = 60;

/** hue 0..360, saturation and value 0..1 */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

/** Is this pixel the colour of a flame or a lit lamp: orange to yellow, bright, and strong? */
export function isGlow(r: number, g: number, b: number): boolean {
  const [h, s, v] = hsv(r, g, b);
  return v >= 0.8 && s >= 0.35 && h >= 12 && h <= 62;
}

/**
 * Small bright warm blobs that stand out from the ground round them: torches, braziers, lanterns and campfires drawn on the picture.
 * `cellPx` is how many pixels of this picture one grid square is. A blob has to be between about a fiftieth of a square and a square and a half,
 * roughly round, and not sitting in more of the same colour (a sandy floor or an orange rug is not a lamp). Centres are in picture pixels.
 */
export function findLamps(img: PixelImage, cellPx: number): { x: number; y: number; area: number }[] {
  const { width: w, height: h, data } = img;
  const glow = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (data[p + 3] > 200 && isGlow(data[p], data[p + 1], data[p + 2])) glow[i] = 1;
  const cell2 = cellPx * cellPx;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const found: { x: number; y: number; area: number }[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!glow[start] || seen[start]) continue;
    let head = 0, tail = 0, sx = 0, sy = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && glow[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
      if (x < w - 1 && glow[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
      if (y > 0 && glow[i - w] && !seen[i - w]) { seen[i - w] = 1; queue[tail++] = i - w; }
      if (y < h - 1 && glow[i + w] && !seen[i + w]) { seen[i + w] = 1; queue[tail++] = i + w; }
    }
    const area = tail;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (area < cell2 * 0.02 || area > cell2 * 1.5 || area < 6) continue;
    if (Math.max(bw, bh) > Math.min(bw, bh) * 2.2) continue; // a line or a strip is not a lamp
    if (area < bw * bh * 0.4) continue; // a ring or a thin shape is not either
    // the same colour all round it means it is the ground, not a lamp
    const pad = Math.max(2, Math.round(Math.max(bw, bh) * 0.6));
    let ring = 0, ringGlow = 0;
    for (let y = Math.max(0, y0 - pad); y <= Math.min(h - 1, y1 + pad); y++) {
      for (let x = Math.max(0, x0 - pad); x <= Math.min(w - 1, x1 + pad); x++) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
        ring++;
        if (glow[y * w + x]) ringGlow++;
      }
    }
    if (ring && ringGlow / ring > 0.3) continue;
    found.push({ x: sx / area, y: sy / area, area });
  }
  // the biggest first, and one lamp for blobs that touch or sit within half a square of each other
  found.sort((a, b) => b.area - a.area);
  const out: { x: number; y: number; area: number }[] = [];
  for (const f of found) {
    if (out.some((o) => Math.hypot(o.x - f.x, o.y - f.y) < cellPx * 0.5)) continue;
    out.push(f);
    if (out.length >= MAX_LAMPS) break;
  }
  return out;
}

// ------------------------------------------------------------------ rooms made by walls
export interface Room {
  /** centres of the raster cells inside the room */
  cells: Vec[];
  /** the raster's size of step in pixels */
  step: number;
}

const MAX_RASTER = 1_500_000;

function crosses(a: Vec, b: Vec, s: Seg): boolean {
  const d1x = b.x - a.x, d1y = b.y - a.y, d2x = s.b.x - s.a.x, d2y = s.b.y - s.a.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((s.a.x - a.x) * d2y - (s.a.y - a.y) * d2x) / den;
  const u = ((s.a.x - a.x) * d1y - (s.a.y - a.y) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * The enclosed rooms: the places the walls close off completely. The raster is half a square (or coarser for a huge map); two neighbouring
 * raster cells are in the same room unless a wall runs between their middles. Whatever reaches the edge of the area round the walls is outside.
 */
export function findRooms(segs: Seg[], grid: Pick<GridSettings, 'cell'>, minSquares = 3): Room[] {
  if (!segs.length) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) for (const p of [s.a, s.b]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const pad = grid.cell * 2;
  const box: Rect = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  let step = grid.cell / 2;
  while ((box.w / step) * (box.h / step) > MAX_RASTER) step *= 1.25;
  const W = Math.ceil(box.w / step), H = Math.ceil(box.h / step);
  const cx = (i: number) => box.x + (i + 0.5) * step;
  const cy = (j: number) => box.y + (j + 0.5) * step;
  // which walls are near which raster cells
  const hash = new Map<number, number[]>();
  const put = (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return;
    const key = j * W + i;
    const list = hash.get(key);
    if (!list) hash.set(key, [k]); else if (list[list.length - 1] !== k) list.push(k);
  };
  segs.forEach((s, k) => {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const n = Math.max(1, Math.ceil(len / (step / 3)));
    for (let m = 0; m <= n; m++) {
      const px = s.a.x + ((s.b.x - s.a.x) * m) / n, py = s.a.y + ((s.b.y - s.a.y) * m) / n;
      const i = Math.floor((px - box.x) / step), j = Math.floor((py - box.y) / step);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) put(i + di, j + dj, k);
    }
  });
  const blocked = (i0: number, j0: number, i1: number, j1: number): boolean => {
    const a = { x: cx(i0), y: cy(j0) }, b = { x: cx(i1), y: cy(j1) };
    const seen = new Set<number>();
    for (const key of [j0 * W + i0, j1 * W + i1]) {
      for (const k of hash.get(key) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        if (crosses(a, b, segs[k])) return true;
      }
    }
    return false;
  };
  const label = new Int32Array(W * H).fill(-1);
  const rooms: Room[] = [];
  const stack: number[] = [];
  let id = 0;
  for (let start = 0; start < W * H; start++) {
    if (label[start] >= 0) continue;
    let touchesEdge = false;
    const members: number[] = [];
    stack.push(start); label[start] = id;
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      const i = c % W, j = (c - i) / W;
      if (i === 0 || j === 0 || i === W - 1 || j === H - 1) touchesEdge = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nc = nj * W + ni;
        if (label[nc] >= 0 || blocked(i, j, ni, nj)) continue;
        label[nc] = id;
        stack.push(nc);
      }
    }
    id++;
    if (touchesEdge) continue;
    if (members.length * step * step < minSquares * grid.cell * grid.cell) continue;
    rooms.push({ step, cells: members.map((c) => ({ x: cx(c % W), y: cy(Math.floor(c / W)) })) });
  }
  return rooms;
}

export interface RoomLightOptions {
  /** how far one light is counted as lighting a room, in pixels */
  reachPx: number;
  /** lights already there (placed lights, torches the map shows): the ground they reach counts as lit */
  lit?: Vec[];
  /** the share of a room that should be lit (0..1) */
  target?: number;
  maxPerRoom?: number;
  max?: number;
  minSquares?: number;
}

const MAX_CANDIDATES = 320;
const MAX_TARGETS = 1400;

/** Lights for the enclosed rooms that are not lit enough, in as few places as it takes (a greedy cover that respects walls). Squares' middles, not raster points. */
export function roomLights(segs: Seg[], grid: GridSettings, opts: RoomLightOptions): Vec[] {
  const target = opts.target ?? 0.9;
  const maxPerRoom = opts.maxPerRoom ?? 12;
  const max = opts.max ?? 80;
  const reach = opts.reachPx;
  const rooms = findRooms(segs, grid, opts.minSquares ?? 3);
  const out: Vec[] = [];
  const near = (p: Vec) => segs.filter((s) => distToSeg(p, s) < reach + grid.cell);
  for (const room of rooms) {
    if (out.length >= max) break;
    const stride = Math.max(1, Math.ceil(room.cells.length / MAX_TARGETS));
    const targets = room.cells.filter((_, i) => i % stride === 0);
    const lit = new Array<boolean>(targets.length).fill(false);
    const cover = (from: Vec): number[] => {
      const local = near(from);
      const inReach = targets.map((t, i) => ({ t, i })).filter(({ t }) => Math.hypot(t.x - from.x, t.y - from.y) <= reach);
      const ok = new Set(inReach.length ? reachableCells(inReach.map((r) => r.t), from, local) : []);
      return inReach.filter((r) => ok.has(r.t)).map((r) => r.i);
    };
    for (const l of opts.lit ?? []) {
      // a light outside the room can still shine into it through a gap, so every known light is tried
      if (!room.cells.some((c) => Math.hypot(c.x - l.x, c.y - l.y) <= reach)) continue;
      for (const i of cover(l)) lit[i] = true;
    }
    const cstride = Math.max(1, Math.ceil(room.cells.length / MAX_CANDIDATES));
    const candidates = room.cells.filter((_, i) => i % cstride === 0);
    const covers = new Map<number, number[]>();
    const coverOf = (ci: number) => { let c = covers.get(ci); if (!c) { c = cover(candidates[ci]); covers.set(ci, c); } return c; };
    const need = () => targets.length - lit.filter(Boolean).length;
    // the middle of the room, to prefer a central spot when two spots light as much
    const mid = room.cells.reduce((a, c) => ({ x: a.x + c.x / room.cells.length, y: a.y + c.y / room.cells.length }), { x: 0, y: 0 });
    let placed = 0;
    while (placed < maxPerRoom && out.length < max && targets.length - need() < targets.length * target) {
      let best = -1, bestGain = 0, bestMid = Infinity;
      for (let ci = 0; ci < candidates.length; ci++) {
        const gain = coverOf(ci).filter((i) => !lit[i]).length;
        const dm = Math.hypot(candidates[ci].x - mid.x, candidates[ci].y - mid.y);
        if (gain > bestGain || (gain === bestGain && gain > 0 && dm < bestMid)) { best = ci; bestGain = gain; bestMid = dm; }
      }
      // stop when one more light would add next to nothing (a corner the walls hide from everywhere)
      if (best < 0 || bestGain < Math.max(2, targets.length * 0.03)) break;
      for (const i of coverOf(best)) lit[i] = true;
      out.push(snapToSquare(grid, candidates[best], room, segs));
      placed++;
    }
  }
  return out;
}

/** A light sits on the middle of a square, unless that square's middle is on the far side of a wall from where it was meant to go. */
function snapToSquare(grid: GridSettings, p: Vec, _room: Room, segs: Seg[]): Vec {
  if (grid.shape !== 'square') return p;
  const s = { x: grid.ox + (Math.floor((p.x - grid.ox) / grid.cell) + 0.5) * grid.cell, y: grid.oy + (Math.floor((p.y - grid.oy) / grid.cell) + 0.5) * grid.cell };
  return lineOfSight(p, s, segs.filter((g) => distToSeg(p, g) < grid.cell)) ? s : p;
}
