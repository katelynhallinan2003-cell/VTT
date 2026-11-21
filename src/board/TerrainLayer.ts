import { Container, Sprite, Text, type Texture } from 'pixi.js';
import { cellPoly } from '../core/cells';
import { areaLabel, heightColor, type Area, type Terrain } from '../core/terrain';
import type { GridSettings, Vec } from '../types';
import { canvasTexture } from './textures';

const MAX_SIDE = 2048;
const SELECT_RGB: [number, number, number] = [0x4d, 0xa3, 0xff];

const rgbOf = (h: number): [number, number, number] => {
  const c = parseInt(heightColor(h).slice(1), 16);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
};

/** Where an area's label goes: on a painted spot near the middle of it. */
export function labelSpot(a: Area): Vec {
  const pts = a.paint.flatMap((s) => (s.kind === 'rect' || s.kind === 'ellipse' ? [{ x: s.b.x + s.b.w / 2, y: s.b.y + s.b.h / 2 }] : s.pts));
  if (!pts.length) return { x: a.b.x + a.b.w / 2, y: a.b.y + a.b.h / 2 };
  const cx = pts.reduce((n, p) => n + p.x, 0) / pts.length;
  const cy = pts.reduce((n, p) => n + p.y, 0) / pts.length;
  let best = pts[0], bd = Infinity;
  for (const p of pts) { const d = (p.x - cx) ** 2 + (p.y - cy) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}

/**
 * Paints all the high and low ground as one picture: every pixel is coloured by how high the ground is there once the areas are stacked up
 * (so ground that adds to ground shows its total), with an edge wherever the height changes. Areas that are selected get a bright outline.
 * The picture is rebuilt only when the ground, the grid or the selection changes.
 */
export class TerrainLayer {
  readonly container = new Container();
  private sprite: Sprite | null = null;
  private tex: Texture | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private mask: HTMLCanvasElement | null = null;
  private labels = new Map<string, Text>();
  private key = '';

  /** `selected` holds the ids of the areas to outline. Nothing is built while the layer is hidden. */
  sync(t: Terrain, selected: Set<string>, textRes: number, show: boolean) {
    this.container.visible = show;
    if (!show) return;
    const key = `${t.sig}#${[...selected].sort().join(',')}#${textRes}`;
    if (key === this.key) return;
    this.key = key;
    this.build(t, selected, textRes);
  }

  private build(t: Terrain, selected: Set<string>, textRes: number) {
    const areas = t.areas;
    if (!areas.length) { this.clear(); return; }
    const union = areas.reduce((u, a) => ({ x0: Math.min(u.x0, a.b.x), y0: Math.min(u.y0, a.b.y), x1: Math.max(u.x1, a.b.x + a.b.w), y1: Math.max(u.y1, a.b.y + a.b.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const pad = 3;
    const bx = union.x0 - pad, by = union.y0 - pad;
    const bw = Math.max(2, union.x1 - union.x0 + pad * 2), bh = Math.max(2, union.y1 - union.y0 + pad * 2);
    const s = Math.min(2, MAX_SIDE / Math.max(bw, bh));
    const W = Math.max(2, Math.ceil(bw * s)), H = Math.max(2, Math.ceil(bh * s));
    const grid = t.grid;

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
        if (st.kind === 'rect') mctx.fillRect(st.b.x, st.b.y, st.b.w, st.b.h);
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

    const out = new ImageData(W, H);
    const px = out.data;
    const lut = new Map<number, [number, number, number]>();
    const colour = (h: number) => { const k = Math.round(h); let c = lut.get(k); if (!c) { c = rgbOf(k); lut.set(k, c); } return c; };
    const rad = Math.max(1, Math.round(s * 1.1));
    const srad = Math.max(2, Math.round(s * 2));
    // is something `r` pixels away (left, right, up or down) different? `diff` says what counts as different
    const edgeNear = (x: number, y: number, r: number, diff: (j: number) => boolean) => {
      if (x - r < 0 || y - r < 0 || x + r >= W || y + r >= H) return true;
      const i = y * W + x;
      return diff(i - r) || diff(i + r) || diff(i - r * W) || diff(i + r * W);
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!cov[i]) continue;
        const [r, g, b] = colour(hgt[i]);
        let R = r, G = g, B = b, A = 125;
        if (edgeNear(x, y, rad, (j) => !cov[j] || Math.abs(hgt[j] - hgt[i]) > 0.01)) { R = r * 0.55; G = g * 0.55; B = b * 0.55; A = 235; }
        if (sel[i] && edgeNear(x, y, srad, (j) => !sel[j])) { [R, G, B] = SELECT_RGB; A = 255; }
        const o = i * 4;
        px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = A;
      }
    }
    this.canvas.getContext('2d')!.putImageData(out, 0, 0);
    this.tex!.source.update();
    this.sprite!.position.set(bx, by);
    this.sprite!.scale.set(1 / s);
    this.sprite!.visible = true;

    this.paintLabels(t, textRes);
  }

  private paintLabels(t: Terrain, textRes: number) {
    const seen = new Set<string>();
    const fs = Math.max(9, t.grid.cell * 0.3);
    for (const a of t.areas) {
      seen.add(a.id);
      let tx = this.labels.get(a.id);
      if (!tx) {
        tx = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fontSize: 20, fill: 0xffffff, stroke: { color: 0x000000, width: 4, join: 'round' } } });
        tx.anchor.set(0.5);
        this.container.addChild(tx);
        this.labels.set(a.id, tx);
      }
      const spot = labelSpot(a);
      tx.text = areaLabel(a.h, a.add);
      tx.style.fontSize = fs;
      (tx.style.stroke as { width: number }).width = Math.max(2, fs * 0.2);
      tx.resolution = textRes;
      tx.position.set(spot.x, spot.y);
    }
    for (const [id, tx] of this.labels) if (!seen.has(id)) { tx.destroy(); this.labels.delete(id); }
  }

  private clear() {
    if (this.sprite) this.sprite.visible = false;
    for (const tx of this.labels.values()) tx.destroy();
    this.labels.clear();
  }

  destroy() {
    this.container.destroy({ children: true });
    this.tex?.destroy(true);
  }
}
