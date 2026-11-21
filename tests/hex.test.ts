import { describe, expect, it } from 'vitest';
import { coveredCells, cellCentersIn, cellPoly } from '../src/core/cells';
import { snapTemplate, snapToEdgeMid } from '../src/core/draw';
import { distanceFt, gridFromRect, snapToCellCenter, snapToCorner, snapTokenCenter } from '../src/core/geometry';
import { HEX_DIRS, S3, gridPeriod, hexAt, hexCenter, hexCorners, hexDistance, hexEdgeMids, hexNudge, hexToPx, pxToHex, roundHex } from '../src/core/hex';
import { normalizeGrid } from '../src/core/model';
import type { GridSettings } from '../src/types';

const grid = (shape: GridSettings['shape'], over: Partial<GridSettings> = {}): GridSettings => ({
  shape, cell: 60, ox: 13, oy: 7, visible: true, color: '#000', opacity: 0.3, ft: 5, rule: 'chebyshev', snap: true, ...over,
});
const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a: number, b: number, e = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(e);
const cubeDist = (dq: number, dr: number) => Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));

describe('hex layout', () => {
  for (const shape of ['pointy', 'flat'] as const) {
    it(`${shape}: all six neighbours are one cell away, and the corners are where they should be`, () => {
      const g = grid(shape);
      const c = hexToPx(g, 2, -3);
      for (const [dq, dr] of HEX_DIRS) near(d(c, hexToPx(g, 2 + dq, -3 + dr)), g.cell);
      const k = hexCorners(g, c);
      expect(k).toHaveLength(6);
      for (const p of k) near(d(c, p), g.cell / S3);
      // neighbouring corners are one side (cell / sqrt 3) apart
      for (let i = 0; i < 6; i++) near(d(k[i], k[(i + 1) % 6]), g.cell / S3);
    });

    it(`${shape}: (ox, oy) is the top-left of the box around hex (0, 0)`, () => {
      const g = grid(shape);
      const k = hexCorners(g, hexToPx(g, 0, 0));
      near(Math.min(...k.map((p) => p.x)), g.ox);
      near(Math.min(...k.map((p) => p.y)), g.oy);
    });

    it(`${shape}: any point belongs to the hex whose centre is nearest`, () => {
      const g = grid(shape);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 300; i++) {
        const p = { x: rnd() * 800 - 100, y: rnd() * 800 - 100 };
        const c = hexCenter(g, p);
        const h = hexAt(g, p);
        const best = [[0, 0], ...HEX_DIRS].map(([dq, dr]) => hexToPx(g, h.q + dq, h.r + dr)).reduce((m, q) => Math.min(m, d(q, p)), Infinity);
        near(d(c, p), best, 1e-6);
        expect(d(c, p)).toBeLessThanOrEqual(g.cell / S3 + 1e-6);
      }
    });

    it(`${shape}: pxToHex undoes hexToPx`, () => {
      const g = grid(shape);
      for (const [q, r] of [[0, 0], [3, -2], [-4, 5]]) {
        const f = pxToHex(g, hexToPx(g, q, r));
        near(f.q, q); near(f.r, r);
      }
    });

    it(`${shape}: the grid repeats over its period`, () => {
      const g = grid(shape);
      const per = gridPeriod(g);
      const a = hexCenter(g, { x: 200, y: 150 });
      const b = hexCenter(g, { x: 200 + per.x, y: 150 + per.y });
      near(b.x - a.x, per.x);
      near(b.y - a.y, per.y);
    });
  }

  it('rounds to a whole hex', () => {
    expect(roundHex(0.2, 0.1)).toEqual({ q: 0, r: 0 });
    expect(roundHex(2.9, -1.1)).toEqual({ q: 3, r: -1 });
    expect(Object.is(roundHex(-0.2, 0.1).q, -0)).toBe(false);
  });
});

