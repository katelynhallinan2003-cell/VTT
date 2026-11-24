import { describe, expect, it } from 'vitest';
import { cutLine, extraRect, gridAtPoint, hasOwnGrid, mapCell, ownGrid, ownGrids, squareLines } from '../src/core/mapgrids';
import { DEFAULT_GRID, mapsToWire, normalizeMaps } from '../src/core/model';
import type { ExtraMap } from '../src/types';

const base = { ...DEFAULT_GRID, cell: 70, ox: 10, oy: 20, color: '#ffffff', visible: true };
const map = (over: Partial<ExtraMap> = {}): ExtraMap => ({ id: 'a', url: 'blank:', w: 350, h: 210, x: 700, y: 140, scale: 1, name: '', show: true, locked: true, ...over });

describe('a grid of its own on an added map', () => {
  it('a map with nothing set just shows the scene grid', () => {
    expect(hasOwnGrid(map())).toBe(false);
    expect(ownGrid(base, map())).toBeNull();
    expect(ownGrids(base, [map()])).toEqual([]);
    expect(mapCell(base, map())).toBe(70);
  });

  it('square size, colour or the switch each give it a grid of its own, starting at its top left corner', () => {
    const g = ownGrid(base, map({ gs: 35 }))!;
    expect(g).toMatchObject({ cell: 35, ox: 700, oy: 140, color: '#ffffff', visible: true, ft: 5, shape: 'square' });
    expect(ownGrid(base, map({ gc: '#ff0000' }))!).toMatchObject({ cell: 70, color: '#ff0000' });
    expect(ownGrid(base, map({ gv: false }))!.visible).toBe(false);
  });

  it('the switch can turn a grid on where the scene has none, and off where it has one', () => {
    expect(ownGrid({ ...base, visible: false }, map({ gv: true }))!.visible).toBe(true);
    expect(ownGrid({ ...base, visible: false }, map({ gc: '#00ff00' }))!.visible).toBe(false);
    expect(ownGrid(base, map({ gv: false }))!.visible).toBe(false);
  });

  it('a tiny or missing square size falls back to the scene', () => {
    expect(mapCell(base, map({ gs: 2 }))).toBe(70);
    expect(mapCell(base, map({ gs: 24 }))).toBe(24);
  });

  it('the grid that counts at a spot is the one of the map lying there, the topmost first', () => {
    const maps = [map({ id: 'a', gs: 35 }), map({ id: 'b', gs: 50, x: 800, y: 140 })];
    const own = ownGrids(base, maps);
    expect(own.map((o) => o.id)).toEqual(['a', 'b']);
    expect(gridAtPoint(base, own, { x: 50, y: 50 })).toBe(base);
    expect(gridAtPoint(base, own, { x: 710, y: 150 }).cell).toBe(35);
    expect(gridAtPoint(base, own, { x: 850, y: 150 }).cell).toBe(50);
    expect(gridAtPoint(base, [], { x: 850, y: 150 })).toBe(base);
  });

  it('a map is as big as its size times its scale', () => {
    expect(extraRect(map({ scale: 2 }))).toEqual({ x: 700, y: 140, w: 700, h: 420 });
  });

  it('cutLine takes holes out of a line', () => {
    expect(cutLine(0, 100, [])).toEqual([[0, 100]]);
    expect(cutLine(0, 100, [[20, 40]])).toEqual([[0, 20], [40, 100]]);
    expect(cutLine(0, 100, [[-10, 30], [60, 70]])).toEqual([[30, 60], [70, 100]]);
    expect(cutLine(0, 100, [[0, 100]])).toEqual([]);
    expect(cutLine(0, 100, [[200, 300]])).toEqual([[0, 100]]);
  });
});

describe('saving a map grid', () => {
  it('goes out and comes back, and is left out when it is not set', () => {
    const plain = mapsToWire([map()])!.a as Record<string, unknown>;
    expect('gs' in plain || 'gv' in plain || 'gc' in plain || 'gp' in plain).toBe(false);
    const set = map({ gs: 35.5, gv: true, gc: '#ff0000', gp: '#101010' });
    const wire = mapsToWire([set])!;
    expect(normalizeMaps(wire)[0]).toMatchObject({ gs: 35.5, gv: true, gc: '#ff0000', gp: '#101010' });
    expect(normalizeMaps(mapsToWire([map({ gv: false })]))[0].gv).toBe(false);
  });

  it('rubbish is dropped', () => {
    const [m] = normalizeMaps({ a: { u: 'blank:', w: 70, h: 70, x: 0, y: 0, s: 1, gs: 'big', gv: 'yes', gc: 'red', gp: 7 } });
    expect(m.gs).toBeUndefined();
    expect(m.gv).toBeUndefined();
    expect(m.gc).toBeUndefined();
    expect(m.gp).toBeUndefined();
    expect(normalizeMaps({ a: { u: 'blank:', w: 70, h: 70, gs: 1 } })[0].gs).toBeUndefined();
  });
});

describe('drawing the scene grid round a map that has its own', () => {
  const grid = { cell: 10, ox: 0, oy: 0 };
  const area = { x: 0, y: 0, w: 100, h: 50 };

  it('draws every line when nothing has a grid of its own', () => {
    const l = squareLines(grid, area, []);
    expect(l.v.length).toBe(11);
    expect(l.h.length).toBe(6);
    expect(l.v.every(([, a, b]) => a === 0 && b === 50)).toBe(true);
  });

  it('leaves the patch empty, and keeps the lines that run along its edge', () => {
    const l = squareLines(grid, area, [{ x: 30, y: 10, w: 40, h: 20 }]);
    // the lines at x = 40, 50, 60 go through the patch, in two pieces
    expect(l.v.filter(([x]) => x === 50)).toEqual([[50, 0, 10], [50, 30, 50]]);
    // the lines at its own edge (x = 30, 70) are the scene's to draw: the patch's grid draws its own there
    expect(l.v.filter(([x]) => x === 30)).toEqual([[30, 0, 50]]);
    expect(l.h.filter(([y]) => y === 20)).toEqual([[20, 0, 30], [20, 70, 100]]);
    expect(l.h.filter(([y]) => y === 10)).toEqual([[10, 0, 100]]);
  });

  it('a patch with squares of its own starts its first line on its corner', () => {
    const own = ownGrid({ ...DEFAULT_GRID, cell: 10, ox: 0, oy: 0 }, map({ gs: 25, x: 33, y: 7, w: 100, h: 50 }))!;
    const l = squareLines(own, { x: 33, y: 7, w: 100, h: 50 }, []);
    expect(l.v.map(([x]) => x)).toEqual([33, 58, 83, 108, 133]);
    expect(l.h.map(([y]) => y)).toEqual([7, 32, 57]);
  });
});
