import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../board/Board';
import * as geometry from '../core/geometry';
import { snapTokenCenter } from '../core/geometry';
import { loadImage } from '../core/images';
import type { TableClient } from '../state/client';
import { UiState } from '../state/ui';
import type { AuthUser, LibraryItem, Rect, Token, Vec } from '../types';
import { Toasts, copyText, toast, useClient, useUi } from './common';
import { AddTokenModal, ClaimModal, GridDialog, LibraryModal, NewSceneModal, ScenesModal, SettingsModal } from './modals';
import { Inspector, ScenePanel } from './panels';

type ModalState =
  | null
  | { kind: 'addToken'; at: Vec; file?: File | null; art?: LibraryItem }
  | { kind: 'newScene' }
  | { kind: 'scenes' }
  | { kind: 'library' }
  | { kind: 'settings' }
  | { kind: 'claim' }
  | { kind: 'grid'; rect: Rect; derived: { cell: number; ox: number; oy: number } };

const Icon = (props: { d: string; size?: number }) => (
  <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={props.d} /></svg>
);
const ICONS = {
  select: 'M5 3l14 8-6 2-2 6z',
  grid: 'M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16',
  fog: 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5zM8 21h8',
  token: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v8M8 12h8',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
};

function ToolBtn(props: { icon: keyof typeof ICONS; label: string; hotkey?: string; on?: boolean; onClick: () => void }) {
  return (
    <button class={`tool ${props.on ? 'on' : ''}`} title={`${props.label}${props.hotkey ? ` (${props.hotkey})` : ''}`} aria-label={props.label} onClick={props.onClick}>
      <Icon d={ICONS[props.icon]} />
    </button>
  );
}

