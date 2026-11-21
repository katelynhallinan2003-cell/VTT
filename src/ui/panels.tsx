import { useMemo, useRef, useState } from 'preact/hooks';
import { healthState, HEALTH_LABEL, pctOf } from '../core/combat';
import { TOKEN_SIZES } from '../core/model';
import { gridPeriod, isHex } from '../core/hex';
import { altitudeOf, altLabel, groundAt, setAltitude, zonesOf } from '../core/height';
import { throttle } from '../core/throttle';
import type { Board } from '../board/Board';
import type { TableClient } from '../state/client';
import type { DockTab, UiState } from '../state/ui';
import type { Aura, GridSettings, LabelMode, Token, TokenShape } from '../types';
import { Field, Section, SliderField, Toggle, toast, useClient, useUi } from './common';
import { uploadImage } from './uploads';
import { HpBar, parseDamage, tellTemp, tempPct } from './initiative';
import { FxIcons } from './effects';
import { AuraEditor } from './auraEditor';
import { PlayersPanel } from './modals';


/** Wraps a callback in a throttle that always uses the latest closure. */
function useThrottled<A extends unknown[]>(fn: (...a: A) => void, ms = 90) {
  const ref = useRef(fn);
  ref.current = fn;
  return useMemo(() => throttle((...a: A) => ref.current(...a), ms), []);
}

function FileButton(props: { label: string; accept?: string; onFile: (f: File) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={props.accept ?? 'image/*'} hidden
        onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) props.onFile(f); (e.target as HTMLInputElement).value = ''; }} />
      <button class="btn small" disabled={props.disabled} onClick={() => ref.current?.click()}>{props.label}</button>
    </>
  );
}

// ================================================================== token tag
/** A small box at the bottom of the screen naming what is selected. Everything else lives in the token editor. */
export function TokenTag(props: { client: TableClient; ui: UiState; onEdit: (ids: string[]) => void; onEffects: (ids: string[]) => void }) {
  const { client, ui } = props;
  useClient(client);
  const d = useUi(ui);
  const [auraOpen, setAuraOpen] = useState(false);
  const [heightOpen, setHeightOpen] = useState(false);
  const tokens = [...d.selection].map((id) => client.scene?.tokens.get(id)).filter((t): t is Token => !!t);
  if (!tokens.length) return null;
  const ids = tokens.map((t) => t.id);
  const t0 = tokens[0];
  const multi = tokens.length > 1;
  const editable = tokens.every((t) => client.canDo('edit', t));
  const allHidden = tokens.every((t) => t.hidden);
  const sizeLabel = TOKEN_SIZES.find((s) => s.size === t0.size)?.label ?? `${t0.size} squares`;
  const viewerSeesState = !client.isDM && !multi && t0.hpShow !== 'off' && t0.hpPct != null && healthState(t0.hpPct) !== 'ok';
  const sub = multi ? '' : [sizeLabel, viewerSeesState ? HEALTH_LABEL[healthState(t0.hpPct)] : '', t0.hidden ? 'hidden' : '', t0.locked ? 'locked' : '', t0.fx.map((e) => e.n).join(', ')].filter(Boolean).join(' · ');
  const tracked = client.isDM ? tokens.filter((t) => t.hp != null && t.maxHp != null) : [];
  const canAura = !multi && editable;
  const zones = zonesOf(client.scene?.draws.values() ?? []);
  const alts = tokens.map((t) => altitudeOf(t, groundAt(zones, t)));
  const a0 = alts[0];
  const altText = multi ? (alts.every((a) => a.alt === a0.alt) ? altLabel(a0, t0.fly) : '') : altLabel(a0, t0.fly);

  return (
    <div class="tokentag" onMouseDown={(e) => e.stopPropagation()}>
      {auraOpen && canAura && <AuraPop key={t0.id} client={client} token={t0} />}
      {heightOpen && editable && <HeightPop key={ids.join(',')} client={client} tokens={tokens} zones={zones} />}
      <div>
        <div class="tt-name">{multi ? `${tokens.length} tokens` : t0.name || 'Unnamed token'}</div>
        {sub && <div class="tt-sub">{sub}</div>}
      </div>
      {!multi && t0.fx.length > 0 && <FxIcons fx={t0.fx} max={6} />}
      {tracked.length > 0 && <HpControl client={client} tokens={tracked} />}
      <button class="btn small primary" disabled={!editable} title="Edit token (E)" onClick={() => props.onEdit(ids)}>Edit</button>
      {!client.isDM && !multi && client.canDo('claim', t0) && (
        <button class="btn small" onClick={() => void client.updateToken(t0.id, { ownerUid: client.uid })}>Take control</button>
      )}
      {editable && (
        <button class="btn small" title="Poisoned, blessed, or anything you make up: with or without a timer" onClick={() => props.onEffects(ids)}>
          Effects{!multi && t0.fx.length ? ` (${t0.fx.length})` : ''}
        </button>
      )}
      {editable && (
        <button class={`btn small ${heightOpen ? 'primary' : ''}`} title="How high it is: flying, or standing on high ground. ] and [ raise and lower it."
          onClick={() => { setHeightOpen(!heightOpen); setAuraOpen(false); }}>
          Height{altText ? ` ${altText}` : ''}
        </button>
      )}
      {canAura && (
        <button class={`btn small ${auraOpen ? 'primary' : ''}`} title="Coloured areas that follow this token" onClick={() => { setAuraOpen(!auraOpen); setHeightOpen(false); }}>
          Aura{t0.auras.length ? ` (${t0.auras.length})` : ''}
        </button>
      )}
      {client.isDM && (
        <button class="btn small" title={allHidden ? 'Players can not see it. Click to show it to them.' : 'Hide it from every player (you still see it, dimmed).'}
          onClick={() => void client.updateTokens(ids, { hidden: !allHidden })}>{allHidden ? 'Show to players' : 'Hide from players'}</button>
      )}
      <button class="icon-btn" title="Deselect" onClick={() => ui.select([])}>✕</button>
    </div>
  );
}

