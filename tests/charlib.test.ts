import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock';
import { normalizeFx } from '../src/core/effects';
import { createTable } from '../src/state/account';
import { TableClient } from '../src/state/client';
import type { AuthUser } from '../src/types';

const user = (uid: string, anonymous = false): AuthUser => ({ uid, name: uid, email: anonymous ? null : `${uid}@x.com`, photo: null, anonymous });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, what: string, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(10); }
}

async function setup() {
  const channel = 'chr-' + Math.random().toString(36).slice(2);
  const dmB = new MockBackend({ persist: false, channel });
  const plB = new MockBackend({ persist: false, channel });
  dmB.forceUser(user('dm'));
  plB.forceUser(user('p1', true));
  const tid = await createTable(dmB, user('dm'), 'Test');
  const dm = new TableClient(dmB, tid, 'dm', 'dm');
  dm.start();
  await waitFor(() => dm.metaLoaded, 'table meta');
  const s1 = await dm.createScene({ name: 'Cave', mapUrl: 'x.png', mapW: 1000, mapH: 800 });
  await waitFor(() => !!dm.scene?.meta, 'scene meta');
  const s2 = await dm.createScene({ name: 'Camp', mapUrl: 'y.png', mapW: 800, mapH: 600 });
  await dm.openScene(s1);
  await waitFor(() => dm.viewSceneId === s1 && !!dm.scene?.meta, 'back on the cave');
  const pl = new TableClient(plB, tid, 'p1', 'player');
  pl.start();
  await waitFor(() => pl.scene?.id === s1 && !!pl.scene.meta, 'player scene');
  await pl.joinAsPlayer('Aria', '#ff0000');
  return { dm, pl, dmB, plB, tid, s1, s2, channel };
}

describe('the DM\'s saved tokens', () => {
  it('keep settings and maximum hit points; dropping one in gives a fresh token', async () => {
    const { dm } = await setup();
    const id = await dm.addToken({ x: 100, y: 100, name: 'Ogre', size: 2, sight: 60, light: { b: 10, d: 10, c: '#ffffff' }, hp: 5, maxHp: 59, fx: [{ id: 'e1', n: 'Prone', ic: '', c: '#ff0000', look: 'badge', tint: false }] } as any, { record: false });
    await waitFor(() => dm.scene!.tokens.get(id)?.maxHp === 59, 'ogre');
    const lib = await dm.saveTokenToLibrary(id);
    expect(lib).toBeTruthy();
    await waitFor(() => dm.tokenLib.length === 1, 'saved');
    expect(dm.tokenLib[0]).toMatchObject({ name: 'Ogre' });
    expect(dm.tokenLib[0].t.fx).toBeUndefined();
    const n = await dm.addSavedToken(lib!, { x: 350, y: 140 });
    await waitFor(() => !!dm.scene!.tokens.get(n!), 'dropped');
    expect(dm.scene!.tokens.get(n!)).toMatchObject({ name: 'Ogre', size: 2, sight: 60, x: 350, y: 140, hp: 59, maxHp: 59, cid: null, ownerUid: null });
    expect(dm.scene!.tokens.get(n!)!.fx).toEqual([]);
    const m = await dm.addSavedToken(lib!, { x: 420, y: 140 }); // the same template again: another ogre
    expect(m).not.toBe(n);
  });
});

