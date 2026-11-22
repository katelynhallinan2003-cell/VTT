import { describe, expect, it } from 'vitest';
import {
  cleanHp, emptyInit, entryIsPublic, healthState, moveEntry, nextTurn, orderOf, pctOf, prevTurn, sightRadiusPx, sortByInit, toPub, visionCircles, withoutLights,
} from '../src/core/combat';
import { isLightMark } from '../src/core/light';
import { initPubToWire, initToWire, normalizeInit, normalizeInitPub, normalizeToken, tokenToWire } from '../src/core/model';
import type { InitEntry, InitState } from '../src/types';

const e = (id: string, i: number, o = 0, extra: Partial<InitEntry> = {}): InitEntry => ({ id, tk: null, n: id, i, h: false, o, ...extra });
const state = (entries: InitEntry[], turn: string | null = null, round = 0, shown = false): InitState => ({ round, turn, shown, entries });

describe('health', () => {
  it('turns hit points into a whole percentage that never rounds a living creature down to zero', () => {
    expect(pctOf(30, 30)).toBe(100);
    expect(pctOf(15, 30)).toBe(50);
    expect(pctOf(1, 400)).toBe(1);
    expect(pctOf(0, 30)).toBe(0);
    expect(pctOf(null, 30)).toBeNull();
    expect(pctOf(5, 0)).toBeNull();
  });
  it('names bloodied at half, near death at a tenth, and down at zero', () => {
    expect(healthState(100)).toBe('ok');
    expect(healthState(51)).toBe('ok');
    expect(healthState(50)).toBe('bloodied');
    expect(healthState(11)).toBe('bloodied');
    expect(healthState(10)).toBe('mortal');
    expect(healthState(1)).toBe('mortal');
    expect(healthState(0)).toBe('down');
    expect(healthState(null)).toBe('ok');
  });
  it('keeps hp and max together and hp inside 0..max', () => {
    expect(cleanHp(null, null)).toEqual({ hp: null, max: null });
    expect(cleanHp(12, null)).toEqual({ hp: 12, max: 12 });
    expect(cleanHp(null, 30)).toEqual({ hp: 30, max: 30 });
    expect(cleanHp(99, 30)).toEqual({ hp: 30, max: 30 });
    expect(cleanHp(-4, 30)).toEqual({ hp: 0, max: 30 });
    expect(cleanHp(10.6, 30.2)).toEqual({ hp: 11, max: 30 });
  });
});

