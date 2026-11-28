import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, drawingToWire, normalizeDrawing } from '../src/core/model';
import { initialBoundaryControls } from '../src/core/gradientBoundaries';
import { dragGradient, gradientPath, initialGradientLine } from '../src/core/gradientGeometry';
import { heightColor, groundAtTerrain, slopeAt, standingGround, surfaceHeight, terrainOf } from '../src/core/terrain';
import { bucketRegion, extendGradient, inRegion, connectedHeight, areaShape, terrainEdges, fillTerrainHoles, terrainHoleOptions, patchStroke } from '../src/core/terrainEdges';
import { movementCost } from '../src/core/movementCost';
import type { Seg } from '../src/core/walls';
import type { GradientControl, Vec } from '../src/types';

const grid={...DEFAULT_GRID,cell:5,ft:5,rule:'euclid' as const};
const at=(x:number,y=0) => ({x,y});
const line=(x:number,height:number): GradientControl => ({id:String(x),height,path:[at(x,-10),at(x,10)]});
const area=(gradient: GradientControl[]) => normalizeDrawing('hill',{k:'rect',hz:12,p:'0,-10,8,10',gradient})!;

describe('editable gradients',()=>{
  it('keeps the same matched heights when a long line is indexed in tiles',()=>{
    const corner={x:0,y:0,rise:25};
    const short=[{x:-96,y:-64,rise:-5},corner,{x:96,y:-64,rise:-5}];
    const dense=short.slice(1).flatMap((b,i)=>Array.from({length:16},(_,j)=>{
      const a=short[i], t=j/16;
      return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,rise:a.rise+(b.rise-a.rise)*t};
    })).concat(short[2]);
    const ground=(path:typeof short)=>({h:0,gradient:[{id:'rim',height:10,path,match:true},line(128,40)]});
    const indexed=ground(dense), plain=ground(short);
    for (const x of [-128,-32.01,-32,0,31.99,32,100]) for (const y of [-65,-32,-1,0,32]) {
      expect(surfaceHeight(indexed,at(x,y))).toBeCloseTo(surfaceHeight(plain,at(x,y)),8);
    }
  });
  it('retains the original height until two controls exist and locks the entire line',()=>{
    expect(groundAtTerrain(terrainOf([area([line(0,0)])],grid),at(1))).toBe(12);
    const terrain=terrainOf([area([line(0,0),line(8,6)])],grid);
    for (const y of [-9,0,7]) {
      expect(groundAtTerrain(terrain,at(0,y))).toBe(0);
      expect(groundAtTerrain(terrain,at(8,y))).toBe(6);
      expect(groundAtTerrain(terrain,at(4,y))).toBeCloseTo(3);
    }
  });
  it('counts an 8 ft run with a 6 ft rise as 10 ft of walking and keeps the wall at the high end',()=>{
    const t=terrainOf([area([line(0,0),line(8,6)])],grid);
    const joins: Seg[]=[];
    const walls=terrainEdges(t,joins);
    expect(walls.every(e=>e.a.x===e.b.x ? e.a.x===8 : Math.abs(e.a.y)===10)).toBe(true);
    const cost=(path:Vec[],fly:number|null=null)=>movementCost(grid,path,fly,{ground:p=>groundAtTerrain(t,p),slope:p=>slopeAt(t,p),rough:()=>false},[...walls,...joins],[]);
    expect(cost([at(0),at(8)])).toEqual({ft:10,note:''});
    expect(cost([at(-10),at(8)])).toEqual({ft:20,note:''});
    expect(cost([at(8),at(0)])).toEqual({ft:10,note:''});
    expect(cost([at(0),at(9)]).note).toContain('6 ft climbing');
    expect(cost([at(0),at(8)],0).ft).toBe(10);
  });
  it('follows the actual curve between edge endpoints and rejects endpoints outside the area',()=>{
    const d=normalizeDrawing('oval',{k:'ellipse',hz:10,p:'0,0,100,100'})!;
    const t=terrainOf([d],grid), shape=areaShape(t,'oval');
    const path=gradientPath(shape,at(50,0),at(102,50),3)!;
    expect(path.length).toBeGreaterThan(3);
    for (const p of path) expect(Math.hypot(p.x-50,p.y-50)).toBeCloseTo(50,1);
    expect(gradientPath(shape,at(30,40),undefined,2)).toEqual([at(30,40)]);
    expect(gradientPath(shape,at(200,50),undefined,3)).toBeNull();
  });
  it('preserves the smooth surface inside a hex and assigns one standing height across that hex',()=>{
    const t=terrainOf([area([line(0,0),line(8,6)])],{...grid,shape:'pointy',visible:true});
    expect(groundAtTerrain(t,at(2,3))).toBeLessThan(groundAtTerrain(t,at(3,3)));
    expect(standingGround(t,at(2,3))).toBe(standingGround(t,at(3,3)));
  });
  it('keeps a continuous tint through zero on a slope and a neutral tint on flat zero ground',()=>{
    const levels=[-10,-5,0,5,10,15];
    const rgb=(h:number)=>heightColor(h,levels).slice(1).match(/../g)!.map(c=>parseInt(c,16));
    for (const h of [-0.1,0.1]) expect(rgb(h).every((c,i)=>Math.abs(c-rgb(0)[i])<4)).toBe(true);
    expect(heightColor(0,levels)).toBe('#a8b0ba');
    for (const end of [-5,5]) {
      const midpoint=rgb(end/2);
      expect(midpoint.every((c,i)=>Math.abs(c-(rgb(0)[i]+rgb(end)[i])/2)<=1)).toBe(true);
    }
  });
  it('immediately makes an edge segment and extends it beyond half the perimeter',()=>{
    const shape=areaShape(terrainOf([area([])],grid),'hill');
    const path=initialGradientLine(shape,at(0,0),3)!;
    expect(path).toHaveLength(2);
    let long=path;
    for(const target of [at(0,-9),at(6,-10),at(8,0),at(8,9),at(0,10),at(-1,5)])
      long=dragGradient(shape,long,'end',long.at(-1)!,target,2)!;
    expect(long.length).toBeGreaterThan(4);
    expect(long.at(-1)).toEqual(at(0,5));
  });
  it('keeps an established slope under overlapping paint and makes walls at unequal edges',()=>{
    const hill={...area([line(0,0),line(8,6)]),gradientFixed:true};
    const flat=normalizeDrawing('shelf',{k:'terrain',hg:'shelf',hz:20,hr:'5',p:'6,-10,12,-10,12,10,6,10,6,-10',t:2})!;
    const original=terrainOf([hill],grid);
    for (const cover of [flat,{...flat,gradientEnabled:true,gradientFixed:true,gradient:[line(6,20),line(12,40)]}]) {
      const t=terrainOf([hill,cover],grid);
      expect(t.areas[0].gradient).toEqual(hill.gradient);
      const exposed=areaShape(t,'hill');
      expect(gradientPath(exposed,at(6.2),undefined,0.3)).toEqual([at(6)]);
      expect(gradientPath(exposed,at(7),undefined,0.3)).toBeNull();
      const newLine=gradientPath(exposed,at(6,-10),at(6,10),0.3)!;
      const height=cover.gradient?.[0].height ?? cover.hz!;
      const connected=terrainOf([{...hill,gradient:[...hill.gradient!,{id:'seam',height,path:newLine}]},cover],grid);
      expect(terrainEdges(connected).some(e=>Math.abs(e.a.x-6)<1e-6 && Math.abs(e.b.x-6)<1e-6)).toBe(false);
      expect(connected.areas[0].gradient!.slice(0,-1)).toEqual(hill.gradient);
      expect(groundAtTerrain(t,at(4))).toBe(groundAtTerrain(original,at(4)));
      expect(groundAtTerrain(t,at(7))).toBeGreaterThanOrEqual(20);
      expect(terrainEdges(t).some(e=>Math.abs(e.a.x-6)<1e-6 && Math.abs(e.b.x-6)<1e-6 && e.top>e.low)).toBe(true);
    }
  });
  it('snaps around an overpainted island and respects a matching line already assigned to its side',()=>{
    const controls=[line(0,0),line(8,6),{id:'side',height:4,path:[at(3,-3),at(3,3)]}];
    const hill={...area(controls),gradientFixed:true};
    const island=normalizeDrawing('island',{k:'terrain',hg:'island',hz:4,hr:'5',p:'3,-3,6,-3,6,3,3,3,3,-3',t:2})!;
    const t=terrainOf([hill,island],grid), shape=areaShape(t,'hill');
    expect(shape[0]).toHaveLength(2);
    expect(gradientPath(shape,at(3.2),undefined,0.3)).toEqual([at(3)]);
    expect(terrainEdges(t).some(e=>Math.abs(e.a.x-3)<1e-6 && Math.abs(e.b.x-3)<1e-6)).toBe(false);
    expect(t.areas[0].gradient).toEqual(controls);
    expect(areaShape(terrainOf([hill],grid),'hill')[0]).toHaveLength(1);
  });
  it('seeds a touching face at a 14 ft difference and skips a 15 ft rise or drop',()=>{
    const hill=normalizeDrawing('hill',{k:'rect',hz:10,p:'0,0,60,30'})!;
    const shelf=(id:string,left:number,h:number)=>normalizeDrawing(id,{k:'rect',hz:h,p:[left,-5,left+15,0].join(',')})!;
    const t=terrainOf([hill,shelf('a',0,24),shelf('b',15,25),shelf('c',30,-5),shelf('d',45,-4)],grid);
    const controls=initialBoundaryControls(t,'hill');
    expect(controls.map(c=>c.height).sort((a,b)=>a-b)).toEqual([-4,24]);
    for (const c of controls) expect(Math.abs(c.path[0].x-c.path.at(-1)!.x)).toBe(15);
  });
  it('selects a flat neighbor independently even if the gradient has no handles and matches its height',()=>{
    const hill={...area([]),gradientEnabled:true,gradientFixed:true};
    const shelf=normalizeDrawing('shelf',{k:'rect',hz:12,p:'8,-10,14,10'})!;
    expect(connectedHeight(terrainOf([hill,shelf],grid),at(11))?.ids).toEqual(['shelf']);
  });
  it('only matches the touching stretch on either side of a corner',()=>{
    const hill=area([line(0,0),line(8,6)]);
    const shelf=normalizeDrawing('shelf',{k:'rect',hz:20,p:'8,-3,12,5'})!;
    const seam=terrainOf([hill,shelf],grid).areas.find(a=>a.id==='hill')!.boundaryDefaults![0];
    expect(seam.path.map(p=>p.y).sort((a,b)=>a-b)).toEqual([-3,5]);
  });
  it('reads controls from both array and keyed database snapshots',()=>{
    const d=area([line(0,0),line(8,6)]), wire=drawingToWire(d);
    expect(normalizeDrawing('hill',wire)?.gradient).toEqual(d.gradient);
    const keyed=Object.fromEntries(d.gradient!.map((c,i)=>[i,{...c,path:{...c.path}}]));
    expect(normalizeDrawing('hill',{...wire,gradient:keyed})?.gradient).toEqual(d.gradient);
  });
});


