import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../src/core/model';
import {
  blocksMove, blocksSight, boxSegments, carveWalls, clampMove, endNear, firstCrossing, inPoly, lineOfSight, moveSegs, normalizeWall, pathBlocked, reachableCells, routeReveal,
  sightSegs, simplifyPoly, snapWallPoint, visibilityPolygon, wallNear, wallToWire, type Wall,
} from '../src/core/walls';

const grid = { ...DEFAULT_GRID, cell: 100, ox: 0, oy: 0 };
const W = (id: string, ax: number, ay: number, bx: number, by: number, k: Wall['k'] = 'wall', open = false, vis = false): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, k, open, vis });

describe('what each kind of wall stops', () => {
  it('walls stop sight and walking; windows only walking; doors only while closed', () => {
    const wall = W('a', 0, 0, 1, 0), win = W('b', 0, 0, 1, 0, 'window'), shut = W('c', 0, 0, 1, 0, 'door'), open = W('d', 0, 0, 1, 0, 'door', true);
    expect([wall, win, shut, open].map(blocksSight)).toEqual([true, false, true, false]);
    expect([wall, win, shut, open].map(blocksMove)).toEqual([true, true, true, false]);
    expect(sightSegs([wall, win, shut, open])).toHaveLength(2);
    expect(moveSegs([wall, win, shut, open])).toHaveLength(3);
  });
});

describe('saving and loading', () => {
  it('round-trips every kind', () => {
    for (const w of [W('a', 10.04, 20, 30, 40.96), W('b', 0, 0, 100, 0, 'door', true, true), W('c', 5, 5, 6, 6, 'window')]) {
      const back = normalizeWall(w.id, wallToWire(w))!;
      expect(back.k).toBe(w.k);
      expect(back.open).toBe(w.open);
      expect(back.vis).toBe(w.vis);
      expect(back.a.x).toBeCloseTo(w.a.x, 0);
      expect(back.b.y).toBeCloseTo(w.b.y, 0);
    }
  });
  it('only doors can be open', () => {
    expect(normalizeWall('x', { p: '0,0,10,0', k: 'w', o: 1 })!.open).toBe(false);
    expect(normalizeWall('x', { p: '0,0,10,0', k: 'd', o: 1 })!.open).toBe(true);
  });
  it('bad data gives nothing, and an unknown kind is a wall', () => {
    expect(normalizeWall('x', null)).toBeNull();
    expect(normalizeWall('x', { p: '1,2,3' })).toBeNull();
    expect(normalizeWall('x', { p: 'a,b,c,d' })).toBeNull();
    expect(normalizeWall('x', { p: '0,0,5,5', k: '?' })!.k).toBe('wall');
  });
});

describe('walking into walls', () => {
  const segs = [{ a: { x: 100, y: 0 }, b: { x: 100, y: 200 } }];
  it('a path across a wall is blocked, and one beside it is not', () => {
    expect(pathBlocked({ x: 50, y: 50 }, { x: 150, y: 50 }, segs)).toBe(true);
    expect(pathBlocked({ x: 50, y: 50 }, { x: 90, y: 150 }, segs)).toBe(false);
    expect(pathBlocked({ x: 50, y: 250 }, { x: 150, y: 250 }, segs)).toBe(false); // below the wall's end
  });
  it('the end of a move is pulled back short of the wall', () => {
    const to = clampMove({ x: 50, y: 50 }, { x: 250, y: 50 }, segs, 10);
    expect(to.x).toBeCloseTo(90, 5);
    expect(to.y).toBeCloseTo(50, 5);
    expect(clampMove({ x: 50, y: 50 }, { x: 80, y: 50 }, segs, 10)).toEqual({ x: 80, y: 50 });
  });
  it('a move that starts inside the gap does not go backwards', () => {
    const to = clampMove({ x: 95, y: 50 }, { x: 150, y: 50 }, segs, 10);
    expect(to.x).toBeCloseTo(95, 5);
  });
  it('touching the end of a wall counts, so nobody squeezes through a corner', () => {
    const corner = [{ a: { x: 100, y: 100 }, b: { x: 200, y: 100 } }];
    expect(pathBlocked({ x: 50, y: 50 }, { x: 150, y: 150 }, corner)).toBe(true);
  });
  it('someone standing on a wall can still walk away from it', () => {
    expect(pathBlocked({ x: 100, y: 50 }, { x: 150, y: 50 }, segs)).toBe(false);
  });
  it('line of sight is the same test', () => {
    expect(lineOfSight({ x: 0, y: 100 }, { x: 200, y: 100 }, segs)).toBe(false);
    expect(lineOfSight({ x: 0, y: 100 }, { x: 90, y: 100 }, segs)).toBe(true);
  });
  it('finds where along the move the wall is', () => {
    expect(firstCrossing({ x: 0, y: 50 }, { x: 200, y: 50 }, segs)).toBeCloseTo(0.5, 5);
    expect(firstCrossing({ x: 0, y: 50 }, { x: 50, y: 50 }, segs)).toBeNull();
  });
});