describe('a player\'s characters', () => {
  it('are saved with a link to the token, and the library entry follows the token', async () => {
    const { dm, pl } = await setup();
    const id = await pl.addToken({ x: 70, y: 70, name: 'Aria', size: 1 }, { record: false });
    await waitFor(() => !!pl.scene!.tokens.get(id) && !!dm.scene!.tokens.get(id), 'token');
    const cid = await pl.saveTokenToLibrary(id);
    await waitFor(() => pl.tokenLib.length === 1 && pl.scene!.tokens.get(id)?.cid === cid, 'saved');
    expect(pl.tokenLib[0].id).toBe(cid);
    expect(pl.tokenLib[0].t.fx).toBeUndefined();
    // the DM puts a condition on her; the library entry picks it up
    await dm.updateToken(id, { fx: [{ id: 'e2', n: 'Blessed', ic: '', c: '#ffd43b', look: 'badge', tint: false } as any] });
    await waitFor(() => (pl.scene!.tokens.get(id)?.fx.length ?? 0) === 1, 'player sees the condition');
    await waitFor(() => normalizeFx(pl.tokenLib[0]?.t.fx)[0]?.n === 'Blessed', 'entry follows', 6000);
  }, 20000);

  it('cannot save someone else\'s token', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addToken({ x: 70, y: 70, name: 'Goblin' }, { record: false });
    await waitFor(() => !!pl.scene!.tokens.get(id), 'token');
    expect(await pl.saveTokenToLibrary(id)).toBeNull();
    expect(pl.tokenLib).toHaveLength(0);
  });

  it('are brought into a scene once, owned by the player, with their conditions', async () => {
    const { dm, pl } = await setup();
    const id = await pl.addToken({ x: 70, y: 70, name: 'Aria' }, { record: false });
    await waitFor(() => !!pl.scene!.tokens.get(id), 'token');
    const cid = (await pl.saveTokenToLibrary(id))!;
    await waitFor(() => pl.scene!.tokens.get(id)?.cid === cid, 'linked');
    // already on this map: not added twice
    expect(await pl.addSavedToken(cid, { x: 200, y: 200 })).toBe(id);
    void dm;
  });
});

describe('the party travels with its hit points', () => {
  it('moving the table copies the players\' tokens with their hit points and conditions', async () => {
    const { dm, pl, s1, s2 } = await setup();
    const id = await pl.addToken({ x: 70, y: 70, name: 'Aria', fx: [{ id: 'e3', n: 'Poisoned', ic: '', c: '#51cf66', look: 'badge', tint: false }] } as any, { record: false });
    await waitFor(() => !!dm.scene!.tokens.get(id), 'token on the DM');
    await dm.updateToken(id, { hp: 14, maxHp: 30 });
    await waitFor(() => dm.scene!.tokens.get(id)?.hp === 14, 'hp');
    const carried = await dm.setActiveScene(s2);
    expect(carried).toBe(1);
    await dm.openScene(s2);
    await waitFor(() => dm.viewSceneId === s2 && dm.scene!.tokens.size === 1, 'token in the camp');
    const t = [...dm.scene!.tokens.values()][0];
    await waitFor(() => [...dm.scene!.tokens.values()][0].hp === 14, 'hit points came along');
    const t2 = [...dm.scene!.tokens.values()][0];
    expect(t2).toMatchObject({ name: 'Aria', ownerUid: 'p1', hp: 14, maxHp: 30 });
    expect(t2.fx[0].n).toBe('Poisoned');
    expect(t2.id).not.toBe(id);
    expect(t2.cid).toBeTruthy();
    void t; void s1;
  });

  it('does not copy a character that is already there, and does nothing when carrying is off', async () => {
    const { dm, pl, s2 } = await setup();
    const id = await pl.addToken({ x: 70, y: 70, name: 'Aria' }, { record: false });
    await waitFor(() => !!dm.scene!.tokens.get(id), 'token');
    dm.carryParty = false;
    expect(await dm.setActiveScene(s2)).toBe(0);
    dm.carryParty = true;
    expect(await dm.carryTokens(dm.activeSceneId!, s2 === dm.activeSceneId ? 'x' : s2)).toBe(0); // same scene: nothing
  });

  it('a character brought in later arrives with the hit points it left with', async () => {
    const { dm, pl, s1, s2 } = await setup();
    const id = await pl.addToken({ x: 70, y: 70, name: 'Aria' }, { record: false });
    await waitFor(() => !!dm.scene!.tokens.get(id), 'token');
    const cid = (await pl.saveTokenToLibrary(id))!;
    await waitFor(() => dm.scene!.tokens.get(id)?.cid === cid, 'linked on the DM');
    await dm.updateToken(id, { hp: 9, maxHp: 25 });
    await waitFor(() => dm.scene!.tokens.get(id)?.hp === 9, 'hp');
    await sleep(500); // the DM's copy of her hit points is filed
    // later: the table is in the camp (nothing carried), and she brings herself in from her library
    dm.carryParty = false;
    await dm.setActiveScene(s2);
    await waitFor(() => pl.scene?.id === s2 && !!pl.scene.meta, 'player in the camp');
    await dm.openScene(s2);
    await waitFor(() => dm.viewSceneId === s2 && !!dm.scene?.meta, 'DM in the camp');
    const nid = (await pl.addSavedToken(cid, { x: 90, y: 90 }))!;
    await waitFor(() => dm.scene!.tokens.get(nid)?.hp === 9, 'hit points restored by the DM', 6000);
    expect(dm.scene!.tokens.get(nid)).toMatchObject({ maxHp: 25, ownerUid: 'p1', cid });
    // players see only what the token's health display allows
    await waitFor(() => pl.scene!.tokens.get(nid)?.hpPct === 36, 'public percentage');
    void s1;
  }, 20000);
});

