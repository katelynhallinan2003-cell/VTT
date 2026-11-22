import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../src/core/model';
import {
  blocksMove, blocksSight, boxSegments, carveWalls, chainSegments, circlePoints, clampMove, endNear, firstCrossing, freehandCorners, hatchTicks, inPoly, joinAt, lineOfSight, moveSegs, normalizeWall,
  onBlockedSide, pathBlocked, reachableCells, routeReveal, segsFrom, sideOf, sightSegs, simplifyPath, simplifyPoly, snapWallPoint, splitPieces, visibilityPolygon, wallNear, wallToWire, type Seg, type Wall,
} from '../src/core/walls';

const grid = { ...DEFAULT_GRID, cell: 100, ox: 0, oy: 0 };
const W = (id: string, ax: number, ay: number, bx: number, by: number, k: Wall['k'] = 'wall', open = false, vis = false): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, k, open, vis, one: 0, h: 0 });

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
  const wall = (id: string, ax: number, ay: number, bx: number, by: number, k: Wall['k'] = 'wall'): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, k, open: false, vis: false, one: 0, h: 0 });
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


describe('one-way walls (a cliff edge)', () => {
  // a wall along the top of a cliff, running left to right; side 1 is the screen-down side, which is the bottom of the cliff
  const cliff: Seg = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, one: 1 };
  const bottom = { x: 100, y: 80 }, top = { x: 100, y: -80 };

  it('knows which side of a wall a point is on', () => {
    expect(sideOf(cliff, bottom)).toBe(1);
    expect(sideOf(cliff, top)).toBe(-1);
    expect(sideOf(cliff, { x: 50, y: 0 })).toBe(0);
  });

  it('stops what stands at the bottom, but not what stands at the top', () => {
    expect(pathBlocked(bottom, top, [cliff])).toBe(true);
    expect(pathBlocked(top, bottom, [cliff])).toBe(false);
    expect(lineOfSight(bottom, top, [cliff])).toBe(false);
    expect(lineOfSight(top, bottom, [cliff])).toBe(true);
    expect(clampMove(bottom, top, [cliff], 4).y).toBeGreaterThan(0); // held back this side of it
    expect(clampMove(top, bottom, [cliff], 4)).toEqual(bottom); // walks off the edge
  });

  it('a two-way wall stops both', () => {
    const plain: Seg = { a: cliff.a, b: cliff.b };
    expect(pathBlocked(bottom, top, [plain])).toBe(true);
    expect(pathBlocked(top, bottom, [plain])).toBe(true);
  });

  it('sight is cut at the bottom and open from the top', () => {
    const fromBottom = visibilityPolygon(bottom, 300, [cliff]);
    const fromTop = visibilityPolygon(top, 300, [cliff]);
    expect(fromBottom.free).toBe(false);
    expect(fromTop.free).toBe(true);
    expect(inPoly({ x: 100, y: -50 }, fromBottom.poly)).toBe(false);
    expect(inPoly({ x: 100, y: 150 }, fromTop.poly)).toBe(true);
  });

  it('a spell from the bottom stops at it, from the top it does not', () => {
    const cells = [{ x: 100, y: 50 }, { x: 100, y: -50 }];
    expect(reachableCells(cells, { x: 100, y: 20 }, [cliff])).toEqual([{ x: 100, y: 50 }]);
    expect(reachableCells(cells, { x: 100, y: -20 }, [cliff])).toEqual(cells);
  });

  it('tells which side is the blocked one', () => {
    const w = W('c', 0, 0, 200, 0);
    expect(onBlockedSide(w, top)).toBe(true); // a two-way wall has no free side
    expect(onBlockedSide({ ...w, one: 1 }, bottom)).toBe(true);
    expect(onBlockedSide({ ...w, one: 1 }, top)).toBe(false);
    expect(onBlockedSide({ ...w, one: -1 }, top)).toBe(true);
  });

  it('is kept on the wire, and flipping the wall flips what it stops', () => {
    const w = { ...W('c', 0, 0, 200, 0), one: 1 as const };
    expect(wallToWire(w).s).toBe(1);
    expect(wallToWire(W('d', 0, 0, 5, 5))).not.toHaveProperty('s');
    expect(normalizeWall('c', wallToWire(w))?.one).toBe(1);
    expect(normalizeWall('c', { p: '0,0,5,5', s: -1 })?.one).toBe(-1);
    expect(normalizeWall('c', { p: '0,0,5,5', s: 7 })?.one).toBe(0);
  });

  it('a window or a segment that is not one-way keeps both sides', () => {
    expect(segsFrom([{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }], top)).toHaveLength(1);
  });

  it('puts ticks on the stopped side only', () => {
    const t = hatchTicks({ x: 0, y: 0 }, { x: 200, y: 0 }, 1, 40, 16);
    expect(t.length).toBe(5);
    for (const k of t) { expect(k.a.y).toBeCloseTo(0); expect(k.b.y).toBeCloseTo(16); }
    const l = hatchTicks({ x: 0, y: 0 }, { x: 200, y: 0 }, -1, 40, 16);
    for (const k of l) expect(k.b.y).toBeCloseTo(-16);
    expect(hatchTicks({ x: 0, y: 0 }, { x: 200, y: 0 }, 0, 40, 16)).toEqual([]);
  });
});

