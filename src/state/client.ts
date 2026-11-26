import type { Backend, Unsub } from '../backend/types';
import { SERVER_TS } from '../backend/types';
import {
  drawingToWire, handoutToWire, initPubToWire, initToWire, normalizeDrawing, normalizeFogOp, normalizeHandout, normalizeInit, normalizeInitPub, normalizeLive, normalizeMeta, tokenCoordinate,
  normalizeLibraryItem, normalizePlayer, normalizeSceneMeta, normalizeSettings, normalizeToken, stripUndefined, tokenToWire, viaToWire, MAX_ROUTE_CORNERS, DEFAULT_GRID, DEFAULT_BG, DM_COLOR, MAX_EXTRA_MAPS, mapsToWire,
} from '../core/model';
import { gridAtPoint, mapCell, ownGrids, type MapGrid } from '../core/mapgrids';
import { BLANK_BG, BLANK_COLS, BLANK_MAP, BLANK_ROWS, blankSpot, clampSquares, isBlankMap, isBlankPage } from '../core/blankgrid';
import {
  applyDamage, cleanHp, withoutLights, EXPLORE_MIN_CELLS, EXPLORE_JUMP_CELLS, EXPLORE_TELEPORT_CELLS, EXPLORE_TELEPORT_MS, emptyInit, moveEntry, nextTurn, orderOf, pctOf, prevTurn, publicHp, sightRadiusPx, sortByInit, toPub,
} from '../core/combat';
import { lineOp, polyOp } from '../core/fog';
import { addFx, fxToWire, tickFx } from '../core/effects';
import { can, detectPreset, PRESETS, type Action } from '../core/permissions';
import { sceneRect, snapTokenCenter } from '../core/geometry';
import { isHex } from '../core/hex';
import { cleanFolderName, folderOf, normalizeFolder, uniqueFolderName } from '../core/folders';
import { sameSaved, savedFields, tokenFromSaved, type SavedToken } from '../core/tokenlib';
import { isTemplate, movedPoints } from '../core/draw';
import { throttle } from '../core/throttle';
import type {
  Drawing, Effect, ExtraMap, FogMode, FogOp, InitEntry, InitPub, InitState, LivePlot, GridSettings, Permissions, PermPreset, Ping, Player, Role, SceneFolder, SceneIndexEntry,
  Handout, Rect, SceneMeta, TableMeta, TableSettings, Token, Vec, ViewCall,
} from '../types';
import { newAreaId } from '../core/terrain';
import { patchStroke, type HeightPatch } from '../core/terrainEdges';
import { altitudeOf, groundAt, zonesOf } from '../core/height';
import { isLightMark, litSeen, lightOf, viewerOf, type LightSrc } from '../core/light';
import { carveWalls, joinAt, normalizeWall, routeReveal, sightSegs, splitPieces, wallMid, wallToWire, type Wall } from '../core/walls';
import { buildCampaign, newLibraryItems, planImport, type CampaignFile, type CampaignLibraryItem } from '../core/campaign';
import { addLibraryItem, removeTokenFromLib, saveTokenToLib, watchTokenLib } from './account';
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
  /** walls, doors and windows (the DM draws them; everyone reads them) */
  walls: Map<string, Wall>;
  wallRev: number;
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
export type NewDrawing = Omit<Drawing, 'id' | 'uid' | 't' | 'fc' | 'font' | 'b' | 'i' | 'u' | 'ho' | 'hz' | 'of' | 'hg' | 'ha' | 'he' | 'hc' | 'dt' | 'dl' | 'dd'> & Partial<Pick<Drawing, 'fc' | 'font' | 'b' | 'i' | 'u' | 'ho' | 'hz' | 'of' | 'hg' | 'ha' | 'he' | 'hc' | 'dt' | 'dl' | 'dd'>>;
export type DrawingPatch = Partial<Pick<Drawing, 'color' | 'w' | 'fill' | 'fc' | 'dash' | 'txt' | 'bw' | 'p' | 'fs' | 'font' | 'b' | 'i' | 'u' | 'ho' | 'hz' | 'hg' | 'ha' | 'he' | 'hc' | 'td'>>;

export type ScenePatch = Partial<Omit<SceneMeta, 'grid' | 'fog' | 'light'>> & {
  grid?: Partial<GridSettings>;
  fog?: Partial<SceneMeta['fog']>;
  light?: Partial<SceneMeta['light']>;
};

let tokenClipboard: Token[] = [];
const UNDOABLE_SCENE_KEYS = new Set(['mapX', 'mapY', 'mapScale', 'mapLocked', 'mapGrid', 'maps', 'wallStop', 'cliff', 'bg', 'grid', 'fog', 'light']);

/**
 * Everything the app knows about one table, kept in sync with the backend.
 * Reads come from listeners (which fire immediately for local writes, so the UI is optimistic);
 * writes are plain database updates.
 */
/** What is stored for a token's hit points (temporary hit points only when there are some). */
const hpWire = (hp: number, max: number, tmp: number) => ({ hp, max, ...(tmp > 0 ? { tmp } : {}) });

const NO_MAP_GRIDS: MapGrid[] = [];

export class TableClient {
  meta: TableMeta | null = null;
  metaLoaded = false;
  settings: TableSettings = { perm: { ...PRESETS.trusting }, preset: 'trusting' };
  players = new Map<string, Player>();
  sceneIndex: SceneIndexEntry[] = [];
  /** folders the DM has made to group scenes */
  sceneFolders: SceneFolder[] = [];
  /** the tokens this account has saved: a DM's templates, a player's characters */
  tokenLib: SavedToken[] = [];
  /** DM: when the table is moved to another scene, the players' tokens come along (with their conditions and hit points) */
  carryParty = (() => { try { return localStorage.getItem('vtt-carry-party') !== '0'; } catch { return true; } })();
  /** DM: the hit points each saved character was last seen with, so it arrives in a new scene as it left the last one */
  private charMem = new Map<string, { hp: number; max: number; tmp: number }>();
  private charAdopted = new Set<string>();
  private charTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
  uploadKey: string | null = null;
  viewSceneId: string | null = null;
  scene: SceneState | null = null;
  rev = 0;
  lastError: string | null = null;
  readonly history = new History(() => this.bump());