/** How high the selected token(s) are: take off, land, go up or down 5 ft, or type a height. Walkers stand on whatever ground is under them. */
function HeightPop(props: { client: TableClient; tokens: Token[]; zones: ReturnType<typeof zonesOf> }) {
  const { client, tokens, zones } = props;
  const alts = tokens.map((t) => altitudeOf(t, groundAt(zones, t)));
  const ids = tokens.map((t) => t.id);
  const flying = tokens.every((t) => t.fly);
  const same = alts.every((a) => a.alt === alts[0].alt);
  const move = (f: (a: ReturnType<typeof altitudeOf>) => number) => {
    tokens.forEach((t, i) => { void client.updateTokens([t.id], setAltitude(f(alts[i]), alts[i].ground)); });
  };
  const groundTxt = alts.every((a) => a.ground === alts[0].ground) ? (alts[0].ground ? `The ground here is ${alts[0].ground} ft.` : 'The ground here is at the base level.') : 'The ground differs under each token.';
  return (
    <div class="tt-pop height-pop" onKeyDown={(e) => e.stopPropagation()}>
      <div class="row wrap">
        <button class={`btn small ${flying ? 'primary' : ''}`} title="Take off, or land"
          onClick={() => { if (flying) void client.updateTokens(ids, { fly: false, elev: 0 }); else move((a) => Math.max(a.ground, 0) + 10); }}>{flying ? 'Flying: land' : 'Take off'}</button>
        <button class="btn small" title="Down 5 feet" onClick={() => move((a) => a.alt - 5)}>−5</button>
        <label class="numf" title="Feet above the map's base level">
          <span>Altitude</span>
          <input key={same ? alts[0].alt : 'x'} type="number" step={5} defaultValue={same ? alts[0].alt : ''} placeholder="Mixed" aria-label="Altitude in feet"
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            onChange={(e) => { const v = (e.target as HTMLInputElement).value; if (v === '') return; const n = Number(v); if (Number.isFinite(n)) move(() => Math.max(-1000, Math.min(5000, n))); }} />
          <span class="unit">ft</span>
        </label>
        <button class="btn small" title="Up 5 feet" onClick={() => move((a) => a.alt + 5)}>+5</button>
      </div>
      <div class="chips">
        {[10, 20, 30, 40, 60].map((h) => <button key={h} class="chip" onClick={() => move(() => h)}>{h} ft</button>)}
      </div>
      <p class="hint">{groundTxt} A flying token never sinks below it, and a walking one stands on it. Drag a flyer over a cliff and it keeps its altitude.</p>
    </div>
  );
}

