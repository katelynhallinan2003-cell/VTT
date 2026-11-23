import { useEffect, useRef, useState } from 'preact/hooks';
import { loadImage } from '../core/images';
import { testImgbb } from '../core/imgbb';
import { snapTokenCenter } from '../core/geometry';
import { PLAYER_COLORS, TOKEN_SIZES } from '../core/model';
import { PERM_LABELS, PRESETS, detectPreset } from '../core/permissions';
import { makeSampleMap } from '../core/sample';
import { addLibraryItem, watchLibrary } from '../state/account';
import type { SavedToken } from '../core/tokenlib';
import { SavedTokenGrid, saveTokensToLibrary } from './tokenLib';
import type { TableClient } from '../state/client';
import type { UiState } from '../state/ui';
import type { GridShape, LibraryItem, Permissions, SceneIndexEntry, TokenShape, Vec } from '../types';
import { folderOf, groupScenes } from '../core/folders';
import { Field, Modal, SliderField, Toggle, copyText, toast, useClient, useTheme, useUi } from './common';
import { CampaignFileSection } from './campaignFile';
import { THEMES, getAccent, getTheme, setAccent, setTheme } from './theme';
import { TokenCropper, NO_FRAMING, type Framing, type PaintApi } from './tokenCropper';
import { addRecent, dragHasImage, droppedImage, getRecent, uploadImage } from './uploads';
import { ImageCleanup, PictureTrash } from './libraryDelete';

const asErr = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useLibrary(client: TableClient, kind: 'maps' | 'tokens'): LibraryItem[] {
  const [list, setList] = useState<{ client: TableClient; kind: typeof kind; items: LibraryItem[] } | null>(null);
  useEffect(() => (client.isDM ? watchLibrary(client.backend, client.uid, kind, items => setList({ client, kind, items })) : undefined), [client, kind]);
  return list?.client === client && list.kind === kind ? list.items : [];
}

