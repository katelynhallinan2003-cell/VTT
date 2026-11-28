import type { FogMode, FogOp, FogSettings, Rect, Vec } from '../types';

/** How much of the fog stays over ground that was seen once and is out of sight now (0 = none, 1 = all). */
export const GREY_FOG = 0.46;

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

export function rectOp(mode: FogMode, r: Rect): FogOp {
  return { m: mode, t: 'rect', p: [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10).join(',') };
}
export function polyOp(mode: FogMode, pts: Vec[]): FogOp {
  return { m: mode, t: 'poly', p: encodePoints(pts) };
}
export function lineOp(mode: FogMode, pts: Vec[], width: number): FogOp {
  return { m: mode, t: 'line', p: encodePoints(pts), w: Math.round(width * 10) / 10 };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Paint one op onto a mask context (black = fogged). `reveal` erases, `hide` paints, `explored` paints too
 * (on the context that keeps what has been seen: `erase` clears it instead).
 */
export function paintOp(ctx: Ctx2D, op: FogOp, origin: Vec, scale: number, erase = op.m === 'r'): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -origin.x * scale, -origin.y * scale);
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  if (op.t === 'rect') {
    const [x, y, w, h] = op.p.split(',').map(Number);
    if ([x, y, w, h].every(Number.isFinite)) ctx.fillRect(x, y, w, h);
  } else if (op.t === 'poly') {
    ctx.beginPath();
    for (const ring of op.p.split(';')) {
      const pts = decodePoints(ring);
      if (pts.length < 3) continue;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }
    ctx.fill(op.p.includes(';') ? 'evenodd' : 'nonzero');
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
 * Keeps an offscreen canvas holding the fog for one scene. Incremental when ops are only appended (the common case),
 * full redraw otherwise.
 *
 * Three kinds of ground come out of it: never seen (solid black), seen once but out of sight now (`GREY_FOG` of the black) and clear.
 * The fog itself (hide and reveal) and the ground that has been seen (explored) are kept apart and put together into `canvas`.
 */
export class FogMask {
  /** what the fog sprite shows */
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** the fog before any greying: reveal and hide only */
  private fogCanvas = document.createElement('canvas');
  private fogCtx = this.fogCanvas.getContext('2d', { willReadFrequently: true })!;
  /** the ground that has been seen once (white), wiped where the fog is put back */
  private seenCanvas = document.createElement('canvas');
  private seenCtx = this.seenCanvas.getContext('2d', { willReadFrequently: true })!;
  // Token picking queries the same small patches repeatedly while the camera moves.
  private coverTiles = new Map<number, Uint8ClampedArray>();
  private applied: [string, FogOp][] = [];
  private key = '';
  /** whether any ground has been marked as explored (nothing to put together otherwise) */
  private hasSeen = false;
  scale = 1;
  origin: Vec = { x: 0, y: 0 };
  worldW = 0;
  worldH = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
  }

  hasCover = false;

  clear() {
    this.key = '';
    this.hasCover = false;
  }

  /** Returns true if the canvas content changed. */
  sync(ops: [string, FogOp][], settings: FogSettings, rect: Rect, maxSide = 2048): boolean {
    const scale = Math.min(1, maxSide / Math.max(rect.w, rect.h, 1));
    const w = Math.max(1, Math.ceil(rect.w * scale));
    const h = Math.max(1, Math.ceil(rect.h * scale));
    const key = `${settings.base}|${settings.vision}|${settings.explore}|${settings.dim}|${rect.x},${rect.y},${rect.w},${rect.h}|${w}x${h}`;
    const sameBase = key === this.key;
    const isExtension = sameBase && ops.length >= this.applied.length && this.applied.every(([id, op], i) => id === ops[i][0] && op === ops[i][1]);
    if (isExtension && ops.length === this.applied.length) return false;

    if (!isExtension) {
      for (const c of [this.canvas, this.fogCanvas, this.seenCanvas]) {
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      }
      this.scale = scale;
      this.origin = { x: rect.x, y: rect.y };
      this.worldW = rect.w;
      this.worldH = rect.h;
      for (const c of [this.fogCtx, this.seenCtx]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = 'source-over';
        c.clearRect(0, 0, w, h);
      }
      if (settings.base === 'hidden') { this.fogCtx.fillStyle = '#000'; this.fogCtx.fillRect(0, 0, w, h); }
      this.hasSeen = false;
      this.applied = [];
    }
    let checkCover = false;
    if (!isExtension) this.hasCover = settings.base === 'hidden';
    for (let i = this.applied.length; i < ops.length; i++) {
      const op = ops[i][1];
      if (op.m === 'x' && !settings.explore) continue;
      const remembered = settings.vision && settings.explore && settings.dim;
      if (remembered && op.m !== 'h') {
        paintOp(this.seenCtx, op, this.origin, this.scale, false);
        this.hasSeen = true;
      } else {
        paintOp(this.fogCtx, op, this.origin, this.scale, op.m !== 'h');
        if (op.m === 'h') this.hasCover = true;
        checkCover = true;
        // fog put back over ground covers it again: it has to be seen anew
        if (op.m === 'h' && this.hasSeen) paintOp(this.seenCtx, op, this.origin, this.scale, true);
      }
    }
    if (checkCover && this.hasCover) {
      // Stop at the first covered strip. Only a hide/reveal edit needs this check.
      this.hasCover = false;
      for (let y=0;y<h && !this.hasCover;y+=32) {
        const data = this.fogCtx.getImageData(0,y,w,Math.min(32,h-y)).data;
        for (let i=3;i<data.length;i+=4) if (data[i]) { this.hasCover = true; break; }
      }
    }
    this.coverTiles.clear();
    this.applied = ops;
    this.key = key;
    this.compose();
    return true;
  }

  /** The fog, with the explored ground (where there is still fog) let through grey. */
  private compose() {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.fogCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    if (this.hasSeen) {
      ctx.globalAlpha = 1 - GREY_FOG;
      ctx.drawImage(this.seenCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  coveredAt(p: Vec): boolean {
    if (!this.hasCover) return false;
    const x = Math.floor((p.x - this.origin.x) * this.scale), y = Math.floor((p.y - this.origin.y) * this.scale);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return false;
    const left = x - x % 32, top = y - y % 32, key = top * this.canvas.width + left;
    let rgba = this.coverTiles.get(key);
    if (!rgba) {
      rgba = this.fogCtx.getImageData(left, top, 32, 32).data;
      this.coverTiles.set(key, rgba);
    }
    return rgba[((y - top) * 32 + x - left) * 4 + 3] > 127;
  }

  /** Is there fog over this spot, and has the ground there been seen before? (Both false: clear ground.) */
  fogAt(p: Vec): { fog: boolean; seen: boolean } {
    if (!this.hasCover) return {fog:false,seen:false};
    const x = Math.floor((p.x - this.origin.x) * this.scale), y = Math.floor((p.y - this.origin.y) * this.scale);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return { fog: false, seen: false };
    const fog = this.fogCtx.getImageData(x, y, 1, 1).data[3] > 127;
    const seen = fog && this.hasSeen && this.seenCtx.getImageData(x, y, 1, 1).data[3] > 127;
    return { fog, seen };
  }
}
