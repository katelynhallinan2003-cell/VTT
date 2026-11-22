// The pictures the printed-grid finder is measured against: maps with a grid that has to be found (and put in the right place),
// and maps without one where nothing may be found. See mapgen.ts for how they are drawn.
import type { GridSpec, MapSpec } from './mapgen';

export interface Case {
  name: string;
  spec: MapSpec;
  /** the grid that is really there, or null when the picture has none */
  truth: GridSpec | null;
  /** hard for good reason: it may be missed, but if something is found it has to be right */
  soft?: boolean;
  /** found when asked for, but not sure enough to be set up without asking */
  quiet?: boolean;
  /** a very big picture: only run when GRID_SLOW is set */
  slow?: boolean;
}

const sq = (p: number, ox: number, oy: number, t: number, contrast: number, more: Partial<GridSpec> = {}): GridSpec => ({ shape: 'square', p, ox, oy, t, contrast, ...more });
const hx = (shape: 'pointy' | 'flat', p: number, ox: number, oy: number, t: number, contrast: number, more: Partial<GridSpec> = {}): GridSpec => ({ shape, p, ox, oy, t, contrast, ...more });
const withGrid = (name: string, spec: Omit<MapSpec, 'grid'>, grid: GridSpec, more: Partial<Case> = {}): Case => ({ name, spec: { ...spec, grid }, truth: grid, slow: spec.W * spec.H > 12_000_000, ...more });
const noGrid = (name: string, spec: MapSpec, more: Partial<Case> = {}): Case => ({ name, spec, truth: null, ...more });

