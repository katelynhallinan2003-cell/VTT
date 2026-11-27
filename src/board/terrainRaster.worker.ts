import {paintTerrain} from './terrainRaster';
import type {Terrain} from '../core/terrain';

let mask:OffscreenCanvas;
self.onmessage=({data}:{data:{terrain:Terrain;selected:Set<string>}})=>{
  const raster=paintTerrain(data.terrain,data.selected,(w,h)=>{
    if (!mask || mask.width!==w || mask.height!==h) mask=new OffscreenCanvas(w,h);
    return mask.getContext('2d',{willReadFrequently:true})!;
  });
  self.postMessage(raster,{transfer:[raster.out.data.buffer]});
};