describe('filling selected terrain holes',()=>{
  const box=(x:number,y:number,w:number,h:number):[number,number][]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
  for(const gradient of [false,true]) it('fills only bare enclosed ground on '+(gradient?'a gradient':'flat terrain'),()=>{
    const base=normalizeDrawing('base',{...patchStroke([box(0,0,60,40),box(5,5,15,15),box(30,5,10,10)],'base',15),
      gradientEnabled:gradient,gradient:gradient ? [{id:'a',path:[at(0,22)],height:10},{id:'b',path:[at(60,30)],height:30}] : undefined,t:1})!;
    const island=normalizeDrawing('i',{...patchStroke([box(9,9,5,5)],'island',0),t:2})!;
    const notch=normalizeDrawing('n',{...patchStroke([box(45,20,20,5)],'base',null),t:3})!;
    const initial=[base,island,notch], t=terrainOf(initial,grid);
    const apply=(all:boolean)=>{
      const edits=fillTerrainHoles(t,['base'],undefined,all).map((d,i)=>normalizeDrawing('e'+i,{...d,t:4})!);
      return terrainOf([...initial,...edits],grid);
    };
    expect(terrainHoleOptions(t,['base'])).toEqual({bare:true,all:gradient});
    const normal=apply(false);
    expect(terrainHoleOptions(normal,['base'])).toEqual({bare:false,all:gradient});
    expect(groundAtTerrain(normal,at(6,6))).toBeGreaterThan(0);
    expect(groundAtTerrain(normal,at(32,7))).toBeGreaterThan(0);
    expect(groundAtTerrain(normal,at(11,11))).toBe(0);
    expect(groundAtTerrain(normal,at(58,22))).toBe(0);
    if (gradient) {
      const all=apply(true);
      expect(slopeAt(all,at(11,11))).toBeDefined();
      expect(groundAtTerrain(all,at(58,22))).toBe(0);
      expect(fillTerrainHoles(all,['base'],undefined,true)).toHaveLength(0);
      expect(terrainHoleOptions(all,['base'])).toEqual({bare:false,all:false});
    }
  });
});

