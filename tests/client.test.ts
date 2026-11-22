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
    await dm.setPermissions({ playersMoveAnyToken: false, playersCreateTokens: false, playersDeleteAnyToken: false, playersPing: true, playersDraw: false, playersTemplates: true, playersMeasure: true });
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
    expect(pl.scene!.meta!.fog).toEqual({ enabled: true, base: 'hidden', vision: false, explore: false, dim: true });
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

  it('gives the DM a default name that can be changed, and pings use it', async () => {
    const { dm, pl } = await setup();
    await waitFor(() => !!dm.me, 'DM record');
    expect(dm.me!.name).toBe('DM');
    expect(dm.me!.dm).toBe(true);
    await dm.updatePlayer({ name: 'Narrator', color: '#123456' });
    await waitFor(() => pl.players.get('dm')?.name === 'Narrator', 'DM rename on player');
    const seen: string[] = [];
    pl.onPing((p) => seen.push(p.name));
    await dm.ping(10, 10);
    await waitFor(() => seen.length > 0, 'ping');
    expect(seen[0]).toBe('Narrator');
  });

  it('lets the DM remove a player and frees their tokens', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addToken({ x: 70, y: 70, name: 'Aria', ownerUid: 'p1' });
    await waitFor(() => dm.scene?.tokens.get(id)?.ownerUid === 'p1', 'owned token');
    await waitFor(() => dm.players.has('p1'), 'player listed');
    await dm.removePlayer('p1');
    await waitFor(() => !dm.players.has('p1'), 'player removed');
    await waitFor(() => dm.scene?.tokens.get(id)?.ownerUid === null, 'token unclaimed');
    // a player can rejoin with the same link
    await pl.joinAsPlayer('Aria again', '#00ff00');
    await waitFor(() => dm.players.get('p1')?.name === 'Aria again', 'rejoined');
  });

  it('undoes and redoes a token move, a delete and a rename', async () => {
    const { dm } = await setup();
    const id = await dm.addToken({ x: 35, y: 35, name: 'Orc', size: 1 }, { record: false });
    await waitFor(() => !!dm.scene?.tokens.get(id), 'token');
    const before = [{ id, x: 35, y: 35 }];
    await dm.moveTokens([{ id, x: 245, y: 105 }], before);
    await waitFor(() => dm.scene?.tokens.get(id)?.x === 245, 'moved');
    expect(dm.history.canUndo).toBe(true);
    await dm.history.undo();
    await waitFor(() => dm.scene?.tokens.get(id)?.x === 35, 'move undone');
    await dm.history.redo();
    await waitFor(() => dm.scene?.tokens.get(id)?.x === 245, 'move redone');

    await dm.updateTokens([id], { name: 'Big Orc' });
    await waitFor(() => dm.scene?.tokens.get(id)?.name === 'Big Orc', 'renamed');
    await dm.history.undo();
    await waitFor(() => dm.scene?.tokens.get(id)?.name === 'Orc', 'rename undone');

    await dm.removeTokens([id]);
    await waitFor(() => !dm.scene?.tokens.get(id), 'deleted');
    await dm.history.undo();
    await waitFor(() => dm.scene?.tokens.get(id)?.name === 'Orc', 'delete undone');
  });

  it('collapses a burst of the same edit into one undo step', async () => {
    const { dm } = await setup();
    const id = await dm.addToken({ x: 35, y: 35, name: 'Slider', size: 1 }, { record: false });
    await waitFor(() => !!dm.scene?.tokens.get(id), 'token');
    for (const w of [0.02, 0.04, 0.06, 0.08]) await dm.updateTokens([id], { ringW: w });
    await waitFor(() => dm.scene?.tokens.get(id)?.ringW === 0.08, 'ring set');
    await dm.history.undo();
    await waitFor(() => dm.scene?.tokens.get(id)?.ringW === 0.06 || dm.scene?.tokens.get(id)?.ringW !== 0.08, 'ring undone');
    expect(dm.scene!.tokens.get(id)!.ringW).not.toBe(0.08);
    expect(dm.history.canUndo).toBe(false);
  });

  it('undoes map movement and clears history when the scene changes', async () => {
    const { dm, sid } = await setup();
    const x0 = dm.scene!.meta!.mapX;
    await dm.updateScene({ mapX: x0 + 120 });
    await waitFor(() => dm.scene?.meta?.mapX === x0 + 120, 'map moved');
    await dm.history.undo();
    await waitFor(() => dm.scene?.meta?.mapX === x0, 'map move undone');
    await dm.updateScene({ mapX: x0 + 5 });
    expect(dm.history.canUndo).toBe(true);
    await dm.openScene(sid);
    expect(dm.history.canUndo).toBe(false);
  });

  it('copies and pastes tokens at a new spot, leaving the originals alone', async () => {
    const { dm } = await setup();
    const a = await dm.addToken({ x: 35, y: 35, name: 'Wolf', size: 1 }, { record: false });
    const b = await dm.addToken({ x: 105, y: 35, name: 'Wolf', size: 1 }, { record: false });
    await waitFor(() => !!dm.scene?.tokens.get(a) && !!dm.scene?.tokens.get(b), 'tokens');
    expect(dm.copyTokens([a, b])).toBe(2);
    expect(dm.clipboardCount).toBe(2);
    const ids = await dm.pasteTokens({ x: 600, y: 500 });
    expect(ids).toHaveLength(2);
    await waitFor(() => ids.every((i) => !!dm.scene?.tokens.get(i)), 'pasted');
    expect(dm.scene!.tokens.size).toBe(4);
    expect(dm.scene!.tokens.get(a)!.x).toBe(35);
    const xs = ids.map((i) => dm.scene!.tokens.get(i)!.x).sort((p, q) => p - q);
    expect(xs[1] - xs[0]).toBeCloseTo(70, 0); // kept their spacing
    await dm.history.undo();
    await waitFor(() => dm.scene!.tokens.size === 2, 'paste undone');
  });

  it('keeps hit points where only the DM can read them, and tells players just a percentage', async () => {
    const { dm, pl, dmB, tid, sid } = await setup();
    const id = await dm.addToken({ x: 35, y: 35, name: 'Ogre', hp: 40, maxHp: 40 });
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 40, 'hp on the DM side');
    await waitFor(() => pl.scene?.tokens.has(id) === true, 'token on the player side');
    const dump = () => dmB.dump().tables[tid];
    expect(dump().dm.scenes[sid].hp[id]).toEqual({ hp: 40, max: 40 });
    expect(JSON.stringify(dump().scenes[sid].tokens[id])).not.toContain('"hp"');
    expect(JSON.stringify(dump().scenes[sid].tokens[id])).not.toContain('maxHp');

    await dm.damage([id], 25);
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 15, 'damage');
    await waitFor(() => pl.scene?.tokens.get(id)?.hpPct === 38, 'players\' percentage');
    expect(pl.scene!.tokens.get(id)!.hp).toBeNull();
    expect(pl.scene!.tokens.get(id)!.hpShow).toBe('state');

    await dm.damage([id], -100); // healing stops at the maximum
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 40, 'healed');
    await dm.damage([id], 999); // and damage at zero
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 0, 'dropped');
    await waitFor(() => pl.scene?.tokens.get(id)?.hpPct === 0, 'down for players');
  });

  it('shows players the real numbers only when asked to, and keeps them current', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addToken({ x: 35, y: 35, name: 'Orc', hp: 30, maxHp: 30, hpShow: 'bar' });
    await waitFor(() => pl.scene?.tokens.has(id) === true, 'token');
    expect(pl.scene!.tokens.get(id)!.hpNow).toBeNull();
    await dm.updateToken(id, { hpShow: 'numbers' });
    await waitFor(() => pl.scene?.tokens.get(id)?.hpNow === 30, 'numbers appear');
    expect(pl.scene!.tokens.get(id)!.hpCap).toBe(30);
    await dm.damage([id], 12);
    await waitFor(() => pl.scene?.tokens.get(id)?.hpNow === 18, 'numbers follow damage');
    expect(pl.scene!.tokens.get(id)!.hpPct).toBe(60);
    await dm.updateToken(id, { hpShow: 'bar' });
    await waitFor(() => pl.scene?.tokens.get(id)?.hpNow === null, 'numbers go away again');
    expect(pl.scene!.tokens.get(id)!.hpCap).toBeNull();
  });

  it('can hide health from players entirely, and undoes damage', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addToken({ x: 35, y: 35, name: 'Boss', hp: 100, maxHp: 100, hpShow: 'off' });
    await waitFor(() => pl.scene?.tokens.has(id) === true, 'token');
    expect(pl.scene!.tokens.get(id)!.hpPct).toBeNull();
    await dm.damage([id], 60);
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 40, 'damage');
    await sleep(40);
    expect(pl.scene!.tokens.get(id)!.hpPct).toBeNull();

    await dm.updateToken(id, { hpShow: 'bar' });
    await waitFor(() => pl.scene?.tokens.get(id)?.hpPct === 40, 'now shown');
    await dm.updateToken(id, { hpShow: 'off' });
    await waitFor(() => pl.scene?.tokens.get(id)?.hpPct === null, 'hidden again');

    await dm.history.undo(); // undo the last edit that was recorded: the damage
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 100, 'damage undone');

    // two hits in quick succession undo one at a time
    await dm.damage([id], 10);
    await dm.damage([id], 20);
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 70, 'two hits');
    await dm.history.undo();
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 90, 'second hit undone');
    await dm.history.undo();
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 100, 'first hit undone');
  });

  it('ignores hit points set by a player', async () => {
    const { pl } = await setup();
    const id = await pl.addToken({ x: 35, y: 35, name: 'Aria', hp: 99, maxHp: 99 });
    await waitFor(() => pl.scene?.tokens.has(id) === true, 'token');
    expect(pl.scene!.tokens.get(id)!.hp).toBeNull();
    expect(pl.scene!.tokens.get(id)!.hpPct).toBeNull();
  });

  it('copies hit points to pasted tokens and cleans up when a token is deleted and restored', async () => {
    const { dm, dmB, tid, sid } = await setup();
    const id = await dm.addToken({ x: 35, y: 35, name: 'Wolf', hp: 11, maxHp: 11 }, { record: false });
    await waitFor(() => dm.scene?.tokens.get(id)?.hp === 11, 'wolf');
    dm.copyTokens([id]);
    const [copy] = await dm.pasteTokens({ x: 400, y: 400 });
    await waitFor(() => dm.scene?.tokens.get(copy)?.hp === 11, 'copy has hp');
    await dm.removeTokens([copy]);
    await waitFor(() => !dm.scene?.tokens.has(copy), 'deleted');
    expect(dmB.dump().tables[tid].dm.scenes[sid].hp[copy]).toBeUndefined();
    await dm.history.undo();
    await waitFor(() => dm.scene?.tokens.get(copy)?.hp === 11, 'restored with hp');
  });

  it('runs an initiative order: roll, sort, reveal, hide a line, step through turns', async () => {
    const { dm, pl, dmB, tid, sid } = await setup();
    const a = await dm.addToken({ x: 35, y: 35, name: 'Aria' }, { record: false });
    const g = await dm.addToken({ x: 105, y: 35, name: 'Goblin' }, { record: false });
    const sneak = await dm.addToken({ x: 175, y: 35, name: 'Assassin', hidden: true }, { record: false });
    await waitFor(() => dm.scene!.tokens.size === 3, 'tokens');

    await dm.initApply([{ tk: a, n: 'Aria', i: 12 }, { tk: g, n: 'Goblin', i: 17 }, { tk: sneak, n: 'Assassin', i: 21, h: true }]);
    await waitFor(() => dm.scene!.init.entries.length === 3, 'entries');
    const names = () => dm.scene!.init.entries.map((x) => x.n);
    expect(names()).toEqual(['Assassin', 'Goblin', 'Aria']);
    expect(dm.scene!.init.round).toBe(1);
    expect(dm.scene!.init.turn).toBe(dm.scene!.init.entries[0].id);

    // players know nothing until the DM reveals the order
    await sleep(40);
    expect(pl.scene!.initPub).toBeNull();
    expect(dmB.dump().tables[tid].scenes[sid].initPub).toBeUndefined();

    await dm.initShow(true);
    await waitFor(() => pl.scene?.initPub?.entries.length === 2, 'players see the order');
    expect(pl.scene!.initPub!.entries.map((x) => x.n)).toEqual(['Goblin', 'Aria']);
    expect(JSON.stringify(dmB.dump().tables[tid].scenes[sid].initPub)).not.toContain('Assassin');
    expect(pl.scene!.initPub!.turn).toBeNull(); // the assassin is acting, which players must not learn

    await dm.initStep(1);
    await waitFor(() => pl.scene?.initPub?.turn === dm.scene!.init.entries[1].id, 'turn moves');
    await dm.initStep(1);
    await dm.initStep(1);
    await waitFor(() => dm.scene!.init.round === 2, 'new round');
    await waitFor(() => pl.scene?.initPub?.round === 2, 'players see the round');

    // revealing a hidden token makes its line public without touching the order
    await dm.updateToken(sneak, { hidden: false });
    await dm.initEdit(dm.scene!.init.entries[0].id, { h: false });
    await waitFor(() => pl.scene?.initPub?.entries.length === 3, 'now visible');

    // changing a number re-sorts; dragging overrides the sort
    const ariaEntry = dm.scene!.init.entries.find((x) => x.tk === a)!;
    await dm.initEdit(ariaEntry.id, { i: 30 });
    await waitFor(() => names()[0] === 'Aria', 'resorted');
    await dm.initMove(ariaEntry.id, null);
    await waitFor(() => names()[2] === 'Aria', 'moved to the end');

    // removing the line whose turn it is passes the turn on
    const turnId = dm.scene!.init.turn!;
    await dm.initRemove(turnId);
    await waitFor(() => dm.scene!.init.entries.length === 2 && dm.scene!.init.turn !== turnId && dm.scene!.init.turn !== null, 'turn passed on');

    await dm.initShow(false);
    await waitFor(() => pl.scene?.initPub === null, 'hidden again');
    await dm.initEnd();
    await waitFor(() => dm.scene!.init.entries.length === 0 && dm.scene!.init.round === 0, 'combat ended');
    expect(dmB.dump().tables[tid].dm?.scenes?.[sid]?.init).toBeUndefined();
  });

  it('keeps the players\' copy of the order in step when a token is renamed or hidden', async () => {
    const { dm, pl } = await setup();
    const a = await dm.addToken({ x: 35, y: 35, name: 'Aria' }, { record: false });
    const b = await dm.addToken({ x: 105, y: 35, name: 'Bram' }, { record: false });
    await waitFor(() => dm.scene!.tokens.size === 2, 'tokens');
    await dm.initApply([{ tk: a, n: 'Aria', i: 15 }, { tk: b, n: 'Bram', i: 10 }]);
    await dm.initShow(true);
    await waitFor(() => pl.scene?.initPub?.entries.length === 2, 'shown');
    await dm.updateToken(a, { name: 'Aria the Bold' });
    await waitFor(() => pl.scene?.initPub?.entries[0].n === 'Aria the Bold', 'renamed');
    await dm.updateToken(b, { hidden: true });
    await waitFor(() => pl.scene?.initPub?.entries.length === 1, 'hidden token leaves the list');
  });

  it('reveals ground as sighted tokens move, and only when told to', async () => {
    const { dm, sid } = await setup();
    const id = await dm.addToken({ x: 350, y: 350, name: 'Scout', size: 1, sight: 30 }, { record: false });
    await waitFor(() => !!dm.scene?.tokens.get(id), 'token');
    await dm.resetFog('hidden');
    await waitFor(() => dm.scene?.meta?.fog.enabled === true, 'fog on');
    expect(await dm.exploreNow()).toBe(0); // switched off

    await dm.updateScene({ fog: { vision: true, explore: true } });
    await waitFor(() => dm.scene?.meta?.fog.explore === true, 'explore on');
    expect(await dm.exploreNow()).toBe(1); // where it stands
    await waitFor(() => dm.scene!.fogOps.size === 1, 'first reveal');
    const first = [...dm.scene!.fogOps.values()][0];
    expect(first).toMatchObject({ m: 'x', t: 'line' }); // remembered, shown grey when out of sight (the default)
    expect((first as any).w).toBe(2 * (6 * 70 + 35)); // 30 ft is 6 squares, plus the token's own radius

    expect(await dm.exploreNow()).toBe(0); // no movement, nothing new
    await dm.moveTokens([{ id, x: 350 + 70 * 4, y: 350 }]);
    expect(await dm.exploreNow()).toBe(1);
    await waitFor(() => dm.scene!.fogOps.size === 2, 'trail');
    const trail = [...dm.scene!.fogOps.values()][1] as any;
    expect(trail.p.split(',').length).toBe(4); // a path from the old spot to the new one

    await dm.moveTokens([{ id, x: 350 + 70 * 40, y: 350 }]);
    expect(await dm.exploreNow()).toBe(1);
    await waitFor(() => dm.scene!.fogOps.size === 3, 'jump');
    expect(([...dm.scene!.fogOps.values()][2] as any).p.split(',').length).toBe(2); // a long jump only reveals where it landed

    const hid = await dm.addToken({ x: 100, y: 100, name: 'Hidden scout', sight: 60, hidden: true }, { record: false });
    await waitFor(() => !!dm.scene?.tokens.get(hid), 'hidden token');
    expect(await dm.exploreNow()).toBe(0); // hidden tokens never reveal anything for players
    void sid;
  });

  it('writes plain reveals instead when remembered ground is not to be greyed', async () => {
    const { dm } = await setup();
    const id = await dm.addToken({ x: 350, y: 350, name: 'Scout', size: 1, sight: 30 }, { record: false });
    await waitFor(() => !!dm.scene?.tokens.get(id), 'token');
    await dm.resetFog('hidden');
    await dm.updateScene({ fog: { vision: true, explore: true, dim: false } });
    await waitFor(() => dm.scene?.meta?.fog.dim === false, 'dim off');
    expect(await dm.exploreNow()).toBe(1);
    await waitFor(() => dm.scene!.fogOps.size === 1, 'reveal');
    expect([...dm.scene!.fogOps.values()][0]).toMatchObject({ m: 'r', t: 'line' });
  });
});