  private listeners = new Set<() => void>();
  private pingListeners = new Set<(p: Ping) => void>();
  private viewListeners = new Set<(v: ViewCall) => void>();
  /** what the DM has (all of it) or what the DM is showing this player */
  handouts = new Map<string, Handout>();
  private handoutListeners = new Set<(h: Handout) => void>();
  private handoutSeen = new Map<string, number>();
  private handoutReady = false;
  private handoutTimer: ReturnType<typeof setTimeout> | undefined;
  private viewCallN = 0;
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
  /** Told when the DM shows a player a handout while they are here. */
  onHandout(fn: (h: Handout) => void): Unsub {
    this.handoutListeners.add(fn);
    return () => this.handoutListeners.delete(fn);
  }
  /** What this person can look at: the handouts being shown to them, newest first (the DM sees all of their own, in the order made). */
  handoutList(): Handout[] {
    const all = [...this.handouts.values()];
    if (this.isDM) return all.sort((a, b) => a.createdAt - b.createdAt);
    return all.filter((h) => h.shown && (!h.to || h.to.includes(this.uid))).sort((a, b) => b.n - a.n);
  }
  /** (DM) make or change a handout. Changing one that is being shown changes it for the players too, without opening it again. */
  async saveHandout(input: { id?: string; title: string; text: string; img: string | null }): Promise<string> {
    if (!this.isDM) return '';
    const cur = input.id ? this.handouts.get(input.id) : undefined;
    const id = input.id ?? this.backend.newKey();
    const h: Handout = { id, title: input.title.trim() || 'Handout', text: input.text, img: input.img, to: cur?.to ?? null, shown: cur?.shown ?? false, n: cur?.n ?? 0, createdAt: cur?.createdAt ?? Date.now() };
    const updates: Record<string, unknown> = { [P.dmHandout(this.tableId, id)]: handoutToWire(h) };
    if (h.shown) updates[P.handout(this.tableId, id)] = handoutToWire(h);
    await this.backend.update(updates);
    return id;
  }
  /** (DM) put a handout in front of everyone (`to` null) or only some players. Opens on their screens. */
  async showHandout(id: string, to: string[] | null): Promise<void> {
    const cur = this.handouts.get(id);
    if (!this.isDM || !cur) return;
    const h: Handout = { ...cur, shown: true, to: to && to.length ? to : null, n: Date.now() };
    await this.backend.update({ [P.dmHandout(this.tableId, id)]: handoutToWire(h), [P.handout(this.tableId, id)]: handoutToWire(h) });
  }
  /** (DM) take a handout away from the players. The DM keeps it. */
  async hideHandout(id: string): Promise<void> {
    const cur = this.handouts.get(id);
    if (!this.isDM || !cur) return;
    await this.backend.update({ [P.dmHandout(this.tableId, id)]: handoutToWire({ ...cur, shown: false }), [P.handout(this.tableId, id)]: null });
  }
  async removeHandout(id: string): Promise<void> {
    if (!this.isDM) return;
    await this.backend.update({ [P.dmHandout(this.tableId, id)]: null, [P.handout(this.tableId, id)]: null });
  }
  /** Told when the DM asks everyone to look at one part of the map. */
  onView(fn: (v: ViewCall) => void): Unsub {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  }
  /** (DM) bring every player's view to this part of the map. */
  async callView(rect: Rect): Promise<void> {
    const sid = this.viewSceneId;
    if (!this.isDM || !sid) return;
    const r = (n: number) => Math.round(n);
    await this.backend.set(`${P.meta(this.tableId)}/view`, { sid, x: r(rect.x), y: r(rect.y), w: Math.max(1, r(rect.w)), h: Math.max(1, r(rect.h)), n: Date.now() });
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
      // the DM asked everyone to look somewhere (not on first load: only asks made while we are here count)
      const call = this.meta?.view ?? null;
      if (this.metaLoaded && call && call.n !== this.viewCallN && this.role === 'player') for (const fn of [...this.viewListeners]) fn(call);
      this.viewCallN = call?.n ?? this.viewCallN;
      this.metaLoaded = true;
      this.followActiveScene();
      this.bump();
    }, this.fail('meta')));

    this.unsubs.push(b.listen(P.settings(tid), (v) => {
      this.settings = normalizeSettings(v, PRESETS);
      this.bump();
    }, this.fail('settings')));

    this.unsubs.push(() => { this.libUnsub?.(); this.libUnsub = null; clearTimeout(this.mergeTimer); });
    this.unsubs.push(b.listenChildren(P.players(tid), {
      added: (k, v) => { this.players.set(k, normalizePlayer(k, v)); this.playersChanged(k); this.bump(); },
      changed: (k, v) => { this.players.set(k, normalizePlayer(k, v)); this.playersChanged(k); this.bump(); },
      removed: (k) => { this.players.delete(k); this.bump(); },
    }, this.fail('players')));

    // handouts: the DM works on their own copies, a player gets only what is being shown
    // what is already out when someone arrives is not announced; only what is shown after that is. The first read of the list says when "after" starts.
    this.handoutReady = false;
    clearTimeout(this.handoutTimer);
    const handoutRow = (k: string, v: any) => {
      const h = normalizeHandout(k, v);
      this.handouts.set(k, h);
      const prev = this.handoutSeen.get(k);
      this.handoutSeen.set(k, h.n);
      // a player's screen opens a handout when it is shown to them while they are here (not for ones already out when they arrived)
      if (this.role === 'player' && this.handoutReady && h.shown && h.n && prev !== h.n && (!h.to || h.to.includes(this.uid))) {
        for (const fn of [...this.handoutListeners]) fn(h);
      }
      this.bump();
    };
    this.unsubs.push(b.listenChildren(this.role === 'dm' ? P.dmHandouts(tid) : P.handouts(tid), {
      added: handoutRow,
      changed: handoutRow,
      removed: (k) => { this.handouts.delete(k); this.handoutSeen.delete(k); this.bump(); },
    }, this.fail('handouts')));
    if (this.role === 'player') {
      const ready = () => { clearTimeout(this.handoutTimer); this.handoutTimer = setTimeout(() => { this.handoutReady = true; }, 300); };
      void b.get(P.handouts(tid)).then(ready, ready);
      this.handoutTimer = setTimeout(() => { this.handoutReady = true; }, 4000); // if the first read never answers
    }

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
      this.unsubs.push(b.listenChildren(P.sceneFolders(tid), {
        added: (k, v) => this.setFolder(k, v),
        changed: (k, v) => this.setFolder(k, v),
        removed: (k) => { this.sceneFolders = this.sceneFolders.filter((f) => f.id !== k); this.bump(); },
      }, this.fail('scene folders')));
      this.unsubs.push(b.listenChildren(P.dmChars(tid), {
        added: (k, v) => this.setCharMem(k, v),
        changed: (k, v) => this.setCharMem(k, v),
        removed: (k) => { this.charMem.delete(k); },
      }, this.fail('characters')));
    }
    this.armLibrary();

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
    this.viewListeners.clear();
    this.handoutListeners.clear();
    clearTimeout(this.handoutTimer);
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

  /**
   * Where this person's saved tokens live. The DM's templates are under their Google account. A player has no account
   * (they are anonymous per browser), so their characters are kept with the table under their identity: their own uid,
   * or the one they took back by picking their name when joining.
   */
  get libPath(): string {
    return this.isDM ? P.userTokenLib(this.uid) : P.tableChars(this.tableId, this.me?.rid ?? this.uid);
  }
  private libWatching = '';
  private libUnsub: (() => void) | null = null;
  private armLibrary() {
    const path = this.libPath;
    if (path === this.libWatching || this.stopped) return;
    this.libUnsub?.();
    this.libWatching = path;
    if (this.libUnsub) { this.tokenLib = []; this.bump(); }
    this.libUnsub = watchTokenLib(this.backend, path, (items) => { if (this.libWatching === path) { this.tokenLib = items; this.bump(); } });
    void this.migrateOldLibrary(path);
  }
  /** A player's characters used to live under their browser's account. Copy any across once. */
  private async migrateOldLibrary(path: string) {
    if (this.isDM) return;
    const flag = `vtt-lib-moved-${this.uid}`;
    try {
      if (localStorage.getItem(flag)) return;
      localStorage.setItem(flag, '1');
      const old = await this.backend.get(P.userTokenLib(this.uid));
      if (!old || typeof old !== 'object') return;
      const now = await this.backend.get(path);
      const have = new Set(now && typeof now === 'object' ? Object.keys(now) : []);
      const writes: Record<string, unknown> = {};
      for (const [id, v] of Object.entries<any>(old)) if (!have.has(id) && v && typeof v.name === 'string' && v.t) writes[`${path}/${id}`] = v;
      if (Object.keys(writes).length) await this.backend.update(writes);
    } catch { /* nothing to move, or no access to the old place */ }
  }

  /** A player entry appeared or changed. */
  private playersChanged(uid: string) {
    if (uid === this.uid && !this.isDM) this.armLibrary();
    if (this.isDM) {
      clearTimeout(this.mergeTimer);
      this.mergeTimer = setTimeout(() => { void this.mergeIdentities(); }, 600);
    }
  }
  private mergeTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * DM: a player who picked a name they had used before shares that identity with the old entry. Once the old one is
   * offline, give its tokens (in every scene) to the new one and drop the old entry, so the table list has one of each person.
   * An old entry that is still online (a second device) is left alone.
   */
  private async mergeIdentities() {
    if (!this.isDM || this.stopped) return;
    const byRid = new Map<string, Player[]>();
    for (const p of this.players.values()) if (!p.dm) byRid.set(p.rid, [...(byRid.get(p.rid) ?? []), p]);
    for (const group of byRid.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => b.joinedAt - a.joinedAt || (a.uid < b.uid ? -1 : 1));
      const [keep, ...rest] = group;
      const old = rest.filter((p) => !p.online);
      if (!old.length || !keep.online) continue;
      const gone = new Set(old.map((p) => p.uid));
      const updates: Record<string, unknown> = {};
      for (const sc of this.sceneIndex) {
        const toks = await this.backend.get(P.sceneTokens(this.tableId, sc.id)).catch(() => null);
        for (const [tid, v] of Object.entries<any>(toks ?? {})) if (v && gone.has(v.ownerUid)) updates[`${P.sceneTokens(this.tableId, sc.id)}/${tid}/ownerUid`] = keep.uid;
      }
      for (const u of gone) updates[P.player(this.tableId, u)] = null;
      await this.backend.update(updates).catch(this.fail('merge a returning player'));
    }
  }

  private setIndex(id: string, v: any) {
    const entry: SceneIndexEntry = { id, name: typeof v?.name === 'string' ? v.name : 'Scene', order: Number(v?.order) || 0, folder: typeof v?.folder === 'string' && v.folder ? v.folder : null };
    this.sceneIndex = [...this.sceneIndex.filter((s) => s.id !== id), entry].sort((a, b) => a.order - b.order);
    // DM with nothing open yet: open the scene they were on, or the active scene, or the first scene
    if (this.role === 'dm' && !this.viewSceneId && this.metaLoaded) this.followActiveScene();
    // the scene they were on before a reload may arrive after the first one did: move to it, as long as they have not chosen anything since
    else if (this.role === 'dm' && this.autoOpened && id === this.lastScene() && this.viewSceneId !== id) this.openScene(id);
    this.bump();
  }

  private setFolder(id: string, v: unknown) {
    this.sceneFolders = [...this.sceneFolders.filter((f) => f.id !== id), normalizeFolder(id, v)].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
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
      const back = this.lastScene();
      const gotBack = !!back && this.sceneIndex.some((x) => x.id === back);
      const target = gotBack ? back : active ?? this.sceneIndex[0]?.id ?? null;
      // a guess made while the scene they were on may still be on its way is not remembered as their choice
      if (target) this.openScene(target, !gotBack && !!back);
    }
  }

  /** Whether the open scene was picked for the DM on arrival (so a better guess may still replace it), not chosen by them. */
  private autoOpened = false;
  private lastSceneKey() { return `vtt-view-scene:${this.tableId}`; }
  /** The scene the DM was looking at before the page was reloaded. */
  private lastScene(): string | null {
    try { return localStorage.getItem(this.lastSceneKey()); } catch { return null; }
  }

  openScene(sid: string | null, auto = false) {
    for (const u of this.sceneUnsubs) u();
    this.sceneUnsubs = [];
    this.seenPings.clear();
    this.history.clear();
    this.clearLive();
    this.viewSceneId = sid;
    this.autoOpened = auto;
    if (this.role === 'dm' && sid && !auto) { try { localStorage.setItem(this.lastSceneKey(), sid); } catch { /* private window */ } }
    if (!sid) { this.scene = null; this.bump(); return; }

    const s: SceneState = {
      id: sid, loaded: false, meta: null, tokens: new Map(), tokensRev: 0,
      fogOps: new Map(), fogRev: 0, walls: new Map(), wallRev: 0, draws: new Map(), drawRev: 0, live: new Map(), liveRev: 0,
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
      added: (k: string, v: any) => {
        if (!live()) return;
        const t = this.withHp(s, normalizeToken(k, v, hidden));
        s.tokens.set(k, t); s.tokensRev++; this.tokensChanged(); this.characterSeen(k); this.bump();
        // a hidden light kept in the DM-only part (from before lights shone for players) moves to where players can read it
        if (hidden && isLightMark(t)) this.queueLightMove(s, k);
      },
      changed: (k: string, v: any) => { if (live()) { s.tokens.set(k, this.withHp(s, normalizeToken(k, v, hidden))); s.tokensRev++; this.tokensChanged(); this.characterSeen(k); this.bump(); } },
      removed: (k: string) => {
        if (!live()) return;
        const cur = s.tokens.get(k);
        if (!cur) return;
        // ignore the "removed" half of a reveal/hide move, which arrives after the new copy was added;
        // a light is kept where players read it whether its marker is hidden or not, so only that copy's removal counts
        const here = isLightMark(cur) ? !hidden : cur.hidden === hidden;
        if (here) { s.tokens.delete(k); s.tokensRev++; this.tokensChanged(); this.bump(); }
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
        this.characterSeen(k);
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

    const wallSet = (k: string, v: any) => {
      if (!live()) return;
      const w = normalizeWall(k, v);
      if (w) s.walls.set(k, w); else s.walls.delete(k);
      s.wallRev++; this.bump();
    };
    this.sceneUnsubs.push(b.listenChildren(P.sceneWalls(tid, sid), {
      added: wallSet, changed: wallSet,
      removed: (k) => { if (live()) { s.walls.delete(k); s.wallRev++; this.bump(); } },
    }, sceneFail('walls')));

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
  private ownGridsCache: { meta: unknown; list: MapGrid[] } | null = null;
  /** The grid that counts at a spot: an added map may have its own squares, colour and switch. The scene's own grid object when none does. */
  gridAt(p: Vec): GridSettings {
    const meta = this.scene?.meta;
    const own = this.mapGrids;
    return meta && own.length ? gridAtPoint(meta.grid, own, p) : this.grid;
  }
  /** The added maps that have a grid of their own (none for most scenes). */
  get mapGrids(): MapGrid[] {
    const meta = this.scene?.meta;
    if (!meta || !meta.maps.length) return NO_MAP_GRIDS;
    if (this.ownGridsCache?.meta !== meta) this.ownGridsCache = { meta, list: ownGrids(meta.grid, meta.maps) };
    return this.ownGridsCache.list;
  }

  canDo(action: Action, token?: Token): boolean {
    return can({ role: this.role, uid: this.uid, perm: this.settings.perm, sceneActive: this.sceneIsActive }, action, token);
  }

  myTokens(): Token[] {
    return [...(this.scene?.tokens.values() ?? [])].filter((t) => t.ownerUid === this.uid);
  }

  /** Every wall, door and window in the open scene. */
  wallsList(): Wall[] { return [...(this.scene?.walls.values() ?? [])]; }

  /** Fog ops in draw order (push keys sort chronologically). */
  fogOpsSorted(): [string, FogOp][] {
    return [...(this.scene?.fogOps.entries() ?? [])].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  private lightMoves = new Set<string>();
  private lightMoveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Lights that were hidden before hidden lights shone for players are kept in the DM-only part; move them where players can read them (one write, no undo step). */
  private queueLightMove(s: SceneState, id: string) {
    this.lightMoves.add(id);
    if (this.lightMoveTimer) return;
    this.lightMoveTimer = setTimeout(() => {
      this.lightMoveTimer = null;
      const ids = [...this.lightMoves];
      this.lightMoves.clear();
      if (this.scene !== s) return;
      const updates: Record<string, any> = {};
      for (const k of ids) {
        const t = s.tokens.get(k);
        if (!t || !isLightMark(t)) continue;
        updates[P.dmSceneToken(this.tableId, s.id, k)] = null;
        updates[P.sceneToken(this.tableId, s.id, k)] = tokenToWire(t);
      }
      if (Object.keys(updates).length) void this.backend.update(updates).catch(() => undefined);
    }, 60);
  }

  /** Where a token is kept: a hidden token in the DM-only part, except a light-only mark, which players must read (they see its light; `hide` hides its marker). */
  private tokenPath(token: Pick<Token, 'id' | 'hidden' | 'shape' | 'img' | 'light'>) {
    const sid = this.viewSceneId!;
    return token.hidden && !isLightMark(token) ? P.dmSceneToken(this.tableId, sid, token.id) : P.sceneToken(this.tableId, sid, token.id);
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
    Object.assign(token, publicHp(token.hpShow, token.hp, token.maxHp));
    const updates: Record<string, any> = { [this.tokenPath(token)]: tokenToWire(token) };
    if (token.hp != null && token.maxHp != null) updates[this.hpPath(id)] = hpWire(token.hp, token.maxHp, token.tempHp);
    await this.backend.update(updates);
    if (opts.record !== false) this.recordCreated([token], 'Add token');
    return id;
  }

  /** Add several tokens in one write and one undo step (DM only: used by auto-lights). */
  async addTokens(partials: (Partial<Token> & { x: number; y: number })[], label = 'Add tokens'): Promise<string[]> {
    const sid = this.viewSceneId;
    if (!sid) throw new Error('No scene is open');
    if (!this.isDM) throw new Error('Only the DM can add tokens in bulk.');
    if (!partials.length) return [];
    let z = Math.max(0, ...[...(this.scene?.tokens.values() ?? [])].map((t) => t.z));
    const updates: Record<string, any> = {};
    const made: Token[] = [];
    for (const p of partials) {
      const id = this.backend.newKey();
      const token = normalizeToken(id, { ...p, z: ++z }, !!p.hidden);
      Object.assign(token, publicHp(token.hpShow, token.hp, token.maxHp));
      updates[this.tokenPath(token)] = tokenToWire(token);
      if (token.hp != null && token.maxHp != null) updates[this.hpPath(id)] = hpWire(token.hp, token.maxHp, token.tempHp);
      made.push(token);
    }
    await this.backend.update(updates);
    this.recordCreated(made, label);
    return made.map((t) => t.id);
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
  private async deleteTokensRaw(tokens: Pick<Token, 'id' | 'hidden' | 'shape' | 'img' | 'light'>[]): Promise<void> {
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
    const nextAll: Token = { ...cur, ...patch, id: cur.id };
    const hideChange = patch.hidden !== undefined && patch.hidden !== cur.hidden;
    // a token that has to change place (hidden or revealed, or turned into or out of a light) is rewritten whole
    if (this.tokenPath(nextAll) !== this.tokenPath(cur)) {
      if (!this.isDM) return;
      const next = { ...nextAll, hidden: patch.hidden ?? cur.hidden };
      await this.backend.update({
        [this.tokenPath(cur)]: null,
        [this.tokenPath(next)]: tokenToWire(next),
      });
      return;
    }
    if (hideChange && !this.isDM) return;
    const base = this.tokenPath(cur);
    const updates: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'hidden' || k === 'hp' || k === 'maxHp' || k === 'tempHp' || k === 'hpPct' || k === 'hpNow' || k === 'hpCap') continue;
      updates[`${base}/${k}`] = k === 'fx' ? fxToWire((v as Effect[] | undefined) ?? []) : k === 'initBonus' ? (v ? v : null) : v === undefined ? null : v;
    }
    // a light stays where it is when its marker is hidden or shown: only the flag changes
    if (hideChange && isLightMark(nextAll)) updates[`${base}/hide`] = patch.hidden ? true : null;
    // hit points live in the DM-only part of the database; players only ever see a percentage
    if (this.isDM && ('hp' in patch || 'maxHp' in patch || 'tempHp' in patch || 'hpShow' in patch)) {
      const c = cleanHp('hp' in patch ? patch.hp : cur.hp, 'maxHp' in patch ? patch.maxHp : cur.maxHp);
      const tmp = Math.max(0, Math.round('tempHp' in patch ? patch.tempHp ?? 0 : cur.tempHp));
      if ('hp' in patch || 'maxHp' in patch || 'tempHp' in patch) updates[this.hpPath(cur.id)] = c.hp == null || c.max == null ? null : hpWire(c.hp, c.max, tmp);
      const pub = publicHp(patch.hpShow ?? cur.hpShow, c.hp, c.max);
      updates[`${base}/hpPct`] = pub.hpPct;
      updates[`${base}/hpNow`] = pub.hpNow;
      updates[`${base}/hpCap`] = pub.hpCap;
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
      updates[`${base}/x`] = tokenCoordinate(m.x);
      updates[`${base}/y`] = tokenCoordinate(m.y);
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
      { const gg = this.gridAt({ x, y }); if (gg.snap && isHex(gg)) ({ x, y } = snapTokenCenter(gg, t.size, { x, y })); }
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
      { const gg = this.gridAt({ x, y }); if (gg.snap) ({ x, y } = snapTokenCenter(gg, t.size, { x, y })); }
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
  canEditDrawing(d: Drawing): boolean { return this.isDM || (this.canDo(isTemplate(d.k) ? 'template' : 'draw') && d.uid === this.uid); }

  /** Drawings in the order they were made (keys sort by time). */
  drawingsSorted(): Drawing[] {
    return [...(this.scene?.draws.values() ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private drawPath(id: string) { return P.sceneDrawing(this.tableId, this.viewSceneId!, id); }

  async addDrawing(d: NewDrawing, opts: { record?: boolean; onId?: (id: string) => void; label?: string } = {}): Promise<string> {
    if (!this.viewSceneId) throw new Error('No scene is open');
    if (!this.canDo(isTemplate(d.k) ? 'template' : 'draw')) throw new Error(isTemplate(d.k) ? 'The DM has turned off spell templates for players.' : 'The DM has turned off drawing for players.');
    const id = this.backend.newKey();
    const full: Drawing = { fc: '', font: '', b: false, i: false, u: false, ho: false, hz: null, ...d, id, uid: this.uid, t: this.backend.now() };
    const wrote = this.backend.set(this.drawPath(id), drawingToWire(full));
    opts.onId?.(id);
    await wrote;
    if (opts.record !== false) this.recordDrawn([full], opts.label ?? (isTemplate(d.k) ? 'Place template' : 'Draw'));
    return id;
  }

  /** Add several drawings in one go (one step of undo). Returns their ids. */
  async addDrawings(list: NewDrawing[], label = 'Draw'): Promise<string[]> {
    if (!this.viewSceneId) throw new Error('No scene is open');
    if (!list.length) return [];
    if (list.some((d) => !this.canDo(isTemplate(d.k) ? 'template' : 'draw'))) throw new Error('The DM has turned off drawing for players.');
    const t = this.backend.now();
    const full: Drawing[] = list.map((d) => ({ fc: '', font: '', b: false, i: false, u: false, ho: false, hz: null, ...d, id: this.backend.newKey(), uid: this.uid, t }));
    await this.restoreDrawings(full);
    this.recordDrawn(full, label);
    return full.map((d) => d.id);
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

  // ---------------------------------------------------------------- walls (DM only)
  private wallPath(id: string) { return P.sceneWall(this.tableId, this.viewSceneId!, id); }
  private async putWalls(list: Wall[]) {
    const updates: Record<string, any> = {};
    for (const w of list) updates[this.wallPath(w.id)] = wallToWire(w);
    if (Object.keys(updates).length) await this.backend.update(updates);
  }
  private async dropWalls(ids: string[]) {
    const updates: Record<string, any> = {};
    for (const id of ids) updates[this.wallPath(id)] = null;
    if (Object.keys(updates).length) await this.backend.update(updates);
  }

  /**
   * Add walls (one call per stroke or box, so Ctrl+Z takes back the whole thing). Returns their ids.
   * A door or window drawn along a plain wall cuts a gap in it (the wall is split around the new piece).
   */
  async addWalls(list: Omit<Wall, 'id'>[], label = 'Draw wall'): Promise<string[]> {
    if (!this.isDM || !this.viewSceneId || !list.length) return [];
    const made: Wall[] = list.map((w) => ({ ...w, id: this.backend.newKey() }));
    const tol = Math.max(2, this.grid.cell * 0.06);
    const cut = new Map<string, Wall>();
    const pieces: Wall[] = [];
    for (const w of made) {
      if (w.k === 'wall') continue;
      const live = [...(this.scene?.walls.values() ?? [])].filter((x) => !cut.has(x.id));
      const r = carveWalls(live, w, tol);
      for (const id of r.remove) { const old = this.scene?.walls.get(id); if (old) cut.set(id, { ...old }); }
      for (const p of r.add) pieces.push({ ...p, id: this.backend.newKey() });
    }
    const gone = [...cut.values()];
    const adds = [...made, ...pieces].map((w) => ({ ...w }));
    await this.putWalls(adds);
    if (gone.length) await this.dropWalls(gone.map((w) => w.id));
    this.history.push({
      label,
      undo: async () => { await this.dropWalls(adds.map((w) => w.id)); await this.putWalls(gone); },
      redo: async () => { await this.putWalls(adds); await this.dropWalls(gone.map((w) => w.id)); },
    });
    return made.map((w) => w.id);
  }

  async updateWalls(ids: string[], patch: Partial<Pick<Wall, 'a' | 'b' | 'k' | 'open' | 'vis' | 'one' | 'h'>>, label = 'Change wall'): Promise<void> {
    if (!this.isDM || !this.viewSceneId) return;
    const before = ids.map((id) => this.scene?.walls.get(id)).filter((w): w is Wall => !!w).map((w) => ({ ...w }));
    if (!before.length) return;
    const after = before.map((w) => {
      const n = { ...w, ...patch };
      if (n.k === 'wall') n.open = false; // only doors and windows open
      return n;
    });
    await this.putWalls(after);
    this.history.push({ label, key: `wall:${patch.vis !== undefined ? 'vis' : patch.k !== undefined ? 'k' : patch.one !== undefined ? 'one' : patch.h !== undefined ? 'h' : 'move'}:${before.map((w) => w.id).join(',')}`, undo: () => this.putWalls(before), redo: () => this.putWalls(after) });
  }

  /** Move wall ends: each entry says which end of which wall goes where (used to drag a corner that several walls share). */
  async moveWallEnds(moves: { id: string; end: 'a' | 'b'; to: Vec }[], label = 'Move wall'): Promise<void> {
    if (!this.isDM || !this.viewSceneId || !moves.length) return;
    const before: Wall[] = [];
    const after: Wall[] = [];
    for (const id of new Set(moves.map((m) => m.id))) {
      const w = this.scene?.walls.get(id);
      if (!w) continue;
      before.push({ ...w });
      const n = { ...w };
      for (const m of moves) if (m.id === id) n[m.end] = { ...m.to };
      after.push(n);
    }
    if (!after.length) return;
    await this.putWalls(after);
    this.history.push({ label, undo: () => this.putWalls(before), redo: () => this.putWalls(after) });
  }

  async removeWalls(ids: string[]): Promise<void> {
    if (!this.isDM || !this.viewSceneId) return;
    const snaps = ids.map((id) => this.scene?.walls.get(id)).filter((w): w is Wall => !!w).map((w) => ({ ...w }));
    if (!snaps.length) return;
    await this.dropWalls(snaps.map((w) => w.id));
    this.history.push({ label: snaps.length > 1 ? 'Delete walls' : 'Delete wall', undo: () => this.putWalls(snaps), redo: () => this.dropWalls(snaps.map((w) => w.id)) });
  }

  /** Swap the blocked side of the one-way walls among these (two-way walls are left alone). */
  async flipWalls(ids: string[]): Promise<void> {
    if (!this.isDM || !this.viewSceneId) return;
    const before = ids.map((id) => this.scene?.walls.get(id)).filter((w): w is Wall => !!w && w.one !== 0).map((w) => ({ ...w }));
    if (!before.length) return;
    const after = before.map((w) => ({ ...w, one: (w.one === 1 ? -1 : 1) as Wall['one'] }));
    await this.putWalls(after);
    this.history.push({ label: 'Flip the blocked side', undo: () => this.putWalls(before), redo: () => this.putWalls(after) });
  }

  /** Give a wall a corner at `at` (a point on it): it becomes two walls that can be bent apart. Returns the new walls' ids. */
  async splitWall(id: string, at: Vec): Promise<string[]> {
    if (!this.isDM || !this.viewSceneId) return [];
    const w = this.scene?.walls.get(id);
    if (!w) return [];
    const pieces = splitPieces(w, at).map((p) => ({ ...p, id: this.backend.newKey() }));
    const old = { ...w };
    await this.putWalls(pieces);
    await this.dropWalls([id]);
    this.history.push({
      label: 'Add a corner',
      undo: async () => { await this.dropWalls(pieces.map((p) => p.id)); await this.putWalls([old]); },
      redo: async () => { await this.putWalls(pieces); await this.dropWalls([id]); },
    });
    return pieces.map((p) => p.id);
  }

  /** Take out the corner at `at` where exactly two walls meet (they become one wall). False when that is not what is there. */
  async joinWallsAt(at: Vec, tol: number): Promise<boolean> {
    if (!this.isDM || !this.viewSceneId) return false;
    const j = joinAt(this.scene?.walls.values() ?? [], at, tol);
    if (!j) return false;
    const gone = j.remove.map((id) => ({ ...this.scene!.walls.get(id)! }));
    const made: Wall = { ...j.add, id: this.backend.newKey() };
    await this.putWalls([made]);
    await this.dropWalls(j.remove);
    this.history.push({
      label: 'Remove a corner',
      undo: async () => { await this.dropWalls([made.id]); await this.putWalls(gone); },
      redo: async () => { await this.putWalls([made]); await this.dropWalls(j.remove); },
    });
    return true;
  }

  /** Open or close a door or a window. */
  async toggleDoor(id: string): Promise<void> {
    const w = this.scene?.walls.get(id);
    if (!w || w.k === 'wall') return;
    await this.updateWalls([id], { open: !w.open }, `${w.open ? 'Close' : 'Open'} ${w.k}`);
  }

  async removeDrawings(ids: string[], label = 'Erase drawing'): Promise<void> {
    const snaps = ids.map((id) => this.scene?.draws.get(id)).filter((d): d is Drawing => !!d && this.canEditDrawing(d)).map((d) => ({ ...d }));
    if (!snaps.length) return;
    await this.deleteDrawingsRaw(snaps.map((d) => d.id));
    this.history.push({ label: snaps.length > 1 ? `${label}s` : label, undo: () => this.restoreDrawings(snaps), redo: () => this.deleteDrawingsRaw(snaps.map((d) => d.id)) });
  }

  /** Apply one edit to the selected finished surfaces. Partial strokes are cut only
   * inside the selected contour. The cuts and replacement belong to one undo step. */
  async editHeightPatches(patches: HeightPatch[], edit: { height: number } | { delta: Vec } | 'delete'): Promise<string[]> {
    if (!this.isDM || !patches.length) return [];
    const current = zonesOf(this.scene?.draws.values() ?? [],this.grid);
    if (patches.some(p => p.sig !== current.sig)) return [];
    const ids = [...new Set(patches.flatMap(p => p.ids))];
    if (patches.every(p => p.whole)) {
      if (edit === 'delete') { await this.removeDrawings(ids,'Delete ground'); return []; }
      if ('delta' in edit) await this.moveDrawings(ids,edit.delta.x,edit.delta.y);
      else await this.updateDrawings(ids.filter(id => !this.scene?.draws.get(id)?.he),{hz:edit.height},'Change ground');
      return ids;
    }
    const strokes = patches.flatMap(p => p.cuts.flatMap(cut => cut.shape.map(poly => patchStroke(poly,cut.group,null))));
    const cutCount = strokes.length;
    if (edit !== 'delete') for (const p of patches) {
      const delta = 'delta' in edit ? edit.delta : {x:0,y:0};
      strokes.push(patchStroke(p.polygon,newAreaId(),'height' in edit ? edit.height : p.height,delta.x,delta.y));
    }
    const written = await this.addDrawings(strokes,edit === 'delete' ? 'Delete ground' : 'height' in edit ? 'Change ground' : 'Move ground');
    return written.slice(cutCount);
  }

  /** Change the height (and whether it adds to the ground below) of a painted area: all of its strokes together. */
  async setArea(area: { paint: { id: string }[] }, patch: { hz?: number; ha?: boolean; color?: string }): Promise<void> {
    await this.updateDrawings(area.paint.map((s) => s.id), patch, 'Change ground');
  }

  /** Make several painted areas one. They take the height and mode of the first, and each keeps its erased bits. */
  async mergeAreas(areas: { id: string; h: number; add: boolean; ids: string[] }[]): Promise<void> {
    if (areas.length < 2) return;
    const [first, ...rest] = areas;
    const ids = rest.flatMap((a) => a.ids);
    await this.updateDrawings(ids, { hg: first.id, hz: first.h, ha: first.add }, 'Merge areas');
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

  async updateDrawings(ids: string[], patch: DrawingPatch, label = 'Edit drawing'): Promise<void> {
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
    this.history.push({ label, key: `draw:${ids.join('+')}:${Object.keys(patch).sort().join(',')}`, undo: () => write(prev), redo: () => write(next) });
  }

  // ---------------------------------------------------------------- live plotting (ruler, test moves)
  private liveMine: { ruler: { a: Vec; b: Vec; c?: string; via?: Vec[] } | null; ghosts: Record<string, Vec & { via?: Vec[]; stops?: number[] }> } = { ruler: null, ghosts: {} };
  private liveSid: string | null = null;
  private liveArmed = false;
  private pushLive = throttle(() => { void this.writeLive(); }, 90);

  /** Share (or stop sharing) what you are plotting. Pass only the parts that changed. */
  setLive(patch: { ruler?: { a: Vec; b: Vec; c?: string; via?: Vec[] } | null; ghosts?: Record<string, Vec & { via?: Vec[]; stops?: number[] }> }) {
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
    const gh = Object.fromEntries(Object.entries(ghosts).map(([id, v]) => [id, { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, w: viaToWire(v.via, MAX_ROUTE_CORNERS), s: v.via?.length ? v.stops?.join(',') : undefined }]));
    try {
      if (!ruler && !Object.keys(gh).length) { await this.backend.remove(path); return; }
      if (!this.liveArmed) { this.backend.onDisconnectSet(path, null); this.liveArmed = true; }
      await this.backend.set(path, stripUndefined({
        ruler: ruler ? { ax: Math.round(ruler.a.x), ay: Math.round(ruler.a.y), bx: Math.round(ruler.b.x), by: Math.round(ruler.b.y), c: ruler.c, w: viaToWire(ruler.via) } : undefined,
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
    if (!Number.isFinite(amount) || amount === 0) return;
    await this.hurt(ids.map((id) => ({ id, amount })), amount > 0 ? 'Damage' : 'Healing');
  }

  /** The same, with an amount for each token (a spell that those who saved only half-feel). One undo step. Returns what each token ended up with. */
  async hurt(list: { id: string; amount: number }[], label = 'Damage'): Promise<{ id: string; name: string; hp: number; tempHp: number }[]> {
    if (!this.isDM) return [];
    const before: { id: string; hp: number; tempHp: number }[] = [];
    const after: { id: string; hp: number; tempHp: number }[] = [];
    const out: { id: string; name: string; hp: number; tempHp: number }[] = [];
    for (const { id, amount } of list) {
      const t = this.scene?.tokens.get(id);
      if (!t || t.hp == null || t.maxHp == null || !Number.isFinite(amount) || amount === 0) continue;
      before.push({ id, hp: t.hp, tempHp: t.tempHp });
      const now = applyDamage(t.hp, t.maxHp, t.tempHp, Math.round(amount));
      after.push({ id, ...now });
      out.push({ id, name: t.name || 'Token', ...now });
    }
    if (!after.length) return [];
    const apply = (l: { id: string; hp: number; tempHp: number }[]) => Promise.all(l.map((x) => this.updateToken(x.id, { hp: x.hp, tempHp: x.tempHp }))).then(() => undefined);
    await apply(after);
    this.history.push({
      label, // no coalescing key: every hit is its own undo step
      undo: () => apply(before),
      redo: () => apply(after),
    });
    return out;
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
    // a torch or other light-only mark is never a combatant, so it never stays in the order
    const clean = withoutLights(next, tokens);
    const entries = clean.entries.map((e) => ({ ...e, n: (e.tk && tokens.get(e.tk)?.name) || e.n }));
    const state: InitState = { ...clean, entries };
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
      const pub = initPubToWire(toPub(withoutLights(sc.init, sc.tokens), sc.tokens));
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
      const tk = r.tk ? s.tokens.get(r.tk) : undefined;
      if (tk && isLightMark(tk)) continue; // a light is not a combatant
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
    const sc = this.scene;
    const sid = this.viewSceneId;
    if (!sc || !sid || !this.isDM) return;
    // a light that was somehow in the order does not take a turn
    const s = { ...sc, init: withoutLights(sc.init, sc.tokens) };
    if (!s.init.entries.length) return;
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

  /** Swap one effect on a token for a changed version of itself (keeps its place in the list). */
  async replaceEffect(id: string, fxId: string, e: Effect): Promise<void> {
    await this.changeFx([id], (cur) => cur.map((x) => (x.id === fxId ? { ...e, id: fxId } : x)), `Change ${e.n}`);
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
    // ground they have seen is kept grey (shown dimmed when nobody can see it now) unless the DM wants it plainly clear
    const mode: FogMode = m.fog.dim ? 'x' : 'r';
    // a wall's top depends on the ground it stands on, and what is higher than that sees over it (only worked out when some wall has a height)
    const zones = [...s.walls.values()].some((w) => w.h > 0) ? zonesOf(s.draws.values(), g) : null;
    const segs = sightSegs(s.walls.values(), (w) => (zones ? groundAt(zones, wallMid(w)) : 0) + w.h);
    // in the dark a token remembers what its own light, its darkvision and its touch reach as it walks, and what other lights show it where it stands
    const dark = m.light.ambient === 'dark';
    const altOf = (t: Token) => (zones ? altitudeOf(t, groundAt(zones, t)).alt : undefined);
    const lights: LightSrc[] = dark
      ? [...s.tokens.values()].filter((t) => (!t.hidden || isLightMark(t)) && t.light).map((t) => lightOf(t, g, { x: t.x, y: t.y }, altOf(t))).filter((l): l is LightSrc => !!l)
      : [];
    for (const t of s.tokens.values()) {
      let r = sightRadiusPx(t, g);
      const tr = this.trails.get(t.id);
      if (!tr || r <= 0 || t.hidden) continue;
      const viewer = dark ? viewerOf(t, g, { x: t.x, y: t.y }, altOf(t)) : null;
      if (dark) {
        if (!viewer) continue;
        r = Math.min(r, Math.max(viewer.touch, viewer.dv, lights.find((l) => l.id === t.id)?.r ?? 0));
      }
      const lines = [...tr.segs, ...(tr.pend.length ? [tr.pend] : [])];
      for (const line of lines) {
        // keep the shape of the route but not every little step of it
        const pts = line.filter((p, i) => i === 0 || i === line.length - 1 || Math.hypot(p.x - line[i - 1].x, p.y - line[i - 1].y) >= g.cell * 0.2);
        // with no wall in reach this is the one thick line; with walls it is what the token could see from a spot every square along the way
        for (const shape of routeReveal(pts, r, segs, g.cell, zones ? altitudeOf(t, groundAt(zones, t)).alt : undefined)) {
          updates[`${P.sceneFog(this.tableId, sid)}/${this.backend.newKey()}`] = shape.t === 'line' ? lineOp(mode, shape.pts, shape.w) : polyOp(mode, shape.pts);
          count++;
        }
      }
      if (viewer && lines.length) {
        for (const piece of litSeen(viewer, lights.filter((l) => l.id !== t.id), segs)) {
          updates[`${P.sceneFog(this.tableId, sid)}/${this.backend.newKey()}`] = polyOp(mode, piece);
          count++;
        }
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
  async createScene(opts: { name: string; mapUrl?: string | null; mapW?: number; mapH?: number; /** the colour behind the map (an empty grid wants a dark one) */ bg?: string; grid?: Partial<GridSettings>; makeActive?: boolean; /** do not look for a printed grid in the map */ gridTried?: boolean; /** the folder to put it in */ folder?: string | null }): Promise<string> {
    const tid = this.tableId;
    const sid = this.backend.newKey();
    const order = Math.max(0, ...this.sceneIndex.map((s) => s.order)) + 1;
    const meta: SceneMeta = {
      ...normalizeSceneMeta({}),
      name: opts.name || 'New scene',
      mapUrl: opts.mapUrl ?? null,
      gridTried: opts.gridTried ?? !opts.mapUrl,
      mapW: opts.mapW ?? 0,
      mapH: opts.mapH ?? 0,
      ...(opts.bg ? { bg: opts.bg } : {}),
      grid: { ...DEFAULT_GRID, ...opts.grid },
      createdAt: Date.now(),
    };
    await this.backend.update({
      [P.sceneMeta(tid, sid)]: { ...stripUndefined(meta as unknown as Record<string, unknown>), maps: mapsToWire(meta.maps) },
      [`${P.sceneIndex(tid)}/${sid}`]: { name: meta.name, order, ...(opts.folder && this.sceneFolders.some((f) => f.id === opts.folder) ? { folder: opts.folder } : {}) },
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
      if (k === 'grid' || k === 'fog' || k === 'light') {
        for (const [k2, v2] of Object.entries(v as object)) updates[`${base}/${k}/${k2}`] = v2 === undefined ? null : v2;
      } else if (k === 'maps') updates[`${base}/maps`] = mapsToWire((v as ExtraMap[] | undefined) ?? []);
      else updates[`${base}/${k}`] = v === undefined ? null : v;
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
        if (k === 'grid' || k === 'fog' || k === 'light') {
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
    await this.updateScene({ mapUrl: url, mapW: w, mapH: h, mapX: 0, mapY: 0, mapScale: 1, mapLocked: true, mapGrid: null, gridTried: false });
  }

  // ---------------------------------------------------------------- saved tokens and characters
  private setCharMem(cid: string, v: any) {
    const c = cleanHp(typeof v?.hp === 'number' ? v.hp : null, typeof v?.max === 'number' ? v.max : null);
    if (c.hp == null || c.max == null) this.charMem.delete(cid);
    else this.charMem.set(cid, { hp: c.hp, max: c.max, tmp: typeof v?.tmp === 'number' && v.tmp > 0 ? Math.round(v.tmp) : 0 });
  }

  /** A token with a `cid` appeared or changed: the DM keeps its hit points on file, a player keeps their library entry up to date. */
  private characterSeen(id: string) {
    const t = this.scene?.tokens.get(id);
    if (!t || !t.cid) return;
    if (this.isDM) {
      if (!t.ownerUid || this.charTimer) return;
      this.charTimer = setTimeout(() => { this.charTimer = null; void this.charSweep(); }, 200);
    } else if (t.ownerUid === this.uid && this.tokenLib.some((e) => e.id === t.cid)) {
      clearTimeout(this.syncTimers.get(id));
      this.syncTimers.set(id, setTimeout(() => { this.syncTimers.delete(id); void this.syncCharacter(id); }, 1200));
    }
  }

  /** DM: remember the hit points of every saved character on the map, and give a character that has just arrived the ones it left with. */
  private async charSweep() {
    const s = this.scene;
    if (!this.isDM || !s || !this.viewSceneId) return;
    const writes: Record<string, any> = {};
    for (const t of s.tokens.values()) {
      if (!t.cid || !t.ownerUid) continue;
      const mem = this.charMem.get(t.cid);
      if (t.hp != null && t.maxHp != null) {
        this.charAdopted.add(t.id);
        if (!mem || mem.hp !== t.hp || mem.max !== t.maxHp || mem.tmp !== t.tempHp) writes[`${P.dmChars(this.tableId)}/${t.cid}`] = hpWire(t.hp, t.maxHp, t.tempHp);
      } else if (mem && !this.charAdopted.has(t.id)) {
        this.charAdopted.add(t.id);
        // only if it truly has none on file (the record may simply not have arrived yet)
        if ((await this.backend.get(this.hpPath(t.id))) != null) continue;
        const pub = publicHp(t.hpShow, mem.hp, mem.max);
        const base = this.tokenPath(t);
        writes[this.hpPath(t.id)] = hpWire(mem.hp, mem.max, mem.tmp);
        writes[`${base}/hpPct`] = pub.hpPct;
        writes[`${base}/hpNow`] = pub.hpNow;
        writes[`${base}/hpCap`] = pub.hpCap;
      }
    }
    if (Object.keys(writes).length) await this.backend.update(writes).catch(() => undefined);
  }

  /** A player: write what this character looks like now (settings, conditions) into their library entry. */
  private async syncCharacter(id: string) {
    const t = this.scene?.tokens.get(id);
    if (!t || !t.cid || t.ownerUid !== this.uid) return;
    const e = this.tokenLib.find((x) => x.id === t.cid);
    if (!e) return;
    const fields = savedFields(t, { character: true, cid: t.cid });
    if (sameSaved(fields, e.t) && (t.name || e.name) === e.name) return;
    await saveTokenToLib(this.backend, this.libPath, { name: t.name || e.name, t: fields }, e.id, e.addedAt).catch(() => undefined);
  }

  /**
   * Keep a token in your library.
   * - The DM saves a **template**: look and settings (and maximum hit points), for dropping into any scene whenever wanted.
   * - A player saves a **character**: that token is remembered, with the conditions on it, and follows them from scene to scene.
   * Returns the library entry's id.
   */
  async saveTokenToLibrary(tokenId: string): Promise<string | null> {
    const t = this.scene?.tokens.get(tokenId);
    if (!t) return null;
    if (this.isDM) return saveTokenToLib(this.backend, this.libPath, { name: t.name || 'Token', t: savedFields(t, { character: false }) });
    if (t.ownerUid !== this.uid) return null;
    const cid = t.cid ?? this.backend.newKey();
    const have = this.tokenLib.find((e) => e.id === cid);
    await saveTokenToLib(this.backend, this.libPath, { name: t.name || 'Character', t: savedFields(t, { character: true, cid }) }, cid, have?.addedAt);
    if (!t.cid) await this.updateToken(t.id, { cid });
    return cid;
  }

  /** Puts a saved token on the open scene. A character that is already here (yours) is not added twice: its id is returned. */
  async addSavedToken(entryId: string, at: Vec): Promise<string | null> {
    const e = this.tokenLib.find((x) => x.id === entryId);
    if (!e || !this.scene) return null;
    if (!this.isDM) {
      const here = [...this.scene.tokens.values()].find((t) => t.cid === e.id && t.ownerUid === this.uid);
      if (here) return here.id;
    }
    return this.addToken(tokenFromSaved(e, at, this.isDM ? { dm: true, owner: null } : { dm: false, owner: this.uid, cid: e.id }));
  }

  /**
   * DM: copy the players' tokens (conditions, hit points and all) from one scene to another, unless that character is already there.
   * Used when the table is moved. Returns how many came along.
   */
  async carryTokens(fromSid: string, toSid: string): Promise<number> {
    if (!this.isDM || fromSid === toSid) return 0;
    const tid = this.tableId;
    const [src, dst, hp, dstMeta] = await Promise.all([
      this.backend.get(P.sceneTokens(tid, fromSid)), this.backend.get(P.sceneTokens(tid, toSid)),
      this.backend.get(P.dmSceneHp(tid, fromSid)), this.backend.get(P.sceneMeta(tid, toSid)),
    ]);
    const keyOf = (v: any) => (typeof v?.cid === 'string' && v.cid ? `c:${v.cid}` : `o:${v?.ownerUid}|${v?.name ?? ''}`);
    const there = new Set(Object.values<any>(dst ?? {}).map(keyOf));
    const meta = normalizeSceneMeta(dstMeta ?? {});
    const rect = sceneRect(meta);
    const cell = meta.grid.cell;
    let x = rect ? rect.x + rect.w / 2 : cell * 5;
    const y = rect ? rect.y + rect.h / 2 : cell * 5;
    let z = Math.max(0, ...Object.values<any>(dst ?? {}).map((t) => Number(t?.z) || 0));
    const updates: Record<string, any> = {};
    let n = 0;
    for (const [id, v] of Object.entries<any>(src ?? {})) {
      if (!v || typeof v.ownerUid !== 'string') continue;
      const cid = typeof v.cid === 'string' && v.cid ? v.cid : this.backend.newKey();
      if (there.has(keyOf({ ...v, cid })) || there.has(keyOf(v))) continue;
      const nid = this.backend.newKey();
      const size = Math.max(0.25, Number(v.size) || 1);
      updates[P.sceneToken(tid, toSid, nid)] = { ...v, cid, x: Math.round(x), y: Math.round(y), z: ++z, locked: undefined };
      if (!v.cid) updates[`${P.sceneToken(tid, fromSid, id)}/cid`] = cid; // the same character from now on
      if (hp?.[id]) updates[P.dmSceneHpOf(tid, toSid, nid)] = hp[id];
      x += cell * size;
      n++;
    }
    if (n) await this.backend.update(JSON.parse(JSON.stringify(updates)));
    return n;
  }

  // ---------------------------------------------------------------- scene folders (DM)
  /** Makes an empty folder and returns its id. */
  async createFolder(name: string): Promise<string> {
    if (!this.isDM) throw new Error('Only the DM can make folders.');
    const id = this.backend.newKey();
    const order = Math.max(0, ...this.sceneFolders.map((f) => f.order)) + 1;
    await this.backend.update({ [`${P.sceneFolders(this.tableId)}/${id}`]: { name: uniqueFolderName(name, this.sceneFolders), order } });
    return id;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const clean = cleanFolderName(name);
    if (!this.isDM || !clean || !this.sceneFolders.some((f) => f.id === id)) return;
    await this.backend.update({ [`${P.sceneFolders(this.tableId)}/${id}/name`]: clean });
  }

  /** Removes the folder. Its scenes are kept and go back to being in no folder. */
  async deleteFolder(id: string): Promise<void> {
    if (!this.isDM) return;
    const tid = this.tableId;
    const updates: Record<string, any> = { [`${P.sceneFolders(tid)}/${id}`]: null };
    for (const s of this.sceneIndex) if (s.folder === id) updates[`${P.sceneIndex(tid)}/${s.id}/folder`] = null;
    await this.backend.update(updates);
  }

  /** Puts a scene in a folder, or in none (null). */
  async moveScene(sid: string, folder: string | null): Promise<void> {
    if (!this.isDM || !this.sceneIndex.some((s) => s.id === sid)) return;
    if (folder && !this.sceneFolders.some((f) => f.id === folder)) return;
    await this.backend.update({ [`${P.sceneIndex(this.tableId)}/${sid}/folder`]: folder });
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

  // ---------------------------------------------------------------- the whole campaign in one file (DM)
  /** Everything about this table that is worth keeping: scenes (with hidden tokens and hit points), handouts, and optionally your map and token library. */
  async exportCampaign(opts: { library: boolean }): Promise<CampaignFile> {
    if (!this.isDM) throw new Error('Only the DM can save the campaign.');
    const tid = this.tableId;
    const scenes: { name: string; active: boolean; folder?: string; pub: any; dm: any }[] = [];
    for (const e of [...this.sceneIndex].sort((a, b) => a.order - b.order)) {
      const [pub, dm] = await Promise.all([this.backend.get(P.scene(tid, e.id)), this.backend.get(P.dmScene(tid, e.id))]);
      if (!pub || !pub.meta) continue;
      const fid = folderOf(e, this.sceneFolders);
      const folder = fid ? this.sceneFolders.find((f) => f.id === fid)?.name : undefined;
      scenes.push({ name: e.name, active: e.id === this.activeSceneId, ...(folder ? { folder } : {}), pub, dm: dm ?? {} });
    }
    let library: { maps: CampaignLibraryItem[]; tokens: CampaignLibraryItem[] } | null = null;
    if (opts.library) {
      const read = async (kind: 'maps' | 'tokens'): Promise<CampaignLibraryItem[]> => {
        const v = await this.backend.get(P.userLibrary(this.uid, kind));
        return Object.entries<any>(v ?? {})
          .map(([id, raw]) => normalizeLibraryItem(id, raw))
          .filter((x): x is NonNullable<typeof x> => !!x)
          .sort((a, b) => a.addedAt - b.addedAt)
          .map((x) => ({ name: x.name, url: x.url, ...(x.thumb ? { thumb: x.thumb } : {}), ...(x.w ? { w: x.w } : {}), ...(x.h ? { h: x.h } : {}) }));
      };
      library = { maps: await read('maps'), tokens: await read('tokens') };
    }
    return buildCampaign({
      name: this.meta?.name ?? 'Campaign',
      settings: { perm: this.settings.perm, preset: this.settings.preset },
      scenes,
      handouts: [...this.handouts.values()],
      library,
      now: Date.now(),
    });
  }

  /** Adds a saved campaign to this table. Nothing already here is changed: scenes and handouts come in as new ones. */
  async importCampaign(file: CampaignFile, opts: { library: boolean; permissions: boolean }): Promise<{ scenes: number; handouts: number; library: number; firstScene: string | null }> {
    if (!this.isDM) throw new Error('Only the DM can add a campaign.');
    const tid = this.tableId;
    const plan = planImport(file, {
      tid, uid: this.uid, newKey: () => this.backend.newKey(), now: Date.now(),
      existingNames: this.sceneIndex.map((s) => s.name),
      existingFolders: this.sceneFolders.map((f) => ({ id: f.id, name: f.name })),
      folderOrderBase: Math.max(0, ...this.sceneFolders.map((f) => f.order)),
      orderBase: Math.max(0, ...this.sceneIndex.map((s) => s.order)),
      hasActive: !!this.activeSceneId && this.sceneIndex.some((s) => s.id === this.activeSceneId),
    });
    const updates = { ...plan.updates };
    if (plan.activate) updates[P.activeScene(tid)] = plan.activate;
    const st = file.table.settings as any;
    if (opts.permissions && st?.perm && typeof st.perm === 'object') {
      const perm = normalizeSettings({ perm: st.perm }, PRESETS).perm;
      updates[P.settings(tid)] = { perm, preset: detectPreset(perm) };
    }
    if (Object.keys(updates).length) await this.backend.update(updates);
    let added = 0;
    if (opts.library && file.library) {
      for (const kind of ['maps', 'tokens'] as const) {
        const have = Object.values<any>((await this.backend.get(P.userLibrary(this.uid, kind))) ?? {}).filter((x) => x && typeof x.url === 'string');
        for (const it of newLibraryItems(have, file.library[kind])) { await addLibraryItem(this.backend, this.uid, kind, it); added++; }
      }
    }
    return { scenes: plan.sceneIds.length, handouts: plan.handoutIds.length, library: added, firstScene: plan.sceneIds[0] ?? null };
  }

  /** Moves the table onto a scene. With `carryParty` on, the players' tokens come along. Returns how many came. */
  async setActiveScene(sid: string): Promise<number> {
    const from = this.activeSceneId;
    let carried = 0;
    if (this.isDM && this.carryParty && from && from !== sid) {
      try { carried = await this.carryTokens(from, sid); } catch (e) { this.fail('bring the players\' tokens along')(e as Error); }
    }
    await this.backend.set(P.activeScene(this.tableId), sid);
    return carried;
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
  /** `rid`: the identity of a player who has been here before (their saved characters come back with it). */
  async joinAsPlayer(name: string, color: string, rid?: string): Promise<void> {
    const path = P.player(this.tableId, this.uid);
    const existing = await this.backend.get(path);
    const keep = rid ?? (typeof existing?.rid === 'string' ? existing.rid : undefined);
    await this.backend.set(path, { name, color, online: true, joinedAt: existing?.joinedAt ?? SERVER_TS, ...(keep && keep !== this.uid ? { rid: keep } : {}) });
    this.backend.onDisconnectSet(`${path}/online`, false);
  }
  /** DM: remove someone from the table list (their tokens become unclaimed). */
  async removePlayer(uid: string): Promise<void> {
    if (!this.isDM || uid === this.uid) return;
    const updates: Record<string, any> = { [P.player(this.tableId, uid)]: null };
    for (const t of this.scene?.tokens.values() ?? []) if (t.ownerUid === uid) updates[`${this.tokenPath(t)}/ownerUid`] = null;
    await this.backend.update(updates);
  }
  /** Take back the identity (and with it the saved characters) of a player who has been here before. */
  async claimIdentity(rid: string): Promise<void> {
    await this.backend.update({ [`${P.player(this.tableId, this.uid)}/rid`]: rid === this.uid ? null : rid });
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

  /** Visible world rect used for camera fitting: every map in the scene. */
  sceneRect() {
    const m = this.scene?.meta;
    if (!m) return null;
    return sceneRect(m) ?? { x: 0, y: 0, w: 2000, h: 1500 };
  }

  // ---------------------------------------------------------------- extra maps (DM)
  /** Lay another map picture over the scene, just to the right of what is there. Returns its id. */
  async addExtraMap(url: string, w: number, h: number, name: string): Promise<string | null> {
    const meta = this.scene?.meta;
    if (!this.isDM || !meta) return null;
    if (meta.maps.length >= MAX_EXTRA_MAPS) throw new Error(`A scene can have the main map and ${MAX_EXTRA_MAPS} more.`);
    const here = sceneRect(meta);
    const id = this.backend.newKey();
    // an empty grid lines up with the squares already there; a picture just goes beside the others
    const at = isBlankMap(url) ? blankSpot(meta.grid, here) : { x: here ? here.x + here.w : 0, y: here ? here.y : 0 };
    const map: ExtraMap = { id, url, w, h, x: at.x, y: at.y, scale: 1, name: name.slice(0, 60), show: true, locked: false };
    await this.updateScene({ maps: [...meta.maps, map] });
    return id;
  }

  /** Put an empty grid beside what is there: a piece of the scene that is only squares. Returns its id. */
  async addBlankGrid(cols = BLANK_COLS, rows = BLANK_ROWS): Promise<string | null> {
    const cell = this.scene?.meta?.grid.cell ?? DEFAULT_GRID.cell;
    return this.addExtraMap(BLANK_MAP, clampSquares(cols) * cell, clampSquares(rows) * cell, 'Empty grid');
  }

  /** Make a scene that has no map into an empty grid of this many squares (and give it a background that shows the lines, unless it has one already). */
  async makeBlankPage(cols = BLANK_COLS, rows = BLANK_ROWS): Promise<void> {
    const meta = this.scene?.meta;
    if (!this.isDM || !meta || meta.mapUrl) return;
    const cell = meta.grid.cell;
    await this.updateScene({ mapW: clampSquares(cols) * cell, mapH: clampSquares(rows) * cell, mapX: 0, mapY: 0, mapScale: 1, mapLocked: true, ...(meta.bg === DEFAULT_BG ? { bg: BLANK_BG } : {}) });
  }

  /** Change how many squares an empty-grid scene has, or take the grid away again (0) so the scene has no map. */
  async resizeBlankPage(cols: number, rows: number): Promise<void> {
    const meta = this.scene?.meta;
    if (!this.isDM || !meta || !isBlankPage(meta)) return;
    await this.updateScene({ mapW: clampSquares(cols) * meta.grid.cell, mapH: clampSquares(rows) * meta.grid.cell });
  }

  /** Move, resize, rename, show or hide one of the extra maps, or give it a grid of its own. */
  async updateExtraMap(id: string, patch: Partial<Omit<ExtraMap, 'id' | 'url' | 'gs' | 'gv' | 'gc' | 'gp'>> & { gs?: number | null; gv?: boolean | null; gc?: string | null; gp?: string | null }): Promise<void> {
    const meta = this.scene?.meta;
    if (!this.isDM || !meta || !meta.maps.some((m) => m.id === id)) return;
    await this.updateScene({ maps: meta.maps.map((m) => {
      if (m.id !== id) return m;
      const { w, h, gs, gv, gc, gp, ...rest } = patch;
      const next: ExtraMap = { ...m, ...rest };
      // a grid of its own can be put back to the scene's by passing null
      if (gs !== undefined) { if (gs === null) delete next.gs; else next.gs = Math.max(4, Math.min(2000, gs)); }
      if (gv !== undefined) { if (gv === null) delete next.gv; else next.gv = gv; }
      if (gc !== undefined) { if (gc === null) delete next.gc; else next.gc = gc; }
      if (gp !== undefined) { if (gp === null) delete next.gp; else next.gp = gp; }
      // a picture has the size it was made with; only an empty grid is told how many squares it has, and keeps them when its squares change
      if (isBlankMap(m.url)) {
        const was = mapCell(meta.grid, m), now = mapCell(meta.grid, next);
        const cols = w != null ? clampSquares(w / now) : clampSquares(m.w / was), rows = h != null ? clampSquares(h / now) : clampSquares(m.h / was);
        next.w = cols * now;
        next.h = rows * now;
      }
      return next;
    }) });
  }

  async removeExtraMap(id: string): Promise<void> {
    const meta = this.scene?.meta;
    if (!this.isDM || !meta) return;
    await this.updateScene({ maps: meta.maps.filter((m) => m.id !== id) });
  }
}
