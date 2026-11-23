import { describe, expect, it } from 'vitest';
import { colorAt, detectPieces, dropSmall, guessWallColor, looksSolid, openMask, simplify, thin, tidy, tracePaths, wallMask, type Piece } from '../src/core/walltrace';
import type { PixelImage } from '../src/core/gridcut';
import { rng } from './helpers/mapgen';

type Line = [number, number, number, number];

/** Floor with a little noise, thin printed grid lines, thick dark walls along `lines`, and small dark specks (furniture, text). */
function drawMap(W: number, H: number, lines: Line[], opts: { t?: number; grid?: number; specks?: number; seed?: number } = {}): PixelImage {
  const t = opts.t ?? 6;
  const r = rng(opts.seed ?? 7);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = 200 + (r() - 0.5) * 16;
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v - 10; data[i * 4 + 3] = 255;
  }
  const put = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < W && y < H) { const p = (y * W + x) * 4; data[p] = v; data[p + 1] = v; data[p + 2] = v; } };
  if (opts.grid) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x % opts.grid === 0 || y % opts.grid === 0) put(x, y, 150);
  for (const [x0, y0, x1, y1] of lines) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let s = 0; s <= len; s += 0.5) {
      const cx = x0 + ((x1 - x0) * s) / len, cy = y0 + ((y1 - y0) * s) / len;
      for (let dy = -t / 2; dy <= t / 2; dy++) for (let dx = -t / 2; dx <= t / 2; dx++) put(Math.round(cx + dx), Math.round(cy + dy), 30);
    }
  }
  for (let k = 0; k < (opts.specks ?? 0); k++) {
    const sx = 20 + Math.floor(r() * (W - 40)), sy = 20 + Math.floor(r() * (H - 40));
    if (lines.some(([x0, y0, x1, y1]) => Math.abs(sx - x0) < 18 && Math.abs(sy - y0) < 18 && Math.abs(sx - x1) < 18 && Math.abs(sy - y1) < 18)) continue;
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) put(sx + dx, sy + dy, 40);
  }
  return { data, width: W, height: H };
}

const distToLine = (p: { x: number; y: number }, [x0, y0, x1, y1]: Line) => {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / l2)) : 0;
  return Math.hypot(p.x - (x0 + t * dx), p.y - (y0 + t * dy));
};
/** how much of each wanted line is covered by a piece, and whether every piece lies on some wanted line */
function score(pieces: Piece[], lines: Line[], tol: number) {
  let on = 0, tot = 0;
  for (const [x0, y0, x1, y1] of lines) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let s = 0; s <= len; s += 5) {
      tot++;
      const p = { x: x0 + ((x1 - x0) * s) / len, y: y0 + ((y1 - y0) * s) / len };
      if (pieces.some((q) => distToLine(p, [q.a.x, q.a.y, q.b.x, q.b.y]) <= tol)) on++;
    }
  }
  let stray = 0;
  for (const q of pieces) {
    const len = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y);
    for (let s = 0; s <= len; s += 5) {
      const p = { x: q.a.x + ((q.b.x - q.a.x) * s) / Math.max(len, 1e-9), y: q.a.y + ((q.b.y - q.a.y) * s) / Math.max(len, 1e-9) };
      if (!lines.some((l) => distToLine(p, l) <= tol)) stray++;
    }
  }
  return { covered: on / tot, stray };
}

const ROOM: Line[] = [[50, 50, 550, 50], [550, 50, 550, 350], [550, 350, 50, 350], [50, 350, 50, 50], [300, 50, 300, 350]];
const OPTS = { color: [30, 30, 30] as [number, number, number], sensitivity: 25, thinPx: 1, minLen: 20, tol: 2.5 };

describe('wall colour', () => {
  it('guesses dark walls, and reads the colour under a click', () => {
    const img = drawMap(300, 200, [[20, 100, 280, 100]]);
    const g = guessWallColor(img);
    expect(g[0]).toBeLessThan(60);
    expect(colorAt(img, 150, 100)[0]).toBeLessThan(60);
    expect(colorAt(img, 150, 20)[0]).toBeGreaterThan(180);
  });
  it('masks only what is near that colour, wider with more sensitivity', () => {
    const img = drawMap(300, 200, [[20, 100, 280, 100]]);
    const count = (s: number) => wallMask(img, [30, 30, 30], s).reduce((a, b) => a + b, 0);
    expect(count(5)).toBeGreaterThan(1000);
    expect(count(5)).toBeLessThan(2400);
    expect(count(100)).toBe(300 * 200);
  });
});

