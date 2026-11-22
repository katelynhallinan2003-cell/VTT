import { describe, expect, it } from 'vitest';
import { GREY_FOG, lineOp, polyOp } from '../src/core/fog';
import { normalizeFogOp } from '../src/core/model';

describe('fog ops', () => {
  it('know the explored mode', () => {
    expect(normalizeFogOp({ m: 'x', t: 'rect', p: '0,0,1,1' })).toMatchObject({ m: 'x' });
    expect(normalizeFogOp({ m: 'h', t: 'rect', p: '0,0,1,1' })).toMatchObject({ m: 'h' });
    expect(normalizeFogOp({ m: 'zzz', t: 'rect', p: '0,0,1,1' })).toMatchObject({ m: 'r' });
    expect(lineOp('x', [{ x: 0, y: 0 }, { x: 5, y: 5 }], 10).m).toBe('x');
    expect(polyOp('x', [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]).m).toBe('x');
  });
  it('grey fog leaves part of the black', () => {
    expect(GREY_FOG).toBeGreaterThan(0.3);
    expect(GREY_FOG).toBeLessThan(0.9);
  });
});

// the pixels themselves (three kinds of ground, grey fog) are checked in the browser: tests/e2e/batchZ4.mjs
