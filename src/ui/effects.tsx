import { useState } from 'preact/hooks';
import { FX_ICONS, FX_LOOKS, FX_PRESETS, FX_TICKS, fxDuration, fxTickLabel, makeEffect } from '../core/effects';
import type { TableClient } from '../state/client';
import type { Effect, FxLook, FxTick, Token } from '../types';
import { Modal, toast, useClient } from './common';

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

interface Draft { n: string; ic: string; c: string; look: FxLook; timed: boolean; rounds: number; tick: FxTick; preset: string }
/** Remembered while the page is open, so a run of similar effects does not need the same settings picked each time. */
let last: Pick<Draft, 'look' | 'timed' | 'rounds' | 'tick'> = { look: 'badge', timed: true, rounds: 1, tick: 'end' };

/** Add, change and remove effects on one or several tokens. */
export function EffectsModal(props: { client: TableClient; ids: string[]; onClose: () => void }) {
  const { client } = props;
  useClient(client);
  const tokens = props.ids.map((id) => client.scene?.tokens.get(id)).filter((t): t is Token => !!t);
  const multi = tokens.length > 1;
  const [d, setD] = useState<Draft>({ n: '', ic: '', c: '#ff6b6b', ...last, preset: '' });
  const set = (p: Partial<Draft>) => setD((x) => {
    const next = { ...x, ...p };
    last = { look: next.look, timed: next.timed, rounds: next.rounds, tick: next.tick };
    return next;
  });
  if (!tokens.length) return null;
  const t0 = tokens[0];
  const ids = tokens.map((t) => t.id);

  function add() {
    if (!d.n.trim()) { toast('Give the effect a name, or pick one from the list.', 'error', 2400); return; }
    void client.addEffect(ids, makeEffect({ n: d.n, ic: d.ic, c: d.c, look: d.look, left: d.timed ? d.rounds : null, tick: d.tick }))
      .then(() => set({ n: '', ic: '', preset: '' }))
      .catch((e) => toast((e as Error).message, 'error'));
  }
  const pick = (p: { n: string; ic: string; c: string }) => set({ n: p.n, ic: p.ic, c: p.c, preset: p.n });

  const conds = FX_PRESETS.filter((p) => p.group === 'condition');
  const others = FX_PRESETS.filter((p) => p.group === 'other');
  const chips = (list: typeof FX_PRESETS) => list.map((p) => (
    <button key={p.n} class={`fx-chip ${d.preset === p.n ? 'on' : ''}`} style={{ '--fxc': p.c } as Record<string, string>} title={`${p.n}: click to pick, then Add`}
      onClick={() => pick(p)} onDblClick={() => { pick(p); queueMicrotask(add); }}>
      <span class="fx-chip-ic">{p.ic}</span>{p.n}
    </button>
  ));

  return (
    <Modal title={multi ? `Effects · ${tokens.length} tokens` : `Effects · ${t0.name || 'Unnamed token'}`} onClose={props.onClose} width={600}
      footer={<>
        {!multi && t0.fx.length > 0 && <button class="btn" onClick={() => void client.changeFx(ids, () => [], 'Clear effects')}>Clear all</button>}
        <span class="spacer" />
        <button class="btn primary" onClick={props.onClose}>Done</button>
      </>}>
      {multi ? (
        <p class="muted" style={{ marginTop: 0 }}>Effects you add go on all {tokens.length} selected tokens.</p>
      ) : (
        <div class="fx-now">
          {t0.fx.length === 0 && <p class="muted" style={{ margin: '0 0 6px' }}>No effects on this token yet.</p>}
          {t0.fx.map((e) => (
            <div key={e.id} class="fx-line">
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
              <button class="icon-btn" title="Take this effect off" onClick={() => void client.removeEffect([t0.id], e.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <h4>Add an effect</h4>
      <div class="fx-chips">{chips(conds)}</div>
      <div class="fx-chips">{chips(others)}</div>

      <div class="fx-form">
        <label class="field" style={{ flex: 1 }}>
          <span class="field-label">Name (anything you like)</span>
          <input type="text" value={d.n} maxLength={40} placeholder="Poisoned, Hexed by the hag, Wet…"
            onInput={(e) => set({ n: (e.target as HTMLInputElement).value, preset: '' })}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); e.stopPropagation(); }} />
        </label>
        <label class="field" style={{ width: '90px' }}>
          <span class="field-label">Picture</span>
          <input type="text" value={d.ic} maxLength={4} placeholder="🤢" style={{ textAlign: 'center', fontSize: '18px' }}
            onInput={(e) => set({ ic: (e.target as HTMLInputElement).value })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label class="field" style={{ width: '64px' }}>
          <span class="field-label">Colour</span>
          <input type="color" value={d.c} onInput={(e) => set({ c: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
      <div class="fx-icons">
        {FX_ICONS.map((ic) => <button key={ic} class={`fx-pic ${d.ic === ic ? 'on' : ''}`} title="Use this picture" onClick={() => set({ ic })}>{ic}</button>)}
      </div>

      <div class="field">
        <span class="field-label">How it shows on the token</span>
        <div class="seg">
          {FX_LOOKS.map((l) => <button key={l.id} class={d.look === l.id ? 'on' : ''} title={l.hint} onClick={() => set({ look: l.id })}>{l.label}</button>)}
        </div>
      </div>

      <div class="field">
        <span class="field-label">How long it lasts</span>
        <div class="row" style={{ marginBottom: 0 }}>
          <div class="seg">
            <button class={!d.timed ? 'on' : ''} onClick={() => set({ timed: false })}>Until I remove it</button>
            <button class={d.timed ? 'on' : ''} onClick={() => set({ timed: true })}>A number of rounds</button>
          </div>
          {d.timed && (
            <>
              <input type="number" class="num" min={1} max={999} value={d.rounds} style={{ width: '64px' }} aria-label="Rounds"
                onInput={(e) => set({ rounds: Math.max(1, Math.round(Number((e.target as HTMLInputElement).value) || 1)) })} onKeyDown={(e) => e.stopPropagation()} />
              <span class="muted">round{d.rounds === 1 ? '' : 's'}</span>
            </>
          )}
        </div>
        {d.timed && (
          <>
            <div class="seg" style={{ marginTop: '6px' }}>
              {FX_TICKS.map((t) => <button key={t.id} class={d.tick === t.id ? 'on' : ''} title={t.hint} onClick={() => set({ tick: t.id })}>{t.label}</button>)}
            </div>
            <span class="hint">Counts down by itself as you press Next turn in the initiative. Without a turn order it just stays, so you can nudge it with − and + or remove it yourself.</span>
          </>
        )}
      </div>

      <div class="row" style={{ marginBottom: 0 }}>
        <button class="btn primary" onClick={add}>Add {d.n.trim() ? `“${d.n.trim()}”` : 'effect'}{multi ? ` to ${tokens.length} tokens` : ''}</button>
        {!multi && t0.fx.some((e) => e.n.toLowerCase() === d.n.trim().toLowerCase()) && d.n.trim() && <span class="muted small">It is already on: adding it again restarts its timer.</span>}
      </div>
    </Modal>
  );
}
