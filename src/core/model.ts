import type {
  Aura, Drawing, ExtraMap, FogOp, GridSettings, HpShow, InitEntry, InitPub, InitState, LibraryItem, LivePlot, Permissions, Player, SceneMeta, TableMeta,
  TableSettings, Token, TokenLight, Vec, ViewCall, Handout,
} from '../types';
import { cleanHp, emptyInit, orderOf } from './combat';
import { FONT_KEYS } from './draw';
import { fxToWire, normalizeFx } from './effects';

export const DEFAULT_GRID: GridSettings = {
  shape: 'square', cell: 70, ox: 0, oy: 0, visible: true, color: '#000000', opacity: 0.35,
  ft: 5, rule: 'chebyshev', snap: true,
};

export const TOKEN_SIZES: { label: string; size: number }[] = [
  { label: 'Tiny', size: 0.5 },
  { label: 'Small / Medium', size: 1 },
  { label: 'Large', size: 2 },
  { label: 'Huge', size: 3 },
  { label: 'Gargantuan', size: 4 },
];

export const DEFAULT_BG = '#ffffff';
/** earlier versions defaulted to these; treat them as "not chosen" so every table gets the white drawing surface */
const OLD_DEFAULT_BGS = new Set(['#1b1d23', '#eceae4']);
export const DM_COLOR = '#ffe119';

export const PLAYER_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#2ec4b6',
  '#f032e6', '#bcbd22', '#ffe119', '#9a6324', '#ffffff', '#808080',
];

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

export function normalizeGrid(raw: any): GridSettings {
  const g = raw ?? {};
  return {
    shape: g.shape === 'pointy' || g.shape === 'flat' ? g.shape : 'square',
    cell: Math.max(4, num(g.cell, DEFAULT_GRID.cell)),
    ox: num(g.ox, 0),
    oy: num(g.oy, 0),
    visible: bool(g.visible, true),
    color: str(g.color, DEFAULT_GRID.color),
    opacity: Math.min(1, Math.max(0, num(g.opacity, DEFAULT_GRID.opacity))),
    ft: num(g.ft, 5),
    rule: g.rule === 'alt' || g.rule === 'euclid' ? g.rule : 'chebyshev',
    snap: bool(g.snap, true),
  };
}

/** Most extra maps a scene can have. */
export const MAX_EXTRA_MAPS = 4;

/** The extra maps as they are stored (a record by id; arrays are no good in the database), read back as a list in the order they were added. */
export function normalizeMaps(raw: any): ExtraMap[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: ExtraMap[] = [];
  for (const id of Object.keys(raw).sort()) {
    const m = raw[id];
    if (!m || typeof m.u !== 'string' || !m.u) continue;
    out.push({
      id, url: m.u, w: Math.max(1, num(m.w, 1)), h: Math.max(1, num(m.h, 1)), x: num(m.x, 0), y: num(m.y, 0),
      scale: Math.max(0.01, num(m.s, 1)), name: str(m.n, '').slice(0, 60), show: bool(m.v, true), locked: bool(m.l, true),
    });
    if (out.length >= MAX_EXTRA_MAPS) break;
  }
  return out;
}

export function mapsToWire(maps: ExtraMap[]): Record<string, unknown> | null {
  if (!maps.length) return null;
  const out: Record<string, unknown> = {};
  for (const m of maps.slice(0, MAX_EXTRA_MAPS)) out[m.id] = { u: m.url, w: m.w, h: m.h, x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100, s: Math.round(m.scale * 10000) / 10000, n: m.name || null, v: m.show, l: m.locked };
  return out;
}

function normalizeMapGrid(raw: any): SceneMeta['mapGrid'] {
  if (!raw || typeof raw !== 'object') return null;
  const p = num(raw.p, 0);
  if (!(p >= 4)) return null;
  const cut: NonNullable<SceneMeta['mapGrid']> = { on: bool(raw.on, true), p, x: num(raw.x, 0), y: num(raw.y, 0), t: Math.min(24, Math.max(0.5, num(raw.t, 2))) };
  if (raw.hex === 'pointy' || raw.hex === 'flat') cut.hex = raw.hex;
  return cut;
}

