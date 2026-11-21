import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, normalizeAuras, normalizeDrawing, normalizeLive } from '../src/core/model';
import {
  beamWidthPx, dashSegments, distToSegment, fitPenPoints, hitDrawing, joinPts, movedPoints, parsePts, pointInPoly,
  simplify, snapTemplate, templateFt, templateGeom, templateLabel, MAX_PEN_POINTS,
} from '../src/core/draw';
import type { Drawing } from '../src/types';

const grid = { ...DEFAULT_GRID, cell: 100, ft: 5 };
const d = (over: Partial<Drawing>): Drawing => ({ id: 'x', uid: 'u', k: 'pen', p: '', color: '#f00', w: 4, fill: 0, dash: false, txt: '', fs: 28, bw: 5, t: 0, ...over });

describe('points', () => {
  it('round-trips and ignores junk', () => {
    expect(parsePts('1,2,3.5,4')).toEqual([{ x: 1, y: 2 }, { x: 3.5, y: 4 }]);
    expect(parsePts('1,2,x,4,5')).toEqual([{ x: 1, y: 2 }]);
    expect(joinPts([{ x: 1.04, y: 2.06 }])).toBe('1,2.1');
  });
  it('simplifies a straight run to its ends and keeps corners', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplify(line, 0.5)).toHaveLength(2);
    const corner = [...line, ...Array.from({ length: 50 }, (_, i) => ({ x: 49, y: i + 1 }))];
    expect(simplify(corner, 0.5)).toHaveLength(3);
  });
  it('squeezes a long scribble under the point budget', () => {
    const wiggle = Array.from({ length: 6000 }, (_, i) => ({ x: i, y: Math.sin(i / 3) * 20 + (i % 7) }));
    expect(fitPenPoints(wiggle, 0.2).length).toBeLessThanOrEqual(MAX_PEN_POINTS);
  });
});

describe('spell templates', () => {
  const a = { x: 0, y: 0 };
  it('measures a template in feet from the grid', () => {
    expect(templateFt(grid, a, { x: 300, y: 0 })).toBe(15);
    expect(templateFt({ ...grid, ft: 10 }, a, { x: 300, y: 0 })).toBe(30);
  });
  it('a sphere is a circle of the dragged radius', () => {
    expect(templateGeom('sphere', a, { x: 400, y: 0 }, 0)).toEqual({ type: 'circle', c: a, r: 400 });
  });
  it('a cone is as wide at the far end as it is long', () => {
    const g = templateGeom('cone', a, { x: 300, y: 0 }, 0);
    expect(g.type).toBe('poly');
    if (g.type !== 'poly') return;
    expect(g.pts[0]).toEqual(a);
    expect(Math.abs(g.pts[1].y - g.pts[2].y)).toBeCloseTo(300);
    expect(g.pts[1].x).toBeCloseTo(300);
  });
  it('a cube has equal sides and is centred on its origin face', () => {
    const g = templateGeom('cube', a, { x: 0, y: 200 }, 0);
    if (g.type !== 'poly') throw new Error('poly');
    const xs = g.pts.map((p) => p.x);
    const ys = g.pts.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(200);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(200);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0);
  });
  it('a line template is as wide as asked', () => {
    expect(beamWidthPx(grid, 10)).toBe(200);
    const g = templateGeom('beam', a, { x: 600, y: 0 }, beamWidthPx(grid, 5));
    if (g.type !== 'poly') throw new Error('poly');
    expect(Math.abs(g.pts[0].y - g.pts[3].y)).toBeCloseTo(100);
  });
  it('labels read naturally', () => {
    expect(templateLabel('sphere', grid, a, { x: 400, y: 0 }, 5)).toBe('20 ft radius');
    expect(templateLabel('cone', grid, a, { x: 300, y: 0 }, 5)).toBe('15 ft cone');
    expect(templateLabel('beam', grid, a, { x: 600, y: 0 }, 10)).toBe('30 ft × 10 ft line');
  });
  it('snaps the origin to a corner and the length to whole squares', () => {
    const s = snapTemplate(grid, { x: 108, y: 93 }, { x: 441, y: 98 }, { origin: true, length: true });
    expect(s.a).toEqual({ x: 100, y: 100 });
    expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeCloseTo(300);
  });
  it('locks the direction when asked', () => {
    const s = snapTemplate(grid, { x: 0, y: 0 }, { x: 300, y: 90 }, { origin: false, length: false, angleStep: Math.PI / 4 });
    expect(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x)).toBeCloseTo(Math.PI / 4 * Math.round(Math.atan2(90, 300) / (Math.PI / 4)));
  });
});

