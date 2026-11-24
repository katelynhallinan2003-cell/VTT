import type { Ambient, GridSettings, Token, TokenLight, Vec } from '../types';
import { cellPoly } from './cells';
import { liftField } from './paintedlight';
import type { Terrain } from './terrain';
import { visibilityPolygon, type Seg } from './walls';

/** How dark each kind of scene is where nothing lights it (0 = daylight, 1 = pitch black). */
/** A token that is only a light (a torch, a lantern, a campfire): no picture and no frame. It is never a combatant. */
export const isLightMark = (t: Pick<Token, 'shape' | 'img' | 'light'>): boolean => t.shape === 'none' && !t.img && !!t.light;

export const SHADE: Record<Ambient, number> = { bright: 0, dim: 0.45, dark: 0.88 };
/** The colour of the dark, a little blue so it reads as night and not as a stain. */
export const NIGHT = '5,8,22';

/** Ready-made lights, as the rulebooks give them: bright for this far, dim for this much further. */
export const LIGHT_PRESETS: { name: string; light: TokenLight }[] = [
  { name: 'Candle', light: { b: 5, d: 5, c: '#ffd9a0' } },
  { name: 'Torch', light: { b: 20, d: 20, c: '#ffc27a' } },
  { name: 'Lamp', light: { b: 15, d: 30, c: '#ffd9a0' } },
  { name: 'Lantern', light: { b: 30, d: 30, c: '#ffe2ae' } },
  { name: 'Light spell', light: { b: 20, d: 20, c: '#e8f0ff' } },
  { name: 'Daylight spell', light: { b: 60, d: 60, c: '#fff6d8' } },
];

/** A light shining from a spot. Distances in world pixels, counted from the middle of the spot. */
export interface LightSrc {
  id: string;
  x: number;
  y: number;
  /** bright out to here */
  b: number;
  /** dim out to here (so the whole light reaches this far) */
  r: number;
  c: string;
  /** how high it is: a wall lower than this does not block it */
  alt?: number;
}

/** One token that can see: where it is, how far it sees when there is light, and how far with no light at all. */
export interface Viewer {
  id: string;
  x: number;
  y: number;
  /** sight, to the token's edge */
  r: number;
  /** darkvision, to the token's edge (0 = none): it sees this far in the dark as if in dim light */
  dv: number;
  /** what it can always make out right beside it */
  touch: number;
  alt?: number;
}

const toPx = (ft: number, g: Pick<GridSettings, 'ft' | 'cell'>) => (ft / g.ft) * g.cell;

/** The light a token gives off, as a source at `at`. Distances are counted from the token's edge, like sight. */
export function lightOf(t: Pick<Token, 'id' | 'light' | 'size'>, g: Pick<GridSettings, 'ft' | 'cell'>, at: Vec, alt?: number): LightSrc | null {
  const l = t.light;
  if (!l || !(l.b + l.d > 0)) return null;
  const edge = (t.size * g.cell) / 2;
  return { id: t.id, x: at.x, y: at.y, b: toPx(l.b, g) + edge, r: toPx(l.b + l.d, g) + edge, c: l.c, alt };
}

/** What a token sees with: its sight, darkvision (never past its sight) and the little it makes out beside itself. 0 sight sees nothing. */
export function viewerOf(t: Pick<Token, 'id' | 'sight' | 'dv' | 'size'>, g: Pick<GridSettings, 'ft' | 'cell'>, at: Vec, alt?: number): Viewer | null {
  if (!(t.sight > 0)) return null;
  const edge = (t.size * g.cell) / 2;
  const r = toPx(t.sight, g) + edge;
  const dv = t.dv > 0 ? Math.min(r, toPx(t.dv, g) + edge) : 0;
  return { id: t.id, x: at.x, y: at.y, r, dv, touch: Math.min(r, edge + g.cell * 0.6), alt };
}

/** Where a light reaches, out to `radius`: cut back by walls (a closed door stops it, a window does not). */
export function lightPoly(src: Pick<LightSrc, 'x' | 'y' | 'alt'>, radius: number, segs: Seg[]): Vec[] {
  return visibilityPolygon({ x: src.x, y: src.y }, radius, segs, 48, src.alt).poly;
}

/** What a viewer could see with light everywhere: its sight, cut back by walls. */
export function sightPoly(v: Viewer, segs: Seg[]): Vec[] {
  return visibilityPolygon({ x: v.x, y: v.y }, v.r, segs, 64, v.alt).poly;
}

