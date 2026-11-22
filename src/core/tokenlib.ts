// Saved tokens: a token's look and settings kept in a library so it can be dropped into any scene (or any table) later.
// Pure functions (no database, no screen).
import { normalizeToken, stripUndefined, tokenToWire } from './model';
import type { Token, Vec } from '../types';

export const MAX_SAVED_NAME = 60;
/** a saved token is a few hundred bytes; this only stops something huge being stored */
export const MAX_SAVED_BYTES = 12000;

/** One entry of a token library. `t` holds the token's own fields (as they are stored for a token), minus where it stands. */
export interface SavedToken {
  id: string;
  name: string;
  addedAt: number;
  t: Record<string, unknown>;
}

/** things that belong to one place on one map, not to the token itself */
const LEAVE_OUT = ['x', 'y', 'z', 'ownerUid', 'hpPct', 'hpNow', 'hpCap', 'locked', 'hidden', 'fly', 'elev', 'cid'];

export function cleanSavedName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SAVED_NAME) : '';
}

/**
 * What to keep of a token.
 * - A **template** (the DM's) keeps the settings and the maximum hit points, but not damage taken or conditions: dropping it in gives a fresh one.
 * - A **character** (a player's) also keeps the conditions and effects on it, and is tied to its library entry by `cid`, so it is known to be the same character in every scene.
 */
export function savedFields(token: Token, o: { character: boolean; cid?: string }): Record<string, unknown> {
  const w = tokenToWire(token) as Record<string, unknown>;
  for (const k of LEAVE_OUT) delete w[k];
  if (token.maxHp != null) w.maxHp = token.maxHp;
  if (o.character) { if (o.cid) w.cid = o.cid; } else { delete w.fx; if (token.hidden) w.hidden = true; }
  return stripUndefined(w);
}

export function normalizeSavedToken(id: string, raw: unknown): SavedToken | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t = r.t;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  if (JSON.stringify(t).length > MAX_SAVED_BYTES) return null;
  const name = cleanSavedName(r.name) || cleanSavedName((t as Record<string, unknown>).name) || 'Token';
  return { id, name, addedAt: Number.isFinite(Number(r.addedAt)) ? Number(r.addedAt) : 0, t: t as Record<string, unknown> };
}

/**
 * The token to make from a saved one, placed at `at`.
 * The DM's tokens start at full health and may be hidden; a player's is owned by that player and gets its `cid` (hit points are the DM's to set).
 */
export function tokenFromSaved(saved: SavedToken, at: Vec, o: { dm: boolean; owner: string | null; cid?: string | null }): Partial<Token> & Vec {
  const raw: Record<string, unknown> = { ...saved.t, name: saved.t.name ?? saved.name, x: at.x, y: at.y };
  if (o.owner) raw.ownerUid = o.owner; else delete raw.ownerUid;
  if (o.dm && typeof raw.maxHp === 'number') raw.hp = raw.maxHp;
  const cid = o.cid ?? (typeof saved.t.cid === 'string' ? saved.t.cid : null);
  if (cid) raw.cid = cid; else delete raw.cid;
  const t = normalizeToken('', raw, o.dm && saved.t.hidden === true);
  const { id: _id, ...rest } = t;
  return rest;
}

/** The same value with keys in a fixed order and index-keyed objects as arrays, which is how the database may hand a saved token back. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).sort();
    if (keys.length && keys.every((k, i) => k === String(i))) return keys.map((k) => canon((v as Record<string, unknown>)[k]));
    return Object.fromEntries(keys.map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** Do two saved-token field sets say the same thing, whatever order the database gave the keys in? */
export function sameSaved(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
