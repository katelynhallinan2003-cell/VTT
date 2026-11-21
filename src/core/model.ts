import type {
  FogOp, GridSettings, LibraryItem, Permissions, Player, SceneMeta, TableMeta, TableSettings, Token,
} from '../types';

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
    ownerUid: typeof t.ownerUid === 'string' ? t.ownerUid : null,
    hidden,
    locked: bool(t.locked, false),
    z: num(t.z, 0),
    label: t.label === 'dm' || t.label === 'none' ? t.label : 'all',
  };
}

/** Serialise a token for the database. `hidden` is implied by which subtree it lives in. */
export function tokenToWire(t: Token): Record<string, unknown> {
  const { id: _id, hidden: _hidden, ...rest } = t;
  return stripUndefined({ ...rest, img: t.img ?? undefined, imgBg: t.imgBg ?? undefined, ownerUid: t.ownerUid ?? undefined });
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
