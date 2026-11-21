import type { Backend, Unsub } from '../backend/types';
import { SERVER_TS } from '../backend/types';
import {
  drawingToWire, initPubToWire, initToWire, normalizeDrawing, normalizeFogOp, normalizeInit, normalizeInitPub, normalizeLive, normalizeMeta,
  normalizePlayer, normalizeSceneMeta, normalizeSettings, normalizeToken, stripUndefined, tokenToWire, DEFAULT_GRID, DM_COLOR,
} from '../core/model';
import {
  applyDamage, cleanHp, EXPLORE_MIN_CELLS, EXPLORE_JUMP_CELLS, EXPLORE_TELEPORT_CELLS, EXPLORE_TELEPORT_MS, emptyInit, moveEntry, nextTurn, orderOf, pctOf, prevTurn, sightRadiusPx, sortByInit, toPub,
} from '../core/combat';
import { lineOp } from '../core/fog';
import { addFx, fxToWire, tickFx } from '../core/effects';
import { can, detectPreset, PRESETS, type Action } from '../core/permissions';
import { mapRect, snapTokenCenter } from '../core/geometry';
import { isHex } from '../core/hex';
import { isTemplate, movedPoints } from '../core/draw';
import { throttle } from '../core/throttle';
import type {
  Drawing, Effect, FogOp, InitEntry, InitPub, InitState, LivePlot, GridSettings, Permissions, PermPreset, Ping, Player, Role, SceneIndexEntry,
  SceneMeta, TableMeta, TableSettings, Token, Vec,
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
  draws: Map<string, Drawing>;
  drawRev: number;
  /** what other people are plotting right now */
  live: Map<string, LivePlot>;
  liveRev: number;
  /** the DM's full initiative order (DM only) */
  init: InitState;
  /** the order as players may see it (null until the DM reveals it) */
  initPub: InitPub | null;
  initRev: number;
  /** hit points, from the DM-only part of the database (DM only) */
  hpDm: Map<string, { hp: number; max: number; tmp: number }>;
  metaRev: number;
}

