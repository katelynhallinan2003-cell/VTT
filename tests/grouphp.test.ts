import { describe, expect, it } from 'vitest';
import { shareOf } from '../src/ui/groupHp';

describe('a half share of damage', () => {
  it('is the whole amount for those who did not save, and half rounded down for those who did', () => {
    expect(shareOf(14, false)).toBe(14);
    expect(shareOf(14, true)).toBe(7);
    expect(shareOf(9, true)).toBe(4);
    expect(shareOf(1, true)).toBe(0);
  });
});
