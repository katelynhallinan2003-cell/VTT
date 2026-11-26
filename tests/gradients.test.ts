import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, drawingToWire, normalizeDrawing } from '../src/core/model';
import { gradientPath } from '../src/core/gradientGeometry';
import { groundAtTerrain, slopeAt, standingGround, terrainOf } from '../src/core/terrain';
import { areaShape, terrainEdges } from '../src/core/terrainEdges';
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
  it('reads controls from both array and keyed database snapshots',()=>{
    const d=area([line(0,0),line(8,6)]), wire=drawingToWire(d);
    expect(normalizeDrawing('hill',wire)?.gradient).toEqual(d.gradient);
    const keyed=Object.fromEntries(d.gradient!.map((c,i)=>[i,{...c,path:{...c.path}}]));
    expect(normalizeDrawing('hill',{...wire,gradient:keyed})?.gradient).toEqual(d.gradient);
  });
});
