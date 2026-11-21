import { describe, expect, it } from 'vitest';
import { decodePoints, encodePoints, lineOp, paintOp, polyOp, rectOp } from '../src/core/fog';
import {
  distanceFt, fitCamera, gridFromRect, normRect, pointInToken, snapToCellCenter, snapToCorner, snapTokenCenter, zoomAt,
} from '../src/core/geometry';
import { normalizeSceneMeta, normalizeSettings, normalizeToken, tokenToWire } from '../src/core/model';
import { PRESETS, can, detectPreset, type PermCtx } from '../src/core/permissions';
import { emailKey, pushKey } from '../src/core/ids';
import type { GridSettings, Token } from '../src/types';

const grid = (over: Partial<GridSettings> = {}): GridSettings => ({
  cell: 70, ox: 0, oy: 0, visible: true, color: '#000', opacity: 0.3, ft: 5, rule: 'chebyshev', snap: true, ...over,
});

describe('grid snapping', () => {
  it('snaps a medium token so it sits centred in a square', () => {
    expect(snapTokenCenter(grid(), 1, { x: 100, y: 100 })).toEqual({ x: 105, y: 105 });
    expect(snapTokenCenter(grid(), 1, { x: 69, y: 36 })).toEqual({ x: 35, y: 35 });
  });
  it('snaps a large token to grid intersections', () => {
    expect(snapTokenCenter(grid(), 2, { x: 100, y: 100 })).toEqual({ x: 70, y: 70 });
    expect(snapTokenCenter(grid(), 2, { x: 130, y: 100 })).toEqual({ x: 140, y: 70 });
  });
  it('snaps tiny tokens to half squares', () => {
    const p = snapTokenCenter(grid(), 0.5, { x: 50, y: 50 });
    expect((p.x - 17.5) % 35).toBeCloseTo(0);
  });
  it('respects the grid offset', () => {
    const p = snapTokenCenter(grid({ ox: 10, oy: 20 }), 1, { x: 100, y: 100 });
    expect((p.x - 35 - 10) % 70).toBeCloseTo(0);
    expect((p.y - 35 - 20) % 70).toBeCloseTo(0);
  });
  it('snaps points to corners and cell centres', () => {
    expect(snapToCorner(grid(), { x: 100, y: 34 })).toEqual({ x: 70, y: 0 });
    expect(snapToCellCenter(grid(), { x: 100, y: 34 })).toEqual({ x: 105, y: 35 });
  });
});

describe('grid calibration from a drawn box', () => {
  it('derives square size and offset from a 1x1 box', () => {
    const g = gridFromRect({ x: 123, y: 47, w: 64, h: 64 });
    expect(g.cell).toBe(64);
    expect(g.ox).toBeCloseTo(59);
    expect(g.oy).toBeCloseTo(47);
  });
  it('averages width and height over many squares', () => {
    const g = gridFromRect({ x: 0, y: 0, w: 640, h: 420 }, 10, 6);
    expect(g.cell).toBeCloseTo(67);
  });
  it('handles boxes dragged up and to the left', () => {
    const g = gridFromRect({ x: 200, y: 200, w: -70, h: -70 });
    expect(g.cell).toBe(70);
    expect(g.ox).toBeCloseTo(60);
  });
});

describe('distance', () => {
  const g = grid();
  it('counts every diagonal as one square by default', () => {
    expect(distanceFt(g, { x: 0, y: 0 }, { x: 70 * 3, y: 70 * 3 })).toBe(15);
    expect(distanceFt(g, { x: 0, y: 0 }, { x: 70 * 4, y: 0 })).toBe(20);
  });
  it('supports 5-10-5 diagonals', () => {
    expect(distanceFt(g, { x: 0, y: 0 }, { x: 70 * 3, y: 70 * 3 }, 'alt')).toBe(20);
    expect(distanceFt(g, { x: 0, y: 0 }, { x: 70 * 2, y: 70 * 2 }, 'alt')).toBe(15);
  });
  it('supports true distance', () => {
    expect(distanceFt(g, { x: 0, y: 0 }, { x: 70 * 3, y: 70 * 4 }, 'euclid')).toBe(25);
  });
});

describe('camera', () => {
  it('keeps the point under the cursor fixed while zooming', () => {
    const cam = { zoom: 1, tx: 0, ty: 0 };
    const before = { x: (300 - cam.tx) / cam.zoom, y: (200 - cam.ty) / cam.zoom };
    const next = zoomAt(cam, 300, 200, 2);
    expect((300 - next.tx) / next.zoom).toBeCloseTo(before.x);
    expect((200 - next.ty) / next.zoom).toBeCloseTo(before.y);
    expect(next.zoom).toBe(2);
  });
  it('fits a rect inside the view and centres it', () => {
    const c = fitCamera(1000, 800, { x: 0, y: 0, w: 2000, h: 1000 }, 0);
    expect(c.zoom).toBeCloseTo(0.5);
    expect(c.tx + 1000 * c.zoom).toBeCloseTo(500);
    expect(c.ty + 500 * c.zoom).toBeCloseTo(400);
  });
});