export function normalizeSceneMeta(raw: any): SceneMeta {
  const m = raw ?? {};
  return {
    name: str(m.name, 'Untitled scene'),
    mapUrl: typeof m.mapUrl === 'string' ? m.mapUrl : null,
    mapW: num(m.mapW, 0),
    mapH: num(m.mapH, 0),
    mapX: num(m.mapX, 0),
    mapY: num(m.mapY, 0),
    mapScale: Math.max(0.01, num(m.mapScale, 1)),
    mapLocked: bool(m.mapLocked, true),
    mapGrid: normalizeMapGrid(m.mapGrid),
    maps: normalizeMaps(m.maps),
    gridTried: bool(m.gridTried, true),
    wallStop: bool(m.wallStop, true),
    cliff: Math.min(1000, Math.max(0, Math.round(num(m.cliff, 10)))),
    bg: OLD_DEFAULT_BGS.has(str(m.bg, '')) ? DEFAULT_BG : str(m.bg, DEFAULT_BG),
    grid: normalizeGrid(m.grid),
    fog: {
      enabled: bool(m.fog?.enabled, false),
      base: m.fog?.base === 'clear' ? 'clear' : 'hidden',
      vision: bool(m.fog?.vision, false),
      explore: bool(m.fog?.explore, false),
      dim: bool(m.fog?.dim, true),
    },
    light: { ambient: m.light?.ambient === 'dim' || m.light?.ambient === 'dark' ? m.light.ambient : 'bright' },
    createdAt: num(m.createdAt, 0),
  };
}

export function normalizeToken(id: string, raw: any, hidden: boolean): Token {
  const t = raw ?? {};
  return {
    id,
    name: str(t.name, ''),
    img: typeof t.img === 'string' ? t.img : null,
    x: num(t.x, 0),
    y: num(t.y, 0),
    size: Math.max(0.25, num(t.size, 1)),
    shape: t.shape === 'square' || t.shape === 'none' ? t.shape : 'circle',
    ring: str(t.ring, '#e8e8ee'),
    ringW: Math.min(0.3, Math.max(0, num(t.ringW, 0.06))),
    imgScale: Math.max(0.1, num(t.imgScale, 1)),
    imgX: num(t.imgX, 0),
    imgY: num(t.imgY, 0),
    imgBg: typeof t.imgBg === 'string' ? t.imgBg : null,
    auras: normalizeAuras(t.auras),
    ...cleanHpFields(t),
    tempHp: 0,
    hpShow: hpShowOf(t.hpShow, typeof t.ownerUid === 'string'),
    hpPct: typeof t.hpPct === 'number' && Number.isFinite(t.hpPct) ? Math.min(100, Math.max(0, Math.round(t.hpPct))) : null,
    hpNow: typeof t.hpNow === 'number' && Number.isFinite(t.hpNow) ? Math.min(99999, Math.max(-99999, Math.round(t.hpNow))) : null,
    hpCap: typeof t.hpCap === 'number' && Number.isFinite(t.hpCap) ? Math.min(99999, Math.max(0, Math.round(t.hpCap))) : null,
    sight: Math.min(1000, Math.max(0, num(t.sight, 0))),
    dv: Math.min(1000, Math.max(0, num(t.dv, 0))),
    light: normalizeTokenLight(t.light),
    fly: bool(t.fly, false),
    elev: Math.min(5000, Math.max(-1000, Math.round(num(t.elev, 0)))),
    initBonus: Math.min(99, Math.max(-99, Math.round(num(t.initBonus, 0)))),
    fx: normalizeFx(t.fx),
    ownerUid: typeof t.ownerUid === 'string' ? t.ownerUid : null,
    hidden,
    locked: bool(t.locked, false),
    z: num(t.z, 0),
    label: t.label === 'dm' || t.label === 'none' ? t.label : 'all',
  };
}

/** A light on a token: at least one of the two distances, and a colour. Anything else means no light. */
export function normalizeTokenLight(raw: any): TokenLight | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = Math.min(1000, Math.max(0, num(raw.b, 0)));
  const d = Math.min(1000, Math.max(0, num(raw.d, 0)));
  if (!(b + d > 0)) return null;
  return { b, d, c: typeof raw.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.c) ? raw.c : '#ffd9a0' };
}

function cleanHpFields(t: any): { hp: number | null; maxHp: number | null } {
  const c = cleanHp(typeof t.hp === 'number' ? t.hp : null, typeof t.maxHp === 'number' ? t.maxHp : null);
  return { hp: c.hp, maxHp: c.max };
}

