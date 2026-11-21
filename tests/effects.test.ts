import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock';
import { addFx, fxDuration, fxToWire, makeEffect, normalizeFx, tickFx } from '../src/core/effects';
import { normalizeToken, tokenToWire } from '../src/core/model';
import { createTable } from '../src/state/account';
import { TableClient } from '../src/state/client';
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

describe('effects data', () => {
  it('reads effects from an array or from the object the database may hand back, and drops junk', () => {
    const raw = [{ id: 'a', n: 'Poisoned', ic: '🤢', c: '#51cf66', left: 3, tick: 'start', look: 'halo' }, null, { n: '  ' }, { n: 'Custom', c: 'nope', left: -4 }];
    const fx = normalizeFx(raw);
    expect(fx).toHaveLength(2);
    expect(fx[0]).toMatchObject({ id: 'a', n: 'Poisoned', ic: '🤢', left: 3, tick: 'start', look: 'halo' });
    expect(fx[1]).toMatchObject({ n: 'Custom', c: '#ff6b6b', left: 0, tick: 'end', look: 'badge' });
    expect(normalizeFx({ 0: raw[0], 2: raw[3] })).toHaveLength(2);
    expect(normalizeFx(undefined)).toEqual([]);
  });

  it('writes compact data and leaves nothing undefined', () => {
    const e = makeEffect({ n: 'Blessed', ic: '✨', c: '#ffe066', left: null });
    const wire = fxToWire([e])!;
    expect(wire[0]).toEqual({ id: e.id, n: 'Blessed', c: '#ffe066', ic: '✨' });
    expect(JSON.stringify(wire)).not.toContain('undefined');
    expect(fxToWire([])).toBeNull();
  });

  it('keeps effects and the initiative bonus when a token is saved and read back', () => {
    const t = normalizeToken('t1', { name: 'Goblin', initBonus: 2, fx: [{ id: 'x', n: 'Prone', c: '#a9806a', left: 2 }] }, false);
    expect(t.initBonus).toBe(2);
    expect(t.fx[0].n).toBe('Prone');
    const wire = tokenToWire(t);
    expect(wire.initBonus).toBe(2);
    expect(normalizeToken('t1', wire, false).fx).toEqual(t.fx);
    expect(tokenToWire(normalizeToken('t2', { name: 'Plain' }, false)).fx).toBeUndefined();
    expect(normalizeToken('t2', { initBonus: 500 }, false).initBonus).toBe(99);
  });

  it('adding the same effect again restarts it instead of stacking', () => {
    const a = makeEffect({ n: 'Poisoned', left: 3 });
    const b = makeEffect({ n: 'poisoned', left: 10 });
    const list = addFx([a], b);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, left: 10 });
    expect(addFx(list, makeEffect({ n: 'Burning' }))).toHaveLength(2);
  });

  it('counts down only what ticks at that moment, and ends effects that reach zero', () => {
    const list = [
      makeEffect({ n: 'End', left: 2, tick: 'end' }),
      makeEffect({ n: 'Start', left: 1, tick: 'start' }),
      makeEffect({ n: 'Round', left: 1, tick: 'round' }),
      makeEffect({ n: 'Forever', left: null }),
    ];
    const atEnd = tickFx(list, 'end');
    expect(atEnd.changed).toBe(true);
    expect(atEnd.fx.find((e) => e.n === 'End')!.left).toBe(1);
    expect(atEnd.ended).toEqual([]);
    const atStart = tickFx(atEnd.fx, 'start');
    expect(atStart.ended.map((e) => e.n)).toEqual(['Start']);
    expect(atStart.fx.map((e) => e.n)).toEqual(['End', 'Round', 'Forever']);
    // a token outside the turn order counts everything down once per round
    const all = tickFx(list, 'round', true);
    expect(all.ended.map((e) => e.n).sort()).toEqual(['Round', 'Start']);
    expect(all.fx.find((e) => e.n === 'End')!.left).toBe(1);
    expect(all.fx.find((e) => e.n === 'Forever')!.left).toBeNull();
    expect(tickFx([list[3]], 'end').changed).toBe(false);
  });

  it('describes durations', () => {
    expect(fxDuration({ left: null })).toBe('until removed');
    expect(fxDuration({ left: 1 })).toBe('1 round');
    expect(fxDuration({ left: 4 })).toBe('4 rounds');
  });
});

async function setup() {
  const channel = 'fx-' + Math.random().toString(36).slice(2);
  const dmB = new MockBackend({ persist: false, channel });
  dmB.forceUser(user('dm'));
  const tid = await createTable(dmB, user('dm'), 'Test');
  const dm = new TableClient(dmB, tid, 'dm', 'dm');
  dm.start();
  await waitFor(() => dm.metaLoaded, 'table meta');
  await dm.createScene({ name: 'Cave', mapUrl: 'x.png', mapW: 1000, mapH: 800 });
  await waitFor(() => !!dm.scene?.meta, 'scene meta');
  return { dm, dmB };
}

