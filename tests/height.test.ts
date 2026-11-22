import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, drawingToWire, normalizeDrawing, normalizeToken, tokenToWire } from '../src/core/model';
import { altLabel, altitudeOf, fallDice, groundAt, heightChangeNote, heightNote, setAltitude, setClearance, zoneColor, zonesOf } from '../src/core/height';
import { distanceFt } from '../src/core/geometry';
import type { Drawing } from '../src/types';

const grid = { ...DEFAULT_GRID, cell: 100, ft: 5 };
const zone = (id: string, k: 'rect' | 'ellipse', p: string, hz: number | null): Drawing => normalizeDrawing(id, { uid: 'dm', k, p, hz })!;

describe('height zones', () => {
  const cliff = zone('cliff', 'rect', '0,0,1000,1000', 10);
  const nest = zone('nest', 'rect', '400,400,600,600', 40);
  const pond = zone('pond', 'ellipse', '700,700,900,900', -5);
  const zones = zonesOf([cliff, nest, pond, zone('plain', 'rect', '0,0,50,50', null)], grid);

  it('only boxes and circles with a height count', () => {
    expect(zones.areas.map((z) => z.id).sort()).toEqual(['cliff', 'nest', 'pond']);
    expect(normalizeDrawing('l', { uid: 'u', k: 'line', p: '0,0,5,5', hz: 10 })!.hz).toBeNull();
  });

  it('the smallest zone under a point wins, and no zone means ground level', () => {
    expect(groundAt(zones, { x: 500, y: 500 })).toBe(40);
    expect(groundAt(zones, { x: 100, y: 100 })).toBe(10);
    expect(groundAt(zones, { x: 800, y: 800 })).toBe(-5);
    expect(groundAt(zones, { x: 2000, y: 2000 })).toBe(0);
    // the corner of a circle's box is outside the circle
    expect(groundAt(zones, { x: 702, y: 702 })).toBe(10);
  });

  it('a height of zero is kept (it levels ground inside a higher area)', () => {
    const flat = zone('flat', 'rect', '100,100,200,200', 0);
    expect(flat.hz).toBe(0);
    expect(drawingToWire(flat).hz).toBe(0);
    expect(groundAt(zonesOf([cliff, flat], grid), { x: 150, y: 150 })).toBe(0);
    expect(drawingToWire(cliff).hz).toBe(10);
    expect(drawingToWire(zone('n', 'rect', '0,0,5,5', null)).hz).toBeUndefined();
  });
});

