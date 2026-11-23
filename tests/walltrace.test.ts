import { describe, expect, it } from 'vitest';
import { closeMask, colorAt, detectPieces, dropSmall, guessWallColor, looksSolid, openMask, simplify, smoothPath, suggestSensitivity, thin, tidy, traceContours, tracePaths, wallMask, type Piece } from '../src/core/walltrace';
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

describe('outlines of shapes', () => {
  const shape = (w: number, h: number, rects: [number, number, number, number][]) => {
    const m = new Uint8Array(w * h);
    for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
    return m;
  };
  it('follows a shape all the way round, back to where it began', () => {
    const loops = traceContours(shape(20, 14, [[4, 3, 14, 9]]), 20, 14);
    expect(loops.length).toBe(1);
    const l = loops[0];
    expect(l[0]).toEqual(l[l.length - 1]);
    expect(l.length).toBe(2 * (10 + 6) + 1);
    const s = simplify(l, 0.5);
    expect(s.length).toBe(5); // four corners, and the start again
  });
  it('gives a line that stops at the picture edge where a shape runs off it', () => {
    const loops = traceContours(shape(20, 14, [[0, 3, 8, 9]]), 20, 14);
    expect(loops.length).toBe(1);
    const l = loops[0];
    expect(l[0]).not.toEqual(l[l.length - 1]); // open
    expect(l.every((p) => p.x > 0 || p.y === 3 || p.y === 9 || true)).toBe(true);
    expect(l.some((p) => p.x === 0 && p.y > 3 && p.y < 9)).toBe(false); // nothing along the picture's own border
  });
  it('keeps two shapes that only touch corner to corner apart', () => {
    expect(traceContours(shape(10, 10, [[2, 2, 4, 4], [4, 4, 6, 6]]), 10, 10).length).toBe(2);
  });
  it('closing fills a narrow notch and leaves wide gaps', () => {
    const w = 40, h = 20;
    const m = shape(w, h, [[2, 5, 38, 15]]);
    for (let y = 5; y < 10; y++) m[y * w + 10] = 0; // a notch one pixel wide
    for (let y = 5; y < 10; y++) for (let x = 25; x < 31; x++) m[y * w + x] = 0; // and a wide one
    const c = closeMask(m, w, h, 2);
    expect(c[7 * w + 10]).toBe(1);
    expect(c[7 * w + 28]).toBe(0);
  });
  it('smoothing takes the stair-steps out of an outline and keeps the ends of an open line', () => {
    const pts = Array.from({ length: 41 }, (_, i) => ({ x: i, y: 10 + (i % 2) }));
    const s = smoothPath(pts, 3);
    expect(s[0]).toEqual(pts[0]);
    expect(s[40]).toEqual(pts[40]);
    const wobble = (a: { y: number }[]) => Math.max(...a.slice(5, 35).map((p) => p.y)) - Math.min(...a.slice(5, 35).map((p) => p.y));
    expect(wobble(s)).toBeLessThan(wobble(pts) / 2);
  });
});

/**
 * Pictures built to have what the two maps that failed had: (a) dark rock that fades softly into a ragged crystal fringe and a blue-grey floor
 * that is close enough to the rock colour for the old fixed setting to swallow it; (b) no wall colour at all, only shadow and texture.
 */
