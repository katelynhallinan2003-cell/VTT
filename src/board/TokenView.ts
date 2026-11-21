import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { GridSettings, Token } from '../types';
import { loadTexture, type LoadedTexture } from './textures';

export interface TokenCtx {
  grid: GridSettings;
  /** DM sees names of hidden tokens flagged; players never get hidden tokens at all */
  showLabel: boolean;
  textRes: number;
}

const hex = (c: string) => parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0xffffff;

function hashColor(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  // simple HSL -> RGB (s = .35, l = .32)
  const sat = 0.35, l = 0.32;
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export class TokenView {
  readonly container = new Container();
  token!: Token;
  display = { x: 0, y: 0 };
  target = { x: 0, y: 0 };
  dragging = false;
  /** where this token is being tried out (a test move); the real position is untouched */
  testPos: { x: number; y: number } | null = null;
  /** draw as a see-through copy (shadows and other people's test moves) */
  ghostAlpha: number | null = null;

  private base = new Graphics();
  private sprite: Sprite | null = null;
  private maskG = new Graphics();
  private ring = new Graphics();
  private initial: Text;
  private label: Text;
  private key = '';
  private imgUrl: string | null = null;
  private tex: LoadedTexture | null = null;
  private placed = false;
  private onDirty: () => void;

  constructor(onDirty: () => void) {
    this.onDirty = onDirty;
    this.initial = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fill: 0xffffff, fontSize: 32 } });
    this.initial.anchor.set(0.5);
    this.label = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontWeight: '600', fill: 0xffffff, fontSize: 14, stroke: { color: 0x000000, width: 4, join: 'round' } },
    });
    this.label.anchor.set(0.5, 0);
    this.container.addChild(this.base, this.maskG, this.initial, this.ring, this.label);
  }

  apply(token: Token, ctx: TokenCtx) {
    this.token = token;
    const g = ctx.grid;
    const key = [token.size, token.shape, token.ring, token.ringW, token.imgScale, token.imgX, token.imgY, token.imgBg, token.name ? token.name[0] : '?', g.cell].join('|');
    if (key !== this.key) {
      this.key = key;
      this.redraw(token, ctx);
    }
    if (token.img !== this.imgUrl) {
      this.imgUrl = token.img;
      this.tex = null;
      this.sprite?.destroy();
      this.sprite = null;
      if (token.img) {
        const url = token.img;
        void loadTexture(url, 'token').then((t) => {
          if (this.imgUrl !== url || !t) return;
          this.tex = t;
          this.sprite = new Sprite(t.texture);
          this.sprite.anchor.set(0.5);
          this.container.addChildAt(this.sprite, 2); // above base + clip shape, below ring
          this.redraw(this.token, ctx);
          this.onDirty();
        });
      }
    }
    this.label.text = token.name + (token.hidden ? ' (hidden)' : '');
    this.label.visible = ctx.showLabel && token.label !== 'none' && !!token.name;
    if (this.label.resolution !== ctx.textRes) this.label.resolution = ctx.textRes;
    this.container.zIndex = token.z;
    this.container.alpha = this.ghostAlpha ?? (token.hidden ? 0.5 : 1);
    if (!this.dragging) {
      this.target = this.testPos ? { ...this.testPos } : { x: token.x, y: token.y };
      if (!this.placed) { this.display = { ...this.target }; this.placed = true; }
    }
    this.container.position.set(this.display.x, this.display.y);
  }

  private redraw(t: Token, ctx: TokenCtx) {
    const D = t.size * ctx.grid.cell;
    const r = D / 2;
    const ringPx = t.ringW * D;
    this.base.clear();
    this.maskG.clear();
    this.ring.clear();
    const noImage = !this.tex;
    const imgFill = t.imgBg ? hex(t.imgBg) : 0x20232b;

    if (t.shape === 'circle') {
      this.base.circle(0, 0, r).fill(noImage ? hashColor(t.name || t.id) : imgFill);
      // The clip shape is also drawn (in the same colour as the base), so transparent artwork sits on a dark disc.
      this.maskG.circle(0, 0, r - ringPx / 2).fill(noImage ? hashColor(t.name || t.id) : imgFill);
      if (ringPx > 0) this.ring.circle(0, 0, r - ringPx / 2).stroke({ width: ringPx, color: hex(t.ring) });
    } else if (t.shape === 'square') {
      this.base.rect(-r, -r, D, D).fill(noImage ? hashColor(t.name || t.id) : imgFill);
      this.maskG.rect(-r + ringPx / 2, -r + ringPx / 2, D - ringPx, D - ringPx).fill(noImage ? hashColor(t.name || t.id) : imgFill);
      if (ringPx > 0) this.ring.rect(-r + ringPx / 2, -r + ringPx / 2, D - ringPx, D - ringPx).stroke({ width: ringPx, color: hex(t.ring), join: 'miter' });
    } else if (noImage) {
      this.base.circle(0, 0, r).fill(hashColor(t.name || t.id));
    }

    if (this.sprite && this.tex) {
      const tw = this.tex.texture.width;
      const th = this.tex.texture.height;
      const fit = t.shape === 'none' ? Math.min(D / tw, D / th) : Math.max(D / tw, D / th);
      this.sprite.scale.set(fit * t.imgScale);
      this.sprite.position.set(t.imgX * D, t.imgY * D);
      this.sprite.mask = t.shape === 'none' ? null : this.maskG;
    }

    this.initial.visible = noImage && t.shape !== 'none';
    this.initial.text = (t.name || '?').trim().charAt(0).toUpperCase() || '?';
    this.initial.style.fontSize = Math.max(10, D * 0.5);

    this.label.style.fontSize = Math.max(11, ctx.grid.cell * 0.22);
    this.label.position.set(0, r + 2);
  }

  /** Jump straight to a spot without sliding there. */
  placeAt(p: { x: number; y: number }) {
    this.display = { ...p };
    this.target = { ...p };
    this.placed = true;
    this.container.position.set(p.x, p.y);
  }

  /** Force a redraw next apply (e.g. when the grid size changed). */
  invalidate() { this.key = ''; }

  setTextRes(res: number) { if (this.label.resolution !== res) this.label.resolution = res; }

  tick(dt: number): boolean {
    if (this.dragging) { this.container.position.set(this.display.x, this.display.y); return false; }
    const dx = this.target.x - this.display.x;
    const dy = this.target.y - this.display.y;
    if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
      if (dx === 0 && dy === 0) return false;
      this.display = { ...this.target };
    } else {
      const k = 1 - Math.exp(-dt * 20);
      this.display = { x: this.display.x + dx * k, y: this.display.y + dy * k };
    }
    this.container.position.set(this.display.x, this.display.y);
    return true;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