it('joins equal-height border fragments along the outline and preserves explicit edits to old fragments',()=>{
  const hill=normalizeDrawing('hill',{k:'rect',hz:12,p:'0,0,60,30',gradientEnabled:true,t:1})!;
  const neighbor=(id:string,left:number,right:number,h=25)=>normalizeDrawing(id,{k:'rect',hz:h,p:[left,-5,right,0].join(','),t:2})!;
  const ground=[neighbor('one',0,16),neighbor('two',18,36),neighbor('three',36,50),neighbor('four',50,60,10)];
  const controls=(d=hill)=>terrainOf([d,...ground],grid).areas.find(a=>a.id==='hill')!.gradient!;
  const lines=controls();
  expect(lines.map(c=>c.height).sort()).toEqual([10,25]);
  const joined=lines.find(c=>c.height===25)!;
  expect(joined.path.every(p=>p.y===0)).toBe(true);
  expect(Math.abs(joined.path[0].x-joined.path.at(-1)!.x)).toBe(50);
  const changed=controls({...hill,gradient:[{...joined,height:18,boundary:'height'}]});
  expect(changed.find(c=>c.height===18)?.path).toEqual(joined.path);
  const older=controls({...hill,gradient:[{id:'join:two:0',height:13,path:[at(18),at(36)],boundary:'height'}]});
  expect(older.find(c=>c.height===13)?.path).toEqual([at(18),at(36)]);
});