describe('hit testing', () => {
  const base: Token = normalizeToken('a', { x: 100, y: 100, size: 1 }, false);
  it('circles do not include their corners', () => {
    expect(pointInToken(base, grid(), { x: 100, y: 100 })).toBe(true);
    expect(pointInToken(base, grid(), { x: 130, y: 130 })).toBe(false);
  });
  it('squares do', () => {
    expect(pointInToken({ ...base, shape: 'square' }, grid(), { x: 130, y: 130 })).toBe(true);
  });
  it('normRect orders corners', () => {
    expect(normRect({ x: 10, y: 20 }, { x: 4, y: 50 })).toEqual({ x: 4, y: 20, w: 6, h: 30 });
  });
});

describe('fog operations', () => {
  it('round-trips points', () => {
    const pts = [{ x: 1.26, y: 2 }, { x: 300, y: 400.44 }];
    expect(decodePoints(encodePoints(pts))).toEqual([{ x: 1.3, y: 2 }, { x: 300, y: 400.4 }]);
  });
  it('builds compact ops', () => {
    expect(rectOp('r', { x: 1, y: 2, w: 3, h: 4 })).toEqual({ m: 'r', t: 'rect', p: '1,2,3,4' });
    expect(polyOp('h', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]).p).toBe('0,0,1,1,2,0');
    expect(lineOp('r', [{ x: 0, y: 0 }], 70.04)).toMatchObject({ t: 'line', w: 70 });
  });
  it('paints reveal as erase and hide as paint', () => {
    const calls: string[] = [];
    const ctx: any = new Proxy({}, {
      get: (_t, k) => (typeof k === 'string' && ['save', 'restore', 'setTransform', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc'].includes(k) ? (...a: unknown[]) => calls.push(`${k}`) : undefined),
      set: (_t, k, v) => { if (k === 'globalCompositeOperation') calls.push(`op:${v}`); return true; },
    });
    paintOp(ctx, rectOp('r', { x: 0, y: 0, w: 10, h: 10 }), { x: 0, y: 0 }, 1);
    paintOp(ctx, rectOp('h', { x: 0, y: 0, w: 10, h: 10 }), { x: 0, y: 0 }, 1);
    expect(calls).toContain('op:destination-out');
    expect(calls).toContain('op:source-over');
    expect(calls.filter((c) => c === 'fillRect')).toHaveLength(2);
  });
});

describe('model normalisation', () => {
  it('fills defaults for sparse database values', () => {
    const t = normalizeToken('x', { x: 5 }, false);
    expect(t).toMatchObject({ id: 'x', x: 5, y: 0, size: 1, shape: 'circle', ownerUid: null, locked: false, label: 'all' });
    const m = normalizeSceneMeta({});
    expect(m.grid.cell).toBe(70);
    expect(m.mapLocked).toBe(true);
    expect(m.fog).toEqual({ enabled: false, base: 'hidden', vision: false, explore: false });
  });
  it('never writes undefined / null optional fields', () => {
    const wire = tokenToWire(normalizeToken('x', { x: 1, y: 2 }, true));
    expect('img' in wire).toBe(false);
    expect('ownerUid' in wire).toBe(false);
    expect('hidden' in wire).toBe(false);
    expect('id' in wire).toBe(false);
  });
  it('defaults settings to the trusting preset', () => {
    expect(normalizeSettings(null, PRESETS).perm).toEqual(PRESETS.trusting);
  });
  it('makes sortable keys and email keys', () => {
    const a = pushKey(1000), b = pushKey(1000), c = pushKey(2000);
    expect(a < b && b < c).toBe(true);
    expect(emailKey(' Me.Name@Gmail.com ')).toBe('me,name@gmail,com');
  });
});

describe('permissions', () => {
  const tok = (o: Partial<Token>) => normalizeToken('t', o, false);
  const ctx = (perm = PRESETS.trusting, role: 'dm' | 'player' = 'player', sceneActive = true): PermCtx => ({ role, uid: 'me', perm, sceneActive });
  it('lets the DM do everything', () => {
    expect(can(ctx(PRESETS.strict, 'dm', false), 'delete', tok({ locked: true }))).toBe(true);
  });
  it('trusting players move anything unlocked', () => {
    expect(can(ctx(), 'move', tok({ ownerUid: 'other' }))).toBe(true);
    expect(can(ctx(), 'move', tok({ locked: true }))).toBe(false);
  });
  it('standard players only move their own token', () => {
    expect(can(ctx(PRESETS.standard), 'move', tok({ ownerUid: 'other' }))).toBe(false);
    expect(can(ctx(PRESETS.standard), 'move', tok({ ownerUid: 'me' }))).toBe(true);
    expect(can(ctx(PRESETS.standard), 'delete', tok({ ownerUid: 'other' }))).toBe(false);
  });
  it('strict players cannot create', () => {
    expect(can(ctx(PRESETS.strict), 'create')).toBe(false);
    expect(can(ctx(PRESETS.strict), 'ping')).toBe(true);
  });
  it('only unclaimed tokens can be claimed', () => {
    expect(can(ctx(PRESETS.strict), 'claim', tok({ ownerUid: null }))).toBe(true);
    expect(can(ctx(PRESETS.strict), 'claim', tok({ ownerUid: 'x' }))).toBe(false);
  });
  it('players can do nothing outside the live scene', () => {
    expect(can(ctx(PRESETS.trusting, 'player', false), 'ping')).toBe(false);
  });
  it('detects presets', () => {
    expect(detectPreset(PRESETS.standard)).toBe('standard');
    expect(detectPreset({ ...PRESETS.standard, playersPing: false })).toBe('custom');
  });
});
