import { useEffect, useRef, useState } from 'preact/hooks';
import { entryName, healthState, HEALTH_COLOR, HEALTH_LABEL, orderOf, pctOf, rollD20, withoutLights } from '../core/combat';
import { isLightMark } from '../core/light';
import type { Board } from '../board/Board';
import type { TableClient } from '../state/client';
import type { UiState } from '../state/ui';
import type { InitEntry, Token } from '../types';
import { Toggle, toast, useClient, useUi } from './common';
import { FxIcons } from './effects';

/** A thin health bar, coloured by how hurt the creature is. Temporary hit points show as a blue strip along the top (as a share of the maximum). */
export function HpBar(props: { pct: number; width?: number; temp?: number }) {
  const col = HEALTH_COLOR[healthState(props.pct)];
  return (
    <span class="hpbar" style={{ width: props.width ? `${props.width}px` : undefined }} title={HEALTH_LABEL[healthState(props.pct)]}>
      <i style={{ width: `${Math.max(0, Math.min(100, props.pct))}%`, background: col }} />
      {props.temp != null && props.temp > 0 && <b class="hpbar-temp" style={{ width: `${Math.min(100, props.temp)}%` }} />}
    </span>
  );
}

/** What fraction of its maximum a token's temporary hit points are, as a percentage. */
export const tempPct = (t: Pick<Token, 'tempHp' | 'maxHp'>): number => (t.maxHp ? (t.tempHp / t.maxHp) * 100 : 0);

/** "7" or "-7" is damage, "+7" is healing. Returns the amount to take off (negative heals). */
/** Say what giving temporary hit points did, including when nothing changed because they already had more. */
export function tellTemp(r: { name: string; had: number; now: number }[], asked: number) {
  if (!r.length) { toast('Only tokens with hit points can have temporary ones.', 'info', 2400); return; }
  const same = r.every((x) => x.now === x.had);
  if (same) toast(r.length === 1 ? `${r[0].name} already has ${r[0].had} temporary hit points. The higher number is kept.` : `They already have at least ${asked} temporary hit points.`, 'info', 3600);
  else toast(r.length === 1 ? `${r[0].name} now has ${r[0].now} temporary hit points.` : `${r.length} tokens have temporary hit points.`, 'ok', 2200);
}

export function parseDamage(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Math.abs(parseInt(t, 10));
  if (!n) return null;
  return t.startsWith('+') ? -n : n;
}

export function Avatar(props: { token: Token | undefined; name: string }) {
  const t = props.token;
  return <span class="tok-av" style={{ borderColor: t?.ring ?? 'var(--border)' }}>{t?.img ? <img src={t.img} alt="" loading="lazy" /> : (props.name || '?').charAt(0).toUpperCase()}</span>;
}

// ================================================================== DM pop-up
interface RollOv { include?: boolean; d20?: string; bonus?: string }
type PopTab = 'roll' | 'order';

