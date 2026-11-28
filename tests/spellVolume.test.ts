import {floorLines,spellPicture} from '../src/core/spellPicture';
import {indexSpellWalls} from '../src/core/spellWallIndex';
import {rayHit} from '../src/core/walls';
import { describe,it,expect } from 'vitest';
import { spellAxis, snapSpellFeet, spellVolume, type Spell, type SpellWorld } from '../src/core/spellVolume';
import {heightNote} from '../src/core/height';
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
  it('expands from all six faces of a Huge creature, including above and below its space',()=>{
    const cast=(elevation=true)=>spellVolume({k:'emanation',bw:5,of:15,spell:{range:25,start:10,elevation}},a,point(32.5),grid,{segs:[],ground:()=>-50});
    const v=cast();
    expect(v.heightSpan(a)).toEqual([-15,50]);
    for(const h of [-15,5,35,50]) expect(v.hits(a,h)).toBe(true);
    for(const h of [-15.1,12,50.1]) expect(v.hits(a,h)).toBe(false);
    expect(v.hits(a,10,25)).toBe(false);
    expect(v.hits(point(22.5),45)).toBe(true); // 15 ft sideways and 20 ft above its top
    expect(v.hits(point(22.5),45.1)).toBe(false);
    expect(cast(false).hits(point(32.4),-50)).toBe(true);
    expect(cast(false).hits(a)).toBe(false);
  });
  it('emits from its exposed sides on consecutive squares of a fractional slope',()=>{
    const ground=(p:{x:number})=>.04*p.x-4.493;
    for(const x of [0,5,10]){
      const emitter=point(x),v=spellVolume({k:'emanation',bw:5,of:15,spell:{range:25,start:ground(emitter)}},emitter,point(x+32.5),grid,{segs:[],ground});
      for(const dx of [-25,25]) expect(v.hits(point(x+dx),ground(point(x+dx)))).toBe(true);
    }
  });
  it('can emit over a low obstruction but stops at a wall spanning its full height',()=>{
    const cast=(top:number)=>spellVolume({k:'emanation',bw:5,of:15,spell:{range:25,start:0,wrap:false}},a,point(32.5),grid,
      {segs:[{a:point(12,-100),b:point(12,100),top}],ground:()=>0});
    expect(cast(4).hits(point(20),0)).toBe(true);
    expect(cast(25).hits(point(20),0)).toBe(false);
  });
  it('keeps 60 ft of spatial range when editing elevations or following a gradient',()=>{
    const axis=(settings:Spell['spell'],ground=(p:{x:number})=>0)=>spellAxis({k:'beam',bw:10,spell:{range:60,...settings}},a,point(60),grid,ground);
    expect(axis({start:0,end:36}).b.x).toBe(48);
    expect(axis({start:36,end:0}).b.x).toBe(48);
    expect(axis({start:36,end:36}).b.x).toBe(60);
    expect(axis({},p=>p.x*.75).b.x).toBeCloseTo(48,6);
    expect(axis({start:0,end:95})).toMatchObject({end:60,b:{x:0,y:0},feet:60});
    const cliff=axis({},p=>p.x<48 ? 0 : 50);
    expect(cliff.b.x).toBeCloseTo(48,6);
    expect(cliff.end).toBeCloseTo(36,6);
    expect(snapSpellFeet(19.3,true)).toBe(20);
    expect(snapSpellFeet(19.3,false)).toBe(19.3);
    expect(heightNote(35,-12.432860714)).toBe(' (35 across, 12 down)');
  });
  it('clears a level bridge rim and tests a sloped line at the crossing',()=>{
    const bridge={segs:[{...wall,top:15}],ground:()=>15};
    expect(spell('beam',20,{},bridge).hits(point(16))).toBe(true);
    expect(spell('beam',20,{start:0,end:20},bridge).hits(point(16))).toBe(false);
    expect(spell('beam',20,{start:20,end:0},bridge).hits(point(16))).toBe(false);
    expect(spell('beam',20,{walls:false,start:0,end:20},bridge).hits(point(16))).toBe(false);
    expect(spell('beam',20,{walls:false,start:0,end:20},{segs:bridge.segs}).hits(point(16))).toBe(true);
  });
  it('anchors beams at the emitter and puts the handle on the projected front edge',()=>{
    for(const [start,end] of [[0,36],[36,0]]) {
      const beam=spell('beam',48,{start,end,range:60});
      expect(beam.bounds.x).toBeCloseTo(0);
      expect(beam.hits(point(-.1))).toBe(false);
      expect(beam.handle.x).toBeCloseTo(48+2.5*.6);
      expect(beam.handle.x).toBeCloseTo(beam.bounds.x+beam.bounds.w);
    }
    const clipped=spellVolume({k:'beam',bw:5},a,point(40,40),grid,{segs:[],maps:[{x:0,y:0,w:15,h:30}]});
    expect(clipped.handle).toEqual(point(15,15));
  });
  it('draws the projected faces and rim when a change of ground tilts the spell',()=>{
    const ledge={segs:[],ground:(p:{x:number})=>p.x>=45 ? 36 : 0};
    const cube=spell('cube',48,{},ledge),cone=spell('cone',48,{},ledge);
    expect(cube.feet).toBe(60);
    expect(cube.edges[0]).toHaveLength(5);
    expect(cube.edges[1]).toHaveLength(5);
    expect(cone.edges[0]).toHaveLength(65);
    expect(cube.handle.x).toBeCloseTo(66);
    expect(cone.handle.x).toBeCloseTo(66);
    expect(spell('cube',48).edges).toHaveLength(0);
  });
  it('stops descending spells in a plateau and cannot reappear beyond an intervening ridge',()=>{
    const plateau={segs:[],ground:()=>15};
    const descending=spell('beam',45,{start:15,end:6},plateau);
    expect(descending.hits(point(5),15)).toBe(true);
    expect(descending.hits(point(30))).toBe(false);
    expect(descending.cells().every(p=>p.x<15)).toBe(true);
    const ridge={segs:[],ground:(p:{x:number})=>p.x>=7 && p.x<=12 ? 25 : 0};
    for(const kind of ['beam','cone','sphere','cube'] as const) {
      expect(spell(kind,30,{walls:false},ridge).hits(point(20),0,5)).toBe(false);
      expect(spell(kind,30,{walls:false,elevation:false},ridge).hits(point(20),0,5)).toBe(true);
      expect(spell(kind,30,{start:30,end:30},ridge).hits(point(20),30)).toBe(true);
    }
    const narrowLip={steppedGround:true,ground:(p:{x:number})=>p.x>=9.1 && p.x<=9.2 ? 25 : 0,
      segs:[9.1,9.2].map(x=>({a:point(x,-40),b:point(x,40),top:25,terrainPxPerFt:1,one:1 as const}))};
    expect(spell('beam',20,{walls:false},narrowLip).hits(point(16),0)).toBe(false);
    expect(spell('sphere',20,{walls:false},narrowLip).hits(point(16),0)).toBe(false);
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

describe('spell presentation',()=>{
  it('traces the actual floor slice of a 10 ft sphere with its center 6 ft high',()=>{
    const picture=(start:number)=>spellPicture({spell:{k:'sphere',bw:5,spell:{start}},a,b:point(10),color:'#aa55ff',cover:false,fast:false},grid,{segs:[]});
    const cut=picture(6);
    expect(cut.contact.length).toBeGreaterThan(8);
    for(let i=0;i<cut.contact.length;i+=2)
      expect(Math.hypot(cut.contact[i],cut.contact[i+1])).toBeCloseTo(8,1);
    expect(picture(11).contact).toHaveLength(0);
  });
  it.each(['beam','cone','cube','sphere','emanation'] as const)('shades the %s volume and removes buried surfaces',k=>{
    const render=(height:number,elevation=true)=>spellPicture({spell:{k,bw:6,of:5,spell:{start:0,end:0,elevation}},
      a,b:point(20),color:'#539aff',cover:false,fast:true},grid,{segs:[],ground:()=>height});
    const surface=render(-30).surface;
    const colors=new Set<number>();
    for(let i=0;i<surface.rgba.length;i+=4) if(surface.rgba[i+3]) colors.add(surface.rgba[i]);
    expect(colors.size).toBeGreaterThan(2);
    const buried=render(50);
    expect(buried.surface.rgba.some(Boolean)).toBe(false);
    expect(buried.outline.length).toBe(0);
    expect(render(50,false).surface.rgba.some(Boolean)).toBe(true);
  });
  it('keeps a rotated airborne cube face continuous across coverage samples',()=>{
    const req={spell:{k:'cube' as const,bw:5,spell:{start:100,end:100}},a,b:point(-24,18),color:'#72beff',cover:false,fast:false};
    const open=spellPicture(req,grid,{segs:[]}).surface;
    // A low cliff below the cube cannot take strips out of its vertical faces.
    const lowCliff=spellPicture(req,grid,{segs:[{a:point(-10,-5),b:point(-10,20),top:2}],ground:()=>0}).surface;
    expect(lowCliff.rgba).toEqual(open.rgba);
  });
  it('uses ground altitude for footprint fill and keeps an airborne token hittable',()=>{
    const req={spell:{k:'sphere' as const,bw:5,spell:{start:6,range:10}},a,b:point(10),color:'#223344',cover:false,fast:false};
    const world={segs:[],ground:()=>0};
    const picture=spellPicture(req,grid,world);
    expect(picture.contact.length).toBeGreaterThan(0);
    for(let k=0;k<picture.contact.length;k+=2)
      expect(Math.hypot(picture.contact[k],picture.contact[k+1])).toBeCloseTo(8,1);
    const raised={...req,spell:{...req.spell,spell:{start:16,range:10}}};
    for(const cover of [true,false]){
      const air=spellPicture({...raised,cover},grid,world);
      expect(air.fill.length+air.triangles.length+air.contact.length).toBe(0);
      expect(air.surface.rgba.some(Boolean)).toBe(true);
    }
    const volume=spellVolume(raised.spell,a,point(10),grid,world);
    expect(volume.hits(a,0,5)).toBe(false);
    expect(volume.hits(a,10,15)).toBe(true);
  });
  it('passes below an open 30 ft deck, while targeting the deck only at its height',()=>{
    const edge=(x:number)=>({a:point(x,-60),b:point(x,60),top:30,terrainPxPerFt:1});
    const entry=edge(6),exit=edge(12);
    const ground=(p:{x:number})=>p.x>=6 && p.x<=12 ? 30 : 0;
    const open={ground,segs:[],openings:[entry,exit]};
    for(const k of ['beam','cube','cone','sphere'] as const){
      const cast=spell(k,25,{start:0,end:0,wrap:false},open);
      expect(cast.hits(point(18),0)).toBe(true);
      expect(cast.hits(point(9),0,5)).toBe(true);
      expect(cast.hits(point(9),30)).toBe(false);
      const closed=spell(k,25,{start:0,end:0,wrap:false},{...open,openings:[entry],segs:[exit]});
      expect(closed.hits(point(18),0)).toBe(false);
    }
    expect(spell('sphere',40,{start:0},open).hits(point(9),30)).toBe(true);
  });
  it('spends burst radius traveling out from beneath a deck and back across its top',()=>{
    const edge={a:point(-40,3),b:point(40,3)};
    const open={segs:[],ground:(p:{y:number})=>p.y<3 ? 30 : 0,openings:[edge]};
    const burst=(wrap:boolean)=>spell('sphere',20,{start:29,wrap},open);
    expect(burst(false).hits(a,30)).toBe(false);
    expect(burst(true).hits(a,30)).toBe(true);
    expect(burst(true).hits(point(0,-8),30)).toBe(true);
    expect(burst(true).hits(point(0,-17),30)).toBe(false);
    expect(spell('sphere',20,{start:29,wrap:true},{...open,openings:[]}).hits(a,30)).toBe(false);
  });
  it('maps visible cone pixels to their physical overhead positions',()=>{
    const d={k:'cone' as const,bw:5,spell:{start:18,end:11}},end=point(-32,24);
    const v=spellVolume(d,a,end,grid),pic=spellPicture({spell:d,a,b:end,color:'#ff7900',cover:false,fast:false},grid,{segs:[]});
    const img=pic.surface;
    for(let j=0;j<img.rows;j+=3)for(let i=0;i<img.cols;i+=3)if(img.rgba[(j*img.cols+i)*4+3]){
      const p={x:img.x+(i+.5)*img.w/img.cols,y:img.y+(j+.5)*img.h/img.rows};
      expect(v.heightSpan(p)).not.toBeNull();
    }
  });
  it('cuts the far rim of a cone and keeps the exposed wire on a sloping floor',()=>{
    const world={segs:[],ground:(p:{x:number})=>p.x*.25};
    const v=spell('cone',25,{start:8,end:1},world),cut=floorLines(v,grid,world,true);
    expect(cut.wire.length).toBeGreaterThan(0);
    expect(cut.wire).not.toEqual(floorLines(v,grid,world,false).wire);
  });
  it('keeps the authored first blocker when tracing across many indexed walls',()=>{
    const walls=Array.from({length:80},(_,i)=>({a:point((i*19)%83,(i%5)-4),b:point((i*19)%83+3,i%9+3)}));
    const query=indexSpellWalls(walls);
    for(let i=0;i<60;i++){
      const from=point(i-5,i%9),to=point(80-i,i%7-1);
      const hit=(w:typeof walls[number])=>rayHit(from,to.x-from.x,to.y-from.y,w)<1-1e-7;
      expect(query(from,to,hit)).toBe(walls.find(hit));
    }
  });
});
