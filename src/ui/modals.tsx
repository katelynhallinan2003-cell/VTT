import { useEffect, useRef, useState } from 'preact/hooks';
import { loadImage } from '../core/images';
import { testImgbb } from '../core/imgbb';
import { snapTokenCenter } from '../core/geometry';
import { PLAYER_COLORS, TOKEN_SIZES } from '../core/model';
import { PERM_LABELS, PRESETS, detectPreset } from '../core/permissions';
import { makeSampleMap } from '../core/sample';
import { addLibraryItem, removeLibraryItem, watchLibrary } from '../state/account';
import type { TableClient } from '../state/client';
import type { LibraryItem, Permissions, TokenShape, Vec } from '../types';
import { Field, Modal, SliderField, Toggle, copyText, toast, useClient } from './common';
import { addRecent, getRecent, uploadImage } from './uploads';

const asErr = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useLibrary(client: TableClient, kind: 'maps' | 'tokens'): LibraryItem[] {
  const [items, setItems] = useState<LibraryItem[]>([]);
  useEffect(() => (client.isDM ? watchLibrary(client.backend, client.uid, kind, setItems) : undefined), [client, kind]);
  return items;
}

/** Pick an image from disk. */
function FilePick(props: { onFile: (f: File) => void; label?: string; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={props.accept ?? 'image/*'} hidden
        onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) props.onFile(f); (e.target as HTMLInputElement).value = ''; }} />
      <button class="btn" onClick={() => ref.current?.click()}>{props.label ?? 'Choose image…'}</button>
    </>
  );
}