const fmtBonus = (n: number): string => (n > 0 ? `+${n}` : String(n));
const toBonus = (s: string | undefined, dflt: number): number => {
  if (s === undefined) return dflt;
  const n = parseInt(s.replace(/^\+/, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The initiative pop-up: roll for everyone (digital dice or a physical d20), keep the order, step through the turns.
 * It floats over the map; the order itself is shown in the strip across the top.
 */
export function InitPopup(props: { client: TableClient; ui: UiState; board: Board | null; onEdit: (ids: string[]) => void; onEffects: (ids: string[]) => void }) {
  const { client, ui, board } = props;
  useClient(client);
  const d = useUi(ui);
  const scene = client.scene;
  const [tab, setTab] = useState<PopTab>('roll');
  const [ov, setOv] = useState<Record<string, RollOv>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [freeName, setFreeName] = useState('');
  const [freeInit, setFreeInit] = useState('');
  const [freeHide, setFreeHide] = useState(false);
  const wasOpen = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  // opening it starts on the roll list when there is no combat yet, otherwise on the order
  useEffect(() => {
    if (d.initOpen && !wasOpen.current) setTab(client.scene?.init.entries.length ? 'order' : 'roll');
    wasOpen.current = d.initOpen;
  }, [d.initOpen]);
  if (!client.isDM || !d.initOpen || !scene) return null;

  const init = withoutLights(scene.init, scene.tokens);
  const entries = orderOf(init.entries);
  const inOrder = new Map(entries.filter((e) => e.tk).map((e) => [e.tk!, e]));
  const fail = (e: unknown) => toast((e as Error).message, 'error');
  const close = () => ui.set({ initOpen: false });

  // ---- roll tab
  const tokens = [...scene.tokens.values()].filter((t) => !isLightMark(t)).sort((a, b) =>
    Number(inOrder.has(a.id)) - Number(inOrder.has(b.id)) || Number(!!b.ownerUid) - Number(!!a.ownerUid) || (a.name || '~').localeCompare(b.name || '~'));
  const row = (t: Token) => {
    const o = ov[t.id] ?? {};
    const bonus = toBonus(o.bonus, t.initBonus);
    const d20 = (o.d20 ?? '').trim();
    const die = d20 !== '' && Number.isFinite(Number(d20)) ? Number(d20) : null;
    return { include: o.include ?? !inOrder.has(t.id), d20: o.d20 ?? '', bonusText: o.bonus ?? fmtBonus(t.initBonus), bonus, total: die == null ? null : die + bonus };
  };
  const setRow = (id: string, p: RollOv) => setOv((r) => ({ ...r, [id]: { ...r[id], ...p } }));
  const rollOne = (t: Token) => setRow(t.id, { d20: String(rollD20()) });
  const rollEmpty = () => setOv((r) => {
    const next = { ...r };
    for (const t of tokens) {
      const rw = row(t);
      if (rw.include && rw.d20.trim() === '') next[t.id] = { ...next[t.id], d20: String(rollD20()) };
    }
    return next;
  });
  const tick = (include: boolean) => setOv((r) => Object.fromEntries(tokens.map((t) => [t.id, { ...r[t.id], include }])));
  const rows = tokens.map((t) => ({ t, r: row(t) }));
  const ready = rows.filter((x) => x.r.include && x.r.total != null);
  const missing = rows.filter((x) => x.r.include && x.r.total == null).length;

  async function apply() {
    try {
      await client.initApply(ready.map((x) => ({ tk: x.t.id, n: x.t.name || 'Unnamed', i: x.r.total!, h: x.t.hidden })));
      setOv((r) => { const next = { ...r }; for (const x of ready) next[x.t.id] = { ...next[x.t.id], d20: '', include: false }; return next; });
      setTab('order');
    } catch (e) { fail(e); }
  }
  function commitBonus(t: Token, text: string) {
    const n = Math.max(-99, Math.min(99, toBonus(text, t.initBonus)));
    setRow(t.id, { bonus: undefined });
    if (n !== t.initBonus) void client.updateToken(t.id, { initBonus: n }).catch(fail);
  }
  function focusNext(from: HTMLElement) {
    const inputs = [...(root.current?.querySelectorAll<HTMLInputElement>('input.roll-in:not(:disabled)') ?? [])];
    const at = inputs.indexOf(from as HTMLInputElement);
    inputs[at + 1]?.focus();
    inputs[at + 1]?.select();
  }

  function addFree() {
    const n = Number(freeInit);
    if (!freeName.trim() || freeInit.trim() === '' || !Number.isFinite(n)) { toast('Give it a name and a number.', 'error', 2200); return; }
    void client.initAddFree(freeName, n, freeHide).then(() => { setTab('order'); }).catch(fail);
    setFreeName('');
    setFreeInit('');
  }

  function rowDrop(beforeId: string | null) {
    if (dragId && dragId !== beforeId) void client.initMove(dragId, beforeId).catch(fail);
    setDragId(null);
    setOverId(null);
  }

  return (
    <div class="initpop" ref={root} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Initiative">
      <div class="initpop-head">
        <h3>Initiative</h3>
        <span class="init-round">{entries.length ? <>Round <strong>{Math.max(1, init.round)}</strong></> : <span class="muted">no combat yet</span>}</span>
        <span class="spacer" />
        <button class="btn small" disabled={!entries.length} title="Previous turn" onClick={() => void client.initStep(-1)}>◀</button>
        <button class="btn small primary" disabled={!entries.length} title="Next turn" onClick={() => void client.initStep(1)}>Next turn ▶</button>
        <button class="icon-btn" title="Close (the order stays on screen)" aria-label="Close initiative" onClick={close}>✕</button>
      </div>
      <div class="seg initpop-tabs">
        <button class={tab === 'roll' ? 'on' : ''} onClick={() => setTab('roll')}>Roll</button>
        <button class={tab === 'order' ? 'on' : ''} onClick={() => setTab('order')}>Order{entries.length ? ` (${entries.length})` : ''}</button>
      </div>

      {tab === 'roll' && (
        <div class="initpop-body">
          <p class="muted small" style={{ margin: '0 0 6px' }}>
            Roll here, or type what a real d20 showed. Each token's bonus is added for you.
          </p>
          <div class="row wrap" style={{ marginBottom: '6px' }}>
            <button class="btn small primary" onClick={rollEmpty} title="Roll a d20 for every ticked token that has no number yet">🎲 Roll all empty</button>
            <button class="btn small" onClick={() => tick(true)}>Tick all</button>
            <button class="btn small" onClick={() => tick(false)}>Tick none</button>
            {missing > 0 && <span class="muted small">{missing} ticked without a roll</span>}
          </div>
          {tokens.length === 0 && <p class="muted">There are no tokens on this scene yet.</p>}
          {tokens.length > 0 && (
            <div class="roll-cols" aria-hidden="true"><span class="rc-name">Token</span><span class="rc-bonus">Bonus</span><span class="rc-die">d20</span><span class="rc-roll" /><span class="rc-total">Total</span></div>
          )}
          <div class="roll-list">
            {rows.map(({ t, r }) => {
              const owner = t.ownerUid ? client.players.get(t.ownerUid) : null;
              const cur = inOrder.get(t.id);
              return (
                <div key={t.id} class={`roll-row ${r.include ? '' : 'off'}`}>
                  <input type="checkbox" checked={r.include} onChange={(e) => setRow(t.id, { include: (e.target as HTMLInputElement).checked })} aria-label={`Include ${t.name || 'token'}`} />
                  <Avatar token={t} name={t.name} />
                  <span class="roll-name">
                    <span class={t.hidden ? 'muted' : ''}>{t.name || 'Unnamed'}{t.hidden ? ' (hidden)' : ''}</span>
                    {cur ? <span class="tok-sub">in the order at {cur.i}</span> : owner ? <span class="tok-sub"><span class="dot" style={{ background: owner.color }} /> {owner.name}</span> : null}
                  </span>
                  <input class="roll-bonus" type="text" inputMode="numeric" value={r.bonusText} disabled={!r.include} aria-label={`Initiative bonus of ${t.name || 'token'}`}
                    title="Added to the d20. Remembered for this token."
                    onInput={(e) => setRow(t.id, { bonus: (e.target as HTMLInputElement).value })}
                    onBlur={(e) => commitBonus(t, (e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
                  <input class="roll-in" type="number" min={1} max={20} placeholder="–" value={r.d20} disabled={!r.include} aria-label={`d20 for ${t.name || 'token'}`}
                    onInput={(e) => setRow(t.id, { d20: (e.target as HTMLInputElement).value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(e.target as HTMLElement); } e.stopPropagation(); }} />
                  <button class="icon-btn" title="Roll a d20 with the digital dice" disabled={!r.include} onClick={() => rollOne(t)}>🎲</button>
                  <span class={`roll-total ${r.total == null ? 'none' : ''}`} title="d20 + bonus">{r.total == null ? '–' : r.total}</span>
                </div>
              );
            })}
          </div>
          <div class="row" style={{ margin: '8px 0 12px' }}>
            <span class="spacer" />
            <button class="btn primary" disabled={!ready.length} onClick={apply}>{ready.length ? `Add ${ready.length} to the order` : 'Roll or type some numbers'}</button>
          </div>

          <h4>Add a turn that has no token</h4>
          <div class="init-add">
            <input type="text" class="free-name" placeholder="Lair action, late arrival, timer…" value={freeName} aria-label="Name of the extra turn" onInput={(e) => setFreeName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addFree(); e.stopPropagation(); }} />
            <input type="number" class="num" placeholder="#" value={freeInit} aria-label="Its initiative" onInput={(e) => setFreeInit((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addFree(); e.stopPropagation(); }} />
          </div>
          <div class="row" style={{ marginTop: '6px' }}>
            <label class="toggle"><input type="checkbox" checked={freeHide} onChange={(e) => setFreeHide((e.target as HTMLInputElement).checked)} /><span class="toggle-text">Hide from players</span></label>
            <span class="spacer" />
            <button class="btn small" onClick={addFree}>Add</button>
          </div>
        </div>
      )}

      {tab === 'order' && (
        <div class="initpop-body">
          <div class="row wrap" style={{ marginBottom: '6px' }}>
            <button class="btn small" disabled={entries.length < 2} title="Sort by number again" onClick={() => void client.initSort()}>Sort</button>
            <button class="btn small" disabled={!entries.length} title="Clear the order (Ctrl+Z brings it back)" onClick={() => void client.initEnd()}>End combat</button>
            <span class="spacer" />
            <Toggle checked={init.shown} onChange={(v) => void client.initShow(v)} label="Show to players" />
          </div>
          <p class="muted small" style={{ margin: '0 0 6px' }}>Drag a line to reorder. Players never see hidden lines (🙈) or hidden tokens.</p>
          {entries.length === 0 && <p class="muted">Nothing in the order yet. Use the Roll tab.</p>}
          <ul class="init-list">
            {entries.map((e) => (
              <InitRow key={e.id} entry={e} client={client} turn={init.turn === e.id}
                selected={!!e.tk && d.selection.has(e.tk)}
                dragging={dragId === e.id} over={overId === e.id && dragId !== e.id}
                onDragStart={() => setDragId(e.id)} onDragEnd={() => { setDragId(null); setOverId(null); }}
                onDragOver={() => setOverId(e.id)} onDrop={() => rowDrop(e.id)}
                onPick={() => { const t = e.tk ? scene.tokens.get(e.tk) : null; if (t) { ui.select([t.id]); board?.centerOn({ x: t.x, y: t.y }); } }}
                onEdit={(id) => props.onEdit([id])} onEffects={(id) => props.onEffects([id])} />
            ))}
            {dragId && <li class={`init-end ${overId === '__end' ? 'over' : ''}`} onDragOver={(ev) => { ev.preventDefault(); setOverId('__end'); }} onDrop={(ev) => { ev.preventDefault(); rowDrop(null); }}>Drop here to go last</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function InitRow(props: {
  entry: InitEntry; client: TableClient; turn: boolean; selected: boolean; dragging: boolean; over: boolean;
  onDragStart: () => void; onDragEnd: () => void; onDragOver: () => void; onDrop: () => void; onPick: () => void; onEdit: (id: string) => void; onEffects: (id: string) => void;
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
    if (n == null) { toast('Type how many hit points in the box first.', 'info', 2200); return; }
    if (!token) return;
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
          <span class="init-name">
            <span class={secret ? 'muted' : ''}>{name}{gone ? ' (removed)' : ''}</span>
            {token && token.fx.length > 0 && <FxIcons fx={token.fx} max={4} />}
          </span>
        </span>
        {token && !gone && <button class="icon-btn" title="Effects: poisoned, blessed, your own…" aria-label="Effects" onClick={() => props.onEffects(token.id)}>✨</button>}
        {token && !hasHp && !gone && <button class="icon-btn" title="Track hit points for this token…" aria-label="Track hit points" onClick={() => props.onEdit(token.id)}>♡</button>}
        <button class={`icon-btn ${secret ? 'on' : ''}`} disabled={hiddenByToken} aria-label={secret ? 'Secret line' : 'Public line'}
          title={hiddenByToken ? 'Its token is hidden, so players do not see this line.' : e.h ? 'Secret: players do not see this line. Click to show.' : 'Players can see this line. Click to hide it.'}
          onClick={() => void client.initEdit(e.id, { h: !e.h })}>{secret ? '🙈' : '👁'}</button>
        <button class="icon-btn" title="Take out of the order" aria-label="Remove from the order" onClick={() => void client.initRemove(e.id)}>✕</button>
      </div>
      {hasHp && token && (
        <div class="init-sub">
          <HpBar pct={pct ?? 0} width={70} temp={tempPct(token)} />
          <span class="init-hp">{token.hp}/{token.maxHp}{token.tempHp > 0 && <span class="temp-hp" title="Temporary hit points"> +{token.tempHp}</span>}</span>
          <span class="init-dmg">
            <input type="text" inputMode="numeric" placeholder="HP ±" value={dmg} title="Type a number, then − to hurt or + to heal. Enter hurts, or heals when you start with +."
              onInput={(ev) => setDmg((ev.target as HTMLInputElement).value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') applyDamage(0); ev.stopPropagation(); }} />
            <button class="icon-btn" title="Damage" onClick={() => applyDamage(1)}>−</button>
            <button class="icon-btn" title="Heal" onClick={() => applyDamage(-1)}>+</button>
            <button class="icon-btn" title="Give temporary hit points (you keep the higher of the old and new amount)" onClick={() => { const n = parseDamage(dmg.replace(/^[+-]/, '')); if (n == null) { toast('Type how many temporary hit points in the box first.', 'info', 2400); return; } if (token) { void client.giveTemp([token.id], Math.abs(n)).then((r) => tellTemp(r, Math.abs(n))); setDmg(''); } }}>T</button>
          </span>
        </div>
      )}
    </li>
  );
}

// ================================================================== the order, as shown on screen
interface StripItem { id: string; tk: string | null; name: string; i: number; secret: boolean }

/**
 * The turn order as little boxes across the top middle of the screen (or down the right edge, a setting).
 * Players see it once the DM reveals the order; the DM always sees it while there is a combat.
 */
export function InitStrip(props: { client: TableClient; ui: UiState; board: Board | null }) {
  const { client, ui, board } = props;
  useClient(client);
  const d = useUi(ui);
  const scene = client.scene;
  const listRef = useRef<HTMLUListElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  let items: StripItem[] = [];
  let turn: string | null = null;
  let round = 0;
  if (scene) {
    const tokens = scene.tokens;
    if (client.isDM) {
      const clean = withoutLights(scene.init, tokens);
      items = orderOf(clean.entries).map((e) => ({ id: e.id, tk: e.tk, name: entryName(e, tokens), i: e.i, secret: e.h || !!(e.tk && tokens.get(e.tk)?.hidden) }));
      turn = clean.turn;
      round = clean.round;
    } else if (scene.initPub) {
      items = scene.initPub.entries.map((e) => ({ id: e.id, tk: e.tk, name: entryName(e, tokens), i: e.i, secret: false }));
      turn = scene.initPub.turn;
      round = scene.initPub.round;
    }
  }
  // keep whose turn it is in view when the order is wider than the strip
  useEffect(() => {
    const el = listRef.current?.querySelector('li.turn') as HTMLElement | null;
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [turn, items.length, d.initPos]);

  if (!scene || !items.length) return null;
  const tokens = scene.tokens;
  const top = d.initPos === 'top';
  const drop = (beforeId: string | null) => {
    if (dragId && dragId !== beforeId) void client.initMove(dragId, beforeId).catch((e) => toast((e as Error).message, 'error'));
    setDragId(null);
    setOverId(null);
  };

  const strip = (
    <div class={`initstrip ${top ? 'top' : `side ${d.dockTab ? 'shift' : ''}`}`} onMouseDown={(e) => e.stopPropagation()} aria-label="Initiative order">
      <div class="initstrip-head">
        <span class="init-round">Round <strong>{Math.max(1, round)}</strong></span>
        {client.isDM && (
          <span class="initstrip-btns">
            <button class="btn small" title="Previous turn" aria-label="Previous turn" onClick={() => void client.initStep(-1)}>◀</button>
            <button class="btn small primary" title="Next turn" onClick={() => void client.initStep(1)}>Next ▶</button>
            <button class={`icon-btn ${d.initOpen ? 'on' : ''}`} title="Roll for initiative and edit the order" aria-label="Open initiative" onClick={() => ui.set({ initOpen: !d.initOpen })}>⚙</button>
          </span>
        )}
      </div>
      <ul ref={listRef}>
        {items.map((it) => {
          const t = it.tk ? tokens.get(it.tk) : undefined;
          const mine = !client.isDM && !!t && t.ownerUid === client.uid;
          const state = t && !client.isDM && t.hpShow !== 'off' && t.hpPct != null ? healthState(t.hpPct) : 'ok';
          return (
            <li key={it.id} class={`ibox ${turn === it.id ? 'turn' : ''} ${it.secret ? 'secret' : ''} ${mine ? 'mine' : ''} ${t && d.selection.has(t.id) ? 'on' : ''} ${dragId === it.id ? 'dragging' : ''} ${overId === it.id && dragId !== it.id ? 'over' : ''}`}
              title={`${it.name}${it.secret ? ' (only you see this)' : ''}${t && !client.isDM && t.hpShow === 'numbers' && t.hpNow != null ? ` · ${t.hpNow}/${t.hpCap} HP` : ''}${state !== 'ok' ? ` · ${HEALTH_LABEL[state]}` : ''}`}
              draggable={client.isDM}
              onDragStart={(ev) => { if (!client.isDM) return; ev.dataTransfer?.setData('text/plain', it.id); setDragId(it.id); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(ev) => { if (!dragId) return; ev.preventDefault(); setOverId(it.id); }}
              onDrop={(ev) => { if (!dragId) return; ev.preventDefault(); drop(it.id); }}
              onClick={() => { if (t) { ui.select([t.id]); board?.centerOn({ x: t.x, y: t.y }); } }}>
              <span class="ibox-num">{it.i}</span>
              <Avatar token={t} name={it.name} />
              <span class="ibox-name" style={state !== 'ok' ? { color: HEALTH_COLOR[state] } : undefined}>{it.name}</span>
              <span class="ibox-fx">{t && t.fx.length > 0 ? <FxIcons fx={t.fx} max={3} /> : null}{it.secret && <span class="ibox-secret" title="Only you see this">🙈</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return top ? <div class="initbar">{strip}</div> : strip;
}
