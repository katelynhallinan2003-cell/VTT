import { useMemo, useRef } from 'preact/hooks';
import { TOKEN_SIZES } from '../core/model';
import { throttle } from '../core/throttle';
import type { Board } from '../board/Board';
import type { TableClient } from '../state/client';
import type { UiState } from '../state/ui';
import type { GridSettings, LabelMode, Token, TokenShape } from '../types';
import { Field, SliderField, Toggle, toast, useClient, useUi } from './common';
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

// ================================================================== token inspector
export function Inspector(props: { client: TableClient; ui: UiState }) {
  const { client, ui } = props;
  useClient(client);
  const d = useUi(ui);
  const tokens = [...d.selection].map((id) => client.scene?.tokens.get(id)).filter((t): t is Token => !!t);
  const patchThrottled = useThrottled((ids: string[], p: Partial<Token>) => { void client.updateTokens(ids, p); });
  if (!tokens.length) return null;

  const ids = tokens.map((t) => t.id);
  const t0 = tokens[0];
  const multi = tokens.length > 1;
  const editable = tokens.every((t) => client.canDo('edit', t));
  const patch = (p: Partial<Token>) => { void client.updateTokens(ids, p); };
  const same = <K extends keyof Token>(k: K): Token[K] | null => (tokens.every((t) => t[k] === t0[k]) ? t0[k] : null);
  const canDelete = tokens.every((t) => client.canDo('delete', t));

  async function changeImage(f: File) {
    try {
      const up = await uploadImage(client, f, 'token', f.name);
      patch({ img: up.url, imgScale: 1, imgX: 0, imgY: 0 });
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <aside class="dock">
      <div class="dock-head">
        <h3>{multi ? `${tokens.length} tokens` : t0.name || 'Token'}</h3>
        <button class="icon-btn" title="Deselect" onClick={() => ui.select([])}>✕</button>
      </div>

      {!editable && <p class="muted">You can't edit {multi ? 'all of these tokens' : 'this token'}.</p>}

      {!multi && (
        <Field label="Name">
          <input key={t0.id + t0.name} type="text" disabled={!editable} defaultValue={t0.name}
            onBlur={(e) => { const v = (e.target as HTMLInputElement).value; if (v !== t0.name) patch({ name: v }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </Field>
      )}

      <div class="row">
        <Field label="Size">
          <select disabled={!editable} value={same('size') ?? ''} onChange={(e) => patch({ size: Number((e.target as HTMLSelectElement).value) })}>
            {same('size') === null && <option value="">Mixed</option>}
            {TOKEN_SIZES.map((s) => <option value={s.size}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Shape">
          <select disabled={!editable} value={same('shape') ?? ''} onChange={(e) => patch({ shape: (e.target as HTMLSelectElement).value as TokenShape })}>
            {same('shape') === null && <option value="">Mixed</option>}
            <option value="circle">Circle</option><option value="square">Square</option><option value="none">No frame</option>
          </select>
        </Field>
        <Field label="Ring"><input type="color" disabled={!editable} value={t0.ring} onInput={(e) => patchThrottled(ids, { ring: (e.target as HTMLInputElement).value })} /></Field>
      </div>

      <SliderField label="Ring thickness" value={t0.ringW * 100} min={0} max={20} step={1} unit="%"
        onInput={(v) => editable && patchThrottled(ids, { ringW: v / 100 })} />

      <Field label="Name label">
        <select disabled={!editable} value={same('label') ?? ''} onChange={(e) => patch({ label: (e.target as HTMLSelectElement).value as LabelMode })}>
          {same('label') === null && <option value="">Mixed</option>}
          <option value="all">Visible to everyone</option>
          <option value="dm">DM only</option>
          <option value="none">Hidden</option>
        </select>
      </Field>

      {!multi && (
        <>
          <div class="field-label">Image</div>
          <div class="row wrap">
            <FileButton label={t0.img ? 'Replace image…' : 'Add image…'} disabled={!editable} onFile={changeImage} />
            {t0.img && <button class="btn small" disabled={!editable} onClick={() => patch({ img: null })}>Remove</button>}
          </div>
          {t0.img && (
            <>
              <SliderField label="Image zoom" value={t0.imgScale} min={0.5} max={3} step={0.05} onInput={(v) => editable && patchThrottled(ids, { imgScale: v })} />
              <SliderField label="Image left / right" value={t0.imgX} min={-0.5} max={0.5} step={0.01} onInput={(v) => editable && patchThrottled(ids, { imgX: v })} />
              <SliderField label="Image up / down" value={t0.imgY} min={-0.5} max={0.5} step={0.01} onInput={(v) => editable && patchThrottled(ids, { imgY: v })} />
            </>
          )}
        </>
      )}

      {client.isDM && (
        <>
          <Field label="Controlled by">
            <select value={tokens.every((t) => t.ownerUid === t0.ownerUid) ? (t0.ownerUid ?? '') : '__mixed'} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v !== '__mixed') patch({ ownerUid: v === '' ? null : v }); }}>
              {!tokens.every((t) => t.ownerUid === t0.ownerUid) && <option value="__mixed">Mixed</option>}
              <option value="">Nobody</option>
              {[...client.players.values()].map((p) => <option value={p.uid}>{p.name}</option>)}
            </select>
          </Field>
          <Toggle checked={tokens.every((t) => t.hidden)} onChange={(v) => patch({ hidden: v })} label="Hidden from players" />
          <Toggle checked={tokens.every((t) => t.locked)} onChange={(v) => patch({ locked: v })} label="Locked in place" hint="Players can't move or edit it." />
        </>
      )}
      {!client.isDM && !multi && client.canDo('claim', t0) && (
        <button class="btn primary" onClick={() => patch({ ownerUid: client.uid })}>Take control of this token</button>
      )}

      <div class="row wrap">
        <button class="btn small" disabled={!client.canDo('create')} onClick={() => void client.duplicateTokens(ids, client.grid.cell).then((n) => ui.select(n))}>Duplicate</button>
        <button class="btn small" disabled={!editable} onClick={() => void client.bringToFront(ids)}>To front</button>
        <button class="btn small" disabled={!editable} onClick={() => void client.sendToBack(ids)}>To back</button>
        <button class="btn small danger" disabled={!canDelete} onClick={() => { void client.removeTokens(ids); ui.select([]); }}>Delete</button>
      </div>
    </aside>
  );
}

// ================================================================== scene panel (DM)
export function ScenePanel(props: { client: TableClient; ui: UiState; board: Board | null; onNewScene: () => void }) {
  const { client, ui, board } = props;
  useClient(client);
  const d = useUi(ui);
  const meta = client.scene?.meta;
  const gridT = useThrottled((p: Partial<GridSettings>) => { void client.updateScene({ grid: p }); });
  const mapT = useThrottled((p: { mapScale?: number }) => { void client.updateScene(p); });
  if (!client.isDM) return null;
  if (!meta) {
    return (
      <aside class="dock">
        <div class="dock-head"><h3>Scene</h3></div>
        <p class="muted">No scene is open.</p>
        <button class="btn primary" onClick={props.onNewScene}>+ New scene</button>
      </aside>
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
    <aside class="dock">
      <div class="dock-head"><h3>{meta.name}</h3></div>

      <h4>Map</h4>
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

      <h4>Grid</h4>
      <Toggle checked={g.visible} onChange={(v) => setGrid({ visible: v })} label="Show grid" />
      <Toggle checked={g.snap} onChange={(v) => setGrid({ snap: v })} label="Snap tokens to grid" hint="Hold Alt while dragging to skip snapping." />
      <button class={`btn ${d.tool === 'grid' ? 'primary' : ''}`} onClick={() => ui.set({ tool: d.tool === 'grid' ? 'select' : 'grid' })}>
        {d.tool === 'grid' ? 'Drag a box over the grid squares…' : 'Draw a box to set the grid'}
      </button>
      <SliderField label="Square size" value={g.cell} min={10} max={300} step={0.1} unit="px" onInput={(v) => gridT({ cell: v })} />
      <SliderField label="Offset left / right" value={g.ox} min={0} max={Math.max(1, g.cell)} step={0.1} unit="px" onInput={(v) => gridT({ ox: v })} />
      <SliderField label="Offset up / down" value={g.oy} min={0} max={Math.max(1, g.cell)} step={0.1} unit="px" onInput={(v) => gridT({ oy: v })} />
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
      <div class="row">
        <Field label="Grid colour"><input type="color" value={g.color} onInput={(e) => gridT({ color: (e.target as HTMLInputElement).value })} /></Field>
        <SliderField label="Grid opacity" value={Math.round(g.opacity * 100)} min={0} max={100} unit="%" onInput={(v) => gridT({ opacity: v / 100 })} />
      </div>

      <h4>Fog of war</h4>
      <Toggle checked={meta.fog.enabled} onChange={(v) => { void client.updateScene({ fog: { enabled: v } }); }} label="Fog of war on" />
      <div class="row wrap">
        <button class="btn small" onClick={() => { if (confirm('Cover the whole map in fog again?')) void client.resetFog('hidden'); }}>Hide everything</button>
        <button class="btn small" onClick={() => void client.resetFog('clear')}>Reveal everything</button>
        <button class={`btn small ${d.tool === 'fog' ? 'primary' : ''}`} onClick={() => ui.set({ tool: d.tool === 'fog' ? 'select' : 'fog' })}>Fog tool (F)</button>
      </div>
    </aside>
  );
}
