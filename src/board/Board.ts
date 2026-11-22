import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  clamp, distanceFt, fitCamera, pathFt, gridFromRect, mapRect, normRect, sceneRect, pointInToken, rectContains, snapTokenCenter, snapToCellCenter, snapToCorner, zoomAt,
} from '../core/geometry';
import { FILL_LEVEL, STROKE_CELLS, beamWidthPx, dashSegments, fitPenPoints, handlesOf, hitDrawing, pointInPoly, isTemplate, joinPts, resizeDrawing, setLineMeasurer, footprintPx, snapTemplate, templateLabel, templateWidthPx, type HandleId, type TemplateSnapState } from '../core/draw';
import { FogMask, lineOp, polyOp, rectOp } from '../core/fog';
import { hexCentersIn, hexCorners, hexNudge, isHex } from '../core/hex';
import { altitudeOf, groundAt, heightChangeNote, heightNote, isRough, roughOf, setAltitude, zoneColor, zonesOf, type Altitude } from '../core/height';
import { DEFAULT_CLIFF_FT, cliffSegs, rampCells, walkExtra, walkNote, type WalkExtra } from '../core/walk';
import { EMPTY_TERRAIN, MAX_STROKE_CELLS, areaAt, areaLabelAt, areasSelected, cellKey, cellsAlong, heightColor, newAreaId, terrainBounds, type Area, type Terrain } from '../core/terrain';
import { MAX_COVERED, auraCells, cellCentersIn, cellPoly, outlineEdges } from '../core/cells';
import { scaleCut, type GridCut } from '../core/gridcut';
import { AUTO_GRID_STRENGTH, detectPrintedGrid, impliedGrid } from '../core/mapgrid';
import { lightOf, viewerOf, type LightSrc, type Viewer } from '../core/light';
import { LightLayer } from './LightLayer';
import { DEFAULT_GRID, MAX_VIA } from '../core/model';
import { pctOf, toPub, visionCircles, withoutLights } from '../core/combat';
import type { DrawingPatch, TableClient } from '../state/client';
import type { StrokeSize, UiState } from '../state/ui';
import type { Ambient, Aura, DrawKind, Drawing, GridSettings, Ping, Rect, Token, Vec } from '../types';
import { throttle } from '../core/throttle';
import { TokenView, isLightMark, type TokenCtx } from './TokenView';
import { DrawLayer, paintShape } from './DrawLayer';
import { TerrainLayer } from './TerrainLayer';
import { WallLayer } from './WallLayer';
import { WALL_NAME, boxSegments, chainSegments, circlePoints, distToSeg, endNear, freehandCorners, hatchTicks, moveSegs, pathBlocked, sightSegs, snapWallPoint, visibilityPolygon, wallMid, wallNear, wallVisDefault, type Seg, type Wall } from '../core/walls';
import { canvasTexture, loadTexture, releaseTexture, setTextureFailHandler, type LoadedTexture, gridlessTexture, readPixels } from './textures';
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
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean; button: number; noPan?: boolean }
  | { kind: 'tokens'; ids: string[]; anchor: string; start: Vec; origins: Map<string, Vec>; moved: boolean; /** how far the group has been let go so far (walls can hold it back) */ cur?: Vec }
  | { kind: 'marquee'; start: Vec; cur: Vec; base: Set<string> }
  | { kind: 'rect'; start: Vec; cur: Vec }
  | { kind: 'brush'; pts: Vec[] }
  | { kind: 'map'; start: Vec; orig: Vec; moved: boolean }
  /** dragging one of the extra maps */
  | { kind: 'xmap'; id: string; start: Vec; orig: Vec; moved: boolean; cur: Vec }
  | { kind: 'shape'; dk: DrawKind; start: Vec; pts: Vec[]; /** set while drawing a height zone: its height in feet */ hz?: number;
      /** an emanation from a creature: where it comes out, and how wide that creature's space is in feet */ of?: number; fixedOrigin?: Vec;
      /** what the last template snap decided (so it only changes when the pointer clearly moves on) */ snap?: TemplateSnapState }
  | { kind: 'erase'; ids: Set<string> }
  /** painting (or rubbing out) ground with the Heights brush */
  /** a ramp being dragged out from its low (or high) end to the other */
  | { kind: 'ramp'; a: Vec; b: Vec }
  | { kind: 'terrain'; /** painting difficult ground instead of height */ rough?: boolean; erase: boolean; /** the area it paints into (empty: rub out of every area) */ group: string; h: number; add: boolean; /** the cells covered so far (null for a free brush) */ cells: Map<string, Vec> | null; pts: Vec[]; last: Vec; size: number }
  | { kind: 'ruler'; /** another leg added to a measurement that is already there */ extend?: boolean }
  /** drawing a wall (or a box of walls) with the Walls tool; `cont` when it carries on from the last wall */
  | { kind: 'wall'; a: Vec; b: Vec; down: Vec; moved: boolean; cont: boolean; shape: 'line' | 'box' | 'free' | 'circle'; /** the pointer's path (freehand walls) */ pts: Vec[] }
  /** dragging the end of a wall (and every other wall end that sits on the same spot) */
  | { kind: 'wallend'; moves: { id: string; end: 'a' | 'b' }[]; from: Vec; to: Vec; moved: boolean }
  /** dragging the selected walls */
  | { kind: 'wallmove'; ids: string[]; start: Vec; anchor: Vec; dx: number; dy: number; moved: boolean }
  | { kind: 'wallbox'; start: Vec; cur: Vec; base: Set<string> }
  | { kind: 'drawmove'; ids: string[]; start: Vec; dx: number; dy: number; moved: boolean; /** ground being moved: it steps a whole cell at a time */ snap?: boolean }
  | { kind: 'drawresize'; id: string; handle: HandleId; orig: Drawing; patch: DrawingPatch | null };

/** a token being tried out: where it really is, the corners it turned at, and where the test has put it */
interface TestMove { from: Vec; to: Vec; via: Vec[] }
const NO_IDS: Set<string> = new Set();
const WALL_COLOR = { wall: 0xffd27a, door: 0xe8873a, window: 0x7fd8ff } as const;

