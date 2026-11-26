import { describe, expect, it } from 'vitest';
import { drawingToWire, normalizeDrawing } from '../src/core/model';
import { isRough, roughOf } from '../src/core/height';
import { templateRoughDraws } from '../src/core/templaterough';
import { roughDistance } from '../src/core/walk';
import type { Seg } from '../src/core/walls';
import type { Drawing, GridSettings } from '../src/types';

const grid = (over: Partial<GridSettings> = {}): GridSettings => ({
  shape: 'square', cell: 100, ox: 0, oy: 0, visible: true, color: '#fff', opacity: 0.3, ft: 5, rule: 'chebyshev', snap: true, ...over,
});
const at = (i: number, j: number) => ({ x: i * 100 + 50, y: j * 100 + 50 });

/** a sphere of 20 ft radius (four squares out) set off at the middle of square (5, 5) */
function sphere(over: Partial<Drawing> = {}): Drawing {
  const c = at(5, 5);
  return {
    id: 's1', uid: 'u', k: 'sphere', p: `${c.x},${c.y},${c.x + 400},${c.y}`, color: '#ff0000', w: 4, fill: 0, fc: '', dash: false, txt: '', fs: 28, font: '',
    b: false, i: false, u: false, ho: false, bw: 5, hz: null, t: 1, ...over,
  };
}

describe('a spell template marked as difficult ground', () => {
  it('makes difficult ground of the squares it covers, and nothing when it is not marked', () => {
    const g = grid();
    expect(templateRoughDraws([sphere()], g)).toEqual([]);
    const out = templateRoughDraws([sphere({ td: true })], g);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ k: 'terrain', dt: true, hc: true, hz: 1, he: false, ha: false });
    const rough = roughOf(out, g);
    expect(isRough(rough, at(5, 5))).toBe(true);
    expect(isRough(rough, at(7, 5))).toBe(true);
    expect(isRough(rough, at(5, 10))).toBe(false);
    expect(isRough(rough, at(15, 5))).toBe(false);
  });

  it('only templates count: a marked line or box does nothing', () => {
    const c = at(5, 5);
    const line: Drawing = { ...sphere({ td: true }), k: 'line', p: `${c.x},${c.y},${c.x + 400},${c.y}` };
    expect(templateRoughDraws([line], grid())).toEqual([]);
  });

  it('is gone with the template', () => {
    const g = grid();
    expect(roughOf(templateRoughDraws([], g), g).areas).toHaveLength(0);
  });

  it('a wall that stops the spell stops the difficult ground too', () => {
    const g = grid();
    // a wall on the line x = 700 (the edge of square 6 and 7), tall enough to stop anything
    const wall: Seg = { a: { x: 700, y: -1000 }, b: { x: 700, y: 2000 } };
    const open = roughOf(templateRoughDraws([sphere({ td: true })], g), g);
    const walled = roughOf(templateRoughDraws([sphere({ td: true })], g, [wall]), g);
    expect(isRough(open, at(7, 5))).toBe(true);
    expect(isRough(walled, at(6, 5))).toBe(true);
    expect(isRough(walled, at(7, 5))).toBe(false);
  });

  it('an emanation leaves out the square it comes out of, like the squares it lights up', () => {
    const g = grid();
    const c = at(5, 5);
    const em: Drawing = { ...sphere({ td: true }), k: 'emanation', p: `${c.x},${c.y},${c.x + 200},${c.y}`, of: 5 };
    const r = roughOf(templateRoughDraws([em], g), g);
    expect(isRough(r, at(5, 5))).toBe(false);
    expect(isRough(r, at(6, 5))).toBe(true);
  });

  it('walking through it costs one extra square for each square entered', () => {
    const g = grid();
    const r = roughOf(templateRoughDraws([sphere({ td: true })], g), g);
    const rough = (p: {x:number;y:number}) => isRough(r,p);
    expect(roughDistance(g, at(0,5), at(14,5), rough)).toBeGreaterThan(0);
    expect(roughDistance(g, at(0,0), at(14,0), rough)).toBe(0);
  });
});

describe('saving the mark', () => {
  it('survives the round trip for a template, and is dropped for anything else', () => {
    const s = sphere({ td: true });
    const wire = drawingToWire(s);
    expect(wire.td).toBe(true);
    expect(normalizeDrawing('s1', wire)?.td).toBe(true);
    expect(normalizeDrawing('s1', drawingToWire(sphere()))?.td).toBeUndefined();
    expect(normalizeDrawing('x', { ...drawingToWire({ ...s, k: 'pen' }), td: true })?.td).toBeUndefined();
  });
});
