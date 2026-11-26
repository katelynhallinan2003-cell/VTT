import { Container, Sprite, Text, type Texture } from 'pixi.js';
import { cellPoly } from '../core/cells';
import { areaLabelAt, heightColor, type Terrain } from '../core/terrain';
import { terrainLabelBoxes } from '../core/terrainLabels';
import { groundAt } from '../core/height';
import type { Rect } from '../types';
import { canvasTexture } from './textures';

const MAX_SIDE = 2048;
const SELECT_RGB: [number, number, number] = [0x4d, 0xa3, 0xff];

const rgbOf = (h: number): [number, number, number] => {
  const c = parseInt(heightColor(h).slice(1), 16);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
};

/** Blur a field with a box of radius `r` (edges repeat), twice, which is close enough to a Gaussian for shading. */
function blur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const run = (from: Float32Array, to: Float32Array, len: number, lines: number, stride: number, step: number) => {
    const n = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += from[base + Math.max(0, Math.min(len - 1, k)) * step];
      for (let i = 0; i < len; i++) {
        to[base + i * step] = sum / n;
        sum += from[base + Math.min(len - 1, i + r + 1) * step] - from[base + Math.max(0, i - r) * step];
      }
    }
  };
  let a = src, b = tmp;
  for (let pass = 0; pass < 2; pass++) {
    run(a, b, W, H, W, 1);
    run(b, out, H, W, 1, W);
    a = out; b = tmp;
  }
  return out;
}

/**
 * Paints all the high and low ground as one soft picture: a light tint by height (ground that adds to ground shows its total), a shadow
 * that falls on the lower side of every drop and a faint highlight on the upper side, and a thin line wherever the height changes.
 * Areas that are selected get a bright outline. The picture is rebuilt only when the ground, the grid or the selection changes.
 */
export class TerrainLayer {
  readonly container = new Container();
  private sprite: Sprite | null = null;
  private tex: Texture | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private mask: HTMLCanvasElement | null = null;
  private labels = new Map<number, Text>();
  private labelBoxes: (Rect & { elevation: number })[] = [];
  private zoom = 1;
  private coveredLabels: Text[] = [];
  private key = '';

  /** `selected` holds the ids of the areas to outline; `labels` says whether each area is named. Nothing is built while the layer is hidden. */
  sync(t: Terrain, selected: Set<string>, show: boolean, labels = true, warm = false) {
    this.container.visible = show;
    if (!show && !warm) return;
    const key = `${t.sig}#${[...selected].sort().join(',')}#${labels ? 1 : 0}`;
    if (key === this.key) return;
    this.key = key;
    this.build(t, selected, labels);
  }

