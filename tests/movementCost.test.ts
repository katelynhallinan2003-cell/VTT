import {brushWall,resolveWalls} from '../src/core/wallBrush';
import {type Wall,normalizeWall,wallToWire} from '../src/core/walls';
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
  it('counts eight 5 ft terraces as 40 ft of climbing, in either direction', () => {
    const terraces = Array.from({length:8}, (_, i) => rect(String(i), (i+1)*5, 100-i, (i+1)*5));
    const route = [point(0),point(45)];
    expect(measure(terraces,route).note).toBe('45 ft normal + 40 ft climbing');
    expect(measure(terraces,route.reverse()).note).toBe('45 ft normal + 40 ft climbing');
  });
  it('grazing the corner of another 5 ft step during a descent adds no climb', () => {
    const terraces = Array.from({length:8}, (_, i) => rect(String(i), (i+1)*5, 100-i, (i+1)*5));
    terraces.push(normalizeDrawing('lip', {k:'rect', p:'22,2,24.5,6', hz:25, t:2})!);
    const descent = [point(45,0),point(24,2),point(0,0)];
    expect(measure(terraces,descent).note).toMatch(/40 ft climbing$/);
    expect(measure(terraces,[descent[0],point(24,3),descent[2]]).note).toMatch(/50 ft climbing \(5 ft up, 45 ft down\)$/);
  });
  it('clears an intervening ridge on a flight with level endpoints', () => {
    const ridge = [rect('ridge',20,30,15)];
    expect(measure(ridge,[point(0),point(50)],0).ft).toBe(60);
  });
  it('accounts for both walls of a narrow depression and skips them on a route around it', () => {
    const pit = [rect('pit',10,10.5,-20)];
    expect(measure(pit,[point(0),point(20)])).toEqual({ft:60,note:'20 ft normal + 40 ft climbing (20 ft up, 20 ft down)'});
    expect(measure(pit,[point(0),point(0,8),point(20,8),point(20)])).toEqual({ft:34,note:''});
  });
  it('preserves shared drag corners independently of manual stops, including old previews', () => {
    const via = Array.from({length:60},(_,i)=>point(i,i%3));
    const ghost = { x:61,y:2,w:viaToWire(via,MAX_ROUTE_CORNERS),s:'4,39' };
    expect(normalizeLive('p',{ghosts:{t:ghost}})?.ghosts.t).toEqual({x:61,y:2,via,stops:[4,39]});
    expect(normalizeLive('p',{ghosts:{t:{x:2,y:2,w:'1,1'}}})?.ghosts.t).toEqual({x:2,y:2,via:[point(1)]});
  });
});


describe('erased bridge sides',()=>{
  const deck=terrainOf([rect('deck',10,20,10)],grid), edges=terrainEdges(deck);
  const ctx={ground:(p:Vec)=>groundAtTerrain(deck,p),rough:()=>false};
  const full=resolveWalls(edges,[]);
  const stroke=[point(5,0),point(25,0)];
  const gaps:Wall[]=[];
  for (const wall of full.walls.values()) for (const piece of brushWall(wall,stroke,2).cut) {
    const cut=normalizeWall('gap'+gaps.length,wallToWire({...wall,...piece,gap:true,face:undefined}));
    if (cut) gaps.push(cut);
  }
  const measure=(route:Vec[],stops:number[]=[],saved=gaps)=>{
    const resolved=resolveWalls(edges,saved);
    return movementCost(grid,route,null,ctx,[...resolved.terrain,...resolved.openings],[],stops);
  };
  it('passes underneath via two openings, in either direction, including a turn under the deck',()=>{
    expect(gaps).toHaveLength(2);
    expect(measure([point(0),point(15),point(30)]).ft).toBe(30);
    expect(measure([point(30),point(0)]).ft).toBe(30);
    expect(measure([point(0),point(15,0),point(30)]).note).toBe('');
  });
  it('retains the climb for a stop on the deck, an intact edge or an intentional waypoint',()=>{
    expect(measure([point(0),point(15)]).ft).toBe(25);
    expect(measure([point(15),point(0)]).ft).toBe(25);
    expect(measure([point(0),point(15),point(30)],[1]).ft).toBe(50);
    expect(measure([point(0,4),point(30,4)]).ft).toBe(50);
    expect(measure([point(0),point(30)],[],gaps.slice(0,1)).ft).toBe(50);
  });
  it('passes beneath a sloping deck while retaining the slope for a landing on it',()=>{
    const resolved=resolveWalls(edges,gaps), faces=[...resolved.terrain,...resolved.openings];
    const top=(p:Vec)=>10+(p.x-10)*0.5;
    const slopeCtx={rough:()=>false,ground:(p:Vec)=>p.x>=10 && p.x<=20 ? top(p) : 0,
      slope:(p:Vec)=>p.x>=10 && p.x<=20 ? top : undefined};
    expect(movementCost(grid,[point(0),point(30)],null,slopeCtx,faces,[])).toEqual({ft:30,note:''});
    expect(movementCost(grid,[point(0),point(15)],null,slopeCtx,faces,[]).ft).toBeGreaterThan(25);
  });
  it('preserves solid walls beside the opening and clips an overlapping brush sweep just once',()=>{
    const resolved=resolveWalls(edges,gaps);
    expect(resolved.terrain.filter(s=>s.a.x===s.b.x && Math.min(s.a.y,s.b.y)<1 && Math.max(s.a.y,s.b.y)>1)).toHaveLength(0);
    expect(resolved.terrain.filter(s=>s.a.x===s.b.x && Math.min(s.a.y,s.b.y)<4 && Math.max(s.a.y,s.b.y)>4)).toHaveLength(2);
    const wall={a:point(0,0),b:point(30,0)};
    const cut=brushWall(wall,[point(10,0),point(15,0),point(12,0)],2);
    expect(cut.cut).toEqual([{a:point(8,0),b:point(17,0)}]);
    expect(cut.kept).toHaveLength(2);
  });
});
