import type { Backend, Unsub } from '../backend/types';
import { SERVER_TS } from '../backend/types';
import {
  normalizeFogOp, normalizeMeta, normalizePlayer, normalizeSceneMeta, normalizeSettings, normalizeToken,
  stripUndefined, tokenToWire, DEFAULT_GRID, DM_COLOR,
} from '../core/model';
import { can, detectPreset, PRESETS, type Action } from '../core/permissions';
import { mapRect, snapTokenCenter } from '../core/geometry';
import type {
  FogOp, GridSettings, Permissions, PermPreset, Ping, Player, Role, SceneIndexEntry, SceneMeta,
  TableMeta, TableSettings, Token, Vec,
} from '../types';
import { History } from './history';
import { P } from './paths';

export interface SceneState {
  id: string;
  loaded: boolean;
  meta: SceneMeta | null;
  tokens: Map<string, Token>;
  tokensRev: number;
  fogOps: Map<string, FogOp>;
  fogRev: number;
  metaRev: number;
}

export type ScenePatch = Partial<Omit<SceneMeta, 'grid' | 'fog'>> & {
  grid?: Partial<GridSettings>;
  fog?: Partial<SceneMeta['fog']>;
};

let tokenClipboard: Token[] = [];
const UNDOABLE_SCENE_KEYS = new Set(['mapX', 'mapY', 'mapScale', 'mapLocked', 'bg', 'grid', 'fog']);

/**
 * Everything the app knows about one table, kept in sync with the backend.
 * Reads come from listeners (which fire immediately for local writes, so the UI is optimistic);
 * writes are plain database updates.
 */
export class TableClient {
  meta: TableMeta | null = null;
  metaLoaded = false;
  settings: TableSettings = { perm: { ...PRESETS.trusting }, preset: 'trusting' };
  players = new Map<string, Player>();
  sceneIndex: SceneIndexEntry[] = [];
  uploadKey: string | null = null;
  viewSceneId: string | null = null;
  scene: SceneState | null = null;
  rev = 0;
  lastError: string | null = null;
  readonly history = new History(() => this.bump());

  private listeners = new Set<() => void>();
  private pingListeners = new Set<(p: Ping) => void>();
  private unsubs: Unsub[] = [];
  private sceneUnsubs: Unsub[] = [];
  private notifyQueued = false;
  private seenPings = new Set<string>();
  private started = false;
  private stopped = false;

  constructor(
    readonly backend: Backend,
    readonly tableId: string,
    readonly uid: string,
    readonly role: Role,
  ) {}

