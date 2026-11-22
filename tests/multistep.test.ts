import { describe, expect, it } from 'vitest';
import { distanceFt, pathFt } from '../src/core/geometry';
import { MAX_VIA, normalizeLive, viaFromWire, viaToWire } from '../src/core/model';
import type { GridSettings } from '../src/types';

const grid = (over: Partial<GridSettings> = {}): GridSettings => ({
  shape: 'square', cell: 100, ox: 0, oy: 0, visible: true, color: '#000', opacity: 0.3, ft: 5, rule: 'alt', snap: true, ...over,
});
const at = (i: number, j: number) => ({ x: i * 100 + 50, y: j * 100 + 50 });

describe('pathFt: the length of a path in several legs', () => {
  it('one leg is the same as the plain distance', () => {
    for (const rule of ['alt', 'chebyshev', 'euclid'] as const) {
      const g = grid({ rule });
      expect(pathFt(g, [at(0, 0), at(3, 2)])).toBe(distanceFt(g, at(0, 0), at(3, 2)));
    }
  });
  it('straight legs just add up', () => {
    expect(pathFt(grid(), [at(0, 0), at(3, 0), at(3, 4)])).toBe(35);
  });
  it('on the 5-10-5 rule, every second diagonal costs double along the whole path, not once per leg', () => {
    const g = grid({ rule: 'alt' });
    // two single diagonal steps as separate legs cost 5 + 10, exactly what two steps in one go do
    expect(pathFt(g, [at(0, 0), at(1, 1), at(2, 2)])).toBe(15);
    expect(distanceFt(g, at(0, 0), at(2, 2))).toBe(15);
    // adding the legs one by one would have said 5 + 5
    expect(distanceFt(g, at(0, 0), at(1, 1)) + distanceFt(g, at(1, 1), at(2, 2))).toBe(10);
    // three diagonals: 5 + 10 + 5
    expect(pathFt(g, [at(0, 0), at(1, 1), at(2, 2), at(3, 3)])).toBe(20);
  });
  it('a path that goes out and comes back counts both ways', () => {
    expect(pathFt(grid({ rule: 'chebyshev' }), [at(0, 0), at(4, 0), at(0, 0)])).toBe(40);
    expect(pathFt(grid({ rule: 'euclid' }), [at(0, 0), at(3, 4), at(0, 0)])).toBe(50);
  });
  it('a leg that climbs is measured with the climb', () => {
    const g = grid({ rule: 'chebyshev' });
    expect(pathFt(g, [at(0, 0), at(2, 0)], [20])).toBe(distanceFt(g, at(0, 0), at(2, 0), 'chebyshev', 20));
  });
  it('a path of one point or none is nothing', () => {
    expect(pathFt(grid(), [])).toBe(0);
    expect(pathFt(grid(), [at(1, 1)])).toBe(0);
  });
});

describe('the corners of a measurement or a move travel to the others as text', () => {
  it('round-trips', () => {
    const s = viaToWire([{ x: 1.04, y: 2 }, { x: 300, y: 4.5 }]);
    expect(s).toBe('1,2;300,4.5');
    expect(viaFromWire(s)).toEqual([{ x: 1, y: 2 }, { x: 300, y: 4.5 }]);
  });
  it('nothing is nothing, and rubbish is left out', () => {
    expect(viaToWire([])).toBeUndefined();
    expect(viaToWire(undefined)).toBeUndefined();
    expect(viaFromWire(undefined)).toEqual([]);
    expect(viaFromWire('1,2;nope;3,x;5,6')).toEqual([{ x: 1, y: 2 }, { x: 5, y: 6 }]);
  });
  it('is capped so nobody can send a huge path', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i }));
    expect(viaFromWire(viaToWire(many))).toHaveLength(MAX_VIA);
  });
  it('a live ruler and a ghost keep their corners', () => {
    const live = normalizeLive('u', { ruler: { ax: 0, ay: 0, bx: 9, by: 9, w: '3,3;6,6' }, ghosts: { t1: { x: 5, y: 6, w: '1,1' }, t2: { x: 7, y: 8 } } })!;
    expect(live.ruler!.via).toEqual([{ x: 3, y: 3 }, { x: 6, y: 6 }]);
    expect(live.ghosts.t1).toEqual({ x: 5, y: 6, via: [{ x: 1, y: 1 }] });
    expect(live.ghosts.t2).toEqual({ x: 7, y: 8 });
  });
});