/** Auras of one token, edited right from the tag at the bottom of the screen. New ones start in the token's ring colour. */
function AuraPop(props: { client: TableClient; token: Token }) {
  const { client, token } = props;
  const [auras, setAuras] = useState<Aura[]>(token.auras);
  const send = useThrottled((a: Aura[]) => { void client.updateToken(token.id, { auras: a }); }, 120);
  return (
    <div class="tt-pop">
      <AuraEditor compact auras={auras} ft={client.grid.ft} isDM={client.isDM} defaultColor={token.ring}
        onChange={(a) => { setAuras(a); send(a); }} />
    </div>
  );
}

/** Hit points of the selected token(s): a bar, the numbers, and a box to hurt or heal. DM only. */
function HpControl(props: { client: TableClient; tokens: Token[] }) {
  const { client, tokens } = props;
  const [text, setText] = useState('');
  const one = tokens.length === 1 ? tokens[0] : null;
  const box = useRef<HTMLInputElement>(null);
  /** Nothing typed yet: say so and put the cursor in the box, instead of silently doing nothing. */
  const needNumber = (n: number | null): n is number => {
    if (n != null) return true;
    toast(text.trim() ? `"${text.trim()}" is not a number. Type how many hit points, then press the button.` : 'Type how many hit points in the box first, then press the button.', 'info', 2600);
    box.current?.focus();
    return false;
  };
  /** The buttons always do what they say; Enter follows the sign (a plain number hurts, +number heals). */
  const apply = (sign: 1 | -1 | 0) => {
    const n = sign === 0 ? parseDamage(text) : parseDamage(text.replace(/^[+-]/, ''));
    if (!needNumber(n)) return;
    void client.damage(tokens.map((t) => t.id), sign === 0 ? n : sign * n);
    setText('');
  };
  const temp = () => {
    const n = parseDamage(text.replace(/^[+-]/, ''));
    if (!needNumber(n)) return;
    const amount = Math.abs(n);
    void client.giveTemp(tokens.map((t) => t.id), amount).then((r) => tellTemp(r, amount));
    setText('');
  };
  return (
    <span class="tt-hp" title={one ? `${one.hp} of ${one.maxHp} hit points` : `${tokens.length} tokens with hit points`}>
      {one && <><HpBar pct={pctOf(one.hp, one.maxHp) ?? 0} width={70} temp={tempPct(one)} /><span class="tt-hpnum">{one.hp}/{one.maxHp}{one.tempHp > 0 && <span class="temp-hp" title="Temporary hit points"> +{one.tempHp}</span>}</span></>}
      {!one && <span class="tt-hpnum">{tokens.length} with HP</span>}
      <input ref={box} type="text" inputMode="numeric" placeholder="±" value={text} aria-label="Hit points to take off or give back"
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter') apply(0); e.stopPropagation(); }} />
      <button class="btn small" title="Damage" onClick={() => apply(1)}>−</button>
      <button class="btn small" title="Heal" onClick={() => apply(-1)}>+</button>
      <button class="btn small" title="Give temporary hit points. They soak up damage first, and you keep the higher of the old and new amount."
        onClick={temp}>Temp</button>
    </span>
  );
}

