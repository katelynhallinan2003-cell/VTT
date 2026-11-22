import { useState } from 'preact/hooks';
import type { LibraryItem } from '../types';
import { Modal } from './common';

export function PictureTrash(props: { name: string; disabled?: boolean; onClick: () => void }) {
  const label = 'Delete ' + props.name;
  return <button type="button" class="picture-trash" aria-label={label} title={label} disabled={props.disabled} onClick={props.onClick}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </svg>
  </button>;
}

export function DeletePictureDialog(props: { item: LibraryItem; onClose: () => void; onRemove: () => Promise<void> }) {
  const { item } = props;
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (busy) return;
    setBusy(true);
    try { await props.onRemove(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Modal title="Delete picture" width={450} onClose={() => { if (!busy) props.onClose(); }}
    footer={<>
      <button class="btn" disabled={busy} onClick={props.onClose}>Cancel</button>
      <button class="btn danger" disabled={busy} onClick={() => void remove()}>
        {busy ? 'Removing…' : item.deleteUrl && !opened ? 'Remove from library only' : 'Remove from library'}
      </button>
    </>}>
    <strong>{item.name}</strong>
    {item.deleteUrl ? <>
      <p>Confirm deletion on ImgBB, then return here to remove this library entry. Scenes and tokens that use the hosted picture will lose their artwork.</p>
      <a class="btn" href={item.deleteUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>Open ImgBB deletion page ↗</a>
    </> : <p>{/^https?:\/\/i\.ibb\.co\//i.test(item.url)
      ? 'This entry has no saved ImgBB deletion link. You can remove it from your library here and manage the hosted picture in your ImgBB account.'
      : 'Remove this picture from your library? The original picture stays at its source.'}</p>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
