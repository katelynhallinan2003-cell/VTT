import { describe, expect, it } from 'vitest';
import { findLamps, findRooms, isGlow, roomLights } from '../src/core/autolight';
import { reachableCells, type Seg } from '../src/core/walls';
import type { PixelImage } from '../src/core/gridcut';
import type { GridSettings } from '../src/types';

const grid = (over: Partial<GridSettings> = {}): GridSettings => ({
  shape: 'square', cell: 100, ox: 0, oy: 0, visible: true, color: '#fff', opacity: 0.3, ft: 5, rule: 'alt', snap: true, ...over,
});

// ---------------------------------------------------------------- lamps
function picture(w: number, h: number, floor: [number, number, number]): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = floor[0]; data[i * 4 + 1] = floor[1]; data[i * 4 + 2] = floor[2]; data[i * 4 + 3] = 255; }
  return { data, width: w, height: h };
}
function paint(img: PixelImage, c: [number, number, number], shape: (x: number, y: number) => boolean) {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (shape(x, y)) { const p = (y * img.width + x) * 4; img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; }
}
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rect = (x0: number, y0: number, w: number, h: number) => (x: number, y: number) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
const FLAME: [number, number, number] = [255, 170, 40];

describe('lamps on the picture', () => {
  it('knows a flame colour from stone, wood and water', () => {
    expect(isGlow(...FLAME)).toBe(true);
    expect(isGlow(255, 220, 90)).toBe(true);
    expect(isGlow(120, 120, 120)).toBe(false);
    expect(isGlow(140, 90, 40)).toBe(false); // brown wood is warm but dark
    expect(isGlow(40, 90, 200)).toBe(false);
  });

  it('finds torches and a campfire, and says where their middles are', () => {
    const img = picture(600, 400, [120, 120, 120]);
    paint(img, FLAME, disc(100, 100, 8));
    paint(img, FLAME, disc(400, 300, 20));
    const got = findLamps(img, 50).sort((a, b) => a.x - b.x);
    expect(got).toHaveLength(2);
    expect(got[0].x).toBeCloseTo(100, 0); expect(got[0].y).toBeCloseTo(100, 0);
    expect(got[1].x).toBeCloseTo(400, 0); expect(got[1].y).toBeCloseTo(300, 0);
  });

  it('is not fooled by a rug, a strip, a dark floor or a floor of the same colour', () => {
    const rug = picture(600, 400, [120, 120, 120]);
    paint(rug, FLAME, rect(100, 100, 200, 100)); // far bigger than a square and a half
    expect(findLamps(rug, 50)).toEqual([]);
    const strip = picture(600, 400, [120, 120, 120]);
    paint(strip, FLAME, rect(100, 100, 100, 3));
    expect(findLamps(strip, 50)).toEqual([]);
    const wood = picture(600, 400, [120, 120, 120]);
    paint(wood, [140, 90, 40], disc(200, 200, 10));
    expect(findLamps(wood, 50)).toEqual([]);
    // a torch drawn on an orange floor is the same colour all round: nothing to tell it apart by
    const sand = picture(600, 400, FLAME);
    paint(sand, [255, 190, 60], disc(200, 200, 8));
    expect(findLamps(sand, 50)).toEqual([]);
  });

  it('counts blobs that touch, or sit within half a square, as one lamp', () => {
    const img = picture(600, 400, [120, 120, 120]);
    paint(img, FLAME, disc(100, 100, 8));
    paint(img, FLAME, disc(115, 100, 8));
    expect(findLamps(img, 50)).toHaveLength(1);
  });

  it('finds a small drawn flame (a fifth of a square across) but not a speck of noise', () => {
    const img = picture(600, 400, [120, 120, 120]);
    paint(img, FLAME, disc(100, 100, 5)); // 10 px across on 50 px squares
    paint(img, FLAME, disc(300, 200, 1)); // a couple of pixels
    expect(findLamps(img, 50)).toHaveLength(1);
  });

  it('is empty on a picture with no flames', () => {
    expect(findLamps(picture(300, 200, [90, 100, 110]), 50)).toEqual([]);
  });
});

