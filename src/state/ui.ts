import type { Unsub } from '../backend/types';
import { FONT_KEYS, type FillMode, type SphereSnap } from '../core/draw';
import type { Effect, Vec } from '../types';
import type { Side, WallKind, WallSnap } from '../core/walls';

export type Tool = 'select' | 'grid' | 'scale' | 'fog' | 'draw' | 'template' | 'ruler' | 'height' | 'wall' | 'light';
export type DrawTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'erase';
export type TemplateKind = 'cone' | 'cube' | 'sphere' | 'emanation' | 'beam';
export type StrokeSize = 'thin' | 'medium' | 'thick';
export type FogShape = 'rect' | 'poly' | 'brush';
export type DockTab = 'scene' | 'tokens' | 'players';
export type InitPos = 'top' | 'side';

export function terrainBrushMode(u: UiData): UiData['heightMode'] {
  if (u.heightMode === 'move' && u.groundKind === 'rough') return 'paint';
  return u.heightMode;
}

export interface UiData {
  gradientArea?: string;
  gradientFocus?: string;
  heightPatches?: import('../core/terrainEdges').HeightPatch[];
  tool: Tool;
  scaleStart: Vec | null;
  scaleEnd: Vec | null;
  fogMode: 'r' | 'h';
  fogShape: FogShape;
  /** brush diameter in grid squares */
  brushSize: number;
  selection: Set<string>;
  mapSelected: boolean;
  /** the extra map being moved (null: none) */
  extraSel: string | null;
  /** DM: look at the board exactly as players do (opaque fog, no hidden tokens) */
  dmPreview: boolean;
  zoom: number;
  status: string | null;
  /** which right-hand panel is open (null = all collapsed to their little side tabs) */
  dockTab: DockTab | null;
  drawTool: DrawTool;
  tplKind: TemplateKind;
  drawColor: string;
  drawSize: StrokeSize;
  /** shapes: none / light / solid fill */
  drawFillMode: FillMode;
  /** fill colour for new shapes; empty = same as the outline */
  drawFillColor: string;
  /** text defaults */
  textFont: string;
  textBold: boolean;
  textItalic: boolean;
  textUnderline: boolean;
  /** ruler colour; empty = my player colour */
  rulerColor: string;
  drawDash: boolean;
  /** width of a line template in feet */
  tplWidth: number;
  /** where a sphere's centre snaps: the middle of a square, a corner, or nowhere */
  tplSphereSnap: SphereSnap;
  /** light up the squares a template covers */
  tplCover: boolean;
  /** drawings that are selected (token selection is separate) */
  drawSel: Set<string>;
  /** try out token moves without committing them */
  testMove: boolean;
  /** how many tokens are currently being tried out */
  testCount: number;
  /** show my ruler and test moves to everyone */
  sharePlot: boolean;
  /** spell templates I place can be seen by everyone (on), or only by me and the DM (off) */
  tplShare: boolean;
  /** the next spell templates placed count as difficult ground */
  tplRough: boolean;
  /** the Spell templates tool: place new ones, or click the ones already there to move, resize or delete them */
  tplMode: 'place' | 'select';
  /** test move: each drag adds a leg to the move instead of replacing it */
  testMulti: boolean;
  /** ruler: each drag adds a leg to the measurement instead of starting again */
  rulerMulti: boolean;
  /** a map that has just been added is looked at for a printed grid, which is then hidden and used as the grid */
  autoGrid: boolean;
  /** which scenes the scene picker lists: 'all', 'none' (in no folder) or a folder's id */
  sceneFolder: string;
  /** which mouse button pans the view (the other one opens the menu / pings) */
  panButton: 'right' | 'middle';
  /** how pinging works: middle click, or holding the left button */
  pingMode: 'middle' | 'hold';
  /** the Heights tool: how high the ground it draws is (feet), and whether it draws boxes or circles */
  heightFt: number;
  /** what the Heights brush does: paint ground, rub ground out, or select and move an area */
  heightMode: 'paint' | 'erase' | 'move';
  /** what the Heights brush lays down: height, or difficult ground */
  groundKind: 'height' | 'rough';
  /** what the Light tool paints: daylight, dim light, or erases both */
  lightPaint: 'day' | 'dim' | 'erase';
  /** the Light tool's brush, in feet across */
  lightBrush: number;
  /** paint whole squares (or hexes) rather than freehand */
  heightSnap: boolean;
  /** how wide the brush is, in grid squares */
  heightBrush: number | 'fine';
  /** new areas add to the ground below them instead of setting its height */
  heightAdds: boolean;
  /** Show terrain while editing, moving or measuring, or keep it visible all the time. */
  heightView: 'auto' | 'always';
  /** the Walls tool: draw new walls, or select and edit the ones that are there */
  wallMode: 'draw' | 'edit' | 'erase';
  wallBrush: number;
  /** what the next wall drawn is: a wall, a door or a window */
  wallKind: WallKind;
  /** whether a new wall is drawn for the players (null = the default for its kind) */
  wallVis: boolean | null;
  /** draw walls one segment at a time, as a box, freehand, or as a round room */
  wallShape: 'line' | 'box' | 'free' | 'circle';
  /** how many corners a freehand or round wall gets */
  wallDetail: 'low' | 'mid' | 'high';
  /** the next wall is one-way: it stops only what is on this side of it as it is drawn (1 right, -1 left, 0 both sides) */
  wallOne: Side;
  /** how tall the next wall is in feet (0: nothing passes over it) */
  wallH: number;
  /** where wall ends land: grid corners, corners and half squares, or anywhere */
  wallSnap: WallSnap;
  /** the walls selected in the Walls tool */
  wallSel: Set<string>;
  /** draw the walls on the map (the Walls tool shows them anyway) */
  showWalls: boolean;
  /** the DM walks through walls, and sees through them */
  wallIgnore: boolean;
  /** the "On this map" switches in the Walls tool are unfolded (folded by default: set once, left alone) */
  wallMapOpen: boolean;
  /** DM: the initiative pop-up is open */
  initOpen: boolean;
  /** where the turn order sits on screen: across the top middle, or down the right edge */
  initPos: InitPos;
  /** the text being typed (id null = a new one) and where it sits in the world, while the editor is open */
  textEdit: { id: string | null; x: number; y: number } | null;
  /** bumps whenever the view moves while the text editor is open, so it follows the map */
  camRev: number;
  /** opening the Effects window moves the view so the token is on the left and the window on the right (otherwise the view stays put) */
  fxJump: boolean;
  /** an effect being tried out in the Effects window: drawn on these tokens but not saved */
  fxDraft: { ids: string[]; fx: Effect } | null;
}