describe('token altitude', () => {
  it('walkers stand on the ground, flyers hold their altitude but never sink into it', () => {
    expect(altitudeOf({ fly: false, elev: 30 }, 10)).toEqual({ alt: 10, clear: 0, ground: 10 });
    expect(altitudeOf({ fly: true, elev: 30 }, 10)).toEqual({ alt: 30, clear: 20, ground: 10 });
    expect(altitudeOf({ fly: true, elev: 30 }, 40)).toEqual({ alt: 40, clear: 0, ground: 40 });
  });

  it('is saved on the token and read back', () => {
    const t = normalizeToken('a', { name: 'Eagle', fly: true, elev: 35 }, false);
    expect(t.fly).toBe(true);
    expect(t.elev).toBe(35);
    const wire = tokenToWire(t);
    expect(wire.fly).toBe(true);
    expect(wire.elev).toBe(35);
    const plain = tokenToWire(normalizeToken('b', { name: 'Walker', elev: 20 }, false));
    expect(plain.fly).toBeUndefined();
    expect(plain.elev).toBeUndefined();
  });

  it('putting a token at a height lands it when that is at or below the ground', () => {
    expect(setAltitude(30, 0)).toEqual({ fly: true, elev: 30 });
    expect(setAltitude(0, 0)).toEqual({ fly: false, elev: 0 });
    expect(setAltitude(10, 10)).toEqual({ fly: false, elev: 0 });
  });

  it('a flyer keeps its elevation, so its height above the ground follows the ground', () => {
    const bird = { fly: true, elev: 20 };
    expect(altitudeOf(bird, 0).clear).toBe(20);
    expect(altitudeOf(bird, -10).clear).toBe(30); // over a drop, still the same elevation but 30 ft up
    expect(altitudeOf(bird, 15).clear).toBe(5);
    expect(altLabel(altitudeOf(bird, -10), true)).toBe('↑30');
    expect(altLabel(altitudeOf(bird, 15), true)).toBe('↑5');
    expect(altitudeOf(bird, 40)).toEqual({ alt: 40, clear: 0, ground: 40 }); // never sinks into higher ground
  });

  it('height above the ground is turned into an elevation for the ground under it', () => {
    expect(setClearance(20, 10)).toEqual({ fly: true, elev: 30 });
    expect(setClearance(20, -10)).toEqual({ fly: true, elev: 10 });
    expect(setClearance(0, 10)).toEqual({ fly: false, elev: 0 });
    expect(setClearance(-5, 0)).toEqual({ fly: false, elev: 0 });
  });

  it('labels what is high or low', () => {
    expect(altLabel({ alt: 0, clear: 0, ground: 0 }, false)).toBe('');
    expect(altLabel({ alt: 30, clear: 30, ground: 0 }, true)).toBe('↑30');
    expect(altLabel({ alt: 30, clear: 20, ground: 10 }, true)).toBe('↑20'); // feet above the ground, not the base level
    expect(altLabel({ alt: 10, clear: 0, ground: 10 }, false)).toBe('▲10');
    expect(altLabel({ alt: -5, clear: 0, ground: -5 }, false)).toBe('▼5');
    expect(altLabel({ alt: 0, clear: 0, ground: 0 }, true)).toBe(''); // hovering at ground level is just standing
  });

  it('describes climbs and falls', () => {
    expect(heightChangeNote(0, 10)).toBe('climbs 10 ft');
    expect(heightChangeNote(40, 0)).toBe('drops 40 ft (4d6 if it falls)');
    expect(heightChangeNote(5, 0)).toBe('drops 5 ft');
    expect(heightChangeNote(0, 0)).toBe('');
    expect(fallDice(25)).toBe(2);
    expect(fallDice(500)).toBe(20);
  });

  it('colours zones by height', () => {
    expect(zoneColor(10)).not.toBe(zoneColor(40));
    expect(zoneColor(-10)).toMatch(/^#[0-9a-f]{6}$/);
    expect(zoneColor(0)).toBe('#a8b0ba');
  });
});

describe('distance with height', () => {
  const a = { x: 0, y: 0 };
  it('is unchanged when there is no height difference', () => {
    expect(distanceFt(grid, a, { x: 300, y: 400 })).toBe(20);
    expect(distanceFt(grid, a, { x: 300, y: 400 }, 'alt', 0)).toBe(25);
  });
  it('counts the height with the table rule', () => {
    // 30 ft across, 30 ft up
    const b = { x: 600, y: 0 };
    expect(distanceFt(grid, a, b, 'chebyshev', 30)).toBe(30);
    expect(distanceFt(grid, a, b, 'chebyshev', 40)).toBe(40);
    expect(distanceFt(grid, a, b, 'alt', 30)).toBe(45); // 6 squares + 3 for the second direction
    expect(distanceFt(grid, a, b, 'euclid', 30)).toBeCloseTo(42.4, 1);
    // going down counts the same as going up
    expect(distanceFt(grid, a, b, 'chebyshev', -40)).toBe(40);
  });
  it('describes it', () => {
    expect(heightNote(30, 20)).toBe(' (30 across, 20 up)');
    expect(heightNote(30, -10)).toBe(' (30 across, 10 down)');
    expect(heightNote(30, 0)).toBe('');
  });
});
