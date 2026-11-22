import { describe, expect, it } from 'vitest';
import { CAMPAIGN_FORMAT, buildCampaign, clean, describeCampaign, newLibraryItems, parseCampaign, planImport } from '../src/core/campaign';
import type { Handout } from '../src/types';

const handout = (id: string, createdAt: number, over: Partial<Handout> = {}): Handout => ({ id, title: 'T' + id, text: 'x', img: null, to: ['u1'], shown: true, n: 9, createdAt, ...over });

const pub = () => ({
  meta: { name: 'Crypt', mapUrl: 'https://i.example/m.png', mapW: 100, mapH: 100 },
  tokens: { t1: { name: 'Goblin', x: 5, y: 5, ownerUid: 'uA' }, t2: { name: 'Aria', x: 9, y: 9 } },
  draw: { d1: { type: 'rect', uid: 'uA', x: 1, y: 1 } },
  walls: { w1: { a: [0, 0], b: [10, 0] } },
  fogOps: { f1: { k: 'rect' } },
  live: { uA: { ruler: [1, 2] } },
  pings: { p1: { x: 1, y: 1 } },
});
const dm = () => ({ tokens: { h1: { name: 'Hidden', ownerUid: 'uB' } }, hp: { t1: { hp: 7 } }, init: { entries: { a: { i: 12 } } } });

const make = () => buildCampaign({
  name: 'Lost Mine',
  settings: { perm: { move: true }, preset: 'trusting' },
  scenes: [{ name: 'Crypt', active: true, pub: pub(), dm: dm() }, { name: 'Cave', active: false, pub: { meta: { name: 'Cave' } }, dm: {} }],
  handouts: [handout('b', 20), handout('a', 10)],
  library: { maps: [{ name: 'M', url: 'u1' }], tokens: [] },
  now: 1000,
});

const opts = (over: Record<string, unknown> = {}) => {
  let n = 0;
  return { tid: 'tab', uid: 'dmUid', newKey: () => 'k' + ++n, now: 5000, existingNames: [] as string[], orderBase: 0, hasActive: false, ...over };
};

describe('building a campaign file', () => {
  it('leaves out where people are looking and pinging, keeps the rest, orders handouts by when they were made', () => {
    const f = make();
    expect(f.format).toBe(CAMPAIGN_FORMAT);
    expect(f.scenes[0].pub.live).toBeUndefined();
    expect(f.scenes[0].pub.pings).toBeUndefined();
    expect(f.scenes[0].pub.walls.w1.b).toEqual([10, 0]);
    expect(f.scenes[0].dm.hp.t1.hp).toBe(7);
    expect(f.handouts.map((h) => h.title)).toEqual(['Ta', 'Tb']);
    expect(f.handouts[0]).toEqual({ title: 'Ta', text: 'x', img: null, createdAt: 10 }); // not who it was shown to
  });
  it('reads back through text unchanged', () => {
    const f = make();
    const r = parseCampaign(JSON.stringify(f));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.scenes.map((s) => s.name)).toEqual(['Crypt', 'Cave']);
      expect(r.file.scenes[0].active).toBe(true);
      expect(r.file.scenes[0].pub.tokens.t1.name).toBe('Goblin');
      expect(r.file.handouts).toHaveLength(2);
      expect(r.file.library!.maps[0].url).toBe('u1');
      expect(describeCampaign(r.file)).toEqual({ scenes: ['Crypt', 'Cave'], handouts: 2, maps: 1, tokens: 0 });
    }
  });
});

describe('reading a file that is not right', () => {
  const bad = (t: string) => { const r = parseCampaign(t); return r.ok ? '' : r.error; };
  it('says so plainly', () => {
    expect(bad('hello')).toMatch(/not readable/);
    expect(bad('{"a":1}')).toMatch(/not a campaign file/);
    expect(bad(JSON.stringify({ format: CAMPAIGN_FORMAT, version: 99, scenes: [] }))).toMatch(/newer version/);
    expect(bad(JSON.stringify({ format: CAMPAIGN_FORMAT, version: 1 }))).toMatch(/no scenes/);
    expect(bad(JSON.stringify({ format: CAMPAIGN_FORMAT, version: 1, scenes: [] }))).toMatch(/empty/);
  });
  it('skips a scene that has no settings, and keeps the rest', () => {
    const r = parseCampaign(JSON.stringify({ format: CAMPAIGN_FORMAT, version: 1, scenes: [{ name: 'Broken', pub: { tokens: {} } }, { name: 'Fine', pub: { meta: { name: 'Fine' } } }] }));
    expect(r.ok && r.file.scenes.map((s) => s.name)).toEqual(['Fine']);
  });
  it('drops keys the database cannot hold and empty values', () => {
    expect(clean({ 'a.b': 1, ok: { 'x/y': 2, '$z': 3, keep: 4, gone: null, e: {} }, arr: [1, null, 2] })).toEqual({ ok: { keep: 4 }, arr: [1, 2] });
    expect(clean({ n: Infinity, s: 'x', b: false, z: 0 })).toEqual({ s: 'x', b: false, z: 0 });
  });
  it('refuses a file that is absurdly large', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 1_600_000; i++) wide['k' + i] = i;
    expect(() => clean(wide)).toThrow(/too large/);
  });
});

