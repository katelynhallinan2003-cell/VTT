import { useMemo, useRef, useState } from 'preact/hooks';
import { TOKEN_SIZES } from '../core/model';
import { throttle } from '../core/throttle';
import type { Board } from '../board/Board';
import type { TableClient } from '../state/client';
import type { UiState } from '../state/ui';
import type { GridSettings, LabelMode, Token, TokenShape } from '../types';
import { Field, Section, SliderField, Toggle, toast, useClient, useUi } from './common';
import { uploadImage } from './uploads';


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
export function TokenTag(props: { client: TableClient; ui: UiState; onEdit: (ids: string[]) => void }) {
  const { client, ui } = props;
  useClient(client);
  const d = useUi(ui);
  const tokens = [...d.selection].map((id) => client.scene?.tokens.get(id)).filter((t): t is Token => !!t);
  if (!tokens.length) return null;
  const ids = tokens.map((t) => t.id);
  const t0 = tokens[0];
  const multi = tokens.length > 1;
  const editable = tokens.every((t) => client.canDo('edit', t));
  const allHidden = tokens.every((t) => t.hidden);
  const sizeLabel = TOKEN_SIZES.find((s) => s.size === t0.size)?.label ?? `${t0.size} squares`;
  const sub = multi ? '' : [sizeLabel, t0.hidden ? 'hidden' : '', t0.locked ? 'locked' : ''].filter(Boolean).join(' · ');

  return (
    <div class="tokentag" onMouseDown={(e) => e.stopPropagation()}>
      <div>
        <div class="tt-name">{multi ? `${tokens.length} tokens` : t0.name || 'Unnamed token'}</div>
        {sub && <div class="tt-sub">{sub}</div>}
      </div>
      <button class="btn small primary" disabled={!editable} title="Edit token (E)" onClick={() => props.onEdit(ids)}>Edit</button>
      {!client.isDM && !multi && client.canDo('claim', t0) && (
        <button class="btn small" onClick={() => void client.updateToken(t0.id, { ownerUid: client.uid })}>Take control</button>
      )}
      {client.isDM && (
        <button class="btn small" onClick={() => void client.updateTokens(ids, { hidden: !allHidden })}>{allHidden ? 'Reveal' : 'Hide'}</button>
      )}
      <span class="tt-hint">Ctrl+C / V copy · Del delete</span>
      <button class="icon-btn" title="Deselect" onClick={() => ui.select([])}>✕</button>
    </div>
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
        <Toggle checked={g.visible} onChange={(v) => setGrid({ visible: v })} label="Show grid" />
        <Toggle checked={g.snap} onChange={(v) => setGrid({ snap: v })} label="Snap tokens to grid" hint="Hold Alt while dragging to skip snapping." />
        <button class={`btn ${d.tool === 'grid' ? 'primary' : ''}`} onClick={() => ui.set({ tool: d.tool === 'grid' ? 'select' : 'grid' })}>
          {d.tool === 'grid' ? 'Drag a box over the grid squares…' : 'Draw a box to set the grid'}
        </button>
        <Field label="Grid colour"><input type="color" value={g.color} onInput={(e) => gridT({ color: (e.target as HTMLInputElement).value })} /></Field>

        <Section id="grid-fine" title="Fine-tune" defaultOpen={false}>
          <SliderField label="Square size" value={g.cell} min={10} max={300} step={0.1} unit="px" onInput={(v) => gridT({ cell: v })} />
          <SliderField label="Offset left / right" value={g.ox} min={0} max={Math.max(1, g.cell)} step={0.1} unit="px" onInput={(v) => gridT({ ox: v })} />
          <SliderField label="Offset up / down" value={g.oy} min={0} max={Math.max(1, g.cell)} step={0.1} unit="px" onInput={(v) => gridT({ oy: v })} />
          <SliderField label="Grid opacity" value={Math.round(g.opacity * 100)} min={0} max={100} unit="%" onInput={(v) => gridT({ opacity: v / 100 })} />
        </Section>
        <Section id="grid-rules" title="Distance rules" defaultOpen={false}>
          <div class="row">
            <Field label="Feet per square"><input type="number" min={1} value={g.ft} onChange={(e) => setGrid({ ft: Math.max(1, Number((e.target as HTMLInputElement).value) || 5) })} /></Field>
            <Field label="Diagonals">
              <select value={g.rule} onChange={(e) => setGrid({ rule: (e.target as HTMLSelectElement).value as GridSettings['rule'] })}>
                <option value="chebyshev">Every square 5 ft (5e)</option>
                <option value="alt">5 / 10 / 5</option>
                <option value="euclid">True distance</option>
              </select>
            </Field>
          </div>
        </Section>
      </Section>

      <Section id="fog" title="Fog of war">
        <Toggle checked={meta.fog.enabled} onChange={(v) => { void client.updateScene({ fog: { enabled: v } }); }} label="Fog of war on" />
        <div class="row wrap">
          <button class="btn small" onClick={() => { if (confirm('Cover the whole map in fog again?')) void client.resetFog('hidden'); }}>Hide everything</button>
          <button class="btn small" onClick={() => void client.resetFog('clear')}>Reveal everything</button>
          <button class={`btn small ${d.tool === 'fog' ? 'primary' : ''}`} onClick={() => ui.set({ tool: d.tool === 'fog' ? 'select' : 'fog' })}>Fog tool (F)</button>
        </div>
      </Section>
    </>
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

/** The right-hand panel (DM): tabs plus a hide button. */
export function Dock(props: { client: TableClient; ui: UiState; board: Board | null; onNewScene: () => void; onEdit: (ids: string[]) => void }) {
  const { client, ui } = props;
  useClient(client);
  const d = useUi(ui);
  if (!client.isDM) return null;
  const tab = d.dockTab;
  const title = client.scene?.meta?.name ?? 'Scene';
  return (
    <aside class="dock">
      <div class="dock-head">
        <div class="dock-tabs">
          <button class={tab === 'scene' ? 'on' : ''} onClick={() => ui.set({ dockTab: 'scene' })} title={title}>Scene</button>
          <button class={tab === 'tokens' ? 'on' : ''} onClick={() => ui.set({ dockTab: 'tokens' })}>Tokens</button>
        </div>
        <button class="icon-btn" title="Hide this panel" aria-label="Hide panel" onClick={() => ui.set({ dockOpen: false })}>⟩</button>
      </div>
      {tab === 'scene' && <ScenePanel client={client} ui={ui} board={props.board} onNewScene={props.onNewScene} />}
      {tab === 'tokens' && <TokenList client={client} ui={ui} board={props.board} onEdit={props.onEdit} />}
    </aside>
  );
}