/** What a viewer sees with no light at all: darkvision and the ground right beside it, cut back by walls. */
export function darkPoly(v: Viewer, segs: Seg[]): Vec[] | null {
  const r = Math.max(v.dv, v.touch);
  return r > 0 ? visibilityPolygon({ x: v.x, y: v.y }, r, segs, 48, v.alt).poly : null;
}

/** A ring of points, for clipping against round things. */
export function ringPoly(c: Vec, r: number, n = 32): Vec[] {
  return Array.from({ length: n }, (_, i) => ({ x: c.x + Math.cos((i / n) * Math.PI * 2) * r, y: c.y + Math.sin((i / n) * Math.PI * 2) * r }));
}

/** Twice the signed area: positive when the points go clockwise on the screen (y down). */
function area2(p: Vec[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s;
}

/**
 * The part of `subject` inside the convex shape `clip` (Sutherland-Hodgman). The subject can be any simple shape; where the
 * answer would be in several pieces they come out joined by edges with no width, which does not matter for filling.
 */
export function clipToConvex(subject: Vec[], clip: Vec[]): Vec[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const cw = area2(clip) > 0;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    // which side of the edge is the inside
    const inside = (p: Vec) => { const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); return cw ? c >= 0 : c <= 0; };
    const cross = (p: Vec, q: Vec): Vec => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const den = (b.x - a.x) * dy - (b.y - a.y) * dx;
      if (Math.abs(den) < 1e-12) return p;
      const t = ((b.x - a.x) * (a.y - p.y) - (b.y - a.y) * (a.x - p.x)) / den;
      return { x: p.x + dx * t, y: p.y + dy * t };
    };
    const next: Vec[] = [];
    for (let j = 0; j < out.length; j++) {
      const cur = out[j], prev = out[(j + out.length - 1) % out.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) next.push(cross(prev, cur)); next.push(cur); } else if (pi) next.push(cross(prev, cur));
    }
    out = next;
  }
  return out.length >= 3 && Math.abs(area2(out)) > 1 ? out : [];
}

/**
 * The ground a viewer remembers seeing in the dark, from where it stands now: the part of its sight that other lights reach.
 * (A light is taken to reach its whole circle here, which is a little generous behind walls; it only decides what is remembered.)
 */
export function litSeen(v: Viewer, lights: LightSrc[], segs: Seg[]): Vec[][] {
  const out: Vec[][] = [];
  let sight: Vec[] | null = null;
  for (const l of lights) {
    if (Math.hypot(l.x - v.x, l.y - v.y) > v.r + l.r) continue;
    sight ??= sightPoly(v, segs);
    const piece = clipToConvex(sight, ringPoly(l, l.r));
    if (piece.length) out.push(piece);
  }
  return out;
}

// ---------------------------------------------------------------- painting
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Frame {
  /** world position of the canvas's top left, and canvas pixels per world pixel */
  origin: Vec;
  scale: number;
  w: number;
  h: number;
}

function toWorld(ctx: Ctx, f: Frame) {
  ctx.setTransform(f.scale, 0, 0, f.scale, -f.origin.x * f.scale, -f.origin.y * f.scale);
}
function toScreen(ctx: Ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); }

function path(ctx: Ctx, poly: Vec[]) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

/** How much a light lifts the dark at each distance (as a share of its reach): full within the bright part, `dim` out to its edge. */
export function eraseStops(b: number, r: number, ambient: Ambient): [number, number][] {
  const soft = 0.07;
  const fb = r > 0 ? Math.min(1, b / r) : 1;
  // dim light in the dark is half way to daylight; in twilight it adds nothing
  const dimLift = ambient === 'dark' ? 0.5 : 0;
  if (fb >= 0.999) return [[0, 1], [Math.max(0.01, 1 - soft * 2), 1], [1, 0]];
  const a = Math.max(0.01, fb - soft / 2);
  const bb = Math.min(0.99, fb + soft / 2);
  const stops: [number, number][] = [[0, 1], [a, 1], [bb, dimLift]];
  if (dimLift > 0) stops.push([Math.max(bb + 0.001, 1 - soft * 1.5), dimLift]);
  stops.push([1, 0]);
  return stops;
}

/** A canvas to work on, sized for the job. */
export interface Scratch {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: Ctx;
  size(w: number, h: number): void;
}

/** Painted light as it lies on the map: daylight, dim light, and how far each fades out beyond what was painted (world pixels). */
export interface PaintedLight {
  day: Terrain | null;
  dim: Terrain | null;
  edge: number;
}
export const hasPaintedLight = (p: PaintedLight | null | undefined): p is PaintedLight => !!p && (!!p.day?.areas.length || !!p.dim?.areas.length);