describe('hex distance', () => {
  it('counts hexes, with no diagonals', () => {
    for (const shape of ['pointy', 'flat'] as const) {
      const g = grid(shape);
      for (const [dq, dr] of [[3, 0], [0, 4], [2, -5], [-3, -2], [5, -5], [-1, 6]]) {
        const a = hexToPx(g, 1, 2);
        const b = hexToPx(g, 1 + dq, 2 + dr);
        near(distanceFt(g, a, b), cubeDist(dq, dr) * 5);
      }
    }
  });
  it('counts height against it like squares do', () => {
    const g = grid('pointy');
    const a = hexToPx(g, 0, 0);
    const b = hexToPx(g, 3, 0);
    near(distanceFt(g, a, b, 'chebyshev', 30), 30);
    near(distanceFt(g, a, b, 'chebyshev', 5), 15);
    near(distanceFt(g, a, b, 'alt', 15), 15 + 5); // 5-10-5 for the up part
  });
  it('can still measure a straight line', () => {
    const g = grid('flat');
    const a = hexToPx(g, 0, 0);
    const b = hexToPx(g, 2, 0);
    near(distanceFt(g, a, b, 'euclid'), (d(a, b) / g.cell) * 5, 0.06);
  });
  it('hexDistance works between points that are not at centres', () => {
    const g = grid('pointy');
    const a = hexToPx(g, 0, 0);
    near(hexDistance(g, a, { x: a.x + g.cell / 2, y: a.y }), 0.5);
  });
});

describe('snapping on hexes', () => {
  it('a Medium token sits in the middle of a hex, a Large one on the corner shared by three', () => {
    for (const shape of ['pointy', 'flat'] as const) {
      const g = grid(shape);
      const p = { x: 211, y: 193 };
      const one = snapTokenCenter(g, 1, p);
      near(d(one, hexCenter(g, p)), 0);
      const two = snapTokenCenter(g, 2, p);
      const h = hexAt(g, two);
      // three hex centres are the same distance from a shared corner
      const ds = [[0, 0], ...HEX_DIRS].map(([dq, dr]) => d(two, hexToPx(g, h.q + dq, h.r + dr))).filter((x) => Math.abs(x - g.cell / S3) < 1e-6);
      expect(ds.length).toBe(3);
      // Huge sits in the middle again
      near(d(snapTokenCenter(g, 3, p), hexCenter(g, p)), 0);
      // tiny ones sit in the middle too
      near(d(snapTokenCenter(g, 0.5, p), hexCenter(g, p)), 0);
    }
  });
  it('corners and edge middles', () => {
    const g = grid('pointy');
    const c = hexToPx(g, 1, 1);
    const k = hexCorners(g, c)[2];
    near(d(snapToCorner(g, { x: k.x + 3, y: k.y - 2 }), k), 0);
    const m = hexEdgeMids(g, c)[1];
    near(d(snapToEdgeMid(g, { x: m.x + 2, y: m.y + 1 }), m), 0);
    near(d(snapToCellCenter(g, { x: c.x + 5, y: c.y - 4 }), c), 0);
  });
  it('arrow keys: one up then one down is back where it started, two up is straight up', () => {
    for (const shape of ['pointy', 'flat'] as const) {
      const g = grid(shape);
      for (const start of [hexToPx(g, 0, 0), hexToPx(g, 1, 0), hexToPx(g, 0, 1), hexToPx(g, -2, 3)]) {
        const pairs: ['up' | 'left', 'down' | 'right'][] = [['up', 'down'], ['left', 'right']];
        for (const [fwd, back] of pairs) {
          const s1 = hexNudge(g, start, fwd);
          const p1 = { x: start.x + s1.x, y: start.y + s1.y };
          const s2 = hexNudge(g, p1, back);
          near(p1.x + s2.x, start.x, 1e-6);
          near(p1.y + s2.y, start.y, 1e-6);
          near(d(start, p1), g.cell, 1e-6); // always lands on a neighbour
          const s3 = hexNudge(g, p1, fwd);
          const p2 = { x: p1.x + s3.x, y: p1.y + s3.y };
          if (shape === 'pointy' && fwd === 'up') near(p2.x, start.x, 1e-6);
          if (shape === 'flat' && fwd === 'left') near(p2.y, start.y, 1e-6);
          near(d(p2, hexCenter(g, p2)), 0, 1e-6);
        }
      }
    }
  });
});

