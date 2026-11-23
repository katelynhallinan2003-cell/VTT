import { describe, expect, it } from 'vitest';
import { cellCentersIn, cellsCovered, colorRegion, colorsRegion } from '../src/core/colorcells';
import type { GridSettings } from '../src/types';
import type { PixelImage } from '../src/core/gridcut';

const grid = (o: Partial<GridSettings> = {}): GridSettings => ({ shape: 'square', cell: 50, ox: 0, oy: 0, ft: 5, visible: true, snap: true, ...o } as GridSettings);

/** a 400 by 300 picture: stone, with a blue pool at (100..200, 100..200) and another at (300..400, 50..150) */
function pools(): PixelImage {
  const W = 400, H = 300;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    const pool = (x >= 100 && x < 200 && y >= 100 && y < 200) || (x >= 300 && x < 400 && y >= 50 && y < 150);
    data[p] = pool ? 40 : 150; data[p + 1] = pool ? 90 : 145; data[p + 2] = pool ? 200 : 135; data[p + 3] = 255;
  }
  return { data, width: W, height: H };
}
const ident = (p: { x: number; y: number }) => p;

describe('colour regions', () => {
  it('marks every pixel near the colour, or only the patch you clicked', () => {
    const img = pools();
    const all = colorRegion(img, [40, 90, 200], 20);
    const one = colorRegion(img, [40, 90, 200], 20, { x: 150, y: 150 });
    const n = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
    expect(n(all)).toBe(2 * 100 * 100);
    expect(n(one)).toBe(100 * 100);
    expect(one[150 * 400 + 150]).toBe(1);
    expect(one[100 * 400 + 350]).toBe(0);
  });
  it('a click on nothing matching selects nothing', () => {
    expect(colorRegion(pools(), [40, 90, 200], 20, { x: 20, y: 250 }).some((v) => v)).toBe(false);
  });
});

describe('several colours at one height', () => {
  /** the pools picture with a green ledge (x 0..100, y 0..100) added */
  function withLedge(): PixelImage {
    const img = pools();
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) { const p = (y * 400 + x) * 4; img.data[p] = 60; img.data[p + 1] = 170; img.data[p + 2] = 70; }
    return img;
  }
  const n = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
  it('adds the areas of every picked colour together', () => {
    const img = withLedge();
    const blue = { color: [40, 90, 200] as [number, number, number], spot: { x: 150, y: 150 } };
    const green = { color: [60, 170, 70] as [number, number, number], spot: { x: 50, y: 50 } };
    expect(n(colorsRegion(img, [blue], 20, true))).toBe(100 * 100);
    expect(n(colorsRegion(img, [blue, green], 20, true))).toBe(100 * 100 + 100 * 100);
    // with "only the patch I clicked" off, each colour is taken wherever it is
    expect(n(colorsRegion(img, [blue, green], 20, false))).toBe(2 * 100 * 100 + 100 * 100);
  });
  it('a colour picked twice is not counted twice, and no colours is nothing', () => {
    const img = withLedge();
    const blue = { color: [40, 90, 200] as [number, number, number], spot: { x: 150, y: 150 } };
    expect(n(colorsRegion(img, [blue, blue], 20, true))).toBe(100 * 100);
    expect(n(colorsRegion(img, [], 20, true))).toBe(0);
  });
  it('a colour with no click spot is taken wherever it is, even when only patches are asked for', () => {
    const img = withLedge();
    expect(n(colorsRegion(img, [{ color: [40, 90, 200], spot: null }], 20, true))).toBe(2 * 100 * 100);
  });
});

describe('cells that are that colour', () => {
  it('lists the squares that are mostly covered', () => {
    const img = pools();
    const g = grid();
    const centers = cellCentersIn(g, { x: 0, y: 0, w: 400, h: 300 });
    expect(centers.length).toBe(8 * 6);
    const got = cellsCovered(colorRegion(img, [40, 90, 200], 20), 400, 300, centers, g.cell, ident, 0.5);
    expect(got.length).toBe(8); // two pools of two by two squares
    expect(got.every((c) => (c.x > 100 && c.x < 200 && c.y > 100 && c.y < 200) || (c.x > 300 && c.y > 50 && c.y < 150))).toBe(true);
  });
  it('a cell half in the pool counts at 50% and not at 90%', () => {
    const img = pools();
    const g = grid({ ox: 25, oy: 25 }); // cells straddle the pool edges
    const centers = cellCentersIn(g, { x: 0, y: 0, w: 400, h: 300 });
    const mask = colorRegion(img, [40, 90, 200], 20, { x: 150, y: 150 });
    expect(cellsCovered(mask, 400, 300, centers, g.cell, ident, 0.9).length).toBe(1); // the one cell wholly inside
    expect(cellsCovered(mask, 400, 300, centers, g.cell, ident, 0.3).length).toBeGreaterThan(4);
  });
  it('works on hexes', () => {
    const g = grid({ shape: 'pointy', cell: 40 });
    const centers = cellCentersIn(g, { x: 0, y: 0, w: 400, h: 300 });
    expect(centers.length).toBeGreaterThan(50);
    const got = cellsCovered(colorRegion(pools(), [40, 90, 200], 20), 400, 300, centers, g.cell, ident, 0.5);
    expect(got.length).toBeGreaterThan(6);
    expect(got.length).toBeLessThan(20);
  });
});