describe('cleaning up the mask', () => {
  it('opening removes lines thinner than the wall and keeps the wall', () => {
    const img = drawMap(200, 100, [[20, 50, 180, 50]], { grid: 20 });
    const m = wallMask(img, [150, 150, 150], 8); // matches the grid lines (and a little more)
    const before = m.reduce((a, b) => a + b, 0);
    const o = openMask(wallMask(img, [30, 30, 30], 25), 200, 100, 1);
    expect(o[50 * 200 + 100]).toBe(1);
    expect(openMask(m, 200, 100, 1).reduce((a, b) => a + b, 0)).toBeLessThan(before * 0.3);
  });
  it('drops small blobs and keeps long ones', () => {
    const w = 100, h = 60;
    const m = new Uint8Array(w * h);
    for (let x = 10; x < 90; x++) for (let y = 30; y < 34; y++) m[y * w + x] = 1;
    for (let x = 10; x < 14; x++) for (let y = 5; y < 9; y++) m[y * w + x] = 1;
    const o = dropSmall(m, w, h, 12);
    expect(o[31 * w + 50]).toBe(1);
    expect(o[6 * w + 11]).toBe(0);
  });
});

describe('thinning and tracing', () => {
  it('thins a thick line to a centre line one pixel wide', () => {
    const w = 80, h = 30;
    const m = new Uint8Array(w * h);
    for (let x = 5; x < 75; x++) for (let y = 12; y < 18; y++) m[y * w + x] = 1;
    const s = thin(m, w, h);
    const col = [...Array(h).keys()].filter((y) => s[y * w + 40]);
    expect(col.length).toBe(1);
    expect(Math.abs(col[0] - 14.5)).toBeLessThanOrEqual(1.5);
  });
  it('follows an L from end to end and a T through its crossing', () => {
    const w = 60, h = 60;
    const sk = new Uint8Array(w * h);
    for (let x = 10; x <= 50; x++) sk[30 * w + x] = 1;
    for (let y = 10; y <= 30; y++) sk[y * w + 30] = 1; // a T
    const paths = tracePaths(sk, w, h, 3);
    expect(paths.length).toBe(3);
  });
  it('simplifies a straight run to its two ends', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 10 + (i % 2) * 0.3 }));
    expect(simplify(pts, 1).length).toBe(2);
  });
});

describe('finding walls in a picture', () => {
  it('finds the walls of a room with a divider, ignoring a printed grid and specks', () => {
    const img = drawMap(600, 400, ROOM, { grid: 50, specks: 25 });
    const pieces = detectPieces(img, OPTS);
    const s = score(pieces, ROOM, 4);
    expect(s.covered).toBeGreaterThan(0.95);
    expect(s.stray).toBeLessThan(6);
    expect(pieces.length).toBeLessThan(30);
  });
  it('finds slanted walls too', () => {
    const lines: Line[] = [[60, 300, 300, 60], [300, 60, 540, 300]];
    const pieces = detectPieces(drawMap(600, 360, lines), OPTS);
    const s = score(pieces, lines, 4);
    expect(s.covered).toBeGreaterThan(0.93);
    expect(s.stray).toBeLessThan(6);
  });
  it('finds a round room as a ring', () => {
    const lines: Line[] = [];
    const n = 48;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * 2 * Math.PI, a1 = ((k + 1) / n) * 2 * Math.PI;
      lines.push([300 + 150 * Math.cos(a0), 200 + 150 * Math.sin(a0), 300 + 150 * Math.cos(a1), 200 + 150 * Math.sin(a1)]);
    }
    const pieces = detectPieces(drawMap(600, 400, lines), OPTS);
    expect(score(pieces, lines, 4).covered).toBeGreaterThan(0.93);
  });
  it('finds nothing in an empty floor', () => {
    expect(detectPieces(drawMap(300, 200, []), OPTS)).toEqual([]);
  });
  it('light walls on a dark floor work when you pick their colour', () => {
    const img = drawMap(400, 300, [[40, 40, 360, 40], [360, 40, 360, 260]]);
    for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) img.data[i + k] = 255 - img.data[i + k];
    const pieces = detectPieces(img, { ...OPTS, color: colorAt(img, 200, 40) });
    expect(score(pieces, [[40, 40, 360, 40], [360, 40, 360, 260]], 4).covered).toBeGreaterThan(0.95);
  });
});

