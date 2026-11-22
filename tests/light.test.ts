import { describe, expect, it } from 'vitest';
import { clipToConvex, darkPoly, eraseStops, lightOf, lightPoly, litSeen, ringPoly, SHADE, sightPoly, viewerOf, type LightSrc } from '../src/core/light';
import { inPoly } from '../src/core/walls';
import type { Seg } from '../src/core/walls';

const grid = { ft: 5, cell: 70 };
const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
const wall = (ax: number, ay: number, bx: number, by: number): Seg => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });

describe('lights and viewers', () => {
  it('a torch reaches bright 20 ft and dim 20 ft more, from the edge of its token', () => {
    const l = lightOf({ id: 't', size: 1, light: { b: 20, d: 20, c: '#ffc27a' } }, grid, { x: 100, y: 100 })!;
    expect(l.b).toBeCloseTo(4 * 70 + 35);
    expect(l.r).toBeCloseTo(8 * 70 + 35);
    expect(l.c).toBe('#ffc27a');
  });
  it('no light, or a light of no size, is nothing', () => {
    expect(lightOf({ id: 't', size: 1, light: null }, grid, { x: 0, y: 0 })).toBeNull();
    expect(lightOf({ id: 't', size: 1, light: { b: 0, d: 0, c: '#fff' } }, grid, { x: 0, y: 0 })).toBeNull();
  });
  it('a token with no sight is not a viewer; darkvision never goes past sight', () => {
    expect(viewerOf({ id: 'a', sight: 0, dv: 60, size: 1 }, grid, { x: 0, y: 0 })).toBeNull();
    const v = viewerOf({ id: 'a', sight: 30, dv: 60, size: 1 }, grid, { x: 0, y: 0 })!;
    expect(v.dv).toBeCloseTo(v.r);
    const w = viewerOf({ id: 'a', sight: 120, dv: 60, size: 1 }, grid, { x: 0, y: 0 })!;
    expect(w.dv).toBeCloseTo(12 * 70 + 35);
    expect(w.r).toBeCloseTo(24 * 70 + 35);
    expect(w.touch).toBeGreaterThan(35);
    expect(w.touch).toBeLessThan(w.dv);
  });
  it('with no darkvision a viewer still makes out what is right beside it', () => {
    const v = viewerOf({ id: 'a', sight: 60, dv: 0, size: 1 }, grid, { x: 500, y: 500 })!;
    const p = darkPoly(v, [])!;
    expect(inPoly({ x: 500 + 50, y: 500 }, p)).toBe(true);
    expect(inPoly({ x: 500 + 3 * 70, y: 500 }, p)).toBe(false);
  });
});

describe('where light and sight reach', () => {
  it('a wall stops a light', () => {
    const l: LightSrc = { id: 'l', x: 0, y: 0, b: 100, r: 300, c: '#fff' };
    const free = lightPoly(l, 300, []);
    const blocked = lightPoly(l, 300, [wall(100, -500, 100, 500)]);
    expect(area(blocked)).toBeLessThan(area(free) * 0.8);
    expect(inPoly({ x: 250, y: 0 }, blocked)).toBe(false);
    expect(inPoly({ x: 50, y: 0 }, blocked)).toBe(true);
  });
  it('a wall lower than the light does not stop it', () => {
    const low: Seg = { ...wall(100, -500, 100, 500), top: 5 };
    const l: LightSrc = { id: 'l', x: 0, y: 0, b: 100, r: 300, alt: 20, c: '#fff' };
    expect(inPoly({ x: 250, y: 0 }, lightPoly(l, 300, [low]))).toBe(true);
    expect(inPoly({ x: 250, y: 0 }, lightPoly({ ...l, alt: 0 }, 300, [low]))).toBe(false);
  });
});

describe('clipping to a round light', () => {
  it('keeps the part of a shape inside a ring', () => {
    const sq = [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }];
    const out = clipToConvex(sq, ringPoly({ x: 0, y: 0 }, 50, 48));
    expect(out.length).toBeGreaterThan(8);
    expect(area(out)).toBeGreaterThan(Math.PI * 50 * 50 * 0.97);
    expect(area(out)).toBeLessThan(Math.PI * 50 * 50 * 1.01);
  });
  it('a shape clear of the ring is nothing, one inside it stays whole', () => {
    const sq = [{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }, { x: 200, y: 300 }];
    expect(clipToConvex(sq, ringPoly({ x: 0, y: 0 }, 50))).toEqual([]);
    const small = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    expect(area(clipToConvex(small, ringPoly({ x: 0, y: 0 }, 50)))).toBeCloseTo(400, 3);
  });
  it('works whichever way round the ring is drawn', () => {
    const sq = [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }];
    const ring = ringPoly({ x: 0, y: 0 }, 50, 32);
    expect(area(clipToConvex(sq, [...ring].reverse()))).toBeCloseTo(area(clipToConvex(sq, ring)), 3);
  });
});

describe('what is remembered in the dark', () => {
  const v = viewerOf({ id: 'a', sight: 120, dv: 0, size: 1 }, grid, { x: 0, y: 0 })!;
  it('only the part of its sight that another light reaches', () => {
    const l: LightSrc = { id: 'l', x: 600, y: 0, b: 100, r: 200, c: '#fff' };
    const pieces = litSeen(v, [l], []);
    expect(pieces.length).toBe(1);
    expect(inPoly({ x: 600, y: 0 }, pieces[0])).toBe(true);
    expect(inPoly({ x: 100, y: 0 }, pieces[0])).toBe(false);
    expect(area(pieces[0])).toBeGreaterThan(Math.PI * 200 * 200 * 0.9);
  });
  it('a light out of reach adds nothing; a wall in the way cuts the view', () => {
    expect(litSeen(v, [{ id: 'l', x: 5000, y: 0, b: 100, r: 200, c: '#fff' }], [])).toEqual([]);
    const l: LightSrc = { id: 'l', x: 600, y: 0, b: 100, r: 200, c: '#fff' };
    const cut = litSeen(v, [l], [wall(300, -2000, 300, 2000)]);
    expect(cut.length === 0 || area(cut[0]) < 1).toBe(true);
    expect(area(sightPoly(v, [wall(300, -2000, 300, 2000)]))).toBeLessThan(area(sightPoly(v, [])));
  });
});

describe('how much a light lifts the dark', () => {
  it('is complete inside the bright part and fades to nothing at the edge', () => {
    const s = eraseStops(100, 200, 'dark');
    expect(s[0]).toEqual([0, 1]);
    expect(s.at(-1)).toEqual([1, 0]);
    // dim light in the dark lifts half
    expect(s.some(([, a]) => a === 0.5)).toBe(true);
    // offsets only ever go up
    for (let i = 1; i < s.length; i++) expect(s[i][0]).toBeGreaterThanOrEqual(s[i - 1][0]);
  });
  it('in twilight the dim part adds nothing', () => {
    const s = eraseStops(100, 200, 'dim');
    expect(s.some(([, a]) => a === 0.5)).toBe(false);
    expect(s.some(([, a]) => a === 0)).toBe(true);
  });
  it('a light with no dim part still fades at the edge', () => {
    const s = eraseStops(200, 200, 'dark');
    expect(s[0][1]).toBe(1);
    expect(s.at(-1)).toEqual([1, 0]);
  });
  it('the dark gets darker from daylight to night', () => {
    expect(SHADE.bright).toBe(0);
    expect(SHADE.dim).toBeLessThan(SHADE.dark);
  });
});