describe('what a token can see', () => {
  it('with nothing around it, a round ring', () => {
    const v = visibilityPolygon({ x: 0, y: 0 }, 100, []);
    expect(v.free).toBe(true);
    for (const p of v.poly) expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 5);
    expect(inPoly({ x: 50, y: 50 }, v.poly)).toBe(true);
    expect(inPoly({ x: 90, y: 90 }, v.poly)).toBe(false);
  });
  it('walls too far away change nothing', () => {
    expect(visibilityPolygon({ x: 0, y: 0 }, 100, [{ a: { x: 500, y: -50 }, b: { x: 500, y: 50 } }]).free).toBe(true);
  });
  it('a wall hides what is behind it', () => {
    const wall = [{ a: { x: 50, y: -200 }, b: { x: 50, y: 200 } }];
    const v = visibilityPolygon({ x: 0, y: 0 }, 300, wall);
    expect(v.free).toBe(false);
    expect(inPoly({ x: 40, y: 0 }, v.poly)).toBe(true);
    expect(inPoly({ x: 80, y: 0 }, v.poly)).toBe(false);
    expect(inPoly({ x: -150, y: 0 }, v.poly)).toBe(true);
    expect(inPoly({ x: 40, y: 150 }, v.poly)).toBe(true);
  });
  it('light bends around the end of a wall', () => {
    // a short wall in front of the token: it can see around both ends, and the shadow starts at the ends
    const wall = [{ a: { x: 50, y: -30 }, b: { x: 50, y: 30 } }];
    const v = visibilityPolygon({ x: 0, y: 0 }, 300, wall);
    expect(inPoly({ x: 120, y: 0 }, v.poly)).toBe(false); // straight behind
    expect(inPoly({ x: 120, y: 120 }, v.poly)).toBe(true); // off to the side
    expect(inPoly({ x: 100, y: 61 }, v.poly)).toBe(true); // just past the shadow's edge (it runs through the wall's end)
    expect(inPoly({ x: 100, y: 59 }, v.poly)).toBe(false);
  });
  it('a closed room shows only the room', () => {
    const room = boxSegments({ x: -100, y: -100 }, { x: 100, y: 100 });
    const v = visibilityPolygon({ x: 0, y: 0 }, 500, room);
    expect(inPoly({ x: 90, y: 90 }, v.poly)).toBe(true);
    expect(inPoly({ x: 150, y: 0 }, v.poly)).toBe(false);
    expect(inPoly({ x: 0, y: -150 }, v.poly)).toBe(false);
  });
  it('a doorway lets a cone of the next room through', () => {
    // wall across y=100 with a gap from x=-20..20
    const wall = [{ a: { x: -400, y: 100 }, b: { x: -20, y: 100 } }, { a: { x: 20, y: 100 }, b: { x: 400, y: 100 } }];
    const v = visibilityPolygon({ x: 0, y: 0 }, 500, wall);
    expect(inPoly({ x: 0, y: 300 }, v.poly)).toBe(true);
    expect(inPoly({ x: 200, y: 300 }, v.poly)).toBe(false);
    expect(inPoly({ x: 50, y: 300 }, v.poly)).toBe(true); // the cone widens with distance
    expect(inPoly({ x: 70, y: 300 }, v.poly)).toBe(false);
  });
  it('does not see beyond its sight distance either', () => {
    const v = visibilityPolygon({ x: 0, y: 0 }, 100, [{ a: { x: 300, y: -50 }, b: { x: 300, y: 50 } }]);
    expect(inPoly({ x: 150, y: 0 }, v.poly)).toBe(false);
  });
  it('standing exactly in a wall does not blank the view', () => {
    const v = visibilityPolygon({ x: 50, y: 0 }, 200, [{ a: { x: 50, y: -100 }, b: { x: 50, y: 100 } }]);
    expect(v.poly.length).toBeGreaterThan(10);
  });
  it('simplifying keeps the shape', () => {
    const v = visibilityPolygon({ x: 0, y: 0 }, 300, boxSegments({ x: -100, y: -100 }, { x: 100, y: 100 }));
    const s = simplifyPoly(v.poly, 0.5);
    expect(s.length).toBeLessThan(v.poly.length / 4);
    expect(s.length).toBeGreaterThanOrEqual(4);
    expect(inPoly({ x: 90, y: 90 }, s)).toBe(true);
    expect(inPoly({ x: 110, y: 0 }, s)).toBe(false);
  });
});