describe('tidying the pieces', () => {
  const T = { join: 8, snapTol: 14, straightDeg: 4, minLen: 10 };
  it('joins corners, snaps to the grid and makes lines straight', () => {
    const img = drawMap(600, 400, ROOM, { grid: 50 });
    const pieces = tidy(detectPieces(img, OPTS), { ...T, snap: (p) => ({ x: Math.round(p.x / 50) * 50, y: Math.round(p.y / 50) * 50 }) });
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const ends = new Set(pieces.flatMap((q) => [key(q.a), key(q.b)]));
    for (const c of ['50,50', '550,50', '550,350', '50,350', '300,50', '300,350']) expect(ends.has(c)).toBe(true);
    expect(pieces.length).toBe(7); // four sides (top and bottom are cut by the divider) and the divider
    for (const q of pieces) expect(q.a.x === q.b.x || q.a.y === q.b.y).toBe(true);
  });
  it('without a grid it still straightens and joins', () => {
    const pieces = tidy(detectPieces(drawMap(600, 400, ROOM), OPTS), T);
    expect(pieces.length).toBe(7);
    expect(score(pieces, ROOM, 4).covered).toBeGreaterThan(0.95);
  });
  it('merges pieces that carry straight on', () => {
    const got = tidy([{ a: { x: 0, y: 0 }, b: { x: 50, y: 0.5 } }, { a: { x: 50, y: 0.5 }, b: { x: 100, y: 0 } }], T);
    expect(got.length).toBe(1);
  });
  it('drops pieces that are too short', () => {
    expect(tidy([{ a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }], T)).toEqual([]);
  });
});

describe('walls along the edge of solid rock', () => {
  /** dark rock everywhere, with light rooms cut out of it, and a few light specks (floor marks) in the rock */
  function rock(rooms: Line[]): PixelImage {
    const W = 600, H = 400;
    const r = rng(3);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const v = 35 + (r() - 0.5) * 10; data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
    for (const [x0, y0, x1, y1] of rooms) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * W + x) * 4; data[p] = 200; data[p + 1] = 195; data[p + 2] = 180; }
    for (let k = 0; k < 12; k++) { const sx = 10 + Math.floor(r() * 560), sy = 10 + Math.floor(r() * 370); for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { const p = ((sy + dy) * W + sx + dx) * 4; data[p] = data[p + 1] = data[p + 2] = 190; } }
    return { data, width: W, height: H };
  }
  const ROOMS: Line[] = [[60, 60, 260, 210], [340, 200, 540, 350]];
  const EDGES: Line[] = [[60, 60, 260, 60], [260, 60, 260, 210], [260, 210, 60, 210], [60, 210, 60, 60], [340, 200, 540, 200], [540, 200, 540, 350], [540, 350, 340, 350], [340, 350, 340, 200]];

  it('tells solid fill from thin lines', () => {
    expect(looksSolid(rock(ROOMS), [35, 35, 35], 20, 8)).toBe(true);
    expect(looksSolid(drawMap(600, 400, ROOM), [30, 30, 30], 25, 8)).toBe(false);
  });
  it('follows the outline of each room, ignoring floor specks in the rock', () => {
    const pieces = detectPieces(rock(ROOMS), { ...OPTS, color: [35, 35, 35], mode: 'edges' });
    const s = score(pieces, EDGES, 4);
    expect(s.covered).toBeGreaterThan(0.95);
    expect(s.stray).toBeLessThan(6);
  });
  it('after tidying, each room is four walls', () => {
    const got = tidy(detectPieces(rock(ROOMS), { ...OPTS, color: [35, 35, 35], mode: 'edges' }), { join: 8, snapTol: 14, straightDeg: 4, minLen: 10 });
    expect(got.length).toBe(8);
    for (const q of got) expect(q.a.x === q.b.x || q.a.y === q.b.y, JSON.stringify(q)).toBe(true);
  });
});
