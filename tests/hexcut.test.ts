import { describe, expect, it } from 'vitest';
import { hexCentersIn } from '../src/core/hex';
import { findGrid, type GridCut, type PixelImage } from '../src/core/gridcut';
import { findHexGrid, hexGridFor, hexSides, hideHexGrid } from '../src/core/hexcut';

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/** A stony picture with a printed hex grid: sides `t` thick, hexes `p` apart centre to centre, the hex at the origin in the box starting at (ox, oy). */
function hexMap(W: number, H: number, p: number, ox: number, oy: number, t: number, shape: 'pointy' | 'flat', opts: { light?: boolean; noGrid?: boolean; contrast?: number } = {}): PixelImage {
  const r = rng(11);
  const data = new Uint8ClampedArray(W * H * 4);
  const contrast = opts.contrast ?? 70;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const blot = Math.sin(x / 37) * 18 + Math.cos(y / 53) * 14 + Math.sin((x + y) / 91) * 10;
      const v = 150 + blot + (r() - 0.5) * 40;
      const i = (y * W + x) * 4;
      data[i] = v; data[i + 1] = v * 0.93; data[i + 2] = v * 0.8; data[i + 3] = 255;
    }
  }
  if (!opts.noGrid) {
    const half = t / 2;
    for (const [a, b] of hexSides({ p, x: ox, y: oy }, shape, W, H)) {
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - half - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) + half + 1));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - half - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) + half + 1));
      const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const s = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2));
        if (Math.hypot(x - (a.x + ex * s), y - (a.y + ey * s)) <= half) {
          const i = (y * W + x) * 4;
          const d = opts.light ? contrast : -contrast;
          data[i] += d; data[i + 1] += d * 0.93; data[i + 2] += d * 0.8;
        }
      }
    }
  }
  return { data, width: W, height: H };
}