/**
 * The strokes of one kind of painted light, in the order they were made (an erase stroke takes light away again): white on see-through.
 * Free strokes are round brushes; strokes of whole squares or hexes are one shape, so there are no seams along the grid.
 */
export function paintStrokes(ctx: Ctx, f: Frame, t: Terrain): void {
  toScreen(ctx);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, f.w, f.h);
  if (!t.areas.length) return;
  toWorld(ctx, f);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const strokes = t.areas.flatMap((a) => a.strokes).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  for (const s of strokes) {
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    if (s.kind === 'cells') {
      ctx.beginPath();
      for (const c of s.pts) {
        const poly = cellPoly(t.grid, c);
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
      }
      ctx.fill();
    } else if (s.kind === 'free' && s.pts.length) {
      if (s.pts.length === 1) {
        ctx.beginPath();
        ctx.arc(s.pts[0].x, s.pts[0].y, s.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = s.r * 2;
        ctx.beginPath();
        ctx.moveTo(s.pts[0].x, s.pts[0].y);
        for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
        ctx.stroke();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  toScreen(ctx);
}

/**
 * The cells of frame `g` that a wall covers, a little thicker than the wall so light cannot slip through a corner.
 * One-way pieces (cliff edges) are left out: the fade of painted light carries on past those. Uses `ctx` as scratch space.
 */
export function wallCells(ctx: Ctx, g: Frame, segs: Seg[]): Uint8Array | null {
  const list = segs.filter((s) => !s.one);
  if (!list.length) return null;
  toScreen(ctx);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, g.w, g.h);
  toWorld(ctx, g);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.2 / g.scale;
  ctx.beginPath();
  for (const s of list) { ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); }
  ctx.stroke();
  toScreen(ctx);
  const px = ctx.getImageData(0, 0, g.w, g.h).data;
  const out = new Uint8Array(g.w * g.h);
  let any = false;
  for (let i = 0; i < out.length; i++) if (px[i * 4 + 3] > 40) { out[i] = 1; any = true; }
  return any ? out : null;
}

/**
 * How much of the dark the painted light lifts, as white on `ctx` (a canvas of frame `f`): see-through where it lifts nothing.
 * Daylight lifts all of it and dim light half (and only in the dark: in twilight everything is dim already); out to the soft edge
 * it fades to nothing, and walls (`segs`) stop that fade. `graded` false gives a plain lit-or-not shape (for sight). The soft edge is worked out on a coarser grid, which also keeps it smooth.
 */
export function paintLift(ctx: Ctx, f: Frame, p: PaintedLight, ambient: Ambient, graded: boolean, segs: Seg[], work: { a: Scratch; c: Scratch }): void {
  toScreen(ctx);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, f.w, f.h);
  const kinds: [Terrain, number][] = [];
  if (p.day?.areas.length) kinds.push([p.day, 1]);
  if (p.dim?.areas.length && ambient === 'dark') kinds.push([p.dim, 0.5]);
  if (!kinds.length) return;
  const k = p.edge > 0 ? Math.max(1, Math.ceil(Math.max(f.w, f.h) / 400)) : 1;
  const g: Frame = { origin: f.origin, scale: f.scale / k, w: Math.ceil(f.w / k), h: Math.ceil(f.h / k) };
  work.a.size(g.w, g.h);
  work.c.size(g.w, g.h);
  const total = new Float32Array(g.w * g.h);
  const block = p.edge > 0 ? wallCells(work.a.ctx, g, segs) : null;
  for (const [t, lift] of kinds) {
    paintStrokes(work.a.ctx, g, t);
    const px = work.a.ctx.getImageData(0, 0, g.w, g.h).data;
    const cover = new Float32Array(g.w * g.h);
    for (let i = 0; i < cover.length; i++) cover[i] = px[i * 4 + 3] / 255;
    const one = liftField(cover, g.w, g.h, p.edge * g.scale, lift, graded, block);
    for (let i = 0; i < total.length; i++) if (one[i] > total[i]) total[i] = one[i];
  }
  const img = work.c.ctx.createImageData(g.w, g.h);
  for (let i = 0; i < total.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(total[i] * 255);
  }
  work.c.ctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(work.c.canvas as CanvasImageSource, 0, 0, g.w, g.h, 0, 0, g.w * k, g.h * k);
}

