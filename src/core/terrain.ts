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
import { resolveGradientBoundaries } from './gradientBoundaries';
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
  gradient?: Drawing['gradient'];
  gradientEnabled?: boolean;
  gradientFixed?: boolean;
  boundaryDefaults?: Drawing['gradient'];
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

// The scene replaces a drawing object when a stroke changes. Keep geometry for surviving strokes.
const strokeCache = new WeakMap<Drawing,{gridKey:string; stroke:TStroke|null}>();
export function reuseStrokeGeometry(previous:Drawing|undefined, next:Drawing) {
  if (!previous) return;
  const cache=strokeCache.get(previous);
  if (cache && previous.k===next.k && previous.p===next.p && previous.w===next.w && previous.t===next.t &&
      previous.hc===next.hc && previous.he===next.he && previous.hr===next.hr && previous.hg===next.hg) strokeCache.set(next,cache);
}
function strokeOf(d: Drawing, grid: GridSettings): TStroke | null {
  const gridKey=[grid.shape,grid.cell,grid.ox,grid.oy].join('|');
  const cached=strokeCache.get(d);
  if (cached?.gridKey===gridKey) return cached.stroke;
  const stroke=parseStroke(d,grid);
  strokeCache.set(d,{gridKey,stroke});
  return stroke;
}

function parseStroke(d: Drawing, grid: GridSettings): TStroke | null {
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

// Big strokes are tested only against the edges near the point. Each index
// keeps every edge that could change the answer, so the answer is the same.
const ringBands = new WeakMap<Vec[], { y0: number; y1: number; bh: number; bands: number[][] }>();
function ringCovers(p: Vec, ring: Vec[]): boolean {
  if (ring.length < 24) return pointInPoly(p, ring);
  let idx = ringBands.get(ring);
  if (!idx) {
    let y0 = Infinity, y1 = -Infinity;
    for (const q of ring) { if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
    const n = Math.min(512, Math.ceil(ring.length / 3)), bh = (y1 - y0) / n || 1;
    const bands: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const lo = Math.min(ring[i].y, ring[j].y), hi = Math.max(ring[i].y, ring[j].y);
      const k0 = Math.max(0, Math.min(n - 1, Math.floor((lo - y0) / bh))), k1 = Math.max(0, Math.min(n - 1, Math.floor((hi - y0) / bh)));
      for (let k = k0; k <= k1; k++) bands[k].push(i);
    }
    ringBands.set(ring, idx = { y0, y1, bh, bands });
  }
  if (p.y < idx.y0 || p.y > idx.y1) return false;
  const band = idx.bands[Math.max(0, Math.min(idx.bands.length - 1, Math.floor((p.y - idx.y0) / idx.bh)))];
  let inside = false;
  for (const i of band) {
    const a = ring[i], b = ring[i === 0 ? ring.length - 1 : i - 1];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const brushCells = new WeakMap<TStroke, { cs: number; nx: number; ny: number; cells: number[][] }>();
function brushCovers(s: TStroke, p: Vec): boolean {
  const pts = s.pts;
  if (pts.length < 24) {
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= s.r) return true;
    return false;
  }
  let idx = brushCells.get(s);
  const b = s.b;
  if (!idx) {
    const cs = Math.max(s.r * 2, b.w / 64, b.h / 64, 1);
    const nx = Math.max(1, Math.ceil(b.w / cs) + 1), ny = Math.max(1, Math.ceil(b.h / cs) + 1);
    const cells: number[][] = Array.from({ length: nx * ny }, () => []);
    const cx = (x: number) => Math.max(0, Math.min(nx - 1, Math.floor((x - b.x) / cs)));
    const cy = (y: number) => Math.max(0, Math.min(ny - 1, Math.floor((y - b.y) / cs)));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i];
      const x0 = cx(Math.min(a.x, c.x) - s.r), x1 = cx(Math.max(a.x, c.x) + s.r), y0 = cy(Math.min(a.y, c.y) - s.r), y1 = cy(Math.max(a.y, c.y) + s.r);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * nx + x].push(i);
    }
    brushCells.set(s, idx = { cs, nx, ny, cells });
  }
  const x = Math.max(0, Math.min(idx.nx - 1, Math.floor((p.x - b.x) / idx.cs))), y = Math.max(0, Math.min(idx.ny - 1, Math.floor((p.y - b.y) / idx.cs)));
  for (const i of idx.cells[y * idx.nx + x]) if (distToSegment(p, pts[i - 1], pts[i]) <= s.r) return true;
  return false;
}

