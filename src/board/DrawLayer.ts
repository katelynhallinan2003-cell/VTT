import {floorLines,spellOutline,spellPicture,trimSpellCell} from '../core/spellPicture';
import type {PictureView} from './SpellPainter';
import clip, {type MultiPolygon, type Polygon, type Pair} from 'polygon-clipping';
import { spellVolume, type SpellWorld } from '../core/spellVolume';
import { rectContains } from '../core/geometry';
import { Container, Graphics, Text, Texture, CanvasSource } from 'pixi.js';
import { LINE_H, beamWidthPx, templateWidthPx, footprintPoly, boundsOf, dashSegments, drawingBounds, fontStack, isTemplate, parsePts, textMetrics } from '../core/draw';
import { cellPoly } from '../core/cells';
import type { DrawKind, Drawing, GridSettings, Vec } from '../types';

const hex = (c: string) => parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0;

/** Everything needed to paint one shape (a saved drawing, or one still being dragged out). */
export interface Shape {
  k: DrawKind;
  pts: Vec[];
  color: string;
  w: number;
  fill: number;
  /** fill colour; empty = the outline colour */
  fc?: string;
  dash: boolean;
  bw: number;
  spell?: Drawing['spell'];
  /** width of the creature an emanation comes out of, in feet */
  of?: number;
}

export const shapeOf = (d: Drawing): Shape => ({ k: d.k, pts: parsePts(d.p), color: d.color, w: d.w, fill: d.fill, fc: d.fc, dash: d.dash, bw: d.bw, of: d.of, spell:d.spell });

/** Default opacity of a spell template's area. */
export const TEMPLATE_FILL = 0.28;

function polyline(g: Graphics, pts: Vec[]) {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
}

/** Pixi has no dashed strokes, so a dashed line is a run of short segments in one path. */
function dashed(g: Graphics, pts: Vec[], w: number, cell: number) {
  const dash = Math.max(w * 2.4, cell * 0.1);
  for (const [a, b] of dashSegments(pts, dash, dash * 0.8)) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
}

function ellipsePts(cx: number, cy: number, rx: number, ry: number): Vec[] {
  const n = 72;
  return Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos((i / n) * Math.PI * 2) * rx, y: cy + Math.sin((i / n) * Math.PI * 2) * ry }));
}

/** A single GPU texture per displayed spell. Its pixels change when the solver
 * finishes a new view, independently of how often overlays are repainted. */
export class SpellTexture {
  private canvas?:HTMLCanvasElement;
  private texture?:Texture<CanvasSource>;
  private staging?:HTMLCanvasElement;
  constructor(private size=256){}
  private image?:import('../core/spellSurface').SurfaceImage;
  draw(g:Graphics,img:import('../core/spellSurface').SurfaceImage,alpha:number){
    if(!this.canvas){
      this.canvas=document.createElement('canvas');
      this.canvas.width=this.canvas.height=this.size;
      this.staging=document.createElement('canvas');
      const source=new CanvasSource({resource:this.canvas,width:this.size,height:this.size,resolution:1,scaleMode:'linear'});
      this.texture=new Texture({source});
    }
    if(this.image!==img){
      // Keep the GPU allocation fixed throughout a drag. Resizing a live
      // canvas source can invalidate an upload already queued by WebGL.
      const tile=this.staging!;
      tile.width=img.cols;tile.height=img.rows;
      const src=tile.getContext('2d')!,frame=src.createImageData(img.cols,img.rows);
      frame.data.set(img.rgba);src.putImageData(frame,0,0);
      const ctx=this.canvas.getContext('2d')!;
      ctx.clearRect(0,0,this.size,this.size);
      ctx.drawImage(tile,0,0,this.size,this.size);
      this.texture!.source.update();
      this.image=img;
    }
    g.rect(img.x,img.y,img.w,img.h).fill({texture:this.texture!,textureSpace:'local',alpha});
  }
  get allocated(){return !!this.texture;}
  release(){
    this.image=undefined;
    this.texture?.source.unload();
  }
  destroy(){this.texture?.destroy(true);this.texture=undefined;this.image=undefined;this.canvas=undefined;this.staging=undefined;}
}

