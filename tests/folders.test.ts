import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock';
import { buildCampaign, parseCampaign, planImport } from '../src/core/campaign';
import { cleanFolderName, filterShowing, folderOf, groupScenes, normalizeFolder, resolveFilter, scenesIn, uniqueFolderName } from '../src/core/folders';
import { createTable } from '../src/state/account';
import { TableClient } from '../src/state/client';
import type { AuthUser, SceneFolder, SceneIndexEntry } from '../src/types';

const sc = (id: string, order: number, folder: string | null = null): SceneIndexEntry => ({ id, name: id.toUpperCase(), order, folder });
const fo = (id: string, order: number, name = id): SceneFolder => ({ id, name, order });

describe('folder helpers', () => {
  const folders = [fo('f2', 2, 'Act 2'), fo('f1', 1, 'Act 1')];
  const index = [sc('a', 1, 'f1'), sc('b', 2), sc('c', 3, 'f2'), sc('d', 4, 'f1'), sc('e', 5, 'gone')];

  it('cleans names', () => {
    expect(cleanFolderName('  Act   1 ')).toBe('Act 1');
    expect(cleanFolderName(5)).toBe('');
    expect(cleanFolderName('x'.repeat(100))).toHaveLength(60);
    expect(normalizeFolder('k', { name: ' Waterdeep ', order: '3' })).toEqual({ id: 'k', name: 'Waterdeep', order: 3 });
    expect(normalizeFolder('k', null)).toEqual({ id: 'k', name: 'Folder', order: 0 });
  });
  it('treats a scene whose folder is gone as being in none', () => {
    expect(folderOf(index[0], folders)).toBe('f1');
    expect(folderOf(index[4], folders)).toBeNull();
    expect(folderOf(index[1], folders)).toBeNull();
  });
  it('filters the scene list', () => {
    expect(scenesIn(index, folders, 'all').map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(scenesIn(index, folders, 'f1').map((s) => s.id)).toEqual(['a', 'd']);
    expect(scenesIn(index, folders, 'none').map((s) => s.id)).toEqual(['b', 'e']);
    expect(scenesIn(index, folders, 'missing').map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('falls back to all scenes when the picked folder was deleted', () => {
    expect(resolveFilter('f1', folders)).toBe('f1');
    expect(resolveFilter('zzz', folders)).toBe('all');
    expect(resolveFilter('none', [])).toBe('none');
  });
  it('says which filter shows a scene', () => {
    expect(filterShowing(index[0], folders)).toBe('f1');
    expect(filterShowing(index[1], folders)).toBe('none');
    expect(filterShowing(undefined, folders)).toBe('all');
  });
  it('groups scenes by folder in folder order, then the rest', () => {
    const g = groupScenes(index, folders);
    expect(g.map((x) => x.folder?.id ?? null)).toEqual(['f1', 'f2', null]);
    expect(g[0].scenes.map((s) => s.id)).toEqual(['a', 'd']);
    expect(g[2].scenes.map((s) => s.id)).toEqual(['b', 'e']);
  });
  it('keeps empty folders in the groups', () => {
    expect(groupScenes([], [fo('f1', 1)]).map((x) => x.scenes.length)).toEqual([0, 0]);
  });
  it('finds a free name', () => {
    expect(uniqueFolderName('Act 1', [])).toBe('Act 1');
    expect(uniqueFolderName('act 1', folders)).toBe('act 1 (2)');
    expect(uniqueFolderName('Act 3', folders)).toBe('Act 3');
    expect(uniqueFolderName('Act 1', folders)).toBe('Act 1 (2)');
    expect(uniqueFolderName('  ', folders)).toBe('New folder');
  });
});

const user = (uid: string): AuthUser => ({ uid, name: uid, email: `${uid}@x.com`, photo: null, anonymous: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, what: string, ms = 1500) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(5); }
}
async function setup() {
  const b = new MockBackend({ persist: false, channel: 'fold-' + Math.random().toString(36).slice(2) });
  b.forceUser(user('dm'));
  const tid = await createTable(b, user('dm'), 'T');
  const dm = new TableClient(b, tid, 'dm', 'dm');
  dm.start();
  await waitFor(() => dm.metaLoaded, 'meta');
  return { dm, b, tid };
}

describe('scene folders on the client', () => {
  it('makes, renames, fills and deletes folders', async () => {
    const { dm } = await setup();
    const s1 = await dm.createScene({ name: 'One' });
    const s2 = await dm.createScene({ name: 'Two' });
    await waitFor(() => dm.sceneIndex.length === 2, 'two scenes');
    expect(dm.sceneIndex.every((s) => s.folder === null)).toBe(true);

    const f = await dm.createFolder('Act 1');
    await waitFor(() => dm.sceneFolders.length === 1, 'folder');
    expect(dm.sceneFolders[0]).toMatchObject({ id: f, name: 'Act 1' });
    const g = await dm.createFolder('Act 1');
    await waitFor(() => dm.sceneFolders.length === 2, 'second folder');
    expect(dm.sceneFolders.map((x) => x.name)).toEqual(['Act 1', 'Act 1 (2)']);

    await dm.moveScene(s1, f);
    await dm.moveScene(s2, f);
    await waitFor(() => dm.sceneIndex.every((s) => s.folder === f), 'moved');
    await dm.moveScene(s2, null);
    await waitFor(() => dm.sceneIndex.find((s) => s.id === s2)?.folder === null, 'moved out');
    await dm.moveScene(s2, 'nope'); // not a folder: ignored
    await sleep(30);
    expect(dm.sceneIndex.find((s) => s.id === s2)?.folder).toBeNull();

    await dm.renameFolder(f, '  The   Mine ');
    await waitFor(() => dm.sceneFolders.some((x) => x.name === 'The Mine'), 'rename');
    await dm.renameFolder(f, '   '); // empty: ignored
    await sleep(30);
    expect(dm.sceneFolders.find((x) => x.id === f)?.name).toBe('The Mine');

    await dm.deleteFolder(f);
    await waitFor(() => dm.sceneFolders.length === 1, 'delete');
    await waitFor(() => dm.sceneIndex.every((s) => s.folder === null), 'scenes freed');
    expect(dm.sceneIndex).toHaveLength(2); // the scenes themselves are kept
    expect(dm.sceneFolders[0].id).toBe(g);
  });

  it('a new scene can start in a folder, and a bad folder is ignored', async () => {
    const { dm } = await setup();
    const f = await dm.createFolder('Prep');
    await waitFor(() => dm.sceneFolders.length === 1, 'folder');
    const a = await dm.createScene({ name: 'In', folder: f });
    const b = await dm.createScene({ name: 'Out', folder: 'nope' });
    await waitFor(() => dm.sceneIndex.length === 2, 'scenes');
    expect(dm.sceneIndex.find((s) => s.id === a)?.folder).toBe(f);
    expect(dm.sceneIndex.find((s) => s.id === b)?.folder).toBeNull();
  });

  it('players cannot make folders and cannot read them', async () => {
    const { dm, b, tid } = await setup();
    const f = await dm.createFolder('Secret');
    await waitFor(() => dm.sceneFolders.length === 1, 'folder');
    expect(f).toBeTruthy();
    const pl = new TableClient(b, tid, 'dm', 'player');
    await expect(pl.createFolder('x')).rejects.toThrow();
  });
});

describe('folders in a campaign file', () => {
  const file = () => buildCampaign({
    name: 'C', scenes: [
      { name: 'Crypt', active: true, folder: 'Act 1', pub: { meta: { name: 'Crypt' } }, dm: {} },
      { name: 'Cave', active: false, folder: 'Act 2', pub: { meta: { name: 'Cave' } }, dm: {} },
      { name: 'Camp', active: false, pub: { meta: { name: 'Camp' } }, dm: {} },
    ], handouts: [], now: 1,
  });
  const opts = (over: Record<string, unknown> = {}) => { let n = 0; return { tid: 't', uid: 'u', newKey: () => 'k' + ++n, now: 1, existingNames: [] as string[], orderBase: 0, hasActive: false, ...over }; };

  it('saves and reads back a scene\'s folder name', () => {
    const f = file();
    expect(f.scenes.map((s) => s.folder)).toEqual(['Act 1', 'Act 2', undefined]);
    const back = parseCampaign(JSON.stringify(f));
    expect(back.ok && back.file.scenes.map((s) => s.folder)).toEqual(['Act 1', 'Act 2', undefined]);
  });
  it('makes folders for the names that are new and puts the scenes in them', () => {
    const plan = planImport(file(), opts({ folderOrderBase: 4 }));
    const idx = (sid: string) => plan.updates[`tables/t/dm/sceneIndex/${sid}`];
    const folderWrites = Object.entries(plan.updates).filter(([k]) => k.startsWith('tables/t/dm/sceneFolders/'));
    expect(folderWrites.map(([, v]) => v)).toEqual([{ name: 'Act 1', order: 5 }, { name: 'Act 2', order: 6 }]);
    expect(idx(plan.sceneIds[0]).folder).toBe(folderWrites[0][0].split('/').pop());
    expect(idx(plan.sceneIds[1]).folder).toBe(folderWrites[1][0].split('/').pop());
    expect('folder' in idx(plan.sceneIds[2])).toBe(false);
  });
  it('reuses a folder with the same name instead of making a second one', () => {
    const plan = planImport(file(), opts({ existingFolders: [{ id: 'F9', name: 'act 1' }] }));
    const folderWrites = Object.keys(plan.updates).filter((k) => k.startsWith('tables/t/dm/sceneFolders/'));
    expect(folderWrites).toHaveLength(1); // only Act 2 is new
    expect(plan.updates[`tables/t/dm/sceneIndex/${plan.sceneIds[0]}`].folder).toBe('F9');
  });
});
