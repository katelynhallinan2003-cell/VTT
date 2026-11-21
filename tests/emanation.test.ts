import { describe, expect, it } from 'vitest';
import { coveredCells } from '../src/core/cells';
import { expandPoly, footprintPoly, footprintPx, pointInPoly, snapTemplate, templateFt, templateGeom, templateLabel, type TemplateSnapState } from '../src/core/draw';
import type { GridSettings } from '../src/types';

const grid = (over: Partial<GridSettings> = {}): GridSettings => ({
  shape: 'square', cell: 100, ox: 0, oy: 0, visible: true, color: '#000', opacity: 0.3, ft: 5, rule: 'chebyshev', snap: true, ...over,
});
/** distance from a point to an axis-aligned square (0 inside) */
const dToSquare = (p: { x: number; y: number }, c: { x: number; y: number }, half: number) => Math.hypot(Math.max(Math.abs(p.x - c.x) - half, 0), Math.max(Math.abs(p.y - c.y) - half, 0));

describe('emanations are measured from the edge of the creature\'s space (2024 rules)', () => {
  it('expanding a square gives a rounded square: every point is exactly the distance from the square', () => {
    const sq = footprintPoly({ x: 0, y: 0 }, 200);
    const out = expandPoly(sq, 150);
    for (const p of out) expect(dToSquare(p, { x: 0, y: 0 }, 100)).toBeCloseTo(150, 6);
    // and it reaches 150 past every side
    expect(Math.max(...out.map((p) => p.x))).toBeCloseTo(250);
    expect(Math.min(...out.map((p) => p.y))).toBeCloseTo(-250);
    expect(pointInPoly({ x: 240, y: 0 }, out)).toBe(true);
    expect(pointInPoly({ x: 260, y: 0 }, out)).toBe(false);
    // corners are round: the corner point 150 along the diagonal is outside
    expect(pointInPoly({ x: 100 + 150, y: 100 + 150 }, out)).toBe(false);
  });

  it('works for a hexagon too', () => {
    const hex = footprintPoly({ x: 0, y: 0 }, 100, 'pointy');
    expect(hex).toHaveLength(6);
    const out = expandPoly(hex, 60);
    // every outline point is 60 from the hexagon's edge: apothem 50 + 60 = 110 at the flat sides
    expect(Math.max(...out.map((p) => p.x))).toBeCloseTo(110, 4);
  });

  it('a Medium creature: 5 ft touches the ring of 8 squares, 10 ft makes 5 by 5 without its corners', () => {
    const g = grid();
    const c = { x: 250, y: 250 };
    expect(coveredCells(g, 'emanation', c, { x: 250 + 150, y: 250 }, 100)).toHaveLength(8);
    // 10 ft = 2 squares past the edge: radius 250 from the middle
    expect(coveredCells(g, 'emanation', c, { x: 250 + 250, y: 250 }, 100)).toHaveLength(20);
  });

  it('a Large creature (two squares across, centred on a corner): 10 ft reaches 2 squares past every side', () => {
    const g = grid();
    const c = { x: 300, y: 300 }; // a corner
    const b = { x: 300 + 100 + 200, y: 300 };
    const cells = coveredCells(g, 'emanation', c, b, 200);
    // the four squares it stands on are left out
    for (const p of cells) expect(Math.abs(p.x - c.x) < 100 && Math.abs(p.y - c.y) < 100).toBe(false);
    // everything counted is within 10 ft (200px) of its edge, and everything within is counted
    const all: { x: number; y: number }[] = [];
    for (let i = -8; i < 12; i++) for (let j = -8; j < 12; j++) {
      const p = { x: (i + 0.5) * 100, y: (j + 0.5) * 100 };
      if (Math.abs(p.x - c.x) < 100 && Math.abs(p.y - c.y) < 100) continue;
      if (dToSquare(p, c, 100) <= 200 + 2) all.push(p);
    }
    expect(cells.length).toBe(all.length);
    // 12 wide in squares along the middle: 2 + 2 + 2
    expect(cells.filter((p) => Math.abs(p.y - 250) < 1).length).toBe(6 - 2);
    // a Medium creature of the same 10 ft covers fewer squares
    expect(coveredCells(g, 'emanation', { x: 250, y: 250 }, { x: 500, y: 250 }, 100).length).toBeLessThan(cells.length);
  });

  it('the drag snaps to whole squares out from the edge, whatever the creature size', () => {
    const g = grid();
    const big = snapTemplate(g, { x: 300, y: 300 }, { x: 300 + 340, y: 300 + 10 }, { origin: true, length: true, kind: 'emanation', widthPx: 200, fixedOrigin: { x: 300, y: 300 } });
    expect(big.a).toEqual({ x: 300, y: 300 });
    expect(Math.hypot(big.b.x - big.a.x, big.b.y - big.a.y)).toBeCloseTo(300); // 100 (half the creature) + 2 squares
    expect(templateFt(g, big.a, big.b, 'emanation', 200)).toBe(10);
    expect(templateLabel('emanation', g, big.a, big.b, 5, 200)).toBe('10 ft emanation');
    // never less than one square past the edge
    const small = snapTemplate(g, { x: 300, y: 300 }, { x: 310, y: 300 }, { origin: true, length: true, kind: 'emanation', widthPx: 200, fixedOrigin: { x: 300, y: 300 } });
    expect(templateFt(g, small.a, small.b, 'emanation', 200)).toBe(5);
  });

  it('the creature width never goes below one square', () => {
    expect(footprintPx(grid(), 0)).toBe(100);
    expect(footprintPx(grid(), 2.5)).toBe(100);
    expect(footprintPx(grid(), 15)).toBe(300);
  });

  it('old emanations (no creature size) still come out the same width as a Medium creature', () => {
    const g = templateGeom('emanation', { x: 250, y: 250 }, { x: 500, y: 250 }, 100);
    expect(g.type).toBe('poly');
    if (g.type === 'poly') expect(Math.max(...g.pts.map((p) => p.x))).toBeCloseTo(500, 4);
  });
});