/** Paint a shape onto a Graphics object. Text is handled separately by DrawLayer. */
export function paintShape(g: Graphics, s: Shape, grid: GridSettings, alpha = 1, cover = false, world:SpellWorld={segs:[]}, outlineWidth?:number, view?:PictureView, surface?:SpellTexture) {
  const pts = s.pts;
  if (!pts.length) return;
  const col = hex(s.color);
  const fcol = s.fc ? hex(s.fc) : col;
  const stroke = { width: s.w, color: col, alpha, cap: 'round' as const, join: 'round' as const };

  if (isTemplate(s.k)) {
    if (pts.length < 2) return;
    const hexShape = grid.shape === 'square' ? undefined : grid.shape;
    const widthPx = templateWidthPx(grid, { k: s.k, bw: s.bw, of: s.of });
    const maps=world.maps ?? [];
    const volume=spellVolume(s,pts[0],pts[1],grid,{...world,segs:[]});
    const fillA=(s.fill || TEMPLATE_FILL)*alpha;
    // Only clip geometry that straddles the edge of a map.
    let playable:MultiPolygon|undefined;
    const paint=(poly:Vec[],fill:number|null,line=0,hole?:Vec[])=>{
      const ring=(points:Vec[])=>points.map(({x,y}):Pair=>[x,y]);
      const subject:Polygon=[ring(poly)];
      if(hole) subject.push(ring(hole));
      let pieces:MultiPolygon=[subject];
      if(maps.length && !maps.some(r=>poly.every(p=>rectContains(r,p)))) {
        if(!playable) {
          const cuts=maps.map(({x,y,w,h}):Polygon=>[[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]]);
          playable=clip.union(cuts[0],...cuts.slice(1));
        }
        pieces=clip.intersection(subject,playable);
      }
      for(const piece of pieces) for(let i=0;i<piece.length;i++) {
        g.poly(piece[i].flat(),true);
        if(line) g.stroke({...stroke,width:line});
        else if(i) g.cut();
        else if(fill!=null) g.fill({color:fcol,alpha:fill});
      }
    };
    const outline=spellOutline(volume);
    const req={color:s.color,spell:{k:s.k,bw:s.bw,of:s.of,spell:s.spell},a:pts[0],b:pts[1],cover,fast:false};
    const picture=view ? view.picture : spellPicture(req,grid,world);
    const current=!view || view.current;
    const lines=(parts:Float32Array,width:number,color:number,opacity:number)=>{
      if(!parts.length)return;
      for(let i=0;i<parts.length;i+=4) g.moveTo(parts[i],parts[i+1]).lineTo(parts[i+2],parts[i+3]);
      g.stroke({width,color,alpha:opacity,cap:'round',join:'round'});
    };
    // The moving silhouette is cheap enough to cut against the ground immediately,
    // even while the worker is still finding the affected cells around walls.
    const skin=current && picture ? picture : floorLines(volume,grid,world,s.spell?.elevation!==false,true);
    const rim=(width:number,opacity=alpha)=>lines(skin.outline,width,col,opacity);
    if(outlineWidth!==undefined) {
      rim(outlineWidth,alpha*.7);
      if(s.k==='emanation') paint(footprintPoly(pts[0],widthPx,hexShape),null,outlineWidth);
      return;
    }
    const groundInk=Math.min(1,fillA*1.6);
    if(picture?.composed && surface){
      surface.draw(g,picture.surface,Math.min(1,fillA/TEMPLATE_FILL));
      rim(Math.max(1.5,s.w*.65),alpha*.45);
      paint(ellipsePts(pts[0].x,pts[0].y,Math.max(3,s.w*1.2),Math.max(3,s.w*1.2)),alpha);
      return;
    }
    if(picture && surface)surface.draw(g,picture.surface,Math.min(.65,fillA*1.65));
    if(picture && !picture.solid) {
      const lit=groundInk;
      const paintCells=(poly:Vec[])=>{
        if(s.k==='beam')poly=trimSpellCell(poly,pts[0],volume.axis);
        if(poly.length>=3) paint(poly,lit);
      };
      const data=picture.fill;
      if(picture.hex) {
        for(let i=0;i<data.length;i+=2) paintCells(cellPoly(grid,{x:data[i],y:data[i+1]}));
      } else for(let i=0;i<data.length;i+=4) {
        const left=data[i],top=data[i+1],right=data[i+2],bottom=data[i+3];
        paintCells([{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}]);
      }
      const tris=picture.triangles;
      if(tris.length){
        for(let i=0;i<tris.length;i+=6)g.moveTo(tris[i],tris[i+1]).lineTo(tris[i+2],tris[i+3]).lineTo(tris[i+4],tris[i+5]).closePath();
        g.fill({color:fcol,alpha:lit});
      }
    } else if(picture?.solid) {
      paint(outline,groundInk,0,s.k==='emanation' ? footprintPoly(pts[0],widthPx,hexShape) : undefined);
    }
    rim(Math.max(1.5,s.w*.65),picture ? alpha*.60 : alpha);
    if(!picture) lines(skin.wire,Math.max(1,s.w*.55),col,alpha*.65);
    if(picture){
      // A lighter line inside a spell-coloured edge distinguishes the ground cut
      // from both the spell outline and the boundary of covered grid squares.
      lines(picture.contact,Math.max(2.5,s.w*.9),col,alpha*.95);
      lines(picture.contact,Math.max(1,s.w*.35),0xffffff,alpha*.9);
    }
    if(s.k==='emanation') paint(footprintPoly(pts[0],widthPx,hexShape),null,Math.max(1.5,s.w*.6));
    else paint(ellipsePts(pts[0].x,pts[0].y,Math.max(3,s.w*1.2),Math.max(3,s.w*1.2)),alpha);
    return;
  }

  switch (s.k) {
    case 'pen': {
      if (pts.length === 1 || (pts.length === 2 && pts[0].x === pts[1].x && pts[0].y === pts[1].y)) {
        g.circle(pts[0].x, pts[0].y, s.w / 2).fill({ color: col, alpha });
        return;
      }
      if (s.dash) { dashed(g, pts, s.w, grid.cell); g.stroke(stroke); return; }
      g.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 2) g.lineTo(pts[1].x, pts[1].y);
      else {
        // smooth the stroke by curving through the midpoints between samples
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
      g.stroke(stroke);
      return;
    }
    case 'line':
    case 'arrow': {
      if (pts.length < 2) return;
      const [a, b] = pts;
      if (s.dash) { dashed(g, [a, b], s.w, grid.cell); g.stroke(stroke); } else { g.moveTo(a.x, a.y).lineTo(b.x, b.y); g.stroke(stroke); }
      if (s.k === 'arrow') {
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L < 1) return;
        const ux = (b.x - a.x) / L;
        const uy = (b.y - a.y) / L;
        const head = Math.min(L * 0.6, Math.max(s.w * 4.5, grid.cell * 0.28));
        const wing = head * 0.5;
        g.poly([b.x, b.y, b.x - ux * head - uy * wing, b.y - uy * head + ux * wing, b.x - ux * head + uy * wing, b.y - uy * head - ux * wing]).fill({ color: col, alpha });
      }
      return;
    }
    case 'rect': {
      if (pts.length < 2) return;
      const x = Math.min(pts[0].x, pts[1].x), y = Math.min(pts[0].y, pts[1].y);
      const w = Math.abs(pts[1].x - pts[0].x), h = Math.abs(pts[1].y - pts[0].y);
      if (s.fill > 0) g.rect(x, y, w, h).fill({ color: fcol, alpha: s.fill * alpha });
      if (s.dash) { dashed(g, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }], s.w, grid.cell); g.stroke(stroke); } else g.rect(x, y, w, h).stroke(stroke);
      return;
    }
    case 'ellipse': {
      if (pts.length < 2) return;
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      const rx = Math.max(0.5, Math.abs(pts[1].x - pts[0].x) / 2), ry = Math.max(0.5, Math.abs(pts[1].y - pts[0].y) / 2);
      if (s.fill > 0) g.ellipse(cx, cy, rx, ry).fill({ color: fcol, alpha: s.fill * alpha });
      if (s.dash) { dashed(g, ellipsePts(cx, cy, rx, ry), s.w, grid.cell); g.stroke(stroke); } else g.ellipse(cx, cy, rx, ry).stroke(stroke);
      return;
    }
  }
}