/** Does this stroke cover the point? */
export function strokeCovers(s: TStroke, p: Vec, grid: GridSettings, key?: string): boolean {
  const b = s.b;
  if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) return false;
  switch (s.kind) {
    case 'polygon': return s.rings!.reduce((inside, ring) => ringCovers(p, ring) !== inside, false);
    case 'rect': return true;
    case 'ellipse': {
      const rx = Math.max(1e-6, b.w / 2), ry = Math.max(1e-6, b.h / 2);
      return ((p.x - (b.x + rx)) / rx) ** 2 + ((p.y - (b.y + ry)) / ry) ** 2 <= 1;
    }
    case 'cells': return !!s.cells?.has(key ?? cellKey(grid, p));
    default: {
      if (s.pts.length === 1) return Math.hypot(p.x - s.pts[0].x, p.y - s.pts[0].y) <= s.r;
      return brushCovers(s, p);
    }
  }
}

const unionRect = (rs: Rect[]): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
};

let lastGradientTerrain: Terrain | undefined;

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
    sigParts.push(`${d.id}|${d.k}|${d.p}|${d.w}|${d.hz}|${d.hg ?? ''}|${d.ha ? 1 : 0}|${d.he ? 1 : 0}|${d.hc ? 1 : 0}|${d.hr ?? ''}|${d.gradientFixed ? 2 : d.gradientEnabled ? 1 : 0}|${JSON.stringify(d.gradient ?? [])}|${d.t}`);
    if (d.k === 'terrain') {
      if (d.he) { erasers.push(d); continue; }
      if (d.hz == null) continue;
      const g = d.hg || d.id;
      const cur = groups.get(g);
      if (cur) cur.paint.push(d); else groups.set(g, { paint: [d], hz: d.hz, add: !!d.ha });
    } else if ((d.k === 'rect' || d.k === 'ellipse') && d.hz != null) {
      const s = strokeOf(d, grid);
      if (!s) continue;
      legacy.push({ id: d.id, legacy: true, gradient: d.gradient, gradientFixed: d.gradientFixed, gradientEnabled: !!(d.gradientEnabled || d.gradient?.length), h: d.hz, add: false, order: 0, strokes: [s], paint: [s], ids: [d.id], b: s.b });
    }
  }
  // old-style: bigger ones go below, so a nest drawn inside a cliff counts as the nest
  legacy.sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h || a.strokes[0].t - b.strokes[0].t);
  const eras = erasers.map((d) => strokeOf(d, grid)).filter((s): s is TStroke => !!s);
  for (const a of legacy) {
    const cuts = eras.filter(e => e.hg === a.id).sort((x,y) => x.t-y.t || x.id.localeCompare(y.id));
    // A filled hole belongs to its original box or ellipse, including its gradient controls.
    const fills=(groups.get(a.id)?.paint ?? []).map(d=>strokeOf(d,grid)).filter((s):s is TStroke=>!!s);
    a.paint.push(...fills);
    a.strokes.push(...[...cuts,...fills].sort((x,y)=>x.t-y.t || x.id.localeCompare(y.id)));
    a.ids.push(...cuts.map(s=>s.id),...fills.map(s=>s.id));
    groups.delete(a.id);
  }
  const painted: Area[] = [];
  for (const [id, g] of groups) {
    const paint = g.paint.map((d) => strokeOf(d, grid)).filter((s): s is TStroke => !!s);
    if (!paint.length) continue;
    const mine = eras.filter((e) => e.hg === id);
    const all = [...paint, ...mine, ...eras.filter((e) => e.hg === '')].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    // the area's height and mode are those of its first stroke (editing an area rewrites all of them together)
    const first = [...g.paint].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))[0];
    painted.push({ id, legacy: false, gradient: first.gradient, gradientFixed: first.gradientFixed, gradientEnabled: !!(first.gradientEnabled || first.gradient?.length), h: first.hz ?? g.hz, add: !!first.ha, order: 0, strokes: all, paint, ids: [...paint, ...mine].map((s) => s.id), b: unionRect(paint.map((s) => s.b)) });
  }
  painted.sort((a, b) => Math.min(...a.paint.map((s) => s.t)) - Math.min(...b.paint.map((s) => s.t)) || (a.id < b.id ? -1 : 1));
  const areas = [...legacy, ...painted];
  areas.forEach((a, i) => { a.order = i; });
  const terrain = { areas, grid, sig: `${layer}|${grid.visible}|${grid.snap}|${grid.shape}|${grid.ft}|${grid.cell}|${grid.ox}|${grid.oy}#${sigParts.join(';')}` };
  if (areas.some(a => a.gradientEnabled)) {
    if (lastGradientTerrain?.sig === terrain.sig && lastGradientTerrain.grid === grid) return lastGradientTerrain;
    if (areas.some(a => a.gradientEnabled && !a.gradientFixed)) resolveGradientBoundaries(terrain);
    for (const a of areas) if (a.gradient?.length === 1 && a.gradient[0].id.startsWith('join:')) {
      a.h = a.gradient[0].height;
      a.add = false;
    }
    lastGradientTerrain = terrain;
  }
  return terrain;
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
export function surfaceHeight(a: Pick<Area, "gradient" | "h">, p: Vec): number {
  if (!a.gradient || a.gradient.length < 2) return a.h;
  let weights = 0, total = 0;
  for (const {path,height} of a.gradient) {
    let d = Math.hypot(p.x-path[0].x,p.y-path[0].y);
    let value=height;
    if (path[0].rise===undefined) {
      for (let i=1; i<path.length; i++) d = Math.min(d,distToSegment(p,path[i-1],path[i]));
    } else {
      // A line matched to a pre-painted slope carries the height along its contour.
      value+=path[0].rise;
      for (let i=1;i<path.length;i++) {
        const a=path[i-1], b=path[i], dx=b.x-a.x, dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
        const sep=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
        if (sep<d) { d=sep; value=height+(1-t)*(a.rise ?? 0)+t*(b.rise ?? 0); }
      }
    }
    if (d < 1e-7) return value;
    weights += 1/d;
    total += value/d;
  }
  return total/weights;
}

