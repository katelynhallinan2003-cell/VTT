import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock';
import { createTable, deleteTable, getTableName, getTableOwner, renameTable, watchUserTables } from '../src/state/account';
import { TableClient } from '../src/state/client';
import { P } from '../src/state/paths';
import type { AuthUser, UserTableEntry } from '../src/types';

const user = (uid: string): AuthUser => ({ uid, name: uid, email: `${uid}@x.com`, photo: null, anonymous: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, what: string, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(10); }
}

describe('tables: rename and delete', () => {
  it('renaming changes the name on the table and in the DM list', async () => {
    const b = new MockBackend({ persist: false });
    b.forceUser(user('dm'));
    const tid = await createTable(b, user('dm'), 'Old name');
    let list: UserTableEntry[] = [];
    watchUserTables(b, 'dm', (l) => { list = l; });
    await waitFor(() => list.length === 1, 'the table list');
    await renameTable(b, 'dm', tid, 'Waterdeep');
    expect(await getTableName(b, tid)).toBe('Waterdeep');
    await waitFor(() => list[0]?.name === 'Waterdeep', 'the new name in the list');
  });

  it('deleting clears the table, its scenes, players and its place in the list', async () => {
    const b = new MockBackend({ persist: false });
    b.forceUser(user('dm'));
    const tid = await createTable(b, user('dm'), 'Doomed');
    const dm = new TableClient(b, tid, 'dm', 'dm');
    dm.start();
    await waitFor(() => dm.metaLoaded, 'table meta');
    const sid = await dm.createScene({ name: 'Cave', mapUrl: 'x.png', mapW: 1000, mapH: 800 });
    await waitFor(() => !!dm.scene?.meta, 'scene meta');
    await b.set(P.player(tid, 'p1'), { name: 'Aria' });
    await b.set(P.tableChars(tid, 'p1') + '/c1', { name: 'Aria', t: {} });
    dm.stop();
    expect(await b.get(P.scene(tid, sid))).toBeTruthy();

    const r = await deleteTable(b, 'dm', tid);
    expect(r.linkRemoved).toBe(true);
    expect(await getTableOwner(b, tid)).toBeNull();
    expect(await b.get(P.table(tid))).toBeNull();
    expect(await b.get(P.userTable('dm', tid))).toBeNull();
  });

  it('still clears everything else if the database will not drop the owner marker', async () => {
    const b = new MockBackend({ persist: false });
    b.forceUser(user('dm'));
    const tid = await createTable(b, user('dm'), 'Old rules');
    const real = b.update.bind(b);
    // a database still on the old rules refuses any write that removes `owner`
    b.update = async (u: Record<string, any>) => { if (P.owner(tid) in u) throw new Error('permission_denied'); return real(u); };
    const r = await deleteTable(b, 'dm', tid);
    expect(r.linkRemoved).toBe(false);
    expect(await b.get(P.meta(tid))).toBeNull();
    expect(await b.get(P.userTable('dm', tid))).toBeNull();
    expect(await getTableOwner(b, tid)).toBe('dm');
  });
});
