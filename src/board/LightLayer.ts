import { Container, Sprite, Texture } from 'pixi.js';
import { hasPaintedLight, paintGlow, paintLift, paintSeen, paintShade, paintStrokes, type Frame, type LightSrc, type PaintedLight, type Scratch, type Viewer } from '../core/light';
import type { Terrain } from '../core/terrain';
import type { Seg } from '../core/walls';
import type { Ambient, Rect, Vec } from '../types';
import { canvasTexture } from './textures';

// A broad, faint fringe breaks up the cut-paper look of distant terrain.
// A narrower pass keeps the visible face of a nearby ledge legible.
function paintSightEdge(ctx:CanvasRenderingContext2D, feather:number, draw:()=>void) {
  ctx.save();
  ctx.filter=`blur(${feather}px)`;
  ctx.globalAlpha=.45;
  draw();
  ctx.filter=`blur(${Math.max(.65,feather*.28)}px)`;
  ctx.globalAlpha=1;
  draw();
  ctx.restore();
}

/** A canvas, the texture on it, and the sprite that shows it. */
class Paper {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly sprite = new Sprite(Texture.EMPTY);
  private size = '';
  private tex: Texture | null = null;

  /** `readable`: single pixels will be read back from it now and then */
  constructor(readable = false) {
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: readable })!;
  }

  /** Make it `w` x `h` and put it at `origin`, `scale` canvas pixels to each world pixel. True when it was remade (so it is blank). */
  fit(w: number, h: number, origin: Vec, scale: number): boolean {
    this.sprite.position.set(origin.x, origin.y);
    this.sprite.scale.set(1 / scale);
    const key = `${w}x${h}`;
    if (key === this.size) return false;
    this.size = key;
    this.canvas.width = w;
    this.canvas.height = h;
    const old = this.tex;
    this.tex = canvasTexture(this.canvas);
    this.sprite.texture = this.tex;
    old?.destroy(true);
    return true;
  }

  upload() { this.tex?.source.update(); }

  destroy() {
    this.sprite.destroy();
    this.tex?.destroy(true);
    this.tex = null;
  }
}

/** A plain canvas to work on (read back now and then), one per job. */
class Work implements Scratch {
  readonly canvas = document.createElement('canvas');
  readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  size(w: number, h: number) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }
}

/**
 * Darkness and light on the board: a night wash with the lights cut out of it, a coloured glow where they shine, and, when it is
 * dark and the fog follows what tokens see, the shape of what the party can see (used to cut holes in the fog).
 */
export class LightLayer {
  readonly container = new Container();
  private shade = new Paper();
  private glow = new Paper();
  private seenPaper = new Work();
  sightRevision = 0;
  private seenFrame: Frame | null = null;
  private litPaper = new Work();
  private liftShade = new Work();
  private liftSeen = new Work();
  private workA = new Work();
  private workC = new Work();
  /** the painted light shown as a tint while the DM paints it */
  readonly tint = new Container();
  private tintDay = new Paper();
  private tintDim = new Paper();
  private tintKey = '';
  private shadeKey = '';
  private seenKey = '';

  constructor() {
    this.glow.sprite.blendMode = 'add';
    this.container.addChild(this.shade.sprite, this.glow.sprite);
    this.container.visible = false;
    this.tintDay.sprite.tint = 0xf2c230;
    this.tintDim.sprite.tint = 0x7aa2d8;
    this.tintDay.sprite.alpha = this.tintDim.sprite.alpha = 0.42;
    this.tint.addChild(this.tintDay.sprite, this.tintDim.sprite);
    this.tint.visible = false;
  }

  get sightCanvas(): HTMLCanvasElement { return this.seenPaper.canvas; }

  hide() { this.container.visible = false; }

  /** Paint the dark and the glow for the scene (again only when something about it changed). `dm`: the DM's own view, which is see-through so the map can still be worked on. */
  paint(o: { ambient: Ambient; rect: Rect; lights: LightSrc[]; viewers: Viewer[]; segs: Seg[]; painted: PaintedLight | null; dm: boolean; key: string }) {
    this.container.visible = true;
    this.shade.sprite.alpha = o.dm ? 0.62 : 1;
    const scale = Math.min(1, 1400 / Math.max(o.rect.w, o.rect.h, 1));
    const w = Math.max(1, Math.ceil(o.rect.w * scale)), h = Math.max(1, Math.ceil(o.rect.h * scale));
    const origin = { x: o.rect.x, y: o.rect.y };
    const remade = this.shade.fit(w, h, origin, scale);
    this.glow.fit(w, h, origin, scale);
    const key = `${o.key}|${o.dm}|${w}x${h}`;
    if (!remade && key === this.shadeKey) return;
    this.shadeKey = key;
    const f: Frame = { origin, scale, w, h };
    const painted = hasPaintedLight(o.painted) ? o.painted : null;
    if (painted) { this.liftShade.size(w, h); paintLift(this.liftShade.ctx, f, painted, o.ambient, true, o.segs, { a: this.workA, c: this.workC }); }
    paintShade(this.shade.ctx, f, o.ambient, o.lights, o.viewers, o.segs, painted ? this.liftShade.canvas : null);
    paintGlow(this.glow.ctx, f, o.ambient === 'bright' ? [] : o.lights, o.segs);
    this.shade.upload();
    this.glow.upload();
  }

