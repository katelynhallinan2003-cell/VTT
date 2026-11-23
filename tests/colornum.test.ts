import { describe, expect, it } from 'vitest';
import { colorNum } from '../src/core/colornum';

describe('colorNum', () => {
  it('keeps black as black (a grid or ring set to black must not turn white)', () => {
    expect(colorNum('#000000')).toBe(0);
    expect(colorNum('#000')).toBe(0);
  });
  it('reads ordinary colours', () => {
    expect(colorNum('#ffffff')).toBe(0xffffff);
    expect(colorNum('#ff8800')).toBe(0xff8800);
  });
  it('falls back to white for something that is not a colour', () => {
    expect(colorNum('not a colour')).toBe(0xffffff);
    expect(colorNum('')).toBe(0xffffff);
  });
});

import { DEFAULT_GRID, gridColorToSave, normalizeGrid } from '../src/core/model';

describe('grid colour', () => {
  it('is white by default', () => {
    expect(DEFAULT_GRID.color).toBe('#ffffff');
    expect(normalizeGrid({}).color).toBe('#ffffff');
  });
  it('shows an old saved black as the white it always was', () => {
    expect(normalizeGrid({ color: '#000000' }).color).toBe('#ffffff');
    expect(normalizeGrid({ color: '#000' }).color).toBe('#ffffff');
  });
  it('keeps black that was picked on purpose', () => {
    const saved = gridColorToSave('#000000');
    expect(normalizeGrid({ color: saved }).color).toBe(saved);
    expect(colorNum(saved)).toBe(0x010101);
    expect(gridColorToSave('#336699')).toBe('#336699');
  });
});