describe('hit testing', () => {
  it('finds a pen stroke near its path only', () => {
    const pen = d({ k: 'pen', p: '0,0,100,0,100,100' });
    expect(hitDrawing(pen, { x: 50, y: 3 }, 4, grid)).toBe(true);
    expect(hitDrawing(pen, { x: 50, y: 40 }, 4, grid)).toBe(false);
    expect(hitDrawing(pen, { x: 103, y: 60 }, 4, grid)).toBe(true);
  });
  it('rectangles are hollow unless filled', () => {
    const r = d({ k: 'rect', p: '0,0,100,100' });
    expect(hitDrawing(r, { x: 50, y: 50 }, 3, grid)).toBe(false);
    expect(hitDrawing(r, { x: 1, y: 50 }, 3, grid)).toBe(true);
    expect(hitDrawing(r, { x: 150, y: 50 }, 3, grid)).toBe(false);
    expect(hitDrawing({ ...r, fill: 0.3 }, { x: 50, y: 50 }, 3, grid)).toBe(true);
  });
  it('ellipses are hollow unless filled', () => {
    const e = d({ k: 'ellipse', p: '0,0,200,100' });
    expect(hitDrawing(e, { x: 100, y: 50 }, 3, grid)).toBe(false);
    expect(hitDrawing(e, { x: 200, y: 50 }, 3, grid)).toBe(true);
    expect(hitDrawing({ ...e, fill: 0.2 }, { x: 100, y: 50 }, 3, grid)).toBe(true);
  });
  it('templates count as solid areas', () => {
    const cone = d({ k: 'cone', p: '0,0,300,0' });
    expect(hitDrawing(cone, { x: 200, y: 20 }, 0, grid)).toBe(true);
    expect(hitDrawing(cone, { x: 50, y: 120 }, 0, grid)).toBe(false);
    const sph = d({ k: 'sphere', p: '0,0,200,0' });
    expect(hitDrawing(sph, { x: 100, y: 100 }, 0, grid)).toBe(true);
    expect(hitDrawing(sph, { x: 190, y: 190 }, 0, grid)).toBe(false);
  });
  it('with solid off, only outlines and a template origin are hit', () => {
    const filled = d({ k: 'rect', p: '0,0,100,100', fill: 0.3 });
    expect(hitDrawing(filled, { x: 50, y: 50 }, 3, grid, false)).toBe(false);
    expect(hitDrawing(filled, { x: 1, y: 50 }, 3, grid, false)).toBe(true);
    const sph = d({ k: 'sphere', p: '0,0,200,0' });
    expect(hitDrawing(sph, { x: 100, y: 50 }, 2, grid, false)).toBe(false);
    expect(hitDrawing(sph, { x: 200, y: 2 }, 2, grid, false)).toBe(true);
    expect(hitDrawing(sph, { x: 3, y: 3 }, 2, grid, false)).toBe(true);
    const cone = d({ k: 'cone', p: '0,0,300,0' });
    expect(hitDrawing(cone, { x: 200, y: 20 }, 2, grid, false)).toBe(false);
    expect(hitDrawing(cone, { x: 150, y: 75 }, 2, grid, false)).toBe(true);
  });
  it('text is hit inside its box', () => {
    const t = d({ k: 'text', p: '100,100', txt: 'Hello', fs: 30 });
    expect(hitDrawing(t, { x: 120, y: 90 }, 0, grid)).toBe(true);
    expect(hitDrawing(t, { x: 400, y: 90 }, 0, grid)).toBe(false);
  });
  it('moves every point', () => {
    expect(movedPoints({ p: '0,0,10,10' }, 5, -5)).toBe('5,-5,15,5');
  });
  it('helper maths', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(pointInPoly({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }])).toBe(true);
    expect(pointInPoly({ x: 5, y: 1 }, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }])).toBe(false);
  });
  it('splits a line into dashes', () => {
    const segs = dashSegments([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, 10);
    expect(segs).toHaveLength(5);
    expect(segs[0][0].x).toBe(0);
    expect(segs[0][1].x).toBeCloseTo(10);
    expect(segs[1][0].x).toBeCloseTo(20);
  });
});

describe('normalisers', () => {
  it('fills in defaults and rejects unknown kinds', () => {
    expect(normalizeDrawing('a', { k: 'nope', p: '1,1' })).toBeNull();
    expect(normalizeDrawing('a', { k: 'line', p: '1,1,2,2' })).toMatchObject({ id: 'a', k: 'line', w: 4, fill: 0, dash: false, bw: 5 });
  });
  it('auras survive the database turning arrays into objects', () => {
    const list = normalizeAuras({ 0: { r: 10, color: '#fff' }, 1: { r: 30, shape: 'square', edge: false, dm: true, a: 0.5 } });
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ r: 30, shape: 'square', edge: false, dm: true, a: 0.5 });
    expect(normalizeAuras(undefined)).toEqual([]);
    expect(normalizeAuras(new Array(9).fill({ r: 5 }))).toHaveLength(6);
  });
  it('live plotting needs something to show', () => {
    expect(normalizeLive('u', {})).toBeNull();
    expect(normalizeLive('u', { ruler: { ax: 1, ay: 2, bx: 3, by: 4 } })).toMatchObject({ ruler: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } } });
    expect(normalizeLive('u', { ghosts: { t1: { x: 5, y: 6 } } })!.ghosts.t1).toEqual({ x: 5, y: 6 });
  });
});
