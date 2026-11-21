// Geometry for drawings, shapes and spell templates. Pure functions, no rendering.
import type { Drawing, DrawKind, GridSettings, Rect, Vec } from '../types';
import { snapToCorner } from './geometry';

export const TEMPLATE_KINDS: DrawKind[] = ['cone', 'cube', 'sphere', 'beam'];
export const isTemplate = (k: DrawKind) => TEMPLATE_KINDS.includes(k);
/** shapes made from two points (start and end) */
export const isTwoPoint = (k: DrawKind) => k !== 'pen' && k !== 'text';

export const DRAW_COLORS = ['#e03131', '#f08c00', '#fcc419', '#2f9e44', '#1c7ed6', '#7048e8', '#d6336c', '#212529', '#ffffff'];

export const TEMPLATE_LABEL: Record<string, string> = { cone: 'Cone', cube: 'Cube', sphere: 'Sphere', beam: 'Line' };

/** What a drawing is called in panels. */
export const DRAW_NAME: Record<DrawKind, string> = {
  pen: 'Pen stroke', line: 'Line', arrow: 'Arrow', rect: 'Box', ellipse: 'Circle', text: 'Text',
  cone: 'Cone', cube: 'Cube', sphere: 'Sphere', beam: 'Line template',
};

/** Outline thickness presets, as a fraction of a grid square. */
export const STROKE_CELLS: Record<'thin' | 'medium' | 'thick', number> = { thin: 0.035, medium: 0.07, thick: 0.15 };

/** How solid a filled shape is. */
export type FillMode = 'none' | 'light' | 'solid';
export const FILL_LEVEL: Record<FillMode, number> = { none: 0, light: 0.3, solid: 1 };
export const fillModeOf = (fill: number): FillMode => (fill <= 0 ? 'none' : fill >= 0.8 ? 'solid' : 'light');

