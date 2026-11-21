import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, normalizeAuras, normalizeDrawing, normalizeLive } from '../src/core/model';
import {
  beamWidthPx, dashSegments, distToSegment, drawingBounds, fillModeOf, fitPenPoints, handlesOf, hitDrawing, joinPts, movedPoints, parsePts, pointInPoly,
  resizeDrawing, simplify, sizeFt, snapToEdgeMid, snapTemplate, templateFt, templateGeom, templateLabel, textMetrics, withSizeFt, MAX_PEN_POINTS,
} from '../src/core/draw';
import { cellPoly, coveredCells } from '../src/core/cells';
import type { Drawing } from '../src/types';

const grid = { ...DEFAULT_GRID, cell: 100, ft: 5 };
const d = (over: Partial<Drawing>): Drawing => ({ id: 'x', uid: 'u', k: 'pen', p: '', color: '#f00', w: 4, fill: 0, fc: '', dash: false, txt: '', fs: 28, font: '', b: false, i: false, u: false, ho: false, bw: 5, hz: null, t: 0, ...over });

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
  it('snaps the origin to a corner (when asked) and the length to whole squares', () => {
    const s = snapTemplate(grid, { x: 108, y: 93 }, { x: 441, y: 98 }, { origin: true, length: true, sphereAt: 'corner' });
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
    expect(hitDrawing(t, { x: 120, y: 110 }, 0, grid)).toBe(true);
    expect(hitDrawing(t, { x: 120, y: 90 }, 0, grid)).toBe(false);
    expect(hitDrawing(t, { x: 400, y: 110 }, 0, grid)).toBe(false);
  });
  it('a solid shape is hit inside even when only outlines are asked for; a see-through one is not', () => {
    const solid = d({ k: 'rect', p: '0,0,100,100', fill: 1 });
    const light = d({ k: 'rect', p: '0,0,100,100', fill: 0.3 });
    expect(hitDrawing(solid, { x: 50, y: 50 }, 3, grid, false)).toBe(true);
    expect(hitDrawing(light, { x: 50, y: 50 }, 3, grid, false)).toBe(false);
    expect(hitDrawing(light, { x: 50, y: 50 }, 3, grid, true)).toBe(true);
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

describe('spell templates on the grid (2024 rules)', () => {
  const T = (kind: any, a: any, b: any, over: any = {}) => snapTemplate(grid, a, b, { origin: true, length: true, kind, widthPx: 100, ...over });
  it('a cone starts in the middle of a square edge', () => {
    expect(snapToEdgeMid(grid, { x: 98, y: 52 })).toEqual({ x: 100, y: 50 });
    expect(snapToEdgeMid(grid, { x: 148, y: 103 })).toEqual({ x: 150, y: 100 });
    const s = T('cone', { x: 98, y: 52 }, { x: 398, y: 52 });
    expect(s.a).toEqual({ x: 100, y: 50 });
    expect(s.b.x).toBeCloseTo(400, 0);
    expect(s.b.y).toBeCloseTo(50, -1);
  });
  it('an emanation is centred on a square and counted from its edge', () => {
    const s = T('emanation', { x: 130, y: 60 }, { x: 320, y: 50 });
    expect(s.a).toEqual({ x: 150, y: 50 });
    expect(s.b.x).toBeCloseTo(300); // 1.5 squares from the centre = 1 square past the edge
    expect(templateFt(grid, s.a, s.b, 'emanation')).toBe(5);
    expect(templateFt(grid, s.a, T('emanation', { x: 130, y: 60 }, { x: 430, y: 50 }).b, 'emanation')).toBe(10);
    expect(templateLabel('emanation', grid, s.a, s.b, 5)).toBe('5 ft emanation');
    const g = templateGeom('emanation', s.a, s.b, 100);
    expect(g.type).toBe('poly');
    // never smaller than one square past the edge
    expect(templateFt(grid, s.a, T('emanation', { x: 130, y: 60 }, { x: 160, y: 50 }).b, 'emanation')).toBe(5);
  });
  it('a sphere starts in the middle of a square, or on a corner when asked', () => {
    expect(T('sphere', { x: 108, y: 93 }, { x: 441, y: 98 }).a).toEqual({ x: 150, y: 50 });
    expect(T('sphere', { x: 108, y: 93 }, { x: 441, y: 98 }, { sphereAt: 'corner' }).a).toEqual({ x: 100, y: 100 });
  });
  it('a cube lines up with the squares it covers, odd or even', () => {
    const odd = T('cube', { x: 105, y: 240 }, { x: 405, y: 240 }); // 3 squares wide
    expect(odd.a).toEqual({ x: 100, y: 250 });
    expect(odd.b.x).toBeCloseTo(400);
    const even = T('cube', { x: 105, y: 240 }, { x: 305, y: 240 }); // 2 squares wide
    expect(even.a).toEqual({ x: 100, y: 200 });
    // going down a column works the same way
    const down = T('cube', { x: 240, y: 105 }, { x: 240, y: 405 });
    expect(down.a).toEqual({ x: 250, y: 100 });
    expect(down.b.y).toBeCloseTo(400);
    // pointing diagonally leaves it free to turn
    const diag = T('cube', { x: 100, y: 100 }, { x: 400, y: 400 });
    expect(Math.abs(diag.b.x - diag.a.x)).toBeGreaterThan(150);
    expect(Math.abs(diag.b.y - diag.a.y)).toBeGreaterThan(150);
  });
  it('a straight line covers whole rows', () => {
    const s = T('beam', { x: 100, y: 330 }, { x: 500, y: 335 });
    expect(s.a).toEqual({ x: 100, y: 350 });
    expect(s.b.y).toBeCloseTo(350);
    const wide = T('beam', { x: 100, y: 330 }, { x: 500, y: 335 }, { widthPx: 200 }); // 10 ft: straddles a grid line
    expect(wide.a).toEqual({ x: 100, y: 300 });
    // a slanted line is left alone
    const slant = T('beam', { x: 100, y: 100 }, { x: 500, y: 300 });
    expect(slant.b.y - slant.a.y).toBeGreaterThan(100);
  });
  it('turning snapping off leaves the start where it was clicked', () => {
    const s = T('cone', { x: 98, y: 52 }, { x: 398, y: 52 }, { origin: false });
    expect(s.a).toEqual({ x: 98, y: 52 });
  });
});

describe('text', () => {
  it('measures lines and grows with more of them', () => {
    const one = textMetrics({ txt: 'Hello', fs: 30, font: '', b: false, i: false });
    const two = textMetrics({ txt: 'Hello\nWorld!', fs: 30, font: '', b: false, i: false });
    expect(one.lines).toHaveLength(1);
    expect(two.lines).toHaveLength(2);
    expect(two.h).toBeCloseTo(one.h * 2);
    expect(two.w).toBeGreaterThanOrEqual(one.w);
  });
  it('its box starts at the point (top-left) and bold text is wider', () => {
    const t = d({ k: 'text', p: '100,200', txt: 'Hello', fs: 30 });
    const b = drawingBounds(t);
    expect(b.x).toBe(100);
    expect(b.y).toBe(200);
    expect(drawingBounds({ ...t, b: true }).w).toBeGreaterThan(b.w);
  });
});

describe('handles and resizing', () => {
  const box = d({ k: 'rect', p: '100,100,300,200' });
  it('a box has eight handles, a line two, a template one, a pen none', () => {
    expect(handlesOf(box)).toHaveLength(8);
    expect(handlesOf(d({ k: 'line', p: '0,0,50,50' })).map((h) => h.id)).toEqual(['a', 'b']);
    expect(handlesOf(d({ k: 'cone', p: '0,0,100,0' })).map((h) => h.id)).toEqual(['b']);
    expect(handlesOf(d({ k: 'pen', p: '0,0,5,5,9,9' }))).toEqual([]);
    expect(handlesOf(d({ k: 'text', p: '10,10', txt: 'Hi' })).map((h) => h.id)).toEqual(['se']);
  });
  it('dragging an edge moves only that edge', () => {
    expect(resizeDrawing(box, 'e', { x: 400, y: 999 }, { grid }).p).toBe('100,100,400,200');
    expect(resizeDrawing(box, 'n', { x: 999, y: 50 }, { grid }).p).toBe('100,50,300,200');
  });
  it('dragging a corner past the opposite one flips the box instead of inverting it', () => {
    expect(resizeDrawing(box, 'se', { x: 50, y: 20 }, { grid }).p).toBe('50,20,100,100');
  });
  it('shift keeps the proportions of a box', () => {
    // 200 x 100 box, drag the corner to (500, 200): width grows 2x so height must too
    expect(resizeDrawing(box, 'se', { x: 500, y: 150 }, { grid, shift: true }).p).toBe('100,100,500,300');
  });
  it('a line end moves and shift snaps its angle', () => {
    const ln = d({ k: 'line', p: '0,0,100,0' });
    expect(resizeDrawing(ln, 'b', { x: 100, y: 100 }, { grid }).p).toBe('0,0,100,100');
    const locked = parsePts(resizeDrawing(ln, 'b', { x: 100, y: 5 }, { grid, shift: true }).p!);
    expect(locked[1].y).toBeCloseTo(0, 0);
    expect(resizeDrawing(ln, 'a', { x: -50, y: 0 }, { grid }).p).toBe('-50,0,100,0');
  });
  it('text scales with its corner and stays in range', () => {
    const t = d({ k: 'text', p: '0,0', txt: 'Hello', fs: 30 });
    const b = drawingBounds(t);
    expect(resizeDrawing(t, 'se', { x: b.w * 2, y: b.h * 2 }, { grid }).fs).toBeCloseTo(60, 0);
    expect(resizeDrawing(t, 'se', { x: 0, y: 0 }, { grid }).fs).toBeGreaterThanOrEqual(6);
    expect(resizeDrawing(t, 'se', { x: 1e6, y: 1e6 }, { grid }).fs).toBe(400);
  });
  it('a template end sets its length (whole squares) and direction', () => {
    const cone = d({ k: 'cone', p: '0,0,100,0' });
    expect(resizeDrawing(cone, 'b', { x: 296, y: 0 }, { grid }).p).toBe('0,0,300,0');
    expect(resizeDrawing(cone, 'b', { x: 296, y: 0 }, { grid, alt: true }).p).toBe('0,0,296,0');
  });
  it('sizes in feet and back', () => {
    expect(sizeFt(box, grid)).toEqual({ w: 10, h: 5 });
    expect(sizeFt(d({ k: 'line', p: '0,0,300,400' }), grid)).toEqual({ len: 25 });
    expect(sizeFt(d({ k: 'pen', p: '0,0,3,3' }), grid)).toBeNull();
    expect(withSizeFt(box, grid, 'w', 20).p).toBe('100,100,500,200');
    expect(withSizeFt(box, grid, 'h', 15).p).toBe('100,100,300,400');
    expect(withSizeFt(d({ k: 'line', p: '0,0,300,400' }), grid, 'len', 50).p).toBe('0,0,600,800');
    expect(withSizeFt(box, grid, 'w', 0)).toEqual({});
  });
  it('fill modes', () => {
    expect(fillModeOf(0)).toBe('none');
    expect(fillModeOf(0.3)).toBe('light');
    expect(fillModeOf(1)).toBe('solid');
  });
});

describe('normalisers', () => {
  it('fills in defaults and rejects unknown kinds', () => {
    expect(normalizeDrawing('a', { k: 'nope', p: '1,1' })).toBeNull();
    expect(normalizeDrawing('a', { k: 'line', p: '1,1,2,2' })).toMatchObject({ id: 'a', k: 'line', w: 4, fill: 0, dash: false, bw: 5, fc: '', font: '', b: false, i: false, u: false, ho: false });
  });
  it('keeps text styling and fill colour, and drops junk', () => {
    const t = normalizeDrawing('a', { k: 'text', p: '1,1', txt: 'Hi\nthere', font: 'serif', b: true, i: true, u: true, ho: true, fc: '#00ff00', fs: 40 })!;
    expect(t).toMatchObject({ txt: 'Hi\nthere', font: 'serif', b: true, i: true, u: true, ho: true, fc: '#00ff00', fs: 40 });
    expect(normalizeDrawing('a', { k: 'text', p: '1,1', font: 'comic-sans-xl', fc: 'red' })).toMatchObject({ font: '', fc: '' });
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
    expect(normalizeLive('u', { ruler: { ax: 1, ay: 2, bx: 3, by: 4, c: '#ff0000' } })!.ruler!.c).toBe('#ff0000');
    expect(normalizeLive('u', { ruler: { ax: 1, ay: 2, bx: 3, by: 4, c: 'nope' } })!.ruler!.c).toBeUndefined();
    expect(normalizeLive('u', { ghosts: { t1: { x: 5, y: 6 } } })!.ghosts.t1).toEqual({ x: 5, y: 6 });
  });
});

describe('squares a template covers', () => {
  const cells = (kind: any, a: any, b: any, w = 100) => coveredCells(grid, kind, a, b, w);
  it('a sphere from the middle of a square lights the usual plus-shaped blobs', () => {
    const c = { x: 550, y: 550 };
    expect(cells('sphere', c, { x: 650, y: 550 })).toHaveLength(5); // 5 ft
    expect(cells('sphere', c, { x: 750, y: 550 })).toHaveLength(13); // 10 ft
    expect(cells('sphere', c, { x: 850, y: 550 })).toHaveLength(29); // 15 ft
    expect(cells('sphere', c, { x: 950, y: 550 })).toHaveLength(49); // 20 ft
  });
  it('a sphere on a corner covers a clean block', () => {
    const n = cells('sphere', { x: 500, y: 500 }, { x: 600, y: 500 }).length; // 5 ft from a corner: the four squares around it
    expect(n).toBe(4);
  });
  it('an emanation leaves out its own square', () => {
    const all = cells('emanation', { x: 550, y: 550 }, { x: 750, y: 550 });
    expect(all.some((p) => p.x === 550 && p.y === 550)).toBe(false);
    expect(all).toHaveLength(12); // the 10 ft blob of 13, without the middle one
  });
  it('a cube covers whole squares', () => {
    expect(cells('cube', { x: 500, y: 550 }, { x: 800, y: 550 })).toHaveLength(9); // 15 ft cube: 3 x 3
  });
  it('a line covers the squares along it', () => {
    expect(cells('beam', { x: 500, y: 550 }, { x: 900, y: 550 }, 100)).toHaveLength(4);
    expect(cells('beam', { x: 500, y: 600 }, { x: 900, y: 600 }, 200)).toHaveLength(8);
  });
  it('a cone lights a widening triangle of squares', () => {
    const n = cells('cone', { x: 500, y: 550 }, { x: 800, y: 550 }).length; // 15 ft cone
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(9);
  });
  it('lists the corners of a square', () => {
    expect(cellPoly(grid, { x: 150, y: 50 })).toEqual([{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }]);
  });
});
