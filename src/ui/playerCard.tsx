import { useEffect, useState } from 'preact/hooks';
import { normalizeToken } from '../core/model';
import { savedFields, type SavedToken } from '../core/tokenlib';
import { removeTokenFromLib, saveTokenToLib, watchTokenLib } from '../state/account';
import type { TableClient } from '../state/client';
import { P } from '../state/paths';
import type { Token } from '../types';
import { Modal, toast, useClient } from './common';
import { HandoutsModal, shownTo } from './handouts';
import { TokenEditorModal } from './tokenEditor';

/** A saved token as a token (standing at the corner, which a saved one never keeps), so the token editor can show it. */
export function tokenOfSaved(entry: SavedToken): Token {
  // a saved token keeps its maximum hit points but not the ones it has now: start it full, the way it comes onto a map
  const full = typeof entry.t.maxHp === 'number' ? { hp: entry.t.maxHp } : {};
  return normalizeToken(entry.id, { ...entry.t, ...full, name: typeof entry.t.name === 'string' && entry.t.name ? entry.t.name : entry.name, x: 0, y: 0 }, false);
}

/** The picture of a saved token, or its first letter. */
function Face(props: { entry: SavedToken }) {
  const img = typeof props.entry.t.img === 'string' ? props.entry.t.img : null;
  return img ? <img src={img} alt="" loading="lazy" /> : <div class="ph">{props.entry.name.charAt(0).toUpperCase() || '?'}</div>;
}

/**
 * One player, as the DM sees them: the characters they have saved (to look at, change or take away) and the handouts that are theirs to see.
 * A player has no account, so their saved characters live against the table under their `rid` (see `chars` in the rules, where the DM may read and write them).
 */
export function PlayerCardModal(props: { client: TableClient; uid: string; onClose: () => void }) {
  const { client } = props;
  useClient(client);
  const player = client.players.get(props.uid);
  const [saved, setSaved] = useState<SavedToken[] | null>(null);
  const [editing, setEditing] = useState<SavedToken | null>(null);
  const [handoutId, setHandoutId] = useState<string | null>(null);
  const path = player ? P.tableChars(client.tableId, player.rid) : null;

  useEffect(() => (path ? watchTokenLib(client.backend, path, setSaved) : undefined), [client, path]);
  // the player left the table: nothing to show
  useEffect(() => { if (!player) props.onClose(); }, [!!player]);
  if (!player || !path) return null;

  const handouts = client.handoutList().filter((h) => h.to == null || h.to.includes(player.uid));

  async function save(entry: SavedToken, patch: Partial<Token>) {
    const merged: Token = { ...tokenOfSaved(entry), ...patch };
    const t = savedFields(merged, { character: true, cid: typeof entry.t.cid === 'string' ? entry.t.cid : undefined });
    await saveTokenToLib(client.backend, path!, { name: merged.name || entry.name, t }, entry.id, entry.addedAt);
    toast(`Saved “${merged.name || entry.name}”. ${player!.name} sees the change next time they bring it in.`, 'ok', 3500);
  }
  function remove(entry: SavedToken) {
    if (!confirm(`Take “${entry.name}” out of ${player!.name}'s saved tokens?`)) return;
    void removeTokenFromLib(client.backend, path!, entry.id).catch((e: Error) => toast(e.message, 'error'));
  }

  return (
    <>
      <Modal title={player.name} onClose={props.onClose} width={600} footer={<button class="btn primary" onClick={props.onClose}>Done</button>}>
        <p class="muted" style={{ marginTop: 0 }}>
          <span class="dot" style={{ background: player.color }} /> {player.online ? 'Online now' : 'Offline'}
        </p>
        <h4 style={{ marginTop: 0 }}>Saved tokens</h4>
        {saved === null && <p class="muted">Looking…</p>}
        {saved?.length === 0 && <p class="muted">{player.name} has not saved a token yet. They save one from the menu of their token.</p>}
        {!!saved?.length && (
          <div class="thumbs big">
            {saved.map((e) => (
              <div key={e.id} class="lib-item" data-saved={e.id}>
                <Face entry={e} />
                <div class="lib-name" title={e.name}>{e.name}</div>
                <div class="lib-actions">
                  <button class="btn small" onClick={() => setEditing(e)}>Edit</button>
                  <button class="btn small danger" title="Remove from their saved tokens" aria-label={`Remove ${e.name}`} onClick={() => remove(e)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <h4>Handouts</h4>
        {handouts.length === 0 && <p class="muted">Nothing has been made for {player.name} yet. Handouts are made from the Handouts button at the top.</p>}
        {handouts.length > 0 && (
          <ul class="tok-list">
            {handouts.map((h) => (
              <li key={h.id}>
                <span class="tok-name">
                  <span>{h.title || 'Untitled handout'}</span>
                  <span class="tok-sub">{shownTo(client, h)}</span>
                </span>
                <button class="btn small" onClick={() => setHandoutId(h.id)}>Edit</button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      {editing && <TokenEditorModal client={client} ids={[]} saved={{ token: tokenOfSaved(editing), onSave: (patch) => save(editing, patch) }} onClose={() => setEditing(null)} />}
      {handoutId && <HandoutsModal client={client} editId={handoutId} onClose={() => setHandoutId(null)} />}
    </>
  );
}
