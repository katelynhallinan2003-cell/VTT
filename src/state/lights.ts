import type { TokenLight } from '../types';

/** A light the DM made up and wants to use again: a name and how it shines. */
export interface CustomLight {
  id: string;
  name: string;
  light: TokenLight;
}

const KEY = 'vtt-custom-lights';
const subs = new Set<() => void>();
let cache: CustomLight[] | null = null;

const clean = (raw: unknown): CustomLight[] => {
  if (!Array.isArray(raw)) return [];
  const out: CustomLight[] = [];
  for (const r of raw) {
    const l = r as Partial<CustomLight> & { light?: Partial<TokenLight> };
    if (!l || typeof l.id !== 'string' || typeof l.name !== 'string' || !l.light) continue;
    const b = Number(l.light.b), d = Number(l.light.d);
    if (!Number.isFinite(b) || !Number.isFinite(d)) continue;
    out.push({
      id: l.id,
      name: l.name.slice(0, 40),
      light: { b: Math.max(0, b), d: Math.max(0, d), c: typeof l.light.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(l.light.c) ? l.light.c : '#ffd9a0' },
    });
  }
  return out.slice(0, 60);
};

/** The lights saved in this browser. */
export function customLights(): CustomLight[] {
  if (cache) return cache;
  try { cache = clean(JSON.parse(localStorage.getItem(KEY) ?? '[]')); } catch { cache = []; }
  return cache;
}

function store(list: CustomLight[]) {
  cache = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or off: it lasts until the page closes */ }
  for (const f of [...subs]) f();
}

/** Save a light under a name (a light with the same name is replaced). */
export function saveCustomLight(name: string, light: TokenLight): CustomLight {
  const nm = name.trim().slice(0, 40) || 'Custom light';
  const old = customLights().find((l) => l.name.toLowerCase() === nm.toLowerCase());
  const item: CustomLight = { id: old?.id ?? `cl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: nm, light: { ...light } };
  store(old ? customLights().map((l) => (l.id === old.id ? item : l)) : [...customLights(), item]);
  return item;
}

export function removeCustomLight(id: string) {
  store(customLights().filter((l) => l.id !== id));
}

export function subscribeLights(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** For tests. */
export function resetCustomLights() { cache = null; }