describe('adding a campaign to a table', () => {
  it('gives everything new ids and writes only new places', () => {
    const plan = planImport(make(), opts());
    expect(plan.sceneIds).toEqual(['k1', 'k2']);
    expect(Object.keys(plan.updates).sort()).toEqual([
      'tables/tab/dm/handouts/k3', 'tables/tab/dm/handouts/k4',
      'tables/tab/dm/sceneIndex/k1', 'tables/tab/dm/sceneIndex/k2',
      'tables/tab/dm/scenes/k1',
      'tables/tab/scenes/k1', 'tables/tab/scenes/k2',
    ]);
    expect(plan.updates['tables/tab/dm/sceneIndex/k2']).toEqual({ name: 'Cave', order: 2 });
  });
  it('frees player tokens and makes the importer the author of drawings', () => {
    const plan = planImport(make(), opts());
    const s = plan.updates['tables/tab/scenes/k1'];
    expect('ownerUid' in s.tokens.t1).toBe(false);
    expect(s.tokens.t1.name).toBe('Goblin');
    expect(s.draw.d1.uid).toBe('dmUid');
    expect('ownerUid' in plan.updates['tables/tab/dm/scenes/k1'].tokens.h1).toBe(false);
    expect(plan.updates['tables/tab/dm/scenes/k1'].hp.t1.hp).toBe(7);
  });
  it('brings handouts in not shown', () => {
    const plan = planImport(make(), opts());
    const h = plan.updates['tables/tab/dm/handouts/k3'];
    expect(h.shown).toBeUndefined();
    expect(h.to).toBeUndefined();
    expect(h.n).toBeUndefined();
    expect(h.title).toBe('Ta');
    expect(h.createdAt).toBe(10);
  });
  it('tells new scenes apart from ones with the same name, and carries on the order', () => {
    const plan = planImport(make(), opts({ existingNames: ['crypt'], orderBase: 7, hasActive: true }));
    expect(plan.updates['tables/tab/scenes/k1'].meta.name).toBe('Crypt (2)');
    expect(plan.updates['tables/tab/dm/sceneIndex/k1']).toEqual({ name: 'Crypt (2)', order: 8 });
    expect(plan.updates['tables/tab/dm/sceneIndex/k2'].order).toBe(9);
    const again = planImport(make(), opts({ existingNames: ['Crypt', 'Crypt (2)', 'Cave'], hasActive: true }));
    expect(again.updates['tables/tab/scenes/k1'].meta.name).toBe('Crypt (3)');
    expect(again.updates['tables/tab/scenes/k2'].meta.name).toBe('Cave (2)');
  });
  it('makes a scene active only when the table has none: the one that was, else the first', () => {
    expect(planImport(make(), opts({ hasActive: true })).activate).toBeNull();
    expect(planImport(make(), opts()).activate).toBe('k1');
    const f = make(); f.scenes[0].active = false; f.scenes[1].active = true;
    expect(planImport(f, opts()).activate).toBe('k2');
  });
  it('leaves the file itself untouched', () => {
    const f = make();
    planImport(f, opts());
    expect(f.scenes[0].pub.tokens.t1.ownerUid).toBe('uA');
  });
});

describe('library', () => {
  it('adds only pictures that are not there yet', () => {
    const out = newLibraryItems([{ url: 'a' }], [{ name: 'A', url: 'a' }, { name: 'B', url: 'b' }, { name: 'B again', url: 'b' }]);
    expect(out.map((x) => x.url)).toEqual(['b']);
  });
});
