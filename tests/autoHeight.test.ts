import { describe, it, expect } from 'vitest';
import { analyzeHeightMap, draftHeights, heightPolygons, UNPAINTED } from '../src/core/autoHeight';
import clip from 'polygon-clipping';
import { inRegion } from '../src/core/terrainEdges';

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
