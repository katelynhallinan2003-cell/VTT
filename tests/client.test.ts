import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock';
import { createTable } from '../src/state/account';
import { TableClient } from '../src/state/client';
import { P } from '../src/state/paths';
import type { AuthUser } from '../src/types';

const user = (uid: string, anonymous = false): AuthUser => ({ uid, name: uid, email: anonymous ? null : `${uid}@x.com`, photo: null, anonymous });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, what = 'condition', ms = 1500) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

async function setup() {
  const channel = 'test-' + Math.random().toString(36).slice(2);
  const dmB = new MockBackend({ persist: false, channel });
  const plB = new MockBackend({ persist: false, channel });
  dmB.forceUser(user('dm'));
  plB.forceUser(user('p1', true));
  const tid = await createTable(dmB, user('dm'), 'Test');
  const dm = new TableClient(dmB, tid, 'dm', 'dm');
  dm.start();
  await waitFor(() => dm.metaLoaded, 'table meta');
  const sid = await dm.createScene({ name: 'Cave', mapUrl: 'x.png', mapW: 1000, mapH: 800 });
  await waitFor(() => !!dm.scene?.meta, 'scene meta');
  const pl = new TableClient(plB, tid, 'p1', 'player');
  pl.start();
  await waitFor(() => pl.scene?.id === sid && !!pl.scene.meta, 'player scene');
  await pl.joinAsPlayer('Aria', '#ff0000');
  return { dm, pl, dmB, plB, tid, sid };
}

