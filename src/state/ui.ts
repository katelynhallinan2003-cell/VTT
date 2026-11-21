import type { Unsub } from '../backend/types';

export type Tool = 'select' | 'grid' | 'fog' | 'draw' | 'template' | 'ruler';
export type DrawTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'erase';
export type TemplateKind = 'cone' | 'cube' | 'sphere' | 'beam';
export type StrokeSize = 'thin' | 'medium' | 'thick';
export type FogShape = 'rect' | 'poly' | 'brush';

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
  /** the right-hand panel is expanded */
  dockOpen: boolean;
  dockTab: 'scene' | 'tokens';
  drawTool: DrawTool;
  tplKind: TemplateKind;
  drawColor: string;
  drawSize: StrokeSize;
  drawFill: boolean;
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
  /** where the text tool was clicked (screen + world), while the text box is open */
  textAt: { sx: number; sy: number; x: number; y: number } | null;
}

function readFlag(key: string, dflt: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? dflt : v === '1'; } catch { return dflt; }
}
function readStr<T extends string>(key: string, dflt: T, allowed: readonly T[]): T {
  try { const v = localStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : dflt; } catch { return dflt; }
}

function readDock(): boolean {
  try { return localStorage.getItem('vtt-dock') !== '0'; } catch { return true; }
}

/** Tiny observable store for UI-level state that both the board and the panels need. */
export class UiState {
  data: UiData = {
    tool: 'select', fogMode: 'r', fogShape: 'rect', brushSize: 2,
    selection: new Set(), mapSelected: false, dmPreview: false, zoom: 1, status: null,
    dockOpen: readDock(), dockTab: 'scene',
    drawTool: readStr('vtt-draw-tool', 'pen', ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'erase'] as const),
    tplKind: readStr('vtt-tpl-kind', 'cone', ['cone', 'cube', 'sphere', 'beam'] as const),
    drawColor: (() => { try { return localStorage.getItem('vtt-draw-color') || '#e03131'; } catch { return '#e03131'; } })(),
    drawSize: readStr('vtt-draw-size', 'medium', ['thin', 'medium', 'thick'] as const),
    drawFill: readFlag('vtt-draw-fill', false),
    drawDash: readFlag('vtt-draw-dash', false),
    tplWidth: 5,
    drawSel: new Set(), testMove: false, testCount: 0,
    sharePlot: readFlag('vtt-share-plot', false),
    textAt: null,
  };
  private listeners = new Set<() => void>();
  private queued = false;

  subscribe(fn: () => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<UiData>) {
    try {
      if (patch.dockOpen !== undefined) localStorage.setItem('vtt-dock', patch.dockOpen ? '1' : '0');
      if (patch.drawTool !== undefined) localStorage.setItem('vtt-draw-tool', patch.drawTool);
      if (patch.tplKind !== undefined) localStorage.setItem('vtt-tpl-kind', patch.tplKind);
      if (patch.drawColor !== undefined) localStorage.setItem('vtt-draw-color', patch.drawColor);
      if (patch.drawSize !== undefined) localStorage.setItem('vtt-draw-size', patch.drawSize);
      if (patch.drawFill !== undefined) localStorage.setItem('vtt-draw-fill', patch.drawFill ? '1' : '0');
      if (patch.drawDash !== undefined) localStorage.setItem('vtt-draw-dash', patch.drawDash ? '1' : '0');
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
