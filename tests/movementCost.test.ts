import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, normalizeDrawing, normalizeLive, viaToWire, MAX_ROUTE_CORNERS } from '../src/core/model';
import { terrainOf, groundAtTerrain } from '../src/core/terrain';
import { terrainEdges } from '../src/core/terrainEdges';
import { movementCost } from '../src/core/movementCost';
import type { Drawing, Vec } from '../src/types';

const grid = { ...DEFAULT_GRID, cell: 5, ft: 5, visible: false, snap: false, rule: 'euclid' as const };
const point = (x: number, y = 1): Vec => ({ x, y });
const rect = (id: string, left: number, right: number, hz: number): Drawing =>
  normalizeDrawing(id, { k: 'rect', p: [left, -6, right, 6].join(','), hz, t: 1 })!;
function measure(drawings: Drawing[], path: Vec[], flyer: number | null = null) {
  const terrain = terrainOf(drawings,grid);
  const ctx = { ground: (p: Vec) => groundAtTerrain(terrain,p), rough: () => false };
  return movementCost(grid,path,flyer,ctx,terrainEdges(terrain),[]);
}

describe('movement over terrain', () => {
  it('includes the 40 ft rise and bypasses it for a flyer already above the summit', () => {
    const plateau = [rect('summit',60,80,40)];
    expect(measure(plateau,[point(0),point(60)],0).ft).toBe(72.1);
    expect(measure(plateau,[point(60),point(0)],0).ft).toBe(72.1);
    expect(measure(plateau,[point(0),point(60)],45).ft).toBe(60);
  });
  it('clears an intervening ridge on a flight with level endpoints', () => {
    const ridge = [rect('ridge',20,30,15)];
    expect(measure(ridge,[point(0),point(50)],0).ft).toBe(60);
  });
  it('accounts for both walls of a narrow depression and skips them on a route around it', () => {
    const pit = [rect('pit',10,10.5,-20)];
    expect(measure(pit,[point(0),point(20)])).toEqual({ft:60,note:'20 ft normal + 40 ft climbing'});
    expect(measure(pit,[point(0),point(0,8),point(20,8),point(20)])).toEqual({ft:34,note:''});
  });
  it('preserves shared drag corners independently of manual stops, including old previews', () => {
    const via = Array.from({length:60},(_,i)=>point(i,i%3));
    const ghost = { x:61,y:2,w:viaToWire(via,MAX_ROUTE_CORNERS),s:'4,39' };
    expect(normalizeLive('p',{ghosts:{t:ghost}})?.ghosts.t).toEqual({x:61,y:2,via,stops:[4,39]});
    expect(normalizeLive('p',{ghosts:{t:{x:2,y:2,w:'1,1'}}})?.ghosts.t).toEqual({x:2,y:2,via:[point(1)]});
  });
});
