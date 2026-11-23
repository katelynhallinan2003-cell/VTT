import { describe, expect, it } from 'vitest';
import { BLANK_MAP, blankSpot, clampSquares, isBlankMap, isBlankPage, paperColour, squaresOf } from '../src/core/blankgrid';
import { DEFAULT_GRID, mapsToWire, normalizeMaps, normalizeSceneMeta } from '../src/core/model';
import { sceneRect } from '../src/core/geometry';

const grid = { ...DEFAULT_GRID, cell: 70, ox: 10, oy: 20 };

describe('an empty grid', () => {
  it('a scene with a size but no picture is a blank page', () => {
    expect(isBlankPage({ mapUrl: null, mapW: 2100, mapH: 1400 })).toBe(true);
    expect(isBlankPage({ mapUrl: null, mapW: 0, mapH: 0 })).toBe(false);
    expect(isBlankPage({ mapUrl: 'https://x/y.png', mapW: 2100, mapH: 1400 })).toBe(false);
  });

  it('counts in squares, never fewer than one or more than 200', () => {
    expect(squaresOf(grid, 2100, 1400)).toEqual({ cols: 30, rows: 20 });
    expect(clampSquares(0)).toBe(1);
    expect(clampSquares(12.4)).toBe(12);
    expect(clampSquares(9999)).toBe(200);
    expect(clampSquares(NaN)).toBe(1);
  });

  it('is part of the room the scene takes up', () => {
    const meta = { mapX: 0, mapY: 0, mapW: 2100, mapH: 1400, mapScale: 1, maps: [] };
    expect(sceneRect(meta)).toEqual({ x: 0, y: 0, w: 2100, h: 1400 });
    const beside = { ...meta, maps: [{ x: 2100, y: 0, w: 700, h: 700, scale: 1 }] };
    expect(sceneRect(beside)).toEqual({ x: 0, y: 0, w: 2800, h: 1400 });
  });

  it('goes beside the map on the grid lines, level with its top', () => {
    const at = blankSpot(grid, { x: 0, y: 25, w: 1005, h: 900 });
    expect((at.x - grid.ox) % grid.cell).toBe(0);
    expect((at.y - grid.oy) % grid.cell).toBe(0);
    expect(at.x).toBeGreaterThanOrEqual(1005);
    expect(at.x).toBeLessThan(1005 + grid.cell);
    expect(Math.abs(at.y - 25)).toBeLessThanOrEqual(grid.cell / 2);
    expect(blankSpot(grid, null)).toEqual({ x: 10, y: 20 });
    // already on a line: no gap
    expect(blankSpot({ ...grid, ox: 0, oy: 0 }, { x: 0, y: 0, w: 700, h: 700 })).toEqual({ x: 700, y: 0 });
  });

  it('paper is picked so the grid lines show on it', () => {
    expect(paperColour('#ffffff')).toBeLessThan(0x808080); // white lines: dark paper
    expect(paperColour('#cfd8e6')).toBeLessThan(0x808080);
    expect(paperColour('#010101')).toBeGreaterThan(0xe0e0e0); // dark lines: light paper
    expect(paperColour('#335577')).toBeGreaterThan(0xe0e0e0);
  });

  it('is stored as an extra map with the blank address, and read back', () => {
    const maps = [{ id: 'a', url: BLANK_MAP, w: 2100, h: 1400, x: 700, y: 0, scale: 1, name: 'Empty grid', show: true, locked: false }];
    const wire = mapsToWire(maps) as Record<string, any>;
    expect(wire.a.u).toBe(BLANK_MAP);
    const back = normalizeMaps(wire);
    expect(back).toHaveLength(1);
    expect(isBlankMap(back[0].url)).toBe(true);
    expect(back[0].w).toBe(2100);
  });

  it('a scene with no map keeps its size and background', () => {
    const m = normalizeSceneMeta({ mapW: 2100, mapH: 1400, bg: '#20242e' });
    expect(m.mapUrl).toBeNull();
    expect(isBlankPage(m)).toBe(true);
    expect(m.bg).toBe('#20242e');
  });
});
