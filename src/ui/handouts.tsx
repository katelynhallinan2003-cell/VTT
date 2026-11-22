import { useRef, useState } from 'preact/hooks';
import type { TableClient } from '../state/client';
import type { Handout } from '../types';
import { Field, Modal, toast, useClient } from './common';
import { uploadImage } from './uploads';

type View = { v: 'list' } | { v: 'edit'; id: string | null } | { v: 'show'; id: string } | { v: 'read'; id: string };

/** Who a handout is being shown to, in words. */
function shownTo(client: TableClient, h: Handout): string {
  if (!h.shown) return 'Not shown';
  if (!h.to) return 'Shown to everyone';
  const names = h.to.map((u) => client.players.get(u)?.name).filter((n): n is string => !!n);
  return `Shown to ${names.length ? names.join(', ') : `${h.to.length} player${h.to.length === 1 ? '' : 's'}`}`;
}

/** A handout to read: the picture, then the words. */
function Reader(props: { h: Handout }) {
  const { h } = props;
  return (
    <div class="handout-read">
      {h.img && (
        <a href={h.img} target="_blank" rel="noreferrer" title="Open the picture full size">
          <img class="handout-img" src={h.img} alt={h.title} />
        </a>
      )}
      {h.text && <p class="handout-text">{h.text}</p>}
      {!h.img && !h.text && <p class="muted">This handout is empty.</p>}
    </div>
  );
}

/**
 * Handouts. The DM makes them, shows them to everyone or to some players, and takes them back. A player sees only what is being
 * shown to them, and a handout opens on their screen the moment the DM shows it.
 */