describe('walls with a height', () => {
  const low: Seg = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, top: 10 };
  const left = { x: 100, y: 60 }, right = { x: 100, y: -60 };

  it('what is higher than the top passes, what is not does not', () => {
    expect(pathBlocked(left, right, [low], 0)).toBe(true);
    expect(pathBlocked(left, right, [low], 10)).toBe(true); // level with the top is still not over it
    expect(pathBlocked(left, right, [low], 11)).toBe(false);
    expect(pathBlocked(left, right, [low])).toBe(true); // unknown height: blocked
  });

  it('sees over it from above', () => {
    expect(visibilityPolygon(left, 300, [low], 64, 30).free).toBe(true);
    expect(visibilityPolygon(left, 300, [low], 64, 5).free).toBe(false);
  });

  it('a tall wall is never passed', () => {
    expect(pathBlocked(left, right, [{ a: low.a, b: low.b }], 500)).toBe(true);
  });

  it('is kept on the wire, and the top is worked out from the ground it stands on', () => {
    const w = { ...W('c', 0, 0, 200, 0), h: 15 };
    expect(wallToWire(w).h).toBe(15);
    expect(wallToWire(W('d', 0, 0, 5, 5))).not.toHaveProperty('h');
    expect(normalizeWall('c', { p: '0,0,5,5', h: 12 })?.h).toBe(12);
    expect(normalizeWall('c', { p: '0,0,5,5', h: -3 })?.h).toBe(0);
    const segs = sightSegs([w, W('e', 0, 10, 50, 10)], (x) => 30 + x.h);
    expect(segs[0].top).toBe(45);
    expect(segs[1].top).toBeUndefined();
  });

  it('a low one-way wall stops its side only until you are higher than its top', () => {
    const both: Seg = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, one: 1, top: 10 };
    expect(pathBlocked(left, right, [both], 0)).toBe(true); // from the stopped side, on the ground
    expect(pathBlocked(left, right, [both], 20)).toBe(false); // from the stopped side, flying over
    expect(pathBlocked(right, left, [both], 0)).toBe(false); // from the open side
  });
});

describe('carrying a wall\'s settings over', () => {
  it('the pieces left around a door keep the one-way side and the height', () => {
    const w = { ...W('w1', 0, 0, 300, 0), one: -1 as const, h: 20 };
    const r = carveWalls([w], { a: { x: 100, y: 0 }, b: { x: 160, y: 0 } }, 3);
    expect(r.add.every((p) => p.one === -1 && p.h === 20)).toBe(true);
  });
});

