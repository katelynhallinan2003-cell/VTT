import { describe, expect, it } from 'vitest';
import { maskCount, selectionPixels, sensitivityForDrag, unionMask, wandSelect } from '../src/core/wand';

/** Builds a w×h RGBA image from a picture of letters: each letter maps to a colour. */
function img(rows: string[], colours: Record<string, [number, number, number, number]>) {
  const h = rows.length, w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => data.set(colours[ch], (y * w + x) * 4)));
  return { data, w, h };
}
const C = { r: [220, 30, 30, 255], R: [200, 50, 50, 255], b: [30, 30, 220, 255], t: [0, 0, 0, 0], u: [90, 40, 40, 0] } as Record<string, [number, number, number, number]>;

describe('magic wand', () => {
  const pic = img(['rrbbr', 'rrbbr', 'bbbbr', 'rrbbR'], C);

  it('selects only the connected same-coloured area at zero sensitivity', () => {
    const m = wandSelect(pic.data, pic.w, pic.h, 0, 0, 0);
    expect(maskCount(m)).toBe(4); // the top-left red block, not the separate red on the right
    expect(m[0]).toBe(1);
    expect(m[4]).toBe(0);
  });

  it('does not jump across a different colour', () => {
    const m = wandSelect(pic.data, pic.w, pic.h, 0, 3, 0);
    expect(maskCount(m)).toBe(2); // the bottom-left reds are cut off from the top-left block by blue
  });

  it('selects more as the sensitivity goes up', () => {
    const exact = maskCount(wandSelect(pic.data, pic.w, pic.h, 4, 0, 0));
    const loose = maskCount(wandSelect(pic.data, pic.w, pic.h, 4, 0, 10)); // R is a slightly different red
    expect(loose).toBeGreaterThan(exact);
    const all = maskCount(wandSelect(pic.data, pic.w, pic.h, 0, 0, 100));
    expect(all).toBe(pic.w * pic.h);
  });

  it('treats every transparent pixel as the same colour', () => {
    const p = img(['tuu', 'ttu', 'rrr'], C);
    const m = wandSelect(p.data, p.w, p.h, 0, 0, 0);
    expect(maskCount(m)).toBe(6);
  });

  it('ignores clicks outside the picture', () => {
    expect(maskCount(wandSelect(pic.data, pic.w, pic.h, -1, 0, 50))).toBe(0);
    expect(maskCount(wandSelect(pic.data, pic.w, pic.h, 0, 99, 50))).toBe(0);
  });

  it('can add one selection to another', () => {
    const a = wandSelect(pic.data, pic.w, pic.h, 0, 0, 0);
    const b = wandSelect(pic.data, pic.w, pic.h, 4, 0, 0);
    expect(maskCount(unionMask(a, b))).toBe(maskCount(a) + maskCount(b));
  });

  it('turns a selection into a clip and an outlined tint', () => {
    const sel = wandSelect(pic.data, pic.w, pic.h, 0, 0, 0);
    const { clip, overlay } = selectionPixels(sel, false, pic.w, pic.h, 1);
    expect(clip[3]).toBe(255); // inside
    expect(clip[(0 * pic.w + 4) * 4 + 3]).toBe(0); // outside
    expect(overlay[3]).toBe(70); // the picture's own border is not an edge, so this is just tinted
    expect(overlay[1 * 4 + 3]).toBe(255); // the block's right-hand side is an edge
    const inv = selectionPixels(sel, true, pic.w, pic.h, 1);
    expect(inv.clip[3]).toBe(0);
    expect(inv.clip[(0 * pic.w + 4) * 4 + 3]).toBe(255);
  });

  it('maps drag distance to a sensitivity between 0 and 100', () => {
    expect(sensitivityForDrag(0)).toBe(0);
    expect(sensitivityForDrag(50)).toBeGreaterThan(sensitivityForDrag(20));
    expect(sensitivityForDrag(9999)).toBe(100);
  });
});
