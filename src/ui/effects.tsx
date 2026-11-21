import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Board } from '../board/Board';
import { FX_EMOJI, FX_GROUPS, FX_LOOKS, FX_PRESETS, FX_TICKS, fxDuration, fxTickLabel, makeEffect, searchFx, tintColor, type FxPreset } from '../core/effects';
import type { TableClient } from '../state/client';
import type { UiState } from '../state/ui';
import type { Effect, FxLook, FxTick, Token } from '../types';
import { FloatWin, toast, useClient, useUi } from './common';

/** The text colour that reads on top of a coloured badge. */
export function onColor(c: string): string {
  const n = parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0;
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#1a1a1a' : '#ffffff';
}

/** A small row of round badges, one per effect. Hover for the name and how long is left. */
export function FxIcons(props: { fx: Effect[]; max?: number }) {
  const { fx } = props;
  if (!fx.length) return null;
  const max = props.max ?? 5;
  const shown = fx.slice(0, max);
  return (
    <span class="fxrow">
      {shown.map((e) => (
        <span key={e.id} class="fxi" style={{ background: e.c, color: onColor(e.c) }} title={`${e.n} · ${fxDuration(e)}`}>{e.ic || '●'}</span>
      ))}
      {fx.length > max && <span class="fxmore" title={fx.slice(max).map((e) => e.n).join(', ')}>+{fx.length - max}</span>}
    </span>
  );
}

interface Draft { n: string; ic: string; c: string; look: FxLook; tint: boolean; tc: string; timed: boolean; rounds: number; tick: FxTick; preset: string }
/** Remembered while the page is open, so a run of similar effects does not need the same settings picked each time. */
let last: Pick<Draft, 'look' | 'timed' | 'rounds' | 'tick'> = { look: 'badge', timed: true, rounds: 1, tick: 'end' };
/** Where the window was last dragged to (the "stays where it was" setting reopens it there). */
let winPos: { x: number; y: number } | null = null;
const WIN_W = 410;
const defaultPos = () => ({ x: Math.max(80, window.innerWidth - WIN_W - 78), y: 64 });

// ---------------------------------------------------------------- the effects you made yourself, kept in this browser
interface Mine { n: string; ic: string; c: string }
const MINE_KEY = 'vtt-fx-mine';
function loadMine(): Mine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m.n === 'string' && m.n).map((m) => ({ n: String(m.n).slice(0, 40), ic: String(m.ic ?? '').slice(0, 8), c: /^#[0-9a-fA-F]{6}$/.test(m.c) ? m.c : '#ff6b6b' })).slice(0, 24) : [];
  } catch { return []; }
}
function saveMine(list: Mine[]) { try { localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 24))); } catch { /* ignore */ } }

interface Item { key: string; n: string; ic: string; c: string; group: string; mine?: boolean }