/** Players see a bar for tokens that belong to someone (the party), only the coloured state for everything else. */
function hpShowOf(v: unknown, owned: boolean): HpShow {
  return v === 'off' || v === 'state' || v === 'bar' || v === 'numbers' ? v : owned ? 'bar' : 'state';
}

export function normalizeAuras(raw: any): Aura[] {
  if (!raw || typeof raw !== 'object') return [];
  // the database hands arrays back as objects when it thinks they have gaps
  const list: any[] = Array.isArray(raw) ? raw : Object.keys(raw).sort((a, b) => Number(a) - Number(b)).map((k) => raw[k]);
  return list.filter((a) => a && typeof a === 'object').slice(0, 6).map((a) => ({
    r: Math.min(500, Math.max(0, num(a.r, 10))),
    color: str(a.color, '#ff6b6b'),
    a: Math.min(1, Math.max(0, num(a.a, 0.25))),
    shape: a.shape === 'square' ? 'square' : 'circle',
    edge: bool(a.edge, true),
    dm: bool(a.dm, false),
    g: bool(a.g, true),
  }));
}

const DRAW_KINDS = ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'cone', 'cube', 'sphere', 'emanation', 'beam', 'terrain'];

export function normalizeDrawing(id: string, raw: any): Drawing | null {
  if (!raw || typeof raw.p !== 'string' || !DRAW_KINDS.includes(raw.k)) return null;
  return {
    id,
    uid: str(raw.uid, ''),
    k: raw.k,
    p: raw.p,
    color: str(raw.color, '#e03131'),
    w: Math.min(200, Math.max(0.5, num(raw.w, 4))),
    fill: Math.min(1, Math.max(0, num(raw.fill, 0))),
    fc: typeof raw.fc === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.fc) ? raw.fc : '',
    dash: bool(raw.dash, false),
    txt: typeof raw.txt === 'string' ? raw.txt.slice(0, 600) : '',
    fs: Math.min(400, Math.max(6, num(raw.fs, 28))),
    font: typeof raw.font === 'string' && FONT_KEYS.includes(raw.font) ? raw.font : '',
    b: bool(raw.b, false),
    i: bool(raw.i, false),
    u: bool(raw.u, false),
    ho: bool(raw.ho, false),
    bw: Math.min(200, Math.max(1, num(raw.bw, 5))),
    of: Math.min(400, Math.max(0, num(raw.of, 0))),
    hz: typeof raw.hz === 'number' && Number.isFinite(raw.hz) && (raw.k === 'rect' || raw.k === 'ellipse' || raw.k === 'terrain') ? Math.min(5000, Math.max(-1000, Math.round(raw.hz))) : null,
    ...(raw.pv === true ? { pv: true } : {}),
    ...(raw.k === 'terrain' ? { hg: typeof raw.hg === 'string' ? raw.hg.slice(0, 24) : '', ha: bool(raw.ha, false), he: bool(raw.he, false), hc: bool(raw.hc, false), ...(raw.dt === true ? { dt: true } : {}) } : {}),
    t: num(raw.t, 0),
  };
}

export function drawingToWire(d: Omit<Drawing, 'id'> | Drawing): Record<string, unknown> {
  const { id: _id, ...rest } = d as Drawing;
  return stripUndefined({
    ...rest, txt: rest.txt || undefined, dash: rest.dash || undefined, fill: rest.fill || undefined,
    fc: rest.fc || undefined, font: rest.font || undefined, b: rest.b || undefined, i: rest.i || undefined, u: rest.u || undefined, ho: rest.ho || undefined,
    hz: rest.hz ?? undefined,
    of: rest.of || undefined,
    pv: rest.pv || undefined,
    hg: rest.hg || undefined, ha: rest.ha || undefined, he: rest.he || undefined, hc: rest.hc || undefined, dt: rest.dt || undefined,
  });
}

