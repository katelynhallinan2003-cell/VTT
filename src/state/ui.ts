import type { Unsub } from '../backend/types';

export type Tool = 'select' | 'grid' | 'fog';
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
  };
  private listeners = new Set<() => void>();
  private queued = false;

  subscribe(fn: () => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<UiData>) {
    if (patch.dockOpen !== undefined) { try { localStorage.setItem('vtt-dock', patch.dockOpen ? '1' : '0'); } catch { /* ignore */ } }
    this.data = { ...this.data, ...patch };
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; for (const fn of [...this.listeners]) fn(); });
  }

  select(ids: Iterable<string>) {
    const next = new Set(ids);
    const cur = this.data.selection;
    if (next.size === cur.size && [...next].every((i) => cur.has(i))) return;
    this.set({ selection: next, mapSelected: false });
  }
}