  // ---------------------------------------------------------------- subscription plumbing
  subscribe(fn: () => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onPing(fn: (p: Ping) => void): Unsub {
    this.pingListeners.add(fn);
    return () => this.pingListeners.delete(fn);
  }
  private bump() {
    this.rev++;
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      if (!this.stopped) for (const fn of [...this.listeners]) fn();
    });
  }
  private fail(where: string) {
    return (e: Error) => { this.lastError = `${where}: ${e.message}`; console.warn(this.lastError); this.bump(); };
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    if (this.started) return;
    this.started = true;
    const b = this.backend;
    const tid = this.tableId;

    this.unsubs.push(b.listen(P.meta(tid), (v) => {
      this.meta = v ? normalizeMeta(v) : null;
      this.metaLoaded = true;
      this.followActiveScene();
      this.bump();
    }, this.fail('meta')));

    this.unsubs.push(b.listen(P.settings(tid), (v) => {
      this.settings = normalizeSettings(v, PRESETS);
      this.bump();
    }, this.fail('settings')));

    this.unsubs.push(b.listenChildren(P.players(tid), {
      added: (k, v) => { this.players.set(k, normalizePlayer(k, v)); this.bump(); },
      changed: (k, v) => { this.players.set(k, normalizePlayer(k, v)); this.bump(); },
      removed: (k) => { this.players.delete(k); this.bump(); },
    }, this.fail('players')));

    this.unsubs.push(b.listen(P.uploadKey(tid), (v) => {
      this.uploadKey = typeof v === 'string' && v ? v : null;
      this.bump();
    }, this.fail('upload key')));

    if (this.role === 'dm') {
      this.unsubs.push(b.listenChildren(P.sceneIndex(tid), {
        added: (k, v) => this.setIndex(k, v),
        changed: (k, v) => this.setIndex(k, v),
        removed: (k) => { this.sceneIndex = this.sceneIndex.filter((s) => s.id !== k); this.bump(); },
      }, this.fail('scenes')));
    }

    this.armPresence();
    if (b.kind === 'firebase') {
      this.unsubs.push(b.listen('.info/connected', (v) => { if (v === true) this.armPresence(); }));
    }
  }

  stop() {
    this.stopped = true;
    for (const u of this.unsubs) u();
    for (const u of this.sceneUnsubs) u();
    this.unsubs = [];
    this.sceneUnsubs = [];
    this.listeners.clear();
    this.pingListeners.clear();
  }

  private armPresence() {
    const path = P.player(this.tableId, this.uid);
    void this.backend.get(path).then(async (cur) => {
      if (this.isDM && !cur) {
        // the DM is a named participant too (so pings and chat-free labels can say who did what)
        await this.backend.set(path, { name: 'DM', color: DM_COLOR, online: true, dm: true, joinedAt: SERVER_TS });
      } else if (cur) {
        await this.backend.update({ [`${path}/online`]: true });
      } else {
        return; // a player who has not joined yet
      }
      this.backend.onDisconnectSet(`${path}/online`, false);
    }).catch(() => undefined);
  }

  private setIndex(id: string, v: any) {
    const entry: SceneIndexEntry = { id, name: typeof v?.name === 'string' ? v.name : 'Scene', order: Number(v?.order) || 0 };
    this.sceneIndex = [...this.sceneIndex.filter((s) => s.id !== id), entry].sort((a, b) => a.order - b.order);
    // DM with nothing open yet: open the active scene, or the first scene
    if (this.role === 'dm' && !this.viewSceneId && this.metaLoaded) this.followActiveScene();
    this.bump();
  }

  /** Players always follow the active scene. The DM opens it on arrival and then browses freely. */
  private followActiveScene() {
    const active = this.meta?.activeScene ?? null;
    if (this.role === 'player') {
      if (active !== this.viewSceneId) this.openScene(active);
      return;
    }
    if (!this.viewSceneId) {
      const target = active ?? this.sceneIndex[0]?.id ?? null;
      if (target) this.openScene(target);
    }
  }

  openScene(sid: string | null) {
    for (const u of this.sceneUnsubs) u();
    this.sceneUnsubs = [];
    this.seenPings.clear();
    this.history.clear();
    this.viewSceneId = sid;
    if (!sid) { this.scene = null; this.bump(); return; }

    const s: SceneState = {
      id: sid, loaded: false, meta: null, tokens: new Map(), tokensRev: 0,
      fogOps: new Map(), fogRev: 0, metaRev: 0,
    };
    this.scene = s;
    const b = this.backend;
    const tid = this.tableId;
    const live = () => this.scene === s;
    const sceneFail = (where: string) => (e: Error) => { if (live()) this.fail(where)(e); };

    this.sceneUnsubs.push(b.listen(P.sceneMeta(tid, sid), (v) => {
      if (!live()) return;
      s.meta = v ? normalizeSceneMeta(v) : null;
      s.loaded = true;
      s.metaRev++;
      this.bump();
    }, sceneFail('scene')));

    const tokenHandlers = (hidden: boolean) => ({
      added: (k: string, v: any) => { if (live()) { s.tokens.set(k, normalizeToken(k, v, hidden)); s.tokensRev++; this.bump(); } },
      changed: (k: string, v: any) => { if (live()) { s.tokens.set(k, normalizeToken(k, v, hidden)); s.tokensRev++; this.bump(); } },
      removed: (k: string) => {
        if (!live()) return;
        const cur = s.tokens.get(k);
        // ignore the "removed" half of a reveal/hide move, which arrives after the new copy was added
        if (cur && cur.hidden === hidden) { s.tokens.delete(k); s.tokensRev++; this.bump(); }
      },
    });
    this.sceneUnsubs.push(b.listenChildren(P.sceneTokens(tid, sid), tokenHandlers(false), sceneFail('tokens')));
    if (this.role === 'dm') {
      this.sceneUnsubs.push(b.listenChildren(P.dmSceneTokens(tid, sid), tokenHandlers(true), sceneFail('hidden tokens')));
    }

    const fogSet = (k: string, v: any) => {
      if (!live()) return;
      const op = normalizeFogOp(v);
      if (op) s.fogOps.set(k, op); else s.fogOps.delete(k);
      s.fogRev++; this.bump();
    };
    this.sceneUnsubs.push(b.listenChildren(P.sceneFog(tid, sid), {
      added: fogSet, changed: fogSet,
      removed: (k) => { if (live()) { s.fogOps.delete(k); s.fogRev++; this.bump(); } },
    }, sceneFail('fog')));

    this.sceneUnsubs.push(b.listenChildren(P.scenePings(tid, sid), {
      added: (k, v) => this.onPingAdded(k, v),
    }, sceneFail('pings')));

    this.bump();
  }

  private onPingAdded(id: string, v: any) {
    if (this.seenPings.has(id) || !v) return;
    this.seenPings.add(id);
    const age = this.backend.now() - Number(v.t || 0);
    if (age > 6000) {
      if (this.role === 'dm') void this.backend.remove(`${P.scenePings(this.tableId, this.viewSceneId!)}/${id}`);
      return;
    }
    const ping: Ping = {
      id, x: Number(v.x) || 0, y: Number(v.y) || 0, uid: String(v.uid ?? ''),
      color: typeof v.color === 'string' ? v.color : '#ffffff', name: typeof v.name === 'string' ? v.name : '', t: Number(v.t) || 0,
    };
    for (const fn of [...this.pingListeners]) fn(ping);
  }

  // ---------------------------------------------------------------- derived helpers
  get me(): Player | null { return this.players.get(this.uid) ?? null; }
  get isDM() { return this.role === 'dm'; }
  get activeSceneId() { return this.meta?.activeScene ?? null; }
  get sceneIsActive() { return !!this.viewSceneId && this.viewSceneId === this.activeSceneId; }
  get grid(): GridSettings { return this.scene?.meta?.grid ?? DEFAULT_GRID; }

  canDo(action: Action, token?: Token): boolean {
    return can({ role: this.role, uid: this.uid, perm: this.settings.perm, sceneActive: this.sceneIsActive }, action, token);
  }

  myTokens(): Token[] {
    return [...(this.scene?.tokens.values() ?? [])].filter((t) => t.ownerUid === this.uid);
  }

  /** Fog ops in draw order (push keys sort chronologically). */
  fogOpsSorted(): [string, FogOp][] {
    return [...(this.scene?.fogOps.entries() ?? [])].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  private tokenPath(token: Pick<Token, 'id' | 'hidden'>) {
    const sid = this.viewSceneId!;
    return token.hidden ? P.dmSceneToken(this.tableId, sid, token.id) : P.sceneToken(this.tableId, sid, token.id);
  }

  // ---------------------------------------------------------------- tokens
  async addToken(partial: Partial<Token> & { x: number; y: number }, opts: { record?: boolean } = {}): Promise<string> {
    const sid = this.viewSceneId;
    if (!sid) throw new Error('No scene is open');
    const id = this.backend.newKey();
    const z = Math.max(0, ...[...(this.scene?.tokens.values() ?? [])].map((t) => t.z)) + 1;
    const hidden = this.isDM && !!partial.hidden;
    const token = normalizeToken(id, { ...partial, z }, hidden);
    if (!this.isDM) token.ownerUid = this.uid; // players may only create tokens they own
    await this.backend.set(this.tokenPath(token), tokenToWire(token));
    if (opts.record !== false) this.recordCreated([token], 'Add token');
    return id;
  }

  /** Write tokens back exactly as they were (used by undo and by paste). */
  async restoreTokens(tokens: Token[]): Promise<void> {
    const updates: Record<string, any> = {};
    for (const t of tokens) updates[this.tokenPath(t)] = tokenToWire(t);
    if (Object.keys(updates).length) await this.backend.update(updates);
  }
  private async deleteTokensRaw(tokens: Pick<Token, 'id' | 'hidden'>[]): Promise<void> {
    const updates: Record<string, any> = {};
    for (const t of tokens) updates[this.tokenPath(t)] = null;
    if (Object.keys(updates).length) await this.backend.update(updates);
  }
  private recordCreated(tokens: Token[], label: string) {
    const snaps = tokens.map((t) => ({ ...t }));
    this.history.push({
      label,
      undo: () => this.deleteTokensRaw(snaps),
      redo: () => this.restoreTokens(snaps),
    });
  }

  async updateToken(id: string, patch: Partial<Omit<Token, 'id'>>): Promise<void> {
    const cur = this.scene?.tokens.get(id);
    if (!cur || !this.viewSceneId) return;
    if (patch.hidden !== undefined && patch.hidden !== cur.hidden) {
      if (!this.isDM) return;
      const next = { ...cur, ...patch, hidden: patch.hidden };
      await this.backend.update({
        [this.tokenPath(cur)]: null,
        [this.tokenPath(next)]: tokenToWire(next),
      });
      return;
    }
    const base = this.tokenPath(cur);
    const updates: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'hidden') continue;
      updates[`${base}/${k}`] = v === undefined ? null : v;
    }
    if (Object.keys(updates).length) await this.backend.update(updates);
  }

  async updateTokens(ids: string[], patch: Partial<Omit<Token, 'id'>>, opts: { record?: boolean } = {}) {
    const before: { id: string; prev: Partial<Omit<Token, 'id'>> }[] = [];
    for (const id of ids) {
      const cur = this.scene?.tokens.get(id);
      if (!cur) continue;
      const prev: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) prev[k] = (cur as any)[k] ?? null;
      before.push({ id, prev: prev as Partial<Omit<Token, 'id'>> });
    }
    await Promise.all(ids.map((id) => this.updateToken(id, patch)));
    if (opts.record !== false && before.length) {
      const keys = Object.keys(patch).sort().join(',');
      this.history.push({
        label: 'Edit token',
        key: `tok:${before.map((b) => b.id).join('+')}:${keys}`,
        undo: async () => { await Promise.all(before.map((b) => this.updateToken(b.id, b.prev))); },
        redo: async () => { await Promise.all(before.map((b) => this.updateToken(b.id, patch))); },
      });
    }
  }
  /** Move tokens. Pass `before` (their old positions) to make it an undoable step. */
  async moveTokens(moves: { id: string; x: number; y: number }[], before?: { id: string; x: number; y: number }[]): Promise<void> {
    const updates: Record<string, any> = {};
    for (const m of moves) {
      const t = this.scene?.tokens.get(m.id);
      if (!t) continue;
      const base = this.tokenPath(t);
      updates[`${base}/x`] = Math.round(m.x * 10) / 10;
      updates[`${base}/y`] = Math.round(m.y * 10) / 10;
    }
    if (Object.keys(updates).length) await this.backend.update(updates);
    if (before?.length) {
      this.history.push({
        label: before.length > 1 ? 'Move tokens' : 'Move token',
        undo: () => this.moveTokens(before),
        redo: () => this.moveTokens(moves),
      });
    }
  }

  async removeTokens(ids: string[]): Promise<void> {
    const snaps: Token[] = [];
    for (const id of ids) {
      const t = this.scene?.tokens.get(id);
      if (t) snaps.push({ ...t });
    }
    if (!snaps.length) return;
    await this.deleteTokensRaw(snaps);
    this.history.push({
      label: snaps.length > 1 ? 'Delete tokens' : 'Delete token',
      undo: () => this.restoreTokens(snaps),
      redo: () => this.deleteTokensRaw(snaps),
    });
  }

  async bringToFront(ids: string[]) {
    const max = Math.max(0, ...[...(this.scene?.tokens.values() ?? [])].map((t) => t.z));
    await Promise.all(ids.map((id, i) => this.updateToken(id, { z: max + 1 + i })));
  }
  async sendToBack(ids: string[]) {
    const min = Math.min(0, ...[...(this.scene?.tokens.values() ?? [])].map((t) => t.z));
    await Promise.all(ids.map((id, i) => this.updateToken(id, { z: min - 1 - i })));
  }

  async duplicateTokens(ids: string[], offsetPx: number): Promise<string[]> {
    const out: string[] = [];
    const made: Token[] = [];
    for (const id of ids) {
      const t = this.scene?.tokens.get(id);
      if (!t) continue;
      const { id: _id, ...rest } = t;
      const baseName = t.name.replace(/\s+\d+$/, '');
      const siblings = [...(this.scene?.tokens.values() ?? [])].filter((o) => o.name.replace(/\s+\d+$/, '') === baseName && baseName);
      const name = baseName ? `${baseName} ${siblings.length + 1}` : '';
      const nid = await this.addToken({ ...rest, name, x: t.x + offsetPx, y: t.y + offsetPx, ownerUid: this.isDM ? null : this.uid }, { record: false });
      out.push(nid);
      const made1 = this.scene?.tokens.get(nid);
      if (made1) made.push(made1);
    }
    if (made.length) this.recordCreated(made, made.length > 1 ? 'Duplicate tokens' : 'Duplicate token');
    return out;
  }

  /** Remember tokens for pasting (works across scenes). */
  copyTokens(ids: string[]): number {
    const list = ids.map((id) => this.scene?.tokens.get(id)).filter((t): t is Token => !!t).map((t) => ({ ...t }));
    tokenClipboard = list;
    return list.length;
  }
  get clipboardCount() { return tokenClipboard.length; }

  /** Paste the copied tokens with their group centred on `at` (snapped to the grid). */
  async pasteTokens(at: Vec): Promise<string[]> {
    const list = tokenClipboard;
    if (!list.length || !this.canDo('create')) return [];
    const cx = list.reduce((a, t) => a + t.x, 0) / list.length;
    const cy = list.reduce((a, t) => a + t.y, 0) / list.length;
    const g = this.grid;
    const out: string[] = [];
    const made: Token[] = [];
    for (const t of list) {
      const { id: _id, ...rest } = t;
      let x = at.x + (t.x - cx);
      let y = at.y + (t.y - cy);
      if (g.snap) ({ x, y } = snapTokenCenter(g, t.size, { x, y }));
      const baseName = t.name.replace(/\s+\d+$/, '');
      const siblings = [...(this.scene?.tokens.values() ?? [])].filter((o) => baseName && o.name.replace(/\s+\d+$/, '') === baseName);
      const name = baseName ? `${baseName} ${siblings.length + 1}` : '';
      const nid = await this.addToken({ ...rest, name, x, y, ownerUid: this.isDM ? t.ownerUid : this.uid }, { record: false });
      out.push(nid);
      const made1 = this.scene?.tokens.get(nid);
      if (made1) made.push(made1);
    }
    if (made.length) this.recordCreated(made, made.length > 1 ? 'Paste tokens' : 'Paste token');
    return out;
  }

  // ---------------------------------------------------------------- pings
  async ping(x: number, y: number) {
    const sid = this.viewSceneId;
    const me = this.me;
    if (!sid || !this.canDo('ping')) return;
    const key = this.backend.newKey();
    const path = `${P.scenePings(this.tableId, sid)}/${key}`;
    await this.backend.set(path, {
      x: Math.round(x), y: Math.round(y), uid: this.uid,
      color: me?.color ?? '#ffffff', name: me?.name ?? (this.isDM ? 'DM' : 'Player'), t: SERVER_TS,
    });
    setTimeout(() => { void this.backend.remove(path).catch(() => undefined); }, 5000);
  }

  // ---------------------------------------------------------------- scenes (DM)
  async createScene(opts: { name: string; mapUrl?: string | null; mapW?: number; mapH?: number; grid?: Partial<GridSettings>; makeActive?: boolean }): Promise<string> {
    const tid = this.tableId;
    const sid = this.backend.newKey();
    const order = Math.max(0, ...this.sceneIndex.map((s) => s.order)) + 1;
    const meta: SceneMeta = {
      ...normalizeSceneMeta({}),
      name: opts.name || 'New scene',
      mapUrl: opts.mapUrl ?? null,
      mapW: opts.mapW ?? 0,
      mapH: opts.mapH ?? 0,
      grid: { ...DEFAULT_GRID, ...opts.grid },
      createdAt: Date.now(),
    };
    await this.backend.update({
      [P.sceneMeta(tid, sid)]: stripUndefined(meta as unknown as Record<string, unknown>),
      [`${P.sceneIndex(tid)}/${sid}`]: { name: meta.name, order },
    });
    if (opts.makeActive || !this.activeSceneId) await this.backend.set(P.activeScene(tid), sid);
    this.openScene(sid);
    return sid;
  }

  async updateScene(patch: ScenePatch, opts: { record?: boolean } = {}): Promise<void> {
    const sid = this.viewSceneId;
    if (!sid || !this.isDM) return;
    const base = P.sceneMeta(this.tableId, sid);
    const updates: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'grid' || k === 'fog') {
        for (const [k2, v2] of Object.entries(v as object)) updates[`${base}/${k}/${k2}`] = v2 === undefined ? null : v2;
      } else updates[`${base}/${k}`] = v === undefined ? null : v;
    }
    if (patch.name) updates[`${P.sceneIndex(this.tableId)}/${sid}/name`] = patch.name;
    if (!Object.keys(updates).length) return;

    // remember how things were, for Ctrl+Z (only for plain settings, not for swapping the map picture)
    const meta = this.scene?.meta;
    const undoable = opts.record !== false && !!meta && Object.keys(patch).every((k) => UNDOABLE_SCENE_KEYS.has(k));
    let prev: ScenePatch | null = null;
    if (undoable && meta) {
      prev = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'grid' || k === 'fog') {
          const sub: Record<string, unknown> = {};
          for (const k2 of Object.keys(v as object)) sub[k2] = (meta as any)[k][k2];
          (prev as any)[k] = sub;
        } else (prev as any)[k] = (meta as any)[k];
      }
    }
    await this.backend.update(updates);
    if (prev) {
      const before = prev;
      const keys = Object.keys(updates).map((u) => u.split('/').slice(-2).join('.')).sort().join(',');
      this.history.push({
        label: 'Change scene settings',
        key: `scene:${sid}:${keys}`,
        undo: () => this.updateScene(before, { record: false }),
        redo: () => this.updateScene(patch, { record: false }),
      });
    }
  }

  async setSceneMap(url: string, w: number, h: number) {
    await this.updateScene({ mapUrl: url, mapW: w, mapH: h, mapX: 0, mapY: 0, mapScale: 1, mapLocked: true });
  }

  async deleteScene(sid: string): Promise<void> {
    const tid = this.tableId;
    const rest = this.sceneIndex.filter((s) => s.id !== sid);
    const updates: Record<string, any> = {
      [P.scene(tid, sid)]: null,
      [P.dmScene(tid, sid)]: null,
      [`${P.sceneIndex(tid)}/${sid}`]: null,
    };
    if (this.activeSceneId === sid) updates[P.activeScene(tid)] = rest[0]?.id ?? null;
    await this.backend.update(updates);
    if (this.viewSceneId === sid) this.openScene(rest[0]?.id ?? null);
  }

  async setActiveScene(sid: string): Promise<void> {
    await this.backend.set(P.activeScene(this.tableId), sid);
  }

  // ---------------------------------------------------------------- fog (DM)
  async addFogOp(op: FogOp): Promise<void> {
    const sid = this.viewSceneId;
    if (!sid || !this.isDM) return;
    if (!this.scene?.meta?.fog.enabled) await this.updateScene({ fog: { enabled: true } });
    const key = this.backend.newKey();
    const path = `${P.sceneFog(this.tableId, sid)}/${key}`;
    await this.backend.set(path, op);
    this.history.push({
      label: op.m === 'r' ? 'Reveal fog' : 'Hide with fog',
      undo: () => this.backend.remove(path),
      redo: () => this.backend.set(path, op),
    });
  }
  async undoFog(): Promise<void> {
    const sid = this.viewSceneId;
    const last = this.fogOpsSorted().at(-1);
    if (!sid || !last) return;
    await this.backend.remove(`${P.sceneFog(this.tableId, sid)}/${last[0]}`);
  }
  /** Wipe all fog operations and set the starting state. */
  async resetFog(base: 'hidden' | 'clear'): Promise<void> {
    const sid = this.viewSceneId;
    if (!sid) return;
    const prevOps: Record<string, FogOp> = Object.fromEntries(this.scene?.fogOps ?? []);
    const prevBase = this.scene?.meta?.fog.base ?? 'hidden';
    const prevEnabled = this.scene?.meta?.fog.enabled ?? false;
    const apply = (ops: Record<string, FogOp> | null, b: 'hidden' | 'clear', enabled: boolean) => this.backend.update({
      [P.sceneFog(this.tableId, sid)]: ops && Object.keys(ops).length ? ops : null,
      [`${P.sceneMeta(this.tableId, sid)}/fog/base`]: b,
      [`${P.sceneMeta(this.tableId, sid)}/fog/enabled`]: enabled,
    });
    await apply(null, base, true);
    this.history.push({
      label: base === 'hidden' ? 'Cover the map in fog' : 'Reveal the whole map',
      undo: () => apply(prevOps, prevBase, prevEnabled),
      redo: () => apply(null, base, true),
    });
  }

  // ---------------------------------------------------------------- players, settings
  async joinAsPlayer(name: string, color: string): Promise<void> {
    const path = P.player(this.tableId, this.uid);
    const existing = await this.backend.get(path);
    await this.backend.set(path, { name, color, online: true, joinedAt: existing?.joinedAt ?? SERVER_TS });
    this.backend.onDisconnectSet(`${path}/online`, false);
  }
  /** DM: remove someone from the table list (their tokens become unclaimed). */
  async removePlayer(uid: string): Promise<void> {
    if (!this.isDM || uid === this.uid) return;
    const updates: Record<string, any> = { [P.player(this.tableId, uid)]: null };
    for (const t of this.scene?.tokens.values() ?? []) if (t.ownerUid === uid) updates[`${this.tokenPath(t)}/ownerUid`] = null;
    await this.backend.update(updates);
  }
  async updatePlayer(patch: Partial<Pick<Player, 'name' | 'color'>>): Promise<void> {
    const path = P.player(this.tableId, this.uid);
    const updates: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) updates[`${path}/${k}`] = v;
    await this.backend.update(updates);
  }

  async setPermissions(perm: Permissions, preset?: PermPreset): Promise<void> {
    await this.backend.set(P.settings(this.tableId), { perm, preset: preset ?? detectPreset(perm) });
  }
  async setTableName(name: string): Promise<void> {
    await this.backend.update({
      [`${P.meta(this.tableId)}/name`]: name,
      [P.userTable(this.uid, this.tableId) + '/name']: name,
    });
  }
  async setUploadKey(key: string): Promise<void> {
    const updates: Record<string, any> = { [P.uploadKey(this.tableId)]: key || null };
    if (this.isDM) updates[P.userSetting(this.uid, 'imgbbKey')] = key || null;
    await this.backend.update(updates);
  }

  /** Visible world rect used for camera fitting. */
  sceneRect() {
    const m = this.scene?.meta;
    if (!m) return null;
    if (m.mapW > 0) return mapRect(m);
    return { x: 0, y: 0, w: 2000, h: 1500 };
  }
}