const num = (c: string) => parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0xffffff;
const SELECT = 0x4da3ff;
const PRESS_PING_MS = 450;
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
  /** the extra maps, laid over the first one */
  private extraLayer = new Container();
  private extras = new Map<string, { url: string; sprite: Sprite }>();
  private extrasKey = '';
  private gridG = new Graphics();
  private tokenLayer = new Container();
  private fogLayer = new Container();
  private drawLayer = new DrawLayer();
  private terrainLayer = new TerrainLayer();
  /** difficult ground: a layer of its own, hatched on the map */
  private rough: Terrain = EMPTY_TERRAIN({ ...DEFAULT_GRID });
  private roughG = new Graphics();
  /** 0 (hidden) to 1 (fully shown): the ground fades in and out */
  private heightFade = 0;
  /** until when the ground stays on show without a drag (a keyboard step, say) */
  private heightsUntil = 0;
  private warmTimer = 0;
  private wallLayer = new WallLayer();
  private wallPreview: Map<string, { a: Vec; b: Vec }> | null = null;
  private wallPrevSeq = 0;
  private wallHover: string | null = null;
  /** where the wall being drawn carries on from (a click that has not been followed by a second point yet) */
  private wallStart: Vec | null = null;
  /** where the run of walls being drawn began, and how many it has so far (coming back to the start closes the loop) */
  private wallRunFirst: Vec | null = null;
  private wallRunCount = 0;
  private seenWallRev = -1;
  private segCache: { scene: unknown; rev: number; ground: string; sight: Seg[]; move: Seg[] } = { scene: null, rev: -1, ground: '', sight: [], move: [] };
  private auraG = new Graphics();
  private ghostLayer = new Container();
  private overlayG = new Graphics();
  private fxLayer = new Container();
  private plotLabels: Text[] = [];
  private ghostViews = new Map<string, TokenView>();
  /** token id -> the move being tried: where it really is, where it ends up, and the corners it turned at on the way (several steps) */
  private testMoves = new Map<string, TestMove>();
  /** what the test moves looked like before each step, so a right-click can go back one */
  private testHistory: Map<string, TestMove>[] = [];
  /** `via` are the corners between a and b (a measurement in several legs) */
  private ruler: { a: Vec; b: Vec; via: Vec[] } | null = null;
  private liveSent = false;
  private seenDrawRev = -1;
  private seenLiveRev = -1;
  private prevUi = { testMove: false, sharePlot: false, tool: 'select' as string, rulerColor: '', cover: true, heights: 'auto' as string, draft: null as unknown, sel: null as unknown };
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
  /** the map with its printed grid filled in (shown instead of the original while that is switched on) */
  private mapCutTex: Texture | null = null;
  private mapCutKey = '';
  private cutSeq = 0;

  private views = new Map<string, TokenView>();
  private fogMask = new FogMask();
  private fogSprite: Sprite | null = null;
  private fogTexSize = '';
  /** circles around tokens that can see, cut out of the fog */
  private visionG = new Graphics();
  private lightLayer = new LightLayer();
  /** which kind of hole-cutter the fog has now: none, the circles and shapes of what tokens see, or the lit shape used in the dark */
  private fogMaskKind: '' | 'g' | 's' = '';
  private seenInitRev = -1;

  private drag: Drag | null = null;
  private polyPts: Vec[] = [];
  /** the boxes and circles that give the ground a height, for every token's altitude */
  private zones: Terrain = EMPTY_TERRAIN({ ...DEFAULT_GRID });
  private seenZoneRev = -1;
  private pointerW: Vec | null = null;
  private spaceDown = false;
  /** holding the left button on empty space for a moment sends a ping */
  private press: { x: number; y: number; w: Vec; t0: number; timer: number } | null = null;
  /** a drawing shown with unsaved changes while its handle is being dragged */
  private drawPreview: { id: string; patch: DrawingPatch } | null = null;
  private dirty = true;
  private raf = 0;
  private lastT = 0;
  private pings: PingFx[] = [];
  private unsubs: (() => void)[] = [];
  private resizeObs?: ResizeObserver;
  private zoomSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private textRes = 2;
  private destroyed = false;
  private sendMoves: ReturnType<typeof throttle<[{ id: string; x: number; y: number }[], boolean]>>;
  /** Q is held (the DM teleporting): tokens being dragged jump instead of walking (they do not clear the ground between) */
  private teleportHeld = false;
  /** W A S D keys held down: the view pans while they are */
  private panKeys = new Set<string>();
  /** Alt was held at the last pointer move (the Heights brush flips between cells and free with it) */
  private altDown = false;
  private shiftDown = false;
  private sendMap: ReturnType<typeof throttle<[number, number]>>;

  constructor(host: HTMLElement, client: TableClient, ui: UiState, cb: BoardCallbacks) {
    this.host = host;
    this.client = client;
    this.ui = ui;
    this.cb = cb;
    this.sendMoves = throttle((moves, tp) => { void this.client.moveTokens(moves, undefined, { teleport: tp }); }, 60);
    this.sendMap = throttle((x, y) => { void this.client.updateScene({ mapX: x, mapY: y }); }, 80);
  }

  // ------------------------------------------------------------------ lifecycle
  private failedTokenUrls = new Set<string>();

  async init() {
    // text sizes come from a canvas, so boxes around text match what is drawn
    const mctx = document.createElement('canvas').getContext('2d');
    if (mctx) setLineMeasurer((css, line) => { mctx.font = css; return mctx.measureText(line).width; });
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
    this.world.addChild(this.mapLayer, this.extraLayer, this.gridG, this.terrainLayer.container, this.roughG, this.drawLayer.container, this.wallLayer.container, this.auraG, this.tokenLayer, this.ghostLayer, this.lightLayer.container, this.fogLayer, this.overlayG, this.fxLayer, this.distText);
    app.stage.addChild(this.world);

    this.bindInput(app.canvas);
    this.unsubs.push(this.client.onPing((p) => this.addPing(p)));
    this.unsubs.push(this.client.onView((v) => {
      if (v.sid !== this.client.viewSceneId) return;
      this.showRect(v);
      this.cb.onNotice('The DM brought everyone to this spot.', 'info');
    }));
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
    this.clearExtras();
    this.resetCut();
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

  /** Where a world point is on the page (client coordinates), and how big the map is drawn. */
  worldToScreen(p: Vec): Vec {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: r.left + this.cam.tx + p.x * this.cam.zoom, y: r.top + this.cam.ty + p.y * this.cam.zoom };
  }
  get zoomNow() { return this.cam.zoom; }

  viewCenterWorld(): Vec {
    return { x: (this.host.clientWidth / 2 - this.cam.tx) / this.cam.zoom, y: (this.host.clientHeight / 2 - this.cam.ty) / this.cam.zoom };
  }

  fit() {
    const rect = this.client.sceneRect();
    if (!rect) return;
    this.cam = fitCamera(this.host.clientWidth, this.host.clientHeight, rect, 48);
    this.applyCamera();
  }

  /** Fit the whole scene into the part of the screen the toolbar and the right-hand panel leave free. */
  fitClearOfPanel(rightPx = 350) {
    const rect = this.client.sceneRect();
    if (!rect) return;
    const left = 76;
    const free = Math.max(240, this.host.clientWidth - rightPx - left);
    const c = fitCamera(free, this.host.clientHeight, rect, 48);
    this.cam = { zoom: c.zoom, tx: c.tx + left, ty: c.ty };
    this.applyCamera();
  }

  zoomBy(factor: number) {
    this.cam = zoomAt(this.cam, this.host.clientWidth / 2, this.host.clientHeight / 2, factor);
    this.applyCamera();
  }

  /**
   * Glide the view so these tokens sit in the middle of the free space to the left of something that covers the right-hand side of the screen
   * (`rightPx` wide), and zoom in if they would otherwise be too small to see properly. Never zooms out.
   */
  showLeftOf(ids: string[], rightPx: number) {
    const sc = this.client.scene;
    if (!sc) return;
    const ts = ids.map((i) => sc.tokens.get(i)).filter((t): t is Token => !!t);
    if (!ts.length) return;
    const cell = this.client.grid.cell;
    const cx = ts.reduce((a, t) => a + t.x, 0) / ts.length;
    const cy = ts.reduce((a, t) => a + t.y, 0) / ts.length;
    const W = this.host.clientWidth, H = this.host.clientHeight;
    const left = 76; // the toolbar
    const freeW = Math.max(160, W - rightPx - left);
    // one token is shown big enough to judge its look; several are only brought into view
    const want = ts.length === 1 ? Math.min(freeW * 0.5, 110) / (ts[0].size * cell) : 0;
    const zoom = Math.min(8, Math.max(this.cam.zoom, want));
    const to = { zoom, tx: left + freeW / 2 - cx * zoom, ty: H * 0.46 - cy * zoom };
    const from = { ...this.cam };
    const t0 = performance.now();
    const run = (now: number) => {
      const k = Math.min(1, (now - t0) / 260);
      const e = 1 - Math.pow(1 - k, 3);
      this.cam.zoom = from.zoom + (to.zoom - from.zoom) * e;
      this.cam.tx = from.tx + (to.tx - from.tx) * e;
      this.cam.ty = from.ty + (to.ty - from.ty) * e;
      this.applyCamera();
      if (k < 1) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  }

  /** The part of the map this view shows, in world pixels. */
  viewRect(): Rect {
    const W = this.host.clientWidth, H = this.host.clientHeight, z = this.cam.zoom;
    return { x: -this.cam.tx / z, y: -this.cam.ty / z, w: W / z, h: H / z };
  }

  /** Glide the view so this part of the map fills it (the DM asked everyone to look here). */
  showRect(rect: Rect) {
    const to = fitCamera(this.host.clientWidth, this.host.clientHeight, rect, 0);
    const from = { ...this.cam };
    const t0 = performance.now();
    const run = (now: number) => {
      if (this.destroyed) return;
      const k = Math.min(1, (now - t0) / 500);
      const e = 1 - Math.pow(1 - k, 3);
      this.cam.zoom = from.zoom + (to.zoom - from.zoom) * e;
      this.cam.tx = from.tx + (to.tx - from.tx) * e;
      this.cam.ty = from.ty + (to.ty - from.ty) * e;
      this.applyCamera();
      if (k < 1) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
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
    if (this.ui.data.textEdit) this.ui.set({ camRev: this.ui.data.camRev + 1 });
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
    if (this.panKeys.size) {
      const dx = (this.panKeys.has('a') ? 1 : 0) - (this.panKeys.has('d') ? 1 : 0);
      const dy = (this.panKeys.has('w') ? 1 : 0) - (this.panKeys.has('s') ? 1 : 0);
      if (dx || dy) {
        const v = (this.shiftDown ? 1800 : 750) * dt / (dx && dy ? Math.SQRT2 : 1);
        this.cam.tx += dx * v;
        this.cam.ty += dy * v;
        this.applyCamera();
        this.ui.set({ camRev: this.ui.data.camRev + 1 });
        this.dirty = true;
      }
    }
    this.reconcile();
    let moving = false;
    for (const v of this.views.values()) if (v.tick(dt)) moving = true;
    for (const v of this.ghostViews.values()) if (v.tick(dt)) moving = true;
    if (moving) this.dirty = true;
    if (this.pings.length) { this.tickPings(); this.dirty = true; }
    if (this.press) this.dirty = true;
    this.tickHeights(dt);
    if (!this.dirty) return;
    this.dirty = false;
    if (this.gridDirty) { this.drawGrid(); this.gridDirty = false; }
    this.syncWalls();
    this.syncExtras();
    this.drawVision();
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
    const gridKey = scene.meta ? `${scene.meta.grid.cell}|${scene.meta.grid.shape}` : '';
    const previewNow = this.ui.data.dmPreview;
    if (gridKey !== this.seenGridKey) {
      this.seenGridKey = gridKey;
      for (const v of this.views.values()) v.invalidate();
      this.seenTokensRev = -1;
      this.seenDrawRev = -1;
    }
    if (c.players.size !== this.seenPlayers) { this.seenPlayers = c.players.size; this.seenTokensRev = -1; }
    if (previewNow !== this.seenPreview) { this.seenPreview = previewNow; this.seenTokensRev = -1; this.seenFogRev = -1; }

    if (scene.drawRev !== this.seenZoneRev) {
      this.seenZoneRev = scene.drawRev;
      const next = zonesOf(scene.draws.values(), this.client.grid);
      if (next.sig !== this.zones.sig) { this.zones = next; this.seenTokensRev = -1; this.refreshDraws(); }
      const nextRough = roughOf(scene.draws.values(), this.client.grid);
      if (nextRough.sig !== this.rough.sig) { this.rough = nextRough; this.paintRough(); }
    }
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
      this.drawLayer.sync(this.drawingsShown(), c.grid, this.textRes, this.ui.data.tplCover, this.wallsForSpells());
      const stale = [...this.ui.data.drawSel].filter((id) => !scene.draws.has(id));
      if (stale.length) this.ui.selectDrawings([...this.ui.data.drawSel].filter((id) => scene.draws.has(id)));
      this.dirty = true;
    }
    if (scene.wallRev !== this.seenWallRev) {
      this.seenWallRev = scene.wallRev;
      this.onWallsChanged();
    }
    if (scene.initRev !== this.seenInitRev) { this.seenInitRev = scene.initRev; this.dirty = true; }
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
    this.wallLayer.clear();
    this.wallPreview = null; this.wallHover = null; this.wallStart = null;
    this.seenWallRev = -1;
    this.ui.set({ wallSel: new Set() });
    this.testMoves.clear();
    this.testHistory = [];
    this.ruler = null;
    this.liveSent = false;
    this.ghostsDirty = true;
    this.drawPreview = null;
    this.ui.set({ drawSel: new Set(), testCount: 0, textEdit: null });
    if (this.mapSprite) { this.mapSprite.destroy(); this.mapSprite = null; }
    this.clearExtras();
    this.resetCut();
    if (this.mapUrl) { releaseTexture(this.mapUrl, 'map'); this.mapUrl = null; }
    this.mapTex = null;
    this.cb.onMapError(null);
    this.seenMetaRev = this.seenTokensRev = this.seenFogRev = this.seenDrawRev = this.seenLiveRev = this.seenInitRev = this.seenZoneRev = -1;
    this.zones = EMPTY_TERRAIN(this.client.grid);
    this.rough = EMPTY_TERRAIN(this.client.grid);
    this.roughG.clear();
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
      this.resetCut();
      if (meta.mapUrl) void this.loadMap(meta.mapUrl, scene.id);
    }
    if (this.mapSprite && this.mapTex) {
      this.mapSprite.position.set(meta.mapX, meta.mapY);
      this.mapSprite.scale.set(meta.mapScale * this.mapScaleToWorld);
      this.applyMapCut();
    }
    if (this.fitPending && !meta.mapUrl) { this.fit(); this.fitPending = false; }
    this.updateFog();
  }

  // ------------------------------------------------------------------ extra maps
  private clearExtras() {
    for (const e of this.extras.values()) { e.sprite.destroy(); releaseTexture(e.url, 'map'); }
    this.extras.clear();
    this.extrasKey = '';
  }

  /** Keep the extra map pictures in step with the scene: load new ones, move and resize, fade the ones players cannot see yet, drop the removed. */
  private syncExtras() {
    const meta = this.client.scene?.meta;
    const maps = meta?.maps ?? [];
    const dmView = this.client.isDM && !this.ui.data.dmPreview;
    const key = `${this.client.scene?.id}|${dmView}|${maps.map((m) => `${m.id},${m.url},${m.x},${m.y},${m.scale},${m.show}`).join(';')}`;
    if (key === this.extrasKey) return;
    this.extrasKey = key;
    const want = new Map(maps.map((m) => [m.id, m]));
    for (const [id, e] of [...this.extras]) {
      const m = want.get(id);
      if (!m || m.url !== e.url) { e.sprite.destroy(); releaseTexture(e.url, 'map'); this.extras.delete(id); }
    }
    maps.forEach((m, i) => {
      let e = this.extras.get(m.id);
      if (!e) {
        const sprite = new Sprite(Texture.EMPTY);
        sprite.visible = false;
        this.extraLayer.addChild(sprite);
        e = { url: m.url, sprite };
        this.extras.set(m.id, e);
        const entry = e, sid = this.client.scene?.id;
        void loadTexture(m.url, 'map').then((t) => {
          if (!t) return;
          if (this.destroyed || this.extras.get(m.id) !== entry || this.client.scene?.id !== sid) { releaseTexture(m.url, 'map'); return; }
          sprite.texture = t.texture;
          (sprite as Sprite & { natScale?: number }).natScale = t.scale;
          this.extrasKey = '';
          this.invalidate();
        });
      }
      const nat = (e.sprite as Sprite & { natScale?: number }).natScale;
      e.sprite.position.set(m.x, m.y);
      if (nat) { e.sprite.scale.set(m.scale * nat); e.sprite.visible = m.show || dmView; }
      e.sprite.alpha = m.show ? 1 : 0.45;
      e.sprite.zIndex = i;
    });
    this.extraLayer.sortableChildren = true;
    this.invalidate();
  }

  /** The unlocked extra map under a point, topmost first. */
  private extraAt(p: Vec): string | null {
    const maps = this.client.scene?.meta?.maps ?? [];
    for (let i = maps.length - 1; i >= 0; i--) {
      const m = maps[i];
      if (m.locked) continue;
      if (rectContains({ x: m.x, y: m.y, w: m.w * m.scale, h: m.h * m.scale }, p)) return m.id;
    }
    return null;
  }

  private resetCut() {
    this.cutSeq++;
    this.mapCutKey = '';
    if (this.mapCutTex) { this.mapCutTex.destroy(true); this.mapCutTex = null; }
  }

  /** Show the map with or without its printed grid, whichever the scene says. Done on every screen from the saved lines, so nothing extra is stored. */
  private applyMapCut() {
    const sprite = this.mapSprite, tex = this.mapTex;
    const cut = this.client.scene?.meta?.mapGrid;
    if (!sprite || !tex) return;
    const want = cut && cut.on ? cut : null;
    const key = want ? `${this.mapUrl}|${want.p}|${want.x}|${want.y}|${want.t}|${want.hex ?? ''}` : '';
    if (key === this.mapCutKey) return;
    this.mapCutKey = key;
    const seq = ++this.cutSeq;
    if (!want) {
      sprite.texture = tex.texture;
      if (this.mapCutTex) { this.mapCutTex.destroy(true); this.mapCutTex = null; }
      this.invalidate();
      return;
    }
    void gridlessTexture(tex, want).then((t) => {
      if (seq !== this.cutSeq || this.destroyed || this.mapSprite !== sprite) { t?.destroy(true); return; }
      if (!t) { this.mapCutKey = ''; this.cb.onNotice("Couldn't hide the map's grid lines on this device.", 'error'); return; }
      sprite.texture = t;
      if (this.mapCutTex) this.mapCutTex.destroy(true);
      this.mapCutTex = t;
      this.invalidate();
    });
  }

  /**
   * Look for a grid printed on the map picture (the DM's "Find and hide" button).
   * The answer is in pixels of the original picture, so it stays right however big the map is shown.
   */
  async findMapGrid(opts: { any?: boolean } = {}): Promise<{ cut: GridCut; strength: number } | { error: string }> {
    const tex = this.mapTex;
    const meta = this.client.scene?.meta;
    if (!tex || !meta) return { error: 'Add a map picture first.' };
    await new Promise<void>((r) => setTimeout(r, 20));
    const px = readPixels(tex);
    if (!px) return { error: "This browser would not let me read the map picture, so I can't look for lines in it." };
    // the grid you already set is a good guess at the spacing; if nothing is there, look at every spacing
    const hint = meta.grid.cell / (meta.mapScale * tex.scale);
    // a hex scene looks for hexes first, a square one for squares; either one still tries the other if nothing fits
    // (`any`: no grid has been set up for this picture yet, so squares and hexes both get a look and the clearer one wins)
    const f = detectPrintedGrid(px.img, { hint, shape: meta.grid.shape, any: opts.any });
    if (!f) return { error: 'I could not find evenly spaced grid lines in this picture. Some maps have none, or only faint ones.' };
    return { cut: { ...scaleCut(f.cut, tex.scale), on: true }, strength: f.strength };
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
    this.applyMapCut();
    if (this.fitPending) { this.fit(); this.fitPending = false; }
    this.gridDirty = true;
    this.updateFog();
    this.invalidate();
    if (this.client.isDM && meta.mapUrl && !meta.gridTried) {
      // with the setting off the map is still marked as looked at, so switching it on later does not surprise anyone
      if (this.ui.data.autoGrid) void this.autoMapGrid(sceneId, url);
      else void this.client.updateScene({ gridTried: true }, { record: false });
    }
  }

  /**
   * A map that has just been added is looked at once for a printed grid. If one is clearly there it is hidden and the app's own grid is set on it,
   * so the DM never has to draw it. (One Ctrl+Z puts both back.) Maps with no grid, or only a faint one, are left alone.
   */
  private async autoMapGrid(sceneId: string, url: string) {
    const here = () => !this.destroyed && this.client.scene?.id === sceneId && this.mapUrl === url;
    // mark it as looked at first, so another tab, or this one loading again while it works, does not do it twice
    await this.client.updateScene({ gridTried: true }, { record: false });
    if (!here()) return;
    const r = await this.findMapGrid({ any: true });
    if (!here() || 'error' in r || r.strength < AUTO_GRID_STRENGTH) return;
    const m = this.client.scene?.meta;
    if (!m || m.mapGrid) return;
    await this.client.updateScene({ mapGrid: r.cut, grid: impliedGrid(r.cut, m.mapScale, m.mapX, m.mapY) });
    this.cb.onNotice(r.cut.hex
      ? `This map has a hex grid printed on it. I hid it and set your grid on it. Ctrl+Z puts it back.`
      : `This map has a grid printed on it (every ${Math.round(r.cut.p * m.mapScale * 10) / 10} px on the board). I hid it and set your grid on it. Ctrl+Z puts it back.`, 'ok');
  }

  // ------------------------------------------------------------------ tokens
  private tokenCtx(t: Token): TokenCtx {
    const c = this.client;
    return {
      grid: c.grid,
      showLabel: t.label !== 'dm' || (c.isDM && !this.ui.data.dmPreview),
      textRes: this.textRes,
      health: this.healthFor(t),
      alt: this.heightOf(t),
    };
  }

  /** How high a token is (at `pos`, or where it is): flying, or standing on the ground there. */
  heightOf(t: Token, pos?: Vec): Altitude {
    return altitudeOf(t, groundAt(this.zones, pos ?? t));
  }

  /** How high the ground is at a spot, in feet. */
  groundAtPoint(p: Vec): number { return groundAt(this.zones, p); }

  /** How high a spot on the map is: whatever token is standing or flying there, else the ground. */
  private pointAlt(p: Vec): number {
    const hit = this.hitToken(p);
    return hit ? this.heightOf(hit).alt : groundAt(this.zones, p);
  }

  /** The DM sees real health for every token that has some; everyone else sees only what the DM allows. */
  private healthFor(t: Token): TokenCtx['health'] {
    if (this.client.isDM && !this.ui.data.dmPreview) {
      const pct = pctOf(t.hp, t.maxHp);
      return pct == null ? null : { pct, bar: true };
    }
    if (t.hpShow === 'off' || t.hpPct == null) return null;
    return { pct: t.hpPct, bar: t.hpShow === 'bar' || t.hpShow === 'numbers', nums: t.hpShow === 'numbers' && t.hpNow != null && t.hpCap != null ? { now: t.hpNow, cap: t.hpCap } : undefined };
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
      const dr = this.ui.data.fxDraft;
      v.preview = dr && dr.ids.includes(t.id) ? dr.fx : null;
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
    const list = [...this.views.values()].sort((a, b) => b.container.zIndex - a.container.zIndex);
    for (const v of list) {
      if (this.outOfSight.has(v.token.id)) continue;
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
      const ctx = { ...this.tokenCtx(w.token), showLabel: false, health: null };
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

  // ------------------------------------------------------------------ difficult ground and what moving costs
  /** Hatch every square of difficult ground. */
  private paintRough() {
    const g = this.roughG;
    g.clear();
    const t = this.rough;
    const grid = this.client.grid;
    const box = terrainBounds(t);
    if (!box) { this.invalidate(); return; }
    const col = 0xc8791b;
    const cells = cellCentersIn(grid, box).filter((p) => isRough(t, p)).slice(0, 8000);
    for (const c of cells) g.poly(cellPoly(grid, c).flatMap((p) => [p.x, p.y]));
    g.fill({ color: col, alpha: 0.24 });
    const r = grid.cell * 0.32;
    for (const c of cells) { g.moveTo(c.x - r, c.y + r).lineTo(c.x + r, c.y - r); }
    g.stroke({ width: Math.max(1.5, grid.cell * 0.045), color: col, alpha: 0.8, cap: 'round' });
    this.invalidate();
  }

  /** Is the ground at this spot difficult? */
  isRoughAt(p: Vec): boolean { return isRough(this.rough, p); }

  /** What a walk through these points costs, counting stairs and difficult ground (a flyer is not slowed by either). */
  private moveCost(path: Vec[], fly: boolean): { ft: number; note: string } {
    const grid = this.client.grid;
    const base = pathFt(grid, path);
    if (fly || (!this.zones.areas.length && !this.rough.areas.length)) return { ft: base, note: '' };
    const ctx = { ground: (p: Vec) => groundAt(this.zones, p), rough: (p: Vec) => isRough(this.rough, p) };
    const sum: WalkExtra = { extraFt: 0, rough: 0, stairs: 0 };
    for (let i = 1; i < path.length; i++) {
      const e = walkExtra(grid, path[i - 1], path[i], ctx);
      sum.extraFt += e.extraFt; sum.rough += e.rough; sum.stairs += e.stairs;
    }
    return { ft: Math.round((base + sum.extraFt) * 10) / 10, note: walkNote(grid, sum) };
  }

  // ------------------------------------------------------------------ walls
  /** The wall pieces that stop sight and walking, kept until the walls change. */
  wallSegs(): { sight: Seg[]; move: Seg[] } {
    const scene = this.client.scene;
    if (!scene) return { sight: [], move: [] };
    const c = this.segCache;
    // how tall a wall's top is depends on the ground it stands on, so the pieces are rebuilt when the ground changes too
    const cliffFt = scene.meta?.cliff ?? DEFAULT_CLIFF_FT;
    const gsig = `${this.zones.sig}|${cliffFt}`;
    if (c.scene !== scene || c.rev !== scene.wallRev || c.ground !== gsig) {
      const list = [...scene.walls.values()];
      const topOf = (w: Wall) => groundAt(this.zones, wallMid(w)) + w.h;
      // a big enough drop between neighbouring squares is a cliff: a wall for whatever is lower than the top of it, nothing for what stands on top
      const cliffs = cliffSegs(this.client.grid, terrainBounds(this.zones), (p) => groundAt(this.zones, p), cliffFt);
      this.segCache = { scene, rev: scene.wallRev, ground: gsig, sight: [...sightSegs(list, topOf), ...cliffs], move: [...moveSegs(list, topOf), ...cliffs] };
    }
    return this.segCache;
  }

  /** What stops a spell, for the template painter. */
  private wallsForSpells(): { segs: Seg[]; rev: string; ground: (p: Vec) => number } {
    // a spell also depends on how high the ground is where it starts (a wall lower than that does not stop it)
    return { segs: this.wallSegs().sight, rev: `${this.client.scene?.wallRev ?? 0}:${this.zones.sig}`, ground: (p) => groundAt(this.zones, p) };
  }

  private onWallsChanged() {
    const scene = this.client.scene;
    if (!scene) return;
    const sel = this.ui.data.wallSel;
    if (sel.size && [...sel].some((id) => !scene.walls.has(id))) this.ui.set({ wallSel: new Set([...sel].filter((id) => scene.walls.has(id))) });
    this.refreshDraws(); // spells stop at walls
    this.dirty = true;
  }

  private wallsShown(): Wall[] {
    const list = this.client.wallsList();
    const pv = this.wallPreview;
    return pv ? list.map((w) => { const o = pv.get(w.id); return o ? { ...w, a: o.a, b: o.b } : w; }) : list;
  }

  private syncWalls() {
    const scene = this.client.scene;
    if (!scene) return;
    const u = this.ui.data;
    const dm = this.client.isDM;
    const editing = dm && u.tool === 'wall';
    const edit = editing && u.wallMode === 'edit';
    this.wallLayer.sync(this.wallsShown(), {
      z: this.cam.zoom, cell: this.client.grid.cell, showAll: dm && !u.dmPreview,
      selected: editing ? u.wallSel : NO_IDS, hover: edit ? this.wallHover : null, handles: edit,
    }, `${scene.wallRev}:${this.wallPrevSeq}`, editing || u.showWalls);
  }

  /** The door whose diamond is under `p` (the DM clicks it to open or close it). */
  private doorAt(p: Vec): Wall | null {
    const max = Math.max(this.client.grid.cell * 0.2, 9 / this.cam.zoom);
    let best: Wall | null = null, bd = max;
    for (const w of this.client.scene?.walls.values() ?? []) {
      if (w.k !== 'door') continue;
      const m = wallMid(w);
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d <= bd) { bd = d; best = w; }
    }
    return best;
  }

  /** The wall pieces that hold tokens back right now (the DM can walk through them, and W also lets them pass). */
  private moveBlockers(): Seg[] {
    const meta = this.client.scene?.meta;
    if (!meta) return [];
    if (this.client.isDM) { if (this.ui.data.wallIgnore || this.teleportHeld) return []; }
    else if (!meta.wallStop) return [];
    return this.wallSegs().move;
  }

  /** Does a step from→to go through a wall? A token already standing on a wall can still step off it. `alt` is how high it is (flyers go over low walls). */
  private stepBlocked(from: Vec, to: Vec, segs: Seg[], alt?: number): boolean {
    return pathBlocked(from, to, segs.filter((s) => distToSeg(from, s) > 0.75), alt);
  }

  /** How high a token is when it stands (or flies) at `pos`. */
  private altAt(id: string, pos: Vec): number | undefined {
    const t = this.client.scene?.tokens.get(id);
    return t ? this.heightOf(t, pos).alt : undefined;
  }

  /** Whether a token may go from→to (arrow keys, jumps and the like). */
  private moveAllowed(from: Vec, to: Vec, id?: string): boolean {
    const segs = this.moveBlockers();
    return !segs.length || !this.stepBlocked(from, to, segs, id ? this.altAt(id, from) : undefined);
  }

  /**
   * Where the group dragged by `d` ends up when it is asked to go `want` from where it stands: all the way, or as far as it gets before a wall.
   * `snap` turns a try into a spot a token could really stop on (so the group never rests half way between squares).
   */
  private wallStep(d: Extract<Drag, { kind: 'tokens' }>, want: Vec, snap: ((v: Vec) => Vec) | null): Vec {
    const segs = this.moveBlockers();
    const cur = d.cur ?? { x: 0, y: 0 };
    if (!segs.length) return want;
    const origins = d.ids.map((id) => ({ id, o: d.origins.get(id) })).filter((x): x is { id: string; o: Vec } => !!x.o);
    const clear = (v: Vec) => origins.every(({ id, o }) => {
      const from = { x: o.x + cur.x, y: o.y + cur.y };
      return !this.stepBlocked(from, { x: o.x + v.x, y: o.y + v.y }, segs, this.altAt(id, from));
    });
    if (clear(want)) return want;
    const len = Math.hypot(want.x - cur.x, want.y - cur.y);
    const n = Math.min(200, Math.max(4, Math.ceil(len / 3)));
    for (let k = n - 1; k >= 1; k--) {
      let v = { x: cur.x + ((want.x - cur.x) * k) / n, y: cur.y + ((want.y - cur.y) * k) / n };
      if (snap) v = snap(v);
      if (clear(v)) return v;
    }
    return cur;
  }

  /** Where a wall end lands: on another wall's end if one is close, else on the grid (Alt: anywhere; Shift: straight or at 45 degrees). */
  private wallPoint(w: Vec, e: { altKey: boolean; shiftKey: boolean }, from: Vec | null, skip?: (wl: Wall, end: 'a' | 'b') => boolean): Vec {
    if (e.altKey) return w;
    const u = this.ui.data;
    const grid = this.client.grid;
    if (e.shiftKey && from) {
      const dx = w.x - from.x, dy = w.y - from.y;
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      let L = Math.max(0, dx * Math.cos(ang) + dy * Math.sin(ang));
      if (u.wallSnap !== 'off') L = Math.round(L / (grid.cell / 2)) * (grid.cell / 2);
      return { x: from.x + Math.cos(ang) * L, y: from.y + Math.sin(ang) * L };
    }
    const ends: Vec[] = [];
    for (const x of this.client.scene?.walls.values() ?? []) for (const end of ['a', 'b'] as const) if (!skip?.(x, end)) ends.push(x[end]);
    return snapWallPoint(grid, w, ends, u.wallSnap, 10 / this.cam.zoom);
  }

  /** What the next wall is drawn as: doors are always one piece. */
  private wallShapeNow(): 'line' | 'box' | 'free' | 'circle' {
    const u = this.ui.data;
    return u.wallKind === 'door' ? 'line' : u.wallShape;
  }

  /** The corners of a freehand wall, simplified as much as the detail setting says. */
  private freehandOf(pts: Vec[]): { pts: Vec[]; closed: boolean } {
    const cell = this.client.grid.cell;
    const tol = cell * { low: 0.35, mid: 0.18, high: 0.08 }[this.ui.data.wallDetail];
    const ends: Vec[] = [];
    for (const x of this.client.scene?.walls.values() ?? []) ends.push(x.a, x.b);
    return freehandCorners(pts, tol, Math.max(cell * 0.4, 12 / this.cam.zoom), ends);
  }

  /** The walls a shape being drawn would make (a box, a round room, or a hand-drawn line). */
  private wallShapeSegs(shape: 'line' | 'box' | 'free' | 'circle', a: Vec, b: Vec, pts: Vec[]): { a: Vec; b: Vec }[] {
    const cell = this.client.grid.cell;
    if (shape === 'box') return boxSegments(a, b);
    if (shape === 'circle') {
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      if (r < cell * 0.2) return [];
      const n = { low: 12, mid: 20, high: 32 }[this.ui.data.wallDetail];
      return chainSegments(circlePoints(a, r, n, Math.atan2(b.y - a.y, b.x - a.x)), true);
    }
    if (shape === 'free') {
      if (pts.length < 2) return [];
      const f = this.freehandOf(pts);
      return chainSegments(f.pts, f.closed, cell * 0.08);
    }
    return [{ a, b }];
  }

  private startWall(w: Vec, e: PointerEvent) {
    const u = this.ui.data;
    if (u.wallMode === 'edit') { this.startWallEdit(w, e); return; }
    const shape = this.wallShapeNow();
    // a hand-drawn wall is free of the grid: only its ends find other walls
    const p = shape === 'free' ? w : this.wallPoint(w, e, this.wallStart);
    const from = shape === 'free' ? p : this.wallStart ?? p;
    this.drag = { kind: 'wall', a: from, b: p, down: p, moved: false, cont: shape !== 'free' && !!this.wallStart, shape, pts: shape === 'free' ? [p] : [] };
  }

  /** The new walls' settings: kind, whether the players see them, which side stops, how tall. */
  private newWall(a: Vec, b: Vec): Omit<Wall, 'id'> {
    const u = this.ui.data;
    return { a, b, k: u.wallKind, open: false, vis: u.wallVis ?? wallVisDefault(u.wallKind), one: u.wallKind === 'door' ? 0 : u.wallOne, h: u.wallH };
  }

  private commitWall(d: Extract<Drag, { kind: 'wall' }>) {
    const u = this.ui.data;
    const tiny = this.client.grid.cell * 0.1;
    const fail = (err: Error) => this.cb.onNotice(err.message, 'error');
    if (d.shape === 'free') {
      this.wallStart = null;
      if (!d.moved) return;
      const segs = this.wallShapeSegs('free', d.a, d.b, d.pts);
      if (segs.length) void this.client.addWalls(segs.map((s) => this.newWall(s.a, s.b)), 'Draw walls').catch(fail);
      return;
    }
    // a plain click with nothing started yet only marks where the wall will begin
    if (!d.cont && !d.moved) { this.wallStart = d.a; this.wallRunFirst = d.a; this.wallRunCount = 0; return; }
    if (d.shape === 'box' || d.shape === 'circle') {
      this.wallStart = null;
      if (d.shape === 'box' && (Math.abs(d.b.x - d.a.x) < tiny || Math.abs(d.b.y - d.a.y) < tiny)) return;
      const segs = this.wallShapeSegs(d.shape, d.a, d.b, []);
      if (segs.length) void this.client.addWalls(segs.map((s) => this.newWall(s.a, s.b)), 'Draw walls').catch(fail);
      return;
    }
    if (Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < tiny) { this.wallStart = null; return; } // clicking the last point again ends the run
    void this.client.addWalls([this.newWall(d.a, d.b)], u.wallKind === 'wall' ? 'Draw wall' : `Draw ${WALL_NAME[u.wallKind].toLowerCase()}`).catch(fail);
    if (!d.cont) { this.wallRunFirst = d.a; this.wallRunCount = 0; }
    this.wallRunCount++;
    // walls run on from where the last one stopped (a door or window is one piece), and coming back to where the run began closes the loop
    const closes = !!this.wallRunFirst && this.wallRunCount >= 3 && Math.hypot(d.b.x - this.wallRunFirst.x, d.b.y - this.wallRunFirst.y) < 1;
    this.wallStart = u.wallKind === 'wall' && !closes ? d.b : null;
  }

  private startWallEdit(w: Vec, e: PointerEvent) {
    const u = this.ui.data;
    const z = this.cam.zoom;
    const list = this.client.wallsList();
    const en = endNear(list, w, 9 / z);
    if (en) {
      // every wall end on that spot comes along, so a corner stays closed
      const at = en.wall[en.end];
      const moves: { id: string; end: 'a' | 'b' }[] = [];
      for (const x of list) for (const end of ['a', 'b'] as const) if (Math.hypot(x[end].x - at.x, x[end].y - at.y) < 0.5) moves.push({ id: x.id, end });
      this.ui.set({ wallSel: new Set([en.wall.id]) });
      this.drag = { kind: 'wallend', moves, from: { ...at }, to: { ...at }, moved: false };
      return;
    }
    const hit = wallNear(list, w, 8 / z);
    if (hit) {
      let sel = new Set(u.wallSel);
      if (e.shiftKey) {
        if (sel.has(hit.wall.id)) sel.delete(hit.wall.id); else sel.add(hit.wall.id);
        this.ui.set({ wallSel: sel });
        return;
      }
      if (!sel.has(hit.wall.id)) sel = new Set([hit.wall.id]);
      this.ui.set({ wallSel: sel });
      const first = this.client.scene?.walls.get([...sel][0]);
      this.drag = { kind: 'wallmove', ids: [...sel], start: w, anchor: first ? { ...first.a } : w, dx: 0, dy: 0, moved: false };
      return;
    }
    const base = e.shiftKey ? new Set(u.wallSel) : new Set<string>();
    if (!e.shiftKey) this.ui.set({ wallSel: new Set() });
    this.drag = { kind: 'wallbox', start: w, cur: w, base };
  }

  private moveWallDrag(d: Extract<Drag, { kind: 'wallend' | 'wallmove' | 'wallbox' | 'wall' }>, w: Vec, e: PointerEvent) {
    const z = this.cam.zoom;
    const walls = this.client.scene?.walls;
    if (d.kind === 'wall') {
      if (d.shape === 'free') {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(w.x - last.x, w.y - last.y) * z >= 3) d.pts.push(w);
        d.b = w;
      } else d.b = this.wallPoint(w, e, d.a);
      if (Math.hypot(d.b.x - d.down.x, d.b.y - d.down.y) * z > 4) d.moved = true;
    } else if (d.kind === 'wallend') {
      d.to = this.wallPoint(w, e, null, (wl, end) => d.moves.some((m) => m.id === wl.id && m.end === end));
      if (Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y) * z > 3) d.moved = true;
      if (!d.moved || !walls) return;
      const pv = new Map<string, { a: Vec; b: Vec }>();
      for (const m of d.moves) { const x = walls.get(m.id); if (x) pv.set(m.id, { ...(pv.get(m.id) ?? { a: x.a, b: x.b }), [m.end]: d.to }); }
      this.wallPreview = pv; this.wallPrevSeq++;
    } else if (d.kind === 'wallmove') {
      if (!d.moved && Math.hypot(w.x - d.start.x, w.y - d.start.y) * z < 4) return;
      d.moved = true;
      const want = { x: d.anchor.x + (w.x - d.start.x), y: d.anchor.y + (w.y - d.start.y) };
      const p = this.wallPoint(want, e, null, (wl) => d.ids.includes(wl.id));
      d.dx = p.x - d.anchor.x; d.dy = p.y - d.anchor.y;
      if (!walls) return;
      const pv = new Map<string, { a: Vec; b: Vec }>();
      for (const id of d.ids) { const x = walls.get(id); if (x) pv.set(id, { a: { x: x.a.x + d.dx, y: x.a.y + d.dy }, b: { x: x.b.x + d.dx, y: x.b.y + d.dy } }); }
      this.wallPreview = pv; this.wallPrevSeq++;
    } else {
      d.cur = w;
      const r = normRect(d.start, w);
      const inside: string[] = [];
      for (const x of walls?.values() ?? []) if ([x.a, x.b, wallMid(x)].some((q) => rectContains(r, q))) inside.push(x.id);
      this.ui.set({ wallSel: new Set([...d.base, ...inside]) });
    }
  }

  private finishWallDrag(d: Extract<Drag, { kind: 'wallend' | 'wallmove' }>) {
    const done = () => { this.wallPreview = null; this.wallPrevSeq++; this.invalidate(); };
    if (!d.moved) { done(); return; }
    const fail = (err: Error) => this.cb.onNotice(err.message, 'error');
    if (d.kind === 'wallend') { void this.client.moveWallEnds(d.moves.map((m) => ({ ...m, to: d.to })), 'Move wall').catch(fail).finally(done); return; }
    const moves: { id: string; end: 'a' | 'b'; to: Vec }[] = [];
    for (const id of d.ids) {
      const x = this.client.scene?.walls.get(id);
      if (x) moves.push({ id, end: 'a', to: { x: x.a.x + d.dx, y: x.a.y + d.dy } }, { id, end: 'b', to: { x: x.b.x + d.dx, y: x.b.y + d.dy } });
    }
    void this.client.moveWallEnds(moves, d.ids.length > 1 ? 'Move walls' : 'Move wall').catch(fail).finally(done);
  }

  /**
   * Double-clicking in the Walls tool's edit mode: a door opens or closes, a corner where two walls meet is taken out,
   * and a wall gets a new corner right there (drag it to bend the wall). Anywhere else it ends the run of walls being drawn.
   */
  private wallDoubleClick(w: Vec) {
    if (this.ui.data.wallMode !== 'edit') { this.wallStart = null; return; }
    const z = this.cam.zoom;
    const list = this.client.wallsList();
    const fail = (err: Error) => this.cb.onNotice(err.message, 'error');
    const door = wallNear(list.filter((x) => x.k === 'door'), w, 8 / z);
    if (door) { void this.client.toggleDoor(door.wall.id).catch(fail); return; }
    const en = endNear(list, w, 9 / z);
    if (en) {
      void this.client.joinWallsAt(en.wall[en.end], 0.5).then((ok) => { if (!ok) this.cb.onNotice('A corner can only be taken out where exactly two walls of the same kind meet.', 'info'); }).catch(fail);
      return;
    }
    const hit = wallNear(list, w, 8 / z);
    if (hit) {
      // a corner lands on the grid when the wall passes through a grid point there, otherwise right where you clicked
      const snapped = snapWallPoint(this.client.grid, hit.at, [], this.ui.data.wallSnap, 0);
      const at = distToSeg(snapped, hit.wall) < 1.5 ? snapped : hit.at;
      if (Math.hypot(at.x - hit.wall.a.x, at.y - hit.wall.a.y) < 2 || Math.hypot(at.x - hit.wall.b.x, at.y - hit.wall.b.y) < 2) return;
      void this.client.splitWall(hit.wall.id, at).then((ids) => { if (ids.length) this.ui.set({ wallSel: new Set(ids) }); }).catch(fail);
    }
  }

  private updateWallHover(w: Vec) {
    const u = this.ui.data;
    let id: string | null = null;
    if (u.tool === 'wall' && u.wallMode === 'edit' && this.client.isDM) id = wallNear(this.client.wallsList(), w, 8 / this.cam.zoom)?.wall.id ?? null;
    if (id !== this.wallHover) { this.wallHover = id; this.wallPrevSeq++; }
  }

  /** The Walls tool's rubber bands: the wall being drawn (with its length), where the next point would land, and the selection box. */
  private paintWallTool(g: Graphics, z: number, li: number): number {
    const u = this.ui.data;
    const d = this.drag;
    const grid = this.client.grid;
    const col = WALL_COLOR[u.wallKind];
    const width = Math.max(2.5 / z, grid.cell * 0.05);
    const line = (a: Vec, b: Vec, alpha: number) => { g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color: col, alpha, cap: 'round' }); };
    const label = (a: Vec, b: Vec) => {
      const ft = Math.round((Math.hypot(b.x - a.x, b.y - a.y) / grid.cell) * grid.ft * 10) / 10;
      if (ft > 0) this.plotLabel(li++, `${ft} ft`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 10 / z, col);
    };
    const marker = (p: Vec) => { g.circle(p.x, p.y, 4.5 / z).fill({ color: 0x000000, alpha: 0.35 }).stroke({ width: 1.5 / z, color: 0xffffff }); };
    if (u.wallMode === 'draw') {
      const shape = this.wallShapeNow();
      const one = u.wallKind === 'door' ? 0 : u.wallOne;
      const ticks = (a: Vec, b: Vec, alpha: number) => {
        if (!one) return;
        for (const t of hatchTicks(a, b, one, grid.cell * 0.32, grid.cell * 0.16)) g.moveTo(t.a.x, t.a.y).lineTo(t.b.x, t.b.y);
        g.stroke({ width: Math.max(1.5 / z, grid.cell * 0.025), color: col, alpha, cap: 'round' });
      };
      const segs = (list: { a: Vec; b: Vec }[], alpha: number) => { for (const s of list) { line(s.a, s.b, alpha); ticks(s.a, s.b, alpha); } };
      if (d?.kind === 'wall') {
        if (d.shape === 'free') {
          if (d.pts.length > 1) {
            // the stroke itself, thin, and the walls it will turn into
            g.moveTo(d.pts[0].x, d.pts[0].y);
            for (const q of d.pts.slice(1)) g.lineTo(q.x, q.y);
            g.stroke({ width: 1.5 / z, color: col, alpha: 0.35 });
            const f = this.freehandOf(d.pts);
            segs(chainSegments(f.pts, f.closed, grid.cell * 0.08), 0.9);
            for (const q of f.pts) g.circle(q.x, q.y, 3 / z).fill({ color: 0xffffff, alpha: 0.9 });
          }
        } else if (d.shape === 'box') segs(boxSegments(d.a, d.b), 0.9);
        else if (d.shape === 'circle') {
          segs(this.wallShapeSegs('circle', d.a, d.b, []), 0.9);
          const ft = Math.round((Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) / grid.cell) * grid.ft * 10) / 10;
          if (ft > 0) this.plotLabel(li++, `${ft} ft radius`, d.a.x, d.a.y - 10 / z, col);
        } else { segs([{ a: d.a, b: d.b }], 0.9); label(d.a, d.b); }
        marker(d.b);
      } else if (!d && this.pointerW) {
        const free = shape === 'free';
        const p = free ? this.pointerW : this.wallPoint(this.pointerW, { altKey: this.altDown, shiftKey: this.shiftDown }, this.wallStart);
        if (this.wallStart && !free) {
          if (shape === 'box') segs(boxSegments(this.wallStart, p), 0.6);
          else if (shape === 'circle') segs(this.wallShapeSegs('circle', this.wallStart, p, []), 0.6);
          else { segs([{ a: this.wallStart, b: p }], 0.6); label(this.wallStart, p); }
          g.circle(this.wallStart.x, this.wallStart.y, 6 / z).stroke({ width: 2 / z, color: col });
        }
        marker(p);
      }
    } else if (d?.kind === 'wallbox') {
      const r = normRect(d.start, d.cur);
      g.rect(r.x, r.y, r.w, r.h).fill({ color: SELECT, alpha: 0.08 }).stroke({ width: 1 / z, color: SELECT });
    }
    if (u.wallMode === 'edit') {
      // how tall the selected (or hovered) walls are
      const ids = new Set([...u.wallSel, ...(this.wallHover ? [this.wallHover] : [])]);
      for (const id of ids) {
        const wl = this.client.scene?.walls.get(id);
        if (wl && wl.h > 0 && li < 12) { const m = wallMid(wl); this.plotLabel(li++, `${wl.h} ft tall`, m.x, m.y - 10 / z, WALL_COLOR[wl.k]); }
      }
    }
    return li;
  }

  // ------------------------------------------------------------------ vision (fog around tokens that can see)
  /** Tokens that clear fog: visible ones with a sight distance. Hidden tokens never do, and a test move does not peek ahead. */
  visionNow(): { id: string; x: number; y: number; r: number; alt?: number }[] {
    const meta = this.client.scene?.meta;
    if (!meta || !meta.fog.enabled || !meta.fog.vision) return [];
    const toks = [...this.views.values()].filter((v) => !v.token.hidden);
    const circles = visionCircles(toks.map((v) => v.token), meta.grid, (t) => {
      const v = this.views.get(t.id)!;
      return v.testPos ? { x: v.token.x, y: v.token.y } : v.display;
    });
    // how high each one is: something above a wall's top sees over it
    return circles.map((c) => ({ ...c, alt: this.altAt(c.id, { x: c.x, y: c.y }) }));
  }

  /** What shines and who sees, for a scene that is not in full daylight (null in daylight). Positions are where the tokens are drawn now. */
  private lighting(): { ambient: Ambient; lights: LightSrc[]; viewers: Viewer[]; key: string } | null {
    const scene = this.client.scene;
    const meta = scene?.meta;
    if (!scene || !meta) return null;
    const ambient = meta.light.ambient;
    if (ambient === 'bright') return null;
    const g = meta.grid;
    const lights: LightSrc[] = [];
    const viewers: Viewer[] = [];
    for (const v of this.views.values()) {
      const t = v.token;
      // a token hidden from the players is gone for them, light and sight included, so it is gone here too
      if (t.hidden) continue;
      const at = v.testPos ? { x: t.x, y: t.y } : v.display;
      const l = t.light ? lightOf(t, g, at, this.altAt(t.id, at)) : null;
      if (l) lights.push(l);
      const w = viewerOf(t, g, at, this.altAt(t.id, at));
      if (w) viewers.push(w);
    }
    const r = (n: number) => Math.round(n * 2) / 2;
    const key = `${scene.id}|${ambient}|${scene.wallRev}:${this.zones.sig}|${lights.map((l) => `${r(l.x)},${r(l.y)},${r(l.b)},${r(l.r)},${l.c},${l.alt ?? ''}`).join(';')}|${viewers.map((w) => `${r(w.x)},${r(w.y)},${r(w.r)},${r(w.dv)},${r(w.touch)},${w.alt ?? ''}`).join(';')}`;
    return { ambient, lights, viewers, key };
  }

  /** The dark wash and the glow of the lights over the map. */
  private drawDark(L: ReturnType<Board['lighting']>) {
    const meta = this.client.scene?.meta;
    if (!L || !meta) { this.lightLayer.hide(); return; }
    const rect = sceneRect(meta) ?? { x: 0, y: 0, w: 2000, h: 1500 };
    this.lightLayer.paint({ ambient: L.ambient, rect, lights: L.lights, viewers: L.viewers, segs: this.wallSegs().sight, dm: this.client.isDM && !this.ui.data.dmPreview, key: L.key });
  }

  /** Tokens standing on remembered (grey) ground that nobody can see right now: out of sight for the players until someone looks again. */
  private outOfSight = new Set<string>();

  private drawVision() {
    this.syncOutOfSight(this.drawVisionShape());
  }

  /** Hide what stands in the grey of the fog from the players, and show it again once it is seen. `test`: can this spot be seen right now (null: no fog to look through). */
  private syncOutOfSight(test: ((p: Vec) => boolean) | null) {
    const meta = this.client.scene?.meta;
    const want = new Set<string>();
    const dmView = this.client.isDM && !this.ui.data.dmPreview;
    if (!dmView && test && meta?.fog.enabled && meta.fog.vision && meta.fog.explore && meta.fog.dim && this.fogSprite?.visible) {
      for (const v of this.views.values()) {
        const t = v.token;
        // the party always sees itself, and a light stays where it was seen
        if (t.ownerUid != null || isLightMark(t)) continue;
        if (this.fogMask.fogAt(v.display).seen && !test(v.display)) want.add(t.id);
      }
    }
    let changed = want.size !== this.outOfSight.size;
    if (!changed) for (const id of want) if (!this.outOfSight.has(id)) { changed = true; break; }
    if (!changed) return;
    this.outOfSight = want;
    for (const v of this.views.values()) v.container.visible = !want.has(v.token.id);
    this.invalidate();
  }

  /** Cut the fog open where the tokens can see; returns a test for "can this spot be seen right now" (null when there is no fog). */
  private drawVisionShape(): ((p: Vec) => boolean) | null {
    const L = this.lighting();
    this.drawDark(L);
    const sprite = this.fogSprite;
    if (!sprite) return null;
    const meta = this.client.scene?.meta;
    // in the dark, a token only sees what is lit (or what its darkvision reaches): the fog is cut open in that shape
    if (L && L.ambient === 'dark' && sprite.visible && meta?.fog.enabled && meta.fog.vision) {
      this.visionG.clear();
      if (!L.viewers.length) {
        if (this.fogMaskKind) { sprite.setMask({ mask: null }); this.fogMaskKind = ''; }
        return () => false;
      }
      const m = this.fogMask;
      this.lightLayer.paintSeen({ origin: m.origin, scale: m.scale, w: m.canvas.width, h: m.canvas.height }, L.lights, L.viewers, this.wallSegs().sight, L.key);
      if (this.fogMaskKind !== 's') { sprite.setMask({ mask: this.lightLayer.seenSprite, inverse: true }); this.fogMaskKind = 's'; }
      return (p) => this.lightLayer.seenAt(p);
    }
    const g = this.visionG;
    g.clear();
    const circles = sprite.visible ? this.visionNow() : [];
    if (!circles.length) {
      if (this.fogMaskKind) { sprite.setMask({ mask: null }); this.fogMaskKind = ''; }
      return sprite.visible ? () => false : null;
    }
    // a wall cuts the circle back to what the token could really see from where it stands
    const sight = this.wallSegs().sight;
    const shapes: { x: number; y: number; r: number; poly: Vec[] | null }[] = [];
    for (const c of circles) {
      if (sight.length) {
        const v = visibilityPolygon({ x: c.x, y: c.y }, c.r, sight, 64, c.alt);
        if (!v.free) { g.poly(v.poly.flatMap((q) => [q.x, q.y])); shapes.push({ ...c, poly: v.poly }); continue; }
      }
      g.circle(c.x, c.y, c.r);
      shapes.push({ ...c, poly: null });
    }
    g.fill(0xffffff);
    if (this.fogMaskKind !== 'g') { sprite.setMask({ mask: g, inverse: true }); this.fogMaskKind = 'g'; }
    return (p) => shapes.some((c) => (c.poly ? pointInPoly(p, c.poly) : Math.hypot(p.x - c.x, p.y - c.y) <= c.r));
  }

  /** Whose turn is it, as far as this viewer is allowed to know? */
  private currentTurnToken(): string | null {
    const scene = this.client.scene;
    if (!scene) return null;
    if (this.client.isDM && !this.ui.data.dmPreview) {
      const init = withoutLights(scene.init, scene.tokens);
      return init.entries.find((e) => e.id === init.turn)?.tk ?? null;
    }
    const pub = this.client.isDM ? toPub(withoutLights(scene.init, scene.tokens), scene.tokens) : scene.initPub;
    return pub?.entries.find((e) => e.id === pub.turn)?.tk ?? null;
  }

  // ------------------------------------------------------------------ auras
  private auraCache = new Map<string, Vec[] | null>();
  /** the squares an aura covers, worked out once per square the token stands on (null: too big to draw square by square) */
  private auraCellsFor(grid: GridSettings, size: number, at: Vec, a: Aura): Vec[] | null {
    const centre = snapTokenCenter(grid, size, at);
    const key = `${grid.shape}|${grid.cell}|${grid.ft}|${grid.ox}|${grid.oy}|${size}|${Math.round(centre.x)},${Math.round(centre.y)}|${a.r}|${a.shape}|${a.edge}`;
    if (this.auraCache.has(key)) return this.auraCache.get(key)!;
    if (this.auraCache.size > 400) this.auraCache.clear();
    const cells = auraCells(grid, centre, size * grid.cell, a);
    const res = cells.length > MAX_COVERED ? null : cells;
    this.auraCache.set(key, res);
    return res;
  }

  private drawAuras() {
    const g = this.auraG;
    g.clear();
    const grid = this.client.grid;
    const dmView = this.client.isDM && !this.ui.data.dmPreview;
    const z = this.cam.zoom;
    for (const v of this.views.values()) {
      const t = v.token;
      if (this.outOfSight.has(t.id)) continue;
      for (const a of t.auras) {
        if ((a.dm && !dmView) || a.r <= 0) continue;
        const r = (a.r / grid.ft) * grid.cell + (a.edge ? (t.size * grid.cell) / 2 : 0);
        const col = num(a.color);
        // following the grid lines: whole squares (or hexes), outlined along their sides, like a spell template
        const cells = a.g ? this.auraCellsFor(grid, t.size, v.display, a) : null;
        if (cells) {
          for (const c of cells) g.poly(cellPoly(grid, c).flatMap((p) => [p.x, p.y]));
          g.fill({ color: col, alpha: a.a });
          for (const [p, q] of outlineEdges(grid, cells)) g.moveTo(p.x, p.y).lineTo(q.x, q.y);
          g.stroke({ width: 2 / z, color: col, alpha: Math.min(1, a.a + 0.45), cap: 'round', join: 'round' });
          continue;
        }
        if (a.shape === 'square') g.rect(v.display.x - r, v.display.y - r, r * 2, r * 2);
        else g.circle(v.display.x, v.display.y, r);
        g.fill({ color: col, alpha: a.a }).stroke({ width: 2 / z, color: col, alpha: Math.min(1, a.a + 0.45) });
      }
    }
    // a golden halo behind the token whose turn it is
    const turnTk = this.currentTurnToken();
    const tv = turnTk ? this.views.get(turnTk) : null;
    if (tv) {
      const r = (tv.token.size * grid.cell) / 2;
      const w = Math.max(4, grid.cell * 0.09);
      g.circle(tv.display.x, tv.display.y, r + w * 1.2).fill({ color: 0xffd43b, alpha: 0.28 });
      g.circle(tv.display.x, tv.display.y, r + w * 0.6).stroke({ width: w, color: 0xffd43b, alpha: 0.95 });
    }
  }

  // ------------------------------------------------------------------ test moves and the ruler
  private onUiChange() {
    const u = this.ui.data;
    const prev = this.prevUi;
    this.prevUi = { testMove: u.testMove, sharePlot: u.sharePlot, tool: u.tool, rulerColor: u.rulerColor, cover: u.tplCover, heights: u.heightView, draft: u.fxDraft, sel: u.drawSel };
    if (u.drawSel !== prev.sel && this.client.scene) this.refreshDraws();
    if (u.fxDraft !== prev.draft && this.client.scene) this.reconcileTokens();
    if (prev.testMove && !u.testMove && this.testMoves.size) this.resetTestMoves();
    if (u.sharePlot !== prev.sharePlot) this.publishLive(true);
    if (u.rulerColor !== prev.rulerColor) { this.publishLive(); this.invalidate(); }
    if (u.tplCover !== prev.cover || u.heightView !== prev.heights || (prev.tool === 'height') !== (u.tool === 'height')) this.refreshDraws();
    if (prev.tool !== u.tool) {
      this.cancelPress();
      if (prev.tool === 'height' && this.selectedAreas().length) this.ui.selectDrawings([]);
      if (prev.tool === 'wall') { this.wallStart = null; this.wallHover = null; this.wallPreview = null; if (u.wallSel.size) this.ui.set({ wallSel: new Set() }); }
      if (this.ruler && u.tool !== 'ruler') { this.ruler = null; this.publishLive(); }
    }
  }

  /** Show (or stop showing) my ruler and test moves to everyone else, according to the share switch. */
  private publishLive(force = false) {
    const share = this.ui.data.sharePlot;
    const ghosts = share ? Object.fromEntries([...this.testMoves].map(([id, m]) => [id, { ...m.to, via: m.via.length ? m.via : undefined }])) : {};
    const ruler = share && this.ruler ? { ...this.ruler, via: this.ruler.via.length ? this.ruler.via : undefined, c: this.ui.data.rulerColor || undefined } : null;
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
    if (this.ui.data.testMulti && cur) {
      // a move in several steps: where it was becomes a corner, and the new place is the end
      if (Math.hypot(to.x - cur.to.x, to.y - cur.to.y) < 1) return;
      this.testMoves.set(id, { from, to: { ...to }, via: [...cur.via, cur.to].slice(-MAX_VIA) });
      v.testPos = { ...to }; v.target = { ...to };
    } else if (Math.hypot(to.x - from.x, to.y - from.y) < 1) { this.testMoves.delete(id); v.testPos = null; v.target = { ...from }; }
    else { this.testMoves.set(id, { from, to: { ...to }, via: [] }); v.testPos = { ...to }; v.target = { ...to }; }
  }

  /** Remember how the test moves look now, before they change (a right-click goes back to it). */
  private pushTestHistory() {
    this.testHistory.push(new Map([...this.testMoves].map(([id, m]) => [id, { from: { ...m.from }, to: { ...m.to }, via: m.via.map((p) => ({ ...p })) }])));
    if (this.testHistory.length > 60) this.testHistory.shift();
  }

  /** Go back one step of the tried-out moves. False when there is nothing to go back to. */
  stepBackTest(): boolean {
    const scene = this.client.scene;
    if (!scene || !this.testMoves.size) return false;
    const snap = this.testHistory.pop();
    if (!snap) return false;
    for (const [id] of this.testMoves) {
      if (snap.has(id)) continue;
      const v = this.views.get(id);
      const m = this.testMoves.get(id)!;
      if (v) { v.testPos = null; v.target = { ...m.from }; }
    }
    this.testMoves.clear();
    for (const [id, m] of snap) {
      const t = scene.tokens.get(id);
      const v = this.views.get(id);
      // a token that somebody else has moved since is no longer being tried out
      if (!t || !v || Math.hypot(t.x - m.from.x, t.y - m.from.y) > 1) continue;
      this.testMoves.set(id, m);
      v.testPos = { ...m.to }; v.target = { ...m.to };
    }
    this.afterTestChange();
    return true;
  }

  /** Make every test move real (one undo step). */
  keepTestMoves() {
    if (!this.testMoves.size) return;
    const moves = [...this.testMoves].map(([id, m]) => ({ id, x: m.to.x, y: m.to.y }));
    const before = [...this.testMoves].map(([id, m]) => ({ id, x: m.from.x, y: m.from.y }));
    for (const id of this.testMoves.keys()) { const v = this.views.get(id); if (v) v.testPos = null; }
    this.testMoves.clear();
    this.testHistory = [];
    void this.client.moveTokens(moves, before);
    this.afterTestChange();
    this.cb.onNotice(moves.length > 1 ? 'Moves made' : 'Move made', 'ok');
  }

  /** Put every tried-out token back where it was. */
  resetTestMoves() {
    if (!this.testMoves.size) return;
    for (const [id, m] of this.testMoves) { const v = this.views.get(id); if (v) { v.testPos = null; v.target = { ...m.from }; } }
    this.testMoves.clear();
    this.testHistory = [];
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
    const area = sceneRect(meta) ?? { x: 0, y: 0, w: 2000, h: 1500 };
    const vis = this.visibleRect();
    const x0 = Math.max(area.x, vis.x);
    const x1 = Math.min(area.x + area.w, vis.x + vis.w);
    const y0 = Math.max(area.y, vis.y);
    const y1 = Math.min(area.y + area.h, vis.y + vis.h);
    if (x1 <= x0 || y1 <= y0) return;
    if (isHex(meta.grid)) {
      // every hex draws three of its six sides, so a side shared by two hexes is drawn once (a see-through line stays an even colour)
      const pad = cell;
      for (const c of hexCentersIn(meta.grid, { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 })) {
        if (c.x < area.x || c.x > area.x + area.w || c.y < area.y || c.y > area.y + area.h) continue;
        const k = hexCorners(meta.grid, c);
        g.moveTo(k[0].x, k[0].y).lineTo(k[1].x, k[1].y).lineTo(k[2].x, k[2].y).lineTo(k[3].x, k[3].y);
      }
      g.stroke({ width: 1.25 / this.cam.zoom, color: num(color), alpha: opacity });
      return;
    }
    for (let i = Math.ceil((x0 - ox) / cell); ox + i * cell <= x1; i++) g.moveTo(ox + i * cell, y0).lineTo(ox + i * cell, y1);
    for (let j = Math.ceil((y0 - oy) / cell); oy + j * cell <= y1; j++) g.moveTo(x0, oy + j * cell).lineTo(x1, oy + j * cell);
    g.stroke({ width: 1.25 / this.cam.zoom, color: num(color), alpha: opacity });
  }

  // ------------------------------------------------------------------ fog
  private updateFog() {
    const meta = this.client.scene?.meta;
    if (!meta || !meta.fog.enabled) { if (this.fogSprite) this.fogSprite.visible = false; this.dirty = true; return; }
    const rect = sceneRect(meta) ?? { x: 0, y: 0, w: 2000, h: 1500 };
    const changed = this.fogMask.sync(this.client.fogOpsSorted(), meta.fog, rect);
    const sizeKey = `${this.fogMask.canvas.width}x${this.fogMask.canvas.height}`;
    if (!this.fogSprite) {
      this.fogSprite = new Sprite(Texture.EMPTY);
      this.fogLayer.addChild(this.fogSprite, this.visionG, this.lightLayer.seenSprite);
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
        // move to the start of the arc first, otherwise Pixi joins it to the origin with a line across the whole map
        const rr = (10 + 14 * k) / z;
        g.moveTo(this.press.w.x, this.press.w.y - rr);
        g.arc(this.press.w.x, this.press.w.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ width: 3 / z, color: col, alpha: 0.9 });
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
    const xm = this.ui.data.extraSel ? meta?.maps.find((m) => m.id === this.ui.data.extraSel) : null;
    if (xm) g.rect(xm.x, xm.y, xm.w * xm.scale, xm.h * xm.scale).stroke({ width: lw, color: SELECT });

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
      const tm = this.testMoves.get(d.anchor);
      const o = tm?.from ?? d.origins.get(d.anchor);
      if (a && o) {
        // a move in several steps keeps the corners it has already turned at; the leg being dragged goes on from the last one
        const before = this.ui.data.testMulti && tm ? [tm.from, ...tm.via, tm.to] : [o];
        const lastLeg = before[before.length - 1];
        if (before.length > 1) this.dashedLine(g, before, 0xffffff, z);
        g.moveTo(lastLeg.x, lastLeg.y).lineTo(a.display.x, a.display.y).stroke({ width: 2 / z, color: 0xffffff, alpha: 0.7 });
        const cost = this.moveCost([...before, { x: a.display.x, y: a.display.y }], a.token.fly);
        const ft = cost.ft;
        // walking up onto a cliff or off a ledge: say so
        const climb = a.token.fly ? '' : heightChangeNote(this.heightOf(a.token, lastLeg).alt, this.heightOf(a.token, a.display).alt);
        const note = [climb, cost.note].filter(Boolean).join(' · ');
        this.distText.text = note ? `${ft} ft · ${note}` : `${ft} ft`;
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

  /** A measurement of one or more legs. Returns the next free label slot. */
  private paintRuler(g: Graphics, z: number, r: { a: Vec; b: Vec; via?: Vec[] }, color: number, name: string, li: number): number {
    const grid = this.client.grid;
    const pts = [r.a, ...(r.via ?? []), r.b];
    for (const [w, c, a] of [[6 / z, 0x000000, 0.35], [3 / z, color, 1]] as const) {
      g.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: w, color: c, alpha: a, cap: 'round', join: 'round' });
    }
    pts.forEach((p, i) => g.circle(p.x, p.y, (i === 0 || i === pts.length - 1 ? 6 : 4.5) / z).fill(color).stroke({ width: 2 / z, color: 0xffffff }));
    const rise = pts.slice(1).map((p, i) => this.pointAlt(p) - this.pointAlt(pts[i]));
    if (pts.length === 2) {
      const up = rise[0];
      const flat = distanceFt(grid, r.a, r.b);
      const ft = up ? distanceFt(grid, r.a, r.b, grid.rule, up) : flat;
      this.plotLabel(li++, `${name ? name + ': ' : ''}${ft} ft${heightNote(flat, up)}`, r.b.x, r.b.y - 12 / z, color);
      return li;
    }
    // several legs: the distance so far at every corner, and the whole at the end
    for (let i = 2; i < pts.length; i++) {
      const total = pathFt(grid, pts.slice(0, i + 1), rise.slice(0, i));
      this.plotLabel(li++, i === pts.length - 1 ? `${name ? name + ': ' : ''}${total} ft` : `${total} ft`, pts[i].x, pts[i].y - 12 / z, color);
    }
    return li;
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
      const dd = this.shownDrawing(id);
      if (!dd || dd.k === 'terrain') continue; // painted ground outlines itself
      const b = this.drawLayer.boundsOf(dd, grid);
      const mv = d?.kind === 'drawmove' && d.ids.includes(id) ? d : null;
      const pad = 5 / z;
      g.rect(b.x - pad + (mv?.dx ?? 0), b.y - pad + (mv?.dy ?? 0), b.w + pad * 2, b.h + pad * 2).stroke({ width: 1.5 / z, color: SELECT });
    }
    // handles to drag the edges, corners or ends of one selected drawing
    if (u.drawSel.size === 1 && d?.kind !== 'drawmove' && (u.tool === 'select' || u.tool === 'height' || (u.tool === 'draw' && u.drawTool !== 'erase'))) {
      const dd = this.shownDrawing([...u.drawSel][0]);
      if (dd && this.client.canEditDrawing(dd)) {
        const hs = 4.5 / z;
        for (const h of handlesOf(dd)) g.rect(h.x - hs, h.y - hs, hs * 2, hs * 2).fill(0xffffff).stroke({ width: 1.5 / z, color: SELECT });
      }
    }

    // the shape being dragged out
    if (d?.kind === 'shape') {
      const isT = isTemplate(d.dk);
      if (d.hz != null) {
        const zc = zoneColor(d.hz);
        paintShape(g, { k: d.dk, pts: d.pts, color: zc, w: Math.max(2, grid.cell * 0.05), fill: 0.4, fc: zc, dash: false, bw: 5 }, grid, 0.85, false);
        if (d.pts.length >= 2) this.plotLabel(li++, `${d.hz} ft`, (d.pts[0].x + d.pts[1].x) / 2, Math.min(d.pts[0].y, d.pts[1].y) - 8 / z, num(zc));
      } else paintShape(g, {
        k: d.dk, pts: d.pts, color: u.drawColor, w: isT ? Math.max(2, this.strokePx()) : this.strokePx(),
        fill: !isT && (d.dk === 'rect' || d.dk === 'ellipse') ? FILL_LEVEL[u.drawFillMode] : 0, fc: u.drawFillColor, dash: !isT && u.drawDash, bw: u.tplWidth, of: d.of,
      }, grid, 0.85, u.tplCover, this.wallSegs().sight, (p) => groundAt(this.zones, p));
      if (isT && d.pts.length >= 2) this.plotLabel(li++, templateLabel(d.dk, grid, d.pts[0], d.pts[1], u.tplWidth, footprintPx(grid, d.of ?? 0)), d.pts[1].x, d.pts[1].y - 12 / z, num(u.drawColor));
    }

    // the Heights brush: where it would paint, the stroke so far, and areas being carried to a new place
    if (d?.kind === 'ramp') {
      const levels = rampCells(grid, d.a, d.b, u.rampFrom, u.rampTo, u.heightBrush);
      for (const l of levels) {
        const col = num(heightColor(l.h));
        for (const c of l.cells) g.poly(cellPoly(grid, c).flatMap((p) => [p.x, p.y]), true);
        g.fill({ color: col, alpha: 0.55 });
      }
      g.moveTo(d.a.x, d.a.y).lineTo(d.b.x, d.b.y).stroke({ width: 2 / z, color: 0xffffff, alpha: 0.85 });
      g.circle(d.a.x, d.a.y, 5 / z).fill(0xffffff);
      g.circle(d.b.x, d.b.y, 5 / z).fill(0xffffff);
      this.plotLabel(li++, `${u.rampFrom} ft`, d.a.x, d.a.y - Math.max(grid.cell * 0.7, 18 / z), 0xffffff);
      this.plotLabel(li++, `${u.rampTo} ft`, d.b.x, d.b.y - Math.max(grid.cell * 0.7, 18 / z), 0xffffff);
    }
    if (d?.kind === 'terrain') li = this.paintBrush(g, z, d.last, d, li);
    else if (!d && u.tool === 'height' && (u.heightMode === 'paint' || u.heightMode === 'erase' || u.groundKind === 'rough') && this.pointerW && this.client.isDM) li = this.paintBrush(g, z, this.pointerW, null, li);
    if (d?.kind === 'drawmove' && d.moved) this.paintMoveGhost(g, d);

    // the Walls tool: the wall being drawn, the next point, a selection box
    if (u.tool === 'wall' && this.client.isDM) li = this.paintWallTool(g, z, li);

    // an erase swipe
    if (d?.kind === 'erase' && this.pointerW) g.circle(this.pointerW.x, this.pointerW.y, 6 / z).stroke({ width: 1.5 / z, color: 0xff6b6b });

    // my ruler, then everybody else's
    const myCol = num(u.rulerColor || c.me?.color || '#ffffff');
    if (this.ruler) li = this.paintRuler(g, z, this.ruler, myCol, '', li);
    for (const [uid, lv] of scene.live) {
      if (uid === c.uid) continue;
      const p = c.players.get(uid);
      const col = num(p?.color ?? '#ffffff');
      if (lv.ruler) li = this.paintRuler(g, z, lv.ruler, lv.ruler.c ? num(lv.ruler.c) : col, p?.name ?? '', li);
      for (const [id, pos] of Object.entries(lv.ghosts)) {
        const t = scene.tokens.get(id);
        if (!t || !this.visibleToViewer(t)) continue;
        const path = [{ x: t.x, y: t.y }, ...(pos.via ?? []), { x: pos.x, y: pos.y }];
        this.dashedLine(g, path, col, z);
        li = this.testLabel(li, path, t, col, p?.name ?? '');
      }
    }

    // my test moves: a dashed line from where the token really is to where I am trying it
    for (const [id, m] of this.testMoves) {
      if (d?.kind === 'tokens' && d.moved && d.ids.includes(id)) continue; // the live drag draws its own
      const t = scene.tokens.get(id);
      if (!t) continue;
      const path = [m.from, ...m.via, m.to];
      this.dashedLine(g, path, 0xffffff, z);
      li = this.testLabel(li, path, t, 0xffffff, '');
    }
  }

  /** A dashed line through the points (and a dot at each corner in between). */
  private dashedLine(g: Graphics, pts: Vec[], color: number, z: number) {
    for (const [p, q] of dashSegments(pts, 9 / z, 6 / z)) g.moveTo(p.x, p.y).lineTo(q.x, q.y);
    g.stroke({ width: 2.5 / z, color, alpha: 0.9, cap: 'round' });
    for (const p of pts.slice(1, -1)) g.circle(p.x, p.y, 4 / z).fill({ color, alpha: 0.9 });
  }

  private testLabel(li: number, path: Vec[], t: Token, color: number, name: string): number {
    const grid = this.client.grid;
    const to = path[path.length - 1];
    const cost = this.moveCost(path, t.fly);
    this.plotLabel(li, `${name ? name + ': ' : ''}${cost.ft} ft${cost.note ? ` (${cost.note})` : ''}`, to.x, to.y - (t.size * grid.cell) / 2 - 6 / this.cam.zoom, color);
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
    on(canvas, 'dblclick', (e: MouseEvent) => this.onDoubleClick(e));
    on(canvas, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e));
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.shiftDown = e.shiftKey;
      if (e.code === 'Space') { this.spaceDown = false; this.updateCursor(); }
      const k = e.key.toLowerCase();
      if (k === 'q') this.setTeleport(false);
      this.panKeys.delete(k);
    });
    on(window, 'blur', () => { this.setTeleport(false); this.panKeys.clear(); });
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
    const panBtn = this.ui.data.panButton === 'middle' ? 1 : 2;
    if (e.button === panBtn || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: this.cam.tx, ty: this.cam.ty, moved: false, button: e.button };
      this.updateCursor();
      return;
    }
    if (e.button === 1 && this.pingMode() === 'middle') {
      if (this.client.canDo('ping')) { void this.client.ping(w.x, w.y); this.invalidate(); }
      return;
    }
    if (e.button === 2) {
      // the right button is free (the view pans with the middle one): a plain click opens the menu
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: this.cam.tx, ty: this.cam.ty, moved: false, button: 2, noPan: true };
      return;
    }
    if (e.button !== 0) return;

    const tool = this.ui.data.tool;
    if (tool === 'select' || tool === 'height' || (tool === 'draw' && this.ui.data.drawTool !== 'erase')) {
      const hh = this.handleAt(w);
      if (hh) { this.drag = { kind: 'drawresize', id: hh.d.id, handle: hh.h.id, orig: hh.d, patch: null }; return; }
    }
    if (tool === 'grid' && this.client.isDM) { this.drag = { kind: 'rect', start: w, cur: w }; return; }
    if (tool === 'fog' && this.client.isDM) { this.startFog(w, e); return; }
    if (tool === 'draw') { this.startDraw(w, e); return; }
    if (tool === 'height' && this.client.isDM) { this.startHeight(w, e); return; }
    if (tool === 'wall' && this.client.isDM) { this.startWall(w, e); return; }
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
    // the DM opens and closes a door by clicking its diamond (tokens on top of it win)
    if (this.client.isDM && this.ui.data.showWalls && !e.shiftKey) {
      const door = this.doorAt(w);
      if (door) { void this.client.toggleDoor(door.id); return; }
    }
    // a click inside a selected drawing grabs it too, even when its fill is see-through
    const dh = this.hitDrawingAt(w, false) ?? this.hitSelectedDrawingInside(w);
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
    const xid = this.client.isDM ? this.extraAt(w) : null;
    if (xid) {
      const xm = meta!.maps.find((m) => m.id === xid)!;
      this.ui.set({ extraSel: xid, mapSelected: false, selection: new Set(), drawSel: new Set() });
      this.drag = { kind: 'xmap', id: xid, start: w, orig: { x: xm.x, y: xm.y }, moved: false, cur: { x: xm.x, y: xm.y } };
      this.startPress(w, e);
      return;
    }
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
  /** Middle-click pinging needs the middle button, so it only applies while the middle button is not used for panning. */
  private pingMode(): 'middle' | 'hold' {
    return this.ui.data.panButton === 'middle' ? 'hold' : this.ui.data.pingMode;
  }

  private startPress(w: Vec, e: PointerEvent) {
    if (this.pingMode() !== 'hold' || !this.client.canDo('ping')) return;
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

  drawingsShown(): Drawing[] {
    // ground (boxes, circles and brush strokes with a height) is painted by the terrain layer, not here
    const c = this.client;
    // a template its maker kept private is for them and the DM only
    const list = c.drawingsSorted().filter((d) => d.hz == null && d.k !== 'terrain' && !(d.pv && !c.isDM && d.uid !== c.uid));
    const pv = this.drawPreview;
    return pv ? list.map((d) => (d.id === pv.id ? { ...d, ...pv.patch } : d)) : list;
  }

  /** height zones show when the view setting is on, or while the Heights tool is open */
  private zonesVisible(): boolean { return this.ui.data.heightView === 'always' || this.ui.data.tool === 'height'; }

  /** Should the ground be on show right now? (the setting says: always, only in the Heights tool, or while something moves over it) */
  private heightsWanted(): boolean {
    const u = this.ui.data;
    if (u.tool === 'height' || u.heightView === 'always') return true;
    if (u.heightView !== 'auto') return false;
    const d = this.drag;
    if ((d?.kind === 'tokens' && d.moved) || d?.kind === 'ruler') return true;
    return performance.now() < this.heightsUntil;
  }

  /** Keep the ground on show for a moment (after a keyboard step or a height change, when nothing is being dragged). */
  private showHeightsBriefly(ms = 1600) {
    this.heightsUntil = performance.now() + ms;
    this.dirty = true;
  }

  /** Fade the ground in or out (called every frame; cheap when nothing changes). */
  private tickHeights(dt: number) {
    const want = this.heightsWanted();
    if (this.heightsUntil && performance.now() >= this.heightsUntil) { this.heightsUntil = 0; this.dirty = true; }
    else if (this.heightsUntil) this.dirty = true;
    const target = want ? 1 : 0;
    if (this.heightFade === target) return;
    this.heightFade = target > this.heightFade ? Math.min(1, this.heightFade + dt / 0.16) : Math.max(0, this.heightFade - dt / 0.28);
    this.dirty = true;
    this.syncTerrain();
  }

  private shownDrawing(id: string): Drawing | undefined {
    const d = this.client.scene?.draws.get(id);
    const pv = this.drawPreview;
    return d && pv?.id === id ? { ...d, ...pv.patch } : d;
  }

  private refreshDraws() {
    this.drawLayer.sync(this.drawingsShown(), this.client.grid, this.textRes, this.ui.data.tplCover, this.wallsForSpells());
    this.syncTerrain();
    this.invalidate();
  }

  /** The areas that are selected (any of their strokes selected). */
  private selectedAreas(): Area[] {
    return areasSelected(this.zones, this.ui.data.drawSel);
  }

  /** Repaint the high and low ground (a resize that is still being dragged shows as it goes). */
  private syncTerrain() {
    const pv = this.drawPreview;
    const t = pv ? zonesOf(this.client.drawingsSorted().map((d) => (d.id === pv.id ? { ...d, ...pv.patch } : d)), this.client.grid) : this.zones;
    const shown = this.heightFade > 0.001;
    this.terrainLayer.container.alpha = this.heightFade;
    const sel = new Set(this.selectedAreas().map((a) => a.id));
    this.terrainLayer.sync(t, sel, this.textRes, shown, this.ui.data.tool === 'height');
    // build the picture a moment after the ground changes, so it is ready when someone starts dragging (no hitch then)
    if (!shown && t.areas.length) {
      window.clearTimeout(this.warmTimer);
      this.warmTimer = window.setTimeout(() => { if (!this.destroyed && this.heightFade <= 0.001) this.terrainLayer.sync(t, sel, this.textRes, false, false, true); }, 400);
    }
  }

  /** The resize handle under the pointer, for the one drawing that is selected. */
  private handleAt(p: Vec): { d: Drawing; h: ReturnType<typeof handlesOf>[number] } | null {
    if (this.ui.data.drawSel.size !== 1) return null;
    const d = this.shownDrawing([...this.ui.data.drawSel][0]);
    if (!d || !this.client.canEditDrawing(d)) return null;
    const r = 7 / this.cam.zoom;
    for (const h of handlesOf(d)) if (Math.abs(p.x - h.x) <= r && Math.abs(p.y - h.y) <= r) return { d, h };
    return null;
  }

  private hitSelectedDrawingInside(p: Vec): Drawing | null {
    for (const id of this.ui.data.drawSel) {
      const d = this.client.scene?.draws.get(id);
      if (d && this.client.canEditDrawing(d) && hitDrawing(d, p, 6 / this.cam.zoom, this.client.grid, true)) return d;
    }
    return null;
  }

  private hitDrawingAt(p: Vec, solid: boolean): Drawing | null {
    const list = this.client.drawingsSorted().filter((d) => d.k !== 'terrain' && (d.hz == null || this.zonesVisible()));
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
    if (tool === 'text') {
      const hit = this.hitDrawingAt(w, true);
      if (hit && hit.k === 'text') this.startTextEdit(hit);
      else this.startTextEdit(null, w);
      return;
    }
    if (tool === 'erase') { this.drag = { kind: 'erase', ids: new Set() }; this.eraseAt(w); return; }
    this.drag = { kind: 'shape', dk: tool, start: w, pts: tool === 'pen' ? [w] : [w, w] };
  }

  /**
   * Fly the selected tokens up or down by `ft` feet (] and [). From the ground, up lifts a token off it;
   * coming down to the ground lands it. Only tokens the person may edit are touched.
   */
  /** Where an arrow-key step ends. On hexes it is put on the exact hex, so repeated steps never drift off the grid. */
  private nudged(_t: unknown, size: number, to: Vec): Vec {
    const g = this.client.grid;
    return g.snap && isHex(g) ? snapTokenCenter(g, size, to) : to;
  }

  /** Holding Q (DM): drags become jumps. Says so on screen while it is on. */
  private setTeleport(on: boolean) {
    if (this.teleportHeld === on) return;
    this.teleportHeld = on;
    const msg = 'Teleport: drag a token anywhere. Walls and distance do not count.';
    if (on) this.ui.set({ status: msg });
    else if (this.ui.data.status === msg) this.ui.set({ status: null });
  }

  /** (DM) put the selected tokens down around a point, as a jump. They keep their arrangement. */
  teleportSelectedTo(at: Vec) {
    const c = this.client;
    const toks = [...this.ui.data.selection].map((id) => c.scene?.tokens.get(id)).filter((t): t is Token => !!t && c.canDo('move', t));
    if (!toks.length || !c.isDM) return;
    const cx = toks.reduce((a, t) => a + t.x, 0) / toks.length, cy = toks.reduce((a, t) => a + t.y, 0) / toks.length;
    const g = c.grid;
    const before = toks.map((t) => ({ id: t.id, x: t.x, y: t.y }));
    const moves = toks.map((t) => {
      const p = { x: at.x + (t.x - cx), y: at.y + (t.y - cy) };
      return { id: t.id, ...(g.snap ? snapTokenCenter(g, t.size, p) : p) };
    });
    void c.moveTokens(moves, before, { teleport: true });
  }

  /** Bring the selected tokens into view (or fit the map when nothing is selected). */
  focusSelection() {
    const c = this.client;
    const toks = [...this.ui.data.selection].map((id) => c.scene?.tokens.get(id)).filter((t): t is Token => !!t);
    if (!toks.length) { this.fit(); return; }
    const cell = c.grid.cell;
    const minX = Math.min(...toks.map((t) => t.x)), maxX = Math.max(...toks.map((t) => t.x));
    const minY = Math.min(...toks.map((t) => t.y)), maxY = Math.max(...toks.map((t) => t.y));
    const w = Math.max(maxX - minX + cell * 6, cell * 12);
    const h = Math.max(maxY - minY + cell * 6, cell * 8);
    this.showRect({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h });
  }

  /** Tab / Shift+Tab: select the next token you control (the DM: the next token on the board). */
  cycleSelection(dir: 1 | -1) {
    const c = this.client;
    const all = [...(c.scene?.tokens.values() ?? [])].filter((t) => (c.isDM ? true : c.canDo('move', t)) && (c.isDM || !t.hidden));
    all.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!all.length) return;
    const cur = [...this.ui.data.selection][0];
    const i = all.findIndex((t) => t.id === cur);
    const next = all[(i < 0 ? (dir === 1 ? 0 : all.length - 1) : (i + dir + all.length) % all.length)];
    this.ui.select([next.id]);
    this.focusSelection();
  }

  raiseSelected(ft: number) {
    const ids = [...this.ui.data.selection].filter((id) => { const t = this.client.scene?.tokens.get(id); return !!t && this.client.canDo('edit', t); });
    if (!ids.length) return;
    // each token goes up or down from where it is now, so a group keeps its spacing
    for (const id of ids) {
      const t = this.client.scene!.tokens.get(id)!;
      const a = this.heightOf(t);
      void this.client.updateTokens([id], setAltitude(a.alt + ft, a.ground));
    }
    const t0 = this.client.scene!.tokens.get(ids[0])!;
    const a0 = this.heightOf(t0);
    const to = Math.max(a0.ground, a0.alt + ft);
    this.cb.onNotice(ids.length === 1 ? (to > a0.ground ? `${t0.name || 'Token'} flies ${to - a0.ground} ft above the ground` : `${t0.name || 'Token'} lands`) : `${ids.length} tokens ${ft > 0 ? 'up' : 'down'} ${Math.abs(ft)} ft`, 'info');
  }

  /** The area the brush adds to: the one area that is selected (an old-style box or circle cannot take more paint). */
  private currentArea(): Area | null {
    const a = this.selectedAreas();
    return a.length === 1 && !a[0].legacy ? a[0] : null;
  }

  /**
   * The Heights tool. Paint lays down ground (in the selected area, or a new one), Rub out takes it away, Move slides whole areas.
   * Ctrl/Cmd-click picks the area under the pointer in any of them; Shift adds it to the selection.
   */
  private startHeight(w: Vec, e: PointerEvent) {
    const u = this.ui.data;
    const rough = u.groundKind === 'rough';
    // difficult ground can only be painted and rubbed out
    const mode = rough && (u.heightMode === 'move' || u.heightMode === 'ramp') ? 'paint' : u.heightMode;
    if (mode === 'ramp') {
      const grid = this.client.grid;
      const free = e.altKey;
      const p = free ? w : (u.heightBrush % 2 === 1 || isHex(grid)) ? snapToCellCenter(grid, w) : snapToCorner(grid, w);
      this.drag = { kind: 'ramp', a: p, b: p };
      return;
    }
    if (!rough && (mode === 'move' || e.ctrlKey || e.metaKey)) {
      const a = areaAt(this.zones, w);
      if (!a) { if (!e.shiftKey) this.ui.selectDrawings([]); return; }
      const sel = new Set(u.drawSel);
      const has = a.ids.some((id) => sel.has(id));
      if (e.shiftKey) {
        for (const id of a.ids) { if (has) sel.delete(id); else sel.add(id); }
        this.ui.selectDrawings(sel);
        if (has || mode !== 'move') return;
      } else if (!has) this.ui.selectDrawings(a.ids);
      if (mode !== 'move') return;
      const mine = this.selectedAreas();
      const ids = mine.flatMap((x) => x.ids).filter((id) => { const d = this.client.scene?.draws.get(id); return !!d && this.client.canEditDrawing(d); });
      if (!ids.length) return;
      const snap = !e.altKey && mine.some((x) => x.paint.some((s) => s.kind === 'cells'));
      this.drag = { kind: 'drawmove', ids, start: w, dx: 0, dy: 0, moved: false, snap };
      return;
    }
    const erase = mode === 'erase';
    const cur = rough ? null : this.currentArea();
    const d: Extract<Drag, { kind: 'terrain' }> = {
      kind: 'terrain', erase, group: rough ? 'dt' : cur?.id ?? (erase ? '' : newAreaId()), rough,
      h: rough ? 1 : cur ? cur.h : u.heightFt, add: cur ? cur.add : u.heightAdds,
      cells: u.heightSnap !== e.altKey ? new Map() : null, pts: [], last: w, size: u.heightBrush,
    };
    this.drag = d;
    this.paintTerrainAt(d, w, true);
  }

  /** Add the ground under the brush as it moves from the last spot to `w`. */
  private paintTerrainAt(d: Extract<Drag, { kind: 'terrain' }>, w: Vec, first = false) {
    const grid = this.client.grid;
    if (d.cells) {
      for (const c of cellsAlong(grid, first ? w : d.last, w, d.size)) {
        const k = cellKey(grid, c);
        if (!d.cells.has(k) && d.cells.size < MAX_STROKE_CELLS) d.cells.set(k, c);
      }
    } else if (first) d.pts = [w];
    else if (Math.hypot(w.x - d.last.x, w.y - d.last.y) * this.cam.zoom > 2) d.pts.push(w);
    d.last = w;
  }

  /** Lay a ramp down: ground that climbs from one end to the other in 5 ft steps, each step an area of its own. */
  private commitRamp(d: Extract<Drag, { kind: 'ramp' }>) {
    const grid = this.client.grid;
    const u = this.ui.data;
    const levels = rampCells(grid, d.a, d.b, u.rampFrom, u.rampTo, u.heightBrush);
    if (!levels.length) return;
    const hex = grid.shape !== 'square';
    void this.client.addDrawings(
      levels.map((l) => ({ k: 'terrain' as const, p: joinPts(l.cells), color: heightColor(l.h), w: grid.cell * (hex ? 1.16 : 1), fill: 0, fc: '', dash: false, txt: '', fs: 28, bw: 5, hz: l.h, hg: newAreaId(), ha: false, he: false, hc: true })),
      'Paint ramp',
    ).catch((err: Error) => this.cb.onNotice(err.message, 'error'));
    this.cb.onNotice(`Ramp from ${u.rampFrom} ft to ${u.rampTo} ft`, 'ok');
  }

  private commitTerrain(d: Extract<Drag, { kind: 'terrain' }>) {
    const grid = this.client.grid;
    const hex = grid.shape !== 'square';
    let pts: Vec[];
    let wpx: number;
    if (d.cells) {
      pts = [...d.cells.values()];
      wpx = grid.cell * (hex ? 1.16 : 1);
    } else {
      wpx = Math.max(1, d.size * grid.cell);
      pts = d.pts.length > 2 ? fitPenPoints(d.pts, Math.max(0.5, wpx * 0.06)) : d.pts;
    }
    if (!pts.length) return;
    const col = d.rough ? '#c8791b' : heightColor(d.h);
    const cur = this.selectedAreas();
    const keep = cur.length === 1 && cur[0].id === d.group ? cur[0].ids : [];
    void this.client.addDrawing(
      { k: 'terrain', p: joinPts(pts), color: col, w: wpx, fill: 0, fc: '', dash: false, txt: '', fs: 28, bw: 5, hz: d.erase ? null : d.h, hg: d.group, ha: !d.erase && d.add, he: d.erase, hc: !!d.cells, ...(d.rough ? { dt: true } : {}) },
      { label: d.rough ? (d.erase ? 'Rub out difficult ground' : 'Paint difficult ground') : d.erase ? 'Rub out ground' : 'Paint ground', onId: (id) => { if (!d.erase && !d.rough) this.ui.selectDrawings([...keep, id]); } },
    ).catch((err: Error) => this.cb.onNotice(err.message, 'error'));
  }

  /** What the brush would cover: the cells, or a circle. Drawn as the hover marker and for the stroke in progress. */
  private paintBrush(g: Graphics, z: number, at: Vec, d: Extract<Drag, { kind: 'terrain' }> | null, li: number): number {
    const u = this.ui.data;
    const grid = this.client.grid;
    const erase = d ? d.erase : u.heightMode === 'erase';
    const rough = d ? !!d.rough : u.groundKind === 'rough';
    const cur = rough ? null : this.currentArea();
    const h = d ? d.h : cur ? cur.h : u.heightFt;
    const add = d ? d.add : cur ? cur.add : u.heightAdds;
    const col = erase ? 0xff6b6b : rough ? 0xc8791b : num(heightColor(h));
    const snap = d ? !!d.cells : u.heightSnap !== !!this.altDown;
    const n = d ? d.size : u.heightBrush;
    if (snap) {
      const cells = d?.cells ? [...d.cells.values()] : cellsAlong(grid, at, at, n);
      for (const c of cells) g.poly(cellPoly(grid, c).flatMap((p) => [p.x, p.y]), true);
      g.fill({ color: col, alpha: d ? 0.5 : 0.28 });
      for (const c of cells) g.poly(cellPoly(grid, c).flatMap((p) => [p.x, p.y]), true);
      g.stroke({ width: 1.5 / z, color: col, alpha: 0.9 });
    } else {
      const r = (Math.max(1, n * grid.cell)) / 2;
      if (d && d.pts.length > 1) {
        g.moveTo(d.pts[0].x, d.pts[0].y);
        for (const p of d.pts.slice(1)) g.lineTo(p.x, p.y);
        g.stroke({ width: r * 2, color: col, alpha: 0.45, cap: 'round', join: 'round' });
      } else if (d) g.circle(d.pts[0].x, d.pts[0].y, r).fill({ color: col, alpha: 0.45 });
      g.circle(at.x, at.y, r).stroke({ width: 1.5 / z, color: col, alpha: 0.9 });
    }
    if (!erase && !rough) this.plotLabel(li++, areaLabelAt(add ? groundAt(this.zones, at) + h : h, h, add), at.x, at.y - Math.max(grid.cell * 0.7, 18 / z), col);
    return li;
  }

  /** A faint copy of the areas being moved, where they would land. */
  private paintMoveGhost(g: Graphics, d: Extract<Drag, { kind: 'drawmove' }>) {
    const grid = this.client.grid;
    const ids = new Set(d.ids);
    for (const a of this.zones.areas) {
      if (!a.ids.some((id) => ids.has(id))) continue;
      const col = num(heightColor(a.h));
      for (const s of a.paint) {
        if (s.kind === 'cells') for (const c of s.pts) g.poly(cellPoly(grid, { x: c.x + d.dx, y: c.y + d.dy }).flatMap((p) => [p.x, p.y]), true);
        else if (s.kind === 'rect') g.rect(s.b.x + d.dx, s.b.y + d.dy, s.b.w, s.b.h);
        else if (s.kind === 'ellipse') g.ellipse(s.b.x + d.dx + s.b.w / 2, s.b.y + d.dy + s.b.h / 2, s.b.w / 2, s.b.h / 2);
        else if (s.pts.length === 1) g.circle(s.pts[0].x + d.dx, s.pts[0].y + d.dy, s.r);
        else { g.moveTo(s.pts[0].x + d.dx, s.pts[0].y + d.dy); for (const p of s.pts.slice(1)) g.lineTo(p.x + d.dx, p.y + d.dy); g.stroke({ width: s.r * 2, color: col, alpha: 0.4, cap: 'round', join: 'round' }); }
      }
      g.fill({ color: col, alpha: 0.4 });
    }
  }

  private startTemplate(w: Vec, e: PointerEvent) {
    if (!this.client.canDo('template')) { this.cb.onNotice('The DM has turned off spell templates for players.', 'error'); return; }
    // `start` stays where the pointer went down; where the template really starts depends on its kind and size (see snapTemplate)
    const kind = this.ui.data.tplKind;
    const d: Extract<Drag, { kind: 'shape' }> = { kind: 'shape', dk: kind, start: w, pts: [w, w] };
    if (kind === 'emanation') {
      // it comes out of whoever is standing there: a bigger creature's space is bigger, and the area is measured from its edge
      const grid = this.client.grid;
      const t = this.emanationSource(w, snapToCellCenter(grid, w));
      if (t) { d.fixedOrigin = { x: t.x, y: t.y }; d.of = Math.max(1, t.size) * grid.ft; }
    }
    const sn = this.templateSnap(kind, w, w, e, d);
    d.pts = [sn.a, sn.a];
    d.snap = sn.st;
    this.drag = d;
  }

  private startRuler(w: Vec, e: PointerEvent) {
    if (!this.client.canDo('measure')) { this.cb.onNotice('The ruler is turned off for players.', 'error'); return; }
    const p = this.rulerPoint(w, e);
    if (this.ui.data.rulerMulti && this.ruler && !e.shiftKey) {
      // another leg, from where the last one ended (Shift starts a new measurement instead)
      this.ruler.via = [...this.ruler.via, this.ruler.b].slice(-MAX_VIA);
      this.ruler.b = p;
      this.drag = { kind: 'ruler', extend: true };
    } else {
      this.ruler = { a: p, b: p, via: [] };
      this.drag = { kind: 'ruler' };
    }
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

  /** A template from the pointer-down point to the pointer, put on the grid the way the 2024 rules and the table expect. */
  private templateSnap(kind: DrawKind, start: Vec, w: Vec, e: PointerEvent, d?: Extract<Drag, { kind: 'shape' }>): { a: Vec; b: Vec; st: TemplateSnapState } {
    const grid = this.client.grid;
    const sphereAt = this.ui.data.tplSphereSnap;
    const free = kind === 'sphere' && sphereAt === 'off'; // a sphere that is told not to snap goes exactly where it is put
    return snapTemplate(grid, start, w, {
      origin: grid.snap && !e.altKey && !free, length: !e.altKey && !free, angleStep: e.shiftKey ? Math.PI / 12 : undefined,
      kind, widthPx: kind === 'emanation' ? footprintPx(grid, d?.of ?? 0) : beamWidthPx(grid, this.ui.data.tplWidth), sphereAt,
      fixedOrigin: d?.fixedOrigin, prev: d?.snap,
    });
  }

  /** The token an emanation comes out of: the one under the pointer, or the one standing in the square it snapped to. */
  private emanationSource(w: Vec, snapped: Vec): Token | null {
    const hit = this.hitToken(w);
    if (hit) return hit;
    let best: Token | null = null;
    let bd = this.client.grid.cell * 0.5;
    for (const v of this.views.values()) {
      const dd = Math.hypot(v.token.x - snapped.x, v.token.y - snapped.y);
      if (dd < bd) { bd = dd; best = v.token; }
    }
    return best;
  }

  private moveShape(d: Extract<Drag, { kind: 'shape' }>, w: Vec, e: PointerEvent) {
    const k = d.dk;
    if (isTemplate(k)) {
      const sn = this.templateSnap(k, d.start, w, e, d);
      d.pts = [sn.a, sn.b];
      d.snap = sn.st;
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
    const closed = k === 'rect' || k === 'ellipse';
    if (d.hz != null) {
      const col = zoneColor(d.hz);
      void this.client.addDrawing({ k, p: joinPts(pts), color: col, w: Math.max(2, grid.cell * 0.05), fill: 0.4, fc: col, dash: false, txt: '', fs: 28, bw: 5, hz: d.hz },
        { onId: (id) => this.ui.selectDrawings([id]) }).catch((err: Error) => this.cb.onNotice(err.message, 'error'));
      return;
    }
    void this.client.addDrawing({
      k, p: joinPts(pts), color: u.drawColor, w: isT ? Math.max(2, stroke) : stroke,
      fill: !isT && closed ? FILL_LEVEL[u.drawFillMode] : 0, fc: closed ? u.drawFillColor : '',
      dash: !isT && u.drawDash, txt: '', fs: 28, bw: u.tplWidth, of: k === 'emanation' && d.of ? d.of : undefined, pv: isT && !u.tplShare ? true : undefined,
    }, { onId: (id) => { if (closed || k === 'line' || k === 'arrow' || k === 'pen') this.ui.selectDrawings([id]); } }).catch((err: Error) => this.cb.onNotice(err.message, 'error'));
  }

  // ------------------------------------------------------------------ text
  /** Style for text that is about to be written: the colour, font and size picked in the Draw panel. */
  textDefaults(): Pick<Drawing, 'color' | 'fs' | 'font' | 'b' | 'i' | 'u' | 'ho'> {
    const u = this.ui.data;
    const fs = Math.round(this.client.grid.cell * (u.drawSize === 'thin' ? 0.32 : u.drawSize === 'thick' ? 0.7 : 0.45));
    return { color: u.drawColor, fs, font: u.textFont, b: u.textBold, i: u.textItalic, u: u.textUnderline, ho: false };
  }

  /** Open the text box: on an existing text drawing, or for a new one at `at`. */
  startTextEdit(existing: Drawing | null, at?: Vec) {
    if (!this.client.canDo('draw')) { this.cb.onNotice('Drawing is turned off for players.', 'error'); return; }
    if (existing) {
      const p = existing.p.split(',').map(Number);
      this.ui.selectDrawings([existing.id]);
      this.ui.set({ textEdit: { id: existing.id, x: p[0], y: p[1] } });
      this.drawLayer.setHidden(existing.id);
    } else if (at) {
      this.ui.set({ textEdit: { id: null, x: at.x, y: at.y } });
    }
    this.invalidate();
  }

  /** The text box was closed: save what was typed (or drop the change). */
  finishText(commit: boolean, value: string) {
    const te = this.ui.data.textEdit;
    if (!te) return;
    this.ui.set({ textEdit: null });
    this.drawLayer.setHidden(null);
    this.invalidate();
    if (!commit) return;
    const v = value.replace(/\s+$/, '');
    if (te.id) {
      const cur = this.client.scene?.draws.get(te.id);
      if (!cur) return;
      if (!v.trim()) { void this.client.removeDrawings([te.id], 'Delete text'); this.ui.selectDrawings([]); }
      else if (v !== cur.txt) void this.client.updateDrawings([te.id], { txt: v });
    } else if (v.trim()) {
      void this.client.addDrawing({ k: 'text', p: joinPts([{ x: te.x, y: te.y }]), w: 1, fill: 0, dash: false, txt: v, bw: 5, ...this.textDefaults() },
        { onId: (id) => this.ui.selectDrawings([id]) }).catch((err: Error) => this.cb.onNotice(err.message, 'error'));
    }
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

  private onDoubleClick(e: MouseEvent) {
    if (this.ui.data.tool === 'select') {
      const hit = this.hitDrawingAt(this.screenToWorld(e.clientX, e.clientY), false);
      if (hit?.k === 'text') { this.drag = null; this.startTextEdit(hit); return; }
    }
    if (this.ui.data.tool === 'wall' && this.client.isDM) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.wallDoubleClick(w);
      this.invalidate();
      return;
    }
    if (this.ui.data.tool === 'fog' && this.ui.data.fogShape === 'poly' && this.polyPts.length >= 3) {
      this.polyPts.pop(); // the second click of the double-click added a duplicate point
      this.finishPoly();
    }
  }

  private onPointerMove(e: PointerEvent) {
    const w = this.screenToWorld(e.clientX, e.clientY);
    this.pointerW = w;
    this.altDown = e.altKey;
    this.shiftDown = e.shiftKey;
    if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 6) this.cancelPress();
    const d = this.drag;
    if (!d) {
      const hover = this.ui.data.tool === 'select' && !!this.hitToken(w);
      this.updateCursor(hover);
      if (this.ui.data.tool === 'wall') this.updateWallHover(w);
      if (this.ui.data.tool !== 'select') this.invalidate();
      return;
    }
    this.invalidate();
    switch (d.kind) {
      case 'pan': {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (d.moved && !d.noPan) { this.cam.tx = d.tx + dx; this.cam.ty = d.ty + dy; this.applyCamera(); }
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
      case 'drawresize': {
        d.patch = resizeDrawing(d.orig, d.handle, w, { shift: e.shiftKey, alt: e.altKey, grid: this.client.grid });
        this.drawPreview = { id: d.id, patch: d.patch };
        this.refreshDraws();
        break;
      }
      case 'erase': this.eraseAt(w); break;
      case 'ruler': if (this.ruler) { this.ruler.b = this.rulerPoint(w, e); this.publishLive(); } break;
      case 'drawmove': {
        let dx = w.x - d.start.x;
        let dy = w.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * this.cam.zoom < 4) break;
        if (d.snap && !e.altKey) {
          // ground made of whole cells goes a whole cell (or hex) at a time, so it stays on the grid
          const a = snapToCellCenter(this.client.grid, d.start), b = snapToCellCenter(this.client.grid, w);
          dx = b.x - a.x; dy = b.y - a.y;
        }
        d.moved = true; d.dx = dx; d.dy = dy;
        this.drawLayer.setOffset(new Set(d.ids), dx, dy);
        break;
      }
      case 'terrain': this.paintTerrainAt(d, w); break;
      case 'ramp': {
        const grid = this.client.grid;
        const n = this.ui.data.heightBrush;
        d.b = e.altKey ? w : (n % 2 === 1 || isHex(grid)) ? snapToCellCenter(grid, w) : snapToCorner(grid, w);
        break;
      }
      case 'wall': case 'wallend': case 'wallmove': case 'wallbox': this.moveWallDrag(d, w, e); break;
      case 'brush': {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(last.x - w.x, last.y - w.y) > this.client.grid.cell / 8) d.pts.push(w);
        break;
      }
      case 'xmap': {
        const dx = w.x - d.start.x, dy = w.y - d.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 2 / this.cam.zoom) d.moved = true;
        if (d.moved) {
          d.cur = { x: d.orig.x + dx, y: d.orig.y + dy };
          this.extras.get(d.id)?.sprite.position.set(d.cur.x, d.cur.y);
          this.invalidate();
        }
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
    const snapIt = !!anchorV && !!anchorO && grid.snap && !e.altKey;
    const snapDelta = snapIt ? (v: Vec): Vec => {
      const sn = snapTokenCenter(grid, anchorV!.token.size, { x: anchorO!.x + v.x, y: anchorO!.y + v.y });
      return { x: sn.x - anchorO!.x, y: sn.y - anchorO!.y };
    } : null;
    if (snapDelta) { const sn = snapDelta({ x: dx, y: dy }); dx = sn.x; dy = sn.y; }
    // walls hold the group back (it walks around them if the drag does)
    const got = this.wallStep(d, { x: dx, y: dy }, snapDelta);
    d.cur = got;
    dx = got.x; dy = got.y;
    const moves: { id: string; x: number; y: number }[] = [];
    for (const id of d.ids) {
      const v = this.views.get(id);
      const o = d.origins.get(id);
      if (!v || !o) continue;
      v.display = { x: o.x + dx, y: o.y + dy };
      v.target = { ...v.display };
      moves.push({ id, x: v.display.x, y: v.display.y });
      v.setAlt(this.heightOf(v.token, v.display), grid);
    }
    if (!this.ui.data.testMove) this.sendMoves(moves, this.teleportHeld);
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
        if (!d.moved && d.button === 2 && this.ui.data.tool === 'wall' && this.wallStart) {
          // right-click lets go of the wall being drawn instead of opening the menu
          this.wallStart = null;
          this.invalidate();
        } else if (!d.moved && d.button === 2 && this.ui.data.tool === 'ruler' && this.ruler) {
          // right-click takes back the last leg of the measurement (the whole of it when it is one leg) instead of opening the menu
          if (this.ruler.via.length) this.ruler.b = this.ruler.via.pop()!;
          else this.ruler = null;
          this.publishLive();
          this.invalidate();
        } else if (!d.moved && d.button === 2 && this.ui.data.testMove && this.testMoves.size && this.stepBackTest()) {
          // right-click goes back one step of a test move instead of opening the menu
        } else if (!d.moved && d.button === 2) {
          const w = this.screenToWorld(e.clientX, e.clientY);
          const hit = this.hitToken(w);
          if (hit && !this.ui.data.selection.has(hit.id)) this.ui.select([hit.id]);
          this.cb.onContextMenu({ clientX: e.clientX, clientY: e.clientY, tokenId: hit?.id ?? null, world: w });
        }
        break;
      case 'tokens': {
        this.sendMoves.cancel();
        if (this.ui.data.testMove) {
          if (d.moved) this.pushTestHistory();
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
        if (moves.length) void this.client.moveTokens(moves, before, { teleport: this.teleportHeld });
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
      case 'xmap':
        if (d.moved) { this.extrasKey = ''; void this.client.updateExtraMap(d.id, { x: Math.round(d.cur.x * 10) / 10, y: Math.round(d.cur.y * 10) / 10 }); }
        break;
      case 'shape': this.commitShape(d); break;
      case 'terrain': this.commitTerrain(d); break;
      case 'ramp': this.commitRamp(d); break;
      case 'wall': this.commitWall(d); break;
      case 'wallend': case 'wallmove': this.finishWallDrag(d); break;
      case 'wallbox': break;
      case 'erase':
        this.drawLayer.setFaded(new Set());
        if (d.ids.size) void this.client.removeDrawings([...d.ids]);
        break;
      case 'ruler': {
        if (this.ruler) {
          // a leg too short to mean anything is dropped (the measurement before it stays)
          const last = this.ruler.via.length ? this.ruler.via[this.ruler.via.length - 1] : this.ruler.a;
          if (Math.hypot(this.ruler.b.x - last.x, this.ruler.b.y - last.y) * this.cam.zoom < 6) {
            if (d.extend && this.ruler.via.length) this.ruler.b = this.ruler.via.pop()!;
            else this.ruler = null;
          }
        }
        this.publishLive();
        break;
      }
      case 'drawmove':
        this.drawLayer.setOffset(new Set(), 0, 0);
        if (d.moved) void this.client.moveDrawings(d.ids, d.dx, d.dy);
        break;
      case 'drawresize': {
        const patch = d.patch;
        if (patch && Object.keys(patch).length) {
          void this.client.updateDrawings([d.id], patch).finally(() => { this.drawPreview = null; this.refreshDraws(); });
        } else { this.drawPreview = null; this.refreshDraws(); }
        break;
      }
      case 'marquee': break;
    }
  }

  /** Ctrl+Z / Ctrl+Y (also used by the toolbar buttons). */
  async runHistory(dir: 'undo' | 'redo') {
    this.wallStart = null; // the point a wall was going to carry on from may be gone
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
    this.shiftDown = e.shiftKey;
    const key = e.key.toLowerCase();
    // Q held while dragging: teleport (the DM's tokens jump, ignoring walls and the ground between)
    if (key === 'q' && !mod && !e.altKey) { if (c.isDM) this.setTeleport(true); return; }
    // W A S D pan the view while held (Shift: faster)
    if (!mod && !e.altKey && (key === 'w' || key === 'a' || key === 's' || key === 'd')) {
      e.preventDefault();
      if (!this.panKeys.has(key)) { this.panKeys.add(key); this.dirty = true; }
      return;
    }

    if (e.key === 'Escape') {
      if (this.testMoves.size) { this.resetTestMoves(); return; }
      if (ui.data.textEdit) { this.finishText(false, ''); return; }
      if (ui.data.tool === 'wall' && (this.wallStart || ui.data.wallSel.size)) {
        // the first Esc lets go of the wall being drawn (or the selection); the next one leaves the tool
        this.wallStart = null; this.drag = null; this.wallPreview = null; this.wallPrevSeq++;
        if (ui.data.wallSel.size) ui.set({ wallSel: new Set() });
        this.invalidate();
        return;
      }
      if (this.drawPreview) { this.drawPreview = null; this.refreshDraws(); }
      this.polyPts = [];
      this.drag = null;
      for (const v of this.views.values()) v.dragging = false;
      // with the Heights tool, the first Esc lets go of the selected ground (so the next stroke starts a new area); the next one leaves the tool
      const holding = ui.data.tool === 'height' && this.selectedAreas().length > 0;
      ui.select([]);
      ui.selectDrawings([]);
      if (!holding && ui.data.tool !== 'select') ui.set({ tool: 'select' });
      this.invalidate();
      return;
    }
    if (e.key === 'Enter' && this.testMoves.size) { this.keepTestMoves(); return; }
    if (e.key === 'Enter' && ui.data.drawSel.size === 1 && !ui.data.textEdit) {
      const dd = c.scene?.draws.get([...ui.data.drawSel][0]);
      if (dd?.k === 'text' && c.canEditDrawing(dd)) { e.preventDefault(); this.startTextEdit(dd); return; }
    }
    if (e.key === 'Enter' && ui.data.tool === 'fog' && this.polyPts.length >= 3) { this.finishPoly(); return; }
    if (e.key === 'Enter' && ui.data.tool === 'wall' && this.wallStart) { this.wallStart = null; this.invalidate(); return; }
    if (e.key.toLowerCase() === 'x' && ui.data.tool === 'wall' && ui.data.wallMode === 'edit' && ui.data.wallSel.size && c.isDM) {
      void c.flipWalls([...ui.data.wallSel]);
      e.preventDefault();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.data.tool === 'wall' && ui.data.wallSel.size && c.isDM) {
      void c.removeWalls([...ui.data.wallSel]);
      ui.set({ wallSel: new Set() });
      e.preventDefault();
      return;
    }

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

    if (e.key.startsWith('Arrow') && !ui.data.selection.size && ui.data.drawSel.size) {
      e.preventDefault();
      const step = c.grid.cell * (e.shiftKey ? 1 : 0.25);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      void c.moveDrawings([...ui.data.drawSel], dx, dy);
      return;
    }
    if (e.key.startsWith('Arrow') && ui.data.selection.size) {
      e.preventDefault();
      const step = c.grid.cell;
      const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : 'down';
      // a square grid steps one square; on hexes the step follows the staggering so up and down stay in line
      this.showHeightsBriefly();
      const delta = (at: Vec): Vec => (isHex(c.grid) ? hexNudge(c.grid, at, dir) : { x: dir === 'left' ? -step : dir === 'right' ? step : 0, y: dir === 'up' ? -step : dir === 'down' ? step : 0 });
      const moves = [...ui.data.selection]
        .map((id) => c.scene?.tokens.get(id))
        .filter((t): t is Token => !!t && c.canDo('move', t))
        .map((t) => { const d = delta(t); return { id: t.id, ...this.nudged(t, t.size, { x: t.x + d.x, y: t.y + d.y }) }; });
      if (moves.length && ui.data.testMove) {
        this.pushTestHistory();
        for (const m of moves) {
          const v = this.views.get(m.id);
          const cur = this.testMoves.get(m.id)?.to ?? (v ? { x: v.token.x, y: v.token.y } : null);
          if (cur) { const d = delta(cur); const to = this.nudged(m, this.views.get(m.id)?.token.size ?? 1, { x: cur.x + d.x, y: cur.y + d.y }); if (this.moveAllowed(cur, to, m.id)) this.setTest(m.id, to); }
        }
        this.afterTestChange();
      } else if (moves.length) {
        // a wall in the way stops that token (the rest of the group still steps)
        const free = moves.filter((m) => { const t = c.scene!.tokens.get(m.id)!; return this.moveAllowed({ x: t.x, y: t.y }, m, m.id); });
        const before = free.map((m) => { const t = c.scene!.tokens.get(m.id)!; return { id: t.id, x: t.x, y: t.y }; });
        if (free.length) void c.moveTokens(free, before);
      }
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'v': ui.set({ tool: 'select' }); break;
      case 'g': if (c.isDM && c.scene?.meta) void c.updateScene({ grid: { visible: !c.scene.meta.grid.visible } }); break;
      case 'f': if (c.isDM) ui.set({ tool: ui.data.tool === 'fog' ? 'select' : 'fog' }); break;
      case 'p': if (c.canDo('draw')) ui.set({ tool: ui.data.tool === 'draw' ? 'select' : 'draw' }); break;
      case 'c': if (c.canDo('template')) ui.set({ tool: ui.data.tool === 'template' ? 'select' : 'template' }); break;
      case 'z': this.focusSelection(); break;
      case 'tab': e.preventDefault(); this.cycleSelection(e.shiftKey ? -1 : 1); break;
      case 'n': if (c.isDM) void c.initStep(e.shiftKey ? -1 : 1); break;
      case 'k': if (c.isDM && ui.data.selection.size) { const ts = [...ui.data.selection].map((id) => c.scene?.tokens.get(id)).filter((t): t is Token => !!t); void c.updateTokens(ts.map((t) => t.id), { hidden: !ts.every((t) => t.hidden) }); } break;
      case 'l': if (c.isDM && ui.data.selection.size) { const ts = [...ui.data.selection].map((id) => c.scene?.tokens.get(id)).filter((t): t is Token => !!t); void c.updateTokens(ts.map((t) => t.id), { locked: !ts.every((t) => t.locked) }); } break;
      case 'r': ui.set({ tool: ui.data.tool === 'ruler' ? 'select' : 'ruler' }); break;
      case 'm': ui.set({ testMove: !ui.data.testMove }); break;
      case 'i': if (c.isDM) ui.set({ initOpen: !ui.data.initOpen }); break;
      case 'h': if (c.isDM) ui.set({ tool: ui.data.tool === 'height' ? 'select' : 'height' }); break;
      case 'b': if (c.isDM) ui.set({ tool: ui.data.tool === 'wall' ? 'select' : 'wall' }); break;
      case ']': this.raiseSelected(5); break;
      case '[': this.raiseSelected(-5); break;
      case '0': this.fit(); break;
      case '+': case '=': this.zoomBy(1.25); break;
      case '-': this.zoomBy(0.8); break;
    }
    this.polyPts = ui.data.tool === 'fog' ? this.polyPts : [];
  }
}
