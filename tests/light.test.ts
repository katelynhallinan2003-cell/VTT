import { describe, expect, it } from 'vitest';
import { clipToConvex, darkPoly, eraseStops, lightOf, lightPoly, litSeen, ringPoly, SHADE, sightHeight, sightPoly, viewerOf, type LightSrc } from '../src/core/light';
import { inPoly, visibilityPolygon, routeReveal } from '../src/core/walls';
import type { Seg } from '../src/core/walls';

const grid = { ft: 5, cell: 70 };
const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
const wall = (ax: number, ay: number, bx: number, by: number): Seg => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });

describe('lights and viewers', () => {
  it('a torch reaches bright 20 ft and dim 20 ft more, from the edge of its token', () => {
    const l = lightOf({ id: 't', size: 1, light: { b: 20, d: 20, c: '#ffc27a' } }, grid, { x: 100, y: 100 })!;
    expect(l.b).toBeCloseTo(4 * 70 + 35);
    expect(l.r).toBeCloseTo(8 * 70 + 35);
    expect(l.c).toBe('#ffc27a');
  });
  it('no light, or a light of no size, is nothing', () => {
    expect(lightOf({ id: 't', size: 1, light: null }, grid, { x: 0, y: 0 })).toBeNull();
    expect(lightOf({ id: 't', size: 1, light: { b: 0, d: 0, c: '#fff' } }, grid, { x: 0, y: 0 })).toBeNull();
  });
  it('a token with no sight is not a viewer; darkvision never goes past sight', () => {
    expect(viewerOf({ id: 'a', sight: 0, dv: 60, size: 1 }, grid, { x: 0, y: 0 })).toBeNull();
    const v = viewerOf({ id: 'a', sight: 30, dv: 60, size: 1 }, grid, { x: 0, y: 0 })!;
    expect(v.dv).toBeCloseTo(v.r);
    const w = viewerOf({ id: 'a', sight: 120, dv: 60, size: 1 }, grid, { x: 0, y: 0 })!;
    expect(w.dv).toBeCloseTo(12 * 70 + 35);
    expect(w.r).toBeCloseTo(24 * 70 + 35);
    expect(w.touch).toBeGreaterThan(35);
    expect(w.touch).toBeLessThan(w.dv);
  });
  it('with no darkvision a viewer still makes out what is right beside it', () => {
    const v = viewerOf({ id: 'a', sight: 60, dv: 0, size: 1 }, grid, { x: 500, y: 500 })!;
    const p = darkPoly(v, [])!;
    expect(inPoly({ x: 500 + 50, y: 500 }, p)).toBe(true);
    expect(inPoly({ x: 500 + 3 * 70, y: 500 }, p)).toBe(false);
  });
});

describe('where light and sight reach', () => {
  it('a wall stops a light', () => {
    const l: LightSrc = { id: 'l', x: 0, y: 0, b: 100, r: 300, c: '#fff' };
    const free = lightPoly(l, 300, []);
    const blocked = lightPoly(l, 300, [wall(100, -500, 100, 500)]);
    expect(area(blocked)).toBeLessThan(area(free) * 0.8);
    expect(inPoly({ x: 250, y: 0 }, blocked)).toBe(false);
    expect(inPoly({ x: 50, y: 0 }, blocked)).toBe(true);
  });
  it('a wall lower than the light does not stop it', () => {
    const low: Seg = { ...wall(100, -500, 100, 500), top: 5 };
    const l: LightSrc = { id: 'l', x: 0, y: 0, b: 100, r: 300, alt: 20, c: '#fff' };
    expect(inPoly({ x: 250, y: 0 }, lightPoly(l, 300, [low]))).toBe(true);
    expect(inPoly({ x: 250, y: 0 }, lightPoly({ ...l, alt: 0 }, 300, [low]))).toBe(false);
  });
});

describe('clipping to a round light', () => {
  it('keeps the part of a shape inside a ring', () => {
    const sq = [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }];
    const out = clipToConvex(sq, ringPoly({ x: 0, y: 0 }, 50, 48));
    expect(out.length).toBeGreaterThan(8);
    expect(area(out)).toBeGreaterThan(Math.PI * 50 * 50 * 0.97);
    expect(area(out)).toBeLessThan(Math.PI * 50 * 50 * 1.01);
  });
  it('a shape clear of the ring is nothing, one inside it stays whole', () => {
    const sq = [{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }, { x: 200, y: 300 }];
    expect(clipToConvex(sq, ringPoly({ x: 0, y: 0 }, 50))).toEqual([]);
    const small = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    expect(area(clipToConvex(small, ringPoly({ x: 0, y: 0 }, 50)))).toBeCloseTo(400, 3);
  });
  it('works whichever way round the ring is drawn', () => {
    const sq = [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }];
    const ring = ringPoly({ x: 0, y: 0 }, 50, 32);
    expect(area(clipToConvex(sq, [...ring].reverse()))).toBeCloseTo(area(clipToConvex(sq, ring)), 3);
  });
});

