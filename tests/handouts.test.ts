import { describe, expect, it } from 'vitest';
import { handoutToWire, normalizeHandout, normalizeMeta } from '../src/core/model';

describe('handouts', () => {
  it('a bare record is a handout nobody has been shown', () => {
    const h = normalizeHandout('a', {});
    expect(h).toEqual({ id: 'a', title: '', text: '', img: null, to: null, shown: false, n: 0, createdAt: 0 });
  });
  it('reads a handout shown to some players, however the list was stored', () => {
    expect(normalizeHandout('a', { title: 'Letter', shown: true, n: 5, to: { u1: true, u2: true, u3: false } }).to).toEqual(['u1', 'u2']);
    expect(normalizeHandout('a', { to: ['u1', 7, 'u2'] }).to).toEqual(['u1', 'u2']);
    expect(normalizeHandout('a', { to: {} }).to).toBeNull();
    expect(normalizeHandout('a', { to: 'everyone' }).to).toBeNull();
  });
  it('keeps a picture only when it is an address, and caps long text', () => {
    expect(normalizeHandout('a', { img: '' }).img).toBeNull();
    expect(normalizeHandout('a', { img: 5 }).img).toBeNull();
    expect(normalizeHandout('a', { img: 'https://i.example/x.png' }).img).toBe('https://i.example/x.png');
    expect(normalizeHandout('a', { text: 'x'.repeat(30000) }).text.length).toBe(20000);
    expect(normalizeHandout('a', { title: 'y'.repeat(500) }).title.length).toBe(120);
  });
  it('goes to the database and back unchanged', () => {
    const h = { id: 'a', title: 'Torn map', text: 'north', img: 'https://i.example/m.png', to: ['u1', 'u2'], shown: true, n: 99, createdAt: 12 };
    const wire = handoutToWire(h);
    expect(wire.to).toEqual({ u1: true, u2: true });
    expect(normalizeHandout('a', wire)).toEqual(h);
  });
  it('leaves empty things out of what is stored', () => {
    const wire = handoutToWire({ id: 'a', title: 'T', text: '', img: null, to: null, shown: false, n: 0, createdAt: 1 });
    expect(Object.keys(wire).sort()).toEqual(['createdAt', 'title']);
  });
});

describe('calling everyone to one spot', () => {
  it('the table keeps the last call, and none when there has been none', () => {
    expect(normalizeMeta({}).view).toBeNull();
    const m = normalizeMeta({ view: { sid: 's1', x: 10, y: 20, w: 300, h: 200, n: 4 } });
    expect(m.view).toEqual({ sid: 's1', x: 10, y: 20, w: 300, h: 200, n: 4 });
  });
  it('ignores a call without a scene or a size, and defaults a missing corner', () => {
    expect(normalizeMeta({ view: { x: 1, y: 2, w: 300, h: 200, n: 4 } }).view).toBeNull();
    expect(normalizeMeta({ view: { sid: 's1', x: 1, y: 2, w: 0, h: 200, n: 4 } }).view).toBeNull();
    expect(normalizeMeta({ view: { sid: 's1', x: 'a', y: 20, w: 300, h: 200, n: 4 } }).view).toEqual({ sid: 's1', x: 0, y: 20, w: 300, h: 200, n: 4 });
  });
});
