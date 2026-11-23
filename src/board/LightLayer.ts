import { Container, Sprite, Texture } from 'pixi.js';
import { paintDayMask, paintGlow, paintSeen, paintShade, type Frame, type LightSrc, type Viewer } from '../core/light';
import type { Terrain } from '../core/terrain';
import type { Seg } from '../core/walls';
import type { Ambient, Rect, Vec } from '../types';
import { canvasTexture } from './textures';

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

/** A plain canvas to draw the painted daylight on, one per frame size. */
class Mask {
  readonly canvas = document.createElement('canvas');
  readonly ctx = this.canvas.getContext('2d')!;
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
  private seenPaper = new Paper(true);
  private seenFrame: Frame | null = null;
  private litPaper = new Paper();
  private dayShade = new Mask();
  private daySeen = new Mask();
  private shadeKey = '';
  private seenKey = '';

  constructor() {
    this.glow.sprite.blendMode = 'add';
    this.container.addChild(this.shade.sprite, this.glow.sprite);
    this.container.visible = false;
  }

  /** Whatever shows the shape of what is seen; Board adds it where the fog is and uses it as a mask. */
  get seenSprite(): Sprite { return this.seenPaper.sprite; }

  hide() { this.container.visible = false; }

  /** Paint the dark and the glow for the scene (again only when something about it changed). `dm`: the DM's own view, which is see-through so the map can still be worked on. */
  paint(o: { ambient: Ambient; rect: Rect; lights: LightSrc[]; viewers: Viewer[]; segs: Seg[]; day: Terrain | null; dm: boolean; key: string }) {
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
    const day = o.day?.areas.length ? o.day : null;
    if (day) { this.dayShade.size(w, h); paintDayMask(this.dayShade.ctx, f, day); }
    paintShade(this.shade.ctx, f, o.ambient, o.lights, o.viewers, o.segs, day ? this.dayShade.canvas : null);
    paintGlow(this.glow.ctx, f, o.ambient === 'bright' ? [] : o.lights, o.segs);
    this.shade.upload();
    this.glow.upload();
  }

  /** Paint the shape of what the viewers can see in the dark, in the same frame as the fog's own canvas. */
  paintSeen(f: Frame, lights: LightSrc[], viewers: Viewer[], segs: Seg[], day: Terrain | null, key: string) {
    const k = `${key}|${f.w}x${f.h}|${f.origin.x},${f.origin.y},${f.scale}`;
    const remade = this.seenPaper.fit(f.w, f.h, f.origin, f.scale);
    this.litPaper.fit(f.w, f.h, f.origin, f.scale);
    if (!remade && k === this.seenKey) return;
    this.seenKey = k;
    this.seenFrame = f;
    const dayOn = day?.areas.length ? day : null;
    if (dayOn) { this.daySeen.size(f.w, f.h); paintDayMask(this.daySeen.ctx, f, dayOn); }
    paintSeen(this.seenPaper.ctx, this.litPaper.ctx, f, lights, viewers, segs, dayOn ? this.daySeen.canvas : null);
    this.seenPaper.upload();
  }

  /** Can the party see this spot right now (when it is dark and sight follows the light)? */
  seenAt(p: Vec): boolean {
    const f = this.seenFrame;
    if (!f) return false;
    const x = Math.floor((p.x - f.origin.x) * f.scale), y = Math.floor((p.y - f.origin.y) * f.scale);
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return false;
    return this.seenPaper.ctx.getImageData(x, y, 1, 1).data[3] > 127;
  }

  /** Give the big canvases back when the scene is not dark. */
  releaseSeen() {
    this.seenKey = '';
  }

  destroy() {
    this.shade.destroy();
    this.glow.destroy();
    this.seenPaper.destroy();
    this.litPaper.destroy();
    this.container.destroy({ children: false });
  }
}
