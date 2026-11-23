import { describe, expect, it } from 'vitest';
import { cliffSegs, cellsOnLine, rampCells, walkExtra, walkNote, STAIR_FT } from '../src/core/walk';
import { sideOf, segsFrom } from '../src/core/walls';
import { roughOf, isRough, zonesOf, groundAt } from '../src/core/height';
import type { Drawing, GridSettings } from '../src/types';

const grid = (over: Partial<GridSettings> = {}): GridSettings => ({
  shape: 'square', cell: 100, ox: 0, oy: 0, visible: true, color: '#000', opacity: 0.3, ft: 5, rule: 'alt', snap: true, ...over,
});
const at = (i: number, j: number) => ({ x: i * 100 + 50, y: j * 100 + 50 });
/** ground that is `h` ft high in columns i0..i1 (all rows) */
const flat = (heights: Record<number, number>) => (p: { x: number; y: number }) => heights[Math.floor(p.x / 100)] ?? 0;
const none = () => false;

describe('cellsOnLine', () => {
  it('lists the squares a straight move passes through, starting with the first', () => {
    const cs = cellsOnLine(grid(), at(0, 0), at(3, 0));
    expect(cs.map((c) => c.x)).toEqual([50, 150, 250, 350]);
  });
  it('a move inside one square is that square', () => {
    expect(cellsOnLine(grid(), { x: 10, y: 10 }, { x: 40, y: 40 })).toHaveLength(1);
  });
});

describe('stairs cost like diagonal steps', () => {
  const stairs = flat({ 1: 5, 2: 10, 3: 15, 4: 20 }); // four 5 ft steps going east
  it('on the 5-10-5 rule every second stair costs one more square', () => {
    const ex = walkExtra(grid({ rule: 'alt' }), at(0, 0), at(4, 0), { ground: stairs, rough: none });
    expect(ex.stairs).toBe(4);
    expect(ex.extraFt).toBe(10); // two of the four cost double
    const two = walkExtra(grid({ rule: 'alt' }), at(0, 0), at(2, 0), { ground: stairs, rough: none });
    expect(two.extraFt).toBe(5);
    const one = walkExtra(grid({ rule: 'alt' }), at(0, 0), at(1, 0), { ground: stairs, rough: none });
    expect(one.extraFt).toBe(0);
  });
  it('on the 5-5-5 rule a stair is a diagonal and costs nothing extra', () => {
    expect(walkExtra(grid({ rule: 'chebyshev' }), at(0, 0), at(4, 0), { ground: stairs, rough: none }).extraFt).toBe(0);
  });
  it('on straight-line distances a stair costs the diagonal length', () => {
    const ex = walkExtra(grid({ rule: 'euclid' }), at(0, 0), at(1, 0), { ground: stairs, rough: none });
    expect(ex.extraFt).toBeCloseTo(5 * (Math.SQRT2 - 1), 1);
  });
  it('flat ground and big ledges are not stairs', () => {
    expect(walkExtra(grid(), at(0, 0), at(4, 0), { ground: () => 0, rough: none })).toMatchObject({ extraFt: 0, rough: 0, stairs: 0 });
    const ledge = flat({ 1: 10 });
    expect(walkExtra(grid(), at(0, 0), at(2, 0), { ground: ledge, rough: none }).stairs).toBe(0);
    expect(STAIR_FT).toBe(5);
  });
  it('going down a stair counts too', () => {
    expect(walkExtra(grid(), at(3, 0), at(0, 0), { ground: flat({ 0: 0, 1: 5, 2: 10, 3: 15 }), rough: none }).stairs).toBe(3);
  });
  it('distinguishes a staircase from two separate cliff drops on the same route', () => {
    const ex = walkExtra(grid(), at(0, 0), at(3, 0), { ground: flat({ 0: 25, 1: 30, 2: 15 }), rough: none });
    expect(ex.ledges).toEqual([-15, -15]);
    expect(walkNote(grid(), ex)).toBe('drops 15 ft (1d6 if it falls), drops 15 ft (1d6 if it falls), 5 ft of stairs');
  });
});

describe('difficult ground', () => {
  const rough = (p: { x: number; y: number }) => p.x > 100 && p.x < 400; // columns 1 to 3
  it('costs one extra square for each square of it entered', () => {
    const ex = walkExtra(grid(), at(0, 0), at(5, 0), { ground: () => 0, rough });
    expect(ex.rough).toBe(3);
    expect(ex.extraFt).toBe(15);
  });
  it('is nothing when the move stays outside it', () => {
    expect(walkExtra(grid(), at(4, 1), at(8, 1), { ground: () => 0, rough }).extraFt).toBe(0);
  });
  it('says what it added', () => {
    const flatWalk = walkExtra(grid(), at(0, 0), at(4, 0), { ground: () => 0, rough });
    expect(walkNote(grid(), flatWalk)).toBe('difficult ground +15 ft');
    expect(walkNote(grid(), { ...flatWalk, stairRise: 5 })).toBe('5 ft of stairs, difficult ground +15 ft');
    expect(walkNote(grid(), { ...flatWalk, rough: 0 })).toBe('');
  });
});

