import { describe, expect, it } from 'vitest';
import { cellsOnLine, rampCells, roughDistance } from '../src/core/walk';
import { roughOf, isRough, zonesOf, groundAt } from '../src/core/height';
import type { Drawing, GridSettings } from '../src/types';

const grid = (over: Partial<GridSettings> = {}): GridSettings => ({
  shape: 'square', cell: 100, ox: 0, oy: 0, visible: true, color: '#000', opacity: 0.3, ft: 5, rule: 'alt', snap: true, ...over,
});
const at = (i: number, j: number) => ({ x: i * 100 + 50, y: j * 100 + 50 });
describe('cellsOnLine', () => {
  it('lists the squares a straight move passes through, starting with the first', () => {
    const cs = cellsOnLine(grid(), at(0, 0), at(3, 0));
    expect(cs.map((c) => c.x)).toEqual([50, 150, 250, 350]);
  });
  it('a move inside one square is that square', () => {
    expect(cellsOnLine(grid(), { x: 10, y: 10 }, { x: 40, y: 40 })).toHaveLength(1);
  });
});

describe('difficult ground', () => {
  const rough = (p: {x:number}) => p.x > 100 && p.x < 400;
  it('charges entered squares and measures the affected length in gridless mode', () => {
    expect(roughDistance(grid(),at(0,0),at(5,0),rough)).toBe(15);
    expect(roughDistance(grid({visible:false,snap:false}),at(0,0),at(5,0),rough)).toBe(15);
    expect(roughDistance(grid(),at(4,0),at(7,0),rough)).toBe(0);
  });
});

describe('ramps', () => {
  it('steps up in 5 ft stages along the line, one list of squares per height', () => {
    const r = rampCells(grid(), at(0, 2), at(4, 2), 0, 20, 1);
    expect(r.map((x) => x.h)).toEqual([0, 5, 10, 15, 20]);
    expect(r.every((x) => x.cells.length === 1)).toBe(true);
    expect(r[0].cells[0]).toEqual(at(0, 2));
    expect(r[4].cells[0]).toEqual(at(4, 2));
  });
  it('can go down, and be wider', () => {
    const r = rampCells(grid(), at(0, 2), at(4, 2), 20, 0, 3);
    expect(r[0].h).toBe(0);
    expect(r[r.length - 1].h).toBe(20);
    expect(r.every((x) => x.cells.length === 3)).toBe(true);
  });
  it('a tiny drag makes nothing', () => {
    expect(rampCells(grid(), at(0, 0), { x: 60, y: 50 }, 0, 20, 1)).toEqual([]);
  });
  it('a ramp from a corner is an even number of squares wide', () => {
    const r = rampCells(grid(), { x: 0, y: 200 }, { x: 400, y: 200 }, 0, 10, 2);
    expect(r.every((x) => x.cells.length === 4 || x.cells.length === 2 || x.cells.length === 6)).toBe(true);
    expect(r.flatMap((x) => x.cells).every((c) => Math.abs(c.y - 200) === 50)).toBe(true);
  });
});

describe('difficult ground is a layer of its own', () => {
  const drawing = (over: Partial<Drawing>): Drawing => ({
    id: Math.random().toString(36).slice(2), uid: 'u', k: 'terrain', p: '150,150', color: '#c80', w: 100, fill: 0, fc: '', dash: false, txt: '', fs: 28, font: '', b: false, i: false, u: false, ho: false, bw: 5, of: 0, hz: 1, hg: 'dt', hc: true, dt: true, t: 1, ...over,
  } as Drawing);
  const g = grid();
  it('does not change how high the ground is', () => {
    const d = [drawing({}), drawing({ id: 'h', hz: 20, hg: 'hill', dt: undefined, p: '350,150' })];
    expect(groundAt(zonesOf(d, g), at(1, 1))).toBe(0);
    expect(groundAt(zonesOf(d, g), at(3, 1))).toBe(20);
  });
  it('is found where it was painted', () => {
    const d = [drawing({})];
    const r = roughOf(d, g);
    expect(isRough(r, at(1, 1))).toBe(true);
    expect(isRough(r, at(2, 1))).toBe(false);
  });
  it('rubbing out takes it away', () => {
    const d = [drawing({ id: 'a', t: 1 }), drawing({ id: 'b', he: true, hz: null, t: 2 })];
    expect(isRough(roughOf(d, g), at(1, 1))).toBe(false);
  });
  it('nothing painted is not rough', () => {
    expect(isRough(roughOf([], g), at(0, 0))).toBe(false);
  });
});