/** A drawing as the caller describes it; the text styling and the fill colour are optional. */
export type NewDrawing = Omit<Drawing, 'id' | 'uid' | 't' | 'fc' | 'font' | 'b' | 'i' | 'u' | 'ho' | 'hz' | 'of'> & Partial<Pick<Drawing, 'fc' | 'font' | 'b' | 'i' | 'u' | 'ho' | 'hz' | 'of'>>;
export type DrawingPatch = Partial<Pick<Drawing, 'color' | 'w' | 'fill' | 'fc' | 'dash' | 'txt' | 'bw' | 'p' | 'fs' | 'font' | 'b' | 'i' | 'u' | 'ho' | 'hz'>>;

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
/** What is stored for a token's hit points (temporary hit points only when there are some). */
const hpWire = (hp: number, max: number, tmp: number) => ({ hp, max, ...(tmp > 0 ? { tmp } : {}) });

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
    this.clearLive();
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
    this.clearLive();
    this.viewSceneId = sid;
    if (!sid) { this.scene = null; this.bump(); return; }

    const s: SceneState = {
      id: sid, loaded: false, meta: null, tokens: new Map(), tokensRev: 0,
      fogOps: new Map(), fogRev: 0, draws: new Map(), drawRev: 0, live: new Map(), liveRev: 0,
      init: emptyInit(), initPub: null, initRev: 0, hpDm: new Map(), metaRev: 0,
    };
    this.trails.clear();
    this.mirrorSig = null;
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
      this.tokensChanged(); // switching "remember explored ground" on reveals where the tokens stand right away
      this.bump();
    }, sceneFail('scene')));

    const tokenHandlers = (hidden: boolean) => ({
      added: (k: string, v: any) => { if (live()) { s.tokens.set(k, this.withHp(s, normalizeToken(k, v, hidden))); s.tokensRev++; this.tokensChanged(); this.bump(); } },
      changed: (k: string, v: any) => { if (live()) { s.tokens.set(k, this.withHp(s, normalizeToken(k, v, hidden))); s.tokensRev++; this.tokensChanged(); this.bump(); } },
      removed: (k: string) => {
        if (!live()) return;
        const cur = s.tokens.get(k);
        // ignore the "removed" half of a reveal/hide move, which arrives after the new copy was added
        if (cur && cur.hidden === hidden) { s.tokens.delete(k); s.tokensRev++; this.tokensChanged(); this.bump(); }
      },
    });
    this.sceneUnsubs.push(b.listenChildren(P.sceneTokens(tid, sid), tokenHandlers(false), sceneFail('tokens')));
    if (this.role === 'dm') {
      this.sceneUnsubs.push(b.listenChildren(P.dmSceneTokens(tid, sid), tokenHandlers(true), sceneFail('hidden tokens')));
      const hpSet = (k: string, v: any) => {
        if (!live()) return;
        const c = cleanHp(typeof v?.hp === 'number' ? v.hp : null, typeof v?.max === 'number' ? v.max : null);
        if (c.hp == null || c.max == null) s.hpDm.delete(k); else s.hpDm.set(k, { hp: c.hp, max: c.max, tmp: typeof v?.tmp === 'number' && v.tmp > 0 ? Math.round(v.tmp) : 0 });
        const t = s.tokens.get(k);
        if (t) s.tokens.set(k, this.withHp(s, t));
        s.tokensRev++; this.bump();
      };
      this.sceneUnsubs.push(b.listenChildren(P.dmSceneHp(tid, sid), {
        added: hpSet, changed: hpSet,
        removed: (k) => hpSet(k, null),
      }, sceneFail('hit points')));
      this.sceneUnsubs.push(b.listen(P.dmSceneInit(tid, sid), (v) => {
        if (!live()) return;
        s.init = normalizeInit(v);
        s.initRev++; this.bump();
      }, sceneFail('initiative')));
    } else {
      this.sceneUnsubs.push(b.listen(P.sceneInitPub(tid, sid), (v) => {
        if (!live()) return;
        s.initPub = normalizeInitPub(v);
        s.initRev++; this.bump();
      }, sceneFail('initiative')));
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

    const drawSet = (k: string, v: any) => {
      if (!live()) return;
      const d = normalizeDrawing(k, v);
      if (d) s.draws.set(k, d); else s.draws.delete(k);
      s.drawRev++; this.bump();
    };
    this.sceneUnsubs.push(b.listenChildren(P.sceneDraw(tid, sid), {
      added: drawSet, changed: drawSet,
      removed: (k) => { if (live()) { s.draws.delete(k); s.drawRev++; this.bump(); } },
    }, sceneFail('drawings')));

    const liveSet = (k: string, v: any) => {
      if (!live()) return;
      const l = normalizeLive(k, v);
      if (l) s.live.set(k, l); else s.live.delete(k);
      s.liveRev++; this.bump();
    };
    this.sceneUnsubs.push(b.listenChildren(P.sceneLive(tid, sid), {
      added: liveSet, changed: liveSet,
      removed: (k) => { if (live()) { s.live.delete(k); s.liveRev++; this.bump(); } },
    }, sceneFail('live plotting')));

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
  private hpPath(id: string) { return P.dmSceneHpOf(this.tableId, this.viewSceneId!, id); }
  /** Overlay the DM-only hit points on a token read from the public part of the database. */
  private withHp(s: SceneState, t: Token): Token {
    const h = s.hpDm.get(t.id);
    return h ? { ...t, hp: h.hp, maxHp: h.max, tempHp: h.tmp } : { ...t, hp: null, maxHp: null, tempHp: 0 };
  }

  async addToken(partial: Partial<Token> & { x: number; y: number }, opts: { record?: boolean } = {}): Promise<string> {
    const sid = this.viewSceneId;
    if (!sid) throw new Error('No scene is open');
    const id = this.backend.newKey();
    const z = Math.max(0, ...[...(this.scene?.tokens.values() ?? [])].map((t) => t.z)) + 1;
    const hidden = this.isDM && !!partial.hidden;
    const token = normalizeToken(id, { ...partial, z }, hidden);
    if (!this.isDM) { token.ownerUid = this.uid; token.hp = token.maxHp = null; token.tempHp = 0; } // players may only create tokens they own, and never set hit points
    token.hpPct = token.hp != null && token.hpShow !== 'off' ? pctOf(token.hp, token.maxHp) : null;
    const updates: Record<string, any> = { [this.tokenPath(token)]: tokenToWire(token) };
    if (token.hp != null && token.maxHp != null) updates[this.hpPath(id)] = hpWire(token.hp, token.maxHp, token.tempHp);
    await this.backend.update(updates);
    if (opts.record !== false) this.recordCreated([token], 'Add token');
    return id;
  }

  /** Write tokens back exactly as they were (used by undo and by paste). */
  async restoreTokens(tokens: Token[]): Promise<void> {
    const updates: Record<string, any> = {};
    for (const t of tokens) {
      updates[this.tokenPath(t)] = tokenToWire(t);
      if (this.isDM && t.hp != null && t.maxHp != null) updates[this.hpPath(t.id)] = hpWire(t.hp, t.maxHp, t.tempHp);
    }
    if (Object.keys(updates).length) await this.backend.update(updates);
  }
  private async deleteTokensRaw(tokens: Pick<Token, 'id' | 'hidden'>[]): Promise<void> {
    const updates: Record<string, any> = {};
    for (const t of tokens) {
      updates[this.tokenPath(t)] = null;
      if (this.isDM) updates[this.hpPath(t.id)] = null;
    }
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
      if (k === 'id' || k === 'hidden' || k === 'hp' || k === 'maxHp' || k === 'tempHp' || k === 'hpPct') continue;
      updates[`${base}/${k}`] = k === 'fx' ? fxToWire((v as Effect[] | undefined) ?? []) : k === 'initBonus' ? (v ? v : null) : v === undefined ? null : v;
    }
    // hit points live in the DM-only part of the database; players only ever see a percentage
    if (this.isDM && ('hp' in patch || 'maxHp' in patch || 'tempHp' in patch || 'hpShow' in patch)) {
      const c = cleanHp('hp' in patch ? patch.hp : cur.hp, 'maxHp' in patch ? patch.maxHp : cur.maxHp);
      const tmp = Math.max(0, Math.round('tempHp' in patch ? patch.tempHp ?? 0 : cur.tempHp));
      if ('hp' in patch || 'maxHp' in patch || 'tempHp' in patch) updates[this.hpPath(cur.id)] = c.hp == null || c.max == null ? null : hpWire(c.hp, c.max, tmp);
      const show = patch.hpShow ?? cur.hpShow;
      const pct = show === 'off' ? null : pctOf(c.hp, c.max);
      updates[`${base}/hpPct`] = pct;
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
  async moveTokens(moves: { id: string; x: number; y: number }[], before?: { id: string; x: number; y: number }[], opts: { teleport?: boolean } = {}): Promise<void> {
    const updates: Record<string, any> = {};
    if (opts.teleport) for (const m of moves) this.noTrail.add(m.id); // this move is a jump: it does not clear the ground it passes over
    for (const m of moves) {
      const t = this.scene?.tokens.get(m.id);
      if (!t) continue;
      const base = this.tokenPath(t);
      updates[`${base}/x`] = Math.round(m.x * 10) / 10;
      updates[`${base}/y`] = Math.round(m.y * 10) / 10;
    }
    try { if (Object.keys(updates).length) await this.backend.update(updates); } finally { if (opts.teleport) for (const m of moves) this.noTrail.delete(m.id); }
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
      let x = t.x + offsetPx;
      let y = t.y + offsetPx;
      // a diagonal step of one square lands between hexes, so put it on the nearest one
      if (this.grid.snap && isHex(this.grid)) ({ x, y } = snapTokenCenter(this.grid, t.size, { x, y }));
      const nid = await this.addToken({ ...rest, name, x, y, ownerUid: this.isDM ? null : this.uid }, { record: false });
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

  // ---------------------------------------------------------------- drawings
  canEditDrawing(d: Drawing): boolean { return this.isDM || (this.canDo('draw') && d.uid === this.uid); }

  /** Drawings in the order they were made (keys sort by time). */
  drawingsSorted(): Drawing[] {
    return [...(this.scene?.draws.values() ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private drawPath(id: string) { return P.sceneDrawing(this.tableId, this.viewSceneId!, id); }

  async addDrawing(d: NewDrawing, opts: { record?: boolean; onId?: (id: string) => void } = {}): Promise<string> {
    if (!this.viewSceneId) throw new Error('No scene is open');
    if (!this.canDo('draw')) throw new Error('You are not allowed to draw here.');
    const id = this.backend.newKey();
    const full: Drawing = { fc: '', font: '', b: false, i: false, u: false, ho: false, hz: null, ...d, id, uid: this.uid, t: this.backend.now() };
    const wrote = this.backend.set(this.drawPath(id), drawingToWire(full));
    opts.onId?.(id);
    await wrote;
    if (opts.record !== false) this.recordDrawn([full], isTemplate(d.k) ? 'Place template' : 'Draw');
    return id;
  }

  private async restoreDrawings(list: Drawing[]) {
    const updates: Record<string, any> = {};
    for (const d of list) updates[this.drawPath(d.id)] = drawingToWire(d);
    if (Object.keys(updates).length) await this.backend.update(updates);
  }
  private async deleteDrawingsRaw(ids: string[]) {
    const updates: Record<string, any> = {};
    for (const id of ids) updates[this.drawPath(id)] = null;
    if (Object.keys(updates).length) await this.backend.update(updates);
  }
  private recordDrawn(list: Drawing[], label: string) {
    const snaps = list.map((d) => ({ ...d }));
    this.history.push({ label, undo: () => this.deleteDrawingsRaw(snaps.map((d) => d.id)), redo: () => this.restoreDrawings(snaps) });
  }

  async removeDrawings(ids: string[], label = 'Erase drawing'): Promise<void> {
    const snaps = ids.map((id) => this.scene?.draws.get(id)).filter((d): d is Drawing => !!d && this.canEditDrawing(d)).map((d) => ({ ...d }));
    if (!snaps.length) return;
    await this.deleteDrawingsRaw(snaps.map((d) => d.id));
    this.history.push({ label: snaps.length > 1 ? `${label}s` : label, undo: () => this.restoreDrawings(snaps), redo: () => this.deleteDrawingsRaw(snaps.map((d) => d.id)) });
  }

  /** Remove every drawing that matches (for "clear mine", "clear templates"…). Undoable. */
  async clearDrawings(match: (d: Drawing) => boolean, label = 'Clear drawings'): Promise<number> {
    const ids = this.drawingsSorted().filter((d) => this.canEditDrawing(d) && match(d)).map((d) => d.id);
    if (!ids.length) return 0;
    await this.removeDrawings(ids, label.replace(/s$/, ''));
    return ids.length;
  }

  /** Slide drawings by (dx, dy). `record` makes it one undo step. */
  async moveDrawings(ids: string[], dx: number, dy: number, record = true): Promise<void> {
    const before = ids.map((id) => this.scene?.draws.get(id)).filter((d): d is Drawing => !!d && this.canEditDrawing(d)).map((d) => ({ id: d.id, p: d.p }));
    if (!before.length) return;
    const after = before.map((b) => ({ id: b.id, p: movedPoints(b, dx, dy) }));
    const write = (list: { id: string; p: string }[]) => {
      const updates: Record<string, any> = {};
      for (const d of list) updates[`${this.drawPath(d.id)}/p`] = d.p;
      return this.backend.update(updates);
    };
    await write(after);
    if (record) this.history.push({ label: before.length > 1 ? 'Move drawings' : 'Move drawing', undo: () => write(before), redo: () => write(after) });
  }

  async updateDrawings(ids: string[], patch: DrawingPatch): Promise<void> {
    const cur = ids.map((id) => this.scene?.draws.get(id)).filter((d): d is Drawing => !!d && this.canEditDrawing(d));
    if (!cur.length) return;
    const prev = cur.map((d) => ({ id: d.id, vals: Object.fromEntries(Object.keys(patch).map((k) => [k, (d as any)[k]])) }));
    const write = (list: { id: string; vals: Record<string, unknown> }[]) => {
      const updates: Record<string, any> = {};
      for (const d of list) for (const [k, v] of Object.entries(d.vals)) updates[`${this.drawPath(d.id)}/${k}`] = k === 'hz' ? v ?? null : v === '' || v === false || v === 0 ? null : v;
      return this.backend.update(updates);
    };
    const next = cur.map((d) => ({ id: d.id, vals: patch as Record<string, unknown> }));
    await write(next);
    this.history.push({ label: 'Edit drawing', key: `draw:${ids.join('+')}:${Object.keys(patch).sort().join(',')}`, undo: () => write(prev), redo: () => write(next) });
  }

  // ---------------------------------------------------------------- live plotting (ruler, test moves)
  private liveMine: { ruler: { a: Vec; b: Vec; c?: string } | null; ghosts: Record<string, Vec> } = { ruler: null, ghosts: {} };
  private liveSid: string | null = null;
  private liveArmed = false;
  private pushLive = throttle(() => { void this.writeLive(); }, 90);

  /** Share (or stop sharing) what you are plotting. Pass only the parts that changed. */
  setLive(patch: { ruler?: { a: Vec; b: Vec; c?: string } | null; ghosts?: Record<string, Vec> }) {
    if (!this.viewSceneId) return;
    if (patch.ruler !== undefined) this.liveMine.ruler = patch.ruler;
    if (patch.ghosts !== undefined) this.liveMine.ghosts = patch.ghosts;
    this.liveSid = this.viewSceneId;
    this.pushLive();
  }

  private async writeLive() {
    const sid = this.liveSid;
    if (!sid) return;
    const path = P.sceneLiveOf(this.tableId, sid, this.uid);
    const { ruler, ghosts } = this.liveMine;
    const gh = Object.fromEntries(Object.entries(ghosts).map(([id, v]) => [id, { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10 }]));
    try {
      if (!ruler && !Object.keys(gh).length) { await this.backend.remove(path); return; }
      if (!this.liveArmed) { this.backend.onDisconnectSet(path, null); this.liveArmed = true; }
      await this.backend.set(path, stripUndefined({
        ruler: ruler ? { ax: Math.round(ruler.a.x), ay: Math.round(ruler.a.y), bx: Math.round(ruler.b.x), by: Math.round(ruler.b.y), c: ruler.c } : undefined,
        ghosts: Object.keys(gh).length ? gh : undefined,
      }));
    } catch (e) { console.warn('live plotting', (e as Error).message); }
  }

  /** Forget what we shared (leaving a scene). */
  private clearLive() {
    this.pushLive.cancel();
    if (this.exploreTimer) { clearTimeout(this.exploreTimer); this.exploreTimer = null; }
    if (this.mirrorTimer) { clearTimeout(this.mirrorTimer); this.mirrorTimer = null; }
    const sid = this.liveSid;
    this.liveMine = { ruler: null, ghosts: {} };
    this.liveSid = null;
    this.liveArmed = false;
    if (sid && this.started) void this.backend.remove(P.sceneLiveOf(this.tableId, sid, this.uid)).catch(() => undefined);
  }

  // ---------------------------------------------------------------- hit points (DM)
  /**
   * Take hit points off (or, with a negative number, give them back). One undo step.
   * Temporary hit points soak up damage first. Healing never touches them and never goes past the maximum.
   */
  async damage(ids: string[], amount: number): Promise<void> {
    if (!this.isDM || !Number.isFinite(amount) || amount === 0) return;
    const before: { id: string; hp: number; tempHp: number }[] = [];
    const after: { id: string; hp: number; tempHp: number }[] = [];
    for (const id of ids) {
      const t = this.scene?.tokens.get(id);
      if (!t || t.hp == null || t.maxHp == null) continue;
      before.push({ id, hp: t.hp, tempHp: t.tempHp });
      after.push({ id, ...applyDamage(t.hp, t.maxHp, t.tempHp, Math.round(amount)) });
    }
    if (!after.length) return;
    const apply = (list: { id: string; hp: number; tempHp: number }[]) => Promise.all(list.map((x) => this.updateToken(x.id, { hp: x.hp, tempHp: x.tempHp }))).then(() => undefined);
    await apply(after);
    this.history.push({
      label: amount > 0 ? 'Damage' : 'Healing', // no coalescing key: every hit is its own undo step
      undo: () => apply(before),
      redo: () => apply(after),
    });
  }

  /** Give temporary hit points. The rules say you keep whichever is higher, the old or the new; pass `replace` to set it outright. */
  async giveTemp(ids: string[], amount: number, replace = false): Promise<{ id: string; name: string; had: number; now: number }[]> {
    if (!this.isDM || !Number.isFinite(amount)) return [];
    const n = Math.max(0, Math.round(amount));
    const before: { id: string; tempHp: number }[] = [];
    const after: { id: string; tempHp: number }[] = [];
    const out: { id: string; name: string; had: number; now: number }[] = [];
    for (const id of ids) {
      const t = this.scene?.tokens.get(id);
      if (!t || t.hp == null || t.maxHp == null) continue;
      before.push({ id, tempHp: t.tempHp });
      const now = replace ? n : Math.max(t.tempHp, n);
      after.push({ id, tempHp: now });
      out.push({ id, name: t.name || 'Token', had: t.tempHp, now });
    }
    if (!after.length) return [];
    const apply = (list: { id: string; tempHp: number }[]) => Promise.all(list.map((x) => this.updateToken(x.id, { tempHp: x.tempHp }))).then(() => undefined);
    await apply(after);
    this.history.push({ label: 'Temporary hit points', undo: () => apply(before), redo: () => apply(after) });
    return out;
  }

  // ---------------------------------------------------------------- initiative (DM)
  private mirrorSig: string | null = null;
  private mirrorTimer: ReturnType<typeof setTimeout> | null = null;

  /** Write the DM's order, and what players may see of it, in one go. */
  private async saveInit(next: InitState): Promise<void> {
    const sid = this.viewSceneId;
    if (!sid || !this.isDM) return;
    // keep the stored names in step with the tokens they stand for
    const tokens = this.scene?.tokens ?? new Map<string, Token>();
    const entries = next.entries.map((e) => ({ ...e, n: (e.tk && tokens.get(e.tk)?.name) || e.n }));
    const state: InitState = { ...next, entries };
    const pub = initPubToWire(toPub(state, tokens));
    this.mirrorSig = JSON.stringify(pub);
    await this.backend.update({
      [P.dmSceneInit(this.tableId, sid)]: initToWire(state),
      [P.sceneInitPub(this.tableId, sid)]: pub,
    });
  }

  /** Token renamed, hidden or revealed: players' copy of the order may need to follow. */
  private syncInitMirror() {
    const s = this.scene;
    if (!this.isDM || !s || !this.viewSceneId || !s.init.shown) return;
    if (this.mirrorTimer) clearTimeout(this.mirrorTimer);
    this.mirrorTimer = setTimeout(() => {
      this.mirrorTimer = null;
      const sc = this.scene;
      if (!sc || !this.viewSceneId || !sc.init.shown) return;
      const pub = initPubToWire(toPub(sc.init, sc.tokens));
      const sig = JSON.stringify(pub);
      if (sig === this.mirrorSig) return;
      this.mirrorSig = sig;
      void this.backend.set(P.sceneInitPub(this.tableId, this.viewSceneId), pub).catch(() => undefined);
    }, 120);
  }

  /** Set (or change) initiative numbers for several tokens at once, then sort. Blank rows are left alone. */
  async initApply(rows: { tk: string | null; n: string; i: number; h?: boolean }[]): Promise<void> {
    const s = this.scene;
    if (!s || !this.isDM) return;
    let entries = [...s.init.entries];
    let seq = entries.length;
    for (const r of rows) {
      if (!Number.isFinite(r.i)) continue;
      const cur = r.tk ? entries.find((e) => e.tk === r.tk) : undefined;
      if (cur) entries = entries.map((e) => (e === cur ? { ...e, i: r.i, n: r.n || e.n } : e));
      else entries.push({ id: this.backend.newKey(), tk: r.tk, n: r.n, i: r.i, h: !!r.h, o: (++seq + 1000) * 1000 });
    }
    entries = sortByInit(entries);
    const turn = s.init.turn && entries.some((e) => e.id === s.init.turn) ? s.init.turn : entries[0]?.id ?? null;
    await this.saveInit({ ...s.init, entries, turn, round: entries.length ? Math.max(1, s.init.round) : 0 });
  }

  async initAddFree(name: string, i: number, hidden = false): Promise<void> {
    await this.initApply([{ tk: null, n: name.trim() || 'Something', i, h: hidden }]);
  }

  /** Change one line: its number (re-sorts), name, or whether players may see it. */
  async initEdit(id: string, patch: Partial<Pick<InitEntry, 'i' | 'h' | 'n'>>): Promise<void> {
    const s = this.scene;
    if (!s || !this.isDM) return;
    let entries = s.init.entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
    if (patch.i !== undefined && Number.isFinite(patch.i)) entries = sortByInit(entries);
    await this.saveInit({ ...s.init, entries });
  }

  async initRemove(id: string): Promise<void> {
    const s = this.scene;
    if (!s || !this.isDM) return;
    const order = orderOf(s.init.entries);
    const idx = order.findIndex((e) => e.id === id);
    const entries = order.filter((e) => e.id !== id);
    let turn = s.init.turn;
    if (turn === id) turn = entries.length ? entries[Math.min(idx, entries.length - 1)].id : null;
    await this.saveInit({ ...s.init, entries, turn, round: entries.length ? s.init.round : 0 });
  }

  /** Drag and drop: put `id` just before `beforeId` (null = last). */
  async initMove(id: string, beforeId: string | null): Promise<void> {
    const s = this.scene;
    if (!s || !this.isDM) return;
    await this.saveInit({ ...s.init, entries: moveEntry(s.init.entries, id, beforeId) });
  }

  async initSort(): Promise<void> {
    const s = this.scene;
    if (!s || !this.isDM) return;
    await this.saveInit({ ...s.init, entries: sortByInit(s.init.entries) });
  }

  /** What the last "next turn" changed, so "previous turn" can put the effects back as they were. */
  private stepSnap: { sid: string; before: { turn: string | null; round: number }; after: { turn: string | null; round: number }; fx: { id: string; before: Effect[] }[] } | null = null;
  /** Called with a sentence for each effect that ran out as the turns moved on (the DM's screen shows them). */
  onFxEnded: ((lines: string[]) => void) | null = null;

  /**
   * Work out which effects count down when the turn moves from the current entry to `to`:
   * the end of the turn that finishes, the start of a new round for everyone, then the start of the turn that begins.
   * Tokens that are not in the order at all count down once per round, whatever their timers say.
   */
  private stepEffects(s: SceneState, to: { turn: string | null; round: number }): { changes: { id: string; before: Effect[]; after: Effect[] }[]; ended: string[] } {
    const tokens = s.tokens;
    const inOrder = new Set(s.init.entries.filter((e) => e.tk).map((e) => e.tk!));
    const work = new Map<string, Effect[]>();
    const ended: string[] = [];
    const tick = (id: string, moment: 'start' | 'end' | 'round', all = false) => {
      const t = tokens.get(id);
      if (!t) return;
      const r = tickFx(work.get(id) ?? t.fx, moment, all);
      if (!r.changed) return;
      work.set(id, r.fx);
      for (const e of r.ended) ended.push(`${e.n} ended on ${t.name || 'a token'}`);
    };
    const leaving = s.init.entries.find((e) => e.id === s.init.turn);
    if (leaving?.tk) tick(leaving.tk, 'end');
    if (to.round > Math.max(1, s.init.round)) for (const t of tokens.values()) tick(t.id, 'round', !inOrder.has(t.id));
    const arriving = s.init.entries.find((e) => e.id === to.turn);
    if (arriving?.tk) tick(arriving.tk, 'start');
    return { changes: [...work].map(([id, after]) => ({ id, before: tokens.get(id)!.fx, after })), ended };
  }

  async initStep(dir: 1 | -1): Promise<void> {
    const s = this.scene;
    const sid = this.viewSceneId;
    if (!s || !sid || !this.isDM || !s.init.entries.length) return;
    if (dir === -1) {
      const snap = this.stepSnap;
      this.stepSnap = null;
      if (snap && snap.sid === sid && snap.after.turn === s.init.turn && snap.after.round === s.init.round) {
        // straight after a step forward: undo it completely, effect timers included
        await this.saveInit({ ...s.init, turn: snap.before.turn, round: snap.before.round });
        await Promise.all(snap.fx.map((f) => this.updateToken(f.id, { fx: f.before })));
        return;
      }
      const r = prevTurn(s.init);
      await this.saveInit({ ...s.init, turn: r.turn, round: r.round });
      return;
    }
    const r = nextTurn(s.init);
    const fx = this.stepEffects(s, r);
    this.stepSnap = { sid, before: { turn: s.init.turn, round: s.init.round }, after: r, fx: fx.changes.map((c) => ({ id: c.id, before: c.before })) };
    await this.saveInit({ ...s.init, turn: r.turn, round: r.round });
    await Promise.all(fx.changes.map((c) => this.updateToken(c.id, { fx: c.after })));
    if (fx.ended.length) this.onFxEnded?.(fx.ended);
  }

  /** Let players see the order (hidden lines stay hidden), or hide it from them again. */
  async initShow(shown: boolean): Promise<void> {
    const s = this.scene;
    if (!s || !this.isDM) return;
    await this.saveInit({ ...s.init, shown });
  }

  /** Clear the whole order (end of combat). Undo brings it back. */
  async initEnd(): Promise<void> {
    const s = this.scene;
    const sid = this.viewSceneId;
    if (!this.isDM || !s || !sid) return;
    const prev = s.init;
    if (!prev.entries.length && !prev.round) return;
    this.stepSnap = null;
    await this.saveInit(emptyInit());
    this.history.push({
      label: 'End combat',
      undo: async () => { if (this.viewSceneId === sid) await this.saveInit(prev); },
      redo: async () => { if (this.viewSceneId === sid) await this.saveInit(emptyInit()); },
    });
  }

  // ---------------------------------------------------------------- effects on tokens
  /** Change the effects of several tokens at once. `change` gets each token's current list and returns the new one. */
  async changeFx(ids: string[], change: (cur: Effect[], t: Token) => Effect[], label = 'Change effects', key?: string): Promise<void> {
    const before: { id: string; fx: Effect[] }[] = [];
    const after: { id: string; fx: Effect[] }[] = [];
    for (const id of ids) {
      const t = this.scene?.tokens.get(id);
      if (!t || !this.canDo('edit', t)) continue;
      const next = change(t.fx, t);
      if (JSON.stringify(fxToWire(next)) === JSON.stringify(fxToWire(t.fx))) continue;
      before.push({ id, fx: t.fx });
      after.push({ id, fx: next });
    }
    if (!after.length) return;
    const apply = (list: { id: string; fx: Effect[] }[]) => Promise.all(list.map((x) => this.updateToken(x.id, { fx: x.fx }))).then(() => undefined);
    await apply(after);
    this.history.push({ label, key, undo: () => apply(before), redo: () => apply(after) });
  }

  async addEffect(ids: string[], e: Effect): Promise<void> {
    await this.changeFx(ids, (cur) => addFx(cur, e), `Add ${e.n}`);
  }

  async removeEffect(ids: string[], fxId: string): Promise<void> {
    await this.changeFx(ids, (cur) => cur.filter((x) => x.id !== fxId), 'Remove effect');
  }

  /** Give a timed effect more (or fewer) rounds. Taking the last one away ends it. */
  async nudgeEffect(id: string, fxId: string, delta: number): Promise<void> {
    await this.changeFx([id], (cur) => cur.flatMap((x) => {
      if (x.id !== fxId || x.left == null) return [x];
      const left = x.left + delta;
      return left <= 0 ? [] : [{ ...x, left }];
    }), 'Change effect', `fxn:${id}:${fxId}`);
  }

  // ---------------------------------------------------------------- explored ground (DM)
  /**
   * What each token has walked since the trail was last written: the real route it took, seen through the stream of position changes.
   * A jump with no walking in between (undo, a typed position, a token teleported on purpose) starts a new trail instead of joining the dots.
   */
  private trails = new Map<string, { anchor: Vec | null; pend: Vec[]; segs: Vec[][]; at: number; tele: boolean }>();
  /** tokens being teleported right now (their next position change starts a new trail) */
  private noTrail = new Set<string>();
  private exploreTimer: ReturnType<typeof setTimeout> | null = null;

  /** Called whenever tokens change. Does the DM-only chores that follow from them. */
  private tokensChanged() {
    if (!this.isDM) return;
    this.syncInitMirror();
    const m = this.scene?.meta;
    if (!m?.fog.enabled || !m.fog.vision || !m.fog.explore) return;
    this.observeTrails();
    if (this.exploreTimer) clearTimeout(this.exploreTimer);
    this.exploreTimer = setTimeout(() => { this.exploreTimer = null; void this.exploreNow(); }, 400);
  }

  /** Add each sighted token's current position to its trail. */
  private observeTrails() {
    const s = this.scene;
    const m = s?.meta;
    if (!s || !m) return;
    const g = m.grid;
    const now = Date.now();
    for (const t of s.tokens.values()) {
      if (sightRadiusPx(t, g) <= 0 || t.hidden) continue;
      const here = { x: t.x, y: t.y };
      let tr = this.trails.get(t.id);
      if (!tr) { this.trails.set(t.id, { anchor: null, pend: [here], segs: [], at: now, tele: true }); continue; }
      const last = tr.pend.length ? tr.pend[tr.pend.length - 1] : tr.anchor;
      const dist = last ? Math.hypot(here.x - last.x, here.y - last.y) : Infinity;
      if (last && dist < EXPLORE_MIN_CELLS * g.cell) continue;
      const idle = now - tr.at;
      tr.at = now;
      const jumped = this.noTrail.has(t.id) || !last || dist > EXPLORE_JUMP_CELLS * g.cell || (idle > EXPLORE_TELEPORT_MS && dist > EXPLORE_TELEPORT_CELLS * g.cell);
      if (jumped) {
        // a jump starts over. The spot it left only counts if it was reached by walking (a landing spot that was just passed through is dropped)
        if (tr.pend.length && !tr.tele) tr.segs.push(tr.pend);
        tr.pend = [here];
        tr.anchor = null;
        tr.tele = true;
      } else {
        tr.tele = false;
        if (!tr.pend.length && tr.anchor) tr.pend = [tr.anchor, here];
        else tr.pend.push(here);
      }
    }
  }

  /** Reveal the ground the tokens with sight have walked: a thick line along each route (a circle where a token only stands). */
  async exploreNow(): Promise<number> {
    const s = this.scene;
    const m = s?.meta;
    if (!this.isDM || !s || !m || !m.fog.enabled || !m.fog.vision || !m.fog.explore) return 0;
    this.observeTrails();
    const g = m.grid;
    const sid = s.id;
    const updates: Record<string, FogOp> = {};
    let count = 0;
    for (const t of s.tokens.values()) {
      const r = sightRadiusPx(t, g);
      const tr = this.trails.get(t.id);
      if (!tr || r <= 0 || t.hidden) continue;
      const lines = [...tr.segs, ...(tr.pend.length ? [tr.pend] : [])];
      for (const line of lines) {
        // keep the shape of the route but not every little step of it
        const pts = line.filter((p, i) => i === 0 || i === line.length - 1 || Math.hypot(p.x - line[i - 1].x, p.y - line[i - 1].y) >= g.cell * 0.2);
        updates[`${P.sceneFog(this.tableId, sid)}/${this.backend.newKey()}`] = lineOp('r', pts, r * 2);
        count++;
      }
      if (lines.length) { const lastLine = lines[lines.length - 1]; tr.anchor = lastLine[lastLine.length - 1]; }
      tr.segs = [];
      tr.pend = [];
    }
    if (count && this.scene === s) await this.backend.update(updates);
    return count;
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
