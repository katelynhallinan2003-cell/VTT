import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TOKEN_SIZES } from '../core/model';
import type { TableClient } from '../state/client';
import type { Aura, LabelMode, Token, TokenShape } from '../types';
import { Field, Modal, SliderField, Toggle, toast, useClient } from './common';
import { AuraEditor } from './auraEditor';
import { NO_FRAMING, PickImage, TokenCropper, type PaintApi } from './tokenCropper';
import { uploadImage } from './uploads';

function sizeNote(client: TableClient, size: number): string {
  const g = client.grid;
  const squares = size === 0.5 ? 'half a square' : size === 1 ? '1 square' : `${size} squares`;
  return `Fills ${squares} across (${Math.round(size * g.ft * 10) / 10} ft)`;
}

/**
 * The full token editor: everything about a token lives here so the board stays clean.
 * Works on one token (with the picture cropper) or on several at once (shared settings only).
 */
export function TokenEditorModal(props: { client: TableClient; ids: string[]; onClose: () => void }) {
  const { client } = props;
  useClient(client);
  const tokens = props.ids.map((id) => client.scene?.tokens.get(id)).filter((t): t is Token => !!t);
  const t0 = tokens[0];
  const multi = tokens.length > 1;
  const [draft, setDraft] = useState<Partial<Token>>({});
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paintApi = useRef<PaintApi | null>(null);

  // the token vanished (deleted by someone else): close
  useEffect(() => { if (!t0) props.onClose(); }, [!!t0]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const editable = useMemo(() => tokens.length > 0 && tokens.every((t) => client.canDo('edit', t)), [client.rev, props.ids.join()]);
  if (!t0) return null;

  const same = <K extends keyof Token>(k: K): Token[K] | null => (tokens.every((t) => t[k] === t0[k]) ? t0[k] : null);
  const val = <K extends keyof Token>(k: K): Token[K] | null => (k in draft ? (draft[k] as Token[K]) : same(k));
  const set = (p: Partial<Token>) => setDraft((d) => ({ ...d, ...p }));

  const img = file ? preview : (('img' in draft ? draft.img : t0.img) ?? null);
  const framing = {
    imgScale: draft.imgScale ?? t0.imgScale,
    imgX: draft.imgX ?? t0.imgX,
    imgY: draft.imgY ?? t0.imgY,
  };
  const shape = (val('shape') ?? t0.shape) as TokenShape;
  const ring = (val('ring') ?? t0.ring) as string;
  const ringW = (draft.ringW ?? t0.ringW) as number;
  const size = (val('size') ?? t0.size) as number;
  const name = (draft.name ?? t0.name) as string;
  const auras = ('auras' in draft ? draft.auras : t0.auras) as Aura[];
  const imgBg = ('imgBg' in draft ? draft.imgBg : t0.imgBg) ?? null;
  const [paintTouched, setPaintTouched] = useState(false);
  const dirty = Object.keys(draft).length > 0 || !!file || paintTouched;

  async function save() {
    setBusy(true);
    try {
      const patch: Partial<Token> = { ...draft };
      if (!multi && paintApi.current?.hasPaint()) {
        const blob = await paintApi.current.bake(img, framing, shape);
        const up = await uploadImage(client, blob, 'token', name || 'token');
        patch.img = up.url;
        Object.assign(patch, NO_FRAMING);
      } else if (file) {
        const up = await uploadImage(client, file, 'token', file.name);
        patch.img = up.url;
      }
      if (Object.keys(patch).length) await client.updateTokens(props.ids, patch);
      props.onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  const players = [...client.players.values()];
  const ownerVal = 'ownerUid' in draft ? (draft.ownerUid ?? '') : tokens.every((t) => t.ownerUid === t0.ownerUid) ? (t0.ownerUid ?? '') : '__mixed';

  return (
    <Modal title={multi ? `Edit ${tokens.length} tokens` : `Edit token${t0.name ? ': ' + t0.name : ''}`} onClose={props.onClose} width={multi ? 480 : 760}
      footer={<>
        <button class="btn" onClick={props.onClose}>Cancel</button>
        <button class="btn primary" disabled={!editable || !dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      {!editable && <p class="muted">You can't edit {multi ? 'all of these tokens' : 'this token'}.</p>}
      <div class={multi ? '' : 'two-col'}>
        {!multi && (
          <div>
            <TokenCropper src={img} shape={shape} ring={ring} ringW={ringW} name={name} framing={framing} disabled={!editable}
              onChange={(f) => set(f)} bg={imgBg} onBg={(c) => set({ imgBg: c })} paintApi={paintApi} onPaint={() => setPaintTouched(true)} />
            <div class="row wrap" style={{ marginTop: '10px', justifyContent: 'center' }}>
              <PickImage label={img ? 'Replace picture…' : 'Add picture…'} disabled={!editable} onFile={(f) => { setFile(f); set({ ...NO_FRAMING }); }} />
              {img && <button class="btn small" disabled={!editable} onClick={() => { setFile(null); set({ img: null, ...NO_FRAMING }); }}>Remove picture</button>}
            </div>
          </div>
        )}

        <div>
          {!multi && (
            <Field label="Name">
              <input type="text" value={name} disabled={!editable} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
            </Field>
          )}
          <div class="row">
            <Field label="Size" hint={multi && same('size') === null ? undefined : sizeNote(client, size)}>
              <select disabled={!editable} value={val('size') ?? ''} onChange={(e) => set({ size: Number((e.target as HTMLSelectElement).value) })}>
                {val('size') === null && <option value="">Mixed</option>}
                {TOKEN_SIZES.map((s) => <option value={s.size}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Shape">
              <select disabled={!editable} value={val('shape') ?? ''} onChange={(e) => set({ shape: (e.target as HTMLSelectElement).value as TokenShape })}>
                {val('shape') === null && <option value="">Mixed</option>}
                <option value="circle">Circle</option><option value="square">Square</option><option value="none">No frame</option>
              </select>
            </Field>
            <Field label="Ring"><input type="color" disabled={!editable} value={ring} onInput={(e) => set({ ring: (e.target as HTMLInputElement).value })} /></Field>
          </div>
          <SliderField label="Ring thickness" value={Math.round(ringW * 100)} min={0} max={20} step={1} unit="%" onInput={(v) => editable && set({ ringW: v / 100 })} />

          <Field label="Name shown on the board">
            <select disabled={!editable} value={val('label') ?? ''} onChange={(e) => set({ label: (e.target as HTMLSelectElement).value as LabelMode })}>
              {val('label') === null && <option value="">Mixed</option>}
              <option value="all">Everyone can see it</option>
              <option value="dm">Only the DM</option>
              <option value="none">Nobody (hidden)</option>
            </select>
          </Field>

          {client.isDM && (
            <>
              <Field label="Controlled by">
                <select value={ownerVal} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v !== '__mixed') set({ ownerUid: v === '' ? null : v }); }}>
                  {ownerVal === '__mixed' && <option value="__mixed">Mixed</option>}
                  <option value="">Nobody</option>
                  {players.map((p) => <option value={p.uid}>{p.name}{p.dm ? ' (DM)' : ''}</option>)}
                </select>
              </Field>
              <Toggle checked={!!(val('hidden') ?? false)} onChange={(v) => set({ hidden: v })} label="Hidden from players" />
              <Toggle checked={!!(val('locked') ?? false)} onChange={(v) => set({ locked: v })} label="Locked in place" hint="Players can't move or edit it." />
            </>
          )}
          {!multi && <AuraEditor auras={auras} ft={client.grid.ft} isDM={client.isDM} disabled={!editable} onChange={(a) => set({ auras: a })} />}
        </div>
      </div>
    </Modal>
  );
}