describe('what is remembered in the dark', () => {
  const v = viewerOf({ id: 'a', sight: 120, dv: 0, size: 1 }, grid, { x: 0, y: 0 })!;
  it('only the part of its sight that another light reaches', () => {
    const l: LightSrc = { id: 'l', x: 600, y: 0, b: 100, r: 200, c: '#fff' };
    const pieces = litSeen(v, [l], []);
    expect(pieces.length).toBe(1);
    expect(inPoly({ x: 600, y: 0 }, pieces[0])).toBe(true);
    expect(inPoly({ x: 100, y: 0 }, pieces[0])).toBe(false);
    expect(area(pieces[0])).toBeGreaterThan(Math.PI * 200 * 200 * 0.9);
  });
  it('a light out of reach adds nothing; a wall in the way cuts the view', () => {
    expect(litSeen(v, [{ id: 'l', x: 5000, y: 0, b: 100, r: 200, c: '#fff' }], [])).toEqual([]);
    const l: LightSrc = { id: 'l', x: 600, y: 0, b: 100, r: 200, c: '#fff' };
    const cut = litSeen(v, [l], [wall(300, -2000, 300, 2000)]);
    expect(cut.length === 0 || area(cut[0]) < 1).toBe(true);
    expect(area(sightPoly(v, [wall(300, -2000, 300, 2000)]))).toBeLessThan(area(sightPoly(v, [])));
  });
});

describe('how much a light lifts the dark', () => {
  it('is complete inside the bright part and fades to nothing at the edge', () => {
    const s = eraseStops(100, 200, 'dark');
    expect(s[0]).toEqual([0, 1]);
    expect(s.at(-1)).toEqual([1, 0]);
    // dim light in the dark lifts half
    expect(s.some(([, a]) => a === 0.5)).toBe(true);
    // offsets only ever go up
    for (let i = 1; i < s.length; i++) expect(s[i][0]).toBeGreaterThanOrEqual(s[i - 1][0]);
  });
  it('in twilight the dim part adds nothing', () => {
    const s = eraseStops(100, 200, 'dim');
    expect(s.some(([, a]) => a === 0.5)).toBe(false);
    expect(s.some(([, a]) => a === 0)).toBe(true);
  });
  it('a light with no dim part still fades at the edge', () => {
    const s = eraseStops(200, 200, 'dark');
    expect(s[0][1]).toBe(1);
    expect(s.at(-1)).toEqual([1, 0]);
  });
  it('the dark gets darker from daylight to night', () => {
    expect(SHADE.bright).toBe(0);
    expect(SHADE.dim).toBeLessThan(SHADE.dark);
  });
});