describe('cliffs', () => {
  const area = { x: 0, y: 0, w: 600, h: 300 };
  it('a drop of more than 10 ft makes a wall piece on every square edge along it', () => {
    const segs = cliffSegs(grid(), area, flat({ 3: 20, 4: 20, 5: 20 }), 10);
    // the plateau is columns 3-5 over the three rows: its west side (3 rows) and its east edge at x = 600 is outside the painted area but still a drop
    expect(segs.length).toBeGreaterThanOrEqual(3);
    for (const s of segs) expect(s.top).toBe(20);
  });
  it('is nothing for 10 ft or less, or when cliffs are off', () => {
    expect(cliffSegs(grid(), area, flat({ 3: 10 }), 10)).toEqual([]);
    expect(cliffSegs(grid(), area, flat({ 3: 40 }), 0)).toEqual([]);
    expect(cliffSegs(grid(), null, flat({ 3: 40 }), 10)).toEqual([]);
  });
  it('stops what is below the top of it, from the low side only', () => {
    const segs = cliffSegs(grid(), { x: 0, y: 0, w: 600, h: 100 }, flat({ 3: 20, 4: 20, 5: 20 }), 10);
    const west = segs.filter((s) => Math.abs(s.a.x - 300) < 1 && Math.abs(s.b.x - 300) < 1 && Math.min(s.a.y, s.b.y) === 0);
    expect(west).toHaveLength(1);
    const lowSide = at(2, 0), highSide = at(3, 0);
    // somebody standing on the low ground is stopped; somebody on the high ground walks (and sees) past
    expect(segsFrom(west, lowSide, 0)).toHaveLength(1);
    expect(segsFrom(west, highSide, 20)).toHaveLength(0);
    // a flyer high above the top gets over it too
    expect(segsFrom(west, lowSide, 30)).toHaveLength(0);
    expect(sideOf(west[0], lowSide)).toBe(west[0].one);
  });
  it('works on hexes', () => {
    const g = grid({ shape: 'pointy' });
    const segs = cliffSegs(g, { x: 0, y: 0, w: 500, h: 500 }, (p) => (p.x > 250 ? 30 : 0), 10);
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) { expect(s.one === 1 || s.one === -1).toBe(true); expect(s.top).toBe(30); }
  });
});

describe('ramps', () => {
  it('steps up in 5 ft stages along the line, one list of squares per height', () => {
    const r = rampCells(grid(), at(0, 2), at(4, 2), 0, 20, 1);
    expect(r.map((x) => x.h)).toEqual([0, 5, 10, 15, 20]);
    expect(r.every((x) => x.cells.length === 1)).toBe(true);
    expect(r[0].cells[0]).toEqual(at(0, 2));
    expect(r[4].cells[0]).toEqual(at(4, 2));
  });
  it('can go down, and be wider', () => {
    const r = rampCells(grid(), at(0, 2), at(4, 2), 20, 0, 3);
    expect(r[0].h).toBe(0);
    expect(r[r.length - 1].h).toBe(20);
    expect(r.every((x) => x.cells.length === 3)).toBe(true);
  });
  it('a tiny drag makes nothing', () => {
    expect(rampCells(grid(), at(0, 0), { x: 60, y: 50 }, 0, 20, 1)).toEqual([]);
  });
  it('a ramp from a corner is an even number of squares wide', () => {
    const r = rampCells(grid(), { x: 0, y: 200 }, { x: 400, y: 200 }, 0, 10, 2);
    expect(r.every((x) => x.cells.length === 4 || x.cells.length === 2 || x.cells.length === 6)).toBe(true);
    expect(r.flatMap((x) => x.cells).every((c) => Math.abs(c.y - 200) === 50)).toBe(true);
  });
});

describe('difficult ground is a layer of its own', () => {
  const drawing = (over: Partial<Drawing>): Drawing => ({
    id: Math.random().toString(36).slice(2), uid: 'u', k: 'terrain', p: '150,150', color: '#c80', w: 100, fill: 0, fc: '', dash: false, txt: '', fs: 28, font: '', b: false, i: false, u: false, ho: false, bw: 5, of: 0, hz: 1, hg: 'dt', hc: true, dt: true, t: 1, ...over,
  } as Drawing);
  const g = grid();
  it('does not change how high the ground is', () => {
    const d = [drawing({}), drawing({ id: 'h', hz: 20, hg: 'hill', dt: undefined, p: '350,150' })];
    expect(groundAt(zonesOf(d, g), at(1, 1))).toBe(0);
    expect(groundAt(zonesOf(d, g), at(3, 1))).toBe(20);
  });
  it('is found where it was painted', () => {
    const d = [drawing({})];
    const r = roughOf(d, g);
    expect(isRough(r, at(1, 1))).toBe(true);
    expect(isRough(r, at(2, 1))).toBe(false);
  });
  it('rubbing out takes it away', () => {
    const d = [drawing({ id: 'a', t: 1 }), drawing({ id: 'b', he: true, hz: null, t: 2 })];
    expect(isRough(roughOf(d, g), at(1, 1))).toBe(false);
  });
  it('nothing painted is not rough', () => {
    expect(isRough(roughOf([], g), at(0, 0))).toBe(false);
  });
});