describe('what a walk reveals', () => {
  it('open ground is still one thick line', () => {
    const r = routeReveal([{ x: 0, y: 0 }, { x: 300, y: 0 }], 100, [], 50);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ t: 'line', w: 200 });
  });
  it('near walls it is the view from several spots along the way', () => {
    const wall = [{ a: { x: -400, y: 60 }, b: { x: 400, y: 60 } }];
    const r = routeReveal([{ x: 0, y: 0 }, { x: 300, y: 0 }], 100, wall, 50);
    expect(r.length).toBeGreaterThanOrEqual(6);
    expect(r.every((s) => s.t === 'poly')).toBe(true);
    // nothing past the wall is revealed from any spot
    for (const s of r) if (s.t === 'poly') expect(inPoly({ x: 150, y: 90 }, s.pts)).toBe(false);
  });
  it('a token that only stands still reveals what it sees there', () => {
    const r = routeReveal([{ x: 10, y: 10 }], 100, [{ a: { x: 60, y: -100 }, b: { x: 60, y: 100 } }], 50);
    expect(r).toHaveLength(1);
    expect(r[0].t).toBe('poly');
  });
});

describe('picking and snapping', () => {
  const walls = [W('a', 0, 0, 100, 0), W('b', 100, 0, 100, 100)];
  it('finds the wall under the pointer', () => {
    expect(wallNear(walls, { x: 50, y: 4 }, 8)?.wall.id).toBe('a');
    expect(wallNear(walls, { x: 96, y: 50 }, 8)?.wall.id).toBe('b');
    expect(wallNear(walls, { x: 50, y: 40 }, 8)).toBeNull();
  });
  it('finds the end under the pointer', () => {
    const e = endNear(walls, { x: 103, y: 2 }, 10)!;
    expect(e.wall.id).toBeTruthy();
    expect(endNear(walls, { x: 50, y: 50 }, 10)).toBeNull();
  });
  it('snaps onto the end of a wall that is already there, then onto the grid', () => {
    expect(snapWallPoint(grid, { x: 104, y: -3 }, [{ x: 100, y: 0 }], 'corner', 12)).toEqual({ x: 100, y: 0 });
    expect(snapWallPoint(grid, { x: 138, y: 61 }, [], 'corner', 12)).toEqual({ x: 100, y: 100 });
    expect(snapWallPoint(grid, { x: 138, y: 61 }, [], 'half', 12)).toEqual({ x: 150, y: 50 });
    expect(snapWallPoint(grid, { x: 138, y: 61 }, [], 'off', 12)).toEqual({ x: 138, y: 61 });
  });
  it('a box is four joined walls', () => {
    const b = boxSegments({ x: 200, y: 100 }, { x: 0, y: 0 });
    expect(b).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(b[i].b).toEqual(b[(i + 1) % 4].a);
  });
});