describe('shadows at creature eye height', () => {
  const origin = {x:0, y:0};
  const reaches = (walls: Seg[], x: number, alt = 5) =>
    inPoly({x, y:0}, lightPoly({...origin, alt}, 300, walls));

  it('ignores a nine-degree shadow on either side of the angle wrap', () => {
    for (const sign of [-1, 1]) {
      const x = sign * 100, halfWidth = 100 * Math.tan(4.5 * Math.PI/180);
      expect(reaches([wall(x,-halfWidth,x,halfWidth)], 200*sign)).toBe(true);
    }
  });

  it('keeps a broad shadow assembled from short pieces and the wall behind a sliver', () => {
    const pieces = Array.from({length:12}, (_, i) => wall(100,i*2-12,100,i*2-10));
    expect(reaches(pieces, 190)).toBe(false);
    const layered = [wall(50,-2,50,2), wall(110,-50,110,50)];
    expect(reaches(layered, 85)).toBe(true);
    expect(reaches(layered, 140)).toBe(false);
  });

  it('shows less of a higher terrace, up to its far edge', () => {
    const face: Seg = {...wall(100,-100,100,100), one:1, top:15, terrainPxPerFt:10};
    expect(reaches([face], 140)).toBe(true);
    expect(reaches([face], 160)).toBe(false);
    expect(reaches([{...face, top:45}], 130)).toBe(false);
    expect(reaches([face, {...face, ...wall(125,-100,125,100), one:-1}], 135)).toBe(false);
  });

  it('reveals the next face above a nearer skyline while keeping the intervening shelf hidden', () => {
    const near = {...wall(100,-150,100,150), one:1 as const, low:0, top:10, terrainPxPerFt:10};
    const far = {...near, ...wall(225,-150,225,150), low:10, top:20};
    const visible = (walls: Seg[], x: number) => {
      const v = visibilityPolygon(origin,300,walls,64,5);
      return [v.poly,...v.faces].some(poly => inPoly({x,y:0},poly));
    };
    expect(visible([near,far],180)).toBe(false);
    expect(visible([near,far],210)).toBe(true);
    expect(visible([near,far],240)).toBe(true);
    expect(visible([near,far],285)).toBe(false);
    expect(visible([near,{...far,top:15}],230)).toBe(false);
    expect(visible([{...wall(90,-150,90,150),top:10},far],230)).toBe(true);
    expect(visible([wall(90,-150,90,150),far],230)).toBe(false);
    const memory = routeReveal([origin],300,[near,far],10,5);
    expect(memory.some(s => s.t === 'poly' && inPoly({x:230,y:0},s.pts))).toBe(true);
  });

  it('sees across a level wall top at each creature size on a hill or in flight', () => {
    for (const size of [0.5,1,2,3,4]) for (const fly of [false,true]) {
      const altitude = sightHeight({size, fly, elev:30, shape:'circle', img:null, light:null}, 10);
      expect(altitude).toBe((fly ? 30 : 10) + size*5);
      const face = wall(100,-50,100,50);
      expect(reaches([{...face, top:altitude}], 150, altitude)).toBe(true);
      expect(reaches([{...face, top:altitude+1}], 150, altitude)).toBe(false);
      expect(reaches([face], 150, altitude)).toBe(false);
    }
  });

  it('joins a farther visible face across brush segments and clears a thin shelf shadow', () => {
    const near = {...wall(100,-150,100,150), one:1 as const, low:0, top:10, terrainPxPerFt:10};
    const face = (x: number, from: number, to: number): Seg =>
      ({...near,...wall(x,from,x,to),low:10,top:20});
    const pieces = Array.from({length:40},(_,i) => face(225,(i-20)*3,(i-19)*3));
    const v = visibilityPolygon(origin,300,[near,...pieces],64,5);
    const visible = (x: number, y: number) => [v.poly,...v.faces].some(p => inPoly({x,y},p));
    for (let y=-45;y<=45;y+=.25) expect(visible(232,y)).toBe(true);
    expect(visible(180,0)).toBe(false);
    const thin = visibilityPolygon(origin,300,[near,face(220,-60,60)],64,5);
    expect(inPoly({x:172,y:0},thin.poly)).toBe(true);
  });

  it('keeps shelf shadows steady while walking alongside two straight terraces', () => {
    const near = {...wall(100,-300,100,300), one:1 as const, low:0, top:10, terrainPxPerFt:10};
    const far = {...near, ...wall(225,-300,225,300), low:10, top:20};
    const terrain = [near,far];
    const points = [{x:167,y:-28},{x:170,y:0},{x:168,y:-10}];
    const changes = points.map(() => 0);
    let previous: boolean[] | undefined;
    for (let y=-50;y<=50;y++) {
      const view = visibilityPolygon({x:0,y},400,terrain,64,5);
      const seen = points.map(p => [view.poly,...view.faces].some(poly => inPoly(p,poly)));
      seen.forEach((value,i) => { if (previous && value!==previous[i]) changes[i]++; });
      previous = seen;
    }
    // The viewer approaches each point and then recedes from it.
    for (const count of changes) expect(count).toBeLessThanOrEqual(2);
  });

  it('keeps the opening between two offset pairs of ledges visible', () => {
    const ledge = (x: number, y1: number, y2: number, low: number, top: number): Seg =>
      ({...wall(x,y1,x,y2), one:1, low, top, terrainPxPerFt:10});
    const ledges = [
      ledge(100,-350,0,0,10), ledge(225,-350,0,10,20),
      ledge(65,0,350,0,10), ledge(170,0,350,10,20)
    ];
    // The first viewpoint used to join unrelated shadows between neighboring
    // rays. At the second, blending the sampled viewpoints covered the opening.
    for (const [y,xProbe,yProbe] of [[30,171.53,97.53],[7,142.48,79.66]]) {
      const view = visibilityPolygon({x:0,y},550,ledges,64,5);
      expect([view.poly,...view.faces].some(poly => inPoly({x:xProbe,y:yProbe},poly))).toBe(true);
    }
  });

  it('reveals a small enclosed shelf pocket and keeps broad or wall-backed shadows', () => {
    const ledge = (x: number, halfWidth: number, low: number, top: number): Seg =>
      ({...wall(x,-halfWidth,x,halfWidth), one:1, low, top, terrainPxPerFt:10});
    const near = ledge(200,21,0,10), far = ledge(370,300,10,20);
    const sees = (walls: Seg[], x: number) => {
      const view = visibilityPolygon(origin,800,walls,64,5);
      return [view.poly,...view.faces].some(poly => inPoly({x,y:0},poly));
    };
    expect(sees([near,far],290)).toBe(true);
    expect(sees([near,far],480)).toBe(false);
    expect(sees([ledge(200,100,0,10),far],290)).toBe(false);
    expect(sees([near,far,wall(225,-100,225,100)],290)).toBe(false);
  });
});
