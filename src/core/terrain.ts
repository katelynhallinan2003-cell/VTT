// Terrain: ground that is higher or lower, painted with a brush (or drawn as old-style boxes and circles).
//
// An AREA is everything painted with one height. Each brush stroke is a drawing of kind 'terrain' that says which area it belongs to (`hg`),
// so an area can be painted a bit at a time and still be selected, moved, raised and deleted as one thing.
// A stroke is either FREE (a round brush following the pointer) or CELLS (whole squares or hexes, listed by their centres).
// An erase stroke (`he`) takes ground away from the area it names, or from every area when it names none.
//
// Where areas overlap, they are folded from the bottom up. An area either SETS the height there ("this ground is at 20 ft")
// or ADDS to whatever is below it ("5 ft more than the ground under me"), so a 5 ft ramp on a 20 ft hill is 25 ft high
// and a 20 ft ledge painted over it is simply 20 ft.
import type { Drawing, GridSettings, Rect, Vec } from '../types';
import { cellPoly } from './cells';
import { boundsOf, distToSegment, parsePts, pointInPoly } from './draw';
import { snapToCellCenter, snapToCorner } from './geometry';
import { hexAt, hexToPx, isHex } from './hex';

export type StrokeKind = 'free' | 'cells' | 'rect' | 'ellipse' | 'polygon';

export interface TStroke {
  id: string;
  /** which area it belongs to ('' for an erase stroke that is not tied to one) */
  hg: string;
  /** when it was made (strokes are applied in this order) */
  t: number;
  erase: boolean;
  kind: StrokeKind;
  pts: Vec[];
  /** brush radius in pixels (free strokes) */
  r: number;
  /** loose bounds, brush included */
  b: Rect;
  /** the cells it covers, by key (cell strokes) */
  cells?: Set<string>;
  rings?: Vec[][];
}

export interface Area {
  /** the group id of a brush area, or the id of the box or circle for an old-style one */
  id: string;
  legacy: boolean;
  /** the height in feet */
  h: number;
  /** adds to the ground below instead of setting it */
  add: boolean;
  /** stacking order, bottom first */
  order: number;
  /** every stroke that shapes it, in the order they were made (erase strokes included) */
  strokes: TStroke[];
  /** just the ones that paint (their drawing ids are what selecting the area selects) */
  paint: TStroke[];
  /** the drawing ids that belong to this area alone: its paint strokes and the erase strokes aimed at it */
  ids: string[];
  b: Rect;
}

export interface Terrain {
  areas: Area[];
  grid: GridSettings;
  /** changes whenever anything that affects the ground does */
  sig: string;
}

export const EMPTY_TERRAIN = (grid: GridSettings): Terrain => ({ areas: [], grid, sig: '' });

/** Most cells one brush stroke may paint (so a mistaken huge sweep never freezes anything). */
export const MAX_STROKE_CELLS = 4000;

// ------------------------------------------------------------------ cells
/** A key for the cell that contains (or is centred at) `p`. */
export function cellKey(grid: GridSettings, p: Vec): string {
  const c = snapToCellCenter(grid, p);
  return `${Math.round(c.x * 2)},${Math.round(c.y * 2)}`;
}

/**
 * The cells a brush `n` cells across covers when its middle is at `p`: an n-by-n block (centred on the nearest square, or on the nearest
 * corner when n is even), or on a hex grid a hexagonal patch (1, 7, 19… cells).
 */
export function cellsAround(grid: GridSettings, p: Vec, n: number): Vec[] {
  const size = Math.max(1, Math.round(n));
  const out: Vec[] = [];
  if (isHex(grid)) {
    const h0 = hexAt(grid, p);
    const k = size - 1;
    for (let dq = -k; dq <= k; dq++) {
      for (let dr = -k; dr <= k; dr++) {
        if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) > k) continue;
        out.push(hexToPx(grid, h0.q + dq, h0.r + dr));
      }
    }
    return out;
  }
  const c = grid.cell;
  const base = size % 2 === 1 ? snapToCellCenter(grid, p) : snapToCorner(grid, p);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) out.push({ x: base.x + (i - (size - 1) / 2) * c, y: base.y + (j - (size - 1) / 2) * c });
  return out;
}

/** Cells from `a` to `b`, so a quick sweep of the pointer leaves no gaps. */
export function cellsAlong(grid: GridSettings, a: Vec, b: Vec, n: number): Vec[] {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(L / (grid.cell * 0.3)));
  const out: Vec[] = [];
  for (let i = 0; i <= steps; i++) out.push(...cellsAround(grid, { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }, n));
  return out;
}

