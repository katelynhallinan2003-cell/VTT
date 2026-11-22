import type { Backend } from '../backend/types';
import { SERVER_TS } from '../backend/types';
import { emailKey, randomId } from '../core/ids';
import { normalizeLibraryItem } from '../core/model';
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

export async function removeLibraryItem(backend: Backend, uid: string, kind: LibraryKind, id: string) {
  await backend.remove(`${P.userLibrary(uid, kind)}/${id}`);
}

export async function getSavedUploadKey(backend: Backend, uid: string): Promise<string | null> {
  const v = await backend.get(P.userSetting(uid, 'imgbbKey'));
  return typeof v === 'string' && v ? v : null;
}