describe('initiative and light sources', () => {
  it('never puts a torch in the order, and drops one that is already there', async () => {
    const { dm } = await setup();
    const hero = await dm.addToken({ x: 35, y: 35, name: 'Aria' }, { record: false });
    const torch = await dm.addToken({ x: 105, y: 35, name: 'Torch', shape: 'none', light: { b: 20, d: 20, c: '#ffc27a' } } as any, { record: false });
    await waitFor(() => dm.scene!.tokens.size === 2, 'tokens');
    await dm.initApply([{ tk: hero, n: 'Aria', i: 12 }, { tk: torch, n: 'Torch', i: 30 }]);
    await waitFor(() => dm.scene!.init.entries.length >= 1, 'entries');
    await sleep(30);
    expect(dm.scene!.init.entries.map((x) => x.n)).toEqual(['Aria']);

    // a creature that turns into a light-only mark later is taken out on the next change
    await dm.initApply([{ tk: null, n: 'Goblin', i: 8 }]);
    await waitFor(() => dm.scene!.init.entries.length === 2, 'goblin');
    await dm.updateToken(hero, { shape: 'none', light: { b: 5, d: 5, c: '#ffffff' } } as any);
    await sleep(30);
    await dm.initStep(1);
    await waitFor(() => dm.scene!.init.entries.length === 1, 'the light is dropped when the turn moves');
    expect(dm.scene!.init.entries[0].n).toBe('Goblin');
  });
});