/** A search box with a drop-down of the ready-made effects under it. Hovering or arrowing onto one shows it on the token. */
function EffectCombo(props: { items: Item[]; value: string; onPick: (it: Item) => void; onActive: (it: Item | null) => void; onForget: (it: Item) => void; onCustom: (text: string) => void }) {
  const [text, setText] = useState(props.value);
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { if (!typed) setText(props.value); }, [props.value, typed]);

  const q = typed ? text.trim() : '';
  const shown: Item[] = useMemo(() => {
    if (q) return searchFx(props.items, q);
    const out: Item[] = [];
    for (const g of ['mine', ...FX_GROUPS.map((x) => x.id)]) out.push(...props.items.filter((i) => i.group === g));
    return out;
  }, [props.items, q]);
  const exact = shown.some((i) => i.n.toLowerCase() === q.toLowerCase());
  const offerCustom = q.length > 0 && !exact;
  const count = shown.length + (offerCustom ? 1 : 0);
  const cur = open && act < shown.length ? shown[act] ?? null : null;
  useEffect(() => { props.onActive(cur); }, [cur?.key]);
  useEffect(() => () => props.onActive(null), []);
  useEffect(() => { listRef.current?.querySelector('.act')?.scrollIntoView({ block: 'nearest' }); }, [act, open]);

  const pick = (it: Item) => { setText(it.n); setTyped(false); setOpen(false); props.onPick(it); };
  const key = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAct((a) => (count ? (a + 1) % count : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setAct((a) => (count ? (a - 1 + count) % count : 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && act < shown.length) pick(shown[act]);
      else if (open && offerCustom) { setOpen(false); props.onCustom(text.trim()); }
    } else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
  };
  let lastGroup = '';
  return (
    <div class="fx-combo">
      <input ref={inputRef} type="text" class="fx-search" role="combobox" aria-expanded={open} aria-autocomplete="list" aria-label="Search the ready-made effects" autoComplete="off"
        placeholder="Search: poisoned, hex, rage, cover…" value={text}
        onFocus={(e) => { setOpen(true); if (!typed) (e.target as HTMLInputElement).select(); }}
        onClick={() => setOpen(true)}
        onInput={(e) => { setText((e.target as HTMLInputElement).value); setTyped(true); setOpen(true); setAct(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={key} />
      <button class="fx-combo-btn" tabIndex={-1} aria-label="Show the list" onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else { setOpen(true); inputRef.current?.focus(); } }}>▾</button>
      {open && (
        <ul class="fx-list" role="listbox" ref={listRef} onMouseDown={(e) => e.preventDefault()}>
          {shown.length === 0 && !offerCustom && <li class="fx-none">Nothing matches.</li>}
          {shown.map((it, i) => {
            const head = !q && it.group !== lastGroup ? (lastGroup = it.group, it.mine ? 'Yours' : FX_GROUPS.find((g) => g.id === it.group)?.label ?? '') : '';
            if (q) lastGroup = '';
            return (
              <>
                {head && <li class="fx-gh" role="presentation">{head}</li>}
                <li key={it.key} role="option" aria-selected={act === i} class={`fx-opt ${act === i ? 'act' : ''}`} onMouseEnter={() => setAct(i)} onClick={() => pick(it)}>
                  <span class="fx-dot" style={{ background: it.c }} />
                  <span class="fx-opt-ic">{it.ic || '●'}</span>
                  <span class="fx-opt-n">{it.n}</span>
                  {q && <span class="fx-opt-g">{it.mine ? 'Yours' : FX_GROUPS.find((g) => g.id === it.group)?.label}</span>}
                  {it.mine && <button class="fx-forget" title="Forget this one of mine" aria-label={`Forget ${it.n}`} onClick={(e) => { e.stopPropagation(); props.onForget(it); }}>✕</button>}
                </li>
              </>
            );
          })}
          {offerCustom && <li class={`fx-opt fx-mk ${act === shown.length ? 'act' : ''}`} onMouseEnter={() => setAct(shown.length)} onClick={() => { setOpen(false); props.onCustom(text.trim()); }}>Make “{text.trim()}” your own effect…</li>}
        </ul>
      )}
    </div>
  );
}

/** The little grid of pictures that pops up under the Picture button. Any other emoji can be typed or pasted in the box. */
function EmojiPop(props: { value: string; onPick: (ic: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.fx-pic-btn')) props.onClose(); };
    // Esc closes just this pop-up, wherever the focus is (it must not also close the window)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose(); } };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', esc, true); };
  }, []);
  return (
    <div class="fx-pop" ref={ref} role="dialog" aria-label="Pick a picture">
      {FX_EMOJI.map((g) => (
        <div key={g.label} class="fx-pop-g">
          <div class="fx-pop-l">{g.label}</div>
          <div class="fx-pop-row">{g.list.map((ic) => <button key={ic} class={`fx-pic ${props.value === ic ? 'on' : ''}`} onClick={() => { props.onPick(ic); props.onClose(); }}>{ic}</button>)}</div>
        </div>
      ))}
      <div class="fx-pop-type">
        <input type="text" maxLength={8} placeholder="Type or paste any emoji" aria-label="Type or paste any emoji" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) { props.onPick(v); props.onClose(); } } }} />
        <button class="btn small" onClick={() => props.onPick('')}>No picture</button>
      </div>
    </div>
  );
}

const presetItems = (): Item[] => FX_PRESETS.map((p: FxPreset) => ({ key: `p:${p.n}`, n: p.n, ic: p.ic, c: p.c, group: p.group }));

