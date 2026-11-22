import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../board/Board';
import * as geometry from '../core/geometry';
import { snapTokenCenter } from '../core/geometry';
import { loadImage } from '../core/images';
import type { TableClient } from '../state/client';
import { UiState } from '../state/ui';
import type { SavedToken } from '../core/tokenlib';
import type { AuthUser, LibraryItem, Rect, Token, Vec } from '../types';
import { HandoutsModal } from './handouts';
import { Toasts, copyText, toast, useClient, useTheme, useUi } from './common';
import { AddTokenModal, ClaimModal, GridDialog, LibraryModal, NewFolderModal, NewSceneModal, ScenesModal, SettingsModal, type SettingsTab } from './modals';
import { SceneBar } from './sceneBar';
import { saveTokensToLibrary } from './tokenLib';
import { droppedImage } from './uploads';
import { DrawFlyout, DrawInspector, HeightFlyout, RulerFlyout, TemplateFlyout, TestMoveBar, TextEditor, WallFlyout } from './drawTools';
import { Dock, Rail, TokenTag } from './panels';
import { InitPopup, InitStrip } from './initiative';
import { EffectsWindow } from './effects';
import { TokenEditorModal } from './tokenEditor';

type ModalState =
  | null
  | { kind: 'addToken'; at: Vec; file?: File | null; art?: LibraryItem }
  | { kind: 'newScene'; file?: File | null }
  | { kind: 'scenes' }
  | { kind: 'newFolder' }
  | { kind: 'library' }
  | { kind: 'settings'; tab?: SettingsTab }
  | { kind: 'claim' }
  | { kind: 'handouts'; openId?: string | null }
  | { kind: 'editToken'; ids: string[] }
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
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  draw: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
  template: 'M12 4l8 14H4zM4 18a8 3 0 0 0 16 0',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  init: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 8l4 6H8z',
  height: 'M2 20l6-10 4 6 3-4 7 8zM8 10l-1-2M15 12l1-3',
  wall: 'M3 5h18v14H3zM3 9.7h18M3 14.3h18M9 5v4.7M15 9.7v4.6M9 14.3V19',
  test: 'M6 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 15l8-5',
};

/** A picture with an arrow coming down into it: "drop a picture here". */
const DropIcon = (props: { size?: number }) => (
  <svg class="drop-icon" width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3v9M8.5 8.5L12 12l3.5-3.5M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
);

function ToolBtn(props: { icon: keyof typeof ICONS; label: string; hotkey?: string; on?: boolean; /** a plain on/off switch, not the active tool: shown more quietly */ toggle?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    // the name (and its key) shows beside the button the moment the pointer is on it: see .tool[data-tip] in styles.css
    <button class={`tool ${props.on ? (props.toggle ? 'toggled' : 'on') : ''}`} disabled={props.disabled} data-tip={`${props.label}${props.hotkey ? `  (${props.hotkey})` : ''}`} aria-label={props.label} aria-keyshortcuts={props.hotkey} onClick={props.onClick}>
      <Icon d={ICONS[props.icon]} />
    </button>
  );
}