// ================================================================== add token
export function AddTokenModal(props: { client: TableClient; at: Vec; initialFile?: File | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { client } = props;
  useClient(client);
  const lib = useLibrary(client, 'tokens');
  const [file, setFile] = useState<File | null>(props.initialFile ?? null);
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState(props.initialFile ? props.initialFile.name.replace(/\.\w+$/, '') : '');
  const [size, setSize] = useState(1);
  const [shape, setShape] = useState<TokenShape>('circle');
  const [ring, setRing] = useState(client.me?.color ?? '#e8e8ee');
  const [hidden, setHidden] = useState(false);
  const [owner, setOwner] = useState<string>('');
  const [saveLib, setSaveLib] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const recent = getRecent();

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const chosenUrl = file ? preview : (picked ?? (url.trim() || null));

  async function create() {
    setBusy(true);
    try {
      let img: string | null = null;
      if (file) {
        const up = await uploadImage(client, file, 'token', name || file.name);
        img = up.url;
        if (client.isDM && saveLib && client.backend.kind !== 'mock') {
          await addLibraryItem(client.backend, client.uid, 'tokens', { name: name || file.name, url: up.url, thumb: up.thumb, w: up.w, h: up.h });
        }
      } else if (picked || url.trim()) {
        img = picked ?? url.trim();
        await loadImage(img, true).catch(() => { throw new Error('That image link could not be loaded.'); });
        addRecent({ url: img, name: name || 'token' });
      }
      const grid = client.grid;
      const p = grid.snap ? snapTokenCenter(grid, size, props.at) : props.at;
      const id = await client.addToken({
        x: p.x, y: p.y, name, img, size, shape, ring, hidden: client.isDM && hidden,
        ownerUid: client.isDM ? (owner || null) : client.uid,
      });
      props.onCreated(id);
      props.onClose();
    } catch (e) {
      toast(asErr(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title="Add token" onClose={props.onClose} width={560}
      footer={<><button class="btn" onClick={props.onClose}>Cancel</button><button class="btn primary" disabled={busy} onClick={create}>{busy ? 'Working…' : 'Add to board'}</button></>}>
      <div class="token-add">
        <div class="token-preview" style={{ borderColor: ring, borderRadius: shape === 'circle' ? '50%' : shape === 'square' ? '8px' : '0' }}>
          {chosenUrl ? <img src={chosenUrl} alt="" /> : <span>{(name || '?').charAt(0).toUpperCase()}</span>}
        </div>
        <div class="grow">
          <Field label="Name"><input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Goblin 1" autoFocus /></Field>
          <div class="row">
            <Field label="Size">
              <select value={size} onChange={(e) => setSize(Number((e.target as HTMLSelectElement).value))}>
                {TOKEN_SIZES.map((s) => <option value={s.size}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Shape">
              <select value={shape} onChange={(e) => setShape((e.target as HTMLSelectElement).value as TokenShape)}>
                <option value="circle">Circle</option><option value="square">Square</option><option value="none">No frame (transparent art)</option>
              </select>
            </Field>
            <Field label="Ring"><input type="color" value={ring} onInput={(e) => setRing((e.target as HTMLInputElement).value)} /></Field>
          </div>
        </div>
      </div>

      <h3>Image</h3>
      <div class="row wrap">
        <FilePick onFile={(f) => { setFile(f); setPicked(null); if (!name) setName(f.name.replace(/\.\w+$/, '')); }} />
        {file && <span class="muted">{file.name}</span>}
      </div>
      <Field label="…or paste an image link" hint="Direct link to a .png / .jpg / .webp image.">
        <input type="text" value={url} placeholder="https://…" onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setFile(null); setPicked(null); }} />
      </Field>
      {(lib.length > 0 || recent.length > 0) && (
        <>
          <div class="field-label">{lib.length ? 'From your library' : 'Recently used'}</div>
          <div class="thumbs small">
            {(lib.length ? lib.map((l) => ({ url: l.url, name: l.name })) : recent).slice(0, 24).map((l) => (
              <button key={l.url} class={`thumb ${picked === l.url ? 'on' : ''}`} title={l.name}
                onClick={() => { setPicked(l.url); setFile(null); setUrl(''); if (!name) setName(l.name); }}>
                <img src={l.url} alt={l.name} loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
      {client.isDM && (
        <div class="stack">
          <Toggle checked={hidden} onChange={setHidden} label="Start hidden from players" />
          {file && <Toggle checked={saveLib} onChange={setSaveLib} label="Save this image to my library" />}
          <Field label="Assign to player">
            <select value={owner} onChange={(e) => setOwner((e.target as HTMLSelectElement).value)}>
              <option value="">Nobody (unclaimed)</option>
              {[...client.players.values()].map((p) => <option value={p.uid}>{p.name}</option>)}
            </select>
          </Field>
        </div>
      )}
    </Modal>
  );
}

// ================================================================== new scene
export function NewSceneModal(props: { client: TableClient; onClose: () => void }) {
  const { client } = props;
  const lib = useLibrary(client, 'maps');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | Blob | null>(null);
  const [fileName, setFileName] = useState('');
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<LibraryItem | null>(null);
  const [saveLib, setSaveLib] = useState(true);
  const [makeActive, setMakeActive] = useState(!client.activeSceneId);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      let mapUrl: string | null = null;
      let w = 0, h = 0;
      if (file) {
        const up = await uploadImage(client, file, 'map', fileName || name);
        mapUrl = up.url; w = up.w; h = up.h;
        if (saveLib && client.backend.kind !== 'mock') await addLibraryItem(client.backend, client.uid, 'maps', { name: name || fileName || 'Map', url: up.url, thumb: up.thumb, w, h });
      } else if (picked) {
        mapUrl = picked.url; w = picked.w ?? 0; h = picked.h ?? 0;
      } else if (url.trim()) {
        const img = await loadImage(url.trim(), true).catch(() => { throw new Error('That image link could not be loaded.'); });
        mapUrl = url.trim(); w = img.naturalWidth; h = img.naturalHeight;
      }
      await client.createScene({ name: name || fileName.replace(/\.\w+$/, '') || picked?.name || 'New scene', mapUrl, mapW: w, mapH: h, makeActive });
      props.onClose();
    } catch (e) {
      toast(asErr(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title="New scene" onClose={props.onClose} width={560}
      footer={<><button class="btn" onClick={props.onClose}>Cancel</button><button class="btn primary" disabled={busy} onClick={create}>{busy ? 'Uploading…' : 'Create scene'}</button></>}>
      <Field label="Scene name"><input type="text" value={name} autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Goblin cave" /></Field>
      <h3>Map image</h3>
      <p class="muted">Maps keep their full resolution (up to your host's size limit). You can skip this and add a map later.</p>
      <div class="row wrap">
        <FilePick label="Upload map…" onFile={(f) => { setFile(f); setFileName(f.name); setPicked(null); setUrl(''); }} />
        {client.backend.kind === 'mock' && (
          <button class="btn" onClick={async () => { const s = await makeSampleMap(); setFile(s.blob); setFileName('Sample dungeon.png'); setPicked(null); setUrl(''); if (!name) setName('Sample dungeon'); }}>Use sample dungeon</button>
        )}
        {file && <span class="muted">{fileName}</span>}
      </div>
      <Field label="…or paste an image link"><input type="text" value={url} placeholder="https://…" onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setFile(null); setPicked(null); }} /></Field>
      {lib.length > 0 && (
        <>
          <div class="field-label">From your library</div>
          <div class="thumbs">
            {lib.map((l) => (
              <button key={l.id} class={`thumb ${picked?.id === l.id ? 'on' : ''}`} title={l.name} onClick={() => { setPicked(l); setFile(null); setUrl(''); }}>
                <img src={l.thumb ?? l.url} alt={l.name} loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
      <div class="stack">
        {file && client.backend.kind !== 'mock' && <Toggle checked={saveLib} onChange={setSaveLib} label="Save this map to my library" />}
        <Toggle checked={makeActive} onChange={setMakeActive} label="Show it to players right away" hint="Off: you can prep it privately and switch players over later." />
      </div>
    </Modal>
  );
}

// ================================================================== scenes list
export function ScenesModal(props: { client: TableClient; onClose: () => void; onNew: () => void }) {
  const { client } = props;
  useClient(client);
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <Modal title="Scenes" onClose={props.onClose} width={520}
      footer={<button class="btn primary" onClick={props.onNew}>+ New scene</button>}>
      {client.sceneIndex.length === 0 && <p class="muted">No scenes yet. Create one to get started.</p>}
      <ul class="list">
        {client.sceneIndex.map((s) => {
          const live = client.activeSceneId === s.id;
          const viewing = client.viewSceneId === s.id;
          return (
            <li key={s.id} class={viewing ? 'on' : ''}>
              {renaming === s.id ? (
                <input type="text" autoFocus value={s.name}
                  onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); setRenaming(null); if (v && v !== s.name) { if (viewing) void client.updateScene({ name: v }); } }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              ) : (
                <button class="link grow left" onClick={() => { client.openScene(s.id); props.onClose(); }}>
                  {s.name} {live && <span class="badge live">live</span>} {viewing && !live && <span class="badge">viewing</span>}
                </button>
              )}
              {!live && <button class="btn small" onClick={() => void client.setActiveScene(s.id)}>Show to players</button>}
              <button class="btn small" disabled={!viewing} title={viewing ? '' : 'Open the scene to rename it'} onClick={() => setRenaming(s.id)}>Rename</button>
              <button class="btn small danger" onClick={() => { if (confirm(`Delete scene “${s.name}”? Tokens and fog in it are lost.`)) void client.deleteScene(s.id); }}>Delete</button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

// ================================================================== library
export function LibraryModal(props: { client: TableClient; onClose: () => void; onUseMap: (item: LibraryItem) => void; onAddToken: (item: LibraryItem) => void }) {
  const { client } = props;
  const [tab, setTab] = useState<'maps' | 'tokens'>('maps');
  const items = useLibrary(client, tab);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');

  async function upload(f: File) {
    setBusy(true);
    try {
      const up = await uploadImage(client, f, tab === 'maps' ? 'map' : 'token', f.name);
      if (client.backend.kind === 'mock') toast('Demo mode: images are not saved to the library (they only live in this tab).', 'info');
      else await addLibraryItem(client.backend, client.uid, tab, { name: f.name.replace(/\.\w+$/, ''), url: up.url, thumb: up.thumb, w: up.w, h: up.h });
    } catch (e) { toast(asErr(e), 'error'); }
    setBusy(false);
  }
  async function addUrl() {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    try {
      const img = await loadImage(u, true);
      await addLibraryItem(client.backend, client.uid, tab, { name: u.split('/').pop()?.replace(/\.\w+$/, '') || 'Image', url: u, w: img.naturalWidth, h: img.naturalHeight });
      setUrl('');
    } catch { toast('That image link could not be loaded.', 'error'); }
    setBusy(false);
  }

  return (
    <Modal title="My library" onClose={props.onClose} width={640}>
      <div class="tabs">
        <button class={tab === 'maps' ? 'on' : ''} onClick={() => setTab('maps')}>Maps</button>
        <button class={tab === 'tokens' ? 'on' : ''} onClick={() => setTab('tokens')}>Token art</button>
      </div>
      <div class="row wrap">
        <FilePick label={busy ? 'Uploading…' : 'Upload image…'} onFile={upload} />
        <input type="text" class="grow" placeholder="…or paste an image link" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void addUrl(); }} />
        <button class="btn" onClick={addUrl} disabled={!url.trim() || busy}>Add</button>
      </div>
      {items.length === 0 && <p class="muted">Nothing here yet. Your library is saved to your Google account, so it follows you to any device.</p>}
      <div class="thumbs big">
        {items.map((it) => (
          <div key={it.id} class="lib-item">
            <img src={it.thumb ?? it.url} alt={it.name} loading="lazy" />
            <div class="lib-name" title={it.name}>{it.name}</div>
            <div class="lib-actions">
              {tab === 'maps'
                ? <button class="btn small" onClick={() => props.onUseMap(it)}>Use in scene</button>
                : <button class="btn small" onClick={() => props.onAddToken(it)}>Add to board</button>}
              <button class="btn small danger" onClick={() => void removeLibraryItem(client.backend, client.uid, tab, it.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ================================================================== settings
export function SettingsModal(props: { client: TableClient; onClose: () => void; onSignOut?: () => void }) {
  const { client } = props;
  useClient(client);
  const [name, setName] = useState(client.meta?.name ?? '');
  const [key, setKey] = useState(client.uploadKey ?? '');
  const [log, setLog] = useState<string[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const link = `${location.href.split('#')[0]}#/t/${client.tableId}`;
  const perm = client.settings.perm;
  const me = client.me;

  const setPerm = (patch: Partial<Permissions>) => { const next = { ...perm, ...patch }; void client.setPermissions(next, detectPreset(next)); };

  return (
    <Modal title="Settings" onClose={props.onClose} width={600}>
      {client.isDM && (
        <>
          <h3>Table</h3>
          <Field label="Table name">
            <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onBlur={() => { if (name.trim() && name !== client.meta?.name) void client.setTableName(name.trim()); }} />
          </Field>
          <Field label="Player link" hint="Send this to your players. No accounts needed.">
            <div class="row"><input type="text" readOnly value={link} onFocus={(e) => (e.target as HTMLInputElement).select()} /><button class="btn" onClick={() => copyText(link)}>Copy</button></div>
          </Field>

          <h3>What players can do</h3>
          <div class="seg">
            {(['trusting', 'standard', 'strict'] as const).map((p) => (
              <button key={p} class={client.settings.preset === p ? 'on' : ''} onClick={() => void client.setPermissions({ ...PRESETS[p] }, p)}>
                {p === 'trusting' ? 'Trusting' : p === 'standard' ? 'Standard' : 'Strict'}
              </button>
            ))}
            {client.settings.preset === 'custom' && <button class="on">Custom</button>}
          </div>
          <p class="muted">Trusting: players can do nearly everything. Standard: players only move their own token. Strict: you control tokens and drawing.</p>
          {(Object.keys(PERM_LABELS) as (keyof Permissions)[]).map((k) => (
            <Toggle key={k} checked={perm[k]} label={PERM_LABELS[k].label} hint={PERM_LABELS[k].hint} onChange={(v) => setPerm({ [k]: v })} />
          ))}

          <h3>Image uploads</h3>
          <p class="muted">
            Maps and tokens are hosted on <a href="https://api.imgbb.com/" target="_blank" rel="noreferrer">imgbb</a> (free). Paste your API key here. It is saved to your account and shared with your players
            through this table so they can upload tokens too, so use a key from an account you only use for this.
          </p>
          <Field label="imgbb API key">
            <div class="row">
              <input {...({ type: showKey ? 'text' : 'password' } as any)} value={key} placeholder="paste key" onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
              <button class="btn" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</button>
              <button class="btn primary" onClick={async () => { await client.setUploadKey(key.trim()); toast('Key saved', 'ok'); }}>Save</button>
            </div>
          </Field>
          <div class="row">
            <button class="btn" disabled={!key.trim() || testing} onClick={async () => { setTesting(true); setLog(await testImgbb(key.trim())); setTesting(false); }}>{testing ? 'Testing…' : 'Test upload'}</button>
            <span class="muted">Uploads a tiny image and checks your browser can use it on the board.</span>
          </div>
          {log && <pre class="log">{log.join('\n')}</pre>}
        </>
      )}

      {!client.isDM && me && (
        <>
          <h3>Me</h3>
          <Field label="Name"><input type="text" defaultValue={me.name} onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== me.name) void client.updatePlayer({ name: v }); }} /></Field>
          <Field label="Colour">
            <div class="swatches">
              {PLAYER_COLORS.map((c) => <button key={c} class={`swatch ${me.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => void client.updatePlayer({ color: c })} aria-label={c} />)}
            </div>
          </Field>
        </>
      )}

      <h3>Players at this table</h3>
      <ul class="list">
        {[...client.players.values()].map((p) => (
          <li key={p.uid}><span class="dot" style={{ background: p.color }} /> <span class="grow">{p.name}{p.uid === client.uid ? ' (you)' : ''}</span><span class={`badge ${p.online ? 'live' : ''}`}>{p.online ? 'online' : 'offline'}</span></li>
        ))}
        {client.players.size === 0 && <li class="muted">Nobody has joined yet.</li>}
      </ul>

      <h3>Keyboard &amp; mouse</h3>
      <ul class="keys">
        <li><kbd>Right-drag</kbd> or <kbd>Space</kbd>+drag — pan</li>
        <li><kbd>Wheel</kbd> — zoom, <kbd>0</kbd> — fit the map</li>
        <li><kbd>Middle-click</kbd> — ping</li>
        <li><kbd>Shift</kbd>+click — multi-select, drag on empty space — box select</li>
        <li><kbd>Alt</kbd> while dragging — move without snapping</li>
        <li><kbd>Arrows</kbd> — nudge a square, <kbd>Del</kbd> — delete, <kbd>Ctrl</kbd>+<kbd>D</kbd> — duplicate</li>
        <li><kbd>V</kbd> select · <kbd>G</kbd> grid · <kbd>F</kbd> fog (DM)</li>
      </ul>

      {props.onSignOut && <div class="row"><button class="btn danger" onClick={props.onSignOut}>Sign out</button></div>}
    </Modal>
  );
}

// ================================================================== grid calibration dialog
export function GridDialog(props: { onApply: (cols: number, rows: number) => void; onCancel: () => void }) {
  const [cols, setCols] = useState(1);
  const [rows, setRows] = useState(1);
  return (
    <Modal title="Set the grid from this area" onClose={props.onCancel} width={420}
      footer={<><button class="btn" onClick={props.onCancel}>Cancel</button><button class="btn primary" onClick={() => props.onApply(cols, rows)}>Apply</button></>}>
      <p class="muted">How many grid squares does the box you drew cover? For best accuracy, draw over several squares and enter the count.</p>
      <div class="row">
        <Field label="Squares wide"><input type="number" min={1} step={1} value={cols} onInput={(e) => setCols(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} autoFocus /></Field>
        <Field label="Squares tall"><input type="number" min={1} step={1} value={rows} onInput={(e) => setRows(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} /></Field>
      </div>
    </Modal>
  );
}

// ================================================================== claim a token
export function ClaimModal(props: { client: TableClient; onClose: () => void; onNewToken: () => void }) {
  const { client } = props;
  useClient(client);
  const free = [...(client.scene?.tokens.values() ?? [])].filter((t) => t.ownerUid === null && !t.hidden && !t.locked);
  const mine = client.myTokens();
  return (
    <Modal title={mine.length ? 'Your tokens' : 'Pick your character'} onClose={props.onClose} width={520}
      footer={<><button class="btn" onClick={props.onClose}>{mine.length ? 'Done' : "I'm just watching"}</button><button class="btn primary" onClick={props.onNewToken}>Make a new token</button></>}>
      {mine.length > 0 && (
        <>
          <div class="field-label">You control</div>
          <ul class="list">
            {mine.map((t) => (
              <li key={t.id}><span class="grow">{t.name || 'Unnamed token'}</span><button class="btn small" onClick={() => void client.updateToken(t.id, { ownerUid: null })}>Release</button></li>
            ))}
          </ul>
        </>
      )}
      <div class="field-label">{free.length ? 'Unclaimed tokens on this map' : 'No unclaimed tokens right now'}</div>
      <div class="thumbs big">
        {free.map((t) => (
          <button key={t.id} class="lib-item" onClick={() => { void client.updateToken(t.id, { ownerUid: client.uid }); toast(`You now control ${t.name || 'that token'}`, 'ok'); props.onClose(); }}>
            {t.img ? <img src={t.img} alt="" /> : <div class="ph">{(t.name || '?').charAt(0).toUpperCase()}</div>}
            <div class="lib-name">{t.name || 'Unnamed'}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