describe('effects and the turn order', () => {
  it('ticks with the turns, ends on its own, and "previous turn" puts the timers back', async () => {
    const { dm } = await setup();
    const a = await dm.addToken({ x: 35, y: 35, name: 'Aria' }, { record: false });
    const g = await dm.addToken({ x: 105, y: 35, name: 'Goblin' }, { record: false });
    const stray = await dm.addToken({ x: 175, y: 35, name: 'Statue' }, { record: false });
    await waitFor(() => dm.scene!.tokens.size === 3, 'tokens');
    await dm.initApply([{ tk: a, n: 'Aria', i: 15 }, { tk: g, n: 'Goblin', i: 10 }]);
    await waitFor(() => dm.scene!.init.entries.length === 2, 'order');
    const ended: string[] = [];
    dm.onFxEnded = (l) => ended.push(...l);

    await dm.addEffect([g], makeEffect({ n: 'Poisoned', left: 1, tick: 'end' }));
    await dm.addEffect([a], makeEffect({ n: 'Blessed', left: 2, tick: 'round' }));
    await dm.addEffect([g], makeEffect({ n: 'Hexed' })); // no timer: stays
    await dm.addEffect([stray], makeEffect({ n: 'Wet', left: 2, tick: 'end' })); // not in the order
    await waitFor(() => dm.scene!.tokens.get(g)!.fx.length === 2 && dm.scene!.tokens.get(stray)!.fx.length === 1, 'effects stored');

    const fx = (id: string) => dm.scene!.tokens.get(id)!.fx.map((e) => `${e.n}:${e.left ?? '-'}`);
    expect(dm.scene!.init.turn).toBe(dm.scene!.init.entries[0].id); // Aria
    await dm.initStep(1); // Aria's turn ends, the Goblin's begins
    await waitFor(() => dm.scene!.init.turn === dm.scene!.init.entries[1].id, 'goblin turn');
    expect(fx(g)).toEqual(['Poisoned:1', 'Hexed:-']);
    await dm.initStep(1); // the Goblin's turn ends: poison runs out, then a new round starts
    await waitFor(() => dm.scene!.init.round === 2, 'round 2');
    await waitFor(() => fx(g).length === 1, 'poison gone');
    expect(fx(g)).toEqual(['Hexed:-']);
    expect(ended).toEqual(['Poisoned ended on Goblin']);
    expect(fx(a)).toEqual(['Blessed:1']);
    expect(fx(stray)).toEqual(['Wet:1']); // counted once for the new round

    // going back straight after restores everything
    await dm.initStep(-1);
    await waitFor(() => dm.scene!.init.round === 1 && fx(g).length === 2, 'put back');
    expect(fx(g)).toEqual(['Poisoned:1', 'Hexed:-']);
    expect(fx(a)).toEqual(['Blessed:2']);
    expect(fx(stray)).toEqual(['Wet:2']);
  });

  it('nudges timers, removes effects and undoes changes', async () => {
    const { dm } = await setup();
    const a = await dm.addToken({ x: 35, y: 35, name: 'Aria' }, { record: false });
    await waitFor(() => !!dm.scene!.tokens.get(a), 'token');
    const e = makeEffect({ n: 'Slowed', left: 2 });
    await dm.addEffect([a], e);
    await waitFor(() => dm.scene!.tokens.get(a)!.fx.length === 1, 'added');
    await dm.nudgeEffect(a, e.id, 3);
    await waitFor(() => dm.scene!.tokens.get(a)!.fx[0].left === 5, 'nudged up');
    await dm.nudgeEffect(a, e.id, -9); // the last round going ends it
    await waitFor(() => dm.scene!.tokens.get(a)!.fx.length === 0, 'ended by nudge');
    await dm.history.undo();
    await waitFor(() => dm.scene!.tokens.get(a)!.fx.length === 1, 'undone');
    await dm.removeEffect([a], e.id);
    await waitFor(() => dm.scene!.tokens.get(a)!.fx.length === 0, 'removed');
  });

  it('ending combat can be undone', async () => {
    const { dm } = await setup();
    const a = await dm.addToken({ x: 35, y: 35, name: 'Aria' }, { record: false });
    await waitFor(() => !!dm.scene!.tokens.get(a), 'token');
    await dm.initApply([{ tk: a, n: 'Aria', i: 12 }]);
    await waitFor(() => dm.scene!.init.entries.length === 1, 'order');
    await dm.initEnd();
    await waitFor(() => dm.scene!.init.entries.length === 0, 'ended');
    await dm.history.undo();
    await waitFor(() => dm.scene!.init.entries.length === 1, 'back');
    await dm.initAddFree('Lair action', 20, true);
    await waitFor(() => dm.scene!.init.entries.length === 2, 'lair');
    const lair = dm.scene!.init.entries.find((x) => !x.tk)!;
    expect(lair.h).toBe(true);
    expect(dm.scene!.init.entries[0].id).toBe(lair.id); // 20 beats 12
  });
});