describe('terrain painting at a shared boundary',()=>{
  const maps=[{x:0,y:-10,w:30,h:20}];
  const rect=(id:string,p:string,h:number,gradient?:GradientControl[])=>normalizeDrawing(id,{k:'rect',p,hz:h,gradient,gradientFixed:!!gradient})!;
  it('matches a variable line after a neighbor changes and leaves no seam wall',()=>{
    for(const high of [20,35]) {
      const ramp=rect('ramp','0,-10,8,10',0,[
        {id:'low',height:0,path:[at(0,-10),at(8,-10)]},
        {id:'high',height:high,path:[at(0,10),at(8,10)]}
      ]);
      const joined=rect('hill','8,-10,16,10',5,[{...line(8,5),match:true}]);
      const t=terrainOf([ramp,joined],grid);
      for(const y of [-9,-2,4,9]) {
        expect(groundAtTerrain(t,at(8.001,y))).toBeCloseTo((y+10)*high/20,3);
      }
      expect(terrainEdges(t).filter(e=>e.a.x===8 && e.b.x===8)).toHaveLength(0);
      expect(joined.gradient![0].path).toHaveLength(2);
    }
  });
  it('keeps bucket fill inside the clicked component and the map',()=>{
    const divider=rect('divider','12,-10,14,10',0,[line(12,2),line(14,8)]);
    const t=terrainOf([divider],grid),left=bucketRegion(t,at(4),maps)!;
    expect(inRegion(left,at(11))).toBe(true);
    for(const x of [-1,13,22]) expect(inRegion(left,at(x))).toBe(false);
    expect(bucketRegion(t,at(13),maps)).toBeUndefined();
  });
  it('adds brush area to an existing gradient across younger paint, retaining its controls',()=>{
    const hill=rect('hill','0,-10,8,10',0,[line(0,0),line(8,10)]);
    const paint=normalizeDrawing('paint',{...patchStroke([[[8,-10],[16,-10],[16,10],[8,10],[8,-10]]],'flat',35),t:1})!;
    const edits=extendGradient(terrainOf([hill,paint],grid),'hill',[at(7),at(12)],3,false,maps);
    const t=terrainOf([hill,paint,...edits.map((e,i)=>normalizeDrawing('brush'+i,{...e,t:2})!)],grid);
    expect(t.areas.find(a=>a.id==='hill')!.gradient).toEqual(hill.gradient);
    expect(groundAtTerrain(t,at(11))).toBeLessThan(11);
    expect(groundAtTerrain(t,at(11,5))).toBe(35);
  });
});
