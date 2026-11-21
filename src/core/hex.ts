// Hex grids. `cell` is the distance between the centres of two neighbouring hexes (the width from flat side to flat side),
// so a hex is "one square" for token sizes, feet per square, auras and every other length on the board.
//
// (ox, oy) is the top-left corner of the box around the hex at the origin, the same way it is the top-left of a square on a
// square grid. That is also what you get from drawing a box around a hex, so setting the grid from a box works the same.
// 'pointy' hexes have a point at the top and bottom (rows are staggered); 'flat' hexes have a flat top (columns are staggered).
import type { GridSettings, Vec } from '../types';

export const S3 = Math.sqrt(3);

export const isHex = (g: Pick<GridSettings, 'shape'>): boolean => g.shape === 'pointy' || g.shape === 'flat';

/** Centre-to-corner distance. */
export const hexRadius = (g: Pick<GridSettings, 'cell'>) => g.cell / S3;

/** How far the grid repeats sideways and down: offsets only make sense inside these. */
export function gridPeriod(g: Pick<GridSettings, 'cell' | 'shape'>): { x: number; y: number } {
  if (g.shape === 'pointy') return { x: g.cell, y: g.cell * S3 };
  if (g.shape === 'flat') return { x: g.cell * S3, y: g.cell };
  return { x: g.cell, y: g.cell };
}

/** Centre of the hex at the origin. */
function origin(g: GridSettings): Vec {
  return g.shape === 'pointy' ? { x: g.ox + g.cell / 2, y: g.oy + g.cell / S3 } : { x: g.ox + g.cell / S3, y: g.oy + g.cell / 2 };
}

/** Where the centre of hex (q, r) is. */
export function hexToPx(g: GridSettings, q: number, r: number): Vec {
  const o = origin(g);
  return g.shape === 'pointy'
    ? { x: o.x + g.cell * (q + r / 2), y: o.y + g.cell * (S3 / 2) * r }
    : { x: o.x + g.cell * (S3 / 2) * q, y: o.y + g.cell * (r + q / 2) };
}

/** Which hex a point is in, as fractional coordinates (whole numbers are hex centres). */
export function pxToHex(g: GridSettings, p: Vec): { q: number; r: number } {
  const o = origin(g);
  if (g.shape === 'pointy') {
    const r = (p.y - o.y) / (g.cell * (S3 / 2));
    return { q: (p.x - o.x) / g.cell - r / 2, r };
  }
  const q = (p.x - o.x) / (g.cell * (S3 / 2));
  return { q, r: (p.y - o.y) / g.cell - q / 2 };
}

/** Round fractional hex coordinates to the hex that contains them. */
export function roundHex(q: number, r: number): { q: number; r: number } {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

export function hexAt(g: GridSettings, p: Vec): { q: number; r: number } {
  const f = pxToHex(g, p);
  return roundHex(f.q, f.r);
}

/** The middle of the hex a point is in. */
export function hexCenter(g: GridSettings, p: Vec): Vec {
  const h = hexAt(g, p);
  return hexToPx(g, h.q, h.r);
}

/** The six corners of the hex centred at `c`. */
export function hexCorners(g: GridSettings, c: Vec): Vec[] {
  const R = hexRadius(g);
  const a0 = g.shape === 'pointy' ? Math.PI / 6 : 0;
  const out: Vec[] = [];
  for (let i = 0; i < 6; i++) {
    const a = a0 + (i * Math.PI) / 3;
    out.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) });
  }
  return out;
}

const nearest = (p: Vec, list: Vec[]): Vec => list.reduce((best, q) => (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? q : best), list[0]);

/** The nearest hex corner. */
export function hexCorner(g: GridSettings, p: Vec): Vec {
  return nearest(p, hexCorners(g, hexCenter(g, p)));
}

/** Axial steps to the six neighbours, clockwise from the east (pointy) or the south-east (flat). */
export const HEX_DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