interface Item { root: Container; g: Graphics; text: Text | null; sig: string; surface:SpellTexture }

/** All saved drawings, kept as one Graphics (or Text) per drawing and only repainted when that drawing changes. */
export class DrawLayer {
  readonly container = new Container();
  private items = new Map<string, Item>();
  private grid = '';
  private freeSurfaces:SpellTexture[]=[];

  invalidate(id:string){const item=this.items.get(id);if(item)item.sig='';}

  constructor(private picture?:(id:string,s:Shape)=>PictureView,private forget?:(id:string)=>void){}

  sync(list: Drawing[], grid: GridSettings, textRes: number, cover = false, walls?: SpellWorld & {rev:string}) {
    const gridSig = `${grid.shape}|${grid.cell}|${grid.ft}|${grid.ox}|${grid.oy}|${cover}|${walls?.rev ?? 0}`;
    const gridChanged = gridSig !== this.grid;
    this.grid = gridSig;
    const seen = new Set<string>();
    list.forEach((d, i) => {
      seen.add(d.id);
      const sig = `${d.k}|${d.p}|${d.color}|${d.w}|${d.fill}|${d.fc}|${d.dash}|${d.txt}|${d.fs}|${d.font}|${d.b}|${d.i}|${d.u}|${d.ho}|${d.bw}|${d.hz}|${d.of}|${JSON.stringify(d.spell)}|${textRes}`;
      let it = this.items.get(d.id);
      if (!it) {
        it = { root: new Container(), g: new Graphics(), text: null, sig: '', surface:isTemplate(d.k) ? this.freeSurfaces.pop() ?? new SpellTexture() : new SpellTexture() };
        it.root.addChild(it.g);
        this.items.set(d.id, it);
        this.container.addChild(it.root);
      }
      it.root.zIndex = i;
      if (it.sig !== sig || gridChanged) {
        it.sig = sig;
        it.g.clear();
        if (d.k === 'text') this.paintText(it, d, textRes);
        else { const shape=shapeOf(d);paintShape(it.g, shape, grid, 1, cover, walls,undefined,isTemplate(d.k) && shape.pts.length>=2 ? this.picture?.(d.id,shape) : undefined,it.surface); this.paintZoneLabel(it, d, grid, textRes); }
      }
      if (it.text && it.text.resolution !== textRes) it.text.resolution = textRes;
    });
    for (const [id, it] of this.items) {
      if (!seen.has(id)) { this.forget?.(id); this.releaseItem(it); this.items.delete(id); }
    }
    this.container.sortableChildren = true;
  }