// ---------------------------------------------------------------- rooms
/** the four walls of a box, corner to corner */
const box = (x0: number, y0: number, x1: number, y1: number): Seg[] => [
  { a: { x: x0, y: y0 }, b: { x: x1, y: y0 } }, { a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
  { a: { x: x1, y: y1 }, b: { x: x0, y: y1 } }, { a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
];
const REACH = 600; // a torch: 20 ft bright and half of 20 ft dim, in this 100 px square, 5 ft grid
const litShare = (segs: Seg[], lights: { x: number; y: number }[], cells: { x: number; y: number }[], reach: number) => {
  let lit = 0;
  for (const c of cells) if (lights.some((l) => Math.hypot(c.x - l.x, c.y - l.y) <= reach && reachableCells([c], l, segs).length)) lit++;
  return lit / cells.length;
};
const squaresIn = (x0: number, y0: number, x1: number, y1: number) => {
  const out = [];
  for (let y = y0; y < y1; y += 100) for (let x = x0; x < x1; x += 100) out.push({ x: x + 50, y: y + 50 });
  return out;
};

describe('rooms the walls close off', () => {
  it('finds a closed box and not the open ground round it', () => {
    const rooms = findRooms(box(100, 100, 700, 700), grid());
    expect(rooms).toHaveLength(1);
    expect(rooms[0].cells.every((c) => c.x > 100 && c.x < 700 && c.y > 100 && c.y < 700)).toBe(true);
    // 6 by 6 squares, a raster cell is a quarter of a square
    expect(rooms[0].cells.length).toBe(36 * 4);
  });

  it('a box with a gap in a wall is not a room', () => {
    const open: Seg[] = [
      { a: { x: 100, y: 100 }, b: { x: 700, y: 100 } }, { a: { x: 700, y: 100 }, b: { x: 700, y: 700 } },
      { a: { x: 700, y: 700 }, b: { x: 100, y: 700 } }, { a: { x: 100, y: 600 }, b: { x: 100, y: 100 } }, // the last wall stops short
    ];
    expect(findRooms(open, grid())).toEqual([]);
  });

  it('two rooms side by side are two rooms, and a closet too small to light is left out', () => {
    const segs = [...box(100, 100, 700, 700), ...box(800, 100, 2000, 500), ...box(2100, 100, 2200, 200)];
    const rooms = findRooms(segs, grid());
    expect(rooms).toHaveLength(2);
  });

  it('nothing at all with no walls', () => {
    expect(findRooms([], grid())).toEqual([]);
    expect(roomLights([], grid(), { reachPx: REACH })).toEqual([]);
  });
});

describe('lights for the rooms', () => {
  it('a small room gets one, in its middle, on a square', () => {
    const segs = box(100, 100, 700, 700);
    const got = roomLights(segs, grid(), { reachPx: REACH });
    expect(got).toHaveLength(1);
    expect(got[0].x % 100).toBe(50); expect(got[0].y % 100).toBe(50);
    expect(Math.hypot(got[0].x - 400, got[0].y - 400)).toBeLessThanOrEqual(100);
  });

  it('a long hall gets as many as it takes to light most of it, and the open ground gets none', () => {
    const hall = box(1000, 100, 2800, 400); // 18 by 3 squares
    const segs = [...box(100, 100, 700, 700), ...hall];
    const got = roomLights(segs, grid(), { reachPx: REACH });
    const inHall = got.filter((l) => l.x > 1000);
    expect(inHall.length).toBeGreaterThanOrEqual(2);
    expect(inHall.length).toBeLessThanOrEqual(5);
    expect(got.every((l) => (l.x > 100 && l.x < 700 && l.y > 100 && l.y < 700) || (l.x > 1000 && l.x < 2800 && l.y > 100 && l.y < 400))).toBe(true);
    expect(litShare(segs, inHall, squaresIn(1000, 100, 2800, 400), REACH)).toBeGreaterThanOrEqual(0.9);
  });

  it('a room that already has a light gets no more, and one the light does not reach does', () => {
    const segs = box(100, 100, 700, 700);
    expect(roomLights(segs, grid(), { reachPx: REACH, lit: [{ x: 400, y: 400 }] })).toEqual([]);
    expect(roomLights(segs, grid(), { reachPx: REACH, lit: [{ x: 5000, y: 5000 }] })).toHaveLength(1);
  });

  it('walls stop the light: one room with a wall across it needs a light on each side', () => {
    // a 12 by 4 room cut by a wall at x = 700 that leaves a one-square doorway
    const segs: Seg[] = [...box(100, 100, 1300, 500), { a: { x: 700, y: 100 }, b: { x: 700, y: 200 } }, { a: { x: 700, y: 300 }, b: { x: 700, y: 500 } }];
    const got = roomLights(segs, grid(), { reachPx: 450 });
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got.some((l) => l.x < 700)).toBe(true);
    expect(got.some((l) => l.x > 700)).toBe(true);
    expect(litShare(segs, got, squaresIn(100, 100, 1300, 500), 450)).toBeGreaterThanOrEqual(0.88);
  });

  it('never goes past the cap', () => {
    const segs: Seg[] = [];
    for (let i = 0; i < 12; i++) segs.push(...box(100 + i * 800, 100, 800 + i * 800, 700));
    expect(roomLights(segs, grid(), { reachPx: REACH, max: 5 }).length).toBeLessThanOrEqual(5);
    expect(roomLights(segs, grid(), { reachPx: REACH }).length).toBe(12);
  });
});
