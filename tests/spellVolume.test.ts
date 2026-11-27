import { describe,it,expect } from 'vitest';
import { spellVolume, type Spell, type SpellWorld } from '../src/core/spellVolume';
import { DEFAULT_GRID, normalizeDrawing, drawingToWire } from '../src/core/model';
import { terrainEdges, patchStroke } from '../src/core/terrainEdges';
import { terrainOf } from '../src/core/terrain';

const grid={...DEFAULT_GRID,cell:5,ft:5};
const a={x:0,y:0}, point=(x:number,y=0)=>({x,y});
const wall={a:point(10,-5),b:point(10,5)};
function spell(k:Spell['k'], length:number, settings:Spell['spell']={}, world:SpellWorld={segs:[]}) {
  return spellVolume({k,bw:5,spell:settings},a,point(length),grid,world);
}
describe('spell volumes',()=>{
  it('clears a level bridge rim and tests a sloped line at the crossing',()=>{
    const bridge={segs:[{...wall,top:15}],ground:()=>15};
    expect(spell('beam',20,{},bridge).hits(point(16))).toBe(true);
    expect(spell('beam',20,{start:0,end:20},bridge).hits(point(16))).toBe(false);
    expect(spell('beam',20,{start:20,end:0},bridge).hits(point(16))).toBe(false);
    expect(spell('beam',20,{walls:false,start:0,end:20},bridge).hits(point(16))).toBe(true);
  });
  it('spends a burst’s radius on the detour and never bends a line',()=>{
    const world={segs:[wall]};
    expect(spell('sphere',20,{},world).hits(point(15),0)).toBe(true);
    expect(spell('sphere',20,{},world).hits(point(20),0)).toBe(false);
    expect(spell('sphere',20,{wrap:false},world).hits(point(15),0)).toBe(false);
    expect(spell('beam',20,{},world).hits(point(15),0)).toBe(false);
    expect(spell('sphere',20,{}, {segs:[{a:point(10,-30),b:point(10,30)}]}).hits(point(15),0)).toBe(false);
  });
  it('casts parallel lanes across the whole beam face through partial walls and doorways',()=>{
    const beam={k:'beam' as const,bw:20};
    const reaches=(segs:SpellWorld['segs'])=>spellVolume(beam,a,point(30),grid,{segs}).hits;
    const partial=reaches([{a:point(10,3),b:point(10,6)}]);
    expect(partial(point(28,5))).toBe(false);
    expect(partial(point(28,9))).toBe(true);
    expect(partial(point(8,5))).toBe(true);
    const door=reaches([{a:point(10,-10),b:point(10,-2)},{a:point(10,2),b:point(10,10)}]);
    expect(door(point(28,1))).toBe(true);
    expect(door(point(28,3))).toBe(false);
    const angled=spellVolume(beam,a,point(30,30),grid,{segs:[{a:point(10,14),b:point(10,16)}]});
    expect(angled.hits(point(22,27))).toBe(false);
    expect(angled.hits(point(22,30))).toBe(true);
  });
  it('clips the vertical thickness of a tilted line at the wall crossing',()=>{
    const line=spellVolume({k:'beam',bw:12,spell:{start:0,end:20}},a,point(20),grid,{segs:[{...wall,top:12}]});
    expect(line.hits(point(15),15,16)).toBe(false);
    expect(line.hits(point(15),16,17)).toBe(true);
    expect(line.hits(point(15))).toBe(true);
    expect(normalizeDrawing('line',{k:'beam',p:'0,0,20,0',bw:0.5})?.bw).toBe(0.5);
    expect(normalizeDrawing('line',{k:'beam',p:'0,0,20,0',bw:225.5})?.bw).toBe(225.5);
  });
  it('intersects the full creature height with a sphere and respects map bounds',()=>{
    const burst=spell('sphere',20,{start:120},{segs:[],maps:[{x:-10,y:-10,w:20,h:20}]});
    expect(burst.hits(a,0,5)).toBe(false);
    expect(burst.hits(a,88,103)).toBe(true);
    expect(burst.hits(point(17),120,122)).toBe(false);
    expect(spell('sphere',20,{start:120,elevation:false}).hits(a,0,5)).toBe(true);
  });
  it('uses the center of the far face and the actual tilted cone axis',()=>{
    const horizontal=spell('cone',60,{start:60,end:60});
    expect(horizontal.hits(point(60),29,29)).toBe(false);
    expect(horizontal.hits(point(60),30,30)).toBe(true);
    expect(horizontal.hits(point(30,15),65,70)).toBe(false);
    const up=spell('cone',48,{start:0,end:36});
    expect(up.feet).toBe(60);
    // The lower rim projects 18 ft beyond the axis endpoint and 24 ft below it.
    expect(up.hits(point(65.9),12,12.2)).toBe(true);
    expect(up.hits(point(66),0,5)).toBe(false);
    expect(spell('beam',48,{start:0,end:36}).feet).toBe(60);
  });
  it('preserves spell-specific overrides including explicit zero across save/load',()=>{
    const d=normalizeDrawing('t',{k:'cone',p:'0,0,20,0',spell:{walls:false,wrap:false,start:0,end:-10}})!;
    expect(normalizeDrawing('t',drawingToWire(d))?.spell).toEqual(d.spell);
  });
  it('omits exterior map borders and preserves the interior part of a shared map edge',()=>{
    const terrain=terrainOf([normalizeDrawing('t',patchStroke([[[0,0],[20,0],[20,20],[0,20]]],'t',15))!],grid);
    const map={x:0,y:0,w:20,h:20};
    expect(terrainEdges(terrain,[],[map])).toEqual([]);
    const edges=terrainEdges(terrain,[],[map,{x:20,y:5,w:20,h:10}]);
    expect(edges.map(e=>[e.a,e.b])).toEqual([[point(20,5),point(20,15)]]);
  });
});
