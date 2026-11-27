import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { healthState, HEALTH_COLOR } from '../core/combat';
import { altLabel, type Altitude } from '../core/height';
import { addFx, tintColor } from '../core/effects';
import { colorNum } from '../core/colornum';
import { isLightMark } from '../core/light';
import type { Effect, GridSettings, Token } from '../types';
import { loadTexture, type LoadedTexture } from './textures';

export interface TokenCtx {
  spells?:string[];
  grid: GridSettings;
  /** DM sees names of hidden tokens flagged; players never get hidden tokens at all */
  showLabel: boolean;
  textRes: number;
  /** how healthy this token looks to whoever is watching (null = show nothing) */
  health: { pct: number; bar: boolean; nums?: { now: number; cap: number } } | null;
  /** how high it is: flying, or standing on high or low ground */
  alt: Altitude;
}

/** what has to change on screen when a token's effects change */
const fxKey = (fx: Effect[]): string => fx.map((e) => `${e.id}${e.n}${e.ic}${e.c}${e.look}${e.tint ? 't' + e.tc : ''}${e.left ?? ''}`).join(',');

export { isLightMark };

const hex = colorNum;

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
  /** an effect being tried out in the Effects window: shown as if it were already on the token, but not saved */
  preview: Effect | null = null;

  /** a shadow on the ground under a flying token, further away the higher it is */
  private shadowG = new Graphics();
  /** the little ↑30 / ▲10 tag in the corner */
  private altG = new Graphics();
  private altText: Text;
  private hKey = '';
  private altNow: Altitude = { alt: 0, clear: 0, ground: 0 };
  /** glow around the token (effects with the Glow look), drawn under everything */
  private fxBack = new Graphics();
  private tintG = new Graphics();
  /** badges and orbiting symbols of effects, drawn above the token */
  private fxFront = new Container();
  private base = new Graphics();
  private sprite: Sprite | null = null;
  private maskG = new Graphics();
  private ring = new Graphics();
  private healthG = new Graphics();
  private hpText: Text;
  private initial: Text;
  private label: Text;
  private key = '';
  private imgUrl: string | null = null;
  private tex: LoadedTexture | null = null;
  private placed = false;
  private onDirty: () => void;
  private health: TokenCtx['health'] = null;

  constructor(onDirty: () => void) {
    this.onDirty = onDirty;
    this.initial = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fill: 0xffffff, fontSize: 32 } });
    this.initial.anchor.set(0.5);
    this.label = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontWeight: '600', fill: 0xffffff, fontSize: 14, stroke: { color: 0x000000, width: 4, join: 'round' } },
    });
    this.label.anchor.set(0.5, 0);
    this.hpText = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fill: 0xffffff, fontSize: 11, stroke: { color: 0x000000, width: 3, join: 'round' } } });
    this.hpText.anchor.set(0.5);
    this.altText = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fill: 0xffffff, fontSize: 12 } });
    this.altText.anchor.set(0.5);
    this.container.addChild(this.shadowG, this.fxBack, this.base, this.maskG, this.initial, this.tintG, this.ring, this.healthG, this.hpText, this.fxFront, this.altG, this.altText, this.label);
  }

  /** the effects to draw: the real ones, plus the one being previewed (which replaces a real one of the same name, like adding it would) */
  private fxList(t: Token): Effect[] { return this.preview ? addFx(t.fx, this.preview) : t.fx; }

  apply(token: Token, ctx: TokenCtx) {
    this.token = token;
    const g = ctx.grid;
    this.health = ctx.health;
    const key = [ctx.spells?.join(','),token.size, token.shape, token.ring, token.ringW, token.imgScale, token.imgX, token.imgY, token.imgBg, token.name ? token.name[0] : '?', g.cell,
      ctx.health ? `${ctx.health.pct}/${ctx.health.bar}/${ctx.health.nums ? `${ctx.health.nums.now}of${ctx.health.nums.cap}` : ''}` : '', fxKey(this.fxList(token)),
      isLightMark(token) ? `L${token.light?.c}` : ''].join('|');
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
          this.container.addChildAt(this.sprite, this.container.getChildIndex(this.initial)); // above base + clip shape, below ring
          this.redraw(this.token, ctx);
          this.onDirty();
        });
      }
    }
    this.label.text = token.name + (token.hidden ? ' (hidden)' : '');
    this.label.visible = ctx.showLabel && token.label !== 'none' && !!token.name;
    if (this.label.resolution !== ctx.textRes) this.label.resolution = ctx.textRes;
    this.altNow = ctx.alt;
    this.applyHeight(ctx.grid, token);
    // higher things are drawn over lower ones, then by stacking order
    this.container.zIndex = token.z + Math.max(-500, Math.min(5000, ctx.alt.alt)) * 1000;
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
    } else if (isLightMark(t)) {
      // a light on its own: everyone sees a small glowing marker where it is (a light the players should not see is hidden like any token)
      const col = hex(t.light!.c);
      this.base.circle(0, 0, r).fill({ color: col, alpha: 0.35 }).stroke({ width: Math.max(1.5, r * 0.12), color: col, alpha: 0.9 });
    } else if (noImage) {
      this.base.circle(0, 0, r).fill(hashColor(t.name || t.id));
    }

    const spells=ctx.spells ?? [];
    spells.forEach((color,i)=>{
      const angle=2*Math.PI/spells.length, gap=Math.min(.10,angle*.15);
      const from=-Math.PI/2+i*angle+gap,to=from+angle-2*gap, radius=r+D*.08;
      this.ring.arc(0,0,radius,from,to).stroke({color:0x17191d,width:D*.095});
      this.ring.arc(0,0,radius,from,to).stroke({color:hex(color),width:D*.055});
    });

    if (this.sprite && this.tex) {
      const tw = this.tex.texture.width;
      const th = this.tex.texture.height;
      const fit = t.shape === 'none' ? Math.min(D / tw, D / th) : Math.max(D / tw, D / th);
      this.sprite.scale.set(fit * t.imgScale);
      this.sprite.position.set(t.imgX * D, t.imgY * D);
      this.sprite.mask = t.shape === 'none' ? null : this.maskG;
    }

    const mark = isLightMark(t);
    this.initial.visible = mark || (noImage && t.shape !== 'none');
    this.initial.text = mark ? '🔥' : (t.name || '?').trim().charAt(0).toUpperCase() || '?';
    this.initial.style.fontSize = Math.max(10, D * (mark ? 0.7 : 0.5));

    this.label.style.fontSize = Math.max(11, ctx.grid.cell * 0.22);
    this.drawHealth(t, ctx);
    this.drawFx(t, ctx, this.fxList(t));
  }

  /**
   * Effects on the token: a soft glow around it, a row of round badges above it, and symbols orbiting it.
   * Each effect picks its own look. Nothing here animates: the board only redraws when something changes.
   */
  private drawFx(t: Token, ctx: TokenCtx, fx: Effect[]) {
    const g = this.fxBack;
    g.clear();
    this.tintG.clear();
    for (const c of this.fxFront.removeChildren()) c.destroy();
    if (!fx.length) { if (this.sprite) this.sprite.tint = 0xffffff; return; }
    const cell = ctx.grid.cell;
    const D = t.size * cell;
    const r = D / 2;
    const square = t.shape === 'square';

    // a wash of colour over the whole token for effects that ask for it (a few at once still leave the picture readable)
    const tints = fx.filter((e) => e.tint).slice(0, 3);
    if (this.sprite) {
      // frameless tokens have no shape to fill, so the picture itself is coloured (multiplied by a light version of the colour)
      let tt = 0xffffff;
      if (t.shape === 'none' && tints.length) {
        const k = hex(tintColor(tints[0]));
        const mixc = (c: number) => Math.round(255 - (255 - c) * 0.65);
        tt = (mixc((k >> 16) & 255) << 16) | (mixc((k >> 8) & 255) << 8) | mixc(k & 255);
      }
      this.sprite.tint = tt;
    }
    if (t.shape !== 'none') {
      tints.forEach((e) => {
        const col = hex(tintColor(e));
        const a = tints.length > 1 ? 0.3 : 0.42;
        if (square) this.tintG.rect(-r, -r, D, D).fill({ color: col, alpha: a });
        else this.tintG.circle(0, 0, r).fill({ color: col, alpha: a });
      });
    }
    const bs = Math.max(13, Math.min(cell * 0.3, D * 0.6 + 6));

    // glow: stacked translucent strokes, strongest at the token's edge
    const halos = fx.filter((e) => e.look === 'halo');
    const w = Math.max(3, cell * 0.07);
    halos.forEach((e, i) => {
      const rad = r + w * 0.25 + i * w * 1.3;
      const col = hex(e.c);
      const layers: [number, number][] = [[4.6, 0.1], [3.4, 0.14], [2.2, 0.2], [1, 0.6]];
      for (const [k, a] of layers) {
        if (square) g.roundRect(-rad, -rad, rad * 2, rad * 2, w).stroke({ width: w * k, color: col, alpha: a });
        else g.circle(0, 0, rad).stroke({ width: w * k, color: col, alpha: a });
      }
    });

    const front = this.fxFront;
    const marks = new Graphics();
    front.addChild(marks);
    const glyph = (e: Effect) => e.ic || e.n.charAt(0).toUpperCase();
    const addText = (txt: string, size: number, x: number, y: number, o: { fill?: number; stroke?: boolean } = {}) => {
      const tx = new Text({
        text: txt,
        style: { fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif', fontWeight: '700', fontSize: size, fill: o.fill ?? 0xffffff,
          ...(o.stroke ? { stroke: { color: 0x000000, width: Math.max(2, size * 0.25), join: 'round' as const } } : {}) },
      });
      tx.anchor.set(0.5);
      tx.position.set(x, y);
      tx.resolution = ctx.textRes;
      front.addChild(tx);
    };

    // orbit: the symbol repeated around the token, several effects interleaved
    const orbits = fx.filter((e) => e.look === 'orbit');
    const n = 8;
    const orad = r + bs * 0.42;
    orbits.forEach((e, j) => {
      for (let k = 0; k < n; k++) {
        const ang = ((k + j / orbits.length) / n) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(ang) * orad;
        const y = Math.sin(ang) * orad;
        marks.circle(x, y, bs * 0.34).fill({ color: 0x000000, alpha: 0.4 });
        marks.circle(x, y, bs * 0.34).stroke({ width: 1.2, color: hex(e.c), alpha: 0.95 });
        addText(glyph(e), bs * 0.46, x, y);
      }
    });

    // badges above the token (the Glow look has one too)
    const badges = fx.filter((e) => e.look !== 'orbit');
    const show = badges.slice(0, 6);
    const step = bs * 1.12;
    const y0 = -r - bs * 0.55 - Math.max(0, halos.length - 0) * w * 1.3 - 2;
    show.forEach((e, i) => {
      const x = (i - (show.length - 1) / 2) * step;
      if (e.look === 'dot') {
        marks.circle(x, y0, bs * 0.3).fill({ color: hex(e.c), alpha: 0.95 });
        marks.circle(x, y0, bs * 0.3).stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
      } else {
        marks.circle(x, y0, bs * 0.5 + 1.5).fill({ color: 0x000000, alpha: 0.55 });
        marks.circle(x, y0, bs * 0.5).fill({ color: hex(e.c), alpha: 0.95 });
        marks.circle(x, y0, bs * 0.5).stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
        addText(glyph(e), bs * 0.62, x, y0);
      }
      if (e.left != null) addText(String(e.left), Math.max(9, bs * 0.4), x + bs * 0.38, y0 + bs * 0.4, { stroke: true });
    });
    if (badges.length > show.length) addText(`+${badges.length - show.length}`, Math.max(10, bs * 0.45), ((show.length - 1) / 2) * step + bs * 0.9, y0, { stroke: true });
  }

  /** Coloured edge for bloodied / near death / down, and a small bar under the token. */
  private drawHealth(t: Token, ctx: TokenCtx) {
    const g = this.healthG;
    g.clear();
    const D = t.size * ctx.grid.cell;
    const r = D / 2;
    const h = this.health;
    let labelY = r + 2;
    this.hpText.text = '';
    if (h) {
      const state = healthState(h.pct);
      const col = hex(HEALTH_COLOR[state]);
      if (state !== 'ok') {
        const w = Math.max(3, ctx.grid.cell * 0.07);
        if (state === 'down') {
          if (t.shape === 'square') g.rect(-r, -r, D, D); else g.circle(0, 0, r);
          g.fill({ color: 0x000000, alpha: 0.5 });
        }
        if (t.shape === 'square') g.rect(-r - w / 2, -r - w / 2, D + w, D + w).stroke({ width: w, color: col, join: 'miter' });
        else g.circle(0, 0, r + w / 2).stroke({ width: w, color: col });
      }
      if (h.bar) {
        const bw = Math.max(24, D * 0.9);
        // with the numbers on it the bar is taller, so they fit inside it
        const bh = h.nums ? Math.max(13, ctx.grid.cell * 0.2) : Math.max(5, ctx.grid.cell * 0.1);
        const y = r + 3;
        g.roundRect(-bw / 2 - 1.5, y - 1.5, bw + 3, bh + 3, bh / 2 + 1.5).fill({ color: 0x000000, alpha: 0.72 });
        if (h.pct > 0) g.roundRect(-bw / 2, y, Math.max(bh, (bw * h.pct) / 100), bh, bh / 2).fill(col);
        labelY = y + bh + 4;
        if (h.nums) {
          this.hpText.text = `${h.nums.now}/${h.nums.cap}`;
          this.hpText.style.fontSize = Math.max(9, bh * 0.82);
          this.hpText.position.set(0, y + bh / 2 + 0.5);
        }
      }
    }
    this.label.position.set(0, labelY);
  }

  /** Show a new height without redrawing the whole token (used while a token is dragged across high ground). */
  setAlt(a: Altitude, grid: GridSettings) {
    this.altNow = a;
    this.applyHeight(grid, this.token);
    this.container.zIndex = this.token.z + Math.max(-500, Math.min(5000, a.alt)) * 1000;
  }

  /** The shadow under a flying token and the height tag in its corner. */
  private applyHeight(grid: GridSettings, t: Token) {
    const a = this.altNow;
    const key = `${a.alt}|${a.clear}|${t.fly}|${t.size}|${t.shape}|${grid.cell}`;
    if (key === this.hKey) return;
    this.hKey = key;
    const cell = grid.cell;
    const D = t.size * cell;
    const r = D / 2;
    const sh = this.shadowG;
    sh.clear();
    if (a.clear > 0) {
      const off = cell * (0.06 + Math.min(1, a.clear / 60) * 0.5);
      if (t.shape === 'square') sh.rect(-r + off, -r + off, D, D).fill({ color: 0x000000, alpha: 0.32 });
      else sh.circle(off, off, r).fill({ color: 0x000000, alpha: 0.32 });
    }
    const g = this.altG;
    g.clear();
    const label = altLabel(a, t.fly);
    this.altText.visible = !!label;
    if (!label) return;
    const fs = Math.max(10, cell * 0.2);
    this.altText.text = label;
    this.altText.style.fontSize = fs;
    const x = -r * 0.62;
    const y = -r * 0.8;
    this.altText.position.set(x, y);
    const w = label.length * fs * 0.62 + fs * 0.6;
    const col = a.clear > 0 ? 0x1c7ed6 : a.alt > 0 ? 0x8a5a2b : 0x4c4f9e;
    g.roundRect(x - w / 2, y - fs * 0.62, w, fs * 1.24, fs * 0.62).fill({ color: col, alpha: 0.95 }).stroke({ width: 1.2, color: 0xffffff, alpha: 0.85 });
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

  setTextRes(res: number) {
    if (this.label.resolution !== res) this.label.resolution = res;
    if (this.altText.resolution !== res) this.altText.resolution = res;
    for (const c of this.fxFront.children) if (c instanceof Text && c.resolution !== res) c.resolution = res;
  }

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