describe('TableClient over the mock backend', () => {
  it('creates a table whose first scene becomes live, and players follow it', async () => {
    const { dm, pl, sid } = await setup();
    expect(dm.activeSceneId).toBe(sid);
    expect(pl.scene?.meta?.name).toBe('Cave');
    expect(pl.scene?.meta?.grid.cell).toBe(70);
    expect(dm.sceneIndex.map((s) => s.name)).toEqual(['Cave']);
  });

  it('syncs tokens both ways', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addToken({ x: 35, y: 35, name: 'Goblin', size: 1 });
    await waitFor(() => !!pl.scene?.tokens.get(id), 'token on player');
    await pl.moveTokens([{ id, x: 105.04, y: 35 }]);
    await waitFor(() => dm.scene?.tokens.get(id)?.x === 105, 'moved token on DM');
    expect(dm.scene!.tokens.get(id)!.name).toBe('Goblin');
  });

  it('keeps hidden tokens in the DM-only subtree', async () => {
    const { dm, pl, dmB, tid, sid } = await setup();
    const id = await dm.addToken({ x: 70, y: 70, name: 'Ambusher', hidden: true });
    await waitFor(() => dm.scene?.tokens.get(id)?.hidden === true, 'hidden token');
    expect(dmB.dump().tables[tid].dm.scenes[sid].tokens[id]).toBeTruthy();
    expect(dmB.dump().tables[tid].scenes[sid].tokens?.[id]).toBeUndefined();
    await sleep(60);
    expect(pl.scene?.tokens.has(id)).toBe(false);

    await dm.updateToken(id, { hidden: false });
    await waitFor(() => pl.scene?.tokens.has(id) === true, 'revealed token on player');
    expect(dm.scene!.tokens.get(id)!.hidden).toBe(false);
    expect(dmB.dump().tables[tid].dm?.scenes?.[sid]?.tokens?.[id]).toBeUndefined();

    await dm.updateToken(id, { hidden: true });
    await waitFor(() => pl.scene?.tokens.has(id) === false, 'token hidden again');
    expect(dm.scene!.tokens.get(id)!.hidden).toBe(true);
  });

  it('forces player-created tokens to be owned by the player', async () => {
    const { dm, pl } = await setup();
    const id = await pl.addToken({ x: 0, y: 0, name: 'Mine', ownerUid: 'someone-else', hidden: true });
    await waitFor(() => !!dm.scene?.tokens.get(id), 'player token on DM');
    expect(dm.scene!.tokens.get(id)!.ownerUid).toBe('p1');
    expect(dm.scene!.tokens.get(id)!.hidden).toBe(false);
  });

  it('claims and releases tokens', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addToken({ x: 0, y: 0, name: 'Fighter' });
    await waitFor(() => !!pl.scene?.tokens.get(id), 'token');
    expect(pl.canDo('claim', pl.scene!.tokens.get(id))).toBe(true);
    await pl.updateToken(id, { ownerUid: 'p1' });
    await waitFor(() => dm.scene?.tokens.get(id)?.ownerUid === 'p1', 'claim');
    expect(pl.myTokens().map((t) => t.id)).toEqual([id]);
    await pl.updateToken(id, { ownerUid: null });
    await waitFor(() => dm.scene?.tokens.get(id)?.ownerUid === null, 'release');
  });

  it('applies the permission toggles through canDo', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addToken({ x: 0, y: 0, name: 'Boss' });
    await waitFor(() => !!pl.scene?.tokens.get(id), 'token');
    const tok = () => pl.scene!.tokens.get(id)!;
    expect(pl.canDo('move', tok())).toBe(true);
    await dm.setPermissions({ playersMoveAnyToken: false, playersCreateTokens: false, playersDeleteAnyToken: false, playersPing: true, playersDraw: false, playersMeasure: true });
    await waitFor(() => pl.settings.perm.playersMoveAnyToken === false, 'perm sync');
    expect(pl.settings.preset).toBe('strict');
    expect(pl.canDo('move', tok())).toBe(false);
    expect(pl.canDo('create')).toBe(false);
  });

  it('syncs fog operations in order and supports undo and reset', async () => {
    const { dm, pl } = await setup();
    await dm.resetFog('hidden');
    await dm.addFogOp({ m: 'r', t: 'rect', p: '0,0,100,100' });
    await dm.addFogOp({ m: 'h', t: 'rect', p: '10,10,20,20' });
    await waitFor(() => pl.scene?.fogOps.size === 2, 'fog ops');
    expect(pl.fogOpsSorted().map(([, o]) => o.m)).toEqual(['r', 'h']);
    expect(pl.scene!.meta!.fog).toEqual({ enabled: true, base: 'hidden' });
    await dm.undoFog();
    await waitFor(() => pl.scene?.fogOps.size === 1, 'undo');
    await dm.resetFog('clear');
    await waitFor(() => pl.scene?.fogOps.size === 0 && pl.scene?.meta?.fog.base === 'clear', 'reset');
  });

  it('flattens nested scene patches', async () => {
    const { dm, pl } = await setup();
    await dm.updateScene({ grid: { cell: 64.5, ox: 3 }, name: 'Renamed' });
    await waitFor(() => pl.scene?.meta?.grid.cell === 64.5, 'grid patch');
    expect(pl.scene!.meta!.grid.ox).toBe(3);
    expect(pl.scene!.meta!.grid.visible).toBe(true);
    expect(dm.sceneIndex[0].name).toBe('Renamed');
  });

  it('lets the DM prepare a private scene while players stay put', async () => {
    const { dm, pl, sid } = await setup();
    const s2 = await dm.createScene({ name: 'Prep' });
    await waitFor(() => dm.viewSceneId === s2, 'DM views new scene');
    await sleep(60);
    expect(pl.viewSceneId).toBe(sid);
    await dm.setActiveScene(s2);
    await waitFor(() => pl.viewSceneId === s2, 'player follows');
    expect(pl.scene?.meta?.name).toBe('Prep');
  });

  it('deleting the live scene hands over to another one', async () => {
    const { dm, sid } = await setup();
    const s2 = await dm.createScene({ name: 'Other' });
    await dm.deleteScene(sid);
    await waitFor(() => dm.activeSceneId === s2, 'new active scene');
    expect(dm.sceneIndex.map((s) => s.id)).toEqual([s2]);
  });

  it('delivers fresh pings once and ignores stale ones', async () => {
    const { dm, pl, dmB, tid, sid } = await setup();
    const got: string[] = [];
    pl.onPing((p) => got.push(`${p.name}@${p.x},${p.y}`));
    await dm.ping(10, 20);
    await waitFor(() => got.length === 1, 'ping');
    expect(got[0]).toBe('DM@10,20');
    await dmB.set(`${P.scenePings(tid, sid)}/stale`, { x: 1, y: 1, uid: 'dm', color: '#fff', name: 'old', t: Date.now() - 60_000 });
    await sleep(80);
    expect(got).toHaveLength(1);
  });

  it('duplicates tokens with incrementing names', async () => {
    const { dm } = await setup();
    const a = await dm.addToken({ x: 0, y: 0, name: 'Goblin 1' });
    await waitFor(() => !!dm.scene?.tokens.get(a), 'token');
    const [b] = await dm.duplicateTokens([a], 70);
    await waitFor(() => !!dm.scene?.tokens.get(b), 'copy');
    expect(dm.scene!.tokens.get(b)!.name).toBe('Goblin 2');
    expect(dm.scene!.tokens.get(b)!.x).toBe(70);
  });
});