describe('freehand and round walls', () => {
  it('simplifying keeps the ends and drops points on a straight run', () => {
    const line = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }));
    expect(simplifyPath(line, 1)).toEqual([line[0], line[10]]);
    const bent = [...line.slice(0, 6), ...Array.from({ length: 5 }, (_, i) => ({ x: 50, y: (i + 1) * 10 }))];
    const out = simplifyPath(bent, 1);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ x: 50, y: 0 });
    expect(simplifyPath([{ x: 0, y: 0 }, { x: 5, y: 5 }], 1)).toHaveLength(2);
  });

  it('a looser tolerance gives fewer corners', () => {
    const arc = Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: Math.sin(i / 6) * 30 }));
    expect(simplifyPath(arc, 12).length).toBeLessThan(simplifyPath(arc, 2).length);
  });

  it('a circle is n points around the middle, going on from the start angle', () => {
    const c = circlePoints({ x: 100, y: 100 }, 50, 8, 0);
    expect(c).toHaveLength(8);
    expect(c[0].x).toBeCloseTo(150); expect(c[0].y).toBeCloseTo(100);
    expect(c[2].x).toBeCloseTo(100); expect(c[2].y).toBeCloseTo(150); // a quarter turn clockwise on the screen is down
    for (const p of c) expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(50);
  });

  it('a chain joins points one after another, and closed joins the last to the first', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(chainSegments(pts, false)).toHaveLength(2);
    const closed = chainSegments(pts, true);
    expect(closed).toHaveLength(3);
    expect(closed[2]).toEqual({ a: pts[2], b: pts[0] });
    expect(chainSegments([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 20, y: 0 }], false, 2)).toHaveLength(1); // the tiny step is skipped
  });

  it('a stroke that comes back to its start closes into a loop', () => {
    const loop = [...circlePoints({ x: 0, y: 0 }, 100, 40, 0), { x: 98, y: 4 }];
    const r = freehandCorners(loop, 3, 30, []);
    expect(r.closed).toBe(true);
    expect(r.pts.length).toBeGreaterThanOrEqual(6);
  });

  it('an open stroke stays open, and its ends land on walls that are close by', () => {
    const stroke = [{ x: 3, y: 2 }, { x: 50, y: 1 }, { x: 100, y: -2 }, { x: 150, y: 1 }, { x: 197, y: 4 }];
    const r = freehandCorners(stroke, 3, 12, [{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    expect(r.closed).toBe(false);
    expect(r.pts[0]).toEqual({ x: 0, y: 0 });
    expect(r.pts[r.pts.length - 1]).toEqual({ x: 200, y: 0 });
  });

  it('a single point makes nothing', () => {
    expect(freehandCorners([{ x: 1, y: 1 }], 3, 10, []).pts).toHaveLength(1);
    expect(chainSegments([{ x: 1, y: 1 }], false)).toEqual([]);
  });
});

describe('adding and taking out a corner', () => {
  it('a wall split in two keeps its settings and the two halves meet at the corner', () => {
    const w = { ...W('w', 0, 0, 200, 0, 'window', false, true), one: 1 as const, h: 8 };
    const [p, q] = splitPieces(w, { x: 120, y: 0 });
    expect(p.a).toEqual({ x: 0, y: 0 }); expect(p.b).toEqual({ x: 120, y: 0 });
    expect(q.a).toEqual({ x: 120, y: 0 }); expect(q.b).toEqual({ x: 200, y: 0 });
    for (const x of [p, q]) expect(x).toMatchObject({ k: 'window', vis: true, one: 1, h: 8 });
  });

  it('exactly two walls meeting at a spot become one wall again', () => {
    const j = joinAt([W('a', 0, 0, 100, 0), W('b', 100, 0, 100, 100), W('c', 500, 0, 600, 0)], { x: 100, y: 0 }, 0.5);
    expect(j?.remove.sort()).toEqual(['a', 'b']);
    expect(j?.add.a).toEqual({ x: 0, y: 0 });
    expect(j?.add.b).toEqual({ x: 100, y: 100 });
  });

  it('refuses when it is not exactly two, or they differ', () => {
    expect(joinAt([W('a', 0, 0, 100, 0), W('b', 100, 0, 100, 100), W('c', 100, 0, 150, 0)], { x: 100, y: 0 }, 0.5)).toBeNull();
    expect(joinAt([W('a', 0, 0, 100, 0)], { x: 100, y: 0 }, 0.5)).toBeNull();
    expect(joinAt([W('a', 0, 0, 100, 0), W('b', 100, 0, 100, 100, 'window')], { x: 100, y: 0 }, 0.5)).toBeNull();
    expect(joinAt([W('a', 0, 0, 100, 0), { ...W('b', 100, 0, 200, 0), h: 5 }], { x: 100, y: 0 }, 0.5)).toBeNull();
  });

  it('joins one-way walls only when they stop the same side once they run the same way', () => {
    const a = { ...W('a', 0, 0, 100, 0), one: 1 as const };
    const same = { ...W('b', 100, 0, 200, 0), one: 1 as const };
    const flipped = { ...W('b', 200, 0, 100, 0), one: -1 as const }; // drawn the other way round, stops the same side
    const wrong = { ...W('b', 100, 0, 200, 0), one: -1 as const };
    expect(joinAt([a, same], { x: 100, y: 0 }, 0.5)?.add.one).toBe(1);
    expect(joinAt([a, flipped], { x: 100, y: 0 }, 0.5)?.add.one).toBe(1);
    expect(joinAt([a, wrong], { x: 100, y: 0 }, 0.5)).toBeNull();
  });
});