// ================================================================== scene panel (DM)
/** The "Scene" tab: map, grid and fog settings. */
export function ScenePanel(props: { client: TableClient; ui: UiState; board: Board | null; onNewScene: () => void }) {
  const { client, ui, board } = props;
  useClient(client);
  const d = useUi(ui);
  const meta = client.scene?.meta;
  const gridT = useThrottled((p: Partial<GridSettings>) => { void client.updateScene({ grid: p }); });
  const mapT = useThrottled((p: { mapScale?: number }) => { void client.updateScene(p); });
  const bgT = useThrottled((bg: string) => { void client.updateScene({ bg }); });
  if (!client.isDM) return null;

  if (!meta) {
    return (
      <>
        <p class="muted">No scene is open.</p>
        <button class="btn primary" onClick={props.onNewScene}>+ New scene</button>
      </>
    );
  }
  const g = meta.grid;
  const setGrid = (p: Partial<GridSettings>) => { void client.updateScene({ grid: p }); };
  const hex = isHex(g);
  const per = gridPeriod(g);
  /** Changing the shape keeps the size, and puts the offsets back inside what the new shape repeats over. */
  const switchShape = (shape: GridSettings['shape']) => {
    if (shape === g.shape) return;
    const np = gridPeriod({ cell: g.cell, shape });
    setGrid({ shape, ox: Math.round(((g.ox % np.x) + np.x) % np.x * 100) / 100, oy: Math.round(((g.oy % np.y) + np.y) % np.y * 100) / 100 });
  };

  async function replaceMap(f: File) {
    try {
      const up = await uploadImage(client, f, 'map', f.name);
      await client.setSceneMap(up.url, up.w, up.h);
      toast('Map updated', 'ok');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <>
      <Section id="map" title="Map">
        <div class="row wrap">
          <FileButton label={meta.mapUrl ? 'Replace map…' : 'Add map…'} onFile={replaceMap} />
          <button class="btn small" onClick={() => board?.fit()}>Fit view</button>
        </div>
        <Toggle checked={meta.mapLocked} onChange={(v) => { void client.updateScene({ mapLocked: v }); if (v) ui.set({ mapSelected: false }); }}
          label="Lock map" hint="Locked: clicking and box-selecting never touches the map." />
        {!meta.mapLocked && (
          <SliderField label="Map size" value={Math.round(meta.mapScale * 100)} min={10} max={400} step={1} unit="%"
            onInput={(v) => mapT({ mapScale: v / 100 })} hint="Drag the map on the board to move it." />
        )}
        <Field label="Background colour" hint="The surface behind the map. White by default, so drawings show up.">
          <input type="color" value={meta.bg} onInput={(e) => bgT((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>

      <Section id="grid" title="Grid">
        <Field label="Grid type" hint={hex ? 'Hexes count every step the same, with no diagonals. Move a token with the arrow keys and it follows the hexes. Draw a box over the hexes again to line the grid up with your map.' : undefined}>
          <div class="seg">
            <button class={g.shape === 'square' ? 'on' : ''} onClick={() => switchShape('square')}>Squares</button>
            <button class={g.shape === 'pointy' ? 'on' : ''} title="Hexes with a point at the top: rows run straight across" onClick={() => switchShape('pointy')}>Hex, point up</button>
            <button class={g.shape === 'flat' ? 'on' : ''} title="Hexes with a flat top: columns run straight up and down" onClick={() => switchShape('flat')}>Hex, flat top</button>
          </div>
        </Field>
        <Toggle checked={g.visible} onChange={(v) => setGrid({ visible: v })} label="Show grid" />
        <Toggle checked={g.snap} onChange={(v) => setGrid({ snap: v })} label="Snap tokens to grid" hint="Hold Alt while dragging to skip snapping." />
        <button class={`btn ${d.tool === 'grid' ? 'primary' : ''}`} onClick={() => ui.set({ tool: d.tool === 'grid' ? 'select' : 'grid' })}>
          {d.tool === 'grid' ? (hex ? 'Drag a box around some hexes…' : 'Drag a box over the grid squares…') : 'Draw a box to set the grid'}
        </button>
        <Field label="Grid colour"><input type="color" value={g.color} onInput={(e) => gridT({ color: (e.target as HTMLInputElement).value })} /></Field>

        <Section id="grid-fine" title="Fine tune grid" defaultOpen={false}>
          <SliderField label={hex ? 'Hex size (side to side)' : 'Square size'} value={g.cell} min={10} max={300} step={0.1} unit="px" onInput={(v) => gridT({ cell: v })} />
          <SliderField label="Offset left / right" value={g.ox} min={0} max={Math.max(1, per.x)} step={0.1} unit="px" onInput={(v) => gridT({ ox: v })} />
          <SliderField label="Offset up / down" value={g.oy} min={0} max={Math.max(1, per.y)} step={0.1} unit="px" onInput={(v) => gridT({ oy: v })} />
          <SliderField label="Grid opacity" value={Math.round(g.opacity * 100)} min={0} max={100} unit="%" onInput={(v) => gridT({ opacity: v / 100 })} />
        </Section>
        <Section id="grid-rules" title="Distance rules" defaultOpen={false}>
          <div class="row">
            <Field label={hex ? 'Feet per hex' : 'Feet per square'}><input type="number" min={1} value={g.ft} onChange={(e) => setGrid({ ft: Math.max(1, Number((e.target as HTMLInputElement).value) || 5) })} /></Field>
            <Field label={hex ? 'Counting' : 'Diagonals'}>
              <select value={hex && g.rule === 'alt' ? 'chebyshev' : g.rule} onChange={(e) => setGrid({ rule: (e.target as HTMLSelectElement).value as GridSettings['rule'] })}>
                <option value="chebyshev">{hex ? 'Count hexes' : 'Every square 5 ft (5e)'}</option>
                {!hex && <option value="alt">5 / 10 / 5</option>}
                <option value="euclid">True distance</option>
              </select>
            </Field>
          </div>
        </Section>
      </Section>

      <Section id="fog" title="Fog of war">
        <Toggle checked={meta.fog.enabled} onChange={(v) => { void client.updateScene({ fog: { enabled: v } }); }} label="Fog of war on" />
        <Toggle checked={meta.fog.vision} onChange={(v) => { void client.updateScene({ fog: { vision: v } }); }} label="Tokens clear the fog around them"
          hint="Each token sees as far as its “Sight” setting (token editor). Hidden tokens never do." />
        {meta.fog.vision && (
          <>
            <Toggle checked={meta.fog.explore} onChange={(v) => { void client.updateScene({ fog: { explore: v } }); }} label="Keep what they have explored"
              hint="While your browser is open, the ground a token walks over stays revealed, following the route it really took. Hold W (for warp) while dragging a token to teleport it without clearing the way." />
            <SightAll client={client} />
          </>
        )}
        <div class="row wrap">
          <button class="btn small" onClick={() => void client.resetFog('hidden')}>Hide everything</button>
          <button class="btn small" onClick={() => void client.resetFog('clear')}>Reveal everything</button>
          <button class={`btn small ${d.tool === 'fog' ? 'primary' : ''}`} onClick={() => ui.set({ tool: d.tool === 'fog' ? 'select' : 'fog' })}>Fog tool (F)</button>
        </div>
      </Section>
    </>
  );
}

/** Give every token that belongs to a player the same sight distance in one go. */
function SightAll(props: { client: TableClient }) {
  const { client } = props;
  const [ft, setFt] = useState('60');
  const party = [...(client.scene?.tokens.values() ?? [])].filter((t) => t.ownerUid);
  return (
    <div class="row wrap">
      <span class="field-label" style={{ marginBottom: 0 }}>Player tokens see</span>
      <input type="number" class="num" min={0} step={5} value={ft} onInput={(e) => setFt((e.target as HTMLInputElement).value)} />
      <span class="unit">ft</span>
      <button class="btn small" disabled={!party.length} title={party.length ? `Set the sight of ${party.length} token${party.length === 1 ? '' : 's'}` : 'No token belongs to a player yet'}
        onClick={() => { const n = Math.max(0, Number(ft) || 0); void client.updateTokens(party.map((t) => t.id), { sight: n }); toast(`${party.length} token${party.length === 1 ? '' : 's'} now see ${n} ft`, 'ok', 2000); }}>
        Apply to {party.length}
      </button>
    </div>
  );
}

/** The "Tokens" tab: everything on this scene in one list, including hidden tokens. */
export function TokenList(props: { client: TableClient; ui: UiState; board: Board | null; onEdit: (ids: string[]) => void }) {
  const { client, ui, board } = props;
  useClient(client);
  const d = useUi(ui);
  const [q, setQ] = useState('');
  const all = [...(client.scene?.tokens.values() ?? [])].sort((a, b) => (a.name || '~').localeCompare(b.name || '~') || a.z - b.z);
  const shown = all.filter((t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <input type="text" placeholder={`Search ${all.length} token${all.length === 1 ? '' : 's'}…`} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style={{ marginBottom: '8px' }} />
      {shown.length === 0 && <p class="muted">{all.length ? 'No tokens match.' : 'No tokens on this scene yet. Press T to add one.'}</p>}
      <ul class="tok-list">
        {shown.map((t) => {
          const owner = t.ownerUid ? client.players.get(t.ownerUid) : null;
          return (
            <li key={t.id} class={d.selection.has(t.id) ? 'on' : ''}
              onClick={(e) => { ui.select((e as MouseEvent).shiftKey ? [...d.selection, t.id] : [t.id]); board?.centerOn({ x: t.x, y: t.y }); }}
              onDblClick={() => props.onEdit([t.id])}>
              <span class="tok-av" style={{ borderColor: t.ring }}>{t.img ? <img src={t.img} alt="" loading="lazy" /> : (t.name || '?').charAt(0).toUpperCase()}</span>
              <span class="tok-name">
                <span class={t.hidden ? 'muted' : ''}>{t.name || 'Unnamed'}</span>
                {owner && <span class="tok-sub"><span class="dot" style={{ background: owner.color }} /> {owner.name}</span>}
                {t.hp != null && t.maxHp != null && <span class="tok-sub"><HpBar pct={pctOf(t.hp, t.maxHp) ?? 0} width={46} /> {t.hp}/{t.maxHp}</span>}
              </span>
              <button class={`icon-btn ${t.hidden ? 'on' : ''}`} title={t.hidden ? 'Hidden from players. Click to reveal.' : 'Visible to players. Click to hide.'}
                onClick={(e) => { e.stopPropagation(); void client.updateTokens([t.id], { hidden: !t.hidden }); }}>{t.hidden ? '🙈' : '👁'}</button>
              <button class={`icon-btn ${t.locked ? 'on' : ''}`} title={t.locked ? 'Locked. Click to unlock.' : 'Click to lock in place.'}
                onClick={(e) => { e.stopPropagation(); void client.updateTokens([t.id], { locked: !t.locked }); }}>{t.locked ? '🔒' : '🔓'}</button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The little tabs on the right edge. Each opens its own panel; click the open one again to fold it away. */
export function Rail(props: { client: TableClient; ui: UiState }) {
  const { client, ui } = props;
  useClient(client);
  const d = useUi(ui);
  const online = [...client.players.values()].filter((p) => p.online).length;
  const tabs: { id: DockTab; label: string; extra?: string }[] = client.isDM
    ? [{ id: 'scene', label: 'Scene' }, { id: 'tokens', label: 'Tokens' }, { id: 'players', label: 'Players', extra: online ? String(online) : undefined }]
    : [{ id: 'players', label: 'Players', extra: online ? String(online) : undefined }];
  return (
    <div class={`rail ${d.dockTab ? 'open' : ''}`}>
      {tabs.map((t) => (
        <button key={t.id} class={`rail-tab ${d.dockTab === t.id ? 'on' : ''}`} aria-pressed={d.dockTab === t.id}
          title={d.dockTab === t.id ? `Hide ${t.label}` : `Show ${t.label}`}
          onClick={() => ui.set({ dockTab: d.dockTab === t.id ? null : t.id })}>
          {t.label}{t.extra && <span class="rail-n">{t.extra}</span>}
        </button>
      ))}
    </div>
  );
}

const DOCK_TITLES: Record<DockTab, string> = { scene: 'Scene', tokens: 'Tokens', players: 'Players' };

/** The panel that opens beside the tabs. */
export function Dock(props: { client: TableClient; ui: UiState; board: Board | null; onNewScene: () => void; onEdit: (ids: string[]) => void }) {
  const { client, ui } = props;
  useClient(client);
  const d = useUi(ui);
  const tab = d.dockTab;
  if (!tab || (!client.isDM && tab !== 'players')) return null;
  const sceneName = client.scene?.meta?.name;
  return (
    <aside class={`dock dock-${tab}`}>
      <div class="dock-head">
        <h3>{DOCK_TITLES[tab]}{tab === 'scene' && sceneName ? <span class="muted"> · {sceneName}</span> : null}</h3>
        <button class="icon-btn" title="Fold this panel away" aria-label="Hide panel" onClick={() => ui.set({ dockTab: null })}>⟩</button>
      </div>
      {tab === 'scene' && <ScenePanel client={client} ui={ui} board={props.board} onNewScene={props.onNewScene} />}
      {tab === 'tokens' && <TokenList client={client} ui={ui} board={props.board} onEdit={props.onEdit} />}
      {tab === 'players' && <PlayersPanel client={client} />}
    </aside>
  );
}
