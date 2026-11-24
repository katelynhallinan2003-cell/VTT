import { describe, expect, it } from 'vitest';
import { normalizeSceneMeta, normalizeToken, normalizeTokenLight, tokenToWire } from '../src/core/model';

describe('light on tokens and scenes', () => {
  it('a scene is in daylight unless it says otherwise', () => {
    expect(normalizeSceneMeta({}).light.ambient).toBe('bright');
    expect(normalizeSceneMeta({ light: { ambient: 'dark' } }).light.ambient).toBe('dark');
    expect(normalizeSceneMeta({ light: { ambient: 'dim' } }).light.ambient).toBe('dim');
    expect(normalizeSceneMeta({ light: { ambient: 'pitch' } }).light.ambient).toBe('bright');
  });
  it('a light needs some reach and keeps a good colour', () => {
    expect(normalizeTokenLight(null)).toBeNull();
    expect(normalizeTokenLight({ b: 0, d: 0, c: '#fff' })).toBeNull();
    expect(normalizeTokenLight({ b: 20, d: 20, c: '#ffc27a' })).toEqual({ b: 20, d: 20, c: '#ffc27a' });
    expect(normalizeTokenLight({ b: 20, c: 'red' })).toEqual({ b: 20, d: 0, c: '#ffd9a0' });
    expect(normalizeTokenLight({ b: -5, d: 10, c: '#abcdef' })).toEqual({ b: 0, d: 10, c: '#abcdef' });
    expect(normalizeTokenLight({ b: 99999, d: 0, c: '#abcdef' })!.b).toBe(1000);
  });
  it('a token reads its darkvision and light back, and a plain one has neither', () => {
    const plain = normalizeToken('a', { name: 'x' }, false);
    expect(plain.dv).toBe(0);
    expect(plain.light).toBeNull();
    const t = normalizeToken('b', { name: 'y', dv: 60, light: { b: 30, d: 30, c: '#ffe2ae' } }, false);
    expect(t.dv).toBe(60);
    expect(t.light).toEqual({ b: 30, d: 30, c: '#ffe2ae' });
  });
  it('the saved form leaves out what is not there', () => {
    const plain = tokenToWire(normalizeToken('a', { name: 'x' }, false));
    expect('dv' in plain).toBe(false);
    expect('light' in plain).toBe(false);
    const lit = tokenToWire(normalizeToken('b', { name: 'y', dv: 60, light: { b: 20, d: 20, c: '#ffc27a' } }, false));
    expect(lit.dv).toBe(60);
    expect(lit.light).toEqual({ b: 20, d: 20, c: '#ffc27a' });
  });
});

describe('the marker of a light-only mark can be hidden while the light stays public', () => {
  const lamp = { name: 'Lamp', shape: 'none', size: 0.5, light: { b: 20, d: 20, c: '#ffc27a' } };
  it('`hide` is read for a light-only mark, and written only for one', () => {
    expect(normalizeToken('a', { ...lamp, hide: true }, false).hidden).toBe(true);
    expect(normalizeToken('a', lamp, false).hidden).toBe(false);
    // a creature, a picture or a mark with no light cannot be hidden this way: that is the DM-only part's job
    expect(normalizeToken('a', { ...lamp, shape: 'circle', hide: true }, false).hidden).toBe(false);
    expect(normalizeToken('a', { ...lamp, img: 'x.png', hide: true }, false).hidden).toBe(false);
    expect(normalizeToken('a', { name: 'x', shape: 'none', hide: true }, false).hidden).toBe(false);
    expect(tokenToWire(normalizeToken('a', { ...lamp, hide: true }, false)).hide).toBe(true);
    expect('hide' in tokenToWire(normalizeToken('a', lamp, false))).toBe(false);
    expect('hide' in tokenToWire(normalizeToken('a', { name: 'orc' }, true))).toBe(false);
  });
});
