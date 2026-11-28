import type { Drawing, GridSettings, Rect } from '../types';
import { zonesOf, spellGroundSampler } from '../core/height';
import type { Seg } from '../core/walls';
import { spellPicture, type PictureRequest, type SpellPicture } from '../core/spellPicture';
import type { SpellWorld } from '../core/spellVolume';
export interface SpellScene {
  segs: Seg[];
  openings: Seg[];
  draws: Drawing[];
  maps: Rect[];
  grid: GridSettings;
  steppedGround: boolean;
}
let grid: GridSettings, world: SpellWorld;
// The live gridless boundary can contain thousands of little triangles. Bake
// it here so a pointer move costs a single texture draw on the board.
let previewCanvas:OffscreenCanvas|undefined, skinCanvas:OffscreenCanvas|undefined;
function composePreview(p:SpellPicture,color:string) {
  if(typeof OffscreenCanvas==='undefined')return;
  const img=p.surface, size=160;
  previewCanvas ??= new OffscreenCanvas(size,size);
  skinCanvas ??= new OffscreenCanvas(img.cols,img.rows);
  if(skinCanvas.width!==img.cols)skinCanvas.width=img.cols;
  if(skinCanvas.height!==img.rows)skinCanvas.height=img.rows;
  const ctx=previewCanvas.getContext('2d',{willReadFrequently:true}), skin=skinCanvas.getContext('2d');
  if(!ctx || !skin || !img.w || !img.h)return;
  skin.putImageData(new ImageData(img.rgba as Uint8ClampedArray<ArrayBuffer>,img.cols,img.rows),0,0);
  ctx.resetTransform();ctx.clearRect(0,0,size,size);
  ctx.globalAlpha=.46;ctx.drawImage(skinCanvas,0,0,size,size);
  ctx.setTransform(size/img.w,0,0,size/img.h,-img.x*size/img.w,-img.y*size/img.h);
  ctx.beginPath();
  for(let i=0;i<p.fill.length;i+=4)ctx.rect(p.fill[i],p.fill[i+1],p.fill[i+2]-p.fill[i],p.fill[i+3]-p.fill[i+1]);
  for(let i=0;i<p.triangles.length;i+=6){
    const t=p.triangles;
    ctx.moveTo(t[i],t[i+1]);ctx.lineTo(t[i+2],t[i+3]);ctx.lineTo(t[i+4],t[i+5]);ctx.closePath();
  }
  ctx.globalAlpha=.45;ctx.fillStyle=color;ctx.fill();
  ctx.beginPath();
  for(let i=0;i<p.contact.length;i+=4){const t=p.contact;ctx.moveTo(t[i],t[i+1]);ctx.lineTo(t[i+2],t[i+3]);}
  ctx.strokeStyle='#ffffff';ctx.lineWidth=Math.max(img.w,img.h)/size*.8;ctx.globalAlpha=.9;ctx.stroke();
  return {...img,cols:size,rows:size,rgba:ctx.getImageData(0,0,size,size).data};
}
self.onmessage = ({
  data
}: {
  data: {
    scene?: SpellScene;
    req?: PictureRequest;
  };
}) => {
  if (data.scene) {
    const s = data.scene;
    grid = s.grid;
    const terrain = zonesOf(s.draws, grid);
    world = {
      segs: s.segs,
      openings: s.openings,
      maps: s.maps,
      steppedGround: s.steppedGround,
      ground: terrain.areas.length ? spellGroundSampler(terrain) : undefined
    };
  }
  if (!data.req) return;
  const picture = spellPicture(data.req, grid, world);
  const {fast,cover,spell,color}=data.req;
  if (!cover && !picture.solid && (fast || (spell.k==='emanation' && spell.spell?.stick))) {
    const composite=composePreview(picture,color);
    if (composite && fast) { picture.surface=composite; picture.composed=true; }
    else if (composite) picture.movingSurface=composite;
  }
  const buffers=[picture.triangles.buffer,picture.fill.buffer,picture.outline.buffer,picture.wire.buffer,picture.contact.buffer,picture.surface.rgba.buffer];
  if (picture.movingSurface) buffers.push(picture.movingSurface.rgba.buffer);
  self.postMessage(picture, {
    transfer: buffers
  });
};