describe('maps that used to fail', () => {
  const W = 700, H = 900, CELL = 40;
  /** two big pieces of dark rock, ragged along the edge of a winding passage */
  const void1: [number, number][] = [[0, 0], [250, 0], [250, 300], [180, 420], [190, 560], [120, 700], [0, 760]];
  const void2: [number, number][] = [[450, 0], [700, 0], [700, 800], [560, 860], [520, 700], [470, 560], [520, 380], [450, 220]];
  const inside = (poly: [number, number][], x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const segDist = (x: number, y: number, a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
  };
  const edgeDist = (poly: [number, number][], x: number, y: number) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(x, y, poly[i], poly[(i + 1) % poly.length]));
    return d;
  };
  function tunnelLike(): PixelImage {
    const r = rng(11);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const dIn = Math.min(...[void1, void2].map((poly) => (inside(poly, x, y) ? -edgeDist(poly, x, y) : edgeDist(poly, x, y))));
        // 0 deep in the rock, 1 out on the floor, with a soft ramp about a square wide and a ragged fringe on it
        const t = Math.max(0, Math.min(1, (dIn + 10 + (r() - 0.5) * 34) / 34));
        const n = (r() - 0.5) * 8;
        data[p] = 8 + t * 40 + n; data[p + 1] = 14 + t * 55 + n; data[p + 2] = 50 + t * 55 + n; data[p + 3] = 255;
      }
    }
    // cobbles: thin darker cracks over the floor
    for (let k = 0; k < 160; k++) {
      const x0 = Math.floor(r() * W), y0 = Math.floor(r() * H), a = r() * Math.PI;
      for (let s = 0; s < 22; s++) {
        const x = Math.round(x0 + Math.cos(a) * s), y = Math.round(y0 + Math.sin(a) * s);
        if (x < 0 || y < 0 || x >= W || y >= H || inside(void1, x, y) || inside(void2, x, y)) continue;
        const p = (y * W + x) * 4; data[p] -= 12; data[p + 1] -= 14; data[p + 2] -= 10;
      }
    }
    return { data, width: W, height: H };
  }
  /** how much of the edge of the rock has a piece near it, and how much of the pieces lie away from any edge */
  const fit = (pieces: Piece[], tol: number) => {
    const edge = [...void1, ...void2];
    let on = 0, tot = 0, stray = 0, all = 0;
    for (const poly of [void1, void2]) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let s = 0; s <= len; s += 10) {
          const x = a[0] + ((b[0] - a[0]) * s) / len, y = a[1] + ((b[1] - a[1]) * s) / len;
          if (x < 8 || y < 8 || x > W - 8 || y > H - 8) continue; // the picture's own border is not a wall
          tot++;
          if (pieces.some((q) => segDist(x, y, [q.a.x, q.a.y], [q.b.x, q.b.y]) <= tol)) on++;
        }
      }
    }
    for (const q of pieces) {
      const len = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y);
      for (let s = 0; s <= len; s += 10) {
        all++;
        const x = q.a.x + ((q.b.x - q.a.x) * s) / len, y = q.a.y + ((q.b.y - q.a.y) * s) / len;
        if (Math.min(edgeDist(void1, x, y), edgeDist(void2, x, y)) > tol) stray++;
      }
    }
    void edge;
    return { covered: on / Math.max(1, tot), stray: stray / Math.max(1, all) };
  };
  const solidOpts = (sens: number) => ({ color: [8, 14, 50] as [number, number, number], sensitivity: sens, thinPx: 1, minLen: CELL * 0.75, tol: CELL * 0.25, smoothPx: Math.round(CELL * 0.2), mode: 'edges' as const });

  it('works out a tight setting for dark rock with a flat colour, and says the colour is clear', () => {
    const img = tunnelLike();
    const g = guessWallColor(img);
    expect(g[2]).toBeLessThan(80);
    const s = suggestSensitivity(img, g);
    expect(s.clear).toBe(true);
    expect(s.sens).toBeLessThan(15);
    expect(looksSolid(img, g, s.sens, CELL * 0.3)).toBe(true);
  });
  it('draws long walls along the edge of the rock instead of a scatter of stubs', () => {
    const img = tunnelLike();
    const s = suggestSensitivity(img, guessWallColor(img));
    const pieces = tidy(detectPieces(img, solidOpts(s.sens)), { join: CELL * 0.2, snapTol: 0, straightDeg: 4, minLen: CELL * 0.75 });
    const f = fit(pieces, CELL * 0.6);
    expect(f.covered).toBeGreaterThan(0.85);
    expect(f.stray).toBeLessThan(0.1);
    expect(pieces.length).toBeLessThan(60);
    const total = pieces.reduce((t, q) => t + Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y), 0);
    expect(total / pieces.length).toBeGreaterThan(CELL * 0.9); // pieces about a square or longer on average
  });
  it('the same rock traced with a fixed setting, no smoothing and a tiny tolerance is mostly thrown away as stubs', () => {
    const img = tunnelLike();
    const T = { join: CELL * 0.2, snapTol: 0, straightDeg: 4, minLen: CELL * 0.75 };
    const old = tidy(detectPieces(img, { ...solidOpts(22), tol: 2.5, smoothPx: 0 }), T);
    const now = tidy(detectPieces(img, solidOpts(suggestSensitivity(img, [8, 14, 50]).sens)), T);
    expect(fit(old, CELL * 0.6).covered).toBeLessThan(0.3);
    expect(fit(now, CELL * 0.6).covered).toBeGreaterThan(0.85);
  });
  it('the old fixed setting let the rock colour run into the floor, which the suggested one does not', () => {
    const img = tunnelLike();
    const cover = (s: number) => wallMask(img, [8, 14, 50], s).reduce((a, b) => a + b, 0) / (W * H);
    const sug = suggestSensitivity(img, [8, 14, 50]).sens;
    expect(cover(22)).toBeGreaterThan(cover(sug) + 0.2);
  });
  it('leaves rock that touches the picture edge open there: no wall along the border', () => {
    const img = tunnelLike();
    const pieces = detectPieces(img, solidOpts(suggestSensitivity(img, [8, 14, 50]).sens));
    const onBorder = pieces.filter((q) => (q.a.x < 3 && q.b.x < 3) || (q.a.y < 3 && q.b.y < 3) || (q.a.x > W - 3 && q.b.x > W - 3) || (q.a.y > H - 3 && q.b.y > H - 3));
    expect(onBorder.length).toBe(0);
  });

  /** grass and shadow: dark colour everywhere in blotches, no flat wall colour to pick */
  function shadowy(): PixelImage {
    const r = rng(5);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const v = (r() - 0.5) * 60; data[i * 4] = 90 + v; data[i * 4 + 1] = 130 + v; data[i * 4 + 2] = 50 + v * 0.6; data[i * 4 + 3] = 255; }
    for (let k = 0; k < 400; k++) {
      const cx = r() * W, cy = r() * H, rad = 6 + r() * 22, shade = 0.35 + r() * 0.5;
      for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(H, cy + rad); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(W, cx + rad); x++) {
        if (Math.hypot(x - cx, y - cy) > rad * (0.7 + r() * 0.3)) continue;
        const p = (y * W + x) * 4; data[p] *= shade; data[p + 1] *= shade; data[p + 2] *= shade;
      }
    }
    return { data, width: W, height: H };
  }
  it('says so when the colour is only texture and shadow, with nothing flat to pick', () => {
    const img = shadowy();
    expect(suggestSensitivity(img, guessWallColor(img)).clear).toBe(false);
    expect(suggestSensitivity(img, colorAt(img, 300, 400, 2)).clear).toBe(false);
  });
  it('a colour that is only texture is outlined coarsely: far fewer pieces than a fine outline of the same ragged shapes', () => {
    const img = shadowy();
    const g = guessWallColor(img);
    const base = { color: g, sensitivity: 22, thinPx: 1, minLen: CELL * 0.75, mode: 'edges' as const };
    const fine = detectPieces(img, { ...base, tol: CELL * 0.25, smoothPx: Math.round(CELL * 0.2) });
    const coarse = detectPieces(img, { ...base, tol: CELL * 0.5, smoothPx: Math.round(CELL * 0.4) });
    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.length).toBeLessThan(fine.length * 0.7);
  });
  it('still calls flat ink clear', () => {
    const img = drawMap(600, 400, ROOM, { grid: 50 });
    expect(suggestSensitivity(img, [30, 30, 30]).clear).toBe(true);
  });
});
