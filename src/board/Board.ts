import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  clamp, distanceFt, fitCamera, gridFromRect, mapRect, normRect, pointInToken, rectContains, snapTokenCenter, snapToCellCenter, snapToCorner, zoomAt,
} from '../core/geometry';
import { dashSegments, fitPenPoints, hitDrawing, isTemplate, joinPts, snapTemplate, templateLabel } from '../core/draw';
import { FogMask, lineOp, polyOp, rectOp } from '../core/fog';
import type { TableClient } from '../state/client';
import type { StrokeSize, UiState } from '../state/ui';
import type { DrawKind, Drawing, Ping, Rect, Token, Vec } from '../types';
import { throttle } from '../core/throttle';
import { TokenView } from './TokenView';
import { DrawLayer, paintShape } from './DrawLayer';
import { canvasTexture, loadTexture, releaseTexture, setTextureFailHandler, type LoadedTexture } from './textures';
import { diagnoseImage } from '../core/images';

export interface BoardCallbacks {
  onContextMenu(info: { clientX: number; clientY: number; tokenId: string | null; world: Vec }): void;
  /** DM finished dragging a rectangle with the grid tool */
  onGridRect(rect: Rect, derived: { cell: number; ox: number; oy: number }): void;
  onMapError(message: string | null): void;
  /** a token's picture could not be loaded (shown once per picture) */
  onTokenImageError(message: string): void;
  /** short messages such as "Undid: Move token" */
  onNotice(message: string, kind: 'info' | 'ok' | 'error'): void;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean; button: number }
  | { kind: 'tokens'; ids: string[]; anchor: string; start: Vec; origins: Map<string, Vec>; moved: boolean }
  | { kind: 'marquee'; start: Vec; cur: Vec; base: Set<string> }
  | { kind: 'rect'; start: Vec; cur: Vec }
  | { kind: 'brush'; pts: Vec[] }
  | { kind: 'map'; start: Vec; orig: Vec; moved: boolean }
  | { kind: 'shape'; dk: DrawKind; start: Vec; pts: Vec[] }
  | { kind: 'erase'; ids: Set<string> }
  | { kind: 'ruler' }
  | { kind: 'drawmove'; ids: string[]; start: Vec; dx: number; dy: number; moved: boolean };

const num = (c: string) => parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0xffffff;
const SELECT = 0x4da3ff;
const PRESS_PING_MS = 450;
const STROKE_CELLS: Record<StrokeSize, number> = { thin: 0.035, medium: 0.07, thick: 0.15 };
const SHARE_BLUE = 0x4da3ff;

interface PingFx { g: Graphics; label: Text; born: number; x: number; y: number; color: number }

export class Board {
  app!: Application;
  private host: HTMLElement;
  private client: TableClient;
  private ui: UiState;
  private cb: BoardCallbacks;

  private world = new Container();
  private mapLayer = new Container();
  private gridG = new Graphics();
  private tokenLayer = new Container();
  private fogLayer = new Container();
  private drawLayer = new DrawLayer();
  private auraG = new Graphics();
  private ghostLayer = new Container();
  private overlayG = new Graphics();
  private fxLayer = new Container();
  private plotLabels: Text[] = [];
  private ghostViews = new Map<string, TokenView>();
  private testMoves = new Map<string, { from: Vec; to: Vec }>();
  private ruler: { a: Vec; b: Vec } | null = null;
  private liveSent = false;
  private seenDrawRev = -1;
  private seenLiveRev = -1;
  private prevUi = { testMove: false, sharePlot: false, tool: 'select' as string };
  private distText!: Text;

  private cam = { zoom: 1, tx: 0, ty: 0 };
  private cams = new Map<string, { zoom: number; tx: number; ty: number }>();
  private fitPending = true;

  private sceneRef: TableClient['scene'] = null;
  private seenMetaRev = -1;
  private seenTokensRev = -1;
  private seenFogRev = -1;
  private seenPerm = '';
  private seenPlayers = -1;
  private seenPreview = false;
  private seenGridKey = '';

  private mapSprite: Sprite | null = null;
  private mapUrl: string | null = null;
  private mapTex: LoadedTexture | null = null;
  private mapScaleToWorld = 1;

  private views = new Map<string, TokenView>();
  private fogMask = new FogMask();
  private fogSprite: Sprite | null = null;
  private fogTexSize = '';

  private drag: Drag | null = null;
  private polyPts: Vec[] = [];
  private pointerW: Vec | null = null;
  private spaceDown = false;
  /** holding the left button on empty space for a moment sends a ping */
  private press: { x: number; y: number; w: Vec; t0: number; timer: number } | null = null;
  private dirty = true;
  private raf = 0;
  private lastT = 0;
  private pings: PingFx[] = [];
  private unsubs: (() => void)[] = [];
  private resizeObs?: ResizeObserver;
  private zoomSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private textRes = 2;
  private destroyed = false;
  private sendMoves: ReturnType<typeof throttle<[{ id: string; x: number; y: number }[]]>>;
  private sendMap: ReturnType<typeof throttle<[number, number]>>;

  constructor(host: HTMLElement, client: TableClient, ui: UiState, cb: BoardCallbacks) {
    this.host = host;
    this.client = client;
    this.ui = ui;
    this.cb = cb;
    this.sendMoves = throttle((moves) => { void this.client.moveTokens(moves); }, 60);
    this.sendMap = throttle((x, y) => { void this.client.updateScene({ mapX: x, mapY: y }); }, 80);
  }

  // ------------------------------------------------------------------ lifecycle
  private failedTokenUrls = new Set<string>();