  private build(t: Terrain, selected: Set<string>, labels: boolean) {
    const areas = t.areas;
    if (!areas.length) { this.clear(); return; }
    const grid = t.grid;
    const union = areas.reduce((u, a) => ({ x0: Math.min(u.x0, a.b.x), y0: Math.min(u.y0, a.b.y), x1: Math.max(u.x1, a.b.x + a.b.w), y1: Math.max(u.y1, a.b.y + a.b.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    // room around the edge for the shadows that fall outside the high ground
    const pad = Math.max(6, grid.cell * 0.7);
    const bx = union.x0 - pad, by = union.y0 - pad;
    const bw = Math.max(2, union.x1 - union.x0 + pad * 2), bh = Math.max(2, union.y1 - union.y0 + pad * 2);
    const s = Math.min(2, MAX_SIDE / Math.max(bw, bh));
    const W = Math.max(2, Math.ceil(bw * s)), H = Math.max(2, Math.ceil(bh * s));

    if (!this.canvas || this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = W; this.canvas.height = H;
      this.mask = document.createElement('canvas');
      this.mask.width = W; this.mask.height = H;
      this.tex?.destroy(true);
      this.tex = canvasTexture(this.canvas);
      if (!this.sprite) { this.sprite = new Sprite(this.tex); this.container.addChildAt(this.sprite, 0); } else this.sprite.texture = this.tex;
    }
    const mctx = this.mask!.getContext('2d', { willReadFrequently: true })!;
    const N = W * H;
    const hgt = new Float32Array(N);
    const cov = new Uint8Array(N);
    const sel = new Uint8Array(N);

    for (const a of areas) {
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, W, H);
      mctx.setTransform(s, 0, 0, s, -bx * s, -by * s);
      mctx.fillStyle = mctx.strokeStyle = '#fff';
      for (const st of a.strokes) {
        mctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
        if (st.kind === 'polygon') {
          mctx.beginPath();
          for (const ring of st.rings!) {
            mctx.moveTo(ring[0].x, ring[0].y);
            for (const p of ring.slice(1)) mctx.lineTo(p.x,p.y);
            mctx.closePath();
          }
          mctx.fill('evenodd');
        } else if (st.kind === 'rect') mctx.fillRect(st.b.x, st.b.y, st.b.w, st.b.h);
        else if (st.kind === 'ellipse') { mctx.beginPath(); mctx.ellipse(st.b.x + st.b.w / 2, st.b.y + st.b.h / 2, Math.max(0.5, st.b.w / 2), Math.max(0.5, st.b.h / 2), 0, 0, Math.PI * 2); mctx.fill(); }
        else if (st.kind === 'cells') {
          mctx.beginPath();
          for (const c of st.pts) { const poly = cellPoly(grid, c); mctx.moveTo(poly[0].x, poly[0].y); for (let i = 1; i < poly.length; i++) mctx.lineTo(poly[i].x, poly[i].y); mctx.closePath(); }
          mctx.fill();
        } else if (st.pts.length === 1) { mctx.beginPath(); mctx.arc(st.pts[0].x, st.pts[0].y, st.r, 0, Math.PI * 2); mctx.fill(); }
        else {
          mctx.lineWidth = st.r * 2; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
          mctx.beginPath(); mctx.moveTo(st.pts[0].x, st.pts[0].y);
          for (let i = 1; i < st.pts.length; i++) mctx.lineTo(st.pts[i].x, st.pts[i].y);
          mctx.stroke();
        }
      }
      mctx.globalCompositeOperation = 'source-over';
      const data = mctx.getImageData(0, 0, W, H).data;
      const isSel = selected.has(a.id);
      for (let i = 0, j = 3; i < N; i++, j += 4) {
        if (data[j] < 128) continue;
        hgt[i] = a.add && cov[i] ? hgt[i] + a.h : a.h;
        cov[i] = 1;
        if (isSel) sel[i] = 1;
      }
    }

    // soft shading: compare each pixel with the ground around it
    const R = Math.max(1, Math.min(MAX_SIDE / 2, Math.round(s * grid.cell / 4)));
    const around = blur(hgt, W, H, R);
    // a faint contour wherever the height changes, softened by a small blur
    const rad = Math.max(1, Math.round(s * Math.max(0.5, grid.cell * 0.01)));
    const edge = new Float32Array(N);
    for (let y = rad; y < H - rad; y++) {
      for (let x = rad; x < W - rad; x++) {
        const i = y * W + x;
        if (!cov[i]) continue;
        const l = i - rad, r = i + rad, u = i - rad * W, d = i + rad * W;
        if (Math.max(Math.abs(hgt[l] - hgt[i]), Math.abs(hgt[r] - hgt[i]), Math.abs(hgt[u] - hgt[i]), Math.abs(hgt[d] - hgt[i])) > 0) edge[i] = 1;
      }
    }
    const line = blur(edge, W, H, 1);
    const nearLedge = blur(edge, W, H, R);
    const softCover = blur(Float32Array.from(cov), W, H, R);
    const ring = new Float32Array(N); // the outline of the selected areas
    const rs = Math.max(2, Math.round(s * 2.2));
    for (let y = rs; y < H - rs; y++) {
      for (let x = rs; x < W - rs; x++) {
        const i = y * W + x;
        if (sel[i] && (!sel[i - rs] || !sel[i + rs] || !sel[i - rs * W] || !sel[i + rs * W])) ring[i] = 1;
      }
    }

    const out = new ImageData(W, H);
    const px = out.data;
    const lut = new Map<number, [number, number, number]>();
    if (labels) {
      const heights = new Set<number>();
      for (let i = 0; i < N; i++) if (cov[i]) heights.add(hgt[i]);
      const levels = [...heights].sort((a,b) => a-b);
      const stops = [[53,139,177],[65,174,150],[169,197,105],[236,203,111],[216,140,111],[157,122,172]];
      levels.forEach((h,index) => {
        const v = levels.length === 1 ? 1 : index*(stops.length-1)/(levels.length-1);
        const lo = Math.floor(v), hi = Math.ceil(v);
        const channel = (c: number) => stops[lo][c]+(stops[hi][c]-stops[lo][c])*(v-lo);
        lut.set(h,[channel(0),channel(1),channel(2)]);
      });
    }
    const colour = (h: number) => { const k = Math.round(h); let c = lut.get(k); if (!c) { c = rgbOf(k); lut.set(k, c); } return c; };
    for (let i = 0; i < N; i++) {
      // tint, only on the ground itself
      let a = 0, R_ = 0, G_ = 0, B_ = 0;
      const sharp = labels || nearLedge[i] > 0.00001;
      const coverage = sharp ? cov[i] : softCover[i];
      if (coverage) { const c = colour(sharp ? hgt[i] : around[i]); R_ = c[0]; G_ = c[1]; B_ = c[2]; a = (labels ? 0.36 : 0.24) * coverage; }
      // shadow on the low side of a drop, light on the high side
      const d = sharp ? around[i] - hgt[i] : around[Math.min(N - 1, i + W)] - around[Math.max(0, i - W)];
      const k = Math.min(1, Math.abs(d) / 6) ** 0.7;
      const sh = d > 0.05 ? 0.28 * k : 0;
      const hi = d < -0.05 ? 0.18 * k : 0;
      const over = (cr: number, cg: number, cb: number, ca: number) => {
        if (ca <= 0) return;
        const oa = ca + a * (1 - ca);
        R_ = (cr * ca + R_ * a * (1 - ca)) / oa; G_ = (cg * ca + G_ * a * (1 - ca)) / oa; B_ = (cb * ca + B_ * a * (1 - ca)) / oa;
        a = oa;
      };
      over(10, 12, 20, sh);
      over(255, 255, 255, hi);
      if (cov[i] && line[i] > 0.02) { const c = colour(hgt[i]); over(c[0] * 0.4, c[1] * 0.4, c[2] * 0.4, 0.58 * line[i]); }
      if (ring[i]) over(SELECT_RGB[0], SELECT_RGB[1], SELECT_RGB[2], 1);
      const o = i * 4;
      px[o] = R_; px[o + 1] = G_; px[o + 2] = B_; px[o + 3] = Math.round(Math.min(1, a) * 255);
    }
    this.canvas.getContext('2d')!.putImageData(out, 0, 0);
    this.tex!.source.update();
    this.sprite!.position.set(bx, by);
    this.sprite!.scale.set(1 / s);
    this.sprite!.visible = true;

    this.labelBoxes = labels ? terrainLabelBoxes(hgt, cov, W, H).map(box => ({
      elevation: box.elevation, x: bx + box.x / s, y: by + box.y / s, w: box.w / s, h: box.h / s,
    })).filter(box => groundAt(t, { x: box.x + box.w / 2, y: box.y + box.h / 2 }) === box.elevation) : [];
    this.layoutLabels();
  }

  setZoom(zoom: number) {
    if (this.zoom === zoom) return;
    this.zoom = zoom;
    this.layoutLabels();
  }

  private layoutLabels() {
    const zoom = this.zoom;
    const seen = new Set<number>();
    for (let i = 0; i < this.labelBoxes.length; i++) {
      const box = this.labelBoxes[i];
      if (box.w * zoom < 24 || box.h * zoom < 13) continue;
      let tx = this.labels.get(i);
      if (!tx) {
        tx = new Text({ style: { fontFamily: 'system-ui, sans-serif', fontWeight: '600', fontSize: 14, fill: 0xffffff, stroke: { color: 0x18191d, width: 3, join: 'round' } } });
        tx.anchor.set(0.5);
        tx.resolution = Math.max(1, window.devicePixelRatio || 1);
        this.container.addChild(tx);
        this.labels.set(i, tx);
      }
      tx.text = areaLabelAt(box.elevation);
      const bounds = tx.getLocalBounds();
      const scale = Math.min(1 / zoom, (box.w - 4 / zoom) / bounds.width, (box.h - 4 / zoom) / bounds.height);
      if (scale * zoom < 0.75) continue;
      tx.scale.set(scale);
      tx.position.set(box.x + box.w / 2, box.y + box.h / 2);
      seen.add(i);
    }
    for (const [i, tx] of this.labels) if (!seen.has(i)) { tx.destroy(); this.labels.delete(i); }
  }

  /** The brush readout shares world coordinates with the terrain labels and takes precedence while painting. */
  avoidBrushReadout(readout?: Text) {
    for (const label of this.coveredLabels) if (!label.destroyed) label.renderable = true;
    this.coveredLabels.length = 0;
    if (!readout) return;
    const halfWidth = readout.width / 2 + 2 / this.zoom;
    const top = readout.y - readout.height - 2 / this.zoom;
    for (const label of this.labels.values()) {
      if (Math.abs(label.x - readout.x) >= halfWidth + label.width / 2 ||
          label.y + label.height / 2 <= top || label.y - label.height / 2 >= readout.y + 2 / this.zoom) continue;
      label.renderable = false;
      this.coveredLabels.push(label);
    }
  }

  private clear() {
    if (this.sprite) this.sprite.visible = false;
    for (const tx of this.labels.values()) tx.destroy();
    this.labels.clear();
    this.labelBoxes = [];
  }

  destroy() {
    this.container.destroy({ children: true });
    this.tex?.destroy(true);
  }
}
