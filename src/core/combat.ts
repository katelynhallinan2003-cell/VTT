// Combat bookkeeping: health states, the initiative order and what tokens can see.
// Pure functions only, so they are easy to test and the client and the board share one set of rules.
import type { GridSettings, HealthState, HpShow, InitEntry, InitPub, InitState, Token, Vec } from '../types';

// ---------------------------------------------------------------- health
/** Bloodied at half health or less, "mortal" (near death) at a tenth or less. */
export const BLOODIED_AT = 50;
export const MORTAL_AT = 10;

/** What a token's health looks like in the part of the database players can read, given what the DM lets them see. */
export function publicHp(show: HpShow, hp: number | null, max: number | null): { hpPct: number | null; hpNow: number | null; hpCap: number | null } {
  const pct = show === 'off' ? null : pctOf(hp, max);
  const nums = show === 'numbers' && hp != null && max != null && max > 0;
  return { hpPct: pct, hpNow: nums ? hp : null, hpCap: nums ? max : null };
}

export function pctOf(hp: number | null, max: number | null): number | null {
  if (hp == null || max == null || max <= 0) return null;
  if (hp <= 0) return 0;
  // alive means at least 1%, so a sliver of health never reads as "down"
  return Math.min(100, Math.max(1, Math.round((hp / max) * 100)));
}

export function healthState(pct: number | null): HealthState {
  if (pct == null) return 'ok';
  if (pct <= 0) return 'down';
  if (pct <= MORTAL_AT) return 'mortal';
  if (pct <= BLOODIED_AT) return 'bloodied';
  return 'ok';
}

export const HEALTH_COLOR: Record<HealthState, string> = {
  ok: '#51cf66', bloodied: '#ff922b', mortal: '#e03131', down: '#868e96',
};
export const HEALTH_LABEL: Record<HealthState, string> = {
  ok: 'Healthy', bloodied: 'Bloodied', mortal: 'Near death', down: 'Down',
};

/** Fix up hp / max so they are either both set or both empty, and hp stays inside 0..max. */
export function cleanHp(hp: number | null | undefined, max: number | null | undefined): { hp: number | null; max: number | null } {
  let h = typeof hp === 'number' && Number.isFinite(hp) ? Math.round(hp) : null;
  let m = typeof max === 'number' && Number.isFinite(max) ? Math.max(1, Math.round(max)) : null;
  if (h == null && m == null) return { hp: null, max: null };
  if (m == null) m = Math.max(1, h!);
  if (h == null) h = m;
  return { hp: Math.min(m, Math.max(0, h)), max: m };
}

/**
 * Apply damage (positive) or healing (negative) to hit points and temporary hit points.
 * Temp hit points take the damage first. Healing is capped at the maximum and leaves temp hit points alone.
 */
export function applyDamage(hp: number, max: number, temp: number, amount: number): { hp: number; tempHp: number } {
  if (amount <= 0) return { hp: Math.min(max, Math.max(0, hp - amount)), tempHp: temp };
  const soaked = Math.min(temp, amount);
  return { hp: Math.max(0, hp - (amount - soaked)), tempHp: temp - soaked };
}

// ---------------------------------------------------------------- initiative
const STEP = 1000;

export const orderOf = (entries: InitEntry[]): InitEntry[] => [...entries].sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : 1));

/** Give every entry a fresh, evenly spaced position in the order they are listed in. */
function renumber(list: InitEntry[]): InitEntry[] {
  return list.map((e, i) => ({ ...e, o: (i + 1) * STEP }));
}

/** Highest initiative first. Equal numbers keep the order they already had. */
export function sortByInit(entries: InitEntry[]): InitEntry[] {
  const cur = orderOf(entries);
  return renumber(cur.map((e, idx) => ({ e, idx })).sort((a, b) => b.e.i - a.e.i || a.idx - b.idx).map((x) => x.e));
}

/** Put `id` just before `beforeId` (or at the end when null). */
export function moveEntry(entries: InitEntry[], id: string, beforeId: string | null): InitEntry[] {
  const cur = orderOf(entries);
  const item = cur.find((e) => e.id === id);
  if (!item || id === beforeId) return cur;
  const rest = cur.filter((e) => e.id !== id);
  const at = beforeId ? rest.findIndex((e) => e.id === beforeId) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, item);
  return renumber(rest);
}

