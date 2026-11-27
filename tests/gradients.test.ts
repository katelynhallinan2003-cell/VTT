import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, drawingToWire, normalizeDrawing } from '../src/core/model';
import { gradientCutsForPaint, storedControls } from '../src/core/gradientBoundaries';
import { dragGradient, gradientPath, initialGradientLine } from '../src/core/gradientGeometry';
import { groundAtTerrain, slopeAt, standingGround, terrainOf } from '../src/core/terrain';
import { areaShape, terrainEdges, fillTerrainHoles, patchStroke } from '../src/core/terrainEdges';
import { movementCost } from '../src/core/movementCost';
import type { Seg } from '../src/core/walls';
import type { GradientControl, Vec } from '../src/types';

const grid={...DEFAULT_GRID,cell:5,ft:5,rule:'euclid' as const};
const at=(x:number,y=0) => ({x,y});
const line=(x:number,height:number): GradientControl => ({id:String(x),height,path:[at(x,-10),at(x,10)]});
const area=(gradient: GradientControl[]) => normalizeDrawing('hill',{k:'rect',hz:12,p:'0,-10,8,10',gradient})!;

describe('editable gradients',()=>{
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
  it('cuts the actual gradient and follows a neighboring flat height until overridden',()=>{
    const hill=area([line(0,0),line(8,6)]);
    const flat=normalizeDrawing('shelf',{k:'terrain',hg:'shelf',hz:20,hr:'5',p:'6,-10,12,-10,12,10,6,10,6,-10',t:2})!;
    const cuts=gradientCutsForPaint([hill],[flat],grid).map((d,i)=>normalizeDrawing('cut'+i,{...d,t:3})!);
    expect(cuts.length).toBe(1);
    const edited=terrainOf([hill,flat,...cuts],grid);
    const slope=edited.areas.find(a=>a.id==='hill')!;
    const seam=slope.boundaryDefaults![0];
    expect(seam.height).toBe(20);
    expect(seam.path.every(p=>p.x===6)).toBe(true);
    expect(slope.gradient!.some(c=>c.id==='8')).toBe(false);
    const seamWalls=(t:typeof edited)=>terrainEdges(t).filter(e=>Math.abs(e.a.x-6)<1e-6 && Math.abs(e.b.x-6)<1e-6);
    expect(seamWalls(edited)).toHaveLength(0);
    const raised={...flat,hz:25};
    expect(terrainOf([hill,raised,...cuts],grid).areas[0].boundaryDefaults![0].height).toBe(25);
    const gradient=storedControls([seam],slope.gradient!.map(c=>c===seam || c.id===seam.id ? {...c,height:15} : c),hill.gradient!);
    const changed=terrainOf([{...hill,gradient},raised,...cuts],grid);
    expect(seamWalls(changed).every(e=>e.low===15 && e.top===25)).toBe(true);
    expect(seamWalls(changed).length).toBeGreaterThan(0);
    expect(groundAtTerrain(terrainOf([hill,...cuts],grid),at(7))).toBe(0);
    expect(groundAtTerrain(terrainOf([hill],grid),at(7))).toBeGreaterThan(0);
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
    const normal=apply(false);
    expect(groundAtTerrain(normal,at(6,6))).toBeGreaterThan(0);
    expect(groundAtTerrain(normal,at(32,7))).toBeGreaterThan(0);
    expect(groundAtTerrain(normal,at(11,11))).toBe(0);
    expect(groundAtTerrain(normal,at(58,22))).toBe(0);
    if (gradient) {
      const all=apply(true);
      expect(slopeAt(all,at(11,11))).toBeDefined();
      expect(groundAtTerrain(all,at(58,22))).toBe(0);
      expect(fillTerrainHoles(all,['base'],undefined,true)).toHaveLength(0);
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
