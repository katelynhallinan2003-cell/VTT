import { describe, expect, it } from 'vitest';
import { normalizeToken, tokenToWire } from '../src/core/model';
import { cleanSavedName, normalizeSavedToken, sameSaved, savedFields, tokenFromSaved } from '../src/core/tokenlib';

const goblin = () => normalizeToken('t1', {
  name: 'Goblin boss', img: 'https://i.example/g.png', x: 300, y: 420, z: 7, size: 2, shape: 'square', ring: '#ff0000', ringW: 0.1,
  imgScale: 1.4, imgX: 0.1, imgY: -0.2, imgBg: '#223344', auras: [{ r: 10, color: '#ff6b6b' }],
  hp: 12, maxHp: 30, hpShow: 'bar', hpPct: 40, sight: 60, dv: 60, light: { b: 20, d: 20, c: '#ffc27a' }, fly: true, elev: 15, initBonus: 3,
  fx: [{ id: 'e1', n: 'Poisoned', c: '#51cf66' }], ownerUid: 'u1', locked: true, label: 'dm',
}, true);

describe('saving a token', () => {
  it('keeps its look and settings but not where it stands, who owns it, or its health right now', () => {
    const t = savedFields(goblin(), { character: false });
    expect(t).toMatchObject({ name: 'Goblin boss', img: 'https://i.example/g.png', size: 2, shape: 'square', ring: '#ff0000', imgScale: 1.4, imgBg: '#223344', sight: 60, dv: 60, initBonus: 3, maxHp: 30, label: 'dm' });
    expect(t.light).toEqual({ b: 20, d: 20, c: '#ffc27a' });
    expect((t.auras as any[])[0]).toMatchObject({ r: 10, color: '#ff6b6b' });
    for (const k of ['x', 'y', 'z', 'ownerUid', 'hpPct', 'hpNow', 'hpCap', 'locked', 'fly', 'elev', 'hp', 'cid']) expect(k in t).toBe(false);
  });
  it('a template forgets conditions; it remembers that it was hidden', () => {
    const t = savedFields(goblin(), { character: false });
    expect('fx' in t).toBe(false);
    expect(t.hidden).toBe(true);
  });
  it('a character keeps its conditions and is tied to its entry', () => {
    const t = savedFields(goblin(), { character: true, cid: 'C1' });
    expect((t.fx as any[])[0].n).toBe('Poisoned');
    expect(t.cid).toBe('C1');
    expect('hidden' in t).toBe(false);
  });
  it('stays small and plain enough to store', () => {
    const t = savedFields(goblin(), { character: true, cid: 'C1' });
    expect(JSON.stringify(t).length).toBeLessThan(1500);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t); // no undefined, no classes
  });
});

describe('reading an entry back', () => {
  it('cleans names and refuses entries that are not entries', () => {
    expect(cleanSavedName('  Big   Bad  ')).toBe('Big Bad');
    expect(cleanSavedName(3)).toBe('');
    expect(normalizeSavedToken('a', null)).toBeNull();
    expect(normalizeSavedToken('a', { name: 'x' })).toBeNull();
    expect(normalizeSavedToken('a', { name: 'x', t: [] })).toBeNull();
    expect(normalizeSavedToken('a', { name: 'x', t: { junk: 'y'.repeat(20000) } })).toBeNull();
    expect(normalizeSavedToken('a', { t: { name: 'From inside' }, addedAt: 5 })).toEqual({ id: 'a', name: 'From inside', addedAt: 5, t: { name: 'From inside' } });
  });
});

describe('making a token from a saved one', () => {
  const entry = (character: boolean) => normalizeSavedToken('L1', { name: 'Goblin boss', addedAt: 1, t: savedFields(goblin(), { character, cid: 'L1' }) })!;
  it('DM: full health, hidden as it was saved, no owner, placed where asked', () => {
    const t = tokenFromSaved(entry(false), { x: 140, y: 210 }, { dm: true, owner: null });
    expect(t).toMatchObject({ x: 140, y: 210, name: 'Goblin boss', size: 2, shape: 'square', hp: 30, maxHp: 30, hidden: true, ownerUid: null, sight: 60, initBonus: 3, cid: null });
    expect(t.fx).toEqual([]);
    expect(t.light).toEqual({ b: 20, d: 20, c: '#ffc27a' });
  });
  it('a player: owned by them, tied to the character, conditions back on, no hit points of its own', () => {
    const t = tokenFromSaved(entry(true), { x: 70, y: 70 }, { dm: false, owner: 'u9', cid: 'L1' });
    expect(t).toMatchObject({ ownerUid: 'u9', cid: 'L1', hidden: false, x: 70, y: 70 });
    expect(t.fx?.[0].n).toBe('Poisoned');
  });
  it('round-trips through the token wire format without losing anything that was saved', () => {
    const t = tokenFromSaved(entry(true), { x: 1, y: 2 }, { dm: false, owner: 'u9', cid: 'L1' });
    const back = normalizeToken('n', tokenToWire({ id: 'n', ...(t as any) }), false);
    expect(back.img).toBe('https://i.example/g.png');
    expect(back.auras[0]).toMatchObject({ r: 10, color: '#ff6b6b' });
    expect(back.cid).toBe('L1');
    expect(back.fx[0].n).toBe('Poisoned');
  });
});

describe('comparing saved settings', () => {
  it('ignores key order and whether a list came back as an array or an index-keyed object', () => {
    expect(sameSaved({ a: 1, b: [{ x: 1, y: 2 }] }, { b: { 0: { y: 2, x: 1 } }, a: 1 })).toBe(true);
    expect(sameSaved({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameSaved({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameSaved({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
