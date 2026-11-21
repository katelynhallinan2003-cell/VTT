import { useRef, useState } from 'preact/hooks';
import { entryName, healthState, HEALTH_COLOR, HEALTH_LABEL, orderOf, pctOf, rollD20 } from '../core/combat';
import type { Board } from '../board/Board';
import type { TableClient } from '../state/client';
import type { UiState } from '../state/ui';
import type { InitEntry, Token } from '../types';
import { Modal, Toggle, toast, useClient, useUi } from './common';

/** A thin health bar, coloured by how hurt the creature is. */
export function HpBar(props: { pct: number; width?: number }) {
  const col = HEALTH_COLOR[healthState(props.pct)];
  return (
    <span class="hpbar" style={{ width: props.width ? `${props.width}px` : undefined }} title={HEALTH_LABEL[healthState(props.pct)]}>
      <i style={{ width: `${Math.max(0, Math.min(100, props.pct))}%`, background: col }} />
    </span>
  );
}

/** "7" or "-7" is damage, "+7" is healing. Returns the amount to take off (negative heals). */
export function parseDamage(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Math.abs(parseInt(t, 10));
  if (!n) return null;
  return t.startsWith('+') ? -n : n;
}

function Avatar(props: { token: Token | undefined; name: string }) {
  const t = props.token;
  return <span class="tok-av" style={{ borderColor: t?.ring ?? 'var(--border)' }}>{t?.img ? <img src={t.img} alt="" loading="lazy" /> : (props.name || '?').charAt(0).toUpperCase()}</span>;
}

// ================================================================== DM panel
export function InitiativePanel(props: { client: TableClient; ui: UiState; board: Board | null; onRoll: () => void; onEdit: (ids: string[]) => void }) {
  const { client, ui, board } = props;
  useClient(client);
  const d = useUi(ui);
  const scene = client.scene;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [freeName, setFreeName] = useState('');
  const [freeInit, setFreeInit] = useState('');
  if (!scene) return <p class="muted">No scene is open.</p>;
  const init = scene.init;
  const entries = orderOf(init.entries);
  const fail = (e: unknown) => toast((e as Error).message, 'error');

  function rowDrop(beforeId: string | null) {
    if (dragId && dragId !== beforeId) void client.initMove(dragId, beforeId).catch(fail);
    setDragId(null);
    setOverId(null);
  }

  function addFree() {
    const n = Number(freeInit);
    if (!freeName.trim() || !Number.isFinite(n) || freeInit.trim() === '') { toast('Give it a name and a number.', 'error', 2200); return; }
    void client.initAddFree(freeName, n).catch(fail);
    setFreeName('');
    setFreeInit('');
  }

  return (
    <>
      <div class="init-head">
        <div class="init-round">{init.entries.length ? <>Round <strong>{Math.max(1, init.round)}</strong></> : <span class="muted">No combat yet</span>}</div>
        <div class="row" style={{ marginBottom: 0 }}>
          <button class="btn small" disabled={!entries.length} title="Previous turn" onClick={() => void client.initStep(-1)}>◀</button>
          <button class="btn small primary" disabled={!entries.length} title="Next turn" onClick={() => void client.initStep(1)}>Next turn ▶</button>
        </div>
      </div>

      <div class="row wrap">
        <button class="btn small primary" onClick={props.onRoll}>🎲 Roll for initiative…</button>
        <button class="btn small" disabled={entries.length < 2} title="Sort by number again" onClick={() => void client.initSort()}>Sort</button>
        <button class="btn small" disabled={!entries.length} onClick={() => { if (confirm('End combat and clear the order?')) void client.initEnd(); }}>End combat</button>
      </div>
      <Toggle checked={init.shown} onChange={(v) => void client.initShow(v)} label="Show the order to players"
        hint="Lines you hide (👁) and hidden tokens never appear for them." />

      {entries.length === 0 && <p class="muted">Press “Roll for initiative” to enter a number for each token. The order sorts itself.</p>}
      <ul class="init-list">
        {entries.map((e) => (
          <InitRow key={e.id} entry={e} client={client} turn={init.turn === e.id}
            selected={!!e.tk && d.selection.has(e.tk)}
            dragging={dragId === e.id} over={overId === e.id && dragId !== e.id}
            onDragStart={() => setDragId(e.id)} onDragEnd={() => { setDragId(null); setOverId(null); }}
            onDragOver={() => setOverId(e.id)} onDrop={() => rowDrop(e.id)}
            onPick={() => { const t = e.tk ? scene.tokens.get(e.tk) : null; if (t) { ui.select([t.id]); board?.centerOn({ x: t.x, y: t.y }); } }}
            onEdit={(id) => props.onEdit([id])} />
        ))}
        {dragId && <li class={`init-end ${overId === '__end' ? 'over' : ''}`} onDragOver={(ev) => { ev.preventDefault(); setOverId('__end'); }} onDrop={(ev) => { ev.preventDefault(); rowDrop(null); }}>Drop here to go last</li>}
      </ul>

      {entries.length > 0 && (
        <div class="init-add">
          <input type="text" placeholder="Something else (lair action…)" value={freeName} onInput={(e) => setFreeName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addFree(); }} />
          <input type="number" class="num" placeholder="#" value={freeInit} onInput={(e) => setFreeInit((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addFree(); }} />
          <button class="btn small" onClick={addFree}>Add</button>
        </div>
      )}
    </>
  );
}

