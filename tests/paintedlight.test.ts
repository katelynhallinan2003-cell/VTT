import { describe, expect, it } from 'vitest';
import { dayOf, dimOf, isDay } from '../src/core/height';
import { DEFAULT_GRID, drawingToWire, normalizeDrawing, normalizeSceneMeta } from '../src/core/model';
import { distanceSquared, fadeAt, liftField, maxInto, SIGHT_SHARE, walkDistance } from '../src/core/paintedlight';
import type { Drawing } from '../src/types';

const grid = { ...DEFAULT_GRID, cell: 100, ft: 5, ox: 0, oy: 0 };
let clock = 0;
const stroke = (id: string, o: { dim?: boolean; he?: boolean; pts?: string; w?: number }): Drawing =>
  normalizeDrawing(id, { uid: 'dm', k: 'terrain', p: o.pts ?? '50,50', w: o.w ?? 100, t: ++clock, hz: o.he ? null : 1, hg: o.he ? '' : o.dim ? 'dd' : 'dl', he: o.he, hc: false, dl: true, ...(o.dim ? { dd: true } : {}) })!;

describe('daylight and dim light are separate layers', () => {
  it('dim light is kept apart from daylight', () => {
    const draws = [stroke('a', {}), stroke('b', { dim: true, pts: '450,50' })];
    expect(dayOf(draws, grid).areas).toHaveLength(1);
    expect(dimOf(draws, grid).areas).toHaveLength(1);
    expect(isDay(dayOf(draws, grid), { x: 50, y: 50 })).toBe(true);
    expect(isDay(dayOf(draws, grid), { x: 450, y: 50 })).toBe(false);
    expect(isDay(dimOf(draws, grid), { x: 450, y: 50 })).toBe(true);
  });

  it('dim light survives the round trip, and only with painted light', () => {
    const d = stroke('a', { dim: true });
    expect(d.dd).toBe(true);
    const wire = drawingToWire(d) as Record<string, unknown>;
    expect(wire.dd).toBe(true);
    expect(normalizeDrawing('a', wire)?.dd).toBe(true);
    // a stray dd on an ordinary stroke is dropped
    const odd = normalizeDrawing('b', { uid: 'dm', k: 'terrain', p: '50,50', w: 100, t: 1, hz: 5, hg: 'g', hc: true, dd: true });
    expect(odd?.dd).toBeUndefined();
  });

  it('an eraser for each layer takes its light away', () => {
    const draws = [stroke('a', {}), stroke('b', { dim: true }), stroke('x', { he: true }), ...[stroke('y', { he: true })]];
    // the plain eraser only reaches the daylight layer; the dim layer needs its own
    expect(isDay(dayOf(draws, grid), { x: 50, y: 50 })).toBe(false);
    expect(isDay(dimOf(draws, grid), { x: 50, y: 50 })).toBe(true);
    const both = [...draws, normalizeDrawing('z', { uid: 'dm', k: 'terrain', p: '50,50', w: 100, t: ++clock, hz: null, hg: '', he: true, hc: false, dl: true, dd: true })!];
    expect(isDay(dimOf(both, grid), { x: 50, y: 50 })).toBe(false);
  });
});

describe('the soft edge of painted light', () => {
  it('normalizes the scene setting into 0 to 100 feet, 20 by default', () => {
    expect(normalizeSceneMeta({}).light.edge).toBe(20);
    expect(normalizeSceneMeta({ light: { ambient: 'dark', edge: 25 } }).light.edge).toBe(25);
    expect(normalizeSceneMeta({ light: { ambient: 'dark', edge: 500 } }).light.edge).toBe(100);
    expect(normalizeSceneMeta({ light: { ambient: 'dark', edge: -4 } }).light.edge).toBe(0);
  });

  it('measures the exact distance to the nearest painted pixel', () => {
    const w = 9, h = 9;
    const on = new Uint8Array(w * h);
    on[4 * w + 4] = 1;
    const d = distanceSquared(on, w, h);
    expect(d[4 * w + 4]).toBe(0);
    expect(d[4 * w + 7]).toBe(9);
    expect(d[1 * w + 1]).toBe(18); // 3 across and 3 up
    expect(d[0]).toBe(32);
  });

  const w = 40, h = 5;
  const bar = (): Float32Array => { const c = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < 10; x++) c[y * w + x] = 1; return c; };

  it('is full inside, just as strong at the painted edge, and eases away to nothing at the end of the soft edge', () => {
    const f = liftField(bar(), w, h, 10, 1, true);
    const row = 2 * w;
    expect(f[row + 3]).toBe(1);
    // no step where the paint ends: one pixel past it is almost as strong as the paint
    expect(f[row + 9] - f[row + 10]).toBeLessThan(0.05);
    expect(f[row + 10]).toBeCloseTo(fadeAt(1 / 10), 5);
    expect(f[row + 14]).toBeCloseTo(0.5, 5); // half way out, half the light
    expect(f[row + 18]).toBeCloseTo(fadeAt(9 / 10), 5);
    expect(f[row + 19]).toBe(0);
    expect(f[row + 20]).toBe(0);
    expect(f[row + 30]).toBe(0);
    // it only ever falls away as you go out, with no step anywhere
    let worst = 0;
    for (let x = 0; x < w - 1; x++) { expect(f[row + x + 1]).toBeLessThanOrEqual(f[row + x] + 1e-6); worst = Math.max(worst, f[row + x] - f[row + x + 1]); }
    expect(worst).toBeLessThan(0.16);
  });

  it('the fade is a smooth curve: gentle at both ends', () => {
    expect(fadeAt(0)).toBe(1);
    expect(fadeAt(1)).toBe(0);
    expect(fadeAt(0.5)).toBeCloseTo(0.5, 6);
    expect(fadeAt(0.05)).toBeGreaterThan(0.99);
    expect(fadeAt(0.95)).toBeLessThan(0.01);
  });

  it('a hard edge (0 ft) lights only what was painted', () => {
    const f = liftField(bar(), w, h, 0, 1, true);
    expect(f[2 * w + 9]).toBe(1);
    expect(f[2 * w + 10]).toBe(0);
  });

  it('dim light lifts half as much as daylight inside', () => {
    expect(liftField(bar(), w, h, 10, 0.5, true)[2 * w + 3]).toBe(0.5);
  });

  it('sight sees the whole lit shape without a gradient', () => {
    const f = liftField(bar(), w, h, 10, 1, false);
    expect(f[2 * w + 3]).toBe(1);
    expect(f[2 * w + 12]).toBe(1);
    expect(f[2 * w + 25]).toBe(0);
    // ground that looks nearly dark is not counted as lit
    expect(fadeAt(0.9)).toBeLessThan(SIGHT_SHARE);
    expect(f[2 * w + 19]).toBe(0);
  });

  it('works on nothing painted', () => {
    const f = liftField(new Float32Array(w * h), w, h, 10, 1, true);
    expect(Math.max(...f)).toBe(0);
  });

  it('the brighter lift wins where two overlap', () => {
    const a = Float32Array.from([0.2, 1, 0]);
    maxInto(a, Float32Array.from([0.5, 0.5, 0.1]));
    expect([...a]).toEqual([0.5, 1, expect.closeTo(0.1, 5)]);
  });
});