export const CORPUS: Case[] = [
  // ---- squares
  withGrid('plain stone, clear lines', { W: 1400, H: 1000, seed: 1 }, sq(70, 23, 41, 2, 60)),
  withGrid('painted ground, see-through lines', { W: 1400, H: 1000, seed: 2, ground: 'painted' }, sq(70, 11, 52, 1.5, 45, { mul: true })),
  withGrid('painted ground, very faint lines, big squares', { W: 2100, H: 1500, seed: 3, ground: 'painted' }, sq(140, 64, 20, 1.3, 22, { mul: true })),
  withGrid('painted ground, light see-through lines', { W: 1500, H: 1100, seed: 4, ground: 'painted' }, sq(100, 37, 81, 2, 55, { mul: true, light: true })),
  withGrid('dungeon: black around the rooms, thick walls', { W: 1680, H: 1260, seed: 5, ground: 'paper', rooms: { count: 7, fill: 14, walls: 6 } }, sq(70, 0, 0, 1.5, 50)),
  withGrid('dungeon: white around the rooms, thin grey lines', { W: 1500, H: 1200, seed: 6, ground: 'paper', rooms: { count: 6, fill: 246, walls: 4 } }, sq(50, 25, 25, 1, 60)),
  withGrid('a lot of furniture over the lines', { W: 1400, H: 1050, seed: 7, clutter: 70 }, sq(70, 35, 35, 2, 55)),
  withGrid('dashed lines', { W: 1400, H: 1050, seed: 8 }, sq(70, 14, 30, 2, 60, { style: 'dashed' })),
  withGrid('dotted cavern grid with an odd spacing on a reduced preview', { W: 2280, H: 1710, seed: 87, ground: 'painted' }, sq(57, 56.5, 56.5, 2, 24, { style: 'dotted' })),
  withGrid('widely spaced dotted lines with clear ground between them', { W: 2280, H: 1710, seed: 88, ground: 'painted' }, sq(114, 23.5, 51.5, 2, 45, { style: 'dotted' })),
  withGrid('only little crosses at the corners', { W: 1400, H: 1050, seed: 9 }, sq(70, 50, 12, 2, 80, { style: 'corners' })),
  withGrid('a plain border round the map', { W: 1344, H: 1024, seed: 10, margin: 96 }, sq(64, 96, 96, 2, 60)),
  withGrid('resized map: spacing not a whole number, soft', { W: 1700, H: 1300, seed: 11, ground: 'painted', blur: 0.8 }, sq(69.37, 12.6, 40.2, 2.2, 60)),
  withGrid('big soft thick lines', { W: 2800, H: 2100, seed: 12, blur: 1.5 }, sq(140, 70, 70, 5, 70)),
  withGrid('saved as a blocky JPEG', { W: 1400, H: 1000, seed: 13, ground: 'painted', jpeg: 2 }, sq(70, 30, 30, 2, 50, { mul: true })),
  withGrid('JPEG with squares a multiple of 8 pixels', { W: 1408, H: 1024, seed: 14, ground: 'painted', jpeg: 2 }, sq(64, 20, 44, 2, 50, { mul: true })),
  withGrid('large squares (256 px)', { W: 2048, H: 1536, seed: 15, ground: 'painted' }, sq(256, 128, 0, 4, 60, { mul: true })),
  withGrid('very large picture, very thick lines', { W: 3000, H: 2400, seed: 16, blur: 1 }, sq(300, 150, 150, 9, 60)),
  withGrid('small squares (20 px)', { W: 800, H: 600, seed: 17 }, sq(20, 7, 13, 1, 60)),
  withGrid('everything at once: rooms, furniture, paint, JPEG', { W: 1680, H: 1260, seed: 18, ground: 'painted', rooms: { count: 8, fill: 20, walls: 5 }, clutter: 40, jpeg: 1.5 }, sq(70, 0, 0, 1.6, 45, { mul: true })),
  withGrid('grass with faint lines', { W: 1400, H: 1050, seed: 19, ground: 'grass' }, sq(70, 21, 63, 2, 45, { mul: true })),
  withGrid('dark cave, light lines', { W: 1200, H: 900, seed: 20, ground: 'dark' }, sq(50, 10, 40, 1.5, 35, { light: true })),
  withGrid('small picture, only a few squares', { W: 700, H: 560, seed: 21 }, sq(140, 70, 0, 2, 60)),
  withGrid('squares of 60 (near the default size of 70)', { W: 1320, H: 960, seed: 22 }, sq(60, 30, 18, 2, 60)),
  withGrid('squares of 35 (half the default size)', { W: 1050, H: 840, seed: 23 }, sq(35, 5, 17, 1.5, 60)),
  withGrid('squares of 140 (twice the default size)', { W: 1680, H: 1260, seed: 24 }, sq(140, 33, 99, 2.5, 60)),
  withGrid('lines every square, heavier every fifth', { W: 1500, H: 1000, seed: 25, ground: 'paper' }, sq(50, 0, 0, 1.2, 40, { major: 5 })),
  withGrid('a few small rooms in a lot of black', { W: 1680, H: 1260, seed: 61, ground: 'paper', rooms: { count: 3, fill: 12, walls: 5 } }, sq(70, 0, 0, 1.5, 50), { quiet: true }),
  withGrid('a tiled floor in one room as well as the grid', { W: 1540, H: 1120, seed: 62, tiles: { x: 280, y: 210, w: 420, h: 350, q: 23, contrast: 35 } }, sq(70, 0, 0, 2, 50)),
  withGrid('thick walls that do not follow the grid', { W: 1500, H: 1100, seed: 63, ground: 'painted', offWalls: 14 }, sq(70, 31, 8, 1.5, 45, { mul: true })),
  withGrid('pen strokes and hatching everywhere', { W: 1500, H: 1100, seed: 64, ground: 'paper', strokes: 2500 }, sq(50, 12, 37, 1, 45)),
  withGrid('the map fills only part of the picture', { W: 1800, H: 1100, seed: 65, ground: 'painted', only: { x: 0, y: 0, w: 1150, h: 1100 } }, sq(70, 15, 15, 2, 50, { mul: true })),
  withGrid('floorboards as well as the grid', { W: 1400, H: 1050, seed: 66, planks: { q: 28, contrast: 30 } }, sq(70, 14, 40, 2, 50)),
  withGrid('small picture, small squares', { W: 500, H: 400, seed: 67 }, sq(25, 3, 11, 1, 60)),
  withGrid('barely visible lines on busy grass', { W: 1400, H: 1050, seed: 68, ground: 'grass' }, sq(70, 21, 63, 1.5, 18, { mul: true }), { soft: true, quiet: true }),
  withGrid('huge picture (24 megapixels)', { W: 6000, H: 4000, seed: 69, ground: 'painted' }, sq(200, 100, 60, 3, 50, { mul: true })),
  withGrid('huge picture, walls and furniture, fine lines', { W: 5600, H: 4200, seed: 70, ground: 'paper', rooms: { count: 9, fill: 16, walls: 14 }, clutter: 60 }, sq(140, 0, 0, 2, 50)),
  // ---- hexes
  withGrid('hexes with a plain border round the map', { W: 1400, H: 1100, seed: 71, margin: 90 }, hx('pointy', 70, 90, 90, 2, 60)),
  withGrid('hexes in a cave with black around it', { W: 1500, H: 1200, seed: 72, ground: 'stone', rooms: { count: 6, fill: 14, walls: 6 } }, hx('flat', 80, 10, 10, 2, 55), { quiet: true }),
  withGrid('hexes with thick walls and pen strokes', { W: 1500, H: 1200, seed: 73, ground: 'painted', offWalls: 12, strokes: 1200 }, hx('pointy', 75, 22, 5, 2, 55, { mul: true })),
  withGrid('hexes on part of the picture', { W: 1800, H: 1100, seed: 74, ground: 'painted', only: { x: 0, y: 0, w: 1150, h: 1100 } }, hx('pointy', 72, 0, 0, 2, 55, { mul: true })),
  withGrid('hexes, huge picture', { W: 5200, H: 3900, seed: 75, ground: 'painted' }, hx('flat', 210, 40, 90, 4, 55, { mul: true })),
  withGrid('hexes, point up, stone', { W: 1280, H: 1040, seed: 31 }, hx('pointy', 64, 21, 17, 2, 60)),
  withGrid('hexes, flat top, painted, see-through', { W: 1600, H: 1200, seed: 32, ground: 'painted' }, hx('flat', 90, 13, 44, 2, 55, { mul: true })),
  withGrid('hexes, point up, grass', { W: 1400, H: 1100, seed: 33, ground: 'grass' }, hx('pointy', 70, 5, 30, 2, 55, { mul: true })),
  withGrid('hexes, flat top, furniture over them', { W: 1500, H: 1200, seed: 34, clutter: 45 }, hx('flat', 100, 40, 12, 2.5, 60)),
  withGrid('hexes, resized, soft, JPEG', { W: 1500, H: 1200, seed: 35, ground: 'painted', blur: 0.8, jpeg: 1 }, hx('pointy', 83.4, 17.3, 9.1, 2.4, 60)),
  withGrid('hexes, only the corners drawn', { W: 1440, H: 1120, seed: 36 }, hx('pointy', 80, 0, 0, 2, 80, { style: 'corners' })),
  withGrid('hexes, large', { W: 2400, H: 1800, seed: 37, ground: 'painted' }, hx('flat', 150, 60, 20, 3, 60, { mul: true })),
  withGrid('hexes, light lines on dark', { W: 1200, H: 1000, seed: 38, ground: 'dark' }, hx('pointy', 56, 9, 30, 2, 40, { light: true })),
  // ---- nothing to find
  noGrid('no grid: stone', { W: 1400, H: 1000, seed: 41 }),
  noGrid('no grid: painted', { W: 1400, H: 1000, seed: 42, ground: 'painted' }),
  noGrid('no grid: grass', { W: 1400, H: 1000, seed: 43, ground: 'grass' }),
  noGrid('no grid: painted with a lot of furniture', { W: 1500, H: 1100, seed: 44, ground: 'painted', clutter: 90 }),
  noGrid('no grid: floorboards one way only', { W: 1400, H: 1000, seed: 45, planks: { q: 28, contrast: 40 } }),
  noGrid('no grid: dungeon rooms and walls', { W: 1600, H: 1200, seed: 46, ground: 'paper', rooms: { count: 7, fill: 14, walls: 6 } }),
  noGrid('no grid: blocky JPEG', { W: 1408, H: 1024, seed: 47, ground: 'painted', jpeg: 3 }),
  noGrid('no grid: dark cave', { W: 1200, H: 900, seed: 48, ground: 'dark' }),
  noGrid('no grid: a few big shapes on paper', { W: 1400, H: 1000, seed: 49, ground: 'paper', clutter: 12 }),
  noGrid('no grid: pen strokes and hatching', { W: 1500, H: 1100, seed: 81, ground: 'paper', strokes: 3000 }),
  noGrid('no grid: thick walls and furniture', { W: 1500, H: 1100, seed: 82, ground: 'painted', offWalls: 20, clutter: 40 }),
  noGrid('no grid: a border round the map', { W: 1400, H: 1000, seed: 83, ground: 'painted', margin: 80 }),
  noGrid('no grid: map on part of the picture', { W: 1800, H: 1100, seed: 84, ground: 'grass', only: { x: 0, y: 0, w: 1150, h: 1100 } }),
  noGrid('no grid: floorboards and a tiled room', { W: 1500, H: 1100, seed: 85, planks: { q: 30, contrast: 35 }, tiles: { x: 200, y: 200, w: 400, h: 300, q: 30, contrast: 35 } }, { soft: true }),
  // a tiled floor in one room really is evenly spaced lines; it must at least never be set up without being asked
  noGrid('no grid, but a tiled floor in one room', { W: 1500, H: 1100, seed: 50, tiles: { x: 300, y: 250, w: 480, h: 380, q: 24, contrast: 35 } }, { soft: true }),
];