// ------------------------------------------------------------------ reading strokes and areas
const strokeBounds = (kind: StrokeKind, pts: Vec[], r: number): Rect => {
  const b = boundsOf(pts);
  const pad = kind === 'polygon' || kind === 'rect' || kind === 'ellipse' ? 0 : r;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
};

function strokeOf(d: Drawing, grid: GridSettings): TStroke | null {
  const pts = parsePts(d.p);
  if (!pts.length) return null;
  const kind: StrokeKind = d.k === 'rect' ? 'rect' : d.k === 'ellipse' ? 'ellipse' : d.hr ? 'polygon' : d.hc ? 'cells' : 'free';
  if ((kind === 'rect' || kind === 'ellipse') && pts.length < 2) return null;
  // a cell stroke's pad is the reach of its cells' corners; a free stroke's is half the brush
  const r = kind === 'cells' ? (isHex(grid) ? grid.cell * 0.6 : grid.cell * 0.5) : Math.max(0.5, d.w / 2);
  const s: TStroke = { id: d.id, hg: d.hg ?? '', t: d.t, erase: !!d.he, kind, pts, r, b: strokeBounds(kind, pts, r) };
  if (kind === 'polygon') {
    let offset = 0;
    s.rings = [];
    for (const count of d.hr!.split(',').map(Number)) {
      if (!Number.isSafeInteger(count) || count < 3 || count > pts.length - offset) return null;
      s.rings.push(pts.slice(offset, offset + count));
      offset += count;
    }
    if (offset !== pts.length) return null;
  }
  if (kind === 'cells') s.cells = new Set(pts.map((p) => cellKey(grid, p)));
  return s;
}

/** Does this stroke cover the point? */
export function strokeCovers(s: TStroke, p: Vec, grid: GridSettings, key?: string): boolean {
  const b = s.b;
  if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) return false;
  switch (s.kind) {
    case 'polygon': return s.rings!.reduce((inside, ring) => pointInPoly(p, ring) !== inside, false);
    case 'rect': return true;
    case 'ellipse': {
      const rx = Math.max(1e-6, b.w / 2), ry = Math.max(1e-6, b.h / 2);
      return ((p.x - (b.x + rx)) / rx) ** 2 + ((p.y - (b.y + ry)) / ry) ** 2 <= 1;
    }
    case 'cells': return !!s.cells?.has(key ?? cellKey(grid, p));
    default: {
      if (s.pts.length === 1) return Math.hypot(p.x - s.pts[0].x, p.y - s.pts[0].y) <= s.r;
      for (let i = 1; i < s.pts.length; i++) if (distToSegment(p, s.pts[i - 1], s.pts[i]) <= s.r) return true;
      return false;
    }
  }
}

const unionRect = (rs: Rect[]): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
};

/** Everything about the ground in one place. Old-style boxes and circles come first (smallest on top), then painted areas in the order they were started. */
export function terrainOf(draws: Iterable<Drawing>, grid: GridSettings, layer: 'ground' | 'rough' | 'day' | 'dim' = 'ground'): Terrain {
  const legacy: Area[] = [];
  const groups = new Map<string, { paint: Drawing[]; hz: number; add: boolean }>();
  const erasers: Drawing[] = [];
  const sigParts: string[] = [];
  for (const d of draws) {
    if (d.hz == null && d.k !== 'terrain') continue;
    // difficult ground and daylight are painted with the same brush but are layers of their own: they never change how high anything is
    if ((d.dt ? 'rough' : d.dl ? (d.dd ? 'dim' : 'day') : 'ground') !== layer) continue;
    sigParts.push(`${d.id}|${d.k}|${d.p}|${d.w}|${d.hz}|${d.hg ?? ''}|${d.ha ? 1 : 0}|${d.he ? 1 : 0}|${d.hc ? 1 : 0}|${d.hr ?? ''}|${d.t}`);
    if (d.k === 'terrain') {
      if (d.he) { erasers.push(d); continue; }
      if (d.hz == null) continue;
      const g = d.hg || d.id;
      const cur = groups.get(g);
      if (cur) cur.paint.push(d); else groups.set(g, { paint: [d], hz: d.hz, add: !!d.ha });
    } else if ((d.k === 'rect' || d.k === 'ellipse') && d.hz != null) {
      const s = strokeOf(d, grid);
      if (!s) continue;
      legacy.push({ id: d.id, legacy: true, h: d.hz, add: false, order: 0, strokes: [s], paint: [s], ids: [d.id], b: s.b });
    }
  }
  // old-style: bigger ones go below, so a nest drawn inside a cliff counts as the nest
  legacy.sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h || a.strokes[0].t - b.strokes[0].t);
  const eras = erasers.map((d) => strokeOf(d, grid)).filter((s): s is TStroke => !!s);
  for (const a of legacy) {
    const cuts = eras.filter(e => e.hg === a.id).sort((x,y) => x.t-y.t || x.id.localeCompare(y.id));
    a.strokes.push(...cuts);
    a.ids.push(...cuts.map(s => s.id));
  }
  const painted: Area[] = [];
  for (const [id, g] of groups) {
    const paint = g.paint.map((d) => strokeOf(d, grid)).filter((s): s is TStroke => !!s);
    if (!paint.length) continue;
    const mine = eras.filter((e) => e.hg === id);
    const all = [...paint, ...mine, ...eras.filter((e) => e.hg === '')].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    // the area's height and mode are those of its first stroke (editing an area rewrites all of them together)
    const first = [...g.paint].sort((a, b) => a.t - b.t)[0];
    painted.push({ id, legacy: false, h: first.hz ?? g.hz, add: !!first.ha, order: 0, strokes: all, paint, ids: [...paint, ...mine].map((s) => s.id), b: unionRect(paint.map((s) => s.b)) });
  }
  painted.sort((a, b) => Math.min(...a.paint.map((s) => s.t)) - Math.min(...b.paint.map((s) => s.t)) || (a.id < b.id ? -1 : 1));
  const areas = [...legacy, ...painted];
  areas.forEach((a, i) => { a.order = i; });
  return { areas, grid, sig: `${layer}|${grid.shape}|${grid.ft}|${grid.cell}|${grid.ox}|${grid.oy}#${sigParts.join(';')}` };
}

