import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, drawingToWire, normalizeDrawing } from '../src/core/model';
import { areaAt, areaLabelAt, areasSelected, cellKey, cellsAlong, cellsAround, groundAtTerrain, newAreaId, paintedAreaAt, terrainOf, totalWith } from '../src/core/terrain';
import { hexToPx } from '../src/core/hex';
import type { Drawing } from '../src/types';

const grid = { ...DEFAULT_GRID, cell: 100, ft: 5, ox: 0, oy: 0 };
const hexGrid = { ...grid, shape: 'pointy' as const };

let clock = 0;
type Opts = { hz?: number | null; hg?: string; ha?: boolean; he?: boolean; hc?: boolean; w?: number };
const stroke = (id: string, p: string, o: Opts = {}): Drawing =>
  normalizeDrawing(id, { uid: 'dm', k: 'terrain', p, w: o.w ?? 100, t: ++clock, hz: o.hz === undefined ? 10 : o.hz, hg: o.hg ?? '', ha: o.ha, he: o.he, hc: o.hc })!;
const cellsOf = (id: string, centres: [number, number][], o: Opts = {}) => stroke(id, centres.map((c) => c.join(',')).join(','), { ...o, hc: true });
const old = (id: string, k: 'rect' | 'ellipse', p: string, hz: number): Drawing => normalizeDrawing(id, { uid: 'dm', k, p, hz, t: ++clock })!;
const pt = (cx: number, cy: number) => ({ x: cx * 100 + 50, y: cy * 100 + 50 });

