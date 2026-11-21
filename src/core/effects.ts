// Conditions and other effects on tokens: the ready-made ones, how they are stored and how they count down.
import type { Effect, FxLook, FxTick } from '../types';

export type FxGroup = 'condition' | 'combat' | 'spell' | 'other';
export interface FxPreset { n: string; ic: string; c: string; group: FxGroup }

/** How the ready-made effects are grouped in the picker, in order. */
export const FX_GROUPS: { id: FxGroup; label: string }[] = [
  { id: 'condition', label: 'Conditions' },
  { id: 'combat', label: 'In combat' },
  { id: 'spell', label: 'Spells and buffs' },
  { id: 'other', label: 'Other' },
];

/** The 5e conditions first, then the things tables track all the time. */
export const FX_PRESETS: FxPreset[] = [
  { n: 'Blinded', ic: '🕶️', c: '#868e96', group: 'condition' },
  { n: 'Charmed', ic: '💖', c: '#f06595', group: 'condition' },
  { n: 'Deafened', ic: '🔇', c: '#adb5bd', group: 'condition' },
  { n: 'Exhaustion', ic: '🥱', c: '#a9806a', group: 'condition' },
  { n: 'Frightened', ic: '😱', c: '#9775fa', group: 'condition' },
  { n: 'Grappled', ic: '✊', c: '#f59f00', group: 'condition' },
  { n: 'Incapacitated', ic: '💫', c: '#fab005', group: 'condition' },
  { n: 'Invisible', ic: '👻', c: '#74c0fc', group: 'condition' },
  { n: 'Paralyzed', ic: '⚡', c: '#ffd43b', group: 'condition' },
  { n: 'Petrified', ic: '🗿', c: '#868e96', group: 'condition' },
  { n: 'Poisoned', ic: '🤢', c: '#51cf66', group: 'condition' },
  { n: 'Prone', ic: '⬇️', c: '#a9806a', group: 'condition' },
  { n: 'Restrained', ic: '⛓️', c: '#868e96', group: 'condition' },
  { n: 'Stunned', ic: '😵', c: '#ffa94d', group: 'condition' },
  { n: 'Unconscious', ic: '💤', c: '#4dabf7', group: 'condition' },

  { n: 'Raging', ic: '😤', c: '#e03131', group: 'combat' },
  { n: 'Dodging', ic: '🌀', c: '#4dabf7', group: 'combat' },
  { n: 'Dashing', ic: '🏃', c: '#66d9e8', group: 'combat' },
  { n: 'Readied action', ic: '⏳', c: '#fab005', group: 'combat' },
  { n: 'Reaction used', ic: '↩️', c: '#868e96', group: 'combat' },
  { n: 'Hidden', ic: '🫥', c: '#74c0fc', group: 'combat' },
  { n: 'Surprised', ic: '❗', c: '#ffa94d', group: 'combat' },
  { n: 'Half cover', ic: '🧱', c: '#a9806a', group: 'combat' },
  { n: 'Three-quarters cover', ic: '🧱', c: '#868e96', group: 'combat' },

  { n: 'Concentrating', ic: '🧠', c: '#38d9a9', group: 'spell' },
  { n: 'Blessed', ic: '✨', c: '#ffe066', group: 'spell' },
  { n: 'Bane', ic: '🌑', c: '#7048e8', group: 'spell' },
  { n: 'Hasted', ic: '💨', c: '#66d9e8', group: 'spell' },
  { n: 'Slowed', ic: '🐌', c: '#b197fc', group: 'spell' },
  { n: 'Hex', ic: '🔮', c: '#9c36b5', group: 'spell' },
  { n: "Hunter's Mark", ic: '🏹', c: '#51cf66', group: 'spell' },
  { n: 'Faerie Fire', ic: '🧚', c: '#faa2c1', group: 'spell' },
  { n: 'Mage Armor', ic: '🔰', c: '#4dabf7', group: 'spell' },
  { n: 'Shield of Faith', ic: '🛡️', c: '#ffd43b', group: 'spell' },
  { n: 'Flying', ic: '🕊️', c: '#a5d8ff', group: 'spell' },
  { n: 'Silenced', ic: '🤐', c: '#adb5bd', group: 'spell' },
  { n: 'Entangled', ic: '🌿', c: '#40c057', group: 'spell' },
  { n: 'Enlarged', ic: '🔼', c: '#f59f00', group: 'spell' },
  { n: 'Reduced', ic: '🔽', c: '#74c0fc', group: 'spell' },

  { n: 'Burning', ic: '🔥', c: '#ff6b6b', group: 'other' },
  { n: 'Bleeding', ic: '🩸', c: '#e03131', group: 'other' },
  { n: 'Frozen', ic: '🧊', c: '#99e9f2', group: 'other' },
  { n: 'Wet', ic: '💧', c: '#4dabf7', group: 'other' },
  { n: 'Marked', ic: '🎯', c: '#ff8787', group: 'other' },
  { n: 'Shielded', ic: '🛡️', c: '#4dabf7', group: 'other' },
  { n: 'Stable', ic: '🩹', c: '#8ce99a', group: 'other' },
  { n: 'Dying', ic: '💀', c: '#e03131', group: 'other' },
];

