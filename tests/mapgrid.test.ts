import { describe, expect, it } from 'vitest';
import { AUTO_GRID_STRENGTH, gridMatches, impliedGrid } from '../src/core/mapgrid';
import type { GridCut } from '../src/core/gridcut';

const sq: GridCut = { on: true, p: 70, x: 23, y: 41, t: 2 };

describe('the grid a printed grid implies', () => {
  it('squares: the same size scaled to the board, starting where the lines do', () => {
    const g = impliedGrid(sq, 1, 0, 0);
    expect(g).toEqual({ shape: 'square', cell: 70, ox: 23.5, oy: 41.5 });
    // a map shown at half size, moved over by 10
    const h = impliedGrid(sq, 0.5, 10, 20);
    expect(h.cell).toBe(35);
    expect(h.ox).toBeCloseTo((10 + 23.5 * 0.5) % 35, 1);
    expect(h.oy).toBeCloseTo((20 + 41.5 * 0.5) % 35, 1);
  });
  it('hexes: the shape comes along', () => {
    const g = impliedGrid({ on: true, p: 90, x: 33, y: 21, t: 2, hex: 'flat' }, 1, 0, 0);
    expect(g.shape).toBe('flat');
    expect(g.cell).toBe(90);
  });
  it('knows when the grid is already on the lines', () => {
    const g = impliedGrid(sq, 1, 0, 0);
    expect(gridMatches({ shape: 'square', cell: 70, ox: 23.5, oy: 41.5 }, g)).toBe(true);
    // one whole square along is the same grid
    expect(gridMatches({ shape: 'square', cell: 70, ox: 93.5, oy: 41.5 - 70 }, g)).toBe(true);
    expect(gridMatches({ shape: 'square', cell: 70, ox: 30, oy: 41.5 }, g)).toBe(false);
    expect(gridMatches({ shape: 'square', cell: 33, ox: 23.5, oy: 41.5 }, g)).toBe(false);
    expect(gridMatches({ shape: 'pointy', cell: 70, ox: 23.5, oy: 41.5 }, g)).toBe(false);
  });
  it('is only automatic for lines that are clearly there', () => {
    expect(AUTO_GRID_STRENGTH).toBeGreaterThan(3); // more than the least a button press accepts
  });
});