function InitRow(props: {
  entry: InitEntry; client: TableClient; turn: boolean; selected: boolean; dragging: boolean; over: boolean;
  onDragStart: () => void; onDragEnd: () => void; onDragOver: () => void; onDrop: () => void; onPick: () => void; onEdit: (id: string) => void;
}) {
  const { entry: e, client } = props;
  const token = e.tk ? client.scene?.tokens.get(e.tk) : undefined;
  const name = entryName(e, client.scene?.tokens ?? new Map());
  const gone = !!e.tk && !token;
  const pct = token ? pctOf(token.hp, token.maxHp) : null;
  const [dmg, setDmg] = useState('');
  const hiddenByToken = !!token?.hidden;
  const secret = e.h || hiddenByToken;

  /** The buttons always do what they say; Enter follows the sign (a plain number hurts, +number heals). */
  function applyDamage(sign: 1 | -1 | 0) {
    const n = sign === 0 ? parseDamage(dmg) : parseDamage(dmg.replace(/^[+-]/, ''));
    if (n == null || !token) return;
    void client.damage([token.id], sign === 0 ? n : sign * n);
    setDmg('');
  }

  const hasHp = !!token && token.hp != null && token.maxHp != null;
  return (
    <li class={`init-row ${props.turn ? 'turn' : ''} ${props.selected ? 'on' : ''} ${props.dragging ? 'dragging' : ''} ${props.over ? 'over' : ''} ${gone ? 'gone' : ''}`}
      draggable
      onDragStart={(ev) => { ev.dataTransfer?.setData('text/plain', e.id); props.onDragStart(); }}
      onDragEnd={props.onDragEnd}
      onDragOver={(ev) => { ev.preventDefault(); props.onDragOver(); }}
      onDrop={(ev) => { ev.preventDefault(); props.onDrop(); }}>
      <div class="init-line">
        <span class="init-grip" title="Drag to change the order">⠿</span>
        <input class="init-num" type="number" value={e.i} title="Initiative. Changing it re-sorts the order."
          onChange={(ev) => { const n = Number((ev.target as HTMLInputElement).value); if (Number.isFinite(n)) void client.initEdit(e.id, { i: n }); }}
          onClick={(ev) => ev.stopPropagation()} />
        <span class="init-who" onClick={props.onPick}>
          <Avatar token={token} name={name} />
          <span class="init-name"><span class={secret ? 'muted' : ''}>{name}{gone ? ' (removed)' : ''}</span></span>
        </span>
        {token && !hasHp && !gone && <button class="icon-btn" title="Track hit points for this token…" aria-label="Track hit points" onClick={() => props.onEdit(token.id)}>♡</button>}
        <button class={`icon-btn ${secret ? 'on' : ''}`} disabled={hiddenByToken}
          title={hiddenByToken ? 'Its token is hidden, so players do not see this line.' : e.h ? 'Secret: players do not see this line. Click to show.' : 'Players can see this line. Click to hide it.'}
          onClick={() => void client.initEdit(e.id, { h: !e.h })}>{secret ? '🙈' : '👁'}</button>
        <button class="icon-btn" title="Take out of the order" onClick={() => void client.initRemove(e.id)}>✕</button>
      </div>
      {hasHp && token && (
        <div class="init-sub">
          <HpBar pct={pct ?? 0} width={70} />
          <span class="init-hp">{token.hp}/{token.maxHp}</span>
          <span class="init-dmg">
            <input type="text" inputMode="numeric" placeholder="HP ±" value={dmg} title="Type a number, then − to hurt or + to heal. Enter hurts, or heals when you start with +."
              onInput={(ev) => setDmg((ev.target as HTMLInputElement).value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') applyDamage(0); ev.stopPropagation(); }} />
            <button class="icon-btn" title="Damage" onClick={() => applyDamage(1)}>−</button>
            <button class="icon-btn" title="Heal" onClick={() => applyDamage(-1)}>+</button>
          </span>
        </div>
      )}
    </li>
  );
}

// ================================================================== roll popup
interface Row { include: boolean; init: string; mod: string }

/** One number box per token. Press Enter to jump to the next one. */
export function InitRollModal(props: { client: TableClient; onClose: () => void }) {
  const { client } = props;
  useClient(client);
  const tokens = [...(client.scene?.tokens.values() ?? [])]
    .sort((a, b) => Number(!!b.ownerUid) - Number(!!a.ownerUid) || (a.name || '~').localeCompare(b.name || '~'));
  const existing = new Map((client.scene?.init.entries ?? []).filter((e) => e.tk).map((e) => [e.tk!, e]));
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(
    tokens.map((t) => [t.id, { include: true, init: existing.has(t.id) ? String(existing.get(t.id)!.i) : '', mod: '0' }]),
  ));
  const root = useRef<HTMLDivElement>(null);
  const row = (id: string): Row => rows[id] ?? { include: true, init: '', mod: '0' };
  const set = (id: string, p: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...row(id), ...p } }));

  const roll = (id: string) => set(id, { init: String(rollD20() + (parseInt(row(id).mod, 10) || 0)) });
  const rollEmpty = () => setRows((r) => {
    const next = { ...r };
    for (const t of tokens) {
      const cur = next[t.id] ?? { include: true, init: '', mod: '0' };
      if (cur.include && cur.init.trim() === '') next[t.id] = { ...cur, init: String(rollD20() + (parseInt(cur.mod, 10) || 0)) };
    }
    return next;
  });
  const setAll = (include: boolean) => setRows((r) => Object.fromEntries(tokens.map((t) => [t.id, { ...(r[t.id] ?? { init: '', mod: '0' }), include }])));

  const ready = tokens.filter((t) => row(t.id).include && row(t.id).init.trim() !== '' && Number.isFinite(Number(row(t.id).init)));
  const missing = tokens.filter((t) => row(t.id).include && row(t.id).init.trim() === '').length;

  async function apply() {
    try {
      await client.initApply(ready.map((t) => ({ tk: t.id, n: t.name || 'Unnamed', i: Number(row(t.id).init), h: t.hidden })));
      props.onClose();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  function focusNext(from: HTMLElement) {
    const inputs = [...(root.current?.querySelectorAll<HTMLInputElement>('input.roll-in') ?? [])];
    const at = inputs.indexOf(from as HTMLInputElement);
    inputs[at + 1]?.focus();
    inputs[at + 1]?.select();
  }

  return (
    <Modal title="Roll for initiative" onClose={props.onClose} width={560}
      footer={<>
        <button class="btn" onClick={rollEmpty} title="Roll a d20 (plus the modifier) for every ticked token with no number yet">🎲 Roll all empty</button>
        <span class="spacer" />
        <button class="btn" onClick={props.onClose}>Cancel</button>
        <button class="btn primary" disabled={!ready.length} onClick={apply}>{ready.length ? `Add ${ready.length} to the order` : 'Enter some numbers'}</button>
      </>}>
      <p class="muted" style={{ marginTop: 0 }}>Type what each one rolled. Press Enter to jump to the next box. The order sorts itself when you add them.</p>
      <div class="row wrap" style={{ marginBottom: '6px' }}>
        <button class="btn small" onClick={() => setAll(true)}>Tick all</button>
        <button class="btn small" onClick={() => setAll(false)}>Tick none</button>
        {missing > 0 && <span class="muted small">{missing} ticked without a number</span>}
      </div>
      {tokens.length === 0 && <p class="muted">There are no tokens on this scene yet.</p>}
      <div class="roll-list" ref={root}>
        {tokens.map((t) => {
          const r = row(t.id);
          const owner = t.ownerUid ? client.players.get(t.ownerUid) : null;
          return (
            <div key={t.id} class={`roll-row ${r.include ? '' : 'off'}`}>
              <input type="checkbox" checked={r.include} onChange={(e) => set(t.id, { include: (e.target as HTMLInputElement).checked })} aria-label={`Include ${t.name || 'token'}`} />
              <Avatar token={t} name={t.name} />
              <span class="roll-name">
                <span class={t.hidden ? 'muted' : ''}>{t.name || 'Unnamed'}{t.hidden ? ' (hidden)' : ''}</span>
                {owner && <span class="tok-sub"><span class="dot" style={{ background: owner.color }} /> {owner.name}</span>}
              </span>
              <input class="roll-in" type="number" placeholder="Initiative" value={r.init} disabled={!r.include}
                onInput={(e) => set(t.id, { init: (e.target as HTMLInputElement).value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(e.target as HTMLElement); } }} />
              <span class="roll-mod" title="Added when you roll the dice for this one">
                <span class="muted">+</span>
                <input type="number" value={r.mod} disabled={!r.include} onInput={(e) => set(t.id, { mod: (e.target as HTMLInputElement).value })} />
              </span>
              <button class="icon-btn" title="Roll a d20 plus the modifier" disabled={!r.include} onClick={() => roll(t.id)}>🎲</button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ================================================================== the order, as shown on screen
/**
 * A narrow list on the right edge. Players see it once the DM reveals the order.
 * The DM sees it only while the side panel is folded away (the panel has the full tracker).
 */
export function InitStrip(props: { client: TableClient; ui: UiState; board: Board | null }) {
  const { client, ui, board } = props;
  useClient(client);
  const d = useUi(ui);
  const scene = client.scene;
  if (!scene) return null;
  const tokens = scene.tokens;

  let items: { id: string; tk: string | null; name: string; i: number; secret: boolean }[] = [];
  let turn: string | null = null;
  let round = 0;
  if (client.isDM) {
    if (d.dockOpen || !scene.init.entries.length) return null;
    items = orderOf(scene.init.entries).map((e) => ({ id: e.id, tk: e.tk, name: entryName(e, tokens), i: e.i, secret: e.h || !!(e.tk && tokens.get(e.tk)?.hidden) }));
    turn = scene.init.turn;
    round = scene.init.round;
  } else {
    const pub = scene.initPub;
    if (!pub) return null;
    items = pub.entries.map((e) => ({ id: e.id, tk: e.tk, name: entryName(e, tokens), i: e.i, secret: false }));
    turn = pub.turn;
    round = pub.round;
  }
  if (!items.length) return null;

  return (
    <div class="initstrip" onMouseDown={(e) => e.stopPropagation()} aria-label="Initiative order">
      <div class="initstrip-head">
        <span>Round <strong>{Math.max(1, round)}</strong></span>
        {client.isDM && <button class="btn small primary" onClick={() => void client.initStep(1)}>Next ▶</button>}
      </div>
      <ul>
        {items.map((it) => {
          const t = it.tk ? tokens.get(it.tk) : undefined;
          return (
            <li key={it.id} class={`${turn === it.id ? 'turn' : ''} ${it.secret ? 'secret' : ''} ${t && d.selection.has(t.id) ? 'on' : ''}`}
              onClick={() => { if (t) { ui.select([t.id]); board?.centerOn({ x: t.x, y: t.y }); } }}>
              <Avatar token={t} name={it.name} />
              <span class="init-name">
                <span>{it.name}</span>
                {t && !client.isDM && t.hpShow !== 'off' && t.hpPct != null && healthState(t.hpPct) !== 'ok' && (
                  <span class="tok-sub" style={{ color: HEALTH_COLOR[healthState(t.hpPct)] }}>{HEALTH_LABEL[healthState(t.hpPct)]}</span>
                )}
              </span>
              <span class="init-val">{it.i}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