/** How far the nearest hex centre of the found lattice is from each true centre, worst case among the middle ones. */
function centreError(found: GridCut, truth: { p: number; x: number; y: number }, shape: 'pointy' | 'flat', W: number, H: number): number {
  const mk = (c: { p: number; x: number; y: number }) => ({ shape, cell: c.p, ox: c.x, oy: c.y, visible: true, color: '#000', opacity: 1, ft: 5, rule: 'chebyshev' as const, snap: true });
  const real = hexCentersIn(mk(truth), { x: 80, y: 80, w: W - 160, h: H - 160 });
  const got = hexCentersIn(mk(found), { x: 0, y: 0, w: W, h: H });
  let worst = 0;
  for (const c of real) {
    let best = Infinity;
    for (const g of got) best = Math.min(best, Math.hypot(g.x - c.x, g.y - c.y));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('finding a printed hex grid', () => {
  for (const shape of ['pointy', 'flat'] as const) {
    it(`finds ${shape}-top hexes: spacing, thickness and where the hexes sit`, () => {
      const W = 640, H = 520, p = 64, ox = 21, oy = 17, t = 2;
      const img = hexMap(W, H, p, ox, oy, t, shape);
      const f = findHexGrid(img, p * 0.96, shape)!;
      expect(f).not.toBeNull();
      expect(f.cut.hex).toBe(shape);
      expect(f.cut.p).toBeGreaterThan(p * 0.995);
      expect(f.cut.p).toBeLessThan(p * 1.005);
      expect(f.cut.t).toBeGreaterThanOrEqual(1);
      expect(f.cut.t).toBeLessThanOrEqual(5);
      expect(centreError(f.cut, { p, x: ox, y: oy }, shape, W, H)).toBeLessThan(2.2);
      expect(f.strength).toBeGreaterThan(2);
    });
  }

  it('finds light lines on dark ground too', () => {
    const img = hexMap(560, 480, 56, 9, 30, 3, 'pointy', { light: true });
    const f = findHexGrid(img, 58, 'pointy')!;
    expect(f).not.toBeNull();
    expect(f.cut.p).toBeGreaterThan(55.6);
    expect(f.cut.p).toBeLessThan(56.4);
  });

  it('tells the orientation even if the scene says the other one', () => {
    const img = hexMap(600, 500, 60, 12, 8, 2, 'flat');
    const f = findHexGrid(img, 60, 'pointy')!;
    expect(f).not.toBeNull();
    expect(f.cut.hex).toBe('flat');
  });

  it('finds it with no hint at all (and not a multiple of the spacing)', () => {
    const img = hexMap(700, 600, 70, 15, 25, 2, 'pointy');
    const f = findHexGrid(img, undefined, 'pointy')!;
    expect(f).not.toBeNull();
    expect(f.cut.p).toBeGreaterThan(69);
    expect(f.cut.p).toBeLessThan(71);
  });

  it('finds nothing in a picture without a grid', () => {
    expect(findHexGrid(hexMap(500, 400, 50, 0, 0, 2, 'pointy', { noGrid: true }), 50, 'pointy')).toBeNull();
  });

  it('does not take a square grid for hexes, and a square finder does not take hexes for squares', () => {
    expect(findGrid(hexMap(500, 450, 56, 5, 5, 2, 'pointy'))).toBeNull();
  });

  it('a very faint grid is not taken for one', () => {
    expect(findHexGrid(hexMap(500, 400, 50, 3, 3, 2, 'pointy', { contrast: 1 }), 50, 'pointy')).toBeNull();
  });
});

describe('hiding a printed hex grid', () => {
  it('fills the lines in so nothing of them is left, and leaves the rest of the picture alone', () => {
    const W = 520, H = 440, p = 52, ox = 14, oy = 11, t = 2;
    const img = hexMap(W, H, p, ox, oy, t, 'pointy');
    const plain = hexMap(W, H, p, ox, oy, t, 'pointy', { noGrid: true });
    const cut = { p, x: ox, y: oy, t, hex: 'pointy' as const };
    // how much darker the middle of the sides are than 5 pixels either side of them
    const dark = (im: PixelImage) => {
      let s = 0, n = 0;
      for (const [a, b] of hexSides(cut, 'pointy', W, H)) {
        for (const u of [0.3, 0.5, 0.7]) {
          const x = Math.round(a.x + (b.x - a.x) * u), y = Math.round(a.y + (b.y - a.y) * u);
          if (x < 8 || y < 8 || x >= W - 8 || y >= H - 8) continue;
          const len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
          const px = (xx: number, yy: number) => im.data[(Math.round(yy) * W + Math.round(xx)) * 4];
          s += (px(x + nx * 5, y + ny * 5) + px(x - nx * 5, y - ny * 5)) / 2 - px(x, y);
          n++;
        }
      }
      return s / n;
    };
    const before = dark(img);
    hideHexGrid(img, cut);
    const after = dark(img);
    expect(before).toBeGreaterThan(40);
    expect(Math.abs(after)).toBeLessThan(12);
    // pixels well away from every side did not change
    let changed = 0, far = 0;
    const sides = hexSides(cut, 'pointy', W, H);
    for (let y = 20; y < H - 20; y += 3) for (let x = 20; x < W - 20; x += 3) {
      let near = Infinity;
      for (const [a, b] of sides) {
        const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
        const s = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2));
        near = Math.min(near, Math.hypot(x - (a.x + ex * s), y - (a.y + ey * s)));
      }
      if (near > 8) { far++; if (img.data[(y * W + x) * 4] !== plain.data[(y * W + x) * 4]) changed++; }
    }
    expect(far).toBeGreaterThan(1000);
    expect(changed).toBe(0);
  });

  it('works for flat-top hexes and light lines', () => {
    const W = 500, H = 420, p = 50, ox = 9, oy = 20, t = 3;
    const img = hexMap(W, H, p, ox, oy, t, 'flat', { light: true });
    const cut = { p, x: ox, y: oy, t, hex: 'flat' as const };
    hideHexGrid(img, cut);
    let worst = 0;
    for (const [a, b] of hexSides(cut, 'flat', W, H)) {
      const x = Math.round((a.x + b.x) / 2), y = Math.round((a.y + b.y) / 2);
      if (x < 10 || y < 10 || x >= W - 10 || y >= H - 10) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      const px = (xx: number, yy: number) => img.data[(Math.round(yy) * W + Math.round(xx)) * 4];
      worst = Math.max(worst, Math.abs(px(x, y) - (px(x + nx * 6, y + ny * 6) + px(x - nx * 6, y - ny * 6)) / 2));
    }
    expect(worst).toBeLessThan(45); // from 70 levels brighter down to the noise of the ground
  });

  it('where the app grid would have to go to sit on the printed one', () => {
    const g = hexGridFor({ on: true, p: 50, x: 9.5, y: 20.25, t: 2, hex: 'flat' }, 2, 100, 40)!;
    expect(g.shape).toBe('flat');
    expect(g.cell).toBe(100);
    expect(g.ox).toBeGreaterThanOrEqual(0);
    expect(g.ox).toBeLessThan(100 * Math.sqrt(3));
    expect(hexGridFor({ on: true, p: 50, x: 1, y: 1, t: 2 }, 2, 0, 0)).toBeNull(); // a square cut has no hex grid
  });
});
