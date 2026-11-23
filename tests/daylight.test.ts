import { describe, expect, it } from 'vitest';
import { dayOf, isDay, isRough, roughOf, zonesOf } from '../src/core/height';
import { DEFAULT_GRID, drawingToWire, normalizeDrawing } from '../src/core/model';
import { groundAtTerrain } from '../src/core/terrain';
import type { Drawing } from '../src/types';

const grid = { ...DEFAULT_GRID, cell: 100, ft: 5, ox: 0, oy: 0 };
let clock = 0;
const layer = (id: string, flag: 'dl' | 'dt' | null, centres: [number, number][], o: { he?: boolean; hg?: string } = {}): Drawing =>
  normalizeDrawing(id, { uid: 'dm', k: 'terrain', p: centres.map((c) => c.join(',')).join(','), w: 100, t: ++clock, hz: o.he ? null : 1, hg: o.hg ?? (flag ?? 'g'), he: o.he, hc: true, ...(flag ? { [flag]: true } : {}) })!;
const height = (id: string, centres: [number, number][]) => layer(id, null, centres);

describe('daylight is a ground layer of its own', () => {
  it('survives the round trip to the database and back', () => {
    const d = layer('a', 'dl', [[50, 50]]);
    expect(d.dl).toBe(true);
    const wire = drawingToWire(d) as Record<string, unknown>;
    expect(wire.dl).toBe(true);
    expect(normalizeDrawing('a', wire)?.dl).toBe(true);
    // an ordinary stroke carries no flag at all
    expect('dl' in (normalizeDrawing('b', { uid: 'dm', k: 'terrain', p: '50,50', w: 100, t: 1, hz: 5, hg: 'g', hc: true }) ?? {})).toBe(false);
    expect(drawingToWire(height('c', [[50, 50]])).dl).toBeUndefined();
  });

  it('lights the squares that were painted and nothing else', () => {
    const day = dayOf([layer('a', 'dl', [[50, 50], [150, 50]])], grid);
    expect(isDay(day, { x: 60, y: 70 })).toBe(true);
    expect(isDay(day, { x: 140, y: 30 })).toBe(true);
    expect(isDay(day, { x: 250, y: 50 })).toBe(false);
    expect(isDay(dayOf([], grid), { x: 60, y: 70 })).toBe(false);
  });

  it('never changes how high the ground is, nor makes it difficult', () => {
    const draws = [layer('a', 'dl', [[50, 50]]), height('h', [[250, 50]])];
    const zones = zonesOf(draws, grid);
    expect(groundAtTerrain(zones, { x: 50, y: 50 })).toBe(0);
    expect(groundAtTerrain(zones, { x: 250, y: 50 })).toBe(1);
    expect(isRough(roughOf(draws, grid), { x: 50, y: 50 })).toBe(false);
    expect(isDay(dayOf(draws, grid), { x: 250, y: 50 })).toBe(false);
  });

  it('keeps difficult ground and daylight apart', () => {
    const draws = [layer('r', 'dt', [[50, 50]]), layer('d', 'dl', [[150, 50]])];
    expect(isRough(roughOf(draws, grid), { x: 50, y: 50 })).toBe(true);
    expect(isRough(roughOf(draws, grid), { x: 150, y: 50 })).toBe(false);
    expect(isDay(dayOf(draws, grid), { x: 150, y: 50 })).toBe(true);
    expect(isDay(dayOf(draws, grid), { x: 50, y: 50 })).toBe(false);
  });

  it('an erase stroke takes daylight away again, in the order things were painted', () => {
    const draws = [
      layer('a', 'dl', [[50, 50], [150, 50], [250, 50]], { hg: 'dl' }),
      layer('e', 'dl', [[150, 50]], { hg: 'dl', he: true }),
    ];
    const day = dayOf(draws, grid);
    expect(isDay(day, { x: 50, y: 50 })).toBe(true);
    expect(isDay(day, { x: 150, y: 50 })).toBe(false);
    expect(isDay(day, { x: 250, y: 50 })).toBe(true);
    // painting it again after the erase brings it back
    const again = dayOf([...draws, layer('b', 'dl', [[150, 50]], { hg: 'dl' })], grid);
    expect(isDay(again, { x: 150, y: 50 })).toBe(true);
  });

  it('a signature changes when daylight does, so the lighting is painted again', () => {
    const a = dayOf([layer('a', 'dl', [[50, 50]])], grid).sig;
    const b = dayOf([layer('a', 'dl', [[50, 50]]), layer('b', 'dl', [[150, 50]])], grid).sig;
    expect(a).not.toBe(b);
  });
});