  /** Show where light is painted (gold for daylight, blue for dim light) while the DM paints it; hide it otherwise. */
  paintTint(o: { show: boolean; rect: Rect; day: Terrain | null; dim: Terrain | null }) {
    this.tint.visible = o.show;
    if (!o.show) return;
    const scale = Math.min(1, 1400 / Math.max(o.rect.w, o.rect.h, 1));
    const w = Math.max(1, Math.ceil(o.rect.w * scale)), h = Math.max(1, Math.ceil(o.rect.h * scale));
    const origin = { x: o.rect.x, y: o.rect.y };
    const a = this.tintDay.fit(w, h, origin, scale), b = this.tintDim.fit(w, h, origin, scale);
    const key = `${o.day?.sig ?? ''}|${o.dim?.sig ?? ''}|${w}x${h}|${origin.x},${origin.y}`;
    if (!a && !b && key === this.tintKey) return;
    this.tintKey = key;
    const f: Frame = { origin, scale, w, h };
    if (o.day) paintStrokes(this.tintDay.ctx, f, o.day); else this.tintDay.ctx.clearRect(0, 0, w, h);
    if (o.dim) paintStrokes(this.tintDim.ctx, f, o.dim); else this.tintDim.ctx.clearRect(0, 0, w, h);
    this.tintDay.upload();
    this.tintDim.upload();
  }

  /** Antialias the union in map coordinates. One fill keeps adjoining faces seamless. */
  paintBrightSeen(f: Frame, shapes: {x:number; y:number; r:number; poly:Vec[] | null}[], feather:number) {
    this.seenKey = '';
    this.seenPaper.size(f.w,f.h);
    const ctx=this.seenPaper.ctx;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,f.w,f.h);
    ctx.setTransform(f.scale,0,0,f.scale,-f.origin.x*f.scale,-f.origin.y*f.scale);
    ctx.beginPath();
    for (const {poly,x,y,r} of shapes) {
      if (!poly) { ctx.moveTo(x+r,y); ctx.arc(x,y,r,0,2*Math.PI); }
      else if (poly.length>=3) {
        ctx.moveTo(poly[0].x,poly[0].y);
        for(let i=1;i<poly.length;i++) ctx.lineTo(poly[i].x,poly[i].y);
      }
      ctx.closePath();
    }
    ctx.fillStyle='#fff';
    paintSightEdge(ctx,feather,()=>ctx.fill());
    ctx.restore();
    this.sightRevision++;
  }

  /** Paint the shape of what the viewers can see in the dark, in the same frame as the fog's own canvas. */
  paintSeen(f: Frame, lights: LightSrc[], viewers: Viewer[], segs: Seg[], painted: PaintedLight | null, key: string, feather:number) {
    const k = `${key}|${f.w}x${f.h}|${f.origin.x},${f.origin.y},${f.scale}`;
    if (k === this.seenKey) return;
    this.seenPaper.size(f.w,f.h);
    this.litPaper.size(f.w,f.h);
    this.seenKey = k;
    this.seenFrame = f;
    const on = hasPaintedLight(painted) ? painted : null;
    if (on) { this.liftSeen.size(f.w, f.h); paintLift(this.liftSeen.ctx, f, on, 'dark', false, segs, { a: this.workA, c: this.workC }); }
    paintSeen(this.seenPaper.ctx, this.litPaper.ctx, f, lights, viewers, segs, on ? this.liftSeen.canvas : null);
    // The lit scratch image is no longer needed once darkness and sight agree.
    const raw=this.litPaper.ctx, seen=this.seenPaper.ctx;
    raw.setTransform(1,0,0,1,0,0);
    raw.globalCompositeOperation='copy';
    raw.drawImage(seen.canvas,0,0);
    raw.globalCompositeOperation='source-over';
    seen.save();
    seen.setTransform(1,0,0,1,0,0);
    seen.clearRect(0,0,f.w,f.h);
    seen.globalCompositeOperation='source-over';
    // Darkness also carries fractional light levels. Blend the two soft
    // edges additively so a uniformly dim patch retains its original alpha.
    seen.filter=`blur(${feather}px)`;
    seen.globalAlpha=.3;
    seen.drawImage(raw.canvas,0,0);
    seen.globalCompositeOperation='lighter';
    seen.filter=`blur(${Math.max(.65,feather*.28)}px)`;
    seen.globalAlpha=.7;
    seen.drawImage(raw.canvas,0,0);
    seen.restore();
    this.sightRevision++;
  }

  /** Can the party see this spot right now (when it is dark and sight follows the light)? */
  seenAt(p: Vec): boolean {
    const f = this.seenFrame;
    if (!f) return false;
    const x = Math.floor((p.x - f.origin.x) * f.scale), y = Math.floor((p.y - f.origin.y) * f.scale);
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return false;
    // Picking uses the raw visibility, before the artwork's edge is softened.
    return this.litPaper.ctx.getImageData(x, y, 1, 1).data[3] > 127;
  }

  /** Give the big canvases back when the scene is not dark. */
  releaseSeen() {
    this.seenKey = '';
  }

  destroy() {
    this.shade.destroy();
    this.glow.destroy();
    this.tintDay.destroy();
    this.tintDim.destroy();
    this.container.destroy({ children: false });
  }
}
