import { describe, it, expect } from 'vitest';
import { analyzeHeightMap, draftHeights, heightPolygons, UNPAINTED } from '../src/core/autoHeight';
import { inRegion } from '../src/core/terrainEdges';

const width = 96, height = 72;
function art(pixel: (x:number,y:number) => number[]) {
  const data = new Uint8ClampedArray(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) data.set(pixel(x,y),4*(y*width+x));
  return analyzeHeightMap({width,height,data});
}
const mark = (x:number,y:number,height:number) => ({x,y,height});

describe('auto height map', () => {
  it('fills texture holes in a local patch and leaves its exterior open', () => {
    const m = art((x,y) => x>15 && x<80 && y>10 && y<61 && !(Math.abs(x-45)<3 && Math.abs(y-32)<3)
      ? [62,140,200,255] : [160,145,80,255]);
    const labels = draftHeights(m,[mark(30,26,-10)],false);
    expect(labels[32*width+45]).toBe(-10);
    expect(labels[30*width+4]).toBe(UNPAINTED);
    expect(heightPolygons(labels,width)).toHaveLength(1);
  });
  it('keeps the repeated colour on either side of a ridge independently editable', () => {
    const m = art((x,y) => x>53 && x<59 ? [50,32,28,255] : [180,145+(x+y)%6,100,255]);
    const labels = draftHeights(m,[mark(21,30,0),mark(69,40,30)],true);
    for (const y of [5,34,65]) {
      expect(labels[y*width+50]).toBe(0);
      expect(labels[y*width+60]).toBe(30);
    }
    expect(labels.includes(UNPAINTED)).toBe(false);
  });
  it('preserves marked islands, transparent holes and the picture edge in saved polygons', () => {
    const m = art((x,y) => x>=30 && x<35 && y>=30 && y<35 ? [0,0,0,0] :
      Math.hypot(x-50,y-35)<9 ? [20,22,25,255] : [160,155,150,255]);
    const labels = draftHeights(m,[mark(4,4,20),mark(50,35,0)],true);
    const patches = heightPolygons(labels,width);
    expect(patches).toHaveLength(2);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const got = patches.filter(p => inRegion(p.polygon,{x:x+.5,y:y+.5}));
      expect(got.map(p=>p.height)).toEqual(m.opaque[y*width+x] ? [labels[y*width+x]] : []);
    }
  });
});
