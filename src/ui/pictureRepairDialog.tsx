import { useState } from 'preact/hooks';
import type { TableClient } from '../state/client';
import { Modal } from './common';

export function PictureRepairDialog({ client, item }: { client: TableClient; item: TableClient['pictures']['pending'][number] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => { if (!busy) client.pictures.dismiss(item.sid, item.url); };
  async function restore(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try { await client.pictures.restore(item.sid, item.url, file); }
    catch (e) { setError(e instanceof Error ? e.message : 'The upload failed. Try again.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Repair missing artwork" onClose={close}>
    <p><b>{item.name}</b> could not load <b>{item.url.split('/').pop()}</b>.</p>
    {item.reason && <p role="status">{item.reason}</p>}
    <p>Choose the original picture{item.w && item.h ? ` (${item.w} × ${item.h} pixels)` : ''} to restore it in place.</p>
    <input aria-label="Original picture" type="file" accept="image/*" disabled={busy} onChange={e => {
      const file = e.currentTarget.files?.[0];
      e.currentTarget.value = '';
      void restore(file);
    }} />
    {busy && <p role="status">Uploading and checking the picture…</p>}
    {error && <p role="alert">{error}</p>}
    <button class="btn" disabled={busy} onClick={async()=>{
      setBusy(true);setError('');
      try { await client.pictures.retry(item.sid,item.url); }
      catch(e) { setError(e instanceof Error ? e.message : 'Could not check the picture.'); }
      finally { setBusy(false); }
    }}>Retry recovery</button>
    <button class="btn" disabled={busy} onClick={close}>Later</button>
  </Modal>;
}