describe('walls stop the soft edge of painted light', () => {
  const w = 40, h = 21;
  // paint on the left; a wall two pixels thick runs down column 14 and 15 with a gap at the bottom (rows 17 to 20)
  const paint = (): Float32Array => { const c = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < 6; x++) c[y * w + x] = 1; return c; };
  const wall = (gapFrom = 17): Uint8Array => { const b = new Uint8Array(w * h); for (let y = 0; y < gapFrom; y++) { b[y * w + 14] = 1; b[y * w + 15] = 1; } return b; };

  it('measures a straight run as the plain distance, and walks round a wall', () => {
    const on = new Uint8Array(w * h);
    on[10 * w + 2] = 1;
    const none = walkDistance(on, new Uint8Array(w * h), w, h, 100);
    expect(none[10 * w + 12]).toBeCloseTo(10, 4);
    expect(none[10 * w + 2]).toBe(0);
    // within a couple of per cent of the straight line the other way too
    expect(none[3 * w + 9]).toBeGreaterThan(Math.hypot(7, 7) * 0.98);
    expect(none[3 * w + 9]).toBeLessThan(Math.hypot(7, 7) * 1.03);
    const near = walkDistance(on, wall(), w, h, 100);
    // behind the wall the way is round the gap at the bottom
    expect(near[10 * w + 18]).toBeGreaterThan(Math.hypot(16, 7) * 0.98);
    expect(near[10 * w + 18]).toBeGreaterThan(none[10 * w + 18] + 4);
  });

  it('a wall with no way round leaves the far side dark, but the wall itself is lit from the near side', () => {
    const f = liftField(paint(), w, h, 20, 1, true, wall(h));
    const row = 10 * w;
    expect(f[row + 8]).toBeGreaterThan(0.5); // before the wall, lit
    expect(f[row + 14]).toBeGreaterThan(0.05); // the wall itself, no dark seam in the lit ground
    expect(f[row + 16]).toBe(0);
    expect(f[row + 20]).toBe(0);
    // the same fade with no wall would reach there
    const open = liftField(paint(), w, h, 20, 1, true);
    expect(open[row + 16]).toBeGreaterThan(0.05);
  });

  it('light fades round the end of a wall, weaker than it would be through it', () => {
    const f = liftField(paint(), w, h, 20, 1, true, wall());
    const open = liftField(paint(), w, h, 20, 1, true);
    const behind = f[19 * w + 17], through = open[10 * w + 17];
    expect(behind).toBeGreaterThan(0); // round the end of the wall
    expect(f[10 * w + 17]).toBeLessThan(through); // behind the wall it is weaker than straight through it
  });

  it('paint that was put on the far side of a wall is lit there', () => {
    const c = paint();
    for (let y = 8; y < 13; y++) for (let x = 20; x < 24; x++) c[y * w + x] = 1;
    const f = liftField(c, w, h, 10, 1, true, wall(h));
    expect(f[10 * w + 21]).toBe(1);
  });

  it('sight does not count the fade behind a wall as lit', () => {
    const f = liftField(paint(), w, h, 20, 1, false, wall(h));
    expect(f[10 * w + 9]).toBe(1);
    expect(f[10 * w + 17]).toBe(0);
  });

  it('works with no walls and a wall mask with nothing set', () => {
    const a = liftField(paint(), w, h, 12, 1, true, new Uint8Array(w * h));
    const b = liftField(paint(), w, h, 12, 1, true);
    expect([...a]).toEqual([...b]);
  });
});