export function TableView(props: { client: TableClient; user: AuthUser; demo: boolean; onSignOut: () => void; onHome: () => void; onRemoved?: () => void }) {
  const { client } = props;
  useClient(client);
  const ui = useMemo(() => new UiState(), []);
  useTheme();
  const d = useUi(ui);
  const hostRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const boardRef = useRef<Board | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; tokenId: string | null; world: Vec } | null>(null);
  /** the tokens whose Effects window is open (it floats over the board, so it is not a modal) */
  const [fxWin, setFxWin] = useState<string[] | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const claimOffered = useRef(false);
  const modalRef = useRef<ModalState>(null);
  modalRef.current = modal;
  /** a handout the DM just showed: it opens over whatever else is open, so it is never missed */
  const [popup, setPopup] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // What hangs from the top edge (notes, the test-move bar, warnings) sits between the two halves of the top bar when there is room
  // for it there, and just under the top bar when there is not, so it never covers the scene picker or the buttons.
  // The turn order goes beside or under it the same way.
  useEffect(() => {
    const el = topRef.current;
    const root = el?.parentElement;
    if (!el || !root) return;
    const lay = () => {
      const box = root.getBoundingClientRect();
      const pl = root.querySelector('.pill-left')?.getBoundingClientRect();
      const pr = root.querySelector('.pill-right')?.getBoundingClientRect();
      const l = pl ? pl.right - box.left + 8 : 360;
      const r = pr ? box.right - pr.left + 8 : 340;
      const free = box.width - l - r;
      const low = el.offsetWidth > free;
      el.classList.toggle('low', low);
      if (low) root.dataset.topLow = '1'; else delete root.dataset.topLow;
      // the turn order needs room for a handful of boxes: with less than that beside the top bar it goes under it too
      if (free < 480) root.dataset.stripLow = '1'; else delete root.dataset.stripLow;
      const h = el.offsetHeight;
      root.style.setProperty('--pill-l', `${Math.round(l)}px`);
      root.style.setProperty('--pill-r', `${Math.round(r)}px`);
      root.style.setProperty('--topstack-h', `${low && h ? h + 54 : h}px`);
    };
    lay();
    const ro = new ResizeObserver(lay);
    ro.observe(el);
    ro.observe(root);
    for (const pill of root.querySelectorAll('.pill')) ro.observe(pill);
    return () => ro.disconnect();
  }, []);

  // the browser tab is named after the table, so a DM with several tables (or a test player in the next tab) can tell them apart
  const tableName = client.meta?.name;
  useEffect(() => {
    document.title = tableName ? `${tableName} · Table` : 'Table';
    return () => { document.title = 'Table'; };
  }, [tableName]);

  // Esc closes the right-click menu (and stops there, so it doesn't also clear the selection)
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setMenu(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu]);

  // ---- board lifecycle
  useEffect(() => {
    if (!hostRef.current) return;
    const b = new Board(hostRef.current, client, ui, {
      onContextMenu: (info) => setMenu({ x: info.clientX, y: info.clientY, tokenId: info.tokenId, world: info.world }),
      onGridRect: (rect, derived) => setModal({ kind: 'grid', rect, derived }),
      onMapError: setMapError,
      onTokenImageError: (m) => toast(m, 'error', 9000),
      // a note stays long enough to be read: a couple of words a couple of seconds, a sentence or two longer
      onNotice: (m, k) => toast(m, k, Math.max(1800, 900 + m.length * 45)),
    });
    let dead = false;
    void b.init().then(() => { if (!dead) { boardRef.current = b; setBoard(b); (window as any).__vtt = { client, ui, board: b }; } });
    return () => { dead = true; boardRef.current = null; b.destroy(); };
  }, [client, ui]);

  // ---- tell the DM when an effect runs out as the turns move on
  useEffect(() => {
    if (!client.isDM) return;
    client.onFxEnded = (lines) => { for (const l of lines) toast(l, 'info', 3200); };
    return () => { client.onFxEnded = null; };
  }, [client]);

  // ---- a handout the DM just showed: say so, and open it unless something else is open
  useEffect(() => {
    if (client.isDM) return;
    return client.onHandout((h) => {
      toast(`The DM shared a handout: ${h.title || 'Handout'}`, 'info', 4000);
      setModal((m) => (m?.kind === 'handouts' ? null : m)); // the list window would only sit behind it
      setPopup(h.id);
    });
  }, [client]);

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

  // ---- the DM removed this player from the list: send them back to the join form
  const hadMe = useRef(false);
  useEffect(() => {
    if (client.isDM) return;
    if (client.me) hadMe.current = true;
    else if (hadMe.current && client.metaLoaded) props.onRemoved?.();
  }, [client.rev]);

  // ---- hotkeys that open dialogs
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || modalRef.current) return;
      if (e.key === '?') { e.preventDefault(); setModal({ kind: 'settings', tab: 'keys' }); }
      if (e.key.toLowerCase() === 't' && client.canDo('create')) openAddToken();
      if (e.key.toLowerCase() === 'e') {
        const ids = [...ui.data.selection].filter((id) => { const t = client.scene?.tokens.get(id); return t && client.canDo('edit', t); });
        if (ids.length) { e.preventDefault(); setModal({ kind: 'editToken', ids }); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [client, board]);

  function viewCenter(): Vec { return boardRef.current?.viewCenterWorld() ?? { x: 500, y: 500 }; }
  function openAddToken(at?: Vec, file?: File | null) { setModal({ kind: 'addToken', at: at ?? viewCenter(), file }); }

  // ---- drag & drop a picture onto the page: the map of a first scene while the table is still empty, a new token after that
  // (while the New scene window is open it takes the drop itself, see NewSceneModal)
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const dropMakesScene = () => client.isDM && client.metaLoaded && client.sceneIndex.length === 0 && !client.viewSceneId;
  // however a drag ends (dropped on a window that took it, or let go of outside), the "drop it here" veil goes away
  useEffect(() => {
    const end = () => { dragDepth.current = 0; setDragging(false); };
    window.addEventListener('drop', end, true);
    window.addEventListener('dragend', end, true);
    return () => { window.removeEventListener('drop', end, true); window.removeEventListener('dragend', end, true); };
  }, []);
  function onDragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files') || modalRef.current) return;
    dragDepth.current++;
    setDragging(true);
  }
  function onDragLeave(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files') || !dragDepth.current) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    // a window that is open keeps the page: a picture dropped behind Settings or a handout does not start a token under it
    // (New scene and Add token take a dropped picture themselves)
    if (modalRef.current) return;
    const got = droppedImage(e);
    if (got === 'other') { toast('That file is not a picture.', 'error'); return; }
    if (got === 'none' || !('file' in got)) return;
    if (dropMakesScene()) { setModal({ kind: 'newScene', file: got.file }); return; }
    if (!client.canDo('create')) { toast('You are not allowed to add tokens.', 'error'); return; }
    const at = boardRef.current?.screenToWorld(e.clientX, e.clientY) ?? viewCenter();
    openAddToken(at, got.file);
  }

  async function useLibraryMap(item: LibraryItem) {
    try {
      let w = item.w ?? 0, h = item.h ?? 0;
      if (!w || !h) { const img = await loadImage(item.url, true); w = img.naturalWidth; h = img.naturalHeight; }
      const firstMap = !client.scene?.meta?.mapUrl;
      if (!client.scene?.meta) await client.createScene({ name: item.name, mapUrl: item.url, mapW: w, mapH: h, makeActive: !client.activeSceneId });
      else await client.setSceneMap(item.url, w, h);
      if (firstMap) ui.set({ dockTab: 'scene' });
      setModal(null);
    } catch { toast('Could not load that map.', 'error'); }
  }

  /** Drop a saved token onto the board where the view is centred. */
  async function addSavedToken(entry: SavedToken) {
    const at = viewCenter();
    const grid = client.grid;
    const p = grid.snap ? snapTokenCenter(grid, 1, at) : at;
    try {
      const id = await client.addSavedToken(entry.id, p);
      if (id) { ui.select([id]); toast(client.isDM ? `${entry.name} added` : `${entry.name} is here`, 'ok', 1800); }
    } catch (e) { toast((e as Error).message || 'Could not add it', 'error'); }
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
      if (toks.every((t) => client.canDo('edit', t))) menuItems.push({ label: 'Edit token…', onClick: () => setModal({ kind: 'editToken', ids }) });
      if (toks.every((t) => client.canDo('edit', t))) menuItems.push({ label: 'Effects…', onClick: () => setFxWin(ids) });
      if (client.isDM || toks.every((t) => t.ownerUid === client.uid)) menuItems.push({ label: client.isDM ? 'Save to library' : 'Save as my character', onClick: () => void saveTokensToLibrary(client, ids) });
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
      if (client.isDM && d.selection.size) menuItems.push({ label: d.selection.size > 1 ? 'Teleport selected tokens here' : 'Teleport selected token here', onClick: () => boardRef.current?.teleportSelectedTo(menu.world) });
      if (client.canDo('create')) menuItems.push({ label: 'Add token here…', onClick: () => openAddToken(menu.world) });
    }
  }

  const live = client.sceneIsActive;
  // the DM with no scenes at all gets a big "create your first scene" card (after a short wait, so it does not flash while scenes load)
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!client.metaLoaded) return;
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [client.metaLoaded]);
  const showEmpty = settled && client.sceneIndex.length === 0 && !client.viewSceneId;
    const mySel = scene && d.selection.size > 0;
  const gridOn = !!scene?.meta?.grid.visible;

  return (
    <div class="table-root" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div class="board-host" ref={hostRef} />

      {/* ---------------- left toolbar */}
      <nav class="toolbar">
        <ToolBtn icon="select" label="Select / move" hotkey="V" on={d.tool === 'select'} onClick={() => ui.set({ tool: 'select' })} />
        <ToolBtn icon="token" label="Add token" hotkey="T" onClick={() => client.canDo('create') ? openAddToken() : toast('You are not allowed to add tokens.', 'error')} />
        <ToolBtn icon="ruler" label="Ruler" hotkey="R" on={d.tool === 'ruler'} disabled={!client.canDo('measure')} onClick={() => ui.set({ tool: d.tool === 'ruler' ? 'select' : 'ruler' })} />
        <div class="tool-sep" />
        <ToolBtn icon="draw" label="Draw and write" hotkey="P" on={d.tool === 'draw'} disabled={!client.canDo('draw')} onClick={() => ui.set({ tool: d.tool === 'draw' ? 'select' : 'draw' })} />
        <ToolBtn icon="template" label="Spell templates" hotkey="C" on={d.tool === 'template'} disabled={!client.canDo('template')} onClick={() => ui.set({ tool: d.tool === 'template' ? 'select' : 'template' })} />
        <ToolBtn icon="test" label="Test move: try a move without making it" hotkey="M" on={d.testMove} onClick={() => ui.set({ testMove: !d.testMove })} />
        {client.isDM && <div class="tool-sep" />}
        {/* the DM's tools for setting a scene up and running a fight */}
        {client.isDM && <ToolBtn icon="grid" label={gridOn ? 'Hide the grid' : 'Show the grid'} hotkey="G" on={gridOn} toggle disabled={!scene?.meta} onClick={() => void client.updateScene({ grid: { visible: !gridOn } })} />}
        {client.isDM && <ToolBtn icon="fog" label="Fog of war" hotkey="F" on={d.tool === 'fog'} onClick={() => ui.set({ tool: d.tool === 'fog' ? 'select' : 'fog' })} />}
        {client.isDM && <ToolBtn icon="wall" label="Walls: draw walls, doors and windows" hotkey="B" on={d.tool === 'wall'} onClick={() => ui.set({ tool: d.tool === 'wall' ? 'select' : 'wall' })} />}
        {client.isDM && <ToolBtn icon="height" label="Heights: draw high and low ground" hotkey="H" on={d.tool === 'height'} onClick={() => ui.set({ tool: d.tool === 'height' ? 'select' : 'height' })} />}
        {client.isDM && <ToolBtn icon="init" label="Initiative: roll and keep the turn order" hotkey="I" on={d.initOpen} toggle onClick={() => ui.set({ initOpen: !d.initOpen })} />}
        <div class="tool-sep" />
        <ToolBtn icon="undo" label={client.history.undoLabel ? `Undo: ${client.history.undoLabel}` : 'Undo'} hotkey="Ctrl+Z" disabled={!client.history.canUndo} onClick={() => void board?.runHistory('undo')} />
        <ToolBtn icon="redo" label={client.history.redoLabel ? `Redo: ${client.history.redoLabel}` : 'Redo'} hotkey="Ctrl+Y" disabled={!client.history.canRedo} onClick={() => void board?.runHistory('redo')} />
        <div class="tool-sep" />
        <ToolBtn icon="fit" label="Fit map to screen" hotkey="0" onClick={() => board?.fit()} />
        <div class="zoom">{Math.round(d.zoom * 100)}%</div>
      </nav>

      {d.tool === 'draw' && <DrawFlyout ui={ui} client={client} />}
      {d.tool === 'template' && <TemplateFlyout ui={ui} client={client} />}
      {d.tool === 'ruler' && <RulerFlyout ui={ui} client={client} />}
      {d.tool === 'height' && client.isDM && <HeightFlyout ui={ui} client={client} />}
      {d.tool === 'wall' && client.isDM && <WallFlyout ui={ui} client={client} />}
      <TextEditor ui={ui} client={client} board={board} />
      <DrawInspector ui={ui} client={client} board={board} />

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
            <button class="btn small" onClick={() => void client.resetFog('hidden')}>Hide everything</button>
            <button class="btn small" onClick={() => void client.resetFog('clear')}>Reveal everything</button>
          </div>
          <label class="toggle"><input type="checkbox" checked={d.dmPreview} onChange={(e) => ui.set({ dmPreview: (e.target as HTMLInputElement).checked })} /><span class="toggle-text">Preview as players</span></label>
        </div>
      )}

      {/* ---------------- top bar: two small pills, nothing across the middle */}
      <header class="pill pill-left">
        <button class="brand" onClick={props.onHome} title="Back to start">⬡</button>
        {props.demo && <span class="badge warn" title="Data lives in this browser only">demo</span>}
        {client.isDM ? (
          <>
            <SceneBar client={client} ui={ui} onNew={() => setModal({ kind: 'newScene' })} onManage={() => setModal({ kind: 'scenes' })} onNewFolder={() => setModal({ kind: 'newFolder' })} />
            {client.viewSceneId && !live && <button class="btn small primary" title="Players are on another scene. This moves everyone at the table to this one." onClick={() => void client.setActiveScene(client.viewSceneId!).then((n) => { if (n) toast(`${n} player token${n === 1 ? '' : 's'} came along`, 'ok', 2600); })}>Summon players</button>}
          </>
        ) : (
          scene?.meta && <span class="scene-name">{scene.meta.name}</span>
        )}
      </header>
      <header class="pill pill-right">
        {!client.isDM && <button class="btn small" onClick={() => setModal({ kind: 'claim' })}>My token</button>}
        {client.isDM && <button class="btn small" onClick={() => setModal({ kind: 'library' })}>Library</button>}
        {(client.isDM || client.handoutList().length > 0) && (
          <button class="btn small" title={client.isDM ? 'Pictures and words to put in front of your players' : 'What the DM has shown you'} onClick={() => setModal({ kind: 'handouts' })}>
            Handouts{!client.isDM && client.handoutList().length ? ` (${client.handoutList().length})` : ''}
          </button>
        )}
        {client.isDM && live && <button class="btn small" title="Moves every player's view to the part of the map you are looking at" onClick={() => { const r = boardRef.current?.viewRect(); if (r) { void client.callView(r); toast('Everyone is being brought to this view', 'ok', 2200); } }}>Bring players here</button>}
        {client.isDM && <button class="btn small" onClick={() => copyText(`${location.href.split('#')[0]}#/t/${client.tableId}`)}>Copy player link</button>}
        <button class="btn small" onClick={() => setModal({ kind: 'settings' })}>Settings</button>
      </header>

      {/* ---------------- right side: little tabs, and the panel that opens beside them */}
      <Rail client={client} ui={ui} />
      <Dock client={client} ui={ui} board={board} onNewScene={() => setModal({ kind: 'newScene' })} onEdit={(ids) => setModal({ kind: 'editToken', ids })} />
      <InitStrip client={client} ui={ui} board={board} />
      <InitPopup client={client} ui={ui} board={board} onEdit={(ids) => setModal({ kind: 'editToken', ids })} onEffects={(ids) => setFxWin(ids)} />
      {mySel && <TokenTag client={client} ui={ui} onEdit={(ids) => setModal({ kind: 'editToken', ids })} onEffects={(ids) => setFxWin(ids)} />}

      {/* ---------------- overlays */}
      {d.status && <div class="status">{d.status}</div>}

      {!client.metaLoaded && <div class="splash-center">Connecting…</div>}
      {showEmpty && client.isDM && (
        <div class="empty-card">
          <h2>Create your first scene</h2>
          <p>Start with a map picture, then place your tokens.</p>
          <button class="btn primary" onClick={() => setModal({ kind: 'newScene' })}>+ New scene</button>
          <p class="drop-tip"><DropIcon /> or drag a map picture anywhere onto this page</p>
        </div>
      )}
      {/* a picture is being dragged over the page: say what dropping it will do */}
      {dragging && !modal && (dropMakesScene() || client.canDo('create')) && (
        <div class="drop-veil">
          <div class="drop-veil-box">
            <DropIcon size={34} />
            <strong>{dropMakesScene() ? 'Drop the picture to use it as your map' : 'Drop the picture to make a token from it'}</strong>
            <span>{dropMakesScene() ? 'A new scene is made with it. You can name it before it is created.' : 'It is placed where you drop it.'}</span>
          </div>
        </div>
      )}
      {client.metaLoaded && !client.isDM && !client.activeSceneId && <div class="empty-card"><h2>Waiting for the DM…</h2><p>No scene is being shown yet.</p></div>}
      {scene?.meta && !scene.meta.mapUrl && client.isDM && <div class="hint-chip">This scene has no map yet. <button class="link" onClick={() => ui.set({ dockTab: 'scene' })}>Add one in the Scene tab</button>.</div>}
      {/* ---------------- top middle: things that hang from the top edge, one under the other so none covers another */}
      <div class="topstack" ref={topRef}>
        {client.isDM && !live && client.viewSceneId && <div class="topchip warn">Private scene: players can't see this yet</div>}
        {client.isDM && d.dmPreview && <div class="topchip">Previewing what players see <button class="link" onClick={() => ui.set({ dmPreview: false })}>Stop</button></div>}
        <TestMoveBar ui={ui} board={board} />
        {mapError && <div class="banner error">{mapError} <button class="btn small" onClick={() => board?.retryMap()}>Try again</button></div>}
        {client.lastError && client.isDM && <div class="banner error">Database error: {client.lastError}</div>}
        {client.isDM && client.metaLoaded && client.backend.kind === 'firebase' && !client.uploadKey && (
          <div class="banner info">
            Add your imgbb API key to upload maps and tokens.{' '}
            <button class="btn small primary" onClick={() => setModal({ kind: 'settings', tab: 'files' })}>Open settings</button>
          </div>
        )}
      </div>

      {/* ---------------- context menu */}
      {menu && menuItems.length > 0 && (
        // a press anywhere outside the menu closes it. The browser's own menu is only kept away here, never used to close ours:
        // on Windows the "context menu" event arrives after the button is let go, which is just after this menu has opened
        <div class="ctx-back" onMouseDown={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()}>
          <div class="ctx" style={{ left: `${Math.max(0, Math.min(menu.x, window.innerWidth - 220))}px`, top: `${Math.max(0, Math.min(menu.y, window.innerHeight - menuItems.length * 34 - 16))}px` }} onMouseDown={(e) => e.stopPropagation()}>
            {menuItems.map((it) => <button key={it.label} class={it.danger ? 'danger' : ''} onClick={() => { setMenu(null); it.onClick(); }}>{it.label}</button>)}
          </div>
        </div>
      )}

      {fxWin && <EffectsWindow key={fxWin.join(',')} client={client} ui={ui} board={board} ids={fxWin} onClose={() => setFxWin(null)} />}

      {/* ---------------- modals */}
      {modal?.kind === 'addToken' && <AddTokenModal client={client} at={modal.at} initialFile={modal.file} onClose={() => setModal(null)} onCreated={(id) => ui.select([id])} />}
      {modal?.kind === 'newScene' && <NewSceneModal client={client} initialFile={modal.file} folder={['all', 'none'].includes(d.sceneFolder) ? null : d.sceneFolder} onClose={() => setModal(null)} onCreated={() => ui.set({ dockTab: 'scene' })} />}
      {modal?.kind === 'newFolder' && <NewFolderModal client={client} onClose={() => setModal(null)} onCreated={(id) => ui.set({ sceneFolder: id })} />}
      {modal?.kind === 'scenes' && <ScenesModal client={client} onClose={() => setModal(null)} onNew={() => setModal({ kind: 'newScene' })} onNewFolder={() => setModal({ kind: 'newFolder' })} />}
      {modal?.kind === 'library' && <LibraryModal client={client} onClose={() => setModal(null)} onUseMap={useLibraryMap} onAddToken={addLibraryToken} onAddSaved={(e) => { void addSavedToken(e); setModal(null); }} />}
      {modal?.kind === 'settings' && <SettingsModal key={modal.tab ?? 'first'} client={client} ui={ui} tab={modal.tab} onClose={() => setModal(null)} onSignOut={client.isDM ? props.onSignOut : undefined} />}
      {modal?.kind === 'editToken' && <TokenEditorModal client={client} ids={modal.ids} onClose={() => setModal(null)} />}
      {modal?.kind === 'handouts' && <HandoutsModal key={modal.openId ?? 'list'} client={client} openId={modal.openId ?? null} onClose={() => setModal(null)} />}
      {popup && <HandoutsModal key={'popup-' + popup} client={client} openId={popup} onClose={() => setPopup(null)} />}
      {modal?.kind === 'claim' && <ClaimModal client={client} onClose={() => setModal(null)} onNewToken={() => openAddToken()} onBring={(e) => void addSavedToken(e)} />}
      {modal?.kind === 'grid' && (
        <GridDialog shape={client.grid.shape} onCancel={() => { setModal(null); ui.set({ tool: 'select' }); }}
          onApply={(cols, rows) => {
            const { gridFromRect } = geometry;
            const g = gridFromRect(modal.rect, cols, rows, client.grid.shape);
            void client.updateScene({ grid: { cell: Math.round(g.cell * 100) / 100, ox: Math.round(g.ox * 100) / 100, oy: Math.round(g.oy * 100) / 100, visible: true } });
            setModal(null);
            ui.set({ tool: 'select' });
          }} />
      )}
      <Toasts />
    </div>
  );
}