export function emptyInit(): InitState { return { round: 0, turn: null, shown: false, entries: [] }; }

/** Move to the next entry; going past the last one starts a new round. */
export function nextTurn(s: InitState): { turn: string | null; round: number } {
  const list = orderOf(s.entries);
  if (!list.length) return { turn: null, round: s.round };
  const idx = list.findIndex((e) => e.id === s.turn);
  if (idx < 0) return { turn: list[0].id, round: Math.max(1, s.round) };
  if (idx + 1 >= list.length) return { turn: list[0].id, round: Math.max(1, s.round) + 1 };
  return { turn: list[idx + 1].id, round: Math.max(1, s.round) };
}

export function prevTurn(s: InitState): { turn: string | null; round: number } {
  const list = orderOf(s.entries);
  if (!list.length) return { turn: null, round: s.round };
  const idx = list.findIndex((e) => e.id === s.turn);
  if (idx < 0) return { turn: list[0].id, round: Math.max(1, s.round) };
  if (idx === 0) return { turn: list[list.length - 1].id, round: Math.max(1, s.round - 1) };
  return { turn: list[idx - 1].id, round: Math.max(1, s.round) };
}

/** Is this entry something players may see? */
export function entryIsPublic(e: InitEntry, tokens: ReadonlyMap<string, Pick<Token, 'hidden'>>): boolean {
  if (e.h) return false;
  if (e.tk && tokens.get(e.tk)?.hidden) return false;
  return true;
}

/** The version of the order that players are allowed to read (null while the DM has not revealed it). */
export function toPub(s: InitState, tokens: ReadonlyMap<string, Pick<Token, 'hidden' | 'name'>>): InitPub | null {
  if (!s.shown) return null;
  const list = orderOf(s.entries).filter((e) => entryIsPublic(e, tokens));
  const turnEntry = list.find((e) => e.id === s.turn);
  return {
    round: s.round,
    turn: turnEntry ? turnEntry.id : null,
    entries: list.map((e) => ({ id: e.id, tk: e.tk, n: (e.tk && tokens.get(e.tk)?.name) || e.n, i: e.i, o: e.o })),
  };
}

export function rollD20(rng: () => number = Math.random): number { return Math.floor(rng() * 20) + 1; }

/** The name shown for an entry: the token's own name when it still exists. */
export function entryName(e: { tk: string | null; n: string }, tokens: ReadonlyMap<string, Pick<Token, 'name'>>): string {
  return (e.tk && tokens.get(e.tk)?.name) || e.n || 'Unnamed';
}

// ---------------------------------------------------------------- sight
/** How far a token sees, in world pixels, counted from its edge (like an aura). 0 when it has no sight. */
export function sightRadiusPx(t: Pick<Token, 'sight' | 'size'>, grid: Pick<GridSettings, 'ft' | 'cell'>): number {
  if (!(t.sight > 0)) return 0;
  return (t.sight / grid.ft) * grid.cell + (t.size * grid.cell) / 2;
}

/** Circles that clear fog: every token that can see anything. */
export function visionCircles(
  tokens: Iterable<Pick<Token, 'sight' | 'size' | 'x' | 'y' | 'id'>>,
  grid: Pick<GridSettings, 'ft' | 'cell'>,
  at: (t: { id: string; x: number; y: number }) => Vec = (t) => t,
): { id: string; x: number; y: number; r: number }[] {
  const out: { id: string; x: number; y: number; r: number }[] = [];
  for (const t of tokens) {
    const r = sightRadiusPx(t, grid);
    if (r <= 0) continue;
    const p = at(t);
    out.push({ id: t.id, x: p.x, y: p.y, r });
  }
  return out;
}

/** Moves shorter than this (in squares) do not add to the explored ground. */
export const EXPLORE_MIN_CELLS = 0.4;
/** A position change at least this many squares long, after the token had been still for a moment, counts as a teleport. */
export const EXPLORE_TELEPORT_CELLS = 2;
export const EXPLORE_TELEPORT_MS = 400;
/** A single position change this long is a teleport however fast it came (a drag never covers this much between two updates). */
export const EXPLORE_JUMP_CELLS = 12;