describe('initiative order', () => {
  it('sorts highest first and keeps the existing order for ties', () => {
    const list = sortByInit([e('a', 12, 1000), e('b', 18, 2000), e('c', 12, 3000), e('d', 5, 4000)]);
    expect(orderOf(list).map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
    const tie = sortByInit([e('x', 10, 2000), e('y', 10, 1000)]);
    expect(orderOf(tie).map((x) => x.id)).toEqual(['y', 'x']);
  });
  it('moves a line before another, or to the end', () => {
    const list = [e('a', 3, 1000), e('b', 2, 2000), e('c', 1, 3000)];
    expect(orderOf(moveEntry(list, 'c', 'a')).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(orderOf(moveEntry(list, 'a', null)).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(orderOf(moveEntry(list, 'b', 'b')).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('steps through turns and counts rounds in both directions', () => {
    const entries = [e('a', 3, 1000), e('b', 2, 2000), e('c', 1, 3000)];
    expect(nextTurn(state(entries, null, 0))).toEqual({ turn: 'a', round: 1 });
    expect(nextTurn(state(entries, 'a', 1))).toEqual({ turn: 'b', round: 1 });
    expect(nextTurn(state(entries, 'c', 1))).toEqual({ turn: 'a', round: 2 });
    expect(prevTurn(state(entries, 'b', 2))).toEqual({ turn: 'a', round: 2 });
    expect(prevTurn(state(entries, 'a', 2))).toEqual({ turn: 'c', round: 1 });
    expect(prevTurn(state(entries, 'a', 1))).toEqual({ turn: 'c', round: 1 });
    expect(nextTurn(emptyInit())).toEqual({ turn: null, round: 0 });
  });
});

describe('what players may see of the order', () => {
  const tokens = new Map<string, { hidden: boolean; name: string }>([
    ['t1', { hidden: false, name: 'Aria' }],
    ['t2', { hidden: true, name: 'Ambusher' }],
  ]);
  const entries = [e('a', 20, 1000, { tk: 't1', n: 'old name' }), e('b', 15, 2000, { tk: 't2' }), e('c', 10, 3000, { h: true }), e('d', 5, 4000, { n: 'Lair' })];
  it('is nothing until the DM reveals it', () => {
    expect(toPub(state(entries, 'a', 1, false), tokens)).toBeNull();
  });
  it('leaves out lines marked secret and lines for hidden tokens, and uses current token names', () => {
    const pub = toPub(state(entries, 'a', 3, true), tokens)!;
    expect(pub.entries.map((x) => x.id)).toEqual(['a', 'd']);
    expect(pub.entries[0].n).toBe('Aria');
    expect(pub.round).toBe(3);
    expect(JSON.stringify(pub)).not.toContain('Ambusher');
  });
  it('does not point at a secret line when it is its turn', () => {
    expect(toPub(state(entries, 'b', 1, true), tokens)!.turn).toBeNull();
    expect(toPub(state(entries, 'd', 1, true), tokens)!.turn).toBe('d');
  });
  it('treats lines for tokens that no longer exist as public', () => {
    expect(entryIsPublic(e('z', 1, 0, { tk: 'gone' }), tokens)).toBe(true);
  });
});

describe('storing initiative', () => {
  it('round-trips through the database format', () => {
    const s = state([e('a', 12, 1000, { tk: 't1', n: 'Aria' }), e('b', 3, 2000, { h: true })], 'a', 2, true);
    const back = normalizeInit(JSON.parse(JSON.stringify(initToWire(s))));
    expect(back).toEqual(s);
  });
  it('writes nothing for an empty order and ignores a turn that points nowhere', () => {
    expect(initToWire(emptyInit())).toBeNull();
    expect(normalizeInit({ round: 1, turn: 'ghost', entries: { a: { i: 5, o: 1 } } }).turn).toBeNull();
    expect(normalizeInit(null)).toEqual(emptyInit());
  });
  it('reads the players\' copy and ignores an empty one', () => {
    const pub = { round: 1, turn: 'a', entries: [{ id: 'a', tk: 't1', n: 'Aria', i: 9, o: 1000 }] };
    expect(normalizeInitPub(JSON.parse(JSON.stringify(initPubToWire(pub))))).toEqual(pub);
    expect(normalizeInitPub({ round: 1 })).toBeNull();
    expect(initPubToWire(null)).toBeNull();
  });
});

describe('tokens: hit points and sight', () => {
  it('never writes hit points to the part of the database players can read', () => {
    const t = normalizeToken('t', { x: 1, y: 1, hp: 20, maxHp: 30, hpPct: 67, sight: 60 }, false);
    expect(t.hp).toBe(20);
    const wire = tokenToWire(t) as Record<string, unknown>;
    expect('hp' in wire).toBe(false);
    expect('maxHp' in wire).toBe(false);
    expect(wire.hpPct).toBe(67);
    expect(wire.sight).toBe(60);
  });
  it('shows party tokens as a bar and everything else as colour only, unless told otherwise', () => {
    expect(normalizeToken('a', { ownerUid: 'p1' }, false).hpShow).toBe('bar');
    expect(normalizeToken('b', {}, false).hpShow).toBe('state');
    expect(normalizeToken('c', { hpShow: 'off', ownerUid: 'p1' }, false).hpShow).toBe('off');
    expect(normalizeToken('d', { hpShow: 'nonsense' }, false).hpShow).toBe('state');
  });
  it('measures sight from the token\'s edge', () => {
    const grid = { ft: 5, cell: 70 };
    expect(sightRadiusPx({ sight: 0, size: 1 }, grid)).toBe(0);
    expect(sightRadiusPx({ sight: 60, size: 1 }, grid)).toBe(12 * 70 + 35);
    expect(sightRadiusPx({ sight: 30, size: 2 }, grid)).toBe(6 * 70 + 70);
  });
  it('lists only the tokens that can see something, at the position given', () => {
    const grid = { ft: 5, cell: 100 };
    const list = [{ id: 'a', x: 0, y: 0, size: 1, sight: 10 }, { id: 'b', x: 5, y: 5, size: 1, sight: 0 }];
    expect(visionCircles(list, grid)).toEqual([{ id: 'a', x: 0, y: 0, r: 250 }]);
    expect(visionCircles(list, grid, () => ({ x: 9, y: 9 }))[0]).toMatchObject({ x: 9, y: 9 });
  });
});

describe('light sources are not combatants', () => {
  const torch = { shape: 'none', img: null, light: { b: 20, d: 20, c: '#ffc27a' } } as any;
  it('knows a torch from a creature', () => {
    expect(isLightMark(torch)).toBe(true);
    expect(isLightMark({ ...torch, shape: 'circle' })).toBe(false); // a creature carrying a light
    expect(isLightMark({ ...torch, img: 'goblin.png' })).toBe(false); // borderless art
    expect(isLightMark({ shape: 'none', img: null, light: null } as any)).toBe(false); // an empty mark
  });
  it('takes them out of the order and moves the turn on', () => {
    const tokens = new Map<string, any>([['t', torch], ['g', { shape: 'circle', img: null, light: null }]]);
    const init = state([e('a', 20, 1, { tk: 't' }), e('b', 10, 2, { tk: 'g' }), e('c', 5, 3)], 'a', 3);
    const out = withoutLights(init, tokens);
    expect(out.entries.map((x) => x.id)).toEqual(['b', 'c']);
    expect(out.turn).toBe('b');
    expect(out.round).toBe(3);
    expect(withoutLights(state([e('b', 10, 2, { tk: 'g' })], 'b', 1), tokens).turn).toBe('b');
  });
  it('leaves the same object when there is nothing to take out, and ends combat when only lights were in it', () => {
    const tokens = new Map<string, any>([['t', torch]]);
    const plain = state([e('x', 1, 1)], 'x', 1);
    expect(withoutLights(plain, tokens)).toBe(plain);
    const onlyTorch = withoutLights(state([e('a', 20, 1, { tk: 't' })], 'a', 2), tokens);
    expect(onlyTorch.entries).toEqual([]);
    expect(onlyTorch.turn).toBeNull();
    expect(onlyTorch.round).toBe(0);
  });
});