/** Pick an image from disk. */
function FilePick(props: { onFile: (f: File) => void; label?: string; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={props.accept ?? 'image/*'} hidden
        onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) props.onFile(f); (e.target as HTMLInputElement).value = ''; }} />
      <button class="btn" onClick={() => ref.current?.click()}>{props.label ?? 'Choose a picture…'}</button>
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
  const [ringW, setRingW] = useState(0.06);
  const [framing, setFraming] = useState<Framing>({ ...NO_FRAMING });
  const [imgBg, setImgBg] = useState<string | null>(null);
  /** painting, erasing, cutting out and the colour behind the picture stay tucked away until asked for */
  const [tools, setTools] = useState(false);
  const paintApi = useRef<PaintApi | null>(null);
  const recent = getRecent();

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const chosenUrl = file ? preview : (picked ?? (url.trim() || null));

  // a picture dropped anywhere on the page while this window is open becomes the token's picture (what was typed stays)
  useEffect(() => {
    const over = (e: DragEvent) => { if (dragHasImage(e)) { e.preventDefault(); e.stopPropagation(); } };
    const drop = (e: DragEvent) => {
      if (!dragHasImage(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const got = droppedImage(e);
      if (got === 'other') { toast('That file is not a picture.', 'error'); return; }
      if (got === 'none') return;
      setFraming({ ...NO_FRAMING });
      setPicked(null);
      if ('file' in got) { setFile(got.file); setUrl(''); setName((n) => n || got.file.name.replace(/\.\w+$/, '')); }
      else { setFile(null); setUrl(got.url); }
    };
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    return () => { window.removeEventListener('dragover', over, true); window.removeEventListener('drop', drop, true); };
  }, []);

  async function create() {
    setBusy(true);
    try {
      let img: string | null = null;
      let fr: Framing = framing;
      const painted = !!paintApi.current?.hasPaint();
      if (painted) {
        // the painting is merged into the picture, so it stays put when the token is resized
        const blob = await paintApi.current!.bake(chosenUrl, framing, shape);
        const up = await uploadImage(client, blob, 'token', name || 'token');
        img = up.url;
        fr = { ...NO_FRAMING };
        if (client.isDM && saveLib && client.backend.kind !== 'mock') {
          await addLibraryItem(client.backend, client.uid, 'tokens', { name: name || 'token', ...up });
        }
      } else if (file) {
        const up = await uploadImage(client, file, 'token', name || file.name);
        img = up.url;
        if (client.isDM && saveLib && client.backend.kind !== 'mock') {
          await addLibraryItem(client.backend, client.uid, 'tokens', { name: name || file.name, ...up });
        }
      } else if (picked || url.trim()) {
        img = picked ?? url.trim();
        await loadImage(img, true).catch(() => { throw new Error('That picture link could not be loaded.'); });
        addRecent({ url: img, name: name || 'token' });
      }
      const grid = client.grid;
      const p = grid.snap ? snapTokenCenter(grid, size, props.at) : props.at;
      const id = await client.addToken({
        x: p.x, y: p.y, name, img, size, shape, ring, ringW, ...fr, imgBg, hidden: client.isDM && hidden,
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
    <Modal title="Add token" onClose={props.onClose} width={760}
      footer={<><button class="btn" onClick={props.onClose}>Cancel</button><button class="btn primary" disabled={busy} onClick={create}>{busy ? 'Working…' : 'Add to board'}</button></>}>
      <div class="two-col">
        <div>
          <TokenCropper src={chosenUrl} shape={shape} ring={ring} ringW={ringW} name={name} framing={framing} onChange={setFraming} bg={imgBg} onBg={setImgBg} paintApi={paintApi} tools={tools} />
          <div class="row wrap" style={{ marginTop: '10px', justifyContent: 'center' }}>
            <button class={`btn small ${tools ? 'primary' : ''}`} title="Paint on the picture, erase parts of it, cut out with auto select, and set the colour behind it" onClick={() => setTools((v) => !v)}>
              {tools ? 'Hide picture tools' : 'Picture tools…'}
            </button>
          </div>
        </div>
        <div>
          <Field label="Name"><input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Goblin 1" autoFocus /></Field>
          <div class="field-label">Picture</div>
          <div class="row wrap">
            <FilePick onFile={(f) => { setFile(f); setPicked(null); setFraming({ ...NO_FRAMING }); if (!name) setName(f.name.replace(/\.\w+$/, '')); }} />
            {file && <span class="muted">{file.name}</span>}
          </div>
          <Field label="…or paste a link to a picture">
            <input type="text" value={url} placeholder="https://…" onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setFile(null); setPicked(null); setFraming({ ...NO_FRAMING }); }} />
          </Field>
          {(lib.length > 0 || recent.length > 0) && (
            <>
              <div class="field-label">{lib.length ? 'From your library' : 'Recently used'}</div>
              <div class="thumbs small">
                {(lib.length ? lib.map((l) => ({ url: l.url, name: l.name })) : recent).slice(0, 24).map((l) => (
                  <button key={l.url} class={`thumb ${picked === l.url ? 'on' : ''}`} title={l.name}
                    onClick={() => { setPicked(l.url); setFile(null); setUrl(''); setFraming({ ...NO_FRAMING }); if (!name) setName(l.name); }}>
                    <img src={l.url} alt={l.name} loading="lazy" />
                  </button>
                ))}
              </div>
            </>
          )}
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
          {tools && <SliderField label="Ring thickness" value={Math.round(ringW * 100)} min={0} max={20} step={1} unit="%" onInput={(v) => setRingW(v / 100)} />}
        </div>
      </div>
      {client.isDM && (
        <div class="stack">
          <Toggle checked={hidden} onChange={setHidden} label="Start hidden from players" />
          {file && client.backend.kind !== 'mock' && <Toggle checked={saveLib} onChange={setSaveLib} label="Save this picture to my library" />}
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
export function NewSceneModal(props: { client: TableClient; onClose: () => void; onCreated?: () => void; /** the folder to start in */ folder?: string | null; /** a picture that was dropped on the page: it starts as the map */ initialFile?: File | null }) {
  const { client } = props;
  useClient(client);
  const [folderId, setFolderId] = useState<string | null>(props.folder ?? null);
  const lib = useLibrary(client, 'maps');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | Blob | null>(props.initialFile ?? null);
  const [fileName, setFileName] = useState(props.initialFile?.name ?? '');
  const [url, setUrl] = useState('');
  const [pickedId, setPicked] = useState<string | null>(null);
  const picked = lib.find(item => item.id === pickedId);
  const [saveLib, setSaveLib] = useState(true);
  const [makeActive, setMakeActive] = useState(!client.activeSceneId);
  const [busy, setBusy] = useState(false);
  /** the demo's sample map is drawn on request, so Create waits for it */
  const [preparing, setPreparing] = useState(false);
  /** a picture is being dragged over the page right now */
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const useFile = (f: File | Blob, n: string) => { setFile(f); setFileName(n); setPicked(null); setUrl(''); };

  // a small look at the chosen picture, so it is clear which one will be used
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // a picture dropped anywhere on the page while this window is open becomes the map (it never falls through to the board behind)
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (!dragHasImage(e)) return; depth++; setDragOver(true); };
    const leave = (e: DragEvent) => { if (!dragHasImage(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragOver(false); };
    const over = (e: DragEvent) => { if (!dragHasImage(e)) return; e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const drop = (e: DragEvent) => {
      if (!dragHasImage(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setDragOver(false);
      const got = droppedImage(e);
      if (got === 'other') { toast('That file is not a picture. Maps can be PNG, JPG or WebP.', 'error'); return; }
      if (got === 'none') return;
      if ('file' in got) useFile(got.file, got.file.name);
      else { setUrl(got.url); setFile(null); setFileName(''); setPicked(null); }
    };
    window.addEventListener('dragenter', enter, true);
    window.addEventListener('dragleave', leave, true);
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragenter', enter, true);
      window.removeEventListener('dragleave', leave, true);
      window.removeEventListener('dragover', over, true);
      window.removeEventListener('drop', drop, true);
    };
  }, []);

  async function create() {
    setBusy(true);
    try {
      let mapUrl: string | null = null;
      let w = 0, h = 0;
      if (file) {
        const up = await uploadImage(client, file, 'map', fileName || name);
        mapUrl = up.url; w = up.w; h = up.h;
        if (saveLib && client.backend.kind !== 'mock') await addLibraryItem(client.backend, client.uid, 'maps', { name: name || fileName || 'Map', ...up });
      } else if (picked) {
        mapUrl = picked.url; w = picked.w ?? 0; h = picked.h ?? 0;
      } else if (url.trim()) {
        const img = await loadImage(url.trim(), true).catch(() => { throw new Error('That picture link could not be loaded.'); });
        mapUrl = url.trim(); w = img.naturalWidth; h = img.naturalHeight;
      }
      await client.createScene({ name: name || fileName.replace(/\.\w+$/, '') || picked?.name || 'New scene', mapUrl, mapW: w, mapH: h, makeActive, folder: folderId, /* the demo map is made by the app and its grid is known */ gridTried: fileName === 'Sample dungeon.png' });
      props.onCreated?.();
      props.onClose();
    } catch (e) {
      toast(asErr(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title="New scene" onClose={props.onClose} width={560}
      footer={<><button class="btn" onClick={props.onClose}>Cancel</button><button class="btn primary" disabled={busy || preparing} onClick={create}>{busy ? 'Uploading…' : 'Create scene'}</button></>}>
      <Field label="Scene name"><input type="text" value={name} autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder={fileName.replace(/\.\w+$/, '') || 'Goblin cave'} /></Field>
      {client.sceneFolders.length > 0 && (
        <Field label="Folder">
          <select value={folderId ?? ''} onChange={(e) => setFolderId((e.target as HTMLSelectElement).value || null)}>
            <option value="">Not in a folder</option>
            {client.sceneFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      )}
      <h3>Map picture</h3>
      <p class="muted">Optional: you can add a map later. Maps keep their full resolution.</p>
      <div class={`dropzone ${dragOver ? 'over' : ''} ${file ? 'has' : ''}`}>
        {file && preview && !dragOver && (
          <div class="dropzone-file">
            <img src={preview} alt="" />
            <span class="dropzone-name muted" title={fileName}>{fileName}</span>
            <button class="icon-btn" aria-label="Remove this picture" title="Remove this picture" onClick={() => { setFile(null); setFileName(''); }}>✕</button>
          </div>
        )}
        <div class="dropzone-text">{dragOver ? 'Drop the picture to use it as the map' : file ? 'Drag another picture here to swap it' : 'Drag a map picture here'}</div>
        {!dragOver && (
          <div class="row wrap dropzone-btns">
            <FilePick label={file ? 'Choose another…' : 'Upload map…'} onFile={(f) => useFile(f, f.name)} />
            {client.backend.kind === 'mock' && (
              <button class="btn" disabled={preparing} onClick={async () => { setPreparing(true); try { const s = await makeSampleMap(); useFile(s.blob, 'Sample dungeon.png'); if (!name) setName('Sample dungeon'); } finally { setPreparing(false); } }}>Use sample dungeon</button>
            )}
          </div>
        )}
      </div>
      <Field label="…or paste a link to a picture"><input type="text" value={url} placeholder="https://…" onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setFile(null); setPicked(null); }} /></Field>
      {lib.length > 0 && (
        <>
          <div class="field-label">From your library</div>
          <div class="thumbs">
            {lib.map((l) => (
              <div key={l.id} class="picture-tile">
                <button class={`thumb ${picked?.id === l.id ? 'on' : ''}`} title={l.name} onClick={() => { setPicked(l.id); setFile(null); setUrl(''); }}>
                  <img src={l.thumb ?? l.url} alt={l.name} loading="lazy" />
                </button>
                <PictureTrash client={client} kind="maps" item={l} disabled={busy} />
              </div>
            ))}
          </div>
        </>
      )}
      <div class="stack">
        {file && client.backend.kind !== 'mock' && <Toggle checked={saveLib} onChange={setSaveLib} label="Save this map to my library" />}
        <Toggle checked={makeActive} onChange={setMakeActive} label="Summon players to it as soon as it is made" hint="On: everyone is moved onto this scene straight away. Off: it stays private until you press Summon players." />
      </div>
    </Modal>
  );
}

// ================================================================== scenes list
/** Asks for a name and makes a folder for scenes. */
export function NewFolderModal(props: { client: TableClient; onClose: () => void; onCreated?: (id: string) => void }) {
  const { client } = props;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const id = await client.createFolder(name);
      props.onCreated?.(id);
      props.onClose();
    } catch (e) { toast(asErr(e), 'error'); setBusy(false); }
  }
  return (
    <Modal title="New folder" onClose={props.onClose} width={400}
      footer={<><button class="btn" onClick={props.onClose}>Cancel</button><button class="btn primary" disabled={!name.trim() || busy} onClick={create}>Create folder</button></>}>
      <Field label="Folder name" hint="Scenes can be moved in and out of it at any time.">
        <input type="text" value={name} autoFocus maxLength={60} placeholder="Act 1" onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
      </Field>
    </Modal>
  );
}

export function ScenesModal(props: { client: TableClient; onClose: () => void; onNew: () => void; onNewFolder: () => void }) {
  const { client } = props;
  useClient(client);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const folders = client.sceneFolders;
  const groups = groupScenes(client.sceneIndex, folders).filter((g) => g.folder || g.scenes.length || !folders.length);
  const sceneRow = (s: SceneIndexEntry) => {
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
        {folders.length > 0 && (
          <select class="mini-select" aria-label={`Folder for ${s.name}`} title="Move to a folder" value={folderOf(s, folders) ?? ''}
            onChange={(e) => void client.moveScene(s.id, (e.target as HTMLSelectElement).value || null)}>
            <option value="">No folder</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        {!live && <button class="btn small" title="Moves everyone at the table onto this scene" onClick={() => void client.setActiveScene(s.id).then((n) => { if (n) toast(`${n} player token${n === 1 ? '' : 's'} came along`, 'ok', 2600); })}>Summon players</button>}
        <button class="btn small" disabled={!viewing} title={viewing ? '' : 'Open the scene to rename it'} onClick={() => setRenaming(s.id)}>Rename</button>
        <button class="btn small danger" onClick={() => { if (confirm(`Delete scene “${s.name}”? Tokens and fog in it are lost.`)) void client.deleteScene(s.id); }}>Delete</button>
      </li>
    );
  };
  return (
    <Modal title="Scenes and folders" onClose={props.onClose} width={620}
      footer={<><button class="btn" onClick={props.onNewFolder}>+ New folder</button><button class="btn primary" onClick={props.onNew}>+ New scene</button></>}>
      {client.sceneIndex.length === 0 && folders.length === 0 && <p class="muted">No scenes yet. Create one to get started.</p>}
      {groups.map((g) => (
        <div key={g.folder?.id ?? 'none'} class="scene-group">
          {(g.folder || folders.length > 0) && (
            <div class="scene-group-head">
              {g.folder && renamingFolder === g.folder.id ? (
                <input type="text" autoFocus maxLength={60} value={g.folder.name} aria-label="Folder name"
                  onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); setRenamingFolder(null); if (v && g.folder && v !== g.folder.name) void client.renameFolder(g.folder.id, v); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setRenamingFolder(null); }} />
              ) : (
                <strong class="grow">{g.folder ? `📁 ${g.folder.name}` : 'Not in a folder'} <span class="muted small">{g.scenes.length}</span></strong>
              )}
              {g.folder && renamingFolder !== g.folder.id && (
                <>
                  <button class="btn small" onClick={() => setRenamingFolder(g.folder!.id)}>Rename folder</button>
                  <button class="btn small danger" onClick={() => { if (confirm(`Delete the folder “${g.folder!.name}”? ${g.scenes.length ? `Its ${g.scenes.length} scene${g.scenes.length === 1 ? '' : 's'} are kept and move out of the folder.` : 'It is empty.'}`)) void client.deleteFolder(g.folder!.id); }}>Delete folder</button>
                </>
              )}
            </div>
          )}
          <ul class="list">
            {g.scenes.map(sceneRow)}
            {g.folder && g.scenes.length === 0 && <li class="muted small">Empty. Use the folder picker on a scene to move it here.</li>}
          </ul>
        </div>
      ))}
    </Modal>
  );
}

// ================================================================== library
export function LibraryModal(props: { client: TableClient; onClose: () => void; onUseMap: (item: LibraryItem) => void; onAddToken: (item: LibraryItem) => void; onAddSaved: (entry: SavedToken) => void }) {
  const { client } = props;
  useClient(client);
  const [tab, setTab] = useState<'maps' | 'tokens' | 'saved'>('maps');
  const items = useLibrary(client, tab === 'saved' ? 'tokens' : tab);
  const artTab = tab === 'saved' ? 'tokens' : tab;
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');

  async function upload(f: File) {
    setBusy(true);
    try {
      const up = await uploadImage(client, f, artTab === 'maps' ? 'map' : 'token', f.name);
      if (client.backend.kind === 'mock') toast('Demo mode: pictures are not kept in the library.', 'info');
      else await addLibraryItem(client.backend, client.uid, artTab, { name: f.name.replace(/\.\w+$/, ''), ...up });
    } catch (e) { toast(asErr(e), 'error'); }
    setBusy(false);
  }
  async function addUrl() {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    try {
      const img = await loadImage(u, true);
      await addLibraryItem(client.backend, client.uid, artTab, { name: u.split('/').pop()?.replace(/\.\w+$/, '') || 'Image', url: u, w: img.naturalWidth, h: img.naturalHeight });
      setUrl('');
    } catch { toast('That picture link could not be loaded.', 'error'); }
    setBusy(false);
  }

  return (
    <Modal title="My library" onClose={props.onClose} width={640}>
      <div class="tabs">
        <button class={tab === 'maps' ? 'on' : ''} onClick={() => setTab('maps')}>Maps</button>
        <button class={tab === 'tokens' ? 'on' : ''} onClick={() => setTab('tokens')}>Token art</button>
        <button class={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved tokens{client.tokenLib.length ? ` (${client.tokenLib.length})` : ''}</button>
      </div>
      {tab === 'saved' && (
        <>
          <p class="muted">Tokens kept with all their settings. To save one, select it on the board and press <strong>Save to library</strong>.</p>
          <SavedTokenGrid client={client} empty="Nothing saved yet. Select a token on the board and press Save to library." action={() => 'Add to board'} onAction={(e) => props.onAddSaved(e)} />
        </>
      )}
      {tab !== 'saved' && <div class="row wrap">
        <FilePick label={busy ? 'Uploading…' : 'Upload picture…'} onFile={upload} />
        <input type="text" class="grow" placeholder="…or paste a link to a picture" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void addUrl(); }} />
        <button class="btn" onClick={addUrl} disabled={!url.trim() || busy}>Add</button>
      </div>}
      {tab !== 'saved' && items.length === 0 && <p class="muted">{client.backend.kind === 'mock' ? 'Nothing here. In demo mode the library is not kept.' : 'Nothing here yet. Your library is saved to your Google account, so it follows you to any device.'}</p>}
      {tab !== 'saved' && <div class="thumbs big">
        {items.map((it) => (
          <div key={it.id} class="lib-item">
            <div class="picture-tile">
              <img src={it.thumb ?? it.url} alt={it.name} loading="lazy" />
              <PictureTrash client={client} kind={artTab} item={it} />
            </div>
            <div class="lib-name" title={it.name}>{it.name}</div>
            <div class="lib-actions">
              {tab === 'maps'
                ? <button class="btn small" onClick={() => props.onUseMap(it)}>Use in scene</button>
                : <button class="btn small" onClick={() => props.onAddToken(it)}>Add to board</button>}
            </div>
          </div>
        ))}
      </div>}
      {tab !== 'saved' && <ImageCleanup key={artTab} client={client} kind={artTab} />}
    </Modal>
  );
}

// ================================================================== settings
export type SettingsTab = 'table' | 'files' | 'you' | 'keys';

/** Settings, a page at a time: the table (DM), pictures and files (DM), you, and the mouse and keyboard. */
export function SettingsModal(props: { client: TableClient; ui: UiState; onClose: () => void; onSignOut?: () => void; /** the page to open on */ tab?: SettingsTab }) {
  const { client } = props;
  useClient(client);
  const [tab, setTab] = useState<SettingsTab>(props.tab ?? (client.isDM ? 'table' : 'you'));
  const [name, setName] = useState(client.meta?.name ?? '');
  const [key, setKey] = useState(client.uploadKey ?? '');
  const [log, setLog] = useState<string[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [carry, setCarry] = useState(client.carryParty);
  const link = `${location.href.split('#')[0]}#/t/${client.tableId}`;
  const perm = client.settings.perm;
  useTheme();
  const theme = getTheme();

  const setPerm = (patch: Partial<Permissions>) => { const next = { ...perm, ...patch }; void client.setPermissions(next, detectPreset(next)); };

  return (
    <Modal title="Settings" onClose={props.onClose} width={600}>
      <div class="tabs">
        {client.isDM && <button class={tab === 'table' ? 'on' : ''} onClick={() => setTab('table')}>Table</button>}
        {client.isDM && <button class={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>Pictures and files</button>}
        <button class={tab === 'you' ? 'on' : ''} onClick={() => setTab('you')}>You</button>
        <button class={tab === 'keys' ? 'on' : ''} onClick={() => setTab('keys')}>Mouse and keys</button>
      </div>
      {client.isDM && tab === 'table' && (
        <>
          <Field label="Table name">
            <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onBlur={() => { if (name.trim() && name !== client.meta?.name) void client.setTableName(name.trim()); }} />
          </Field>
          <Field label="Player link" hint="Send this to your players. No accounts needed.">
            <div class="row"><input type="text" readOnly value={link} onFocus={(e) => (e.target as HTMLInputElement).select()} /><button class="btn" onClick={() => copyText(link)}>Copy</button></div>
          </Field>

          <Toggle checked={carry} onChange={(v) => { setCarry(v); client.carryParty = v; try { localStorage.setItem('vtt-carry-party', v ? '1' : '0'); } catch { /* ignore */ } }}
            label="Bring the players' tokens along when I summon them"
            hint="Their tokens are copied to the new scene with their hit points and conditions." />

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
        </>
      )}
      {client.isDM && tab === 'files' && (
        <>
          <h3>Picture uploads</h3>
          {client.backend.kind === 'mock' && <p class="muted"><strong>Demo mode needs no key:</strong> pictures stay in this browser tab until it is reloaded.</p>}
          <p class="muted">
            Maps and token pictures are stored on <a href="https://api.imgbb.com/" target="_blank" rel="noreferrer">imgbb</a> (free). Paste your API key here.
            Your players use it too, through this table, so use an account you keep just for this.
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
            <span class="muted">Uploads a tiny picture and checks that your browser can show it on the board.</span>
          </div>
          {log && <pre class="log">{log.join('\n')}</pre>}

          <CampaignFileSection client={client} />
        </>
      )}

      {tab === 'you' && (
        <>
          <MyProfile client={client} />

          <h3>Appearance</h3>
          <p class="muted">Only for you, in this browser.</p>
          <div class="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} class={`theme-tile ${theme === t.id ? 'on' : ''}`} onClick={() => setTheme(t.id)}>
                <div class="sw"><span style={{ background: t.swatch[0] }} /><span style={{ background: t.swatch[1] }} /><span style={{ background: t.swatch[2] }} /></div>
                <div class="lbl">{t.label}</div>
              </button>
            ))}
          </div>
          <Field label="Accent colour" hint="The colour of buttons and highlights.">
            <div class="row wrap">
              <input type="color" value={getAccent() ?? '#4da3ff'} onInput={(e) => setAccent((e.target as HTMLInputElement).value)} />
              <button class="btn small" disabled={!getAccent()} onClick={() => setAccent(null)}>Use the theme's colour</button>
            </div>
          </Field>

          <h3>Your screen</h3>
          <p class="muted">These only change what you see.</p>
          <InitPosSetting ui={props.ui} />
          <HeightsSetting ui={props.ui} />
          <EffectsViewSetting ui={props.ui} />
          {props.onSignOut && <div class="row" style={{ marginTop: '14px' }}><button class="btn danger" onClick={props.onSignOut}>Sign out</button></div>}
        </>
      )}

      {tab === 'keys' && (
        <>
          <MouseSettings ui={props.ui} />

          <h3>Shortcuts</h3>
          <ul class="keys">
            <li class="keys-head">Moving around</li>
            <li><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> — pan the view (hold <kbd>Shift</kbd> to go faster)</li>
            <li><kbd>Right-drag</kbd> or <kbd>Middle-drag</kbd> (your choice above) or <kbd>Space</kbd>+drag — pan</li>
            <li><kbd>Wheel</kbd> or <kbd>+</kbd> <kbd>-</kbd> — zoom, <kbd>0</kbd> — fit the map</li>
            <li><kbd>Z</kbd> — bring the selected tokens into view (or fit the map if none)</li>
            <li><kbd>Middle-click</kbd> or hold <kbd>left mouse</kbd> for a moment (your choice above) — ping</li>
            <li class="keys-head">Tools</li>
            <li><kbd>V</kbd> select · <kbd>P</kbd> draw and write · <kbd>C</kbd> spell templates · <kbd>R</kbd> ruler · <kbd>M</kbd> test move</li>
            <li><kbd>G</kbd> grid · <kbd>F</kbd> fog · <kbd>H</kbd> heights · <kbd>B</kbd> walls · <kbd>I</kbd> initiative (DM)</li>
            <li><kbd>T</kbd> add a token · <kbd>E</kbd> edit the selected tokens · <kbd>?</kbd> this list</li>
            <li><kbd>Esc</kbd> — back to select, let go of what you are drawing, or put test moves back</li>
            <li class="keys-head">Tokens</li>
            <li><kbd>Shift</kbd>+click — multi-select, drag on empty space — box select, <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> — next / previous token</li>
            <li><kbd>Arrows</kbd> — nudge one square (or hex), <kbd>Alt</kbd> while dragging — move without snapping, <kbd>Del</kbd> — delete</li>
            <li><kbd>]</kbd> raise the selected tokens 5 ft (they fly) · <kbd>[</kbd> lower them (down to the ground)</li>
            <li><kbd>Q</kbd> — hold while dragging a token to <b>teleport</b> it (DM: it jumps, walls and distance do not count). Or right-click empty ground and choose "Teleport selected token here".</li>
            <li><kbd>K</kbd> hide / reveal the selected tokens · <kbd>L</kbd> lock / unlock them (DM)</li>
            <li><kbd>N</kbd> next turn · <kbd>Shift</kbd>+<kbd>N</kbd> previous turn (DM, with initiative running)</li>
            <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Ctrl</kbd>+<kbd>Y</kbd> redo, <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> copy, cut, paste tokens, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate, <kbd>Ctrl</kbd>+<kbd>A</kbd> select all</li>
            <li class="keys-head">Test move</li>
            <li><kbd>Enter</kbd> — keep the test moves, <kbd>Esc</kbd> — put everything back, right-click — go back one step</li>
            <li class="muted">"Multi-step" in the test move bar makes each drag a new leg of the move, with the whole distance shown.</li>
            <li class="keys-head">While drawing</li>
            <li><kbd>Shift</kbd> locks angles and makes squares, <kbd>Alt</kbd> turns off snapping</li>
          </ul>
        </>
      )}
    </Modal>
  );
}

// ================================================================== grid calibration dialog
export function GridDialog(props: { shape?: GridShape; onApply: (cols: number, rows: number) => void; onCancel: () => void }) {
  const [cols, setCols] = useState(1);
  const [rows, setRows] = useState(1);
  const shape = props.shape ?? 'square';
  const hexes = shape !== 'square';
  return (
    <Modal title={hexes ? 'Set the grid from these hexes' : 'Set the grid from this area'} onClose={props.onCancel} width={420}
      footer={<><button class="btn" onClick={props.onCancel}>Cancel</button><button class="btn primary" onClick={() => props.onApply(cols, rows)}>Apply</button></>}>
      {hexes ? (
        <>
          <p class="muted">
            {shape === 'pointy'
              ? 'Draw the box from the left side of the first hex to the right side of the last one in a row, starting at the top point of the first hex. How many hexes wide is it?'
              : 'Draw the box from the top of the first hex down to the bottom of the last one in a column, starting at the left point of the first hex. How many hexes tall is it?'}
            {' '}The more hexes you cover, the more exact it is.
          </p>
          <div class="row">
            {shape === 'pointy'
              ? <Field label="Hexes wide"><input type="number" min={1} step={1} value={cols} onInput={(e) => setCols(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} autoFocus /></Field>
              : <Field label="Hexes tall"><input type="number" min={1} step={1} value={rows} onInput={(e) => setRows(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} autoFocus /></Field>}
          </div>
        </>
      ) : (
        <>
          <p class="muted">How many grid squares does your box cover? Boxing several squares is more exact than one.</p>
          <div class="row">
            <Field label="Squares wide"><input type="number" min={1} step={1} value={cols} onInput={(e) => setCols(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} autoFocus /></Field>
            <Field label="Squares tall"><input type="number" min={1} step={1} value={rows} onInput={(e) => setRows(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} /></Field>
          </div>
        </>
      )}
    </Modal>
  );
}

// ================================================================== claim a token
export function ClaimModal(props: { client: TableClient; onClose: () => void; onNewToken: () => void; onBring?: (entry: SavedToken) => void }) {
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
            {mine.map((t) => {
              const saved = !!t.cid && client.tokenLib.some((e) => e.id === t.cid);
              return (
                <li key={t.id}>
                  <span class="grow">{t.name || 'Unnamed token'}{saved && <span class="badge" title="Kept in your characters"> saved</span>}</span>
                  <button class="btn small" title={saved ? 'Update what is saved about it' : 'Keep it: its look and conditions follow you to every scene'} onClick={() => void saveTokensToLibrary(client, [t.id])}>{saved ? 'Update saved' : 'Save as my character'}</button>
                  <button class="btn small" title="Stop controlling it, so someone else can take it" onClick={() => void client.updateToken(t.id, { ownerUid: null })}>Release</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {/* characters you saved come first when you have some; a new player sees the tokens they can pick straight away */}
      {client.tokenLib.length > 0 && (
        <>
          <div class="field-label">Your characters</div>
          <SavedTokenGrid client={client} empty=""
            action={(e) => (mine.some((t) => t.cid === e.id) ? 'Here already' : 'Bring here')} disabled={(e) => mine.some((t) => t.cid === e.id)}
            onAction={(e) => { props.onBring?.(e); props.onClose(); }} />
        </>
      )}
      <div class="field-label">{free.length ? 'Tokens you can take on this map' : 'No tokens to take right now'}</div>
      <div class="thumbs big">
        {free.map((t) => (
          <button key={t.id} class="lib-item" onClick={() => { void client.updateToken(t.id, { ownerUid: client.uid }); toast(`You now control ${t.name || 'that token'}`, 'ok'); props.onClose(); }}>
            {t.img ? <img src={t.img} alt="" /> : <div class="ph">{(t.name || '?').charAt(0).toUpperCase()}</div>}
            <div class="lib-name">{t.name || 'Unnamed'}</div>
          </button>
        ))}
      </div>
      {client.tokenLib.length === 0 && <p class="muted small">Press “Save as my character” on a token of yours and it can follow you to every scene.</p>}
    </Modal>
  );
}

/** Which mouse button pans and how pinging works. Saved in this browser only. */
function MouseSettings(props: { ui: UiState }) {
  const d = useUi(props.ui);
  const panMiddle = d.panButton === 'middle';
  return (
    <>
      <Field label="Pan the view with">
        <div class="seg">
          <button class={d.panButton === 'right' ? 'on' : ''} onClick={() => props.ui.set({ panButton: 'right' })}>Right mouse</button>
          <button class={d.panButton === 'middle' ? 'on' : ''} onClick={() => props.ui.set({ panButton: 'middle' })}>Middle mouse</button>
        </div>
      </Field>
      <Field label="Ping with" hint={panMiddle ? 'The middle button is used for panning, so pinging uses a held left click.' : 'Hold-to-ping waits a moment so it does not fire when you click or drag.'}>
        <div class="seg">
          <button class={!panMiddle && d.pingMode === 'middle' ? 'on' : ''} disabled={panMiddle} onClick={() => props.ui.set({ pingMode: 'middle' })}>Middle click</button>
          <button class={panMiddle || d.pingMode === 'hold' ? 'on' : ''} onClick={() => props.ui.set({ pingMode: 'hold' })}>Hold left mouse</button>
        </div>
      </Field>
    </>
  );
}

function HeightsSetting(props: { ui: UiState }) {
  const d = useUi(props.ui);
  return (
    <Field label="Show the high and low ground" hint="“When moving” shows it while you drag a token or measure.">
      <div class="seg">
        {([['auto', 'When moving'], ['always', 'Always'], ['tool', 'Only in the Heights tool']] as const).map(([k, label]) => (
          <button key={k} class={d.heightView === k ? 'on' : ''} onClick={() => props.ui.set({ heightView: k })}>{label}</button>
        ))}
      </div>
    </Field>
  );
}

function EffectsViewSetting(props: { ui: UiState }) {
  const d = useUi(props.ui);
  return (
    <Field label="When the Effects window opens" hint="Jumping moves the view so the token sits beside the window.">
      <div class="seg">
        <button class={d.fxJump ? 'on' : ''} onClick={() => props.ui.set({ fxJump: true })}>Jump to the token</button>
        <button class={!d.fxJump ? 'on' : ''} onClick={() => props.ui.set({ fxJump: false })}>Stay where I was</button>
      </div>
    </Field>
  );
}

function InitPosSetting(props: { ui: UiState }) {
  const d = useUi(props.ui);
  return (
    <Field label="Show the turn order">
      <div class="seg">
        <button class={d.initPos === 'top' ? 'on' : ''} onClick={() => props.ui.set({ initPos: 'top' })}>Across the top</button>
        <button class={d.initPos === 'side' ? 'on' : ''} onClick={() => props.ui.set({ initPos: 'side' })}>Right edge</button>
      </div>
    </Field>
  );
}

/** Change your own display name and colour (used for pings). Works for the DM too. */
export function MyProfile(props: { client: TableClient }) {
  const { client } = props;
  useClient(client);
  const me = client.me;
  if (!me) return <p class="muted">You haven't joined this table yet.</p>;
  return (
    <div class="me-edit">
      <Field label="Name" hint="Shown on your pings and in the player list.">
        <input key={me.name} type="text" defaultValue={me.name} maxLength={30}
          onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== me.name) void client.updatePlayer({ name: v }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </Field>
      <Field label="Colour">
        <div class="swatches">
          {PLAYER_COLORS.map((c) => <button key={c} class={`swatch ${me.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => void client.updatePlayer({ color: c })} aria-label={c} />)}
          <input type="color" value={me.color} title="Pick any colour" onChange={(e) => void client.updatePlayer({ color: (e.target as HTMLInputElement).value })} />
        </div>
      </Field>
    </div>
  );
}

/** Who is at the table, plus your own name and colour. Lives in the right-hand Players tab. */
export function PlayersPanel(props: { client: TableClient }) {
  const { client } = props;
  useClient(client);
  const list = [...client.players.values()].sort((a, b) => Number(b.dm) - Number(a.dm) || a.joinedAt - b.joinedAt);
  return (
    <>
      <h4 style={{ marginTop: 0 }}>At this table</h4>
      {list.map((p) => (
        <div key={p.uid} class={`player-row ${p.online ? '' : 'off'}`}>
          <span class="dot" style={{ background: p.color }} />
          <span class="pname">{p.name}{p.uid === client.uid ? ' (you)' : ''}</span>
          {p.dm && <span class="badge">DM</span>}
          <span class={`badge ${p.online ? 'live' : ''}`}>{p.online ? 'online' : 'offline'}</span>
          {client.isDM && p.uid !== client.uid && (
            <button class="btn small danger" title="Remove from the list. Their tokens become unclaimed."
              onClick={() => { if (!p.online || confirm(`${p.name} is online right now. Remove them anyway? They can rejoin from the link.`)) void client.removePlayer(p.uid); }}>
              Remove
            </button>
          )}
        </div>
      ))}
      {list.length === 0 && <p class="muted">Nobody has joined yet.</p>}
      {client.isDM && list.length > 1 && <p class="muted small">Removing someone frees their tokens. They can join again from the link.</p>}
      <h4>You</h4>
      <MyProfile client={client} />
    </>
  );
}