describe('painted ground', () => {
  it('a cell stroke raises exactly the cells it lists', () => {
    const t = terrainOf([cellsOf('a', [[50, 50], [150, 50]], { hg: 'g1', hz: 15 })], grid);
    expect(groundAtTerrain(t, { x: 60, y: 70 })).toBe(15);
    expect(groundAtTerrain(t, { x: 140, y: 30 })).toBe(15);
    expect(groundAtTerrain(t, { x: 250, y: 50 })).toBe(0);
    expect(groundAtTerrain(t, { x: 60, y: 160 })).toBe(0);
  });

  it('a free stroke is a round brush along its path', () => {
    const t = terrainOf([stroke('a', '100,100,400,100', { hg: 'g', hz: 20, w: 100 })], grid);
    expect(groundAtTerrain(t, { x: 250, y: 140 })).toBe(20);
    expect(groundAtTerrain(t, { x: 250, y: 170 })).toBe(0);
    // a single point is a dot
    const dot = terrainOf([stroke('d', '300,300', { hg: 'g', hz: 5, w: 80 })], grid);
    expect(groundAtTerrain(dot, { x: 320, y: 310 })).toBe(5);
    expect(groundAtTerrain(dot, { x: 360, y: 300 })).toBe(0);
  });

  it('strokes with the same group are one area, painted a bit at a time', () => {
    const t = terrainOf([cellsOf('a', [[50, 50]], { hg: 'g', hz: 10 }), cellsOf('b', [[150, 50]], { hg: 'g', hz: 10 })], grid);
    expect(t.areas).toHaveLength(1);
    expect(t.areas[0].ids.sort()).toEqual(['a', 'b']);
    expect(groundAtTerrain(t, { x: 150, y: 50 })).toBe(10);
  });

  it('a stroke with no group is an area of its own', () => {
    const t = terrainOf([cellsOf('a', [[50, 50]], { hz: 10 }), cellsOf('b', [[150, 50]], { hz: 20 })], grid);
    expect(t.areas.map((a) => a.id).sort()).toEqual(['a', 'b']);
  });

  it('a later area that sets its height replaces the ground under it; one that adds stacks on top', () => {
    const base = cellsOf('a', [[50, 50], [150, 50]], { hg: 'hill', hz: 20 });
    const set = cellsOf('b', [[150, 50]], { hg: 'ledge', hz: 5 });
    expect(groundAtTerrain(terrainOf([base, set], grid), { x: 150, y: 50 })).toBe(5);
    const add = cellsOf('c', [[150, 50]], { hg: 'ramp', hz: 5, ha: true });
    const t = terrainOf([base, add], grid);
    expect(groundAtTerrain(t, { x: 150, y: 50 })).toBe(25);
    expect(groundAtTerrain(t, { x: 50, y: 50 })).toBe(20);
    // adding onto open ground starts from zero, and negative adds dig down
    const dig = terrainOf([cellsOf('d', [[50, 50]], { hg: 'pit', hz: -10, ha: true })], grid);
    expect(groundAtTerrain(dig, { x: 50, y: 50 })).toBe(-10);
    expect(groundAtTerrain(terrainOf([base, cellsOf('e', [[50, 50]], { hg: 'dig', hz: -5, ha: true })], grid), { x: 50, y: 50 })).toBe(15);
  });

  it('three adding areas pile up in the order they were made', () => {
    const list = [cellsOf('a', [[50, 50]], { hg: 'x', hz: 10, ha: true }), cellsOf('b', [[50, 50]], { hg: 'y', hz: 5, ha: true }), cellsOf('c', [[50, 50]], { hg: 'z', hz: 5, ha: true })];
    expect(groundAtTerrain(terrainOf(list, grid), { x: 50, y: 50 })).toBe(20);
  });

  it('a rub-out stroke takes ground from the area it names, and a general one from every area', () => {
    const a = cellsOf('a', [[50, 50], [150, 50], [250, 50]], { hg: 'g1', hz: 10 });
    const b = cellsOf('b', [[150, 50]], { hg: 'g2', hz: 30 });
    const mine = cellsOf('e1', [[150, 50]], { hg: 'g1', hz: null, he: true });
    const t = terrainOf([a, b, mine], grid);
    expect(groundAtTerrain(t, { x: 150, y: 50 })).toBe(30); // g2 is untouched
    expect(groundAtTerrain(t, { x: 50, y: 50 })).toBe(10);
    const all = terrainOf([a, b, cellsOf('e2', [[150, 50]], { hg: '', hz: null, he: true })], grid);
    expect(groundAtTerrain(all, { x: 150, y: 50 })).toBe(0);
    expect(groundAtTerrain(all, { x: 250, y: 50 })).toBe(10);
  });

  it('painting again over a rubbed-out spot brings it back (strokes apply in the order they were made)', () => {
    const list = [cellsOf('a', [[50, 50]], { hg: 'g', hz: 10 }), cellsOf('e', [[50, 50]], { hg: 'g', hz: null, he: true }), cellsOf('b', [[50, 50]], { hg: 'g', hz: 10 })];
    expect(groundAtTerrain(terrainOf(list, grid), { x: 50, y: 50 })).toBe(10);
    expect(groundAtTerrain(terrainOf(list.slice(0, 2), grid), { x: 50, y: 50 })).toBe(0);
  });

  it('rubbing out a whole area leaves nothing to select, and the erase stroke goes with the area', () => {
    const t = terrainOf([cellsOf('a', [[50, 50]], { hg: 'g', hz: 10 }), cellsOf('e', [[50, 50]], { hg: 'g', hz: null, he: true })], grid);
    expect(t.areas).toHaveLength(1);
    expect(t.areas[0].ids.sort()).toEqual(['a', 'e']);
    expect(areaAt(t, { x: 50, y: 50 })).toBeNull();
  });

  it('editing the area changes its height and mode for all strokes together', () => {
    const t = terrainOf([cellsOf('a', [[50, 50]], { hg: 'g', hz: 10 }), cellsOf('b', [[150, 50]], { hg: 'g', hz: 10 })], grid);
    const patched = [cellsOf('a', [[50, 50]], { hg: 'g', hz: 25, ha: true }), cellsOf('b', [[150, 50]], { hg: 'g', hz: 25, ha: true })];
    expect(t.areas[0].h).toBe(10);
    const u = terrainOf(patched, grid);
    expect(u.areas[0].h).toBe(25);
    expect(u.areas[0].add).toBe(true);
  });

  it('old boxes and circles still work, and painted areas sit on top of them', () => {
    const cliff = old('cliff', 'rect', '0,0,1000,1000', 10);
    const nest = old('nest', 'rect', '400,400,600,600', 40);
    const t = terrainOf([cliff, nest], grid);
    expect(groundAtTerrain(t, { x: 500, y: 500 })).toBe(40);
    expect(groundAtTerrain(t, { x: 100, y: 100 })).toBe(10);
    const painted = cellsOf('p', [[550, 550]], { hg: 'p', hz: 5, ha: true });
    expect(groundAtTerrain(terrainOf([cliff, nest, painted], grid), { x: 550, y: 550 })).toBe(45);
    expect(paintedAreaAt(terrainOf([cliff, nest], grid), { x: 500, y: 500 })).toBeNull();
    expect(paintedAreaAt(terrainOf([cliff, painted], grid), { x: 550, y: 550 })?.id).toBe('p');
  });

  it('its signature changes when anything about the ground does, and not otherwise', () => {
    const a = cellsOf('a', [[50, 50]], { hg: 'g', hz: 10 });
    const s1 = terrainOf([a], grid).sig;
    expect(terrainOf([a], grid).sig).toBe(s1);
    expect(terrainOf([{ ...a, hz: 15 }], grid).sig).not.toBe(s1);
    expect(terrainOf([a], { ...grid, cell: 80 }).sig).not.toBe(s1);
    expect(terrainOf([{ ...a, ha: true }], grid).sig).not.toBe(s1);
  });

  it('selecting finds the areas that own the selected strokes', () => {
    const t = terrainOf([cellsOf('a', [[50, 50]], { hg: 'g1', hz: 10 }), cellsOf('b', [[250, 50]], { hg: 'g2', hz: 20 })], grid);
    expect(areasSelected(t, new Set(['a'])).map((x) => x.id)).toEqual(['g1']);
    expect(areasSelected(t, new Set(['a', 'b'])).map((x) => x.id)).toEqual(['g1', 'g2']);
    expect(areasSelected(t, new Set())).toEqual([]);
  });

  it('survives the trip to the database and back', () => {
    const a = cellsOf('a', [[50, 50], [150, 50]], { hg: 'grp', hz: 0, ha: true });
    const wire = drawingToWire(a);
    expect(wire.hz).toBe(0);
    expect(wire.hg).toBe('grp');
    expect(wire.ha).toBe(true);
    expect(wire.hc).toBe(true);
    const back = normalizeDrawing('a', { ...wire, uid: 'dm' })!;
    expect(back.hz).toBe(0);
    expect(back.hc).toBe(true);
    expect(drawingToWire(stroke('e', '1,1', { hz: null, he: true })).he).toBe(true);
  });

  it('new area ids are short and differ from each other', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newAreaId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(24);
  });
});

