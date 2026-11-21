// Geometry for drawings, shapes and spell templates. Pure functions, no rendering.
import type { Drawing, DrawKind, GridSettings, Rect, Vec } from '../types';
import { snapToCorner } from './geometry';

export const TEMPLATE_KINDS: DrawKind[] = ['cone', 'cube', 'sphere', 'beam'];
export const isTemplate = (k: DrawKind) => TEMPLATE_KINDS.includes(k);
/** shapes made from two points (start and end) */
export const isTwoPoint = (k: DrawKind) => k !== 'pen' && k !== 'text';

export const DRAW_COLORS = ['#e03131', '#f08c00', '#fcc419', '#2f9e44', '#1c7ed6', '#7048e8', '#d6336c', '#212529', '#ffffff'];

export const TEMPLATE_LABEL: Record<string, string> = { cone: 'Cone', cube: 'Cube', sphere: 'Sphere', beam: 'Line' };

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
    const w = Math.max(1, d.txt.length) * d.fs * 0.6;
    return { x: pts[0].x, y: pts[0].y - d.fs, w, h: d.fs * 1.3 };
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
      if (solid && d.fill > 0 && inside) return true;
      const e = Math.min(p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y);
      return (inside && e <= reach) || (!inside && Math.max(r.x - p.x, p.x - (r.x + r.w), r.y - p.y, p.y - (r.y + r.h)) <= reach);
    }
    case 'ellipse': {
      if (pts.length < 2) return false;
      const r = boundsOf(pts);
      const rx = Math.max(1, r.w / 2);
      const ry = Math.max(1, r.h / 2);
      const k = Math.hypot((p.x - (r.x + rx)) / rx, (p.y - (r.y + ry)) / ry);
      if (solid && d.fill > 0 && k <= 1) return true;
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