describe('hex cells and templates', () => {
  it('lists the hexes whose centre is inside a box, and no others', () => {
    for (const shape of ['pointy', 'flat'] as const) {
      const g = grid(shape);
      const r = { x: 100, y: 80, w: 330, h: 270 };
      const got = cellCentersIn(g, r);
      const all: { x: number; y: number }[] = [];
      for (let q = -20; q < 30; q++) for (let rr = -20; rr < 30; rr++) { const p = hexToPx(g, q, rr); if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) all.push(p); }
      expect(got.length).toBe(all.length);
      for (const p of got) expect(all.some((a) => d(a, p) < 1e-6)).toBe(true);
    }
  });
  it('a hex has six corners', () => {
    expect(cellPoly(grid('flat'), { x: 100, y: 100 })).toHaveLength(6);
    expect(cellPoly(grid('square'), { x: 100, y: 100 })).toHaveLength(4);
  });
  it('a 10 ft sphere on a hex covers the hex, its six neighbours and the ring around them (19)', () => {
    for (const shape of ['pointy', 'flat'] as const) {
      const g = grid(shape);
      const c = hexToPx(g, 2, 2);
      const cells = coveredCells(g, 'sphere', c, { x: c.x + 2 * g.cell, y: c.y }, 0);
      expect(cells.length).toBe(19);
    }
  });
  it('an emanation leaves out its own hex', () => {
    const g = grid('pointy');
    const c = hexToPx(g, 2, 2);
    const cells = coveredCells(g, 'emanation', c, { x: c.x + 1.5 * g.cell, y: c.y }, 0);
    expect(cells.some((p) => d(p, c) < 1)).toBe(false);
    expect(cells.length).toBe(6);
  });
  it('a line along a hex direction snaps onto that direction, in whole hexes', () => {
    for (const shape of ['pointy', 'flat'] as const) {
      const g = grid(shape);
      const start = hexToPx(g, 3, 3);
      const dir = shape === 'pointy' ? 0 : Math.PI / 6;
      const end = { x: start.x + Math.cos(dir + 0.05) * 3.2 * g.cell, y: start.y + Math.sin(dir + 0.05) * 3.2 * g.cell };
      const out = snapTemplate(g, start, end, { origin: true, length: true, kind: 'beam', widthPx: g.cell });
      near(Math.atan2(out.b.y - out.a.y, out.b.x - out.a.x), dir, 1e-6);
      near(d(out.a, out.b), 3 * g.cell, 1e-6);
    }
  });
});

describe('setting the grid from a box over hexes', () => {
  it('pointy: the width of the row gives the size, the corner gives the offset', () => {
    const r = gridFromRect({ x: 100, y: 50, w: 5 * 80, h: 90 }, 5, 1, 'pointy');
    near(r.cell, 80);
    near(r.ox, 20);
    near(r.oy, 50);
  });
  it('flat: the height of the column gives the size', () => {
    const r = gridFromRect({ x: 300, y: 40, w: 70, h: 3 * 60 }, 1, 3, 'flat');
    near(r.cell, 60);
    near(r.ox, 300 % (60 * S3));
    near(r.oy, 40);
  });
  it('squares work as before', () => {
    const r = gridFromRect({ x: 100, y: 50, w: 300, h: 300 }, 3, 3);
    near(r.cell, 100);
    near(r.ox, 0);
    near(r.oy, 50);
  });
});

describe('the hex setting is stored', () => {
  it('defaults to squares, and keeps a hex choice', () => {
    expect(normalizeGrid({}).shape).toBe('square');
    expect(normalizeGrid({ shape: 'pointy' }).shape).toBe('pointy');
    expect(normalizeGrid({ shape: 'flat' }).shape).toBe('flat');
    expect(normalizeGrid({ shape: 'triangle' }).shape).toBe('square');
  });
});
