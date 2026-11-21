import { describe, expect, it } from 'vitest';
import { findGrid, hideGrid, scaleCut, type PixelImage } from '../src/core/gridcut';

// a small deterministic random number generator, so the "stone" texture is the same every run
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/** A stony picture with a printed grid: lines `t` thick every `p` pixels, starting at (ox, oy). */
function mapWith(W: number, H: number, p: number, ox: number, oy: number, t: number, opts: { light?: boolean; noGrid?: boolean; contrast?: number } = {}): PixelImage {
  const r = rng(7);
  const data = new Uint8ClampedArray(W * H * 4);
  const contrast = opts.contrast ?? 70;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // blotchy base colour (bigger features) plus fine grain
      const blot = Math.sin(x / 37) * 18 + Math.cos(y / 53) * 14 + Math.sin((x + y) / 91) * 10;
      let v = 150 + blot + (r() - 0.5) * 40;
      if (!opts.noGrid) {
        const dx = ((x - ox) % p + p) % p, dy = ((y - oy) % p + p) % p;
        if (dx < t || dy < t) v += opts.light ? contrast : -contrast;
      }
      const i = (y * W + x) * 4;
      data[i] = v; data[i + 1] = v * 0.93; data[i + 2] = v * 0.8; data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

const lineContrast = (img: PixelImage, p: number, ox: number, oy: number, t: number) => {
  // how much darker the line pixels are than the pixels 5 away, averaged along each line
  let sum = 0, n = 0;
  for (let y = 5; y < img.height - 5; y++) {
    for (let x = ox; x < img.width - 5; x += p) {
      const at = (xx: number) => img.data[(y * img.width + xx) * 4];
      if (x + t + 5 >= img.width) continue;
      if (((y - oy) % p + p) % p < t + 6 || ((y - oy) % p + p) % p > p - 6) continue; // away from the crossings
      sum += (at(x - 5) + at(x + t + 4)) / 2 - (at(x) + at(x + t - 1)) / 2;
      n++;
    }
  }
  return n ? sum / n : 0;
};

describe('finding a printed grid', () => {
  const img = mapWith(500, 400, 50, 13, 7, 2);

  it('with an expected spacing close by, it finds the spacing, the offset and the thickness', () => {
    const f = findGrid(img, 48)!;
    expect(f).not.toBeNull();
    expect(f.cut.p).toBeGreaterThan(49.8);
    expect(f.cut.p).toBeLessThan(50.2);
    expect(Math.abs(f.cut.x + 0.5 - 13.5 - 0)).toBeLessThan(1.6);
    expect(Math.abs(f.cut.y - 7.5)).toBeLessThan(1.6);
    expect(f.cut.t).toBeGreaterThanOrEqual(1);
    expect(f.cut.t).toBeLessThanOrEqual(4);
    expect(f.strength).toBeGreaterThan(5);
  });

  it('without any hint it still finds the spacing (and not a multiple of it)', () => {
    const f = findGrid(img)!;
    expect(f).not.toBeNull();
    expect(f.cut.p).toBeGreaterThan(49.7);
    expect(f.cut.p).toBeLessThan(50.3);
  });

  it('light lines are found as well as dark ones', () => {
    const f = findGrid(mapWith(500, 400, 40, 5, 22, 3, { light: true }), 41)!;
    expect(f).not.toBeNull();
    expect(Math.abs(f.cut.p - 40)).toBeLessThan(0.25);
  });

  it('a picture with no grid gives nothing', () => {
    expect(findGrid(mapWith(500, 400, 50, 0, 0, 2, { noGrid: true }), 50)).toBeNull();
    expect(findGrid(mapWith(500, 400, 50, 0, 0, 2, { noGrid: true }))).toBeNull();
  });

  it('very faint lines are not mistaken for a grid', () => {
    expect(findGrid(mapWith(500, 400, 50, 13, 7, 2, { contrast: 1 }), 50)).toBeNull();
  });

  it('an expected spacing that is half the real one still finds the real one', () => {
    const f = findGrid(img, 25)!;
    expect(f).not.toBeNull();
    expect(Math.abs(f.cut.p - 50)).toBeLessThan(0.3);
    expect(Math.abs(f.cut.x - 13.5)).toBeLessThan(1.6);
    // a third of it too
    const g = findGrid(mapWith(600, 450, 60, 8, 30, 2), 20)!;
    expect(Math.abs(g.cut.p - 60)).toBeLessThan(0.3);
  });

  it('smooth texture on a big picture is not taken for a grid', () => {
    const W = 1400, H = 1000;
    const r = rng(12345);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = 150 + Math.sin(x / 37) * 18 + Math.cos(y / 53) * 14 + (r() - 0.5) * 40;
      const i = (y * W + x) * 4; data[i] = v; data[i + 1] = v * 0.93; data[i + 2] = v * 0.8; data[i + 3] = 255;
    }
    expect(findGrid({ data, width: W, height: H })).toBeNull();
    expect(findGrid({ data, width: W, height: H }, 35)).toBeNull();
  });

  it('a spacing that is not quite right is corrected', () => {
    const f = findGrid(img, 52)!;
    expect(f).not.toBeNull();
    expect(Math.abs(f.cut.p - 50)).toBeLessThan(0.3);
  });
});

describe('hiding the grid', () => {
  it('fills the lines in so they no longer stand out', () => {
    const img = mapWith(500, 400, 50, 13, 7, 2);
    const before = lineContrast(img, 50, 13, 7, 2);
    expect(before).toBeGreaterThan(50);
    const f = findGrid(img, 50)!;
    hideGrid(img, f.cut);
    const after = lineContrast(img, 50, 13, 7, 2);
    expect(Math.abs(after)).toBeLessThan(before * 0.2);
  });

  it('leaves pixels well away from the lines alone', () => {
    const img = mapWith(500, 400, 50, 13, 7, 2);
    const copy = new Uint8ClampedArray(img.data);
    const f = findGrid(img, 50)!;
    hideGrid(img, f.cut);
    let same = 0, total = 0;
    for (let y = 20; y < 380; y++) for (let x = 20; x < 480; x++) {
      const dx = ((x - 13) % 50 + 50) % 50, dy = ((y - 7) % 50 + 50) % 50;
      if (dx > 8 && dx < 42 && dy > 8 && dy < 42) { total++; if (img.data[(y * 500 + x) * 4] === copy[(y * 500 + x) * 4]) same++; }
    }
    expect(same).toBe(total);
  });

  it('does not touch the alpha channel', () => {
    const img = mapWith(200, 200, 50, 10, 10, 2);
    hideGrid(img, { p: 50, x: 10, y: 10, t: 2 });
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255);
  });

  it('copes with lines at the very edge of the picture', () => {
    const img = mapWith(200, 200, 50, 0, 0, 2);
    expect(() => hideGrid(img, { p: 50, x: 0, y: 0, t: 2 })).not.toThrow();
    expect(() => hideGrid(img, { p: 50, x: 199, y: 199, t: 3 })).not.toThrow();
  });
});

describe('scaling the answer', () => {
  it('half-size picture, half-size lines', () => {
    const c = scaleCut({ on: true, p: 100, x: 20, y: 30, t: 4 }, 0.5);
    expect(c).toEqual({ on: true, p: 50, x: 10, y: 15, t: 2 });
    expect(scaleCut({ on: true, p: 10, x: 0, y: 0, t: 1 }, 0.1).t).toBe(1);
  });
});
