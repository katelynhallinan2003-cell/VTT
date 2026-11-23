import { useEffect, useState } from 'preact/hooks';
import type { LibraryItem, LibraryKind } from '../types';
import { removeLibraryItem, watchImageCleanup, type ImageCleanupLink } from '../state/account';
import type { TableClient } from '../state/client';
import { P } from '../state/paths';
import { toast } from './common';

export function PictureTrash({ client, kind, item, disabled }: { client: TableClient; kind: LibraryKind; item: LibraryItem; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await removeLibraryItem(client.backend, client.uid, kind, item);
      toast(item.name + ' removed from library.', 'ok');
    } catch (e) {
      toast('Could not remove ' + item.name + '. ' + String(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  const label = 'Delete ' + item.name;
  return <button type="button" class="picture-trash" aria-label={label} title={label} disabled={disabled || busy} onClick={remove}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </svg>
  </button>;
}

export function ImageCleanup({ client, kind }: { client: TableClient; kind: LibraryKind }) {
  const [links, setLinks] = useState<ImageCleanupLink[]>([]);
  useEffect(() => watchImageCleanup(client.backend, client.uid, kind, setLinks), [client, kind]);
  async function dismiss(id: string) {
    try { await client.backend.remove(P.imageCleanup(client.uid, kind) + '/' + id); }
    catch (e) { toast('Could not dismiss the link. ' + String(e), 'error'); }
  }
  if (!links.length) return null;
  return <details>
    <summary>ImgBB cleanup ({links.length})</summary>
    <p class="muted">Open a link to delete its hosted picture on ImgBB. Scenes and tokens using that picture will lose their artwork. Dismiss removes the link from this list.</p>
    {links.map(link => <div key={link.id} class="row wrap">
      <a class="grow" href={link.deleteUrl} target="_blank" rel="noopener noreferrer">{link.name} ↗</a>
      <button class="btn small" aria-label={'Dismiss link for ' + link.name} onClick={() => dismiss(link.id)}>Dismiss</button>
    </div>)}
  </details>;
}