describe('snapping while the pointer hovers on a boundary does not flicker', () => {
  const g = grid();
  const run = (sticky: boolean, kind: 'sphere' | 'cone' | 'cube' | 'beam') => {
    let st: TemplateSnapState | undefined;
    const seen: string[] = [];
    let flips = 0;
    // the pointer wobbles ±3px around halfway between two sizes, and ±0.02 rad around halfway between two directions
    for (let i = 0; i < 40; i++) {
      const wob = (i % 2 ? 3 : -3);
      const L = 250 + wob; // halfway between 2 and 3 squares
      const ang = 0.5 + (i % 2 ? 0.02 : -0.02);
      const out = snapTemplate(g, { x: 150, y: 150 }, { x: 150 + Math.cos(ang) * L, y: 150 + Math.sin(ang) * L }, { origin: false, length: true, kind, widthPx: 100, prev: sticky ? st : undefined });
      st = out.st;
      const key = `${Math.round(Math.hypot(out.b.x - out.a.x, out.b.y - out.a.y))}`;
      if (seen.length && seen[seen.length - 1] !== key) flips++;
      seen.push(key);
    }
    return flips;
  };
  for (const kind of ['sphere', 'cone', 'cube', 'beam'] as const) {
    it(`${kind}: sticky snapping settles, plain snapping flips back and forth`, () => {
      expect(run(false, kind)).toBeGreaterThan(10);
      expect(run(true, kind)).toBeLessThanOrEqual(1);
    });
  }

  it('a direction near a multiple of 15 degrees is pulled onto it, and stays until the pointer clearly leaves', () => {
    let st: TemplateSnapState | undefined;
    const angles: number[] = [];
    for (const da of [0.03, -0.02, 0.04, -0.03, 0.05]) {
      const ang = Math.PI / 4 + da;
      const out = snapTemplate(g, { x: 150, y: 150 }, { x: 150 + Math.cos(ang) * 400, y: 150 + Math.sin(ang) * 400 }, { origin: false, length: true, kind: 'cone', prev: st });
      st = out.st;
      angles.push(Math.round(Math.atan2(out.b.y - out.a.y, out.b.x - out.a.x) * 1e6) / 1e6);
    }
    expect(new Set(angles).size).toBe(1);
    expect(angles[0]).toBeCloseTo(Math.PI / 4, 5);
    // a clearly different direction is left alone
    const far = snapTemplate(g, { x: 150, y: 150 }, { x: 150 + Math.cos(0.9) * 400, y: 150 + Math.sin(0.9) * 400 }, { origin: false, length: true, kind: 'cone', prev: st });
    expect(Math.atan2(far.b.y - far.a.y, far.b.x - far.a.x)).toBeCloseTo(0.9, 2);
  });
});
