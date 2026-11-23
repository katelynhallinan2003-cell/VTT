import type { Backend } from '../backend/types';
import { SERVER_TS } from '../backend/types';
import { emailKey, randomId } from '../core/ids';
import { normalizeLibraryItem } from '../core/model';
import { imgbbDeleteUrl } from '../core/imgbb';
import { cleanSavedName, normalizeSavedToken, type SavedToken } from '../core/tokenlib';
import { PRESETS } from '../core/permissions';
import type { AuthUser, LibraryItem, LibraryKind, UserTableEntry } from '../types';
import { P } from './paths';

/** Is this Google account on the DM allowlist? (Edited in the Firebase console, see docs/SETUP.md.) */
export async function isAllowedDM(backend: Backend, user: AuthUser): Promise<boolean> {
  if (backend.kind === 'mock') return true;
  if (!user.email) return false;
  try {
    return (await backend.get(P.allowedEmail(emailKey(user.email)))) === true;
  } catch {
    return false;
  }
}

export function watchUserTables(backend: Backend, uid: string, cb: (tables: UserTableEntry[]) => void) {
  return backend.listen(P.userTables(uid), (v) => {
    const list: UserTableEntry[] = Object.entries<any>(v ?? {}).map(([id, t]) => ({
      id, name: typeof t?.name === 'string' ? t.name : 'Table', createdAt: Number(t?.createdAt) || 0,
    }));
    cb(list.sort((a, b) => b.createdAt - a.createdAt));
  });
}

export async function createTable(backend: Backend, user: AuthUser, name: string): Promise<string> {
  const tid = randomId(16);
  const uid = user.uid;
  // 1. claim the table (database rules only allow allowlisted Google accounts to do this)
  await backend.set(P.owner(tid), uid);
  // 2. everything else (rules now see us as the owner)
  const key = await backend.get(P.userSetting(uid, 'imgbbKey'));
  await backend.update({
    [P.meta(tid)]: { name, createdAt: SERVER_TS },
    [P.settings(tid)]: { perm: { ...PRESETS.trusting }, preset: 'trusting' },
    [P.userTable(uid, tid)]: { name, createdAt: SERVER_TS },
    ...(typeof key === 'string' && key ? { [P.uploadKey(tid)]: key } : {}),
  });
  return tid;
}

/** Rename a table, both on the table itself (players see it on the join screen) and in the DM's list of tables. */
export async function renameTable(backend: Backend, uid: string, tid: string, name: string): Promise<void> {
  await backend.update({
    [`${P.meta(tid)}/name`]: name,
    [`${P.userTable(uid, tid)}/name`]: name,
  });
}

/**
 * Delete a table: its scenes, players, saved characters, handouts, DM notes and its place in the DM's list.
 * The database rules have no write at the level of `players`, `chars` or `scenes`, only one level down, so each of
 * those is cleared entry by entry. Removing the table's `owner` marker is what makes its link stop working; that needs
 * the rules published with the owner-may-delete line, so if the database refuses it, everything else is still cleared
 * and `linkRemoved` is false (the old link then opens an empty table until the rules are republished and it is deleted again).
 * Pictures uploaded to the picture host are not touched.
 */
export async function deleteTable(backend: Backend, uid: string, tid: string): Promise<{ linkRemoved: boolean }> {
  const keysAt = async (path: string) => Object.keys(((await backend.get(path).catch(() => null)) as Record<string, unknown> | null) ?? {});
  const [players, chars, scenes] = await Promise.all([keysAt(P.players(tid)), keysAt(`${P.table(tid)}/chars`), keysAt(P.sceneIndex(tid))]);
  const wipe: Record<string, null> = {
    [P.meta(tid)]: null,
    [P.settings(tid)]: null,
    [P.handouts(tid)]: null,
    [`${P.table(tid)}/upload`]: null,
    [`${P.table(tid)}/dm`]: null,
    [P.userTable(uid, tid)]: null,
  };
  for (const id of players) wipe[P.player(tid, id)] = null;
  for (const id of chars) wipe[P.tableChars(tid, id)] = null;
  for (const id of scenes) wipe[P.scene(tid, id)] = null;
  try {
    await backend.update({ ...wipe, [P.owner(tid)]: null });
    return { linkRemoved: true };
  } catch {
    await backend.update(wipe);
    return { linkRemoved: false };
  }
}

export async function getTableOwner(backend: Backend, tid: string): Promise<string | null> {
  const v = await backend.get(P.owner(tid));
  return typeof v === 'string' ? v : null;
}

