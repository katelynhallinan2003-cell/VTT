import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock';
import { sceneRect } from '../src/core/geometry';
import { MAX_EXTRA_MAPS, mapsToWire, normalizeMaps, normalizeSceneMeta } from '../src/core/model';
import { createTable } from '../src/state/account';
import { TableClient } from '../src/state/client';
import type { AuthUser, ExtraMap } from '../src/types';

const user = (uid: string, anonymous = false): AuthUser => ({ uid, name: uid, email: anonymous ? null : `${uid}@x.com`, photo: null, anonymous });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, what = 'condition', ms = 1500) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(5); }
}
async function setup() {
  const channel = 'xm-' + Math.random().toString(36).slice(2);
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
  return { dm, pl };
}

const mk = (id: string, o: Partial<ExtraMap> = {}): ExtraMap => ({ id, url: `${id}.png`, w: 500, h: 400, x: 1000, y: 0, scale: 1, name: id, show: true, locked: true, ...o });

describe('extra maps in the data', () => {
  it('survive the trip to the database and back, in the order they were added', () => {
    const maps = [mk('-a1'), mk('-a2', { x: 5.5, scale: 0.5, show: false, locked: false, name: 'Upstairs' })];
    const back = normalizeMaps(JSON.parse(JSON.stringify(mapsToWire(maps))));
    expect(back).toEqual(maps);
    expect(mapsToWire([])).toBeNull();
  });
  it('skip what is broken and stop at the limit', () => {
    expect(normalizeMaps(null)).toEqual([]);
    expect(normalizeMaps({ a: { w: 1 }, b: 'x' })).toEqual([]);
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`-k${i}`, { u: `${i}.png`, w: 10, h: 10 }]));
    expect(normalizeMaps(many)).toHaveLength(MAX_EXTRA_MAPS);
    const m = normalizeMaps({ a: { u: 'a.png', w: -4, h: 0, s: -1 } })[0];
    expect(m.w).toBeGreaterThan(0);
    expect(m.scale).toBeGreaterThan(0);
    expect(m.locked).toBe(true);
    expect(m.show).toBe(true);
  });
  it('a scene with none has an empty list', () => {
    expect(normalizeSceneMeta({}).maps).toEqual([]);
  });
});

describe('the room a scene takes up', () => {
  const main = { mapX: 0, mapY: 0, mapW: 1000, mapH: 800, mapScale: 1 };
  it('is the main map alone, when that is all there is', () => {
    expect(sceneRect({ ...main })).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
  it('grows to hold every map, at its own size', () => {
    expect(sceneRect({ ...main, maps: [{ x: 1000, y: 0, w: 500, h: 400, scale: 2 }] })).toEqual({ x: 0, y: 0, w: 2000, h: 800 });
    expect(sceneRect({ ...main, maps: [{ x: -300, y: -100, w: 100, h: 100, scale: 1 }] })).toEqual({ x: -300, y: -100, w: 1300, h: 900 });
  });
  it('works with no main map, and with nothing at all', () => {
    expect(sceneRect({ mapX: 0, mapY: 0, mapW: 0, mapH: 0, mapScale: 1, maps: [{ x: 10, y: 20, w: 30, h: 40, scale: 1 }] })).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(sceneRect({ mapX: 0, mapY: 0, mapW: 0, mapH: 0, mapScale: 1 })).toBeNull();
  });
});

describe('extra maps through the client', () => {
  it('adds one to the right of the first, shows it to players, and moves, hides and removes it', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addExtraMap('floor2.png', 600, 500, 'Upstairs');
    await waitFor(() => dm.scene?.meta?.maps.length === 1, 'map added');
    const m = dm.scene!.meta!.maps[0];
    expect(m).toMatchObject({ id, url: 'floor2.png', w: 600, h: 500, x: 1000, y: 0, scale: 1, name: 'Upstairs', show: true, locked: false });
    await waitFor(() => pl.scene?.meta?.maps.length === 1, 'player sees it');
    expect(dm.sceneRect()).toEqual({ x: 0, y: 0, w: 1600, h: 800 });

    await dm.updateExtraMap(id!, { x: 200, y: 100, scale: 0.5, locked: true });
    await waitFor(() => dm.scene?.meta?.maps[0].x === 200, 'moved');
    expect(dm.scene!.meta!.maps[0]).toMatchObject({ x: 200, y: 100, scale: 0.5, locked: true });
    await dm.updateExtraMap(id!, { show: false });
    await waitFor(() => pl.scene?.meta?.maps[0].show === false, 'hidden for players');

    await dm.removeExtraMap(id!);
    await waitFor(() => dm.scene?.meta?.maps.length === 0, 'removed');
    await waitFor(() => pl.scene?.meta?.maps.length === 0, 'removed for players');
    expect(dm.sceneRect()).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });

  it('is one Ctrl+Z to take it back, and the limit holds', async () => {
    const { dm } = await setup();
    await dm.addExtraMap('a.png', 100, 100, 'a');
    await waitFor(() => dm.scene?.meta?.maps.length === 1, 'added');
    await dm.history.undo();
    await waitFor(() => dm.scene?.meta?.maps.length === 0, 'undone');
    await dm.history.redo();
    await waitFor(() => dm.scene?.meta?.maps.length === 1, 'redone');
    for (let i = 1; i < MAX_EXTRA_MAPS; i++) await dm.addExtraMap(`m${i}.png`, 100, 100, `m${i}`);
    await waitFor(() => dm.scene?.meta?.maps.length === MAX_EXTRA_MAPS, 'full');
    await expect(dm.addExtraMap('one-too-many.png', 100, 100, 'x')).rejects.toThrow();
  });

  it('players cannot change them', async () => {
    const { dm, pl } = await setup();
    const id = await dm.addExtraMap('a.png', 100, 100, 'a');
    await waitFor(() => pl.scene?.meta?.maps.length === 1, 'player sees it');
    await pl.updateExtraMap(id!, { x: 99 });
    await sleep(60);
    expect(dm.scene!.meta!.maps[0].x).toBe(1000);
  });
});