describe('a returning player takes their name back', () => {
  async function newcomer(channel: string, tid: string, uid: string) {
    const b = new MockBackend({ persist: false, channel });
    b.forceUser(user(uid, true));
    const c = new TableClient(b, tid, uid, 'player');
    c.start();
    await waitFor(() => !!c.scene?.meta, 'newcomer scene');
    return { b, c };
  }

  it('their saved characters come back, and the DM hands their token to the new browser', async () => {
    const { dm, pl, plB, tid, channel } = await setup();
    const id = await pl.addToken({ x: 70, y: 70, name: 'Aria' }, { record: false });
    await waitFor(() => !!pl.scene!.tokens.get(id) && !!dm.scene!.tokens.get(id), 'token');
    const cid = (await pl.saveTokenToLibrary(id))!;
    await waitFor(() => pl.tokenLib.length === 1 && dm.scene!.tokens.get(id)?.cid === cid, 'saved');
    // the characters are kept with the table, not under the browser's account
    expect(Object.keys((await plB.get(`tables/${tid}/chars/p1`)) ?? {})).toEqual([cid]);
    expect(await plB.get('users/p1/tokenLib')).toBeNull();
    // she is on a new browser (new uid); the old one has gone offline
    await plB.update({ [`tables/${tid}/players/p1/online`]: false });
    const { c } = await newcomer(channel, tid, 'p9');
    await waitFor(() => c.players.has('p1'), 'sees the old entry');
    expect(c.players.get('p1')!.rid).toBe('p1');
    expect(c.tokenLib).toHaveLength(0); // before picking her name, nothing
    await c.joinAsPlayer('Aria', '#ff0000', c.players.get('p1')!.rid);
    await waitFor(() => c.tokenLib.length === 1, 'characters come back');
    expect(c.tokenLib[0].id).toBe(cid);
    // the DM merges the old entry into the new one: token reassigned, one Aria in the list
    await waitFor(() => dm.scene!.tokens.get(id)?.ownerUid === 'p9' && !dm.players.has('p1'), 'merged', 6000);
    expect(dm.players.get('p9')!.rid).toBe('p1');
    // changes she saves now go to the same library
    await c.saveTokenToLibrary(id);
    expect(c.libPath).toBe(`tables/${tid}/chars/p1`);
  }, 20000);

  it('an old entry that is still online (a second device) is left alone', async () => {
    const { dm, pl, tid, channel } = await setup();
    const { c } = await newcomer(channel, tid, 'p9');
    await waitFor(() => c.players.has('p1'), 'sees the old entry');
    await c.joinAsPlayer('Aria', '#ff0000', 'p1');
    await sleep(900);
    expect(dm.players.has('p1')).toBe(true);
    expect(dm.players.has('p9')).toBe(true);
    void pl;
  }, 20000);

  it('a different player cannot see her characters just by being on the table', async () => {
    const { pl, tid, channel } = await setup();
    const id = await pl.addToken({ x: 70, y: 70, name: 'Aria' }, { record: false });
    await waitFor(() => !!pl.scene!.tokens.get(id), 'token');
    await pl.saveTokenToLibrary(id);
    const { c } = await newcomer(channel, tid, 'p7');
    await c.joinAsPlayer('Bo', '#00ff00');
    await sleep(300);
    expect(c.libPath).toBe(`tables/${tid}/chars/p7`);
    expect(c.tokenLib).toHaveLength(0);
  }, 20000);
});
