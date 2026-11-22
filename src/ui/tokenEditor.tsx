import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { groundAt, zonesOf } from '../core/height';
import { LIGHT_PRESETS } from '../core/light';
import { TOKEN_SIZES } from '../core/model';
import type { TableClient } from '../state/client';
import type { Aura, HpShow, LabelMode, Token, TokenLight, TokenShape } from '../types';
import { Field, Modal, SliderField, Toggle, toast, useClient, useRerender } from './common';
import { customLights, removeCustomLight, saveCustomLight, subscribeLights } from '../state/lights';
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
  // the picture tools (paint, erase, auto select, behind-picture colour, shape, ring thickness) start tucked away for a token that already has a picture
  const [tools, setTools] = useState(() => !t0?.img);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'token' | 'light'>('token');
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
  // how high the ground is under the token(s): a flyer's height is shown above it, though what is stored is its elevation
  const zones = zonesOf(client.scene?.draws.values() ?? [], client.grid);
  const grounds = tokens.map((t) => groundAt(zones, t));
  const g0 = grounds[0] ?? 0;
  const sameGround = grounds.every((g) => g === g0);
  const elevNow = draft.elev ?? same('elev');
  const elevShown: number | '' = elevNow == null ? '' : sameGround ? Math.max(0, elevNow - g0) : elevNow;

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
  const hpVal = ('hp' in draft ? draft.hp : t0.hp) ?? null;
  const maxHpVal = ('maxHp' in draft ? draft.maxHp : t0.maxHp) ?? null;
  const tempVal = ('tempHp' in draft ? draft.tempHp : t0.tempHp) ?? 0;
  const sameLight = (a: TokenLight | null, b: TokenLight | null) => (!a && !b) || (!!a && !!b && a.b === b.b && a.d === b.d && a.c === b.c);
  /** undefined: the tokens disagree */
  const lightNow: TokenLight | null | undefined = 'light' in draft ? draft.light ?? null : tokens.every((t) => sameLight(t.light, t0.light)) ? t0.light : undefined;
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
            <TokenCropper src={img} shape={shape} ring={ring} ringW={ringW} name={name} framing={framing} disabled={!editable} tools={tools}
              onChange={(f) => set(f)} bg={imgBg} onBg={(c) => set({ imgBg: c })} paintApi={paintApi} onPaint={() => setPaintTouched(true)} />
            <div class="row wrap" style={{ marginTop: '10px', justifyContent: 'center' }}>
              {!img && <PickImage label="Add picture…" disabled={!editable} onFile={(f) => { setFile(f); set({ ...NO_FRAMING }); }} />}
              <button class={`btn small ${tools ? 'primary' : ''}`} title="Replace or remove the picture, paint on it, erase, cut out with auto select, and more" onClick={() => setTools((v) => !v)}>
                {tools ? 'Hide picture tools' : 'Picture tools…'}
              </button>
            </div>
            {tools && img && (
              <div class="row wrap" style={{ marginTop: '6px', justifyContent: 'center' }}>
                <PickImage label="Replace picture…" disabled={!editable} onFile={(f) => { setFile(f); set({ ...NO_FRAMING }); }} />
                <button class="btn small" disabled={!editable} onClick={() => { setFile(null); set({ img: null, ...NO_FRAMING }); }}>Remove picture</button>
              </div>
            )}
          </div>
        )}

        <div>
          {client.isDM && (
            <div class="seg" style={{ marginBottom: '10px' }}>
              <button class={tab === 'token' ? 'on' : ''} onClick={() => setTab('token')}>Token</button>
              <button class={tab === 'light' ? 'on' : ''} onClick={() => setTab('light')}>Sight and lights</button>
            </div>
          )}
          {client.isDM && tab === 'light' && (
            <SightLights
              editable={editable}
              sight={val('sight')} dv={val('dv')} light={lightNow} sameLight={sameLight}
              onSight={(n) => set({ sight: n })} onDv={(n) => set({ dv: n })} onLight={(l) => set({ light: l })} />
          )}
          <div style={{ display: client.isDM && tab === 'light' ? 'none' : undefined }}>
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
            <Field label="Ring"><input type="color" disabled={!editable} value={ring} onInput={(e) => set({ ring: (e.target as HTMLInputElement).value })} /></Field>
          </div>
          {(tools || multi) && (
            <>
              <div class="row">
                <Field label="Shape">
                  <select disabled={!editable} value={val('shape') ?? ''} onChange={(e) => set({ shape: (e.target as HTMLSelectElement).value as TokenShape })}>
                    {val('shape') === null && <option value="">Mixed</option>}
                    <option value="circle">Circle</option><option value="square">Square</option><option value="none">No frame</option>
                  </select>
                </Field>
              </div>
              <SliderField label="Ring thickness" value={Math.round(ringW * 100)} min={0} max={20} step={1} unit="%" onInput={(v) => editable && set({ ringW: v / 100 })} />
            </>
          )}

          <Field label="Name shown on the board">
            <select disabled={!editable} value={val('label') ?? ''} onChange={(e) => set({ label: (e.target as HTMLSelectElement).value as LabelMode })}>
              {val('label') === null && <option value="">Mixed</option>}
              <option value="all">Everyone can see it</option>
              <option value="dm">Only the DM</option>
              <option value="none">Nobody (hidden)</option>
            </select>
          </Field>

          <h4>Height</h4>
          <Toggle checked={val('fly') === true} onChange={(v) => set({ fly: v, ...(v && !(((val('elev') ?? 0) as number) > g0) ? { elev: g0 + 10 } : {}) })} label="Flying" disabled={!editable}
            hint="Off the ground. It keeps its elevation, and shows a shadow and a ↑ tag with how far above the ground it is. Walking tokens stand on whatever height the ground has (see the Heights tool)." />
          {val('fly') !== false && (
            <Field label={sameGround ? 'Height above the ground (feet)' : 'Elevation (feet above the map base)'}
              hint={sameGround ? 'Measured from the ground right under it. If the ground rises or falls under a flyer, it keeps its elevation, so this number changes: 20 ft up becomes 30 ft up over ground that is 10 ft lower.' : 'These tokens stand over different ground, so this is measured from the map base level.'}>
              <input type="number" class="num" step={5} min={sameGround ? 0 : -1000} max={5000} disabled={!editable || val('fly') !== true} value={elevShown}
                placeholder={val('elev') === null ? 'Mixed' : '0'}
                onInput={(e) => { const v = (e.target as HTMLInputElement).value; const n = v === '' ? 0 : Math.round(Number(v)); set({ elev: sameGround ? g0 + Math.max(0, n) : n }); }} />
            </Field>
          )}

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
          {client.isDM && (
            <>
              <h4>Health</h4>
              {!multi && (
                <div class="row">
                  <Field label="Hit points now">
                    <input type="number" min={0} value={hpVal ?? ''} placeholder="Not tracked" disabled={!editable}
                      onInput={(e) => { const v = (e.target as HTMLInputElement).value; set({ hp: v === '' ? null : Number(v) }); }} />
                  </Field>
                  <Field label="Maximum">
                    <input type="number" min={1} value={maxHpVal ?? ''} placeholder="Max" disabled={!editable}
                      onInput={(e) => { const v = (e.target as HTMLInputElement).value; set({ maxHp: v === '' ? null : Number(v) }); }} />
                  </Field>
                  <Field label="Temp HP" hint="Soaks up damage first. Can go past the maximum.">
                    <input type="number" min={0} value={tempVal || ''} placeholder="0" disabled={!editable || hpVal == null}
                      onInput={(e) => { const v = (e.target as HTMLInputElement).value; set({ tempHp: v === '' ? 0 : Math.max(0, Number(v)) }); }} />
                  </Field>
                </div>
              )}
              <Field label="What players see of its health" hint="Players only ever see what this setting shows. The hit points themselves stay hidden unless you pick the last option.">
                <select disabled={!editable} value={val('hpShow') ?? ''} onChange={(e) => set({ hpShow: (e.target as HTMLSelectElement).value as HpShow })}>
                  {val('hpShow') === null && <option value="">Mixed</option>}
                  <option value="off">Nothing at all</option>
                  <option value="state">Colour only: orange when bloodied, red when near death (no bar)</option>
                  <option value="bar">Colour and a health bar (no numbers)</option>
                  <option value="numbers">Colour, a bar and the real numbers (12/30)</option>
                </select>
              </Field>
              <h4>Initiative</h4>
              <Field label="Bonus added to its initiative roll" hint="Remembered for this token. The initiative roller adds it to the d20 for you.">
                <input type="number" class="num" min={-99} max={99} disabled={!editable} value={(draft.initBonus ?? same('initBonus') ?? '') as number | ''}
                  placeholder={val('initBonus') === null ? 'Mixed' : '0'}
                  onInput={(e) => { const v = (e.target as HTMLInputElement).value; set({ initBonus: v === '' ? 0 : Math.max(-99, Math.min(99, Math.round(Number(v)))) }); }} />
              </Field>
            </>
          )}
          {!multi && <AuraEditor auras={auras} ft={client.grid.ft} isDM={client.isDM} disabled={!editable} defaultColor={ring} onChange={(a) => set({ auras: a })} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** The last distance a darkvision toggle was switched on with in this editor. */
const DV_DEFAULT = 60;

/** Sight, darkvision and light, the things about a token that matter once the scene is dim or dark. null values: the tokens being edited disagree. */
function SightLights(props: {
  editable: boolean;
  sight: number | null; dv: number | null; light: TokenLight | null | undefined;
  sameLight: (a: TokenLight | null, b: TokenLight | null) => boolean;
  onSight: (n: number) => void; onDv: (n: number) => void; onLight: (l: TokenLight | null) => void;
}) {
  const { editable, sight, dv, light } = props;
  useRerender((fn) => subscribeLights(fn), []);
  const saved = customLights();
  const [name, setName] = useState('');
  const lastDv = useRef(DV_DEFAULT);
  if (dv && dv > 0) lastDv.current = dv;
  const dvOn = dv != null && dv > 0;
  const pickRow = (list: { key: string; name: string; light: TokenLight; custom?: string }[]) => list.map((p) => (
    <span key={p.key} class="row" style={{ gap: '2px', marginBottom: 0, display: 'inline-flex' }}>
      <button class={`btn small ${light && props.sameLight(light, p.light) ? 'primary' : ''}`} disabled={!editable} title={`Bright ${p.light.b} ft, dim ${p.light.d} ft more`}
        onClick={() => props.onLight({ ...p.light })}>{p.name}</button>
      {p.custom && <button class="btn small" title={`Forget “${p.name}”`} aria-label={`Forget ${p.name}`} onClick={() => removeCustomLight(p.custom!)}>×</button>}
    </span>
  ));
  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Sight</h4>
      <Field label="Sees as far as (feet)" hint="0: it does not clear fog by itself. Turn on “Tokens clear the fog around them” in the Scene panel.">
        <div class="row wrap" style={{ marginBottom: 0 }}>
          <input type="number" class="num" min={0} step={5} disabled={!editable} value={sight ?? ''} placeholder={sight === null ? 'Mixed' : '0'}
            onInput={(e) => { const v = (e.target as HTMLInputElement).value; props.onSight(v === '' ? 0 : Math.max(0, Number(v))); }} />
          {[0, 30, 60, 120].map((n) => <button key={n} class="btn small" disabled={!editable} onClick={() => props.onSight(n)}>{n === 0 ? 'None' : `${n} ft`}</button>)}
        </div>
      </Field>

      <h4>Darkvision</h4>
      <Toggle checked={dvOn} disabled={!editable} onChange={(v) => props.onDv(v ? lastDv.current : 0)} label="Has darkvision"
        hint={dv === null ? 'These tokens differ. Switching it on or off sets them all alike.' : 'In the dark it sees as if the ground were dim light, out to the distance below (never further than its sight).'} />
      {dvOn && (
        <Field label="Darkvision reaches (feet)">
          <div class="row wrap" style={{ marginBottom: 0 }}>
            <input type="number" class="num" min={5} step={5} disabled={!editable} value={dv ?? ''}
              onInput={(e) => { const n = Number((e.target as HTMLInputElement).value); if (n > 0) props.onDv(n); }} />
            {[30, 60, 90, 120].map((n) => <button key={n} class={`btn small ${dv === n ? 'primary' : ''}`} disabled={!editable} onClick={() => props.onDv(n)}>{n} ft</button>)}
          </div>
        </Field>
      )}

      <h4>Lights</h4>
      <Toggle checked={light != null} disabled={!editable} onChange={(v) => props.onLight(v ? { ...LIGHT_PRESETS[1].light } : null)} label="Gives off light"
        hint="Bright out to the first distance, then dim for the second one on top of it (a torch: 20 and 20). It matters once the scene is twilight or dark (Scene panel). Everyone can see where it is." />
      {light === undefined && <p class="hint">These tokens have different lights. Pick one to give them all the same.</p>}
      {light !== null && (
        <>
          <Field label="Pick a light">
            <div class="row wrap" style={{ marginBottom: 0 }}>
              {pickRow(LIGHT_PRESETS.map((p) => ({ key: p.name, name: p.name, light: p.light })))}
            </div>
          </Field>
          {saved.length > 0 && (
            <Field label="Your lights" hint="Made by you and kept in this browser. They also show in the Scene panel when you place a light.">
              <div class="row wrap" style={{ marginBottom: 0 }}>
                {pickRow(saved.map((c) => ({ key: c.id, name: c.name, light: c.light, custom: c.id })))}
              </div>
            </Field>
          )}
        </>
      )}
      {light && (
        <Field label="Make your own" hint="Set how it shines, then give it a name to keep it for next time.">
          <div class="row wrap" style={{ marginBottom: '8px' }}>
            <label class="field-label">Bright
              <input type="number" class="num" min={0} step={5} disabled={!editable} value={light.b}
                onInput={(e) => props.onLight({ ...light, b: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} /> ft
            </label>
            <label class="field-label">then dim
              <input type="number" class="num" min={0} step={5} disabled={!editable} value={light.d}
                onInput={(e) => props.onLight({ ...light, d: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} /> ft
            </label>
            <label class="field-label">Colour
              <input type="color" disabled={!editable} value={light.c} onInput={(e) => props.onLight({ ...light, c: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <div class="row wrap" style={{ marginBottom: 0 }}>
            <input type="text" placeholder="Name, e.g. Everburning torch" maxLength={40} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <button class="btn small" disabled={!name.trim()} onClick={() => { saveCustomLight(name, light); setName(''); toast('Light saved.', 'ok', 2000); }}>Save this light</button>
          </div>
        </Field>
      )}
    </div>
  );
}