/** The corners of a measurement or a move in several steps, as "x,y;x,y" (at most 24). */
export const MAX_VIA = 24;
export const viaToWire = (pts: Vec[] | undefined): string | undefined => (pts?.length ? pts.slice(0, MAX_VIA).map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(';') : undefined);
export function viaFromWire(s: unknown): Vec[] {
  if (typeof s !== 'string' || !s) return [];
  const out: Vec[] = [];
  for (const part of s.split(';').slice(0, MAX_VIA)) {
    const [x, y] = part.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

export function normalizeLive(uid: string, raw: any): LivePlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const ruler = raw.ruler && typeof raw.ruler === 'object'
    ? {
      a: { x: num(raw.ruler.ax, 0), y: num(raw.ruler.ay, 0) }, b: { x: num(raw.ruler.bx, 0), y: num(raw.ruler.by, 0) },
      ...(typeof raw.ruler.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.ruler.c) ? { c: raw.ruler.c } : {}),
      ...(viaFromWire(raw.ruler.w).length ? { via: viaFromWire(raw.ruler.w) } : {}),
    }
    : null;
  const ghosts: Record<string, Vec & { via?: Vec[] }> = {};
  if (raw.ghosts && typeof raw.ghosts === 'object') {
    for (const [id, v] of Object.entries(raw.ghosts as Record<string, any>)) {
      if (v && typeof v === 'object') {
        const via = viaFromWire(v.w);
        ghosts[id] = { x: num(v.x, 0), y: num(v.y, 0), ...(via.length ? { via } : {}) };
      }
    }
  }
  if (!ruler && !Object.keys(ghosts).length) return null;
  return { uid, ruler, ghosts };
}

/** Serialise a token for the database. `hidden` is implied by which subtree it lives in. */
export function tokenToWire(t: Token): Record<string, unknown> {
  // hp and maxHp are deliberately left out: they live in the DM-only part of the database
  const { id: _id, hidden: _hidden, hp: _hp, maxHp: _maxHp, tempHp: _tempHp, ...rest } = t;
  return stripUndefined({
    ...rest,
    img: t.img ?? undefined,
    imgBg: t.imgBg ?? undefined,
    ownerUid: t.ownerUid ?? undefined,
    auras: t.auras.length ? t.auras : undefined,
    hpPct: t.hpPct ?? undefined,
    hpNow: t.hpNow ?? undefined,
    hpCap: t.hpCap ?? undefined,
    sight: t.sight > 0 ? t.sight : undefined,
    dv: t.dv > 0 ? t.dv : undefined,
    light: t.light ?? undefined,
    fly: t.fly ? true : undefined,
    elev: t.fly && t.elev ? t.elev : undefined,
    initBonus: t.initBonus ? t.initBonus : undefined,
    fx: fxToWire(t.fx) ?? undefined,
  });
}

// ---------------------------------------------------------------- initiative
function initEntries(raw: any): InitEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: InitEntry[] = [];
  for (const [id, v] of Object.entries(raw as Record<string, any>)) {
    if (!v || typeof v !== 'object') continue;
    out.push({
      id,
      tk: typeof v.tk === 'string' ? v.tk : null,
      n: str(v.n, '').slice(0, 60),
      i: num(v.i, 0),
      h: bool(v.h, false),
      o: num(v.o, 0),
    });
  }
  return orderOf(out);
}

export function normalizeInit(raw: any): InitState {
  if (!raw || typeof raw !== 'object') return emptyInit();
  const entries = initEntries(raw.entries);
  const turn = typeof raw.turn === 'string' && entries.some((e) => e.id === raw.turn) ? raw.turn : null;
  return { round: Math.max(0, Math.round(num(raw.round, 0))), turn, shown: bool(raw.shown, false), entries };
}

export function initToWire(s: InitState): Record<string, unknown> | null {
  if (!s.entries.length && !s.round) return null;
  const entries: Record<string, unknown> = {};
  for (const e of s.entries) entries[e.id] = stripUndefined({ tk: e.tk ?? undefined, n: e.n || undefined, i: e.i, h: e.h || undefined, o: e.o });
  return stripUndefined({ round: s.round, turn: s.turn ?? undefined, shown: s.shown || undefined, entries: s.entries.length ? entries : undefined });
}

export function normalizeInitPub(raw: any): InitPub | null {
  if (!raw || typeof raw !== 'object') return null;
  const entries = initEntries(raw.entries).map((e) => ({ id: e.id, tk: e.tk, n: e.n, i: e.i, o: e.o }));
  if (!entries.length) return null;
  return { round: Math.max(0, Math.round(num(raw.round, 0))), turn: typeof raw.turn === 'string' ? raw.turn : null, entries };
}

export function initPubToWire(p: InitPub | null): Record<string, unknown> | null {
  if (!p) return null;
  const entries: Record<string, unknown> = {};
  for (const e of p.entries) entries[e.id] = stripUndefined({ tk: e.tk ?? undefined, n: e.n || undefined, i: e.i, o: e.o });
  return stripUndefined({ round: p.round, turn: p.turn ?? undefined, entries });
}

