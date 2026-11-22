import type { SavedToken } from '../core/tokenlib';
import type { TableClient } from '../state/client';
import { removeTokenFromLib } from '../state/account';
import { toast } from './common';

/** Save tokens to your own library (a DM's become templates, a player's become characters that follow them from scene to scene). */
export async function saveTokensToLibrary(client: TableClient, ids: string[]): Promise<void> {
  let n = 0;
  let name = '';
  try {
    for (const id of ids) {
      const t = client.scene?.tokens.get(id);
      if (!t) continue;
      if (await client.saveTokenToLibrary(id)) { n++; name = t.name || 'Token'; }
    }
  } catch (e) { toast((e as Error).message || 'Could not save it', 'error'); return; }
  if (!n) { toast('There was nothing of yours to save.', 'info', 2200); return; }
  const what = n === 1 ? `“${name}”` : `${n} tokens`;
  toast(client.isDM
    ? `Saved ${what} to your library. Add it to any scene from Library → Saved tokens.`
    : `Saved ${what}. It keeps its conditions and comes back from My token, in any scene.`, 'ok', 4200);
}

/** A saved token's picture, or its first letter. */
function Face(props: { entry: SavedToken }) {
  const img = typeof props.entry.t.img === 'string' ? props.entry.t.img : null;
  return img ? <img src={img} alt="" loading="lazy" /> : <div class="ph">{props.entry.name.charAt(0).toUpperCase() || '?'}</div>;
}

/** The grid of saved tokens. `action` is what the main button does ("Add to board", "Bring here"). */
export function SavedTokenGrid(props: { client: TableClient; empty: string; action: (e: SavedToken) => string; onAction: (e: SavedToken) => void; disabled?: (e: SavedToken) => boolean }) {
  const { client } = props;
  const items = client.tokenLib;
  if (!items.length) return <p class="muted">{props.empty}</p>;
  return (
    <div class="thumbs big">
      {items.map((e) => {
        const effects = Array.isArray(e.t.fx) ? e.t.fx.length : e.t.fx && typeof e.t.fx === 'object' ? Object.keys(e.t.fx as object).length : 0;
        return (
          <div key={e.id} class="lib-item" data-saved={e.id}>
            <Face entry={e} />
            <div class="lib-name" title={e.name}>{e.name}{effects > 0 && <span class="muted small"> · {effects} effect{effects === 1 ? '' : 's'}</span>}</div>
            <div class="lib-actions">
              <button class="btn small" disabled={props.disabled?.(e)} onClick={() => props.onAction(e)}>{props.action(e)}</button>
              <button class="btn small danger" title="Remove from my library" onClick={() => void removeTokenFromLib(client.backend, client.uid, e.id)}>✕</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
