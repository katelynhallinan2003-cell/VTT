import type { Drawing, GridSettings, Rect } from '../types';
import { zonesOf, groundAt } from '../core/height';
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
  const frame=skin.createImageData(img.cols,img.rows);
  frame.data.set(img.rgba);skin.putImageData(frame,0,0);
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
  p.surface={...img,cols:size,rows:size,rgba:ctx.getImageData(0,0,size,size).data};
  p.composed=true;
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
    const memo = new Map<number, Map<number, number>>();
    let count = 0;
    world = {
      segs: s.segs,
      openings: s.openings,
      maps: s.maps,
      steppedGround: s.steppedGround,
      ground: terrain.areas.length ? p => {
        if (count >= 250000) {
          memo.clear();
          count = 0;
        }
        let row = memo.get(p.x);
        if (!row) memo.set(p.x, row = new Map());
        let z = row.get(p.y);
        if (z === undefined) {
          z = groundAt(terrain, p);
          row.set(p.y, z);
          count++;
        }
        return z;
      } : undefined
    };
  }
  if (!data.req) return;
  const picture = spellPicture(data.req, grid, world);
  if(data.req.fast && !data.req.cover && !picture.solid)composePreview(picture,data.req.color);
  self.postMessage(picture, {
    transfer: [picture.triangles.buffer,picture.fill.buffer, picture.outline.buffer, picture.wire.buffer, picture.contact.buffer, picture.surface.rgba.buffer]
  });
};