function readFlag(key: string, dflt: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? dflt : v === '1'; } catch { return dflt; }
}
function readHex(key: string): string {
  try { const v = localStorage.getItem(key) ?? ''; return /^#[0-9a-fA-F]{6}$/.test(v) ? v : ''; } catch { return ''; }
}
function readStr<T extends string>(key: string, dflt: T, allowed: readonly T[]): T {
  try { const v = localStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : dflt; } catch { return dflt; }
}

/** Tiny observable store for UI-level state that both the board and the panels need. */
export class UiState {
  data: UiData = {
    tool: 'select', scaleStart: null, scaleEnd: null, fogMode: 'r', fogShape: 'rect', brushSize: 2,
    selection: new Set(), mapSelected: false, extraSel: null, dmPreview: false, zoom: 1, status: null,
    dockTab: null,
    drawTool: readStr('vtt-draw-tool', 'pen', ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'erase'] as const),
    tplKind: readStr('vtt-tpl-kind', 'cone', ['cone', 'cube', 'sphere', 'emanation', 'beam'] as const),
    drawColor: (() => { try { return localStorage.getItem('vtt-draw-color') || '#e03131'; } catch { return '#e03131'; } })(),
    drawSize: readStr('vtt-draw-size', 'medium', ['thin', 'medium', 'thick'] as const),
    drawFillMode: readStr('vtt-draw-fillmode', 'none', ['none', 'light', 'solid'] as const),
    drawFillColor: readHex('vtt-draw-fillcolor'),
    textFont: (() => { try { const v = localStorage.getItem('vtt-text-font') ?? ''; return FONT_KEYS.includes(v) ? v : ''; } catch { return ''; } })(),
    textBold: readFlag('vtt-text-bold', true),
    textItalic: readFlag('vtt-text-italic', false),
    textUnderline: readFlag('vtt-text-underline', false),
    rulerColor: readHex('vtt-ruler-color'),
    drawDash: readFlag('vtt-draw-dash', false),
    tplWidth: 5,
    tplSphereSnap: readStr('vtt-tpl-sphere', 'center', ['center', 'corner', 'off'] as const),
    tplCover: readFlag('vtt-tpl-cover', true),
    drawSel: new Set(), testMove: false, testCount: 0,
    sharePlot: readFlag('vtt-share-plot', false),
    tplShare: readFlag('vtt-tpl-share', true),
    tplRough: false, tplMode: 'place',
    testMulti: readFlag('vtt-test-multi', false),
    rulerMulti: readFlag('vtt-ruler-multi', false),
    autoGrid: readFlag('vtt-auto-grid', true),
    sceneFolder: (() => { try { return localStorage.getItem('vtt-scene-folder') || 'all'; } catch { return 'all'; } })(),
    textEdit: null, camRev: 0, initOpen: false,
    fxJump: readFlag('vtt-fx-jump', true), fxDraft: null,
    heightFt: (() => { try { const n = Number(localStorage.getItem('vtt-height-ft')); return Number.isFinite(n) && localStorage.getItem('vtt-height-ft') !== null ? n : 10; } catch { return 10; } })(),
    heightMode: readStr('vtt-height-mode', 'paint', ['paint', 'erase', 'move'] as const),
    groundKind: readStr('vtt-ground-kind', 'height', ['height', 'rough'] as const),
    lightPaint: readStr('vtt-light-paint', 'day', ['day', 'dim', 'erase'] as const),
    lightBrush: (() => { try { const n = Number(localStorage.getItem('vtt-light-brush')); return Number.isFinite(n) && n >= 5 && n <= 200 ? n : 20; } catch { return 20; } })(),
    heightSnap: readFlag('vtt-height-snap', true),
    heightBrush: (() => { try { const value=localStorage.getItem('vtt-height-brush'); if (value==='fine') return 'fine'; const n=Number(value); return [1,2,3,4,8].includes(n) ? n : 1; } catch { return 1; } })(),
    heightAdds: readFlag('vtt-height-adds', false),
    heightView: readStr('vtt-height-view', 'auto', ['auto','always'] as const),
    wallMode: readStr('vtt-wall-mode', 'draw', ['draw', 'edit', 'erase'] as const),
    wallKind: readStr('vtt-wall-kind', 'wall', ['wall', 'door', 'window'] as const),
    wallVis: (() => { try { const v = localStorage.getItem('vtt-wall-vis'); return v === '1' ? true : v === '0' ? false : null; } catch { return null; } })(),
    wallShape: readStr('vtt-wall-shape', 'line', ['line', 'box', 'free', 'circle'] as const),
    wallDetail: readStr('vtt-wall-detail', 'mid', ['low', 'mid', 'high'] as const),
    wallOne: (() => { try { const v = localStorage.getItem('vtt-wall-one'); return v === '1' ? 1 : v === '-1' ? -1 : 0; } catch { return 0; } })() as Side,
    wallH: (() => { try { const n = Number(localStorage.getItem('vtt-wall-h')); return Number.isFinite(n) && n > 0 ? Math.min(1000, Math.round(n)) : 0; } catch { return 0; } })(),
    wallSnap: readStr('vtt-wall-snap', 'half', ['corner', 'half', 'off'] as const),
    wallBrush: 1,
    wallSel: new Set(),
    showWalls: readFlag('vtt-show-walls', true),
    wallIgnore: false,
    wallMapOpen: readFlag('vtt-wall-map-open', false),
    initPos: readStr('vtt-init-pos', 'top', ['top', 'side'] as const),
    panButton: readStr('vtt-pan-button', 'right', ['right', 'middle'] as const),
    pingMode: readStr('vtt-ping-mode', 'middle', ['middle', 'hold'] as const),
  };
  private listeners = new Set<() => void>();
  private queued = false;

  subscribe(fn: () => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<UiData>) {
    // the ruler and test moves do not mix: trying a move switches the ruler off
    if (patch.testMove === true && this.data.tool !== 'select' && patch.tool === undefined) patch = { ...patch, tool: 'select' }; // test move works on tokens, so it takes over from any other tool
    // picking any other tool ends the test move (it only ever goes with the plain select tool)
    if (patch.tool !== undefined && patch.tool !== 'select' && this.data.testMove && patch.testMove === undefined) patch = { ...patch, testMove: false };
    if (patch.tool !== undefined) patch = { ...patch, scaleStart: null, scaleEnd: null };
    try {
      if (patch.drawTool !== undefined) localStorage.setItem('vtt-draw-tool', patch.drawTool);
      if (patch.tplKind !== undefined) localStorage.setItem('vtt-tpl-kind', patch.tplKind);
      if (patch.tplSphereSnap !== undefined) localStorage.setItem('vtt-tpl-sphere', patch.tplSphereSnap);
      if (patch.tplCover !== undefined) localStorage.setItem('vtt-tpl-cover', patch.tplCover ? '1' : '0');
      if (patch.drawColor !== undefined) localStorage.setItem('vtt-draw-color', patch.drawColor);
      if (patch.drawSize !== undefined) localStorage.setItem('vtt-draw-size', patch.drawSize);
      if (patch.drawFillMode !== undefined) localStorage.setItem('vtt-draw-fillmode', patch.drawFillMode);
      if (patch.drawFillColor !== undefined) localStorage.setItem('vtt-draw-fillcolor', patch.drawFillColor);
      if (patch.textFont !== undefined) localStorage.setItem('vtt-text-font', patch.textFont);
      if (patch.textBold !== undefined) localStorage.setItem('vtt-text-bold', patch.textBold ? '1' : '0');
      if (patch.textItalic !== undefined) localStorage.setItem('vtt-text-italic', patch.textItalic ? '1' : '0');
      if (patch.textUnderline !== undefined) localStorage.setItem('vtt-text-underline', patch.textUnderline ? '1' : '0');
      if (patch.rulerColor !== undefined) localStorage.setItem('vtt-ruler-color', patch.rulerColor);
      if (patch.drawDash !== undefined) localStorage.setItem('vtt-draw-dash', patch.drawDash ? '1' : '0');
      if (patch.panButton !== undefined) localStorage.setItem('vtt-pan-button', patch.panButton);
      if (patch.pingMode !== undefined) localStorage.setItem('vtt-ping-mode', patch.pingMode);
      if (patch.heightFt !== undefined) localStorage.setItem('vtt-height-ft', String(patch.heightFt));
      if (patch.heightMode !== undefined) localStorage.setItem('vtt-height-mode', patch.heightMode);
      if (patch.groundKind !== undefined) localStorage.setItem('vtt-ground-kind', patch.groundKind);
      if (patch.lightPaint !== undefined) localStorage.setItem('vtt-light-paint', patch.lightPaint);
      if (patch.lightBrush !== undefined) localStorage.setItem('vtt-light-brush', String(patch.lightBrush));
      if (patch.heightSnap !== undefined) localStorage.setItem('vtt-height-snap', patch.heightSnap ? '1' : '0');
      if (patch.heightBrush !== undefined) localStorage.setItem('vtt-height-brush', String(patch.heightBrush));
      if (patch.heightAdds !== undefined) localStorage.setItem('vtt-height-adds', patch.heightAdds ? '1' : '0');
      if (patch.heightView !== undefined) localStorage.setItem('vtt-height-view', patch.heightView);
      if (patch.wallMode !== undefined) localStorage.setItem('vtt-wall-mode', patch.wallMode);
      if (patch.wallKind !== undefined) localStorage.setItem('vtt-wall-kind', patch.wallKind);
      if (patch.wallVis !== undefined) localStorage.setItem('vtt-wall-vis', patch.wallVis === null ? '' : patch.wallVis ? '1' : '0');
      if (patch.wallShape !== undefined) localStorage.setItem('vtt-wall-shape', patch.wallShape);
      if (patch.wallDetail !== undefined) localStorage.setItem('vtt-wall-detail', patch.wallDetail);
      if (patch.wallOne !== undefined) localStorage.setItem('vtt-wall-one', String(patch.wallOne));
      if (patch.wallH !== undefined) localStorage.setItem('vtt-wall-h', String(patch.wallH));
      if (patch.wallSnap !== undefined) localStorage.setItem('vtt-wall-snap', patch.wallSnap);
      if (patch.showWalls !== undefined) localStorage.setItem('vtt-show-walls', patch.showWalls ? '1' : '0');
      if (patch.wallMapOpen !== undefined) localStorage.setItem('vtt-wall-map-open', patch.wallMapOpen ? '1' : '0');
      if (patch.initPos !== undefined) localStorage.setItem('vtt-init-pos', patch.initPos);
      if (patch.tplShare !== undefined) localStorage.setItem('vtt-tpl-share', patch.tplShare ? '1' : '0');
      if (patch.testMulti !== undefined) localStorage.setItem('vtt-test-multi', patch.testMulti ? '1' : '0');
      if (patch.rulerMulti !== undefined) localStorage.setItem('vtt-ruler-multi', patch.rulerMulti ? '1' : '0');
      if (patch.autoGrid !== undefined) localStorage.setItem('vtt-auto-grid', patch.autoGrid ? '1' : '0');
      if (patch.sceneFolder !== undefined) localStorage.setItem('vtt-scene-folder', patch.sceneFolder);
      if (patch.sharePlot !== undefined) localStorage.setItem('vtt-share-plot', patch.sharePlot ? '1' : '0');
      if (patch.fxJump !== undefined) localStorage.setItem('vtt-fx-jump', patch.fxJump ? '1' : '0');
    } catch { /* ignore */ }
    if (patch.tool !== undefined || patch.drawSel || patch.heightMode || patch.groundKind) {
      if (!('gradientArea' in patch)) patch.gradientArea = undefined;
      patch.gradientFocus = undefined;
    }
    if (patch.drawSel && !patch.heightPatches) patch.heightPatches = undefined;
    this.data = { ...this.data, ...patch };
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; for (const fn of [...this.listeners]) fn(); });
  }

  select(ids: Iterable<string>) {
    const next = new Set(ids);
    const cur = this.data.selection;
    if (next.size === cur.size && [...next].every((i) => cur.has(i))) return;
    this.set({ selection: next, mapSelected: false, extraSel: null, ...(next.size ? { drawSel: new Set<string>() } : {}) });
  }

  selectDrawings(ids: Iterable<string>) {
    const next = new Set(ids);
    const cur = this.data.drawSel;
    if (!this.data.heightPatches && next.size === cur.size && [...next].every((i) => cur.has(i))) return;
    this.set({ drawSel: next, ...(next.size ? { selection: new Set<string>(), mapSelected: false, extraSel: null } : {}) });
  }
}
