import { Container, Graphics, Text } from 'pixi.js';
import { LINE_H, beamWidthPx, dashSegments, drawingBounds, fontStack, isTemplate, parsePts, templateGeom, textMetrics } from '../core/draw';
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
}

export const shapeOf = (d: Drawing): Shape => ({ k: d.k, pts: parsePts(d.p), color: d.color, w: d.w, fill: d.fill, fc: d.fc, dash: d.dash, bw: d.bw });

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

/** Paint a shape onto a Graphics object. Text is handled separately by DrawLayer. */
export function paintShape(g: Graphics, s: Shape, grid: GridSettings, alpha = 1) {
  const pts = s.pts;
  if (!pts.length) return;
  const col = hex(s.color);
  const fcol = s.fc ? hex(s.fc) : col;
  const stroke = { width: s.w, color: col, alpha, cap: 'round' as const, join: 'round' as const };

  if (isTemplate(s.k)) {
    if (pts.length < 2) return;
    const geom = templateGeom(s.k, pts[0], pts[1], beamWidthPx(grid, s.bw));
    const fillA = (s.fill > 0 ? s.fill : TEMPLATE_FILL) * alpha;
    if (geom.type === 'circle') g.circle(geom.c.x, geom.c.y, Math.max(0.5, geom.r)).fill({ color: fcol, alpha: fillA });
    else g.poly(geom.pts.flatMap((p) => [p.x, p.y])).fill({ color: fcol, alpha: fillA });
    // an emanation does not include the square it comes out of
    if (s.k === 'emanation' && geom.type === 'circle') {
      const h = grid.cell / 2;
      g.rect(geom.c.x - h, geom.c.y - h, grid.cell, grid.cell).cut();
    }
    if (geom.type === 'circle') g.circle(geom.c.x, geom.c.y, Math.max(0.5, geom.r)).stroke({ ...stroke, width: Math.max(2, s.w) });
    else g.poly(geom.pts.flatMap((p) => [p.x, p.y]), true).stroke({ ...stroke, width: Math.max(2, s.w) });
    // a dot on the point the template starts from (an emanation shows its square instead)
    if (s.k === 'emanation') g.rect(pts[0].x - grid.cell / 2, pts[0].y - grid.cell / 2, grid.cell, grid.cell).stroke({ ...stroke, width: Math.max(1.5, s.w * 0.6) });
    else g.circle(pts[0].x, pts[0].y, Math.max(3, s.w * 1.2)).fill({ color: col, alpha });
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

interface Item { root: Container; g: Graphics; text: Text | null; sig: string }

/** All saved drawings, kept as one Graphics (or Text) per drawing and only repainted when that drawing changes. */
export class DrawLayer {
  readonly container = new Container();
  private items = new Map<string, Item>();
  private grid = '';

  sync(list: Drawing[], grid: GridSettings, textRes: number) {
    const gridSig = `${grid.cell}|${grid.ft}`;
    const gridChanged = gridSig !== this.grid;
    this.grid = gridSig;
    const seen = new Set<string>();
    list.forEach((d, i) => {
      seen.add(d.id);
      const sig = `${d.k}|${d.p}|${d.color}|${d.w}|${d.fill}|${d.fc}|${d.dash}|${d.txt}|${d.fs}|${d.font}|${d.b}|${d.i}|${d.u}|${d.ho}|${d.bw}|${textRes}`;
      let it = this.items.get(d.id);
      if (!it) {
        it = { root: new Container(), g: new Graphics(), text: null, sig: '' };
        it.root.addChild(it.g);
        this.items.set(d.id, it);
        this.container.addChild(it.root);
      }
      it.root.zIndex = i;
      if (it.sig !== sig || gridChanged) {
        it.sig = sig;
        it.g.clear();
        if (d.k === 'text') this.paintText(it, d, textRes);
        else paintShape(it.g, shapeOf(d), grid);
      }
      if (it.text && it.text.resolution !== textRes) it.text.resolution = textRes;
    });
    for (const [id, it] of this.items) {
      if (!seen.has(id)) { it.root.destroy({ children: true }); this.items.delete(id); }
    }
    this.container.sortableChildren = true;
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

  clear() {
    for (const it of this.items.values()) it.root.destroy({ children: true });
    this.items.clear();
    this.grid = '';
  }

  /** Bounds of a drawing for selection outlines. */
  boundsOf(d: Drawing, grid: GridSettings) {
    return drawingBounds(d, beamWidthPx(grid, d.bw));
  }
}