/** The middles of the six neighbours' shared edges. */
export function hexEdgeMids(g: GridSettings, c: Vec): Vec[] {
  const h = hexAt(g, c);
  return HEX_DIRS.map(([dq, dr]) => {
    const n = hexToPx(g, h.q + dq, h.r + dr);
    return { x: (c.x + n.x) / 2, y: (c.y + n.y) / 2 };
  });
}

/** The nearest middle of a hex side. */
export function hexEdgeMid(g: GridSettings, p: Vec): Vec {
  return nearest(p, hexEdgeMids(g, hexCenter(g, p)));
}

/** Directions to the neighbours, as angles in radians (y points down). */
export function hexAxes(g: Pick<GridSettings, 'shape'>): { base: number; step: number } {
  // pointy hexes have neighbours straight east (0°) and every 60° from there; flat hexes at 30°, 90°, ...
  return { base: g.shape === 'pointy' ? 0 : Math.PI / 6, step: Math.PI / 3 };
}

/** Distance between two points counted in hexes (neighbours are 1 apart). Works for points that are not at centres, too. */
export function hexDistance(g: GridSettings, a: Vec, b: Vec): number {
  const A = pxToHex(g, a);
  const B = pxToHex(g, b);
  const dq = B.q - A.q;
  const dr = B.r - A.r;
  return Math.round(((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2) * 1000) / 1000;
}

/** Centres of every hex whose centre lies inside the box. */
export function hexCentersIn(g: GridSettings, r: { x: number; y: number; w: number; h: number }): Vec[] {
  const out: Vec[] = [];
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const o = origin(g);
  if (g.shape === 'pointy') {
    const rowH = g.cell * (S3 / 2);
    for (let row = Math.ceil((r.y - o.y) / rowH - 1e-9); o.y + row * rowH <= y1 + 1e-9; row++) {
      const y = o.y + row * rowH;
      for (let q = Math.ceil((r.x - o.x) / g.cell - row / 2 - 1e-9); ; q++) {
        const x = o.x + g.cell * (q + row / 2);
        if (x > x1 + 1e-9) break;
        out.push({ x, y });
      }
    }
  } else {
    const colW = g.cell * (S3 / 2);
    for (let col = Math.ceil((r.x - o.x) / colW - 1e-9); o.x + col * colW <= x1 + 1e-9; col++) {
      const x = o.x + col * colW;
      for (let row = Math.ceil((r.y - o.y) / g.cell - col / 2 - 1e-9); ; row++) {
        const y = o.y + g.cell * (row + col / 2);
        if (y > y1 + 1e-9) break;
        out.push({ x, y });
      }
    }
  }
  return out;
}

/**
 * The step an arrow key takes from `p`. Along the staggered direction there is no hex straight ahead, so it zigzags: two
 * steps up (or sideways) end exactly in line with where they started, and a step back undoes the step before it.
 */
export function hexNudge(g: GridSettings, p: Vec, dir: 'left' | 'right' | 'up' | 'down'): Vec {
  const c = g.cell;
  const h = hexAt(g, p);
  const odd = Math.abs(h[g.shape === 'pointy' ? 'r' : 'q']) % 2 === 1;
  const half = c / 2;
  const tall = (c * S3) / 2;
  if (g.shape === 'pointy') {
    if (dir === 'left') return { x: -c, y: 0 };
    if (dir === 'right') return { x: c, y: 0 };
    if (dir === 'up') return odd ? { x: -half, y: -tall } : { x: half, y: -tall };
    return odd ? { x: -half, y: tall } : { x: half, y: tall };
  }
  if (dir === 'up') return { x: 0, y: -c };
  if (dir === 'down') return { x: 0, y: c };
  if (dir === 'left') return odd ? { x: -tall, y: -half } : { x: -tall, y: half };
  return odd ? { x: tall, y: -half } : { x: tall, y: half };
}