export function normalizeFogOp(raw: any): FogOp | null {
  if (!raw || typeof raw.p !== 'string') return null;
  const m = raw.m === 'h' ? 'h' : raw.m === 'x' ? 'x' : 'r';
  if (raw.t === 'rect') return { m, t: 'rect', p: raw.p };
  if (raw.t === 'poly') return { m, t: 'poly', p: raw.p };
  if (raw.t === 'line') return { m, t: 'line', p: raw.p, w: num(raw.w, 40) };
  return null;
}

export function normalizeMeta(raw: any): TableMeta {
  return {
    name: str(raw?.name, 'Table'),
    activeScene: typeof raw?.activeScene === 'string' ? raw.activeScene : null,
    createdAt: num(raw?.createdAt, 0),
    view: normalizeView(raw?.view),
  };
}

export function normalizeView(raw: any): ViewCall | null {
  if (!raw || typeof raw !== 'object' || typeof raw.sid !== 'string') return null;
  const w = num(raw.w, 0), h = num(raw.h, 0);
  if (!(w > 0 && h > 0)) return null;
  return { sid: raw.sid, x: num(raw.x, 0), y: num(raw.y, 0), w, h, n: num(raw.n, 0) };
}

export function normalizePlayer(uid: string, raw: any): Player {
  return {
    uid,
    name: str(raw?.name, 'Player'),
    color: str(raw?.color, '#ffffff'),
    online: bool(raw?.online, false),
    joinedAt: num(raw?.joinedAt, 0),
    dm: bool(raw?.dm, false),
  };
}

export function normalizeLibraryItem(id: string, raw: any): LibraryItem | null {
  if (!raw || typeof raw.url !== 'string') return null;
  return {
    id,
    name: str(raw.name, 'Untitled'),
    url: raw.url,
    thumb: typeof raw.thumb === 'string' ? raw.thumb : undefined,
    w: typeof raw.w === 'number' ? raw.w : undefined,
    h: typeof raw.h === 'number' ? raw.h : undefined,
    addedAt: num(raw.addedAt, 0),
  };
}

export function normalizeSettings(raw: any, presets: Record<string, Permissions>): TableSettings {
  const base = presets.trusting;
  const p = raw?.perm ?? {};
  const perm: Permissions = {
    playersMoveAnyToken: bool(p.playersMoveAnyToken, base.playersMoveAnyToken),
    playersCreateTokens: bool(p.playersCreateTokens, base.playersCreateTokens),
    playersDeleteAnyToken: bool(p.playersDeleteAnyToken, base.playersDeleteAnyToken),
    playersPing: bool(p.playersPing, base.playersPing),
    playersDraw: bool(p.playersDraw, base.playersDraw),
    playersTemplates: bool(p.playersTemplates, base.playersTemplates),
    playersMeasure: bool(p.playersMeasure, base.playersMeasure),
  };
  const preset = ['trusting', 'standard', 'strict', 'custom'].includes(raw?.preset) ? raw.preset : 'trusting';
  return { perm, preset };
}

/** Remove undefined (Firebase rejects it) from a plain object, shallowly and in nested plain objects. */
export function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = stripUndefined(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out as T;
}

// ---------------------------------------------------------------- handouts
export function normalizeHandout(id: string, raw: any): Handout {
  const r = raw ?? {};
  const toRaw = r.to;
  const to = toRaw && typeof toRaw === 'object' ? (Array.isArray(toRaw) ? toRaw : Object.keys(toRaw).filter((k) => toRaw[k])).filter((u: unknown): u is string => typeof u === 'string') : null;
  return {
    id,
    title: str(r.title, '').slice(0, 120),
    text: str(r.text, '').slice(0, 20000),
    img: typeof r.img === 'string' && r.img ? r.img : null,
    to: to && to.length ? to : null,
    shown: bool(r.shown, false),
    n: num(r.n, 0),
    createdAt: num(r.createdAt, 0),
  };
}

/** The saved form of a handout. `to` is a set of keys, because the database turns lists into objects when it feels like it. */
export function handoutToWire(h: Handout): Record<string, unknown> {
  return stripUndefined({
    title: h.title,
    text: h.text || undefined,
    img: h.img ?? undefined,
    to: h.to ? Object.fromEntries(h.to.map((u) => [u, true])) : undefined,
    shown: h.shown ? true : undefined,
    n: h.n || undefined,
    createdAt: h.createdAt,
  });
}
