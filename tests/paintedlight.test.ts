import { describe, expect, it } from 'vitest';
import { dayOf, dimOf, isDay } from '../src/core/height';
import { DEFAULT_GRID, drawingToWire, normalizeDrawing, normalizeSceneMeta } from '../src/core/model';
import { distanceSquared, EDGE_LIFT, liftField, maxInto } from '../src/core/paintedlight';
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
  it('normalizes the scene setting into 0 to 60 feet, 10 by default', () => {
    expect(normalizeSceneMeta({}).light.edge).toBe(10);
    expect(normalizeSceneMeta({ light: { ambient: 'dark', edge: 25 } }).light.edge).toBe(25);
    expect(normalizeSceneMeta({ light: { ambient: 'dark', edge: 500 } }).light.edge).toBe(60);
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

  it('is full inside, half at the painted edge, and fades to nothing at the end of the soft edge', () => {
    const f = liftField(bar(), w, h, 10, 1, true);
    const row = 2 * w;
    expect(f[row + 3]).toBe(1);
    expect(f[row + 10]).toBeCloseTo(EDGE_LIFT * (1 - 1 / 10), 5); // one pixel past the paint
    expect(f[row + 14]).toBeCloseTo(EDGE_LIFT * 0.5, 5); // five pixels out of ten
    expect(f[row + 19]).toBeCloseTo(0, 5);
    expect(f[row + 30]).toBe(0);
    // it only ever falls away as you go out: no steps, no ridges
    for (let x = 10; x < w - 1; x++) expect(f[row + x + 1]).toBeLessThanOrEqual(f[row + x] + 1e-6);
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
