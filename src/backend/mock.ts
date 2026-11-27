import type { AuthUser } from '../types';
import { pushKey, randomId } from '../core/ids';
import type { Backend, ChildHandlers, Unsub } from './types';

type Json = any;
const LS_KEY = 'vtt-mock-db-v1';
const SS_USER = 'vtt-mock-user-v1';

const split = (path: string) => path.split('/').filter(Boolean);

/** Realtime-Database semantics: null / undefined / empty objects don't exist. */
function prune(v: Json): Json {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

function getAt(tree: Json, path: string): Json {
  let cur = tree;
  for (const k of split(path)) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return null;
    cur = cur[k];
  }
  return cur === undefined ? null : cur;
}

function setAt(tree: Json, path: string, value: Json): Json {
  const keys = split(path);
  if (keys.length === 0) return prune(value) ?? {};
  const root = tree && typeof tree === 'object' ? tree : {};
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  const p = prune(value);
  if (p === undefined) delete cur[last];
  else cur[last] = p;
  return prune(root) ?? {};
}

function resolveSpecials(v: Json, now: number): Json {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return now;
    const out: Record<string, Json> = Array.isArray(v) ? ([] as any) : {};
    for (const [k, x] of Object.entries(v)) out[k] = resolveSpecials(x, now);
    return out;
  }
  return v;
}

interface ValueL { path: string; cb: (v: Json) => void; last: string }
interface ChildL { path: string; h: ChildHandlers; last: Record<string, string> }

export class MockBackend implements Backend {
  readonly kind = 'mock' as const;
  private tree: Json = {};
  private channel: BroadcastChannel | null = null;
  private valueLs = new Set<ValueL>();
  private childLs = new Set<ChildL>();
  private authCbs = new Set<(u: AuthUser | null) => void>();
  private user: AuthUser | null = null;
  private disconnects: [string, Json][] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly persist: boolean;

  constructor(opts: { persist?: boolean; channel?: string } = {}) {
    this.persist = opts.persist ?? true;
    if (this.persist && typeof localStorage !== 'undefined') {
      try { this.tree = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { this.tree = {}; }
    }
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(opts.channel ?? 'vtt-mock-channel');
      this.channel.onmessage = (ev) => {
        const msg = ev.data;
        if (msg?.type === 'update') this.apply(msg.updates, false);
        else if (msg?.type === 'sync-request') this.channel?.postMessage({ type: 'sync', tree: this.tree });
        else if (msg?.type === 'sync' && Object.keys(this.tree).length === 0) { this.tree = msg.tree; this.notify(); }
      };
      this.channel.postMessage({ type: 'sync-request' });
    }
    if (typeof sessionStorage !== 'undefined') {
      try { this.user = JSON.parse(sessionStorage.getItem(SS_USER) || 'null'); } catch { this.user = null; }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        for (const [p, v] of this.disconnects) this.apply({ [p]: v }, true);
        this.flush();
      });
    }
  }

  async ready() { /* nothing to wait for */ }

  // ---- auth (fake; the identity lives in sessionStorage so each tab is its own person) ----
  currentUser() { return this.user; }
  onAuth(cb: (u: AuthUser | null) => void): Unsub {
    this.authCbs.add(cb);
    queueMicrotask(() => cb(this.user));
    return () => this.authCbs.delete(cb);
  }
  private setUser(u: AuthUser | null) {
    this.user = u;
    try { sessionStorage.setItem(SS_USER, JSON.stringify(u)); } catch { /* ignore */ }
    for (const cb of this.authCbs) cb(u);
  }
  async signInGoogle() {
    const u: AuthUser = { uid: 'demo-dm', name: 'Demo DM', email: 'dm@demo.local', photo: null, anonymous: false };
    this.setUser(u);
    return u;
  }
  async signInAnon() {
    if (this.user) return this.user;
    const u: AuthUser = { uid: 'anon-' + randomId(8), name: null, email: null, photo: null, anonymous: true };
    this.setUser(u);
    return u;
  }
  async signOut() { this.setUser(null); }
  /** test helper: act as a specific user */
  forceUser(u: AuthUser | null) { this.setUser(u); }

  // ---- data ----
  async transaction(path: string, change: (value: any) => any) {
    const next=change(structuredClone(getAt(this.tree,path)));
    if (next !== undefined) this.apply({[path]:next},true);
  }
  async get(path: string) { return structuredClone(getAt(this.tree, path)); }
  async set(path: string, value: any) { this.apply({ [path]: value }, true); }
  async remove(path: string) { this.apply({ [path]: null }, true); }
  async update(updates: Record<string, any>) { this.apply(updates, true); }
  newKey() { return pushKey(); }
  now() { return Date.now(); }
  onDisconnectSet(path: string, value: any) { this.disconnects.push([path, value]); }

  private apply(updates: Record<string, Json>, broadcast: boolean) {
    const now = Date.now();
    const resolved: Record<string, Json> = {};
    for (const [p, v] of Object.entries(updates)) resolved[p] = resolveSpecials(v, now);
    for (const [p, v] of Object.entries(resolved)) this.tree = setAt(this.tree, p, structuredClone(v ?? null));
    if (broadcast) this.channel?.postMessage({ type: 'update', updates: resolved });
    this.schedulePersist();
    this.notify();
  }

  private schedulePersist() {
    if (!this.persist || this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.flush(); }, 200);
  }
  private flush() {
    if (!this.persist) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.tree)); } catch { /* quota */ }
  }

  private notify() {
    for (const l of [...this.valueLs]) {
      const v = getAt(this.tree, l.path);
      const s = JSON.stringify(v);
      if (s !== l.last) { l.last = s; l.cb(structuredClone(v)); }
    }
    for (const l of [...this.childLs]) this.diffChildren(l);
  }

  private diffChildren(l: ChildL) {
    const node = getAt(this.tree, l.path);
    const cur: Record<string, string> = {};
    const vals: Record<string, Json> = {};
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node).sort()) { cur[k] = JSON.stringify(node[k]); vals[k] = node[k]; }
    }
    const removed = Object.keys(l.last).filter((k) => !(k in cur));
    const prev = l.last;
    l.last = cur;
    for (const k of removed) l.h.removed?.(k, JSON.parse(prev[k]));
    for (const k of Object.keys(cur)) {
      if (!(k in prev)) l.h.added?.(k, structuredClone(vals[k]));
      else if (prev[k] !== cur[k]) l.h.changed?.(k, structuredClone(vals[k]));
    }
  }

  listen(path: string, cb: (v: any) => void): Unsub {
    const l: ValueL = { path, cb, last: '\u0000unset' };
    this.valueLs.add(l);
    queueMicrotask(() => {
      if (!this.valueLs.has(l)) return;
      const v = getAt(this.tree, path);
      l.last = JSON.stringify(v);
      cb(structuredClone(v));
    });
    return () => this.valueLs.delete(l);
  }

  listenChildren(path: string, h: ChildHandlers): Unsub {
    const l: ChildL = { path, h, last: {} };
    this.childLs.add(l);
    queueMicrotask(() => { if (this.childLs.has(l)) this.diffChildren(l); });
    return () => this.childLs.delete(l);
  }

  /** test helper */
  dump() { return structuredClone(this.tree); }
}