/** Add, change and remove effects on one or several tokens. A window beside the board, so you can watch the token while you decide. */
export function EffectsWindow(props: { client: TableClient; ui: UiState; board: Board | null; ids: string[]; onClose: () => void }) {
  const { client, ui } = props;
  useClient(client);
  const d0 = useUi(ui);
  const tokens = props.ids.map((id) => client.scene?.tokens.get(id)).filter((t): t is Token => !!t);
  const multi = tokens.length > 1;
  const [d, setD] = useState<Draft>({ n: '', ic: '', c: '#ff6b6b', tint: false, tc: '', ...last, preset: '' });
  const [tab, setTab] = useState<'ready' | 'custom'>('ready');
  const [pop, setPop] = useState(false);
  const [hover, setHover] = useState<Item | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [mine, setMine] = useState<Mine[]>(() => loadMine());
  const [pos, setPos] = useState(() => (ui.data.fxJump || !winPos ? defaultPos() : winPos));
  const set = (p: Partial<Draft>) => setD((x) => {
    const next = { ...x, ...p };
    last = { look: next.look, timed: next.timed, rounds: next.rounds, tick: next.tick };
    return next;
  });

  // when it opens: line the view up so the token is on the left and this window on the right (if that is what the setting says)
  const idsKey = props.ids.join(',');
  useEffect(() => {
    if (ui.data.fxJump) { winPos = null; props.board?.showLeftOf(props.ids, window.innerWidth - pos.x + 24); }
  }, [idsKey, props.board]);

  // what is drawn on the token(s) while deciding: the highlighted list entry, or else what the form describes
  const shownFx: Effect | null = useMemo(() => {
    const src = hover ? { n: hover.n, ic: hover.ic, c: hover.c } : d.n.trim() ? { n: d.n, ic: d.ic, c: d.c } : null;
    if (!src) return null;
    const e = makeEffect({ ...src, look: d.look, tint: d.tint, tc: d.tint && d.tc && d.tc !== src.c ? d.tc : '', left: d.timed ? d.rounds : null, tick: d.tick });
    const old = editing ? tokens[0]?.fx.find((x) => x.id === editing) : tokens[0]?.fx.find((x) => x.n.toLowerCase() === e.n.toLowerCase());
    return { ...e, id: old?.id ?? 'preview' };
  }, [hover?.key, d.n, d.ic, d.c, d.look, d.tint, d.tc, d.timed, d.rounds, d.tick, editing]);
  const fxKey = shownFx ? JSON.stringify(shownFx) : '';
  useEffect(() => { ui.set({ fxDraft: shownFx ? { ids: props.ids, fx: shownFx } : null }); }, [fxKey, idsKey]);
  useEffect(() => () => ui.set({ fxDraft: null }), []);

  if (!tokens.length) return null;
  const t0 = tokens[0];
  const ids = tokens.map((t) => t.id);
  const items: Item[] = [...mine.map((m) => ({ key: `m:${m.n}`, n: m.n, ic: m.ic, c: m.c, group: 'mine', mine: true })), ...presetItems()];
  const isPreset = (n: string) => FX_PRESETS.some((p) => p.n.toLowerCase() === n.trim().toLowerCase());

  function add() {
    const n = d.n.trim();
    if (!n) { toast(tab === 'ready' ? 'Pick an effect from the list first (or switch to “Make your own”).' : 'Give the effect a name first.', 'error', 2600); return; }
    const e = makeEffect({ n, ic: d.ic, c: d.c, look: d.look, tint: d.tint, tc: d.tint && d.tc && d.tc !== d.c ? d.tc : '', left: d.timed ? d.rounds : null, tick: d.tick });
    const job = editing && !multi ? client.replaceEffect(t0.id, editing, e) : client.addEffect(ids, e);
    void job.then(() => {
      if (!isPreset(n) && !mine.some((m) => m.n.toLowerCase() === n.toLowerCase())) { const next = [{ n, ic: d.ic, c: d.c }, ...mine].slice(0, 24); setMine(next); saveMine(next); }
      setEditing(null);
      set({ n: '', ic: '', preset: '', tint: false, tc: '' });
    }).catch((err) => toast((err as Error).message, 'error'));
  }
  const pickItem = (it: Item) => { setHover(null); set({ n: it.n, ic: it.ic, c: it.c, preset: it.n, tc: '' }); setEditing(null); };
  const forget = (it: Item) => { const next = mine.filter((m) => m.n !== it.n); setMine(next); saveMine(next); };
  const load = (e: Effect) => {
    setEditing(e.id);
    setTab(isPreset(e.n) ? 'ready' : 'custom');
    set({ n: e.n, ic: e.ic, c: e.c, look: e.look, tint: e.tint, tc: e.tc, timed: e.left != null, rounds: e.left ?? last.rounds, tick: e.tick, preset: isPreset(e.n) ? e.n : '' });
  };
  const toggleTint = (e: Effect) => void client.replaceEffect(t0.id, e.id, { ...e, tint: !e.tint }).catch((err) => toast((err as Error).message, 'error'));
  const resetPos = () => { winPos = null; setPos(defaultPos()); if (ui.data.fxJump) props.board?.showLeftOf(props.ids, window.innerWidth - defaultPos().x + 24); };

  const word = editing ? 'Update' : 'Add';
  const label = d.n.trim() ? `“${d.n.trim()}”` : 'effect';
  return (
    <FloatWin label="Effects" width={WIN_W} pos={pos} onMove={(p) => { winPos = p; }} onReset={resetPos} onClose={props.onClose}
      title={<>✨ Effects · {multi ? `${tokens.length} tokens` : t0.name || 'Unnamed token'}</>}
      footer={<>
        <button class="btn primary" onClick={add}>{word} {label}{multi ? ` on ${tokens.length} tokens` : ''}</button>
        {editing && <button class="btn" onClick={() => { setEditing(null); set({ n: '', ic: '', preset: '', tint: false, tc: '' }); }}>Cancel change</button>}
        <span class="spacer" />
        {!multi && t0.fx.length > 0 && <button class="btn" onClick={() => void client.changeFx(ids, () => [], 'Clear effects')}>Clear all</button>}
      </>}>
      {multi ? (
        <p class="muted" style={{ marginTop: 0 }}>Effects you add go on all {tokens.length} selected tokens.</p>
      ) : (
        <div class="fx-now">
          <div class="fx-h">On this token</div>
          {t0.fx.length === 0 && <p class="muted small" style={{ margin: '0 0 4px' }}>Nothing yet.</p>}
          {t0.fx.map((e) => (
            <div key={e.id} class={`fx-line ${editing === e.id ? 'editing' : ''}`}>
              <span class="fxi big" style={{ background: e.c, color: onColor(e.c) }}>{e.ic || '●'}</span>
              <span class="fx-line-name">
                <strong>{e.n}</strong>
                <span class="muted small">{e.left == null ? 'Until you remove it' : `${fxDuration(e)} · ${fxTickLabel(e.tick).toLowerCase()}`}</span>
              </span>
              {e.left != null && (
                <span class="fx-nudge">
                  <button class="icon-btn" title="One round less (the last one ends it)" onClick={() => void client.nudgeEffect(t0.id, e.id, -1)}>−</button>
                  <button class="icon-btn" title="One more round" onClick={() => void client.nudgeEffect(t0.id, e.id, 1)}>+</button>
                </span>
              )}
              <button class={`icon-btn tintbtn ${e.tint ? 'on' : ''}`} title={e.tint ? 'Tinting the token: click to stop' : 'Tint the token with this colour'} aria-label={`Tint the token for ${e.n}`} aria-pressed={!!e.tint} onClick={() => toggleTint(e)}>
                <span class="tint-sw" style={{ background: tintColor(e) }} />
              </button>
              <button class="icon-btn" title="Change how it looks or how long it lasts" aria-label={`Change ${e.n}`} onClick={() => load(e)}>✎</button>
              <button class="icon-btn" title="Take this effect off" aria-label={`Remove ${e.n}`} onClick={() => void client.removeEffect([t0.id], e.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div class="fx-h">{editing ? 'Change this effect' : 'Add an effect'}</div>
      <div class="seg fx-tabs">
        <button class={tab === 'ready' ? 'on' : ''} onClick={() => setTab('ready')}>Ready-made</button>
        <button class={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')}>Make your own</button>
      </div>
      {tab === 'ready' ? (
        <EffectCombo key="combo" items={items} value={d.preset} onPick={pickItem} onActive={setHover} onForget={forget}
          onCustom={(text) => { setTab('custom'); set({ n: text, ic: '', preset: '' }); }} />
      ) : (
        <div class="fx-form" key="form">
          <label class="field" style={{ flex: 1 }}>
            <span class="field-label">Name (anything you like)</span>
            <input type="text" value={d.n} maxLength={40} placeholder="Hexed by the hag, Wet, Rage-drunk…" autoFocus
              onInput={(e) => set({ n: (e.target as HTMLInputElement).value, preset: '' })}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); e.stopPropagation(); }} />
          </label>
          <div class="field fx-picwrap">
            <span class="field-label">Picture</span>
            <button class={`fx-pic-btn ${pop ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={pop} title="Pick a picture" onClick={() => setPop(!pop)}>{d.ic || '＋'}</button>
            {pop && <EmojiPop value={d.ic} onPick={(ic) => set({ ic })} onClose={() => setPop(false)} />}
          </div>
        </div>
      )}

      <div class="field" style={{ marginTop: '10px' }}>
        <span class="field-label">How it shows on the token</span>
        <div class="seg fx-looks">
          {FX_LOOKS.map((l) => <button key={l.id} class={d.look === l.id ? 'on' : ''} title={l.hint} onClick={() => set({ look: l.id })}>{l.label}</button>)}
        </div>
      </div>

      <div class="fx-colrow">
        <label class="fx-colour">
          <span class="field-label">Colour</span>
          <input type="color" value={d.c} onInput={(e) => set({ c: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="toggle fx-tint">
          <input type="checkbox" checked={d.tint} onChange={(e) => set({ tint: (e.target as HTMLInputElement).checked })} />
          <span class="toggle-text"><span>Tint the token</span><span class="hint">A wash of colour over the whole token as well.</span></span>
        </label>
        {d.tint && (
          <span class="fx-tintcol">
            <input type="color" aria-label="Tint colour" value={d.tc || d.c} onInput={(e) => set({ tc: (e.target as HTMLInputElement).value })} />
            <button class="btn small" disabled={!d.tc || d.tc === d.c} title="Use the effect's own colour" onClick={() => set({ tc: '' })}>Match</button>
          </span>
        )}
      </div>

      <div class="field">
        <span class="field-label">How long it lasts</span>
        <div class="seg fx-looks">
          <button class={!d.timed ? 'on' : ''} onClick={() => set({ timed: false })}>Until I remove it</button>
          <button class={d.timed ? 'on' : ''} onClick={() => set({ timed: true })}>A number of rounds</button>
        </div>
        {d.timed && (
          <>
            <div class="row" style={{ margin: '6px 0 0' }}>
              <input type="number" class="num" min={1} max={999} value={d.rounds} style={{ width: '64px' }} aria-label="Rounds"
                onInput={(e) => set({ rounds: Math.max(1, Math.round(Number((e.target as HTMLInputElement).value) || 1)) })} onKeyDown={(e) => e.stopPropagation()} />
              <span class="muted">round{d.rounds === 1 ? '' : 's'}, counting down at the</span>
            </div>
            <div class="seg fx-looks" style={{ marginTop: '6px' }}>
              {FX_TICKS.map((t) => <button key={t.id} class={d.tick === t.id ? 'on' : ''} title={t.hint} onClick={() => set({ tick: t.id })}>{t.label}</button>)}
            </div>
            <span class="hint">Counts down by itself as you press Next turn in the initiative. Without a turn order it just stays, so you can nudge it with − and + or remove it yourself.</span>
          </>
        )}
      </div>

      <p class="hint fx-previewnote">{shownFx ? 'This is how it looks on the token right now. Nothing is added until you press the button.' : 'Pick an effect to see it on the token before you add it.'}</p>
      <div class="field fx-viewset">
        <span class="field-label">When this window opens</span>
        <div class="seg fx-looks">
          <button class={d0.fxJump ? 'on' : ''} title="Move the view so the token is on the left and this window on the right" onClick={() => ui.set({ fxJump: true })}>Jump to the token</button>
          <button class={!d0.fxJump ? 'on' : ''} title="Leave the view and the window where they were" onClick={() => ui.set({ fxJump: false })}>Stay where I was</button>
        </div>
      </div>
    </FloatWin>
  );
}
