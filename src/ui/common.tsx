import type { ComponentChildren } from 'preact';
import { useEffect, useReducer, useState } from 'preact/hooks';
import { onThemeChange } from './theme';
import type { Unsub } from '../backend/types';
import type { TableClient } from '../state/client';
import type { UiState } from '../state/ui';

export function useRerender(subscribe: (fn: () => void) => Unsub, deps: unknown[]) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(() => force(0)), deps);
}
export const useClient = (c: TableClient) => useRerender((fn) => c.subscribe(fn), [c]);
export const useUi = (u: UiState) => { useRerender((fn) => u.subscribe(fn), [u]); return u.data; };

export const useTheme = () => useRerender((fn) => onThemeChange(fn), []);

// ---------------------------------------------------------------- collapsible sections
function readFlag(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
export function writeFlag(key: string, value: boolean) { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ } }
export { readFlag };

/** A titled block that can be folded away. Open/closed state is remembered per browser. */
export function Section(props: { id: string; title: string; defaultOpen?: boolean; extra?: ComponentChildren; children: ComponentChildren }) {
  const key = 'vtt-sect-' + props.id;
  const [open, setOpen] = useState(() => readFlag(key, props.defaultOpen ?? true));
  return (
    <section class="sect">
      <button class="sect-head" aria-expanded={open} onClick={() => { setOpen(!open); writeFlag(key, !open); }}>
        <span class="chev">{open ? '▾' : '▸'}</span>{props.title}
        {props.extra && <span class="sect-extra" onClick={(e) => e.stopPropagation()}>{props.extra}</span>}
      </button>
      {open && <div class="sect-body">{props.children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------- toasts
interface ToastItem { id: number; msg: string; kind: 'info' | 'error' | 'ok' }
let toasts: ToastItem[] = [];
let toastId = 0;
const toastListeners = new Set<() => void>();
export function toast(msg: string, kind: ToastItem['kind'] = 'info', ms = 4200) {
  const t = { id: ++toastId, msg, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((x) => x !== t); toastListeners.forEach((f) => f()); }, kind === 'error' ? ms * 1.8 : ms);
}
export function Toasts() {
  useRerender((fn) => { toastListeners.add(fn); return () => toastListeners.delete(fn); }, []);
  return (
    <div class="toasts">
      {toasts.map((t) => <div key={t.id} class={`toast ${t.kind}`}>{t.msg}</div>)}
    </div>
  );
}

// ---------------------------------------------------------------- modal
export function Modal(props: { title: string; onClose: () => void; width?: number; children: ComponentChildren; footer?: ComponentChildren }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [props.onClose]);
  return (
    <div class="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="modal" style={{ width: `${props.width ?? 520}px` }} role="dialog" aria-label={props.title}>
        <div class="modal-head">
          <h2>{props.title}</h2>
          <button class="icon-btn" onClick={props.onClose} aria-label="Close">✕</button>
        </div>
        <div class="modal-body">{props.children}</div>
        {props.footer && <div class="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Field(props: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span class="hint">{props.hint}</span>}
    </label>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label class={`toggle ${props.disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <span class="toggle-text">
        <span>{props.label}</span>
        {props.hint && <span class="hint">{props.hint}</span>}
      </span>
    </label>
  );
}

/** A slider/number pair that edits a local draft and commits (throttled) while dragging. */
export function SliderField(props: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onInput: (v: number) => void; hint?: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const v = draft ?? props.value;
  useEffect(() => { setDraft(null); }, [props.value]);
  const commit = (n: number) => { if (Number.isFinite(n)) { setDraft(n); props.onInput(n); } };
  return (
    <Field label={props.label} hint={props.hint}>
      <div class="slider-row">
        <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={v}
          onInput={(e) => commit(Number((e.target as HTMLInputElement).value))} />
        <input type="number" class="num" min={props.min} max={props.max} step={props.step ?? 1} value={Math.round(v * 100) / 100}
          onChange={(e) => commit(Number((e.target as HTMLInputElement).value))} />
        {props.unit && <span class="unit">{props.unit}</span>}
      </div>
    </Field>
  );
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok', 1800); }
  catch { window.prompt('Copy this:', text); }
}
