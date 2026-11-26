import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, normalizeDrawing } from '../src/core/model';
import { connectedHeight, inRegion, patchStroke, terrainEdges } from '../src/core/terrainEdges';
import { groundAtTerrain, terrainOf } from '../src/core/terrain';
import { hexToPx } from '../src/core/hex';
import type { Drawing, Vec } from '../src/types';

const grid = { ...DEFAULT_GRID, cell: 10, ft: 5 };
const point = (x: number, y = 5) => ({x,y});
const cells = (id: string, height: number, pts: Vec[], extra: Partial<Drawing> = {}) =>
  normalizeDrawing(id,{k:'terrain', hg:id, hc:true, w:10, hz:height, t:1, ...extra,
    p:pts.map(p => [p.x,p.y].join(',')).join(',')})!;

describe('connected terrain selection', () => {
  it('includes adjoining strokes and stops at an erased cell, even within one stroke', () => {
    const paints = [cells('a',30,[point(5),point(15),point(55)]),
      cells('b',30,[point(25),point(35),point(45)]),
      cells('erase',0,[point(35)],{hg:'b',he:true,t:2})];
    const t = terrainOf(paints,grid), patch = connectedHeight(t,point(5))!;
    expect(patch.whole).toBe(false);
    expect([5,15,25,35,45,55].map(x => inRegion(patch.polygon,point(x)))).toEqual([true,true,true,false,false,false]);
    expect(connectedHeight(t,point(35))).toBeNull();
    const cuts = patch.cuts.flatMap(c => c.shape.map(poly => patchStroke(poly,c.group,null)));
    const edited = [...cuts,patchStroke(patch.polygon,'replacement',35)].map((stroke,i) =>
      normalizeDrawing('new'+i,{...stroke,t:3})!);
    const result = terrainOf([...paints,...edited],grid);
    expect([5,15,25,35,45,55].map(x => groundAtTerrain(result,point(x)))).toEqual([35,35,35,0,30,30]);
  });
  it('selects equal finished elevation across additive and exact paint and preserves a hole', () => {
    const points = [5,15,25].flatMap(x => [5,15,25].map(y => point(x,y)));
    const layers = [cells('base',20,points),cells('top',10,points,{ha:true,t:2}),
      cells('hole',40,[point(15,15)],{t:3}),cells('join',30,[point(35)],{t:4})];
    const t = terrainOf(layers,grid), patch = connectedHeight(t,point(5))!;
    expect(patch.height).toBe(30);
    expect(patch.polygon).toHaveLength(2);
    expect(patch.cuts.map(c => c.group).sort()).toEqual(['join','top']);
    expect(inRegion(patch.polygon,point(35))).toBe(true);
    expect(inRegion(patch.polygon,point(15,15))).toBe(false);
  });
  it('joins overlapping free brushes across seams while excluding another brush at the same elevation', () => {
    const strokes = [0,7,14,35].map((x,i) => cells(String(i),30,[point(x)],{hc:false,w:10}));
    const t = terrainOf(strokes,grid);
    const patch = connectedHeight(t,point(0))!;
    expect(patch.ids.sort()).toEqual(['0','1','2']);
    expect(inRegion(patch.polygon,point(14))).toBe(true);
    expect(inRegion(patch.polygon,point(35))).toBe(false);
  });
  it.each(['flat','pointy'] as const)('recognizes adjoining %s hexes saved with rounded centres', shape => {
    const g = {...grid,shape};
    const centers = [0,1,2].map(q => hexToPx(g,q,0));
    const strokes = centers.map((p,i) => cells(String(i),5,[{x:+p.x.toFixed(1), y:+p.y.toFixed(1)}]));
    const t = terrainOf(strokes,g);
    expect(connectedHeight(t,centers[0])?.ids.sort()).toEqual(['0','1','2']);
    expect(terrainEdges(t).every(e => e.low === 0 && e.top === 5)).toBe(true);
  });
});
