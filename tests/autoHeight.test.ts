import { describe, it, expect } from 'vitest';
import { analyzeHeightMap, draftHeights, heightPolygons, UNPAINTED } from '../src/core/autoHeight';
import clip from 'polygon-clipping';
import { regionContacts, regionControls } from '../src/core/autoSlopes';
import { DEFAULT_GRID, normalizeDrawing } from '../src/core/model';
import { groundAtTerrain, terrainOf, surfaceHeight } from '../src/core/terrain';
import { inRegion, patchStroke, terrainEdges } from '../src/core/terrainEdges';

const width = 96, height = 72;
function art(pixel: (x:number,y:number) => number[]) {
  const data = new Uint8ClampedArray(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) data.set(pixel(x,y),4*(y*width+x));
  return analyzeHeightMap({width,height,data});
}
const mark = (x:number,y:number,height:number) => ({x,y,height});

describe('auto height map', () => {
  it('fills texture holes in a local patch and gives its exterior an explicit base height', () => {
    const m = art((x,y) => x>15 && x<80 && y>10 && y<61 && !(Math.abs(x-45)<3 && Math.abs(y-32)<3)
      ? [62,140,200,255] : [160,145,80,255]);
    const labels = draftHeights(m,[mark(30,26,-10)]);
    expect(labels[32*width+45]).toBe(-10);
    expect(labels[30*width+4]).toBe(0);
    expect(labels.includes(UNPAINTED)).toBe(false);
    expect(heightPolygons(labels,width)).toHaveLength(2);
  });
  it('keeps the repeated colour on either side of a ridge independently editable', () => {
    const m = art((x,y) => x>53 && x<59 ? [50,32,28,255] : [180,145+(x+y)%6,100,255]);
    const labels = draftHeights(m,[mark(21,30,0),mark(69,40,30)]);
    for (const y of [5,34,65]) {
      expect(labels[y*width+50]).toBe(0);
      expect(labels[y*width+60]).toBe(30);
    }
    expect(labels.includes(UNPAINTED)).toBe(false);
  });
  it('turns the original curved region into a slope only along a chosen contact', () => {
    const m=art((x,y)=>Math.hypot(x-46,y-34)<21 ? [53,120,42,255] : [130,85,47,255]);
    const marks=[mark(46,34,10),mark(6,34,0)];
    const patches=heightPolygons(draftHeights(m,marks),width);
    const island=patches.findIndex(p=>p.height===10), outside=1-island;
    const original=JSON.stringify(patches);
    const bare=terrainOf([],DEFAULT_GRID), contacts=regionContacts(patches,bare);
    const [smooth,wall]=contacts(island);
    expect(smooth.path.length).toBeGreaterThan(4);
    expect(contacts(outside).map(c=>c.key).sort()).toEqual([smooth.key,wall.key].sort());
    const enabled=new Set([island]), matched=new Set([smooth.key]);
    const controls=regionControls(patches[island],contacts(island),matched,enabled,marks,bare,1);
    const drawings=patches.map((p,i)=>normalizeDrawing(String(i),{
      ...patchStroke(p.polygon,String(i),p.height),...(i===island && {gradient:controls,gradientEnabled:true,gradientFixed:true})
    })!);
    const terrain=terrainOf(drawings,DEFAULT_GRID);
    const inner=(c:typeof smooth,f:number)=>{
      const p=c.path[Math.floor(c.path.length/2)];
      return {x:p.x+(46-p.x)*f,y:p.y+(34-p.y)*f};
    };
    expect(groundAtTerrain(terrain,marks[0])).toBe(10);
    expect(groundAtTerrain(terrain,inner(smooth,.001))).toBeLessThan(.1);
    expect(groundAtTerrain(terrain,inner(smooth,.5))).toBeGreaterThan(1);
    expect(groundAtTerrain(terrain,inner(wall,.001))).toBeGreaterThan(1);
    expect(groundAtTerrain(terrain,inner(wall,-.01))).toBe(0);
    enabled.add(outside);
    for (const i of enabled) {
      const cs=regionControls(patches[i],contacts(i),matched,enabled,marks,bare,1);
      expect(cs.find(c=>c.path.length>1)?.height).toBe(5);
    }
    expect(JSON.stringify(patches)).toBe(original);
  });
  it('matches a previously painted sloping bank along a shared edge without creating a wall',()=>{
    const polygon:clip.Polygon=[[[0,0],[40,0],[40,60],[0,60]]];
    const bank=normalizeDrawing('bank',{...patchStroke(polygon,'bank',0),gradientFixed:true,gradientEnabled:true,
      gradient:[{id:'a',height:0,path:[{x:30,y:4}]},{id:'b',height:10,path:[{x:23,y:57}]}]})!;
    const old=terrainOf([bank],DEFAULT_GRID);
    const patch={height:7,polygon:[[[40,0],[100,0],[100,60],[40,60]]] as clip.Polygon};
    const contacts=regionContacts([patch],old)(0);
    const gradient=regionControls(patch,contacts,new Set(contacts.map(c=>c.key)),new Set([0]),[],old,1);
    const saved=normalizeDrawing('draft',{...patchStroke(patch.polygon,'draft',7),gradient,gradientEnabled:true,gradientFixed:true})!;
    const terrain=terrainOf([bank,saved],DEFAULT_GRID);
    for(let y=.3;y<60;y+=1.7) {
      const at={x:40,y};
      expect(Math.abs(surfaceHeight(terrain.areas.find(a=>a.id==='draft')!,at)-surfaceHeight(old.areas[0],at))).toBeLessThan(.001);
    }
    expect(terrainEdges(terrain).filter(e=>e.a.x===40 && e.b.x===40)).toHaveLength(0);
  });
  it('covers transparent gaps and preserves marked islands up to the picture edge in saved polygons', () => {
    const m = art((x,y) => x>=30 && x<35 && y>=30 && y<35 ? [0,0,0,0] :
      Math.hypot(x-50,y-35)<9 ? [20,22,25,255] : [160,155,150,255]);
    const labels = draftHeights(m,[mark(4,4,20),mark(50,35,0)]);
    const patches = heightPolygons(labels,width);
    expect(patches).toHaveLength(2);
    expect(labels[31*width+31]).toBe(20);
    const coverage = clip.union(patches[0].polygon,...patches.slice(1).map(p=>p.polygon));
    expect(clip.difference([[[0,0],[width,0],[width,height],[0,height]]],coverage)).toEqual([]);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const got = patches.filter(p => inRegion(p.polygon,{x:x+.5,y:y+.5}));
      expect(got.map(p=>p.height)).toEqual([labels[y*width+x]]);
    }
  });
});
