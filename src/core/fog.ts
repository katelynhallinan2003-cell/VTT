import type { FogOp, FogSettings, Rect, Vec } from '../types';

/** "x,y,x,y,..." <-> points. One short string per op keeps the database small and atomic. */
export function encodePoints(points: Vec[]): string {
  return points.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(',');
}
export function decodePoints(s: string): Vec[] {
  const n = s.split(',').map(Number);
  const out: Vec[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) out.push({ x: n[i], y: n[i + 1] });
  }
  return out;
}

export function rectOp(mode: 'r' | 'h', r: Rect): FogOp {
  return { m: mode, t: 'rect', p: [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10).join(',') };
}
export function polyOp(mode: 'r' | 'h', pts: Vec[]): FogOp {
  return { m: mode, t: 'poly', p: encodePoints(pts) };
}
export function lineOp(mode: 'r' | 'h', pts: Vec[], width: number): FogOp {
  return { m: mode, t: 'line', p: encodePoints(pts), w: Math.round(width * 10) / 10 };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Paint one op onto a mask context (black = fogged). `reveal` erases, `hide` paints. */
export function paintOp(ctx: Ctx2D, op: FogOp, origin: Vec, scale: number): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -origin.x * scale, -origin.y * scale);
  ctx.globalCompositeOperation = op.m === 'r' ? 'destination-out' : 'source-over';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  if (op.t === 'rect') {
    const [x, y, w, h] = op.p.split(',').map(Number);
    if ([x, y, w, h].every(Number.isFinite)) ctx.fillRect(x, y, w, h);
  } else if (op.t === 'poly') {
    const pts = decodePoints(op.p);
    if (pts.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
  } else if (op.t === 'line') {
    const pts = decodePoints(op.p);
    ctx.lineWidth = op.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.arc(pts[0].x, pts[0].y, op.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (pts.length > 1) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Keeps an offscreen canvas holding the fog mask for one scene. Incremental when ops are only
 * appended (the common case), full redraw otherwise.
 */
export class FogMask {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private applied: string[] = [];
  private key = '';
  scale = 1;
  origin: Vec = { x: 0, y: 0 };
  worldW = 0;
  worldH = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
  }

  /** Returns true if the canvas content changed. */
  sync(ops: [string, FogOp][], settings: FogSettings, rect: Rect, maxSide = 2048): boolean {
    const scale = Math.min(1, maxSide / Math.max(rect.w, rect.h, 1));
    const w = Math.max(1, Math.ceil(rect.w * scale));
    const h = Math.max(1, Math.ceil(rect.h * scale));
    const key = `${settings.base}|${rect.x},${rect.y},${rect.w},${rect.h}|${w}x${h}`;
    const ids = ops.map(([id]) => id);
    const sameBase = key === this.key;
    const isExtension = sameBase && ids.length >= this.applied.length && this.applied.every((id, i) => id === ids[i]);
    if (isExtension && ids.length === this.applied.length) return false;

    if (!isExtension) {
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.scale = scale;
      this.origin = { x: rect.x, y: rect.y };
      this.worldW = rect.w;
      this.worldH = rect.h;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.clearRect(0, 0, w, h);
      if (settings.base === 'hidden') { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, w, h); }
      this.applied = [];
    }
    for (let i = this.applied.length; i < ops.length; i++) paintOp(this.ctx, ops[i][1], this.origin, this.scale);
    this.applied = ids;
    this.key = key;
    return true;
  }
}