/**
 * Paint the darkness of a scene onto a canvas: a night-coloured wash, with each light lifting it where it reaches
 * and each viewer's darkvision lifting it by half. The canvas ends up see-through where it is bright.
 * `lift`: a canvas of the same size with how much the painted light lifts the dark (see `paintLift`).
 */
export function paintShade(ctx: Ctx, f: Frame, ambient: Ambient, lights: LightSrc[], viewers: Viewer[], segs: Seg[], lift: CanvasImageSource | null = null): void {
  toScreen(ctx);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, f.w, f.h);
  const base = SHADE[ambient];
  if (base <= 0) return;
  ctx.fillStyle = `rgba(${NIGHT},${base})`;
  ctx.fillRect(0, 0, f.w, f.h);
  toWorld(ctx, f);
  ctx.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    const poly = lightPoly(l, l.r, segs);
    if (poly.length < 3) continue;
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    for (const [at, a] of eraseStops(l.b, l.r, ambient)) g.addColorStop(at, `rgba(0,0,0,${a})`);
    ctx.fillStyle = g;
    path(ctx, poly);
    ctx.fill();
  }
  if (ambient === 'dark') {
    for (const v of viewers) {
      const r = v.dv;
      if (!(r > 0)) continue;
      const poly = visibilityPolygon({ x: v.x, y: v.y }, r, segs, 48, v.alt).poly;
      if (poly.length < 3) continue;
      const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.5)');
      g.addColorStop(0.88, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      path(ctx, poly);
      ctx.fill();
    }
  }
  if (lift) {
    toScreen(ctx);
    ctx.drawImage(lift, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** A soft coloured glow where each light shines, drawn on top of the picture (a torch looks warm, a spell looks cold). */
export function paintGlow(ctx: Ctx, f: Frame, lights: LightSrc[], segs: Seg[]): void {
  toScreen(ctx);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, f.w, f.h);
  toWorld(ctx, f);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const poly = lightPoly(l, l.b > 0 ? Math.min(l.r, l.b * 1.35) : l.r, segs);
    if (poly.length < 3) continue;
    const rgb = hexRgb(l.c);
    const reach = Math.min(l.r, l.b * 1.35);
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, Math.max(1, reach));
    g.addColorStop(0, `rgba(${rgb},0.2)`);
    g.addColorStop(0.6, `rgba(${rgb},0.1)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    path(ctx, poly);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

const hexRgb = (c: string): string => {
  const n = parseInt(c.replace('#', ''), 16);
  return Number.isFinite(n) ? `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}` : '255,217,160';
};

/**
 * What the party sees when it is dark, painted as an opaque shape on `seen`: each viewer's sight where a light reaches
 * (drawn on `lit` first), plus what its darkvision and its own touch give. `lit` is scratch space of the same size.
 * `lit`: the painted light (see `paintLift`), which counts as lit wherever a viewer can see it.
 */
export function paintSeen(seen: Ctx, lit: Ctx, f: Frame, lights: LightSrc[], viewers: Viewer[], segs: Seg[], paint: CanvasImageSource | null = null): void {
  toScreen(lit);
  lit.globalCompositeOperation = 'source-over';
  lit.clearRect(0, 0, f.w, f.h);
  toWorld(lit, f);
  lit.fillStyle = '#fff';
  for (const l of lights) {
    const poly = lightPoly(l, l.r, segs);
    if (poly.length < 3) continue;
    path(lit, poly);
    lit.fill();
  }
  if (paint) {
    toScreen(lit);
    lit.drawImage(paint, 0, 0);
  }
  toScreen(seen);
  seen.globalCompositeOperation = 'source-over';
  seen.clearRect(0, 0, f.w, f.h);
  toWorld(seen, f);
  seen.fillStyle = '#fff';
  for (const v of viewers) {
    const poly = sightPoly(v, segs);
    if (poly.length < 3) continue;
    path(seen, poly);
    seen.fill();
  }
  // keep only the part of what they could see that is lit
  toScreen(seen);
  seen.globalCompositeOperation = 'destination-in';
  seen.drawImage((lit as CanvasRenderingContext2D).canvas as CanvasImageSource, 0, 0);
  // then add what they see without light
  seen.globalCompositeOperation = 'source-over';
  toWorld(seen, f);
  seen.fillStyle = '#fff';
  for (const v of viewers) {
    const poly = darkPoly(v, segs);
    if (!poly || poly.length < 3) continue;
    path(seen, poly);
    seen.fill();
  }
  toScreen(seen);
}