// ------------------------------------------------------------------ text
/** Fonts that exist on most computers (they look a little different from one device to the next). */
export const FONTS: { key: string; label: string; stack: string }[] = [
  { key: '', label: 'Sans', stack: "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif" },
  { key: 'serif', label: 'Serif', stack: "Georgia, 'Times New Roman', Times, serif" },
  { key: 'mono', label: 'Typewriter', stack: "ui-monospace, Consolas, 'Courier New', monospace" },
  { key: 'hand', label: 'Handwriting', stack: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Comic Neue', cursive" },
  { key: 'fantasy', label: 'Fantasy', stack: "Papyrus, Luminari, 'Palatino Linotype', 'Book Antiqua', fantasy" },
];
export const FONT_KEYS = FONTS.map((f) => f.key);
export const fontStack = (key: string) => (FONTS.find((f) => f.key === key) ?? FONTS[0]).stack;
type TextStyleBits = Pick<Drawing, 'fs' | 'font' | 'b' | 'i'>;
/** A CSS font shorthand for a text drawing. */
export const fontCss = (d: TextStyleBits) => `${d.i ? 'italic ' : ''}${d.b ? '700' : '400'} ${d.fs}px ${fontStack(d.font)}`;
/** line height as a multiple of the font size */
export const LINE_H = 1.2;

let lineMeasurer: ((css: string, line: string) => number) | null = null;
/** The board plugs in a real (canvas) measurer; without one, widths are estimated. */
export function setLineMeasurer(fn: ((css: string, line: string) => number) | null) { lineMeasurer = fn; }

export function textMetrics(d: TextStyleBits & Pick<Drawing, 'txt'>): { lines: string[]; widths: number[]; w: number; h: number } {
  const lines = (d.txt || ' ').split('\n');
  const css = fontCss(d);
  const widths = lines.map((l) => (lineMeasurer ? lineMeasurer(css, l || ' ') : (l || ' ').length * d.fs * (d.b ? 0.62 : 0.56)));
  return { lines, widths, w: Math.max(1, ...widths), h: lines.length * d.fs * LINE_H };
}

// ------------------------------------------------------------------ points as strings (compact on the wire)
const r1 = (n: number) => Math.round(n * 10) / 10;

export function parsePts(p: string): Vec[] {
  const out: Vec[] = [];
  const parts = p.split(',');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const x = Number(parts[i]);
    const y = Number(parts[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

export function joinPts(pts: Vec[]): string {
  return pts.map((p) => `${r1(p.x)},${r1(p.y)}`).join(',');
}

export const MAX_PEN_POINTS = 1500;

/** Ramer-Douglas-Peucker: drop points that sit within `tol` of the line between their neighbours. */
export function simplify(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let wi = 0;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]);
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify harder until the stroke fits in the point budget. */
export function fitPenPoints(pts: Vec[], tol: number): Vec[] {
  let out = simplify(pts, tol);
  let t = tol;
  while (out.length > MAX_PEN_POINTS) { t *= 1.6; out = simplify(pts, t); }
  return out;
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function pointInPoly(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------ spell templates
export type TemplateGeom =
  | { type: 'circle'; c: Vec; r: number }
  | { type: 'poly'; pts: Vec[] };

/** Length in feet of a template (radius for spheres), measured along the drag. */
export function templateFt(grid: GridSettings, a: Vec, b: Vec): number {
  return Math.round((Math.hypot(b.x - a.x, b.y - a.y) / grid.cell) * grid.ft * 10) / 10;
}

/**
 * The area a template covers, from its origin `a` and the dragged end point `b`.
 * - sphere: radius = distance, centred on a
 * - cone: apex at a, as wide at its far end as it is long (5e)
 * - cube: side = distance, one face centred on a
 * - beam (line): length = distance, `widthPx` wide
 */
export function templateGeom(kind: DrawKind, a: Vec, b: Vec, widthPx: number): TemplateGeom {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (kind === 'sphere') return { type: 'circle', c: a, r: L };
  const ux = L > 0 ? dx / L : 1;
  const uy = L > 0 ? dy / L : 0;
  const nx = -uy;
  const ny = ux;
  if (kind === 'cone') {
    return { type: 'poly', pts: [a, { x: a.x + ux * L + nx * (L / 2), y: a.y + uy * L + ny * (L / 2) }, { x: a.x + ux * L - nx * (L / 2), y: a.y + uy * L - ny * (L / 2) }] };
  }
  const half = (kind === 'cube' ? L : widthPx) / 2;
  return {
    type: 'poly',
    pts: [
      { x: a.x + nx * half, y: a.y + ny * half },
      { x: a.x + ux * L + nx * half, y: a.y + uy * L + ny * half },
      { x: a.x + ux * L - nx * half, y: a.y + uy * L - ny * half },
      { x: a.x - nx * half, y: a.y - ny * half },
    ],
  };
}

export const beamWidthPx = (grid: GridSettings, bwFt: number) => (Math.max(1, bwFt) / grid.ft) * grid.cell;

/** Text such as "20 ft sphere" for a template while it is being placed. */
export function templateLabel(kind: DrawKind, grid: GridSettings, a: Vec, b: Vec, bwFt: number): string {
  const ft = templateFt(grid, a, b);
  if (kind === 'sphere') return `${ft} ft radius`;
  if (kind === 'beam') return `${ft} ft × ${bwFt} ft line`;
  return `${ft} ft ${kind}`;
}

/**
 * Place a template's drag end on the grid: the origin sticks to the nearest grid corner and the length to whole squares.
 * `angleStep` (radians) also locks the direction, e.g. Math.PI / 12 for 15 degrees.
 */
export function snapTemplate(grid: GridSettings, a: Vec, b: Vec, opts: { origin: boolean; length: boolean; angleStep?: number }): { a: Vec; b: Vec } {
  const A = opts.origin ? snapToCorner(grid, a) : a;
  let dx = b.x - A.x;
  let dy = b.y - A.y;
  let L = Math.hypot(dx, dy);
  let ang = Math.atan2(dy, dx);
  if (opts.angleStep) ang = Math.round(ang / opts.angleStep) * opts.angleStep;
  if (opts.length) L = Math.max(grid.cell, Math.round(L / grid.cell) * grid.cell);
  dx = Math.cos(ang) * L;
  dy = Math.sin(ang) * L;
  return { a: A, b: { x: A.x + dx, y: A.y + dy } };
}

// ------------------------------------------------------------------ geometry of any drawing
export function drawingPts(d: Pick<Drawing, 'p'>): Vec[] { return parsePts(d.p); }

/** World-space bounds (loose for text). */
export function drawingBounds(d: Drawing, widthPx = 0): Rect {
  const pts = parsePts(d.p);
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  if (isTemplate(d.k) && pts.length >= 2) {
    const g = templateGeom(d.k, pts[0], pts[1], widthPx);
    if (g.type === 'circle') return { x: g.c.x - g.r, y: g.c.y - g.r, w: g.r * 2, h: g.r * 2 };
    return boundsOf(g.pts);
  }
  if (d.k === 'text') {
    const m = textMetrics(d);
    return { x: pts[0].x, y: pts[0].y, w: m.w, h: m.h };
  }
  const b = boundsOf(pts);
  const pad = d.w / 2;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

export function boundsOf(pts: Vec[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Is `p` on (or, for filled shapes and templates, inside) the drawing? `tol` is the extra reach in world pixels.
 * With `solid` false only the outline counts (and a template's starting point), so big shapes don't block clicks.
 */
export function hitDrawing(d: Drawing, p: Vec, tol: number, grid: GridSettings, solid = true): boolean {
  const pts = parsePts(d.p);
  if (!pts.length) return false;
  const reach = d.w / 2 + tol;
  switch (d.k) {
    case 'pen': {
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= reach;
      for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= reach) return true;
      return false;
    }
    case 'line':
    case 'arrow':
      return pts.length >= 2 && distToSegment(p, pts[0], pts[1]) <= reach;
    case 'rect': {
      if (pts.length < 2) return false;
      const r = boundsOf(pts);
      const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      if ((solid ? d.fill > 0 : d.fill >= 0.8) && inside) return true;
      const e = Math.min(p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y);
      return (inside && e <= reach) || (!inside && Math.max(r.x - p.x, p.x - (r.x + r.w), r.y - p.y, p.y - (r.y + r.h)) <= reach);
    }
    case 'ellipse': {
      if (pts.length < 2) return false;
      const r = boundsOf(pts);
      const rx = Math.max(1, r.w / 2);
      const ry = Math.max(1, r.h / 2);
      const k = Math.hypot((p.x - (r.x + rx)) / rx, (p.y - (r.y + ry)) / ry);
      if ((solid ? d.fill > 0 : d.fill >= 0.8) && k <= 1) return true;
      // within `reach` of the outline, measured roughly in pixels
      return Math.abs(k - 1) * Math.min(rx, ry) <= reach;
    }
    case 'text': {
      const b = drawingBounds(d);
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    }
    default: {
      if (pts.length < 2) return false;
      const g = templateGeom(d.k, pts[0], pts[1], beamWidthPx(grid, d.bw));
      if (solid) {
        if (g.type === 'circle') return Math.hypot(p.x - g.c.x, p.y - g.c.y) <= g.r + tol;
        return pointInPoly(p, g.pts);
      }
      const edge = Math.max(tol, d.w / 2);
      if (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= edge + 6) return true;
      if (g.type === 'circle') return Math.abs(Math.hypot(p.x - g.c.x, p.y - g.c.y) - g.r) <= edge;
      for (let i = 0; i < g.pts.length; i++) if (distToSegment(p, g.pts[i], g.pts[(i + 1) % g.pts.length]) <= edge) return true;
      return false;
    }
  }
}

/** The same drawing moved by (dx, dy). */
export function movedPoints(d: Pick<Drawing, 'p'>, dx: number, dy: number): string {
  return joinPts(parsePts(d.p).map((p) => ({ x: p.x + dx, y: p.y + dy })));
}

// ------------------------------------------------------------------ line dashing
/** Split a polyline into dash segments. Returns [from, to] pairs. */
export function dashSegments(pts: Vec[], dash: number, gap: number): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  let draw = true;
  let left = dash;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    const ux = (b.x - a.x) / seg;
    const uy = (b.y - a.y) / seg;
    while (seg > 0) {
      const step = Math.min(left, seg);
      const n = { x: a.x + ux * step, y: a.y + uy * step };
      if (draw) out.push([a, n]);
      a = n;
      seg -= step;
      left -= step;
      if (left <= 1e-6) { draw = !draw; left = draw ? dash : gap; }
    }
  }
  return out;
}

// ------------------------------------------------------------------ editing: handles, resizing, sizes in feet
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'a' | 'b';
export interface Handle { id: HandleId; x: number; y: number }

/** The little squares you can drag to resize a selected drawing. */
export function handlesOf(d: Drawing): Handle[] {
  const pts = parsePts(d.p);
  if (!pts.length) return [];
  switch (d.k) {
    case 'rect':
    case 'ellipse': {
      if (pts.length < 2) return [];
      const r = boundsOf(pts);
      const xs = [r.x, r.x + r.w / 2, r.x + r.w];
      const ys = [r.y, r.y + r.h / 2, r.y + r.h];
      return [
        { id: 'nw', x: xs[0], y: ys[0] }, { id: 'n', x: xs[1], y: ys[0] }, { id: 'ne', x: xs[2], y: ys[0] },
        { id: 'e', x: xs[2], y: ys[1] }, { id: 'se', x: xs[2], y: ys[2] }, { id: 's', x: xs[1], y: ys[2] },
        { id: 'sw', x: xs[0], y: ys[2] }, { id: 'w', x: xs[0], y: ys[1] },
      ];
    }
    case 'line':
    case 'arrow':
      return pts.length >= 2 ? [{ id: 'a', x: pts[0].x, y: pts[0].y }, { id: 'b', x: pts[1].x, y: pts[1].y }] : [];
    case 'text': {
      const b = drawingBounds(d);
      return [{ id: 'se', x: b.x + b.w, y: b.y + b.h }];
    }
    case 'pen':
      return [];
    default:
      return pts.length >= 2 ? [{ id: 'b', x: pts[1].x, y: pts[1].y }] : [];
  }
}

export const clampFs = (n: number) => Math.min(400, Math.max(6, Math.round(n * 10) / 10));

/**
 * What changes when a handle is dragged to `to`.
 * Boxes and circles move the edge or corner (Shift keeps the proportions), lines move one end (Shift locks the angle),
 * text grows or shrinks, and a template's far end sets its length and direction.
 */
export function resizeDrawing(d: Drawing, handle: HandleId, to: Vec, opts: { shift?: boolean; alt?: boolean; grid: GridSettings }): Partial<Pick<Drawing, 'p' | 'fs'>> {
  const pts = parsePts(d.p);
  switch (d.k) {
    case 'rect':
    case 'ellipse': {
      if (pts.length < 2) return {};
      const r = boundsOf(pts);
      let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
      const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s');
      if (opts.shift && handle.length === 2 && r.w > 0 && r.h > 0) {
        const ox = west ? x1 : x0;
        const oy = north ? y1 : y0;
        const dx = to.x - ox, dy = to.y - oy;
        const k = Math.max(Math.abs(dx) / r.w, Math.abs(dy) / r.h);
        to = { x: ox + (dx < 0 ? -1 : 1) * r.w * k, y: oy + (dy < 0 ? -1 : 1) * r.h * k };
      }
      if (west) x0 = to.x;
      if (east) x1 = to.x;
      if (north) y0 = to.y;
      if (south) y1 = to.y;
      return { p: joinPts([{ x: Math.min(x0, x1), y: Math.min(y0, y1) }, { x: Math.max(x0, x1), y: Math.max(y0, y1) }]) };
    }
    case 'line':
    case 'arrow': {
      if (pts.length < 2 || (handle !== 'a' && handle !== 'b')) return {};
      const fixed = handle === 'a' ? pts[1] : pts[0];
      let moved = to;
      if (opts.shift) {
        const L = Math.hypot(to.x - fixed.x, to.y - fixed.y);
        const ang = Math.round(Math.atan2(to.y - fixed.y, to.x - fixed.x) / (Math.PI / 12)) * (Math.PI / 12);
        moved = { x: fixed.x + Math.cos(ang) * L, y: fixed.y + Math.sin(ang) * L };
      }
      return { p: joinPts(handle === 'a' ? [moved, fixed] : [fixed, moved]) };
    }
    case 'text': {
      const b = drawingBounds(d);
      if (b.w <= 0 || b.h <= 0) return {};
      const k = Math.max((to.x - b.x) / b.w, (to.y - b.y) / b.h);
      return { fs: clampFs(d.fs * Math.max(0.1, k)) };
    }
    case 'pen':
      return {};
    default: {
      if (pts.length < 2 || handle !== 'b') return {};
      const sn = snapTemplate(opts.grid, pts[0], to, { origin: false, length: !opts.alt, angleStep: opts.shift ? Math.PI / 12 : undefined });
      return { p: joinPts([pts[0], sn.b]) };
    }
  }
}

/** Width and height of a box or circle, or the length of a line, arrow or template, in feet. Null for the rest. */
export function sizeFt(d: Drawing, grid: GridSettings): { w: number; h: number } | { len: number } | null {
  const pts = parsePts(d.p);
  if (pts.length < 2) return null;
  const toFt = (px: number) => Math.round((px / grid.cell) * grid.ft * 10) / 10;
  if (d.k === 'rect' || d.k === 'ellipse') {
    const r = boundsOf(pts);
    return { w: toFt(r.w), h: toFt(r.h) };
  }
  if (d.k === 'pen' || d.k === 'text') return null;
  return { len: toFt(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)) };
}

/** Set one dimension of a shape from a number of feet. Boxes keep their top-left corner; lines keep their start and direction. */
export function withSizeFt(d: Drawing, grid: GridSettings, dim: 'w' | 'h' | 'len', ft: number): Partial<Pick<Drawing, 'p'>> {
  const pts = parsePts(d.p);
  if (pts.length < 2 || !(ft > 0)) return {};
  const px = Math.max(1, (ft / grid.ft) * grid.cell);
  if (d.k === 'rect' || d.k === 'ellipse') {
    const r = boundsOf(pts);
    const w = dim === 'w' ? px : r.w;
    const h = dim === 'h' ? px : r.h;
    return { p: joinPts([{ x: r.x, y: r.y }, { x: r.x + w, y: r.y + h }]) };
  }
  if (dim !== 'len' || d.k === 'pen' || d.k === 'text') return {};
  const L = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
  const ux = (pts[1].x - pts[0].x) / L, uy = (pts[1].y - pts[0].y) / L;
  return { p: joinPts([pts[0], { x: pts[0].x + ux * px, y: pts[0].y + uy * px }]) };
}
