import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { LibraryItem } from '../types';

/** The pixel count above which the original picture is not loaded just to be looked at (a 10,000 px map is half a gigabyte decoded). */
const PREVIEW_MAX_PIXELS = 12_000_000;

/** The picture to show in a hover preview: a medium copy when one was saved, else the original unless it is huge. */
export function previewSource(it: LibraryItem): string {
  if (it.preview) return it.preview;
  const px = (it.w ?? 0) * (it.h ?? 0);
  return px > PREVIEW_MAX_PIXELS ? (it.thumb ?? it.url) : it.url;
}

/** The items whose name has every word of `query` in it (nothing typed: all of them). */
export function filterLibrary<T extends { name: string }>(items: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => { const n = it.name.toLowerCase(); return words.every((w) => n.includes(w)); });
}

const PREVIEW_W = 440;

/** A larger look at a library picture while the pointer is over its tile. Put `node` anywhere in the window; spread `bind(item)` on each tile. */
export function useHoverPreview() {
  const [at, setAt] = useState<{ item: LibraryItem; x: number; y: number } | null>(null);
  const bind = (item: LibraryItem) => ({
    onMouseEnter: (e: MouseEvent) => setAt({ item, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: MouseEvent) => setAt((a) => (a && a.item.id === item.id ? { item, x: e.clientX, y: e.clientY } : { item, x: e.clientX, y: e.clientY })),
    onMouseLeave: () => setAt(null),
    onFocus: (e: FocusEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setAt({ item, x: r.right, y: r.top }); },
    onBlur: () => setAt(null),
  });
  let node: JSX.Element | null = null;
  if (at) {
    const left = at.x + 20 + PREVIEW_W > window.innerWidth ? Math.max(8, at.x - 20 - PREVIEW_W) : at.x + 20;
    const top = Math.max(8, Math.min(at.y - 100, window.innerHeight - 360));
    const size = at.item.w && at.item.h ? ` · ${at.item.w} × ${at.item.h}` : '';
    node = (
      <div class="lib-preview" style={{ left: `${left}px`, top: `${top}px` }} aria-hidden="true">
        <img src={previewSource(at.item)} alt="" />
        <div class="lib-preview-cap">{at.item.name}{size}</div>
      </div>
    );
  }
  return { bind, node };
}

/** A search box for a list of library pictures. */
export function LibrarySearch(props: { value: string; onChange: (v: string) => void; shown: number; total: number }) {
  return (
    <div class="row wrap lib-search">
      <input type="text" class="grow" placeholder="Search your library…" aria-label="Search your library" value={props.value}
        onInput={(e) => props.onChange((e.target as HTMLInputElement).value)} />
      {props.value && <button class="btn small" onClick={() => props.onChange('')}>Clear</button>}
      {props.value && <span class="muted small">{props.shown} of {props.total}</span>}
    </div>
  );
}