export function HandoutsModal(props: { client: TableClient; openId?: string | null; onClose: () => void }) {
  const { client } = props;
  useClient(client);
  const [view, setView] = useState<View>(props.openId ? { v: 'read', id: props.openId } : { v: 'list' });
  const list = client.handoutList();
  const dm = client.isDM;
  const players = [...client.players.values()].filter((p) => !p.dm);

  // ---- the form for making or changing one
  const editing = view.v === 'edit' ? (view.id ? client.handouts.get(view.id) ?? null : null) : null;
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const openEdit = (id: string | null) => {
    const cur = id ? client.handouts.get(id) : null;
    setTitle(cur?.title ?? '');
    setText(cur?.text ?? '');
    setImg(cur?.img ?? null);
    setView({ v: 'edit', id });
  };
  // ---- who to show it to
  const [who, setWho] = useState<Set<string> | null>(null); // null = everyone

  const back = () => setView({ v: 'list' });

  async function pick(f: File) {
    setBusy(true);
    try { const up = await uploadImage(client, f, 'map', f.name); setImg(up.url); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function save() {
    if (view.v !== 'edit') return;
    setBusy(true);
    try {
      await client.saveHandout({ id: view.id ?? undefined, title, text, img });
      back();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  // ---------------------------------------------------------------- reading one
  if (view.v === 'read') {
    const h = client.handouts.get(view.id);
    return (
      <Modal title={h?.title || 'Handout'} onClose={props.onClose} width={640}
        footer={<>
          {(dm || list.length > 1) && <button class="btn" onClick={back}>All handouts</button>}
          <button class="btn primary" onClick={props.onClose}>Close</button>
        </>}>
        {h ? <Reader h={h} /> : <p class="muted">This handout is no longer being shown.</p>}
      </Modal>
    );
  }

  // ---------------------------------------------------------------- making or changing one
  if (view.v === 'edit') {
    return (
      <Modal title={editing ? 'Change handout' : 'New handout'} onClose={props.onClose} width={640}
        footer={<>
          <button class="btn" onClick={back}>Cancel</button>
          <button class="btn primary" disabled={busy || (!title.trim() && !text.trim() && !img)} onClick={() => void save()}>{busy ? 'Working…' : 'Save'}</button>
        </>}>
        <Field label="Title">
          <input type="text" value={title} maxLength={120} placeholder="A letter from the baron" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Words" hint="Optional. Line breaks are kept.">
          <textarea rows={7} value={text} placeholder="What the players read" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        </Field>
        <Field label="Picture" hint="Optional: a map fragment, a portrait, a note you scanned.">
          <div class="row wrap" style={{ marginBottom: 0 }}>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void pick(f); (e.target as HTMLInputElement).value = ''; }} />
            <button class="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>{img ? 'Replace picture…' : 'Add picture…'}</button>
            {img && <button class="btn small" disabled={busy} onClick={() => setImg(null)}>Remove picture</button>}
          </div>
          {img && <img class="handout-img small" src={img} alt="" />}
        </Field>
      </Modal>
    );
  }

  // ---------------------------------------------------------------- choosing who sees it
  if (view.v === 'show') {
    const h = client.handouts.get(view.id);
    const chosen = who ?? new Set<string>();
    return (
      <Modal title={`Show: ${h?.title ?? 'handout'}`} onClose={props.onClose} width={480}
        footer={<>
          <button class="btn" onClick={back}>Cancel</button>
          <button class="btn primary" disabled={!h || (who !== null && !who.size)}
            onClick={async () => {
              await client.showHandout(view.id, who ? [...who] : null);
              toast(who ? `Shown to ${who.size} player${who.size === 1 ? '' : 's'}` : 'Shown to everyone', 'ok', 2200);
              back();
            }}>Show it</button>
        </>}>
        <div class="seg" style={{ marginBottom: '10px' }}>
          <button class={who === null ? 'on' : ''} onClick={() => setWho(null)}>Everyone</button>
          <button class={who !== null ? 'on' : ''} onClick={() => setWho(new Set(players.map((p) => p.uid).slice(0, 1)))}>Some players</button>
        </div>
        {who !== null && (
          players.length
            ? players.map((p) => (
              <label key={p.uid} class="toggle">
                <input type="checkbox" checked={chosen.has(p.uid)}
                  onChange={(e) => { const next = new Set(chosen); if ((e.target as HTMLInputElement).checked) next.add(p.uid); else next.delete(p.uid); setWho(next); }} />
                <span class="toggle-text">{p.name}{p.online ? '' : ' (away)'}</span>
              </label>
            ))
            : <p class="muted">No players have joined yet.</p>
        )}
        <p class="hint">It opens on their screens right away. They can open it again from the Handouts button until you hide it.</p>
      </Modal>
    );
  }

  // ---------------------------------------------------------------- the list
  return (
    <Modal title="Handouts" onClose={props.onClose} width={600}
      footer={<>
        {dm && <button class="btn primary" onClick={() => openEdit(null)}>+ New handout</button>}
        <button class="btn" onClick={props.onClose}>Close</button>
      </>}>
      {!list.length && <p class="muted">{dm ? 'Nothing yet. A handout is a picture and/or some words you can put in front of your players, such as a letter, a map fragment or a clue.' : 'Nothing has been shown to you yet.'}</p>}
      {list.map((h) => (
        <div key={h.id} class="handout-row">
          <div class="handout-row-main" onClick={() => setView({ v: 'read', id: h.id })} title="Read it">
            {h.img ? <img class="handout-thumb" src={h.img} alt="" /> : <span class="handout-thumb text">✉</span>}
            <div>
              <div class="handout-title">{h.title || 'Handout'}</div>
              {dm && <div class={`muted handout-state ${h.shown ? 'on' : ''}`}>{shownTo(client, h)}</div>}
            </div>
          </div>
          {dm && (
            <div class="handout-actions">
              {h.shown
                ? <button class="btn small" onClick={() => void client.hideHandout(h.id)}>Hide</button>
                : null}
              <button class="btn small primary" onClick={() => { setWho(null); setView({ v: 'show', id: h.id }); }}>{h.shown ? 'Show again…' : 'Show…'}</button>
              <button class="btn small" onClick={() => openEdit(h.id)}>Edit</button>
              <DeleteButton onDelete={() => void client.removeHandout(h.id)} />
            </div>
          )}
        </div>
      ))}
    </Modal>
  );
}

/** A delete button that asks "Sure?" first, without a pop-up. */
function DeleteButton(props: { onDelete: () => void }) {
  const [sure, setSure] = useState(false);
  return sure
    ? <button class="btn small danger" onClick={props.onDelete} onBlur={() => setSure(false)} autoFocus>Sure?</button>
    : <button class="btn small" title="Delete this handout" onClick={() => setSure(true)}>Delete</button>;
}