describe('the brush cells', () => {
  it('on squares, an odd brush is centred on a square and an even one on a corner', () => {
    expect(cellsAround(grid, { x: 140, y: 60 }, 1)).toEqual([{ x: 150, y: 50 }]);
    const three = cellsAround(grid, { x: 140, y: 60 }, 3);
    expect(three).toHaveLength(9);
    expect(three).toContainEqual({ x: 50, y: -50 + 100 });
    const two = cellsAround(grid, { x: 190, y: 90 }, 2);
    expect(two.map((c) => `${c.x},${c.y}`).sort()).toEqual(['150,50', '150,150', '250,50', '250,150'].sort());
  });

  it('on hexes, a brush is a patch of 1, 7 or 19 hexes', () => {
    expect(cellsAround(hexGrid, { x: 100, y: 100 }, 1)).toHaveLength(1);
    expect(cellsAround(hexGrid, { x: 100, y: 100 }, 2)).toHaveLength(7);
    expect(cellsAround(hexGrid, { x: 100, y: 100 }, 3)).toHaveLength(19);
    const one = cellsAround(hexGrid, { x: 100, y: 100 }, 1)[0];
    expect(cellKey(hexGrid, hexToPx(hexGrid, 0, 0))).toBe(cellKey(hexGrid, hexToPx(hexGrid, 0, 0)));
    expect(Number.isFinite(one.x)).toBe(true);
  });

  it('a quick sweep leaves no gaps', () => {
    const keys = new Set(cellsAlong(grid, pt(0, 0), pt(9, 0), 1).map((c) => cellKey(grid, c)));
    expect(keys.size).toBe(10);
    const diag = new Set(cellsAlong(grid, pt(0, 0), pt(6, 6), 1).map((c) => cellKey(grid, c)));
    expect(diag.size).toBeGreaterThanOrEqual(7);
  });

  it('cell keys agree for any point inside the same cell', () => {
    expect(cellKey(grid, { x: 101, y: 1 })).toBe(cellKey(grid, { x: 199, y: 99 }));
    expect(cellKey(grid, { x: 101, y: 1 })).not.toBe(cellKey(grid, { x: 201, y: 1 }));
  });
});

describe('what an area is called on the map', () => {
  it('shows only the resulting elevation', () => {
    expect(areaLabelAt(25)).toBe('25 ft');
    expect(areaLabelAt(-10)).toBe('-10 ft');
    expect(areaLabelAt(0)).toBe('0 ft');
  });
  it('adds or sets over the ground below', () => {
    expect(totalWith(20, 5, true)).toBe(25);
    expect(totalWith(20, 5, false)).toBe(5);
  });
});
