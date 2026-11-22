import { describe, expect, it } from 'vitest';
import { auraCells, coveredCells, outlineEdges } from '../src/core/cells';
import { snapTemplate, snapTemplateOrigin, snapToEdgeOrCorner, type TemplateSnapState } from '../src/core/draw';
import { reachableCells, type Seg } from '../src/core/walls';
import type { GridSettings } from '../src/types';

const grid = (over: Partial<GridSettings> = {}): GridSettings => ({
  shape: 'square', cell: 70, ox: 0, oy: 0, visible: true, color: '#000', opacity: 0.3, ft: 5, rule: 'chebyshev', snap: true, ...over,
});
const key = (cs: { x: number; y: number }[]) => cs.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).sort().join('|');
/** a pointer that wobbles around a point `cells` squares out, in every direction, the way a hand does */
function wiggle(kind: 'sphere' | 'emanation', cells: number, jitterCells: number) {
  const g = grid();
  const start = { x: 35 + 700, y: 35 + 700 };
  let prev: TemplateSnapState | undefined;
  const sets = new Set<string>();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) {
    const ang = rnd() * Math.PI * 2;
    const r = (cells + (rnd() - 0.5) * 2 * jitterCells) * g.cell;
    const w = { x: start.x + Math.cos(ang) * r, y: start.y + Math.sin(ang) * r };
    const sn = snapTemplate(g, start, w, { origin: true, length: true, kind, widthPx: g.cell, sphereAt: 'center', prev, fixedOrigin: kind === 'emanation' ? start : undefined });
    prev = sn.st;
    sets.add(key(coveredCells(g, kind, sn.a, sn.b, g.cell)));
  }
  return sets;
}

describe('a sphere or emanation held at one distance does not flicker', () => {
  it('a 20 ft sphere keeps all 49 squares however the pointer turns (the end squares sit exactly on the edge)', () => {
    const sets = wiggle('sphere', 4, 0.2);
    expect(sets.size).toBe(1);
    expect([...sets][0].split('|')).toHaveLength(49);
  });
  it('a 20 ft emanation stays one set while the pointer wiggles', () => {
    expect(wiggle('emanation', 4.6, 0.2).size).toBe(1);
  });
  it('squares exactly on the edge of a sphere are counted for every angle', () => {
    const g = grid();
    const a = { x: 735, y: 735 };
    for (let i = 0; i < 360; i++) {
      const t = (i / 360) * Math.PI * 2;
      const b = { x: a.x + Math.cos(t) * 280, y: a.y + Math.sin(t) * 280 };
      expect(coveredCells(g, 'sphere', a, b, 70)).toHaveLength(49);
    }
  });
});

describe('a line starts from the middle of a side or from a corner, whichever is nearer', () => {
  const g = grid();
  it('picks a corner near a corner and a side middle near a side middle', () => {
    expect(snapToEdgeOrCorner(g, { x: 142, y: 138 })).toEqual({ x: 140, y: 140 });
    expect(snapToEdgeOrCorner(g, { x: 138, y: 107 })).toEqual({ x: 140, y: 105 });
    expect(snapToEdgeOrCorner(g, { x: 108, y: 142 })).toEqual({ x: 105, y: 140 });
  });
  it('is what a line (beam) uses; a cone and a cube still start from a side middle', () => {
    expect(snapTemplateOrigin(g, 'beam', { x: 142, y: 138 })).toEqual({ x: 140, y: 140 });
    expect(snapTemplateOrigin(g, 'cone', { x: 142, y: 138 })).toEqual({ x: 140, y: 105 });
    expect(snapTemplateOrigin(g, 'cube', { x: 142, y: 138 })).toEqual({ x: 140, y: 105 });
  });
  it('a diagonal line that starts at a corner keeps the corner', () => {
    const s = snapTemplate(g, { x: 141, y: 139 }, { x: 141 + 300, y: 139 + 300 }, { origin: true, length: true, kind: 'beam', widthPx: 70 });
    expect(s.a).toEqual({ x: 140, y: 140 });
  });
  it('works on hexes too (it picks something on the grid and does not throw)', () => {
    const h = grid({ shape: 'pointy' });
    const o = snapToEdgeOrCorner(h, { x: 100, y: 100 });
    expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true);
  });
});

describe('a spell reads how tall a wall is', () => {
  // a wall straight across, between the first and second square east of the start; only the first square is in front of it
  const from = { x: 35, y: 35 };
  const cells = [1, 2, 3, 4].map((i) => ({ x: 35 + i * 70, y: 35 }));
  const wall = (top?: number): Seg => ({ a: { x: 140, y: -200 }, b: { x: 140, y: 300 }, ...(top === undefined ? {} : { top }) });
  it('a wall with no height stops it, whatever it is standing on', () => {
    expect(reachableCells(cells, from, [wall()], 0)).toHaveLength(1);
    expect(reachableCells(cells, from, [wall()], 50)).toHaveLength(1);
  });
  it('a tall wall stops a spell that starts low and a spell that starts on its level', () => {
    expect(reachableCells(cells, from, [wall(30)], 0)).toHaveLength(1);
    expect(reachableCells(cells, from, [wall(30)], 30)).toHaveLength(1);
  });
  it('a wall lower than where the spell starts is gone over: the area wraps down the far side', () => {
    expect(reachableCells(cells, from, [wall(10)], 20)).toHaveLength(4);
  });
  it('without a starting height nothing changes (a height-less caller still gets stopped)', () => {
    expect(reachableCells(cells, from, [wall(10)])).toHaveLength(1);
  });
});

describe('an aura follows the grid lines', () => {
  const g = grid();
  const centre = { x: 35 + 70 * 5, y: 35 + 70 * 5 };
  it('a 10 ft round aura from the middle covers whole squares: the 13 within two squares', () => {
    expect(auraCells(g, centre, 70, { r: 10, shape: 'circle', edge: false })).toHaveLength(13);
  });
  it('a 10 ft aura measured from the edge of a medium token covers a 5 x 5 block rounded at the corners', () => {
    const cs = auraCells(g, centre, 70, { r: 10, shape: 'circle', edge: true });
    expect(cs.length).toBeGreaterThanOrEqual(21);
    expect(cs.some((p) => Math.round(p.x) === Math.round(centre.x) && Math.round(p.y) === Math.round(centre.y))).toBe(true); // its own square is part of it
  });
  it('the outline of a block of squares is its outer sides only', () => {
    const cs = auraCells(g, centre, 70, { r: 5, shape: 'square', edge: false });
    expect(cs).toHaveLength(9);
    expect(outlineEdges(g, cs)).toHaveLength(12);
    expect(outlineEdges(g, [centre])).toHaveLength(4);
  });
});