export async function getTableName(backend: Backend, tid: string): Promise<string | null> {
  const v = await backend.get(P.meta(tid) + '/name');
  return typeof v === 'string' ? v : null;
}

export function watchLibrary(backend: Backend, uid: string, kind: LibraryKind, cb: (items: LibraryItem[]) => void) {
  return backend.listen(P.userLibrary(uid, kind), (v) => {
    const items = Object.entries<any>(v ?? {})
      .map(([id, raw]) => normalizeLibraryItem(id, raw))
      .filter((x): x is LibraryItem => !!x)
      .sort((a, b) => b.addedAt - a.addedAt);
    cb(items);
  });
}

export async function addLibraryItem(backend: Backend, uid: string, kind: LibraryKind, item: Omit<LibraryItem, 'id' | 'addedAt'>) {
  const id = backend.newKey();
  const wire: Record<string, unknown> = { name: item.name, url: item.url, addedAt: SERVER_TS };
  if (item.thumb) wire.thumb = item.thumb;
  if (item.preview) wire.preview = item.preview;
  if (item.deleteUrl) wire.deleteUrl = item.deleteUrl;
  if (item.w) wire.w = item.w;
  if (item.h) wire.h = item.h;
  await backend.set(`${P.userLibrary(uid, kind)}/${id}`, wire);
  return id;
}

/** The saved tokens at `path` (the DM's templates under their account, a player's characters under the table), newest first. */
export function watchTokenLib(backend: Backend, path: string, cb: (items: SavedToken[]) => void) {
  return backend.listen(path, (v) => {
    const items = Object.entries<any>(v ?? {})
      .map(([id, raw]) => normalizeSavedToken(id, raw))
      .filter((x): x is SavedToken => !!x)
      .sort((a, b) => b.addedAt - a.addedAt);
    cb(items);
  });
}

/** Saves (or, with an existing `id`, replaces) a saved token. Returns its id. */
export async function saveTokenToLib(backend: Backend, path: string, entry: { name: string; t: Record<string, unknown> }, id?: string, addedAt?: number): Promise<string> {
  const key = id ?? backend.newKey();
  await backend.set(`${path}/${key}`, { name: cleanSavedName(entry.name) || 'Token', t: entry.t, addedAt: addedAt ?? SERVER_TS });
  return key;
}

export async function removeTokenFromLib(backend: Backend, path: string, id: string) {
  await backend.remove(`${path}/${id}`);
}

/**
 * Take a picture out of the library in one write. Its private ImgBB deletion link moves to the cleanup list in the same write,
 * so nothing is lost whatever happens next. Then, if the DM's upload key is known, ImgBB is asked to delete the hosted picture
 * (`deleteHosted`); when it says it did, the cleanup entry is dropped. Returns whether the hosted picture was deleted.
 */
export async function removeLibraryItem(
  backend: Backend, uid: string, kind: LibraryKind, item: LibraryItem,
  deleteHosted?: (deleteUrl: string) => Promise<boolean>,
): Promise<boolean> {
  const updates: Record<string, unknown> = { [`${P.userLibrary(uid, kind)}/${item.id}`]: null };
  const deleteUrl = imgbbDeleteUrl(item.deleteUrl);
  if (deleteUrl) updates[`${P.imageCleanup(uid, kind)}/${item.id}`] = { name: item.name, deleteUrl };
  await backend.update(updates);
  if (!deleteUrl || !deleteHosted) return false;
  let gone = false;
  try { gone = await deleteHosted(deleteUrl); } catch { gone = false; }
  if (gone) await backend.remove(`${P.imageCleanup(uid, kind)}/${item.id}`).catch(() => undefined);
  return gone;
}

export interface ImageCleanupLink { id: string; name: string; deleteUrl: string }

export function watchImageCleanup(backend: Backend, uid: string, kind: LibraryKind, cb: (items: ImageCleanupLink[]) => void) {
  return backend.listen(P.imageCleanup(uid, kind), raw => {
    const links: ImageCleanupLink[] = [];
    for (const [id, item] of Object.entries<any>(raw ?? {})) {
      const deleteUrl = imgbbDeleteUrl(item?.deleteUrl);
      if (deleteUrl) links.push({ id, name: typeof item.name === 'string' ? item.name : 'Picture', deleteUrl });
    }
    cb(links);
  });
}

export async function getSavedUploadKey(backend: Backend, uid: string): Promise<string | null> {
  const v = await backend.get(P.userSetting(uid, 'imgbbKey'));
  return typeof v === 'string' && v ? v : null;
}