/** The box around everything painted (null when nothing is). */
export function terrainBounds(t: Terrain): Rect | null {
  if (!t.areas.length) return null;
  return unionRect(t.areas.map((a) => a.b));
}

/** Is this point part of the area? (erase strokes taking away what earlier strokes painted) */
export function areaHas(a: Area, p: Vec, grid: GridSettings): boolean {
  if (p.x < a.b.x || p.x > a.b.x + a.b.w || p.y < a.b.y || p.y > a.b.y + a.b.h) return false;
  let inside = false;
  let key: string | undefined;
  for (const s of a.strokes) {
    if (s.kind === 'cells' && key === undefined) key = cellKey(grid, p);
    if (strokeCovers(s, p, grid, key)) inside = !s.erase;
  }
  return inside;
}

/** How high the ground is at a point, in feet: the areas folded from the bottom up. No area means 0. */
export function groundAtTerrain(t: Terrain, p: Vec): number {
  let h = 0;
  for (const a of t.areas) if (areaHas(a, p, t.grid)) h = a.add ? h + a.h : a.h;
  return h;
}

/** The top-most painted area at a point (null for open ground). Old-style boxes and circles do not count. */
export function paintedAreaAt(t: Terrain, p: Vec): Area | null {
  for (let i = t.areas.length - 1; i >= 0; i--) {
    const a = t.areas[i];
    if (!a.legacy && areaHas(a, p, t.grid)) return a;
  }
  return null;
}

/** The top-most area of any kind at a point. */
export function areaAt(t: Terrain, p: Vec): Area | null {
  for (let i = t.areas.length - 1; i >= 0; i--) if (areaHas(t.areas[i], p, t.grid)) return t.areas[i];
  return null;
}

/** The areas that have at least one stroke selected. */
export const areasSelected = (t: Terrain, sel: ReadonlySet<string>): Area[] => (sel.size ? t.areas.filter((a) => a.ids.some((id) => sel.has(id))) : []);

/** A fresh id for a new area (any short random string will do: it only has to differ from the others). */
export const newAreaId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** The outline of one cell of the grid, for drawing the cells a stroke covers. */
export const strokeCellPolys = (s: TStroke, grid: GridSettings): Vec[][] => s.pts.map((c) => cellPoly(grid, c));

/** The resulting ground elevation shown on the map. */
export function areaLabelAt(total: number): string {
  return `${Math.round(total)} ft`;
}

/** The total at a spot when an area of height `h` is added or set there, `below` being the ground under it. */
export function totalWith(below: number, h: number, add: boolean): number {
  return add ? below + h : h;
}

/** The colour of ground `h` feet up: sand to brown as it gets higher, then pale rock; blue for pits. */
export function heightColor(h: number): string {
  const mix = (a: number[], b: number[], k: number) => '#' + a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, k))).toString(16).padStart(2, '0')).join('');
  if (h < 0) return mix([0x8f, 0xb4, 0xf5], [0x2b, 0x4a, 0x9e], -h / 40);
  if (h === 0) return '#a8b0ba';
  if (h <= 60) return mix([0xe8, 0xc9, 0x8a], [0x7a, 0x4a, 0x1e], h / 60);
  return mix([0x7a, 0x4a, 0x1e], [0xd5, 0xda, 0xe0], (h - 60) / 120);
}