/**
 * The ready-made effects that match what was typed, best matches first: names that start with it, then words that start with it, then
 * names that contain it. An empty search gives everything in its usual order.
 */
export function searchFx<T extends { n: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.split(/[\s'-]+/).some((w) => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : -1;
  };
  return list.map((x, i) => ({ x, i, r: rank(x.n) })).filter((o) => o.r >= 0).sort((a, b) => a.r - b.r || a.i - b.i).map((o) => o.x);
}

export const FX_LOOKS: { id: FxLook; label: string; hint: string }[] = [
  { id: 'badge', label: 'Badge', hint: 'A round coloured badge with the picture, above the token.' },
  { id: 'halo', label: 'Glow', hint: 'A soft coloured glow around the token, plus the badge.' },
  { id: 'orbit', label: 'Orbit', hint: 'The picture repeated around the token like a ring of symbols.' },
  { id: 'dot', label: 'Dot', hint: 'Just a small coloured dot.' },
];

export const FX_TICKS: { id: FxTick; label: string; hint: string }[] = [
  { id: 'end', label: 'End of its turn', hint: 'Counts down when this token’s turn ends.' },
  { id: 'start', label: 'Start of its turn', hint: 'Counts down when this token’s turn begins.' },
  { id: 'round', label: 'Every round', hint: 'Counts down once at the start of each new round.' },
];

/** Pictures to choose from for a made-up effect, in groups. (Any other emoji can be typed or pasted in.) */
export const FX_EMOJI: { label: string; list: string[] }[] = [
  { label: 'Status', list: ['☠️', '💀', '😵', '💤', '😱', '🤢', '🥱', '😤', '🥶', '🥵', '😈', '🤕', '😴', '🤪', '😡', '🥴', '🫥', '👁️', '🕶️', '🔇', '🤐', '🫠'] },
  { label: 'Elements', list: ['🔥', '❄️', '⚡', '💧', '🌿', '🌀', '☁️', '🌑', '☀️', '🌪️', '🪨', '🧊', '🌊', '☣️', '☢️', '🍄', '💨'] },
  { label: 'Combat', list: ['⚔️', '🗡️', '🏹', '🛡️', '🎯', '💥', '🩸', '🩹', '⛓️', '🕸️', '🔒', '🪤', '🔔', '🚫', '❗', '❓'] },
  { label: 'Magic', list: ['✨', '🔮', '🧠', '💫', '⭐', '🌟', '🪄', '📿', '🧿', '👻', '🧚', '🕊️', '🐉', '🦇', '🕯️', '🔰'] },
  { label: 'Other', list: ['❤️', '💖', '💔', '⏳', '⬆️', '⬇️', '🔼', '🔽', '🎲', '🍺', '🧪', '🪙', '👑', '🎭', '🔑', '📌'] },
];
export const FX_ICONS = FX_EMOJI.flatMap((g) => g.list);

export const MAX_FX = 8;

const hexOk = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

export const newFxId = (): string => Math.random().toString(36).slice(2, 8);

/** Read the effects of a token from what the database holds (an array, or an object when the database thinks it has gaps). */
export function normalizeFx(raw: any): Effect[] {
  if (!raw || typeof raw !== 'object') return [];
  const list: any[] = Array.isArray(raw) ? raw : Object.keys(raw).sort((a, b) => Number(a) - Number(b)).map((k) => raw[k]);
  const out: Effect[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const n = typeof e.n === 'string' ? e.n.trim().slice(0, 40) : '';
    if (!n) continue;
    out.push({
      id: typeof e.id === 'string' && e.id ? e.id.slice(0, 12) : newFxId(),
      n,
      ic: typeof e.ic === 'string' ? e.ic.slice(0, 8) : '',
      c: hexOk(e.c) ? e.c : '#ff6b6b',
      look: e.look === 'halo' || e.look === 'orbit' || e.look === 'dot' ? e.look : 'badge',
      tint: e.tint === true,
      tc: hexOk(e.tc) ? e.tc : '',
      left: typeof e.left === 'number' && Number.isFinite(e.left) ? Math.min(999, Math.max(0, Math.round(e.left))) : null,
      tick: e.tick === 'start' || e.tick === 'round' ? e.tick : 'end',
    });
    if (out.length >= MAX_FX) break;
  }
  return out;
}

export function fxToWire(list: Effect[]): Record<string, unknown>[] | null {
  if (!list.length) return null;
  return list.slice(0, MAX_FX).map((e) => {
    const o: Record<string, unknown> = { id: e.id, n: e.n, c: e.c };
    if (e.ic) o.ic = e.ic;
    if (e.look !== 'badge') o.look = e.look;
    if (e.tint) { o.tint = true; if (e.tc && e.tc !== e.c) o.tc = e.tc; }
    if (e.left != null) o.left = e.left;
    if (e.tick !== 'end') o.tick = e.tick;
    return o;
  });
}

/** An effect from a preset or typed details, ready to put on a token. */
export function makeEffect(p: { n: string; ic?: string; c?: string; look?: FxLook; tint?: boolean; tc?: string; left?: number | null; tick?: FxTick }): Effect {
  return {
    id: newFxId(),
    n: p.n.trim().slice(0, 40) || 'Effect',
    ic: (p.ic ?? '').slice(0, 8),
    c: hexOk(p.c) ? p.c : '#ff6b6b',
    look: p.look ?? 'badge',
    tint: p.tint === true,
    tc: hexOk(p.tc) ? p.tc : '',
    left: p.left == null ? null : Math.max(0, Math.round(p.left)),
    tick: p.tick ?? 'end',
  };
}

/** Put an effect on a list: applying the same one again (same name) replaces it, so its timer starts over. */
export function addFx(list: Effect[], e: Effect): Effect[] {
  const same = list.findIndex((x) => x.n.toLowerCase() === e.n.toLowerCase());
  const next = same >= 0 ? list.map((x, i) => (i === same ? { ...e, id: x.id } : x)) : [...list, e];
  return next.slice(0, MAX_FX);
}

/**
 * Count down the effects that tick on this moment. An effect whose time runs out is removed.
 * `all` makes every timed effect tick whatever its own setting (used for tokens that are not in the turn order).
 */
export function tickFx(list: Effect[], moment: FxTick, all = false): { fx: Effect[]; ended: Effect[]; changed: boolean } {
  const ended: Effect[] = [];
  let changed = false;
  const fx: Effect[] = [];
  for (const e of list) {
    if (e.left == null || (!all && e.tick !== moment)) { fx.push(e); continue; }
    changed = true;
    const left = e.left - 1;
    if (left <= 0) ended.push(e); else fx.push({ ...e, left });
  }
  return { fx, ended, changed };
}

/** "3 rounds", "1 round" or "until removed". */
export function fxDuration(e: Pick<Effect, 'left'>): string {
  if (e.left == null) return 'until removed';
  return `${e.left} round${e.left === 1 ? '' : 's'}`;
}

/** What shows next to an effect to explain when it counts down. */
export function fxTickLabel(t: FxTick): string {
  return FX_TICKS.find((x) => x.id === t)?.label ?? '';
}

/** The colour a tinted effect washes over its token. */
export const tintColor = (e: Pick<Effect, 'c' | 'tc'>): string => e.tc || e.c;
