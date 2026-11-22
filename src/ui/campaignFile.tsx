import { useRef, useState } from 'preact/hooks';
import { describeCampaign, parseCampaign, type CampaignFile } from '../core/campaign';
import type { TableClient } from '../state/client';
import { Toggle, toast } from './common';

/** Settings → save the whole campaign to a file, or add one that was saved. */
export function CampaignFileSection(props: { client: TableClient }) {
  const { client } = props;
  const pick = useRef<HTMLInputElement>(null);
  const [withLibrary, setWithLibrary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: CampaignFile; name: string; bytes: number } | null>(null);
  const [useLibrary, setUseLibrary] = useState(true);
  const [usePerms, setUsePerms] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      const file = await client.exportCampaign({ library: withLibrary });
      const text = JSON.stringify(file);
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      const safe = (client.meta?.name ?? 'campaign').replace(/[^\w\- ]+/g, '').trim() || 'campaign';
      a.href = URL.createObjectURL(blob);
      a.download = `${safe} (campaign).json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      const n = file.scenes.length;
      toast(`Saved ${n} scene${n === 1 ? '' : 's'}${file.handouts.length ? ` and ${file.handouts.length} handout${file.handouts.length === 1 ? '' : 's'}` : ''} to a file`, 'ok');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the campaign.');
    } finally { setBusy(false); }
  };

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError(''); setPending(null);
    if (f.size > 60 * 1024 * 1024) { setError('That file is very large (over 60 MB), so it is probably not a campaign file.'); return; }
    const res = parseCampaign(await f.text());
    if (!res.ok) { setError(res.error); return; }
    setUseLibrary(true); setUsePerms(false);
    setPending({ file: res.file, name: f.name, bytes: f.size });
  };

  const add = async () => {
    if (!pending) return;
    setBusy(true); setError('');
    try {
      const r = await client.importCampaign(pending.file, { library: useLibrary, permissions: usePerms });
      const bits = [`${r.scenes} scene${r.scenes === 1 ? '' : 's'}`];
      if (r.handouts) bits.push(`${r.handouts} handout${r.handouts === 1 ? '' : 's'}`);
      if (r.library) bits.push(`${r.library} library item${r.library === 1 ? '' : 's'}`);
      toast(`Added ${bits.join(', ')}. The scenes are in your scene list.`, 'ok', 5000);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the campaign.');
    } finally { setBusy(false); }
  };

  const d = pending ? describeCampaign(pending.file) : null;
  const mb = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  return (
    <>
      <h3>Campaign file</h3>
      <p class="muted">
        Save everything to one file to keep a backup or to move it to another table: every scene with its tokens (hidden ones and hit points too), walls, fog, drawings and initiative, plus your handouts.
        Pictures are saved as links, so they come back as long as they stay online. The file has your hidden things in it, so keep it to yourself.
      </p>
      <Toggle checked={withLibrary} label="Include my map and token library" hint="The pictures saved in your account, not only the ones on this table." onChange={setWithLibrary} />
      <div class="row wrap">
        <button class="btn primary" disabled={busy} onClick={() => void save()}>{busy && !pending ? 'Saving…' : 'Save campaign to a file'}</button>
        <button class="btn" disabled={busy} onClick={() => pick.current?.click()}>Add a saved campaign…</button>
        <input ref={pick} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={(e) => { const el = e.target as HTMLInputElement; void choose(el.files?.[0]); el.value = ''; }} />
      </div>
      {error && <p class="campaign-error">{error}</p>}
      {pending && d && (
        <div class="campaign-confirm">
          <div><b>{pending.file.table.name}</b> <span class="muted">({pending.name}, {mb(pending.bytes)})</span></div>
          <div>
            {d.scenes.length ? (
              <>Scenes: {d.scenes.slice(0, 8).join(', ')}{d.scenes.length > 8 ? ` and ${d.scenes.length - 8} more` : ''}.</>
            ) : 'No scenes.'}
            {d.handouts ? ` ${d.handouts} handout${d.handouts === 1 ? '' : 's'}.` : ''}
          </div>
          <p class="muted">These are added next to what you have. Nothing here is changed or replaced. Tokens that belonged to players come in unclaimed, and handouts come in not shown.</p>
          {(d.maps || d.tokens) ? (
            <Toggle checked={useLibrary} label={`Add its library to mine (${d.maps} map${d.maps === 1 ? '' : 's'}, ${d.tokens} token${d.tokens === 1 ? '' : 's'})`} hint="Pictures you already have are skipped." onChange={setUseLibrary} />
          ) : null}
          {pending.file.table.settings ? (
            <Toggle checked={usePerms} label="Use its player permissions" hint="Replaces what players can do at this table with the file's settings." onChange={setUsePerms} />
          ) : null}
          <div class="row wrap">
            <button class="btn primary" disabled={busy} onClick={() => void add()}>{busy ? 'Adding…' : 'Add to this table'}</button>
            <button class="btn" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