export function TableView(props: { client: TableClient; user: AuthUser; demo: boolean; onSignOut: () => void; onHome: () => void }) {
  const { client } = props;
  useClient(client);
  const ui = useMemo(() => new UiState(), []);
  const d = useUi(ui);
  const hostRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const boardRef = useRef<Board | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; tokenId: string | null; world: Vec } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const claimOffered = useRef(false);
  const modalRef = useRef<ModalState>(null);
  modalRef.current = modal;

  // ---- board lifecycle
  useEffect(() => {
    if (!hostRef.current) return;
    const b = new Board(hostRef.current, client, ui, {
      onContextMenu: (info) => setMenu({ x: info.clientX, y: info.clientY, tokenId: info.tokenId, world: info.world }),
      onGridRect: (rect, derived) => setModal({ kind: 'grid', rect, derived }),
      onMapError: setMapError,
      onTokenImageError: (m) => toast(m, 'error', 9000),
    });
    let dead = false;
    void b.init().then(() => { if (!dead) { boardRef.current = b; setBoard(b); (window as any).__vtt = { client, ui, board: b }; } });
    return () => { dead = true; boardRef.current = null; b.destroy(); };
  }, [client, ui]);

  // ---- offer to claim a token the first time a player sees unclaimed tokens
  const scene = client.scene;
  useEffect(() => {
    if (client.isDM || claimOffered.current || !scene?.loaded || !client.me) return;
    const unclaimed = [...scene.tokens.values()].some((t) => t.ownerUid === null && !t.hidden && !t.locked);
    if (client.myTokens().length === 0 && (unclaimed || client.canDo('create')) && !sessionStorage.getItem('vtt-claim-' + client.tableId)) {
      claimOffered.current = true;
      sessionStorage.setItem('vtt-claim-' + client.tableId, '1');
      if (!modalRef.current) setModal({ kind: 'claim' });
    }
  }, [client.rev]);

  // ---- hotkeys that open dialogs
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || modalRef.current) return;
      if (e.key.toLowerCase() === 't' && client.canDo('create')) openAddToken();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [client, board]);

  function viewCenter(): Vec { return boardRef.current?.viewCenterWorld() ?? { x: 500, y: 500 }; }
  function openAddToken(at?: Vec, file?: File | null) { setModal({ kind: 'addToken', at: at ?? viewCenter(), file }); }

  // ---- drag & drop an image onto the board = new token
  function onDrop(e: DragEvent) {
    e.preventDefault();
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    if (!client.canDo('create')) { toast('You are not allowed to add tokens.', 'error'); return; }
    const at = boardRef.current?.screenToWorld(e.clientX, e.clientY) ?? viewCenter();
    openAddToken(at, f);
  }

  async function useLibraryMap(item: LibraryItem) {
    try {
      let w = item.w ?? 0, h = item.h ?? 0;
      if (!w || !h) { const img = await loadImage(item.url, true); w = img.naturalWidth; h = img.naturalHeight; }
      if (!client.scene?.meta) await client.createScene({ name: item.name, mapUrl: item.url, mapW: w, mapH: h, makeActive: !client.activeSceneId });
      else await client.setSceneMap(item.url, w, h);
      setModal(null);
    } catch { toast('Could not load that map.', 'error'); }
  }

  async function addLibraryToken(item: LibraryItem) {
    const at = viewCenter();
    const grid = client.grid;
    const p = grid.snap ? snapTokenCenter(grid, 1, at) : at;
    const id = await client.addToken({ x: p.x, y: p.y, name: item.name, img: item.url, size: 1 });
    ui.select([id]);
    toast('Token added', 'ok', 1500);
  }

  // ---- context menu actions
  const menuToken: Token | null = menu?.tokenId ? scene?.tokens.get(menu.tokenId) ?? null : null;
  const selectedIds = [...d.selection];
  const menuItems: { label: string; onClick: () => void; danger?: boolean; sep?: boolean }[] = [];
  if (menu) {
    if (menuToken) {
      const ids = selectedIds.length && d.selection.has(menuToken.id) ? selectedIds : [menuToken.id];
      const toks = ids.map((i) => scene?.tokens.get(i)).filter((t): t is Token => !!t);
      if (client.canDo('create')) menuItems.push({ label: 'Duplicate', onClick: () => void client.duplicateTokens(ids, client.grid.cell).then((n) => ui.select(n)) });
      if (toks.every((t) => client.canDo('edit', t))) {
        menuItems.push({ label: 'Bring to front', onClick: () => void client.bringToFront(ids) });
        menuItems.push({ label: 'Send to back', onClick: () => void client.sendToBack(ids) });
      }
      if (client.isDM) {
        const hid = toks.every((t) => t.hidden);
        menuItems.push({ label: hid ? 'Reveal to players' : 'Hide from players', onClick: () => void client.updateTokens(ids, { hidden: !hid }) });
        const lk = toks.every((t) => t.locked);
        menuItems.push({ label: lk ? 'Unlock' : 'Lock in place', onClick: () => void client.updateTokens(ids, { locked: !lk }) });
        for (const p of client.players.values()) menuItems.push({ label: `Give to ${p.name}`, onClick: () => void client.updateTokens(ids, { ownerUid: p.uid }) });
        if (toks.some((t) => t.ownerUid)) menuItems.push({ label: 'Unassign', onClick: () => void client.updateTokens(ids, { ownerUid: null }) });
      } else {
        if (client.canDo('claim', menuToken)) menuItems.push({ label: 'Take control', onClick: () => void client.updateToken(menuToken.id, { ownerUid: client.uid }) });
        if (menuToken.ownerUid === client.uid) menuItems.push({ label: 'Release control', onClick: () => void client.updateToken(menuToken.id, { ownerUid: null }) });
      }
      if (toks.every((t) => client.canDo('delete', t))) menuItems.push({ label: 'Delete', danger: true, onClick: () => { void client.removeTokens(ids); ui.select([]); } });
    } else {
      if (client.canDo('ping')) menuItems.push({ label: 'Ping here', onClick: () => void client.ping(menu.world.x, menu.world.y) });
      if (client.canDo('create')) menuItems.push({ label: 'Add token here…', onClick: () => openAddToken(menu.world) });
    }
  }

  const live = client.sceneIsActive;
  const showEmpty = scene?.loaded && !scene.meta;
  const players = [...client.players.values()];
  const mySel = scene && d.selection.size > 0;

  return (
    <div class="table-root" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div class="board-host" ref={hostRef} />

      {/* ---------------- left toolbar */}
      <nav class="toolbar">
        <ToolBtn icon="select" label="Select / move" hotkey="V" on={d.tool === 'select'} onClick={() => ui.set({ tool: 'select' })} />
        {client.isDM && <ToolBtn icon="grid" label="Set grid from a box" hotkey="G" on={d.tool === 'grid'} onClick={() => ui.set({ tool: d.tool === 'grid' ? 'select' : 'grid' })} />}
        {client.isDM && <ToolBtn icon="fog" label="Fog of war" hotkey="F" on={d.tool === 'fog'} onClick={() => ui.set({ tool: d.tool === 'fog' ? 'select' : 'fog' })} />}
        <ToolBtn icon="token" label="Add token" hotkey="T" onClick={() => client.canDo('create') ? openAddToken() : toast('You are not allowed to add tokens.', 'error')} />
        <div class="tool-sep" />
        <ToolBtn icon="fit" label="Fit map to screen" hotkey="0" onClick={() => board?.fit()} />
        <div class="zoom">{Math.round(d.zoom * 100)}%</div>
      </nav>

      {d.tool === 'fog' && client.isDM && (
        <div class="flyout">
          <div class="flyout-title">Fog of war</div>
          <div class="seg">
            <button class={d.fogMode === 'r' ? 'on reveal' : ''} onClick={() => ui.set({ fogMode: 'r' })}>Reveal</button>
            <button class={d.fogMode === 'h' ? 'on hide' : ''} onClick={() => ui.set({ fogMode: 'h' })}>Hide</button>
          </div>
          <div class="seg">
            <button class={d.fogShape === 'rect' ? 'on' : ''} onClick={() => ui.set({ fogShape: 'rect' })}>Box</button>
            <button class={d.fogShape === 'poly' ? 'on' : ''} onClick={() => ui.set({ fogShape: 'poly' })}>Shape</button>
            <button class={d.fogShape === 'brush' ? 'on' : ''} onClick={() => ui.set({ fogShape: 'brush' })}>Brush</button>
          </div>
          {d.fogShape === 'brush' && (
            <label class="field"><span class="field-label">Brush size: {d.brushSize} squares</span>
              <input type="range" min={0.5} max={8} step={0.5} value={d.brushSize} onInput={(e) => ui.set({ brushSize: Number((e.target as HTMLInputElement).value) })} /></label>
          )}
          <p class="hint">{d.fogShape === 'poly' ? 'Click points, then click the first point, double-click or press Enter to finish.' : d.fogShape === 'brush' ? 'Hold and drag to paint.' : 'Drag a box.'}</p>
          <div class="row wrap">
            <button class="btn small" onClick={() => void client.undoFog()}>Undo</button>
            <button class="btn small" onClick={() => void client.resetFog('hidden')}>Hide all</button>
            <button class="btn small" onClick={() => void client.resetFog('clear')}>Reveal all</button>
          </div>
          <label class="toggle"><input type="checkbox" checked={d.dmPreview} onChange={(e) => ui.set({ dmPreview: (e.target as HTMLInputElement).checked })} /><span class="toggle-text">Preview as players</span></label>
        </div>
      )}

      {/* ---------------- top bar */}
      <header class="topbar">
        <button class="brand" onClick={props.onHome} title="Back to start">⬡</button>
        <div class="title">
          <strong>{client.meta?.name ?? 'Table'}</strong>
          {props.demo && <span class="badge warn" title="Data lives in this browser only">demo</span>}
        </div>
        {client.isDM ? (
          <div class="scene-pick">
            <select value={client.viewSceneId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v === '__new') setModal({ kind: 'newScene' }); else client.openScene(v || null); }}>
              {client.sceneIndex.length === 0 && <option value="">No scenes</option>}
              {client.sceneIndex.map((s) => <option value={s.id}>{s.name}{client.activeSceneId === s.id ? '  ● live' : ''}</option>)}
              <option value="__new">+ New scene…</option>
            </select>
            {client.viewSceneId && !live && <button class="btn small primary" onClick={() => void client.setActiveScene(client.viewSceneId!)}>Show to players</button>}
            {client.viewSceneId && !live && <span class="badge">private</span>}
            {live && <span class="badge live">live</span>}
          </div>
        ) : (
          scene?.meta && <span class="scene-name">{scene.meta.name}</span>
        )}
        <div class="spacer" />
        <div class="players">
          {players.map((p) => (
            <span key={p.uid} class={`chip ${p.online ? '' : 'off'}`} title={`${p.name}${p.online ? '' : ' (offline)'}`}>
              <span class="dot" style={{ background: p.color }} />{p.name}
            </span>
          ))}
        </div>
        {!client.isDM && <button class="btn small" onClick={() => setModal({ kind: 'claim' })}>My token</button>}
        {client.isDM && <button class="btn small" onClick={() => setModal({ kind: 'scenes' })}>Scenes</button>}
        {client.isDM && <button class="btn small" onClick={() => setModal({ kind: 'library' })}>Library</button>}
        {client.isDM && <button class="btn small" onClick={() => copyText(`${location.href.split('#')[0]}#/t/${client.tableId}`)}>Copy player link</button>}
        <button class="btn small" onClick={() => setModal({ kind: 'settings' })}>Settings</button>
      </header>

      {/* ---------------- right dock */}
      {mySel ? <Inspector client={client} ui={ui} /> : client.isDM ? <ScenePanel client={client} ui={ui} board={board} onNewScene={() => setModal({ kind: 'newScene' })} /> : null}

      {/* ---------------- overlays */}
      {d.status && <div class="status">{d.status}</div>}
      {mapError && <div class="banner error">{mapError}</div>}
      {client.lastError && client.isDM && <div class="banner error">Database error: {client.lastError}</div>}
      {!client.metaLoaded && <div class="splash-center">Connecting…</div>}
      {showEmpty && client.isDM && (
        <div class="empty-card">
          <h2>Create your first scene</h2>
          <p>Upload a map, then set the grid and place tokens.</p>
          <button class="btn primary" onClick={() => setModal({ kind: 'newScene' })}>+ New scene</button>
        </div>
      )}
      {client.metaLoaded && !client.isDM && !client.activeSceneId && <div class="empty-card"><h2>Waiting for the DM…</h2><p>No scene is being shown yet.</p></div>}
      {scene?.meta && !scene.meta.mapUrl && client.isDM && <div class="hint-chip">This scene has no map yet. Add one in the panel on the right.</div>}
      {client.isDM && client.metaLoaded && client.backend.kind === 'firebase' && !client.uploadKey && (
        <div class="banner info">
          Add your imgbb API key to upload maps and tokens.{' '}
          <button class="btn small primary" onClick={() => setModal({ kind: 'settings' })}>Open settings</button>
        </div>
      )}
      {client.isDM && d.dmPreview && <div class="hint-chip top">Previewing what players see</div>}
      {client.isDM && !live && client.viewSceneId && <div class="hint-chip top">Private scene: players can't see this yet</div>}

      {/* ---------------- context menu */}
      {menu && menuItems.length > 0 && (
        <div class="ctx-back" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div class="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - menuItems.length * 34 - 16) }} onMouseDown={(e) => e.stopPropagation()}>
            {menuItems.map((it) => <button key={it.label} class={it.danger ? 'danger' : ''} onClick={() => { setMenu(null); it.onClick(); }}>{it.label}</button>)}
          </div>
        </div>
      )}

      {/* ---------------- modals */}
      {modal?.kind === 'addToken' && <AddTokenModal client={client} at={modal.at} initialFile={modal.file} onClose={() => setModal(null)} onCreated={(id) => ui.select([id])} />}
      {modal?.kind === 'newScene' && <NewSceneModal client={client} onClose={() => setModal(null)} />}
      {modal?.kind === 'scenes' && <ScenesModal client={client} onClose={() => setModal(null)} onNew={() => setModal({ kind: 'newScene' })} />}
      {modal?.kind === 'library' && <LibraryModal client={client} onClose={() => setModal(null)} onUseMap={useLibraryMap} onAddToken={addLibraryToken} />}
      {modal?.kind === 'settings' && <SettingsModal client={client} onClose={() => setModal(null)} onSignOut={client.isDM ? props.onSignOut : undefined} />}
      {modal?.kind === 'claim' && <ClaimModal client={client} onClose={() => setModal(null)} onNewToken={() => openAddToken()} />}
      {modal?.kind === 'grid' && (
        <GridDialog onCancel={() => { setModal(null); ui.set({ tool: 'select' }); }}
          onApply={(cols, rows) => {
            const { gridFromRect } = geometry;
            const g = gridFromRect(modal.rect, cols, rows);
            void client.updateScene({ grid: { cell: Math.round(g.cell * 100) / 100, ox: Math.round(g.ox * 100) / 100, oy: Math.round(g.oy * 100) / 100, visible: true } });
            setModal(null);
            ui.set({ tool: 'select' });
          }} />
      )}
      <Toasts />
    </div>
  );
}