describe('carving a gap for a door', () => {
  const wall = (id: string, ax: number, ay: number, bx: number, by: number, k: Wall['k'] = 'wall'): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, k, open: false, vis: false });
  it('splits a wall around a door drawn along it', () => {
    const r = carveWalls([wall('w1', 0, 0, 300, 0)], { a: { x: 100, y: 0 }, b: { x: 160, y: 0 } }, 3);
    expect(r.remove).toEqual(['w1']);
    expect(r.add.length).toBe(2);
    const xs = r.add.map((w) => [w.a.x, w.b.x]).sort((p, q) => p[0] - q[0]);
    expect(xs[0][0]).toBeCloseTo(0); expect(xs[0][1]).toBeCloseTo(100);
    expect(xs[1][0]).toBeCloseTo(160); expect(xs[1][1]).toBeCloseTo(300);
  });
  it('works whichever way round the door was drawn', () => {
    const r = carveWalls([wall('w1', 0, 0, 300, 0)], { a: { x: 160, y: 0 }, b: { x: 100, y: 0 } }, 3);
    expect(r.add.length).toBe(2);
  });
  it('shortens the wall when the door is at its end, and removes it when covered', () => {
    expect(carveWalls([wall('w1', 0, 0, 300, 0)], { a: { x: 240, y: 0 }, b: { x: 300, y: 0 } }, 3).add.length).toBe(1);
    const all = carveWalls([wall('w1', 0, 0, 60, 0)], { a: { x: -10, y: 0 }, b: { x: 80, y: 0 } }, 3);
    expect(all.remove).toEqual(['w1']);
    expect(all.add.length).toBe(0);
  });
  it('leaves walls it does not run along, and doors and windows, alone', () => {
    expect(carveWalls([wall('w1', 0, 20, 300, 20)], { a: { x: 100, y: 0 }, b: { x: 160, y: 0 } }, 3).remove).toEqual([]);
    expect(carveWalls([wall('w1', 100, -50, 100, 50)], { a: { x: 100, y: 0 }, b: { x: 160, y: 0 } }, 3).remove).toEqual([]);
    expect(carveWalls([wall('w1', 0, 0, 300, 0, 'door')], { a: { x: 100, y: 0 }, b: { x: 160, y: 0 } }, 3).remove).toEqual([]);
  });
});

describe('what a spell reaches', () => {
  const cells = [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 250, y: 50 }, { x: 50, y: 150 }];
  it('is everything when nothing is in the way', () => {
    expect(reachableCells(cells, { x: 50, y: 50 }, [])).toEqual(cells);
    expect(reachableCells(cells, { x: 50, y: 50 }, undefined)).toEqual(cells);
  });
  it('stops at a wall, but not a wall the origin stands on', () => {
    const wall = [{ a: { x: 200, y: 0 }, b: { x: 200, y: 100 } }];
    const got = reachableCells(cells, { x: 50, y: 50 }, wall);
    expect(got).toEqual([cells[0], cells[1], cells[3]]);
    expect(reachableCells(cells, { x: 200, y: 50 }, wall).length).toBe(4);
  });
  it('flows through a doorway', () => {
    const wall = [{ a: { x: 200, y: 0 }, b: { x: 200, y: 40 } }, { a: { x: 200, y: 60 }, b: { x: 200, y: 100 } }];
    expect(reachableCells(cells, { x: 50, y: 50 }, wall).length).toBe(4);
  });
});
