import type {
  Aura, Drawing, FogOp, GridSettings, HpShow, InitEntry, InitPub, InitState, LibraryItem, LivePlot, Permissions, Player, SceneMeta, TableMeta,
  TableSettings, Token, Vec,
} from '../types';
import { cleanHp, emptyInit, orderOf } from './combat';

export const DEFAULT_GRID: GridSettings = {
  cell: 70, ox: 0, oy: 0, visible: true, color: '#000000', opacity: 0.35,
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
    bg: OLD_DEFAULT_BGS.has(str(m.bg, '')) ? DEFAULT_BG : str(m.bg, DEFAULT_BG),
    grid: normalizeGrid(m.grid),
    fog: {
      enabled: bool(m.fog?.enabled, false),
      base: m.fog?.base === 'clear' ? 'clear' : 'hidden',
      vision: bool(m.fog?.vision, false),
      explore: bool(m.fog?.explore, false),
    },
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
    hpShow: hpShowOf(t.hpShow, typeof t.ownerUid === 'string'),
    hpPct: typeof t.hpPct === 'number' && Number.isFinite(t.hpPct) ? Math.min(100, Math.max(0, Math.round(t.hpPct))) : null,
    sight: Math.min(1000, Math.max(0, num(t.sight, 0))),
    ownerUid: typeof t.ownerUid === 'string' ? t.ownerUid : null,
    hidden,
    locked: bool(t.locked, false),
    z: num(t.z, 0),
    label: t.label === 'dm' || t.label === 'none' ? t.label : 'all',
  };
}

function cleanHpFields(t: any): { hp: number | null; maxHp: number | null } {
  const c = cleanHp(typeof t.hp === 'number' ? t.hp : null, typeof t.maxHp === 'number' ? t.maxHp : null);
  return { hp: c.hp, maxHp: c.max };
}

/** Players see a bar for tokens that belong to someone (the party), only the coloured state for everything else. */
function hpShowOf(v: unknown, owned: boolean): HpShow {
  return v === 'off' || v === 'state' || v === 'bar' ? v : owned ? 'bar' : 'state';
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
  }));
}

const DRAW_KINDS = ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'cone', 'cube', 'sphere', 'beam'];

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
    dash: bool(raw.dash, false),
    txt: typeof raw.txt === 'string' ? raw.txt.slice(0, 300) : '',
    fs: Math.min(400, Math.max(6, num(raw.fs, 28))),
    bw: Math.min(200, Math.max(1, num(raw.bw, 5))),
    t: num(raw.t, 0),
  };
}

export function drawingToWire(d: Omit<Drawing, 'id'> | Drawing): Record<string, unknown> {
  const { id: _id, ...rest } = d as Drawing;
  return stripUndefined({ ...rest, txt: rest.txt || undefined, dash: rest.dash || undefined, fill: rest.fill || undefined });
}

export function normalizeLive(uid: string, raw: any): LivePlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const ruler = raw.ruler && typeof raw.ruler === 'object'
    ? { a: { x: num(raw.ruler.ax, 0), y: num(raw.ruler.ay, 0) }, b: { x: num(raw.ruler.bx, 0), y: num(raw.ruler.by, 0) } }
    : null;
  const ghosts: Record<string, Vec> = {};
  if (raw.ghosts && typeof raw.ghosts === 'object') {
    for (const [id, v] of Object.entries(raw.ghosts as Record<string, any>)) {
      if (v && typeof v === 'object') ghosts[id] = { x: num(v.x, 0), y: num(v.y, 0) };
    }
  }
  if (!ruler && !Object.keys(ghosts).length) return null;
  return { uid, ruler, ghosts };
}

/** Serialise a token for the database. `hidden` is implied by which subtree it lives in. */
export function tokenToWire(t: Token): Record<string, unknown> {
  // hp and maxHp are deliberately left out: they live in the DM-only part of the database
  const { id: _id, hidden: _hidden, hp: _hp, maxHp: _maxHp, ...rest } = t;
  return stripUndefined({
    ...rest,
    img: t.img ?? undefined,
    imgBg: t.imgBg ?? undefined,
    ownerUid: t.ownerUid ?? undefined,
    auras: t.auras.length ? t.auras : undefined,
    hpPct: t.hpPct ?? undefined,
    sight: t.sight > 0 ? t.sight : undefined,
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
  const m = raw.m === 'h' ? 'h' : 'r';
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
  };
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