  async init() {
    setTextureFailHandler((kind, url) => {
      if (kind !== 'token' || this.failedTokenUrls.has(url)) return;
      this.failedTokenUrls.add(url);
      void diagnoseImage(url).then((why) => { if (!this.destroyed) this.cb.onTokenImageError(`A token picture could not be shown: ${why}.`); });
    });
    const app = new Application();
    await app.init({
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight),
      background: '#1b1d23',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    if (this.destroyed) { app.destroy(true); return; }
    this.app = app;
    app.ticker.stop(); // we render on demand
    app.stage.eventMode = 'none';
    this.host.appendChild(app.canvas);
    app.canvas.style.display = 'block';
    app.canvas.style.touchAction = 'none';
    app.canvas.tabIndex = 0;
    app.canvas.style.outline = 'none';

    this.tokenLayer.sortableChildren = true;
    this.distText = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fontSize: 16, fill: 0xffffff, stroke: { color: 0x000000, width: 4, join: 'round' } },
    });
    this.distText.anchor.set(0.5, 1);
    this.distText.visible = false;
    this.ghostLayer.sortableChildren = true;
    this.world.addChild(this.mapLayer, this.gridG, this.drawLayer.container, this.auraG, this.tokenLayer, this.ghostLayer, this.fogLayer, this.overlayG, this.fxLayer, this.distText);
    app.stage.addChild(this.world);

    this.bindInput(app.canvas);
    this.unsubs.push(this.client.onPing((p) => this.addPing(p)));
    this.unsubs.push(this.ui.subscribe(() => { this.onUiChange(); this.invalidate(); }));
    this.resizeObs = new ResizeObserver(() => {
      if (this.destroyed) return;
      this.app.renderer.resize(Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight));
      this.invalidate();
    });
    this.resizeObs.observe(this.host);

    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.destroyed = true;
    this.cancelPress();
    if (this.liveSent) this.client.setLive({ ruler: null, ghosts: {} });
    setTextureFailHandler(null);
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    for (const u of this.unsubs) u();
    for (const f of this.cleanupInput) f();
    this.sendMoves.cancel();
    this.sendMap.cancel();
    if (this.mapUrl) releaseTexture(this.mapUrl, 'map');
    if (this.app) {
      try { this.app.destroy(true, { children: true }); } catch { /* already gone */ }
    }
  }

  invalidate() { this.dirty = true; }

  // ------------------------------------------------------------------ public helpers
  screenToWorld(clientX: number, clientY: number): Vec {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.cam.tx) / this.cam.zoom, y: (clientY - r.top - this.cam.ty) / this.cam.zoom };
  }

  viewCenterWorld(): Vec {
    return { x: (this.host.clientWidth / 2 - this.cam.tx) / this.cam.zoom, y: (this.host.clientHeight / 2 - this.cam.ty) / this.cam.zoom };
  }

  fit() {
    const rect = this.client.sceneRect();
    if (!rect) return;
    this.cam = fitCamera(this.host.clientWidth, this.host.clientHeight, rect, 48);
    this.applyCamera();
  }

  zoomBy(factor: number) {
    this.cam = zoomAt(this.cam, this.host.clientWidth / 2, this.host.clientHeight / 2, factor);
    this.applyCamera();
  }

  centerOn(p: Vec) {
    this.cam.tx = this.host.clientWidth / 2 - p.x * this.cam.zoom;
    this.cam.ty = this.host.clientHeight / 2 - p.y * this.cam.zoom;
    this.applyCamera();
  }

  private applyCamera() {
    this.world.scale.set(this.cam.zoom);
    this.world.position.set(this.cam.tx, this.cam.ty);
    if (this.client.viewSceneId) this.cams.set(this.client.viewSceneId, { ...this.cam });
    this.gridDirty = true;
    this.invalidate();
    if (Math.abs(this.ui.data.zoom - this.cam.zoom) / this.cam.zoom > 0.005) this.ui.set({ zoom: this.cam.zoom });
    if (this.zoomSettleTimer) clearTimeout(this.zoomSettleTimer);
    this.zoomSettleTimer = setTimeout(() => this.settleText(), 180);
  }

  private settleText() {
    const res = clamp(Math.ceil((window.devicePixelRatio || 1) * Math.max(1, this.cam.zoom) * 2) / 2, 1, 4);
    if (res === this.textRes) return;
    this.textRes = res;
    for (const v of this.views.values()) v.setTextRes(res);
    this.invalidate();
  }

  private gridDirty = true;

  // ------------------------------------------------------------------ frame loop
  private frame(dt: number) {
    this.reconcile();
    let moving = false;
    for (const v of this.views.values()) if (v.tick(dt)) moving = true;
    for (const v of this.ghostViews.values()) if (v.tick(dt)) moving = true;
    if (moving) this.dirty = true;
    if (this.pings.length) { this.tickPings(); this.dirty = true; }
    if (this.press) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    if (this.gridDirty) { this.drawGrid(); this.gridDirty = false; }
    this.drawAuras();
    this.drawOverlay();
    this.app.render();
  }

  // ------------------------------------------------------------------ scene reconciliation
  private reconcile() {
    const c = this.client;
    const scene = c.scene;
    if (scene !== this.sceneRef) this.onSceneChanged(scene);
    if (!scene) return;

    const permKey = JSON.stringify(c.settings.perm) + c.sceneIsActive;
    if (permKey !== this.seenPerm) { this.seenPerm = permKey; this.dirty = true; }

    if (scene.metaRev !== this.seenMetaRev) {
      this.seenMetaRev = scene.metaRev;
      this.onMeta();
    }
    const gridKey = scene.meta ? `${scene.meta.grid.cell}` : '';
    const previewNow = this.ui.data.dmPreview;
    if (gridKey !== this.seenGridKey) {
      this.seenGridKey = gridKey;
      for (const v of this.views.values()) v.invalidate();
      this.seenTokensRev = -1;
      this.seenDrawRev = -1;
    }
    if (c.players.size !== this.seenPlayers) { this.seenPlayers = c.players.size; this.seenTokensRev = -1; }
    if (previewNow !== this.seenPreview) { this.seenPreview = previewNow; this.seenTokensRev = -1; this.seenFogRev = -1; }

    if (scene.tokensRev !== this.seenTokensRev) {
      this.seenTokensRev = scene.tokensRev;
      this.reconcileTokens();
      this.dirty = true;
    }
    if (scene.fogRev !== this.seenFogRev) {
      this.seenFogRev = scene.fogRev;
      this.updateFog();
    }
    if (scene.drawRev !== this.seenDrawRev) {
      this.seenDrawRev = scene.drawRev;
      this.drawLayer.sync(c.drawingsSorted(), c.grid, this.textRes);
      const stale = [...this.ui.data.drawSel].filter((id) => !scene.draws.has(id));
      if (stale.length) this.ui.selectDrawings([...this.ui.data.drawSel].filter((id) => scene.draws.has(id)));
      this.dirty = true;
    }
    if (scene.liveRev !== this.seenLiveRev) {
      this.seenLiveRev = scene.liveRev;
      this.ghostsDirty = true;
      this.dirty = true;
    }
    if (this.ghostsDirty) { this.ghostsDirty = false; this.syncGhosts(); this.dirty = true; }
  }

  private onSceneChanged(scene: TableClient['scene']) {
    // remember the camera of the scene we are leaving
    this.sceneRef = scene;
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.drag = null;
    this.polyPts = [];
    this.ui.select([]);
    this.drawLayer.clear();
    this.testMoves.clear();
    this.ruler = null;
    this.liveSent = false;
    this.ghostsDirty = true;
    this.ui.set({ drawSel: new Set(), testCount: 0, textAt: null });
    if (this.mapSprite) { this.mapSprite.destroy(); this.mapSprite = null; }
    if (this.mapUrl) { releaseTexture(this.mapUrl, 'map'); this.mapUrl = null; }
    this.mapTex = null;
    this.cb.onMapError(null);
    this.seenMetaRev = this.seenTokensRev = this.seenFogRev = this.seenDrawRev = this.seenLiveRev = -1;
    this.seenGridKey = '';
    if (this.fogSprite) this.fogSprite.visible = false;
    const saved = scene ? this.cams.get(scene.id) : undefined;
    if (saved) { this.cam = { ...saved }; this.fitPending = false; this.applyCamera(); } else this.fitPending = true;
    this.dirty = true;
  }

  private onMeta() {
    const scene = this.client.scene!;
    const meta = scene.meta;
    this.app.renderer.background.color = num(meta?.bg ?? '#1b1d23');
    this.gridDirty = true;
    this.dirty = true;
    if (!meta) return;

    if (meta.mapUrl !== this.mapUrl) {
      if (this.mapUrl) releaseTexture(this.mapUrl, 'map');
      this.mapUrl = meta.mapUrl;
      this.mapTex = null;
      if (this.mapSprite) { this.mapSprite.destroy(); this.mapSprite = null; }
      if (meta.mapUrl) void this.loadMap(meta.mapUrl, scene.id);
    }
    if (this.mapSprite && this.mapTex) {
      this.mapSprite.position.set(meta.mapX, meta.mapY);
      this.mapSprite.scale.set(meta.mapScale * this.mapScaleToWorld);
    }
    if (this.fitPending && !meta.mapUrl) { this.fit(); this.fitPending = false; }
    this.updateFog();
  }

  /** Try loading the map picture again (the banner's "Try again" button). */
  retryMap() {
    const url = this.mapUrl;
    const sid = this.client.scene?.id;
    if (!url || !sid) return;
    this.cb.onMapError(null);
    void this.loadMap(url, sid);
  }

  private async loadMap(url: string, sceneId: string) {
    this.ui.set({ status: 'Loading map…' });
    const tex = await loadTexture(url, 'map');
    if (this.destroyed || this.client.scene?.id !== sceneId || this.mapUrl !== url) return;
    this.ui.set({ status: null });
    if (!tex) {
      // keep the camera on the (empty) board so tokens stay visible even without the picture
      if (this.fitPending) { this.fit(); this.fitPending = false; }
      const why = await diagnoseImage(url);
      if (this.destroyed || this.mapUrl !== url) return;
      this.cb.onMapError(`The map picture could not be shown: ${why}. Picture address: ${url}`);
      return;
    }
    this.cb.onMapError(null);
    this.mapTex = tex;
    this.mapScaleToWorld = tex.scale;
    const sprite = new Sprite(tex.texture);
    this.mapSprite = sprite;
    this.mapLayer.addChild(sprite);
    const meta = this.client.scene!.meta!;
    // the DM's client repairs missing dimensions
    if (this.client.isDM && (!meta.mapW || !meta.mapH)) void this.client.updateScene({ mapW: tex.w, mapH: tex.h });
    sprite.position.set(meta.mapX, meta.mapY);
    sprite.scale.set(meta.mapScale * tex.scale);
    if (this.fitPending) { this.fit(); this.fitPending = false; }
    this.gridDirty = true;
    this.updateFog();
    this.invalidate();
  }

  // ------------------------------------------------------------------ tokens
  private tokenCtx(t: Token) {
    const c = this.client;
    return {
      grid: c.grid,
      showLabel: t.label !== 'dm' || (c.isDM && !this.ui.data.dmPreview),
      textRes: this.textRes,
    };
  }

  private visibleToViewer(t: Token) { return !t.hidden || (this.client.isDM && !this.ui.data.dmPreview); }

  private reconcileTokens() {
    const scene = this.client.scene!;
    for (const t of scene.tokens.values()) {
      const visible = this.visibleToViewer(t);
      let v = this.views.get(t.id);
      if (!visible) { if (v) { v.destroy(); this.views.delete(t.id); } continue; }
      if (!v) {
        v = new TokenView(() => this.invalidate());
        this.views.set(t.id, v);
        this.tokenLayer.addChild(v.container);
      }
      v.apply(t, this.tokenCtx(t));
    }
    for (const [id, v] of this.views) {
      if (!scene.tokens.has(id)) { v.destroy(); this.views.delete(id); }
    }
    // a test move ends when someone else moves (or removes) that token
    let testChanged = false;
    for (const [id, m] of [...this.testMoves]) {
      const t = scene.tokens.get(id);
      const v = this.views.get(id);
      if (!t || !v || Math.hypot(t.x - m.from.x, t.y - m.from.y) > 1) {
        this.testMoves.delete(id);
        if (v) { v.testPos = null; v.target = t ? { x: t.x, y: t.y } : v.target; }
        testChanged = true;
      }
    }
    if (testChanged) this.afterTestChange();
    this.ghostsDirty = true;
    const sel = [...this.ui.data.selection].filter((id) => this.views.has(id));
    if (sel.length !== this.ui.data.selection.size) this.ui.select(sel);
  }

  private hitToken(p: Vec): Token | null {
    const grid = this.client.grid;
    const list = [...this.views.values()].sort((a, b) => b.token.z - a.token.z);
    for (const v of list) {
      if (pointInToken({ ...v.token, x: v.display.x, y: v.display.y }, grid, p)) return v.token;
    }
    return null;
  }

  // ------------------------------------------------------------------ ghosts (test-move shadows and other people's test moves)
  private ghostsDirty = true;

  private syncGhosts() {
    const scene = this.client.scene;
    const want = new Map<string, { token: Token; pos: Vec; alpha: number }>();
    if (scene) {
      for (const [id, m] of this.testMoves) {
        const t = scene.tokens.get(id);
        if (t) want.set(`me:${id}`, { token: t, pos: m.from, alpha: 0.35 });
      }
      for (const [uid, lv] of scene.live) {
        if (uid === this.client.uid) continue;
        for (const [id, pos] of Object.entries(lv.ghosts)) {
          const t = scene.tokens.get(id);
          if (t && this.visibleToViewer(t)) want.set(`${uid}:${id}`, { token: t, pos, alpha: 0.55 });
        }
      }
    }
    for (const [key, w] of want) {
      const ctx = { ...this.tokenCtx(w.token), showLabel: false };
      let v = this.ghostViews.get(key);
      const fresh = !v;
      if (!v) {
        v = new TokenView(() => this.invalidate());
        this.ghostViews.set(key, v);
        this.ghostLayer.addChild(v.container);
      }
      v.ghostAlpha = w.alpha;
      v.testPos = { ...w.pos };
      v.apply(w.token, ctx);
      if (fresh) v.placeAt(w.pos);
    }
    for (const [key, v] of this.ghostViews) {
      if (!want.has(key)) { v.destroy(); this.ghostViews.delete(key); }
    }
  }

  // ------------------------------------------------------------------ auras
  private drawAuras() {
    const g = this.auraG;
    g.clear();
    const grid = this.client.grid;
    const dmView = this.client.isDM && !this.ui.data.dmPreview;
    const z = this.cam.zoom;
    for (const v of this.views.values()) {
      const t = v.token;
      for (const a of t.auras) {
        if ((a.dm && !dmView) || a.r <= 0) continue;
        const r = (a.r / grid.ft) * grid.cell + (a.edge ? (t.size * grid.cell) / 2 : 0);
        const col = num(a.color);
        if (a.shape === 'square') g.rect(v.display.x - r, v.display.y - r, r * 2, r * 2);
        else g.circle(v.display.x, v.display.y, r);
        g.fill({ color: col, alpha: a.a }).stroke({ width: 2 / z, color: col, alpha: Math.min(1, a.a + 0.45) });
      }
    }
  }

  // ------------------------------------------------------------------ test moves and the ruler
  private onUiChange() {
    const u = this.ui.data;
    const prev = this.prevUi;
    this.prevUi = { testMove: u.testMove, sharePlot: u.sharePlot, tool: u.tool };
    if (prev.testMove && !u.testMove && this.testMoves.size) this.resetTestMoves();
    if (u.sharePlot !== prev.sharePlot) this.publishLive(true);
    if (prev.tool !== u.tool) {
      this.cancelPress();
      if (this.ruler && u.tool !== 'ruler') { this.ruler = null; this.publishLive(); }
    }
  }

  /** Show (or stop showing) my ruler and test moves to everyone else, according to the share switch. */
  private publishLive(force = false) {
    const share = this.ui.data.sharePlot;
    const ghosts = share ? Object.fromEntries([...this.testMoves].map(([id, m]) => [id, m.to])) : {};
    const ruler = share ? this.ruler : null;
    const any = !!ruler || Object.keys(ghosts).length > 0;
    if (!any && !this.liveSent && !force) return;
    this.liveSent = any;
    this.client.setLive({ ruler, ghosts });
  }

  private afterTestChange() {
    if (this.ui.data.testCount !== this.testMoves.size) this.ui.set({ testCount: this.testMoves.size });
    this.ghostsDirty = true;
    this.publishLive();
    this.invalidate();
  }

  /** Try a token out at `to` without moving it for anyone else. */
  private setTest(id: string, to: Vec) {
    const v = this.views.get(id);
    if (!v) return;
    const cur = this.testMoves.get(id);
    const from = cur?.from ?? { x: v.token.x, y: v.token.y };
    if (Math.hypot(to.x - from.x, to.y - from.y) < 1) { this.testMoves.delete(id); v.testPos = null; v.target = { ...from }; }
    else { this.testMoves.set(id, { from, to: { ...to } }); v.testPos = { ...to }; v.target = { ...to }; }
  }

  /** Make every test move real (one undo step). */
  keepTestMoves() {
    if (!this.testMoves.size) return;
    const moves = [...this.testMoves].map(([id, m]) => ({ id, x: m.to.x, y: m.to.y }));
    const before = [...this.testMoves].map(([id, m]) => ({ id, x: m.from.x, y: m.from.y }));
    for (const id of this.testMoves.keys()) { const v = this.views.get(id); if (v) v.testPos = null; }
    this.testMoves.clear();
    void this.client.moveTokens(moves, before);
    this.afterTestChange();
    this.cb.onNotice(moves.length > 1 ? 'Moves made' : 'Move made', 'ok');
  }

  /** Put every tried-out token back where it was. */
  resetTestMoves() {
    if (!this.testMoves.size) return;
    for (const [id, m] of this.testMoves) { const v = this.views.get(id); if (v) { v.testPos = null; v.target = { ...m.from }; } }
    this.testMoves.clear();
    this.afterTestChange();
  }

  // ------------------------------------------------------------------ grid
  private visibleRect(): Rect {
    const w = this.host.clientWidth / this.cam.zoom;
    const h = this.host.clientHeight / this.cam.zoom;
    return { x: -this.cam.tx / this.cam.zoom, y: -this.cam.ty / this.cam.zoom, w, h };
  }

  private drawGrid() {
    const g = this.gridG;
    g.clear();
    const meta = this.client.scene?.meta;
    if (!meta || !meta.grid.visible) return;
    const { cell, ox, oy, color, opacity } = meta.grid;
    if (cell * this.cam.zoom < 5) return;
    const area = meta.mapW > 0 ? mapRect(meta) : { x: 0, y: 0, w: 2000, h: 1500 };
    const vis = this.visibleRect();
    const x0 = Math.max(area.x, vis.x);
    const x1 = Math.min(area.x + area.w, vis.x + vis.w);
    const y0 = Math.max(area.y, vis.y);
    const y1 = Math.min(area.y + area.h, vis.y + vis.h);
    if (x1 <= x0 || y1 <= y0) return;
    for (let i = Math.ceil((x0 - ox) / cell); ox + i * cell <= x1; i++) g.moveTo(ox + i * cell, y0).lineTo(ox + i * cell, y1);
    for (let j = Math.ceil((y0 - oy) / cell); oy + j * cell <= y1; j++) g.moveTo(x0, oy + j * cell).lineTo(x1, oy + j * cell);
    g.stroke({ width: 1.25 / this.cam.zoom, color: num(color), alpha: opacity });
  }

  // ------------------------------------------------------------------ fog
  private updateFog() {
    const meta = this.client.scene?.meta;
    if (!meta || !meta.fog.enabled) { if (this.fogSprite) this.fogSprite.visible = false; this.dirty = true; return; }
    const rect = meta.mapW > 0 ? mapRect(meta) : { x: 0, y: 0, w: 2000, h: 1500 };
    const changed = this.fogMask.sync(this.client.fogOpsSorted(), meta.fog, rect);
    const sizeKey = `${this.fogMask.canvas.width}x${this.fogMask.canvas.height}`;
    if (!this.fogSprite) {
      this.fogSprite = new Sprite(Texture.EMPTY);
      this.fogLayer.addChild(this.fogSprite);
    }
    if (sizeKey !== this.fogTexSize || this.fogSprite.texture === Texture.EMPTY) {
      const old = this.fogSprite.texture;
      this.fogSprite.texture = canvasTexture(this.fogMask.canvas);
      if (old !== Texture.EMPTY) old.destroy(true);
      this.fogTexSize = sizeKey;
    } else if (changed) {
      this.fogSprite.texture.source.update();
    }
    const m = this.fogMask;
    this.fogSprite.position.set(m.origin.x, m.origin.y);
    this.fogSprite.scale.set(1 / m.scale);
    this.fogSprite.alpha = this.client.isDM && !this.ui.data.dmPreview ? 0.5 : 1;
    this.fogSprite.visible = true;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ pings
  private addPing(p: Ping) {
    const g = new Graphics();
    const label = new Text({
      text: p.name,
      style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fontSize: 14, fill: num(p.color), stroke: { color: 0x000000, width: 4, join: 'round' } },
    });
    label.anchor.set(0.5, 1);
    this.fxLayer.addChild(g, label);
    this.pings.push({ g, label, born: performance.now(), x: p.x, y: p.y, color: num(p.color) });
    this.dirty = true;
  }

  private tickPings() {
    const now = performance.now();
    const z = this.cam.zoom;
    const cell = this.client.grid.cell;
    this.pings = this.pings.filter((p) => {
      const age = (now - p.born) / 1000;
      if (age > 3) { p.g.destroy(); p.label.destroy(); return false; }
      p.g.clear();
      for (let i = 0; i < 3; i++) {
        const ph = (age - i * 0.35) / 1.1;
        if (ph < 0 || ph > 1) continue;
        const r = cell * (0.25 + 1.5 * (1 - (1 - ph) ** 2));
        p.g.circle(p.x, p.y, r).stroke({ width: 3 / z, color: p.color, alpha: 1 - ph });
      }
      if (age < 2.2) p.g.circle(p.x, p.y, 5 / z).fill({ color: p.color, alpha: Math.min(1, 2.4 - age) });
      p.label.position.set(p.x, p.y - cell * 0.35);
      p.label.scale.set(1 / z);
      p.label.alpha = Math.min(1, 3 - age);
      return true;
    });
  }

  // ------------------------------------------------------------------ overlay (selection, rubber bands)
  private drawOverlay() {
    const g = this.overlayG;
    g.clear();
    this.distText.visible = false;
    for (const t of this.plotLabels) t.visible = false;
    const z = this.cam.zoom;
    const lw = 2.5 / z;
    const grid = this.client.grid;

    if (this.press) {
      const k = Math.min(1, (performance.now() - this.press.t0) / PRESS_PING_MS);
      if (k > 0.25) {
        const col = num(this.client.me?.color ?? '#ffffff');
        g.circle(this.press.w.x, this.press.w.y, 6 / z).fill({ color: col, alpha: 0.9 });
        g.arc(this.press.w.x, this.press.w.y, (10 + 14 * k) / z, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ width: 3 / z, color: col, alpha: 0.9 });
      }
    }

    for (const id of this.ui.data.selection) {
      const v = this.views.get(id);
      if (!v) continue;
      const t = v.token;
      const r = (t.size * grid.cell) / 2 + 3 / z;
      if (t.shape === 'circle') g.circle(v.display.x, v.display.y, r).stroke({ width: lw, color: SELECT });
      else g.rect(v.display.x - r, v.display.y - r, r * 2, r * 2).stroke({ width: lw, color: SELECT });
    }

    const meta = this.client.scene?.meta;
    if (this.ui.data.mapSelected && meta && meta.mapW) {
      const r = mapRect(meta);
      g.rect(r.x, r.y, r.w, r.h).stroke({ width: lw, color: SELECT });
    }

    const d = this.drag;
    if (d?.kind === 'marquee') {
      const r = normRect(d.start, d.cur);
      g.rect(r.x, r.y, r.w, r.h).fill({ color: SELECT, alpha: 0.12 }).stroke({ width: 1.5 / z, color: SELECT });
    }
    if (d?.kind === 'rect') {
      const r = normRect(d.start, d.cur);
      const tool = this.ui.data.tool;
      const col = tool === 'grid' ? 0xffd43b : this.ui.data.fogMode === 'r' ? 0x69db7c : 0xff6b6b;
      g.rect(r.x, r.y, r.w, r.h).fill({ color: col, alpha: 0.18 }).stroke({ width: 2 / z, color: col });
    }
    if (d?.kind === 'tokens' && d.moved) {
      const a = this.views.get(d.anchor);
      const o = this.testMoves.get(d.anchor)?.from ?? d.origins.get(d.anchor);
      if (a && o) {
        g.moveTo(o.x, o.y).lineTo(a.display.x, a.display.y).stroke({ width: 2 / z, color: 0xffffff, alpha: 0.7 });
        const ft = distanceFt(grid, o, a.display);
        this.distText.text = `${ft} ft`;
        this.distText.scale.set(1 / z);
        this.distText.position.set(a.display.x, a.display.y - (a.token.size * grid.cell) / 2 - 6 / z);
        this.distText.visible = true;
      }
    }

    if (this.ui.data.tool === 'fog') this.drawFogPreview(g, z);
    this.drawPlots(g, z);
  }

  // ------------------------------------------------------------------ drawing previews, rulers, test-move lines
  private plotLabel(i: number, text: string, x: number, y: number, color: number) {
    let t = this.plotLabels[i];
    if (!t) {
      t = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fontSize: 16, fill: 0xffffff, stroke: { color: 0x000000, width: 4, join: 'round' } } });
      t.anchor.set(0.5, 1);
      this.fxLayer.addChild(t);
      this.plotLabels[i] = t;
    }
    t.text = text;
    t.style.fill = color;
    t.resolution = this.textRes;
    t.scale.set(1 / this.cam.zoom);
    t.position.set(x, y);
    t.visible = true;
  }

  private paintRuler(g: Graphics, z: number, r: { a: Vec; b: Vec }, color: number, name: string, li: number) {
    const grid = this.client.grid;
    g.moveTo(r.a.x, r.a.y).lineTo(r.b.x, r.b.y).stroke({ width: 6 / z, color: 0x000000, alpha: 0.35, cap: 'round' });
    g.moveTo(r.a.x, r.a.y).lineTo(r.b.x, r.b.y).stroke({ width: 3 / z, color, cap: 'round' });
    g.circle(r.a.x, r.a.y, 6 / z).fill(color).stroke({ width: 2 / z, color: 0xffffff });
    g.circle(r.b.x, r.b.y, 6 / z).fill(color).stroke({ width: 2 / z, color: 0xffffff });
    const ft = distanceFt(grid, r.a, r.b);
    this.plotLabel(li, `${name ? name + ': ' : ''}${ft} ft`, r.b.x, r.b.y - 12 / z, color);
  }

  private drawPlots(g: Graphics, z: number) {
    const c = this.client;
    const scene = c.scene;
    if (!scene) return;
    const grid = c.grid;
    const u = this.ui.data;
    const d = this.drag;
    let li = 0;

    // outlines around selected drawings (shifted while they are being dragged)
    for (const id of u.drawSel) {
      const dd = scene.draws.get(id);
      if (!dd) continue;
      const b = this.drawLayer.boundsOf(dd, grid);
      const mv = d?.kind === 'drawmove' && d.ids.includes(id) ? d : null;
      const pad = 5 / z;
      g.rect(b.x - pad + (mv?.dx ?? 0), b.y - pad + (mv?.dy ?? 0), b.w + pad * 2, b.h + pad * 2).stroke({ width: 1.5 / z, color: SELECT });
    }

    // the shape being dragged out
    if (d?.kind === 'shape') {
      const isT = isTemplate(d.dk);
      paintShape(g, {
        k: d.dk, pts: d.pts, color: u.drawColor, w: isT ? Math.max(2, this.strokePx()) : this.strokePx(),
        fill: !isT && (d.dk === 'rect' || d.dk === 'ellipse') && u.drawFill ? 0.3 : 0, dash: !isT && u.drawDash, bw: u.tplWidth,
      }, grid, 0.85);
      if (isT && d.pts.length >= 2) this.plotLabel(li++, templateLabel(d.dk, grid, d.pts[0], d.pts[1], u.tplWidth), d.pts[1].x, d.pts[1].y - 12 / z, num(u.drawColor));
    }

    // an erase swipe
    if (d?.kind === 'erase' && this.pointerW) g.circle(this.pointerW.x, this.pointerW.y, 6 / z).stroke({ width: 1.5 / z, color: 0xff6b6b });

    // my ruler, then everybody else's
    const myCol = num(c.me?.color ?? '#ffffff');
    if (this.ruler) this.paintRuler(g, z, this.ruler, myCol, '', li++);
    for (const [uid, lv] of scene.live) {
      if (uid === c.uid) continue;
      const p = c.players.get(uid);
      const col = num(p?.color ?? '#ffffff');
      if (lv.ruler) this.paintRuler(g, z, lv.ruler, col, p?.name ?? '', li++);
      for (const [id, pos] of Object.entries(lv.ghosts)) {
        const t = scene.tokens.get(id);
        if (!t || !this.visibleToViewer(t)) continue;
        this.dashedLine(g, { x: t.x, y: t.y }, pos, col, z);
        li = this.testLabel(li, { x: t.x, y: t.y }, pos, t, col, p?.name ?? '');
      }
    }

    // my test moves: a dashed line from where the token really is to where I am trying it
    for (const [id, m] of this.testMoves) {
      if (d?.kind === 'tokens' && d.moved && d.ids.includes(id)) continue; // the live drag draws its own
      const t = scene.tokens.get(id);
      if (!t) continue;
      this.dashedLine(g, m.from, m.to, 0xffffff, z);
      li = this.testLabel(li, m.from, m.to, t, 0xffffff, '');
    }
  }

  private dashedLine(g: Graphics, a: Vec, b: Vec, color: number, z: number) {
    for (const [p, q] of dashSegments([a, b], 9 / z, 6 / z)) g.moveTo(p.x, p.y).lineTo(q.x, q.y);
    g.stroke({ width: 2.5 / z, color, alpha: 0.9, cap: 'round' });
  }

  private testLabel(li: number, from: Vec, to: Vec, t: Token, color: number, name: string): number {
    const grid = this.client.grid;
    this.plotLabel(li, `${name ? name + ': ' : ''}${distanceFt(grid, from, to)} ft`, to.x, to.y - (t.size * grid.cell) / 2 - 6 / this.cam.zoom, color);
    return li + 1;
  }

  private drawFogPreview(g: Graphics, z: number) {
    const col = this.ui.data.fogMode === 'r' ? 0x69db7c : 0xff6b6b;
    const cell = this.client.grid.cell;
    if (this.ui.data.fogShape === 'poly' && this.polyPts.length) {
      const pts = [...this.polyPts, ...(this.pointerW ? [this.pointerW] : [])];
      if (pts.length >= 3) g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: col, alpha: 0.15 });
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke({ width: 2 / z, color: col });
      for (const p of this.polyPts) g.circle(p.x, p.y, 4 / z).fill(col);
    }
    if (this.ui.data.fogShape === 'brush' && this.pointerW) {
      const w = this.ui.data.brushSize * cell;
      if (this.drag?.kind === 'brush') {
        const pts = this.drag.pts;
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.stroke({ width: w, color: col, alpha: 0.25, cap: 'round', join: 'round' });
      }
      g.circle(this.pointerW.x, this.pointerW.y, w / 2).stroke({ width: 2 / z, color: col });
    }
  }

  // ------------------------------------------------------------------ input
  private cleanupInput: (() => void)[] = [];

  private bindInput(canvas: HTMLCanvasElement) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, opts);
      this.cleanupInput.push(() => el.removeEventListener(type, fn, opts));
    };
    on(canvas, 'pointerdown', (e: PointerEvent) => this.onPointerDown(e));
    on(canvas, 'pointermove', (e: PointerEvent) => this.onPointerMove(e));
    on(canvas, 'pointerup', (e: PointerEvent) => this.onPointerUp(e));
    on(canvas, 'pointercancel', (e: PointerEvent) => this.onPointerUp(e));
    on(canvas, 'pointerleave', () => { this.pointerW = null; this.invalidate(); });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(canvas, 'auxclick', (e: Event) => e.preventDefault());
    on(canvas, 'dblclick', () => this.onDoubleClick());
    on(canvas, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e));
    on(window, 'keyup', (e: KeyboardEvent) => { if (e.code === 'Space') { this.spaceDown = false; this.updateCursor(); } });
    on(window, 'blur', () => { this.spaceDown = false; });
  }

  private updateCursor(hover?: boolean) {
    const c = this.app.canvas;
    const d = this.drag;
    if (d?.kind === 'pan' || d?.kind === 'tokens') c.style.cursor = 'grabbing';
    else if (this.spaceDown) c.style.cursor = 'grab';
    else if (this.ui.data.tool !== 'select') c.style.cursor = 'crosshair';
    else c.style.cursor = hover ? 'grab' : 'default';
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.app.canvas.getBoundingClientRect();
    // trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels send ~100 per notch
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0016));
    this.cam = zoomAt(this.cam, e.clientX - r.left, e.clientY - r.top, factor);
    this.applyCamera();
  }

  private onPointerDown(e: PointerEvent) {
    this.app.canvas.focus({ preventScroll: true });
    const canvas = this.app.canvas;
    const w = this.screenToWorld(e.clientX, e.clientY);
    this.pointerW = w;

    if (e.button === 1) e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: this.cam.tx, ty: this.cam.ty, moved: false, button: e.button };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;

    const tool = this.ui.data.tool;
    if (tool === 'grid' && this.client.isDM) { this.drag = { kind: 'rect', start: w, cur: w }; return; }
    if (tool === 'fog' && this.client.isDM) { this.startFog(w, e); return; }
    if (tool === 'draw') { this.startDraw(w, e); return; }
    if (tool === 'template') { this.startTemplate(w, e); return; }
    if (tool === 'ruler') { this.startRuler(w, e); return; }

    // ---- select tool
    const hit = this.hitToken(w);
    if (hit) {
      let sel = new Set(this.ui.data.selection);
      if (e.shiftKey) {
        if (sel.has(hit.id)) { sel.delete(hit.id); this.ui.select(sel); return; }
        sel.add(hit.id);
      } else if (!sel.has(hit.id)) sel = new Set([hit.id]);
      this.ui.select(sel);
      const movable = [...sel].filter((id) => {
        const t = this.client.scene?.tokens.get(id);
        return !!t && this.client.canDo('move', t);
      });
      if (movable.length) {
        const origins = new Map<string, Vec>();
        for (const id of movable) { const v = this.views.get(id)!; origins.set(id, { ...v.display }); v.dragging = true; }
        const anchor = movable.includes(hit.id) ? hit.id : movable[0];
        this.drag = { kind: 'tokens', ids: movable, anchor, start: w, origins, moved: false };
        this.updateCursor();
      }
      this.startPress(w, e);
      return;
    }
    const dh = this.hitDrawingAt(w, false);
    if (dh) {
      let sel = new Set(this.ui.data.drawSel);
      if (e.shiftKey) {
        if (sel.has(dh.id)) sel.delete(dh.id); else sel.add(dh.id);
        this.ui.selectDrawings(sel);
        return;
      }
      if (!sel.has(dh.id)) sel = new Set([dh.id]);
      this.ui.selectDrawings(sel);
      this.drag = { kind: 'drawmove', ids: [...sel], start: w, dx: 0, dy: 0, moved: false };
      this.startPress(w, e);
      return;
    }
    const meta = this.client.scene?.meta;
    if (this.client.isDM && meta && !meta.mapLocked && meta.mapW && rectContains(mapRect(meta), w)) {
      this.ui.set({ mapSelected: true, selection: new Set(), drawSel: new Set() });
      this.drag = { kind: 'map', start: w, orig: { x: meta.mapX, y: meta.mapY }, moved: false };
      this.startPress(w, e);
      return;
    }
    const base = e.shiftKey ? new Set(this.ui.data.selection) : new Set<string>();
    if (!e.shiftKey) { this.ui.select([]); this.ui.selectDrawings([]); }
    this.drag = { kind: 'marquee', start: w, cur: w, base };
    this.startPress(w, e);
  }

  /** Holding the left button still for a moment pings that spot. Moving more than a few pixels turns it into a normal drag. */
  private startPress(w: Vec, e: PointerEvent) {
    if (!this.client.canDo('ping')) return;
    this.cancelPress();
    this.press = {
      x: e.clientX, y: e.clientY, w, t0: performance.now(),
      timer: window.setTimeout(() => {
        const p = this.press;
        if (!p) return;
        this.press = null;
        const d = this.drag;
        if (d?.kind === 'marquee') this.drag = null;
        else if (d?.kind === 'tokens' || d?.kind === 'map' || d?.kind === 'drawmove') {
          if (d.moved) return;
          if (d.kind === 'tokens') for (const id of d.ids) { const v = this.views.get(id); if (v) v.dragging = false; }
          this.drag = null;
          this.updateCursor();
        }
        void this.client.ping(p.w.x, p.w.y);
        this.invalidate();
      }, PRESS_PING_MS),
    };
  }

  // ------------------------------------------------------------------ drawing, templates, ruler
  private strokePx(): number {
    return Math.max(1.5, STROKE_CELLS[this.ui.data.drawSize] * this.client.grid.cell);
  }

  private hitDrawingAt(p: Vec, solid: boolean): Drawing | null {
    const list = this.client.drawingsSorted();
    const tol = 6 / this.cam.zoom;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (this.client.canEditDrawing(d) && hitDrawing(d, p, tol, this.client.grid, solid)) return d;
    }
    return null;
  }

  private startDraw(w: Vec, e: PointerEvent) {
    if (!this.client.canDo('draw')) { this.cb.onNotice('Drawing is turned off for players.', 'error'); return; }
    const tool = this.ui.data.drawTool;
    if (tool === 'text') { this.ui.set({ textAt: { sx: e.clientX, sy: e.clientY, x: w.x, y: w.y } }); return; }
    if (tool === 'erase') { this.drag = { kind: 'erase', ids: new Set() }; this.eraseAt(w); return; }
    this.drag = { kind: 'shape', dk: tool, start: w, pts: tool === 'pen' ? [w] : [w, w] };
  }

  private startTemplate(w: Vec, e: PointerEvent) {
    if (!this.client.canDo('draw')) { this.cb.onNotice('Drawing is turned off for players.', 'error'); return; }
    const grid = this.client.grid;
    const a = grid.snap && !e.altKey ? snapToCorner(grid, w) : w;
    this.drag = { kind: 'shape', dk: this.ui.data.tplKind, start: a, pts: [a, a] };
  }

  private startRuler(w: Vec, e: PointerEvent) {
    if (!this.client.canDo('measure')) { this.cb.onNotice('The ruler is turned off for players.', 'error'); return; }
    const p = this.rulerPoint(w, e);
    this.ruler = { a: p, b: p };
    this.drag = { kind: 'ruler' };
    this.publishLive();
  }

  private rulerPoint(w: Vec, e: PointerEvent): Vec {
    const g = this.client.grid;
    return g.snap && !e.altKey ? snapToCellCenter(g, w) : w;
  }

  private eraseAt(w: Vec) {
    const d = this.drag;
    if (d?.kind !== 'erase') return;
    const hit = this.hitDrawingAt(w, true);
    if (hit && !d.ids.has(hit.id)) { d.ids.add(hit.id); this.drawLayer.setFaded(d.ids); this.invalidate(); }
  }

  private moveShape(d: Extract<Drag, { kind: 'shape' }>, w: Vec, e: PointerEvent) {
    const k = d.dk;
    if (isTemplate(k)) {
      const sn = snapTemplate(this.client.grid, d.start, w, { origin: false, length: !e.altKey, angleStep: e.shiftKey ? Math.PI / 12 : undefined });
      d.pts = [sn.a, sn.b];
      return;
    }
    if (k === 'pen') {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(last.x - w.x, last.y - w.y) * this.cam.zoom > 2) d.pts.push(w);
      return;
    }
    let b = w;
    if (e.shiftKey) {
      const dx = w.x - d.start.x;
      const dy = w.y - d.start.y;
      if (k === 'rect' || k === 'ellipse') {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        b = { x: d.start.x + (dx < 0 ? -m : m), y: d.start.y + (dy < 0 ? -m : m) };
      } else {
        const L = Math.hypot(dx, dy);
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
        b = { x: d.start.x + Math.cos(ang) * L, y: d.start.y + Math.sin(ang) * L };
      }
    }
    d.pts = [d.start, b];
  }

  private commitShape(d: Extract<Drag, { kind: 'shape' }>) {
    const u = this.ui.data;
    const grid = this.client.grid;
    const k = d.dk;
    const isT = isTemplate(k);
    let pts = d.pts;
    const len = pts.length >= 2 ? Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) : 0;
    if (isT) { if (len < grid.cell * 0.4) return; }
    else if (k === 'pen') { if (pts.length > 2) pts = fitPenPoints(pts, Math.max(0.6, 1 / this.cam.zoom)); }
    else if (len * this.cam.zoom < 4) return;
    const stroke = this.strokePx();
    void this.client.addDrawing({
      k, p: joinPts(pts), color: u.drawColor, w: isT ? Math.max(2, stroke) : stroke,
      fill: !isT && (k === 'rect' || k === 'ellipse') && u.drawFill ? 0.3 : 0,
      dash: !isT && u.drawDash, txt: '', fs: 28, bw: u.tplWidth,
    }).catch((err: Error) => this.cb.onNotice(err.message, 'error'));
  }

  /** Put a line of text on the map (called when the text box is confirmed). */
  addText(at: Vec, text: string) {
    const t = text.trim();
    if (!t) return;
    const cell = this.client.grid.cell;
    const u = this.ui.data;
    const fs = Math.round(cell * (u.drawSize === 'thin' ? 0.32 : u.drawSize === 'thick' ? 0.7 : 0.45));
    void this.client.addDrawing({ k: 'text', p: joinPts([at]), color: u.drawColor, w: 1, fill: 0, dash: false, txt: t, fs, bw: 5 })
      .catch((err: Error) => this.cb.onNotice(err.message, 'error'));
  }

  worldFromClient(clientX: number, clientY: number): Vec { return this.screenToWorld(clientX, clientY); }

  private cancelPress() {
    if (this.press) { clearTimeout(this.press.timer); this.press = null; }
  }

  private startFog(w: Vec, e: PointerEvent) {
    const shape = this.ui.data.fogShape;
    if (shape === 'rect') this.drag = { kind: 'rect', start: w, cur: w };
    else if (shape === 'brush') this.drag = { kind: 'brush', pts: [w] };
    else {
      // polygon: click to add points, click near the first point (or double-click / Enter) to finish
      if (this.polyPts.length >= 3) {
        const first = this.polyPts[0];
        if (Math.hypot(first.x - w.x, first.y - w.y) * this.cam.zoom < 12) { this.finishPoly(); return; }
      }
      this.polyPts.push(w);
      this.invalidate();
    }
    void e;
  }

  private finishPoly() {
    const pts = this.polyPts;
    this.polyPts = [];
    if (pts.length >= 3) void this.client.addFogOp(polyOp(this.ui.data.fogMode, pts));
    this.invalidate();
  }

  private onDoubleClick() {
    if (this.ui.data.tool === 'fog' && this.ui.data.fogShape === 'poly' && this.polyPts.length >= 3) {
      this.polyPts.pop(); // the second click of the double-click added a duplicate point
      this.finishPoly();
    }
  }

  private onPointerMove(e: PointerEvent) {
    const w = this.screenToWorld(e.clientX, e.clientY);
    this.pointerW = w;
    if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 6) this.cancelPress();
    const d = this.drag;
    if (!d) {
      const hover = this.ui.data.tool === 'select' && !!this.hitToken(w);
      this.updateCursor(hover);
      if (this.ui.data.tool !== 'select') this.invalidate();
      return;
    }
    this.invalidate();
    switch (d.kind) {
      case 'pan': {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (d.moved) { this.cam.tx = d.tx + dx; this.cam.ty = d.ty + dy; this.applyCamera(); }
        break;
      }
      case 'tokens': this.dragTokens(d, w, e); break;
      case 'marquee': {
        d.cur = w;
        const r = normRect(d.start, w);
        const inside = [...this.views.values()].filter((v) => rectContains(r, v.display)).map((v) => v.token.id);
        this.ui.select([...d.base, ...inside]);
        break;
      }
      case 'rect': d.cur = w; break;
      case 'shape': this.moveShape(d, w, e); break;
      case 'erase': this.eraseAt(w); break;
      case 'ruler': if (this.ruler) { this.ruler.b = this.rulerPoint(w, e); this.publishLive(); } break;
      case 'drawmove': {
        const dx = w.x - d.start.x;
        const dy = w.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * this.cam.zoom < 4) break;
        d.moved = true; d.dx = dx; d.dy = dy;
        this.drawLayer.setOffset(new Set(d.ids), dx, dy);
        break;
      }
      case 'brush': {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(last.x - w.x, last.y - w.y) > this.client.grid.cell / 8) d.pts.push(w);
        break;
      }
      case 'map': {
        const dx = w.x - d.start.x;
        const dy = w.y - d.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 2 / this.cam.zoom) d.moved = true;
        if (d.moved && this.mapSprite) {
          const nx = d.orig.x + dx;
          const ny = d.orig.y + dy;
          this.mapSprite.position.set(nx, ny);
          this.sendMap(nx, ny);
          this.gridDirty = true;
        }
        break;
      }
    }
  }

  private dragTokens(d: Extract<Drag, { kind: 'tokens' }>, w: Vec, e: PointerEvent) {
    let dx = w.x - d.start.x;
    let dy = w.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) * this.cam.zoom < 4) return;
    d.moved = true;
    const grid = this.client.grid;
    const anchorV = this.views.get(d.anchor);
    const anchorO = d.origins.get(d.anchor);
    if (anchorV && anchorO && grid.snap && !e.altKey) {
      const snapped = snapTokenCenter(grid, anchorV.token.size, { x: anchorO.x + dx, y: anchorO.y + dy });
      dx = snapped.x - anchorO.x;
      dy = snapped.y - anchorO.y;
    }
    const moves: { id: string; x: number; y: number }[] = [];
    for (const id of d.ids) {
      const v = this.views.get(id);
      const o = d.origins.get(id);
      if (!v || !o) continue;
      v.display = { x: o.x + dx, y: o.y + dy };
      v.target = { ...v.display };
      moves.push({ id, x: v.display.x, y: v.display.y });
    }
    if (!this.ui.data.testMove) this.sendMoves(moves);
  }

  private onPointerUp(e: PointerEvent) {
    this.cancelPress();
    const d = this.drag;
    this.drag = null;
    try { this.app.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    this.updateCursor();
    this.invalidate();
    if (!d) return;
    switch (d.kind) {
      case 'pan':
        if (!d.moved && d.button === 2) {
          const w = this.screenToWorld(e.clientX, e.clientY);
          const hit = this.hitToken(w);
          if (hit && !this.ui.data.selection.has(hit.id)) this.ui.select([hit.id]);
          this.cb.onContextMenu({ clientX: e.clientX, clientY: e.clientY, tokenId: hit?.id ?? null, world: w });
        }
        break;
      case 'tokens': {
        this.sendMoves.cancel();
        if (this.ui.data.testMove) {
          for (const id of d.ids) {
            const v = this.views.get(id);
            if (!v) continue;
            v.dragging = false;
            if (d.moved) this.setTest(id, { ...v.display });
          }
          if (d.moved) this.afterTestChange();
          break;
        }
        const moves: { id: string; x: number; y: number }[] = [];
        const before: { id: string; x: number; y: number }[] = [];
        for (const id of d.ids) {
          const v = this.views.get(id);
          if (!v) continue;
          v.dragging = false;
          const o = d.origins.get(id);
          if (d.moved) { moves.push({ id, x: v.display.x, y: v.display.y }); if (o) before.push({ id, x: o.x, y: o.y }); }
        }
        if (moves.length) void this.client.moveTokens(moves, before);
        break;
      }
      case 'rect': {
        const r = normRect(d.start, d.cur);
        if (r.w * this.cam.zoom < 6 || r.h * this.cam.zoom < 6) break;
        if (this.ui.data.tool === 'grid') this.cb.onGridRect(r, gridFromRect(r));
        else void this.client.addFogOp(rectOp(this.ui.data.fogMode, r));
        break;
      }
      case 'brush':
        void this.client.addFogOp(lineOp(this.ui.data.fogMode, d.pts, this.ui.data.brushSize * this.client.grid.cell));
        break;
      case 'map':
        this.sendMap.flush();
        break;
      case 'shape': this.commitShape(d); break;
      case 'erase':
        this.drawLayer.setFaded(new Set());
        if (d.ids.size) void this.client.removeDrawings([...d.ids]);
        break;
      case 'ruler':
        if (this.ruler && Math.hypot(this.ruler.b.x - this.ruler.a.x, this.ruler.b.y - this.ruler.a.y) * this.cam.zoom < 6) this.ruler = null;
        this.publishLive();
        break;
      case 'drawmove':
        this.drawLayer.setOffset(new Set(), 0, 0);
        if (d.moved) void this.client.moveDrawings(d.ids, d.dx, d.dy);
        break;
      case 'marquee': break;
    }
  }

  /** Ctrl+Z / Ctrl+Y (also used by the toolbar buttons). */
  async runHistory(dir: 'undo' | 'redo') {
    try {
      const label = await this.client.history[dir]();
      this.cb.onNotice(label ? `${dir === 'undo' ? 'Undid' : 'Redid'}: ${label}` : `Nothing to ${dir}`, 'info');
    } catch (err) {
      this.cb.onNotice(`Couldn't ${dir}: ${(err as Error).message}`, 'error');
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    // typing into a field is not a shortcut, but a ticked checkbox or a clicked button should not eat them
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (el && el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'color', 'file'].includes((el as HTMLInputElement).type)) return;
    const ui = this.ui;
    const c = this.client;
    const mod = e.ctrlKey || e.metaKey;

    if (e.code === 'Space') { this.spaceDown = true; this.updateCursor(); e.preventDefault(); return; }

    if (e.key === 'Escape') {
      if (this.testMoves.size) { this.resetTestMoves(); return; }
      if (ui.data.textAt) { ui.set({ textAt: null }); return; }
      this.polyPts = [];
      this.drag = null;
      for (const v of this.views.values()) v.dragging = false;
      ui.select([]);
      ui.selectDrawings([]);
      if (ui.data.tool !== 'select') ui.set({ tool: 'select' });
      this.invalidate();
      return;
    }
    if (e.key === 'Enter' && this.testMoves.size) { this.keepTestMoves(); return; }
    if (e.key === 'Enter' && ui.data.tool === 'fog' && this.polyPts.length >= 3) { this.finishPoly(); return; }

    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.data.drawSel.size) {
      void c.removeDrawings([...ui.data.drawSel]);
      ui.selectDrawings([]);
      e.preventDefault();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.data.selection.size) {
      const ids = [...ui.data.selection].filter((id) => c.canDo('delete', c.scene?.tokens.get(id)));
      if (ids.length) { void c.removeTokens(ids); e.preventDefault(); }
      return;
    }
    if (mod && e.key.toLowerCase() === 'd' && ui.data.selection.size) {
      e.preventDefault();
      const ids = [...ui.data.selection].filter((id) => c.canDo('create'));
      void c.duplicateTokens(ids, c.grid.cell).then((n) => ui.select(n));
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      ui.select([...this.views.keys()]);
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); void this.runHistory(e.shiftKey ? 'redo' : 'undo'); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); void this.runHistory('redo'); return; }
    if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x') && ui.data.selection.size) {
      e.preventDefault();
      const n = c.copyTokens([...ui.data.selection]);
      if (n) this.cb.onNotice(`Copied ${n} token${n > 1 ? 's' : ''}`, 'info');
      if (e.key.toLowerCase() === 'x') {
        const ids = [...ui.data.selection].filter((id) => c.canDo('delete', c.scene?.tokens.get(id)));
        if (ids.length) void c.removeTokens(ids);
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      if (!c.clipboardCount) return;
      if (!c.canDo('create')) { this.cb.onNotice('You are not allowed to add tokens.', 'error'); return; }
      void c.pasteTokens(this.pointerW ?? this.viewCenterWorld()).then((ids) => { if (ids.length) ui.select(ids); });
      return;
    }
    if (mod) return;

    if (e.key.startsWith('Arrow') && ui.data.selection.size) {
      e.preventDefault();
      const step = c.grid.cell * (e.shiftKey ? 1 : 1);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const moves = [...ui.data.selection]
        .map((id) => c.scene?.tokens.get(id))
        .filter((t): t is Token => !!t && c.canDo('move', t))
        .map((t) => ({ id: t.id, x: t.x + dx, y: t.y + dy }));
      if (moves.length && ui.data.testMove) {
        for (const m of moves) {
          const v = this.views.get(m.id);
          const cur = this.testMoves.get(m.id)?.to ?? (v ? { x: v.token.x, y: v.token.y } : null);
          if (cur) this.setTest(m.id, { x: cur.x + dx, y: cur.y + dy });
        }
        this.afterTestChange();
      } else if (moves.length) {
        const before = moves.map((m) => { const t = c.scene!.tokens.get(m.id)!; return { id: t.id, x: t.x, y: t.y }; });
        void c.moveTokens(moves, before);
      }
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'v': ui.set({ tool: 'select' }); break;
      case 'g': if (c.isDM) ui.set({ tool: ui.data.tool === 'grid' ? 'select' : 'grid' }); break;
      case 'f': if (c.isDM) ui.set({ tool: ui.data.tool === 'fog' ? 'select' : 'fog' }); break;
      case 'd': ui.set({ tool: ui.data.tool === 'draw' ? 'select' : 'draw' }); break;
      case 's': ui.set({ tool: ui.data.tool === 'template' ? 'select' : 'template' }); break;
      case 'r': ui.set({ tool: ui.data.tool === 'ruler' ? 'select' : 'ruler' }); break;
      case 'm': ui.set({ testMove: !ui.data.testMove }); break;
      case '0': this.fit(); break;
      case '+': case '=': this.zoomBy(1.25); break;
      case '-': this.zoomBy(0.8); break;
    }
    this.polyPts = ui.data.tool === 'fog' ? this.polyPts : [];
  }
}
