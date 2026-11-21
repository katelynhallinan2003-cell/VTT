import type { Unsub } from '../backend/types';
import { FONT_KEYS, type FillMode } from '../core/draw';

export type Tool = 'select' | 'grid' | 'fog' | 'draw' | 'template' | 'ruler';
export type DrawTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'erase';
export type TemplateKind = 'cone' | 'cube' | 'sphere' | 'beam';
export type StrokeSize = 'thin' | 'medium' | 'thick';
export type FogShape = 'rect' | 'poly' | 'brush';
export type DockTab = 'scene' | 'tokens' | 'init' | 'players';

export interface UiData {
  tool: Tool;
  fogMode: 'r' | 'h';
  fogShape: FogShape;
  /** brush diameter in grid squares */
  brushSize: number;
  selection: Set<string>;
  mapSelected: boolean;
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
  /** drawings that are selected (token selection is separate) */
  drawSel: Set<string>;
  /** try out token moves without committing them */
  testMove: boolean;
  /** how many tokens are currently being tried out */
  testCount: number;
  /** show my ruler and test moves to everyone */
  sharePlot: boolean;
  /** which mouse button pans the view (the other one opens the menu / pings) */
  panButton: 'right' | 'middle';
  /** how pinging works: middle click, or holding the left button */
  pingMode: 'middle' | 'hold';
  /** the text being typed (id null = a new one) and where it sits in the world, while the editor is open */
  textEdit: { id: string | null; x: number; y: number } | null;
  /** bumps whenever the view moves while the text editor is open, so it follows the map */
  camRev: number;
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
    tool: 'select', fogMode: 'r', fogShape: 'rect', brushSize: 2,
    selection: new Set(), mapSelected: false, dmPreview: false, zoom: 1, status: null,
    dockTab: null,
    drawTool: readStr('vtt-draw-tool', 'pen', ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'erase'] as const),
    tplKind: readStr('vtt-tpl-kind', 'cone', ['cone', 'cube', 'sphere', 'beam'] as const),
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
    drawSel: new Set(), testMove: false, testCount: 0,
    sharePlot: readFlag('vtt-share-plot', false),
    textEdit: null, camRev: 0,
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
    if (patch.testMove === true && this.data.tool === 'ruler' && patch.tool === undefined) patch = { ...patch, tool: 'select' };
    try {
      if (patch.drawTool !== undefined) localStorage.setItem('vtt-draw-tool', patch.drawTool);
      if (patch.tplKind !== undefined) localStorage.setItem('vtt-tpl-kind', patch.tplKind);
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
      if (patch.sharePlot !== undefined) localStorage.setItem('vtt-share-plot', patch.sharePlot ? '1' : '0');
    } catch { /* ignore */ }
    this.data = { ...this.data, ...patch };
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; for (const fn of [...this.listeners]) fn(); });
  }

  select(ids: Iterable<string>) {
    const next = new Set(ids);
    const cur = this.data.selection;
    if (next.size === cur.size && [...next].every((i) => cur.has(i))) return;
    this.set({ selection: next, mapSelected: false, ...(next.size ? { drawSel: new Set<string>() } : {}) });
  }

  selectDrawings(ids: Iterable<string>) {
    const next = new Set(ids);
    const cur = this.data.drawSel;
    if (next.size === cur.size && [...next].every((i) => cur.has(i))) return;
    this.set({ drawSel: next, ...(next.size ? { selection: new Set<string>(), mapSelected: false } : {}) });
  }
}