  /** "10 ft" in the middle of a height zone. */
  private paintZoneLabel(it: Item, d: Drawing, grid: GridSettings, textRes: number) {
    if (d.hz == null) { if (it.text) it.text.visible = false; return; }
    const pts = parsePts(d.p);
    if (pts.length < 2) return;
    const b = boundsOf(pts);
    if (!it.text) {
      it.text = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fontSize: 20, fill: 0xffffff, stroke: { color: 0x000000, width: 4, join: 'round' } } });
      it.text.anchor.set(0.5);
      it.root.addChild(it.text);
    }
    const fs = Math.max(8, Math.min(grid.cell * 0.34, Math.min(b.w, b.h) * 0.45));
    it.text.visible = true;
    it.text.text = `${d.hz > 0 ? '+' : ''}${Math.round(d.hz)} ft`;
    it.text.style.fontSize = fs;
    (it.text.style.stroke as { width: number }).width = Math.max(2, fs * 0.2);
    it.text.resolution = textRes;
    it.text.position.set(b.x + b.w / 2, b.y + b.h / 2);
  }

  private paintText(it: Item, d: Drawing, textRes: number) {
    const pts = parsePts(d.p);
    if (!pts.length) return;
    const col = hex(d.color);
    const dark = ((col >> 16) & 255) * 0.3 + ((col >> 8) & 255) * 0.59 + (col & 255) * 0.11 < 110;
    const halo = dark ? 0xffffff : 0x000000;
    if (!it.text) {
      it.text = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 28, fill: 0xffffff } });
      it.root.addChild(it.text);
    }
    const st = it.text.style;
    it.text.text = d.txt;
    st.fontFamily = fontStack(d.font);
    st.fontWeight = d.b ? '700' : '400';
    st.fontStyle = d.i ? 'italic' : 'normal';
    st.fontSize = d.fs;
    st.lineHeight = d.fs * LINE_H;
    st.fill = col;
    st.stroke = d.ho ? { color: halo, width: 0 } : { color: halo, width: Math.max(2, d.fs * 0.14), join: 'round' };
    it.text.resolution = textRes;
    it.text.anchor.set(0, 0);
    it.text.position.set(pts[0].x, pts[0].y);
    if (d.u) {
      // Pixi has no underline, so draw one under every line
      const m = textMetrics(d);
      const th = Math.max(1, d.fs * 0.07);
      m.widths.forEach((w, n) => {
        const y = pts[0].y + n * d.fs * LINE_H + d.fs * 0.98;
        if (!d.ho) it.g.rect(pts[0].x - th, y - th, w + th * 2, th * 3).fill({ color: halo, alpha: 0.9 });
        it.g.rect(pts[0].x, y, w, th).fill({ color: col });
      });
    }
  }

  /** Hide one drawing while its text is being edited in a box on top of it. */
  setHidden(id: string | null) {
    for (const [k, it] of this.items) it.root.visible = k !== id;
  }

  /** Show some drawings shifted while they are being dragged. */
  setOffset(ids: Set<string>, dx: number, dy: number) {
    for (const [id, it] of this.items) it.root.position.set(ids.has(id) ? dx : 0, ids.has(id) ? dy : 0);
  }

  /** Dim some drawings (about to be erased). */
  setFaded(ids: Set<string>) {
    for (const [id, it] of this.items) it.root.alpha = ids.has(id) ? 0.2 : 1;
  }

  private releaseItem(it:Item){
    it.root.destroy({children:true});
    if(it.surface.allocated){it.surface.release();this.freeSurfaces.push(it.surface);}
  }

  destroy(){
    this.clear();
    for(const surface of this.freeSurfaces)surface.destroy();
    this.freeSurfaces=[];
  }

  clear() {
    for (const it of this.items.values())this.releaseItem(it);
    this.items.clear();
    this.grid = '';
  }

  /** Bounds of a drawing for selection outlines. */
  boundsOf(d: Drawing, grid: GridSettings) {
    return drawingBounds(d, templateWidthPx(grid, d), grid.shape === 'square' ? undefined : grid.shape);
  }
}