export function groundAtTerrain(t: Terrain, p: Vec): number {
  // Only the highest area that sets the ground, and the raised areas above it,
  // decide the height. Find them from the top, then add up from the bottom as
  // painting order would, so the sum is the same to the last bit.
  const areas = t.areas;
  let i = areas.length - 1, raised = 0;
  for (; i >= 0; i--) {
    const a = areas[i];
    if (!areaHas(a, p, t.grid)) continue;
    if ((a.gradient && a.gradient.length >= 2) || !a.add) break;
    raised++;
  }
  let h = 0;
  if (i >= 0) { const a = areas[i]; h = a.gradient && a.gradient.length >= 2 ? surfaceHeight(a, p) : a.h; }
  if (raised) for (let k = i + 1; k < areas.length; k++) if (areas[k].add && !(areas[k].gradient && areas[k].gradient!.length >= 2) && areaHas(areas[k], p, t.grid)) h = h + areas[k].h;
  return h;
}

/** Resolve the surface covering an interval once, then sample along it up to both edges. */
export function slopeAt(t: Terrain, p: Vec): ((at: Vec) => number) | undefined {
  let offset = 0;
  for (let i=t.areas.length-1; i>=0; i--) {
    const area=t.areas[i];
    if (!areaHas(area,p,t.grid)) continue;
    if ((area.gradient?.length ?? 0)>=2) return at => surfaceHeight(area,at)+offset;
    if (!area.add) break;
    offset+=area.h;
  }
}

/** A standing creature takes the average of seven samples in its hex on a gradient. */
export function standingGround(t: Terrain, p: Vec): number {
  return Math.round(standingSurface(t,p)*10)/10;
}

export function standingSurface(t: Terrain, p: Vec): number {
  const h = groundAtTerrain(t,p);
  if ((!t.grid.visible && !t.grid.snap) || !isHex(t.grid)) return h;
  const c = snapToCellCenter(t.grid,p);
  if (!slopeAt(t,c)) return h;
  const vertices = cellPoly(t.grid,c);
  const sum = vertices.reduce((total,v) => total + groundAtTerrain(t,{x:c.x+(v.x-c.x)*0.65,y:c.y+(v.y-c.y)*0.65}),groundAtTerrain(t,c));
  return sum/(1+vertices.length);
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

/** Topographical colours by rank among the finished elevations on the map. */
export function heightColor(h: number, levels: readonly number[] = [-10,0,5,10,15,20,25,30,35,40,60]): string {
  if (h === 0) return '#a8b0ba';
  const stops = [[53,139,177],[65,174,150],[169,197,105],[236,203,111],[216,140,111],[157,122,172]];
  // Neutral ground is a palette stop on both sides of zero, including inside a slope.
  const neighbor=h>0 ? levels.find(level=>level>0) ?? 5 : levels.reduce((nearest,level)=>level<0 ? level : nearest,-5);
  const blend=Math.min(1,h/neighbor);
  const sample=blend<1 ? neighbor : h;
  let rank = levels.findIndex(level => level >= sample);
  if (rank < 0) rank = levels.length-1;
  else if (rank > 0) rank -= (levels[rank]-sample)/(levels[rank]-levels[rank-1]);
  const v = levels.length < 2 ? 1 : rank*(stops.length-1)/(levels.length-1);
  const lo = Math.floor(v), hi = Math.ceil(v);
  const neutral=[168,176,186];
  return '#' + stops[lo].map((value,c) => {
    const color=value+(stops[hi][c]-value)*(v-lo);
    return Math.round(neutral[c]+(color-neutral[c])*blend).toString(16).padStart(2,'0');
  }).join('');
}
