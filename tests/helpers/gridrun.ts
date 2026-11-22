import { expect, it } from 'vitest';
import { AUTO_GRID_STRENGTH, detectPrintedGrid } from '../../src/core/mapgrid';
import type { Case } from './gridcorpus';
import { gridError, makeMap } from './mapgen';

/** The very big pictures take a few seconds each to draw, so they only run when asked for: GRID_SLOW=1 npx vitest run tests/griddetect */
const SLOW = !!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GRID_SLOW;

/**
 * Each picture is looked at the way a newly added map is (nothing set up yet, squares and hexes both tried).
 * A map with a grid has to come back with that grid, within a pixel and a half anywhere on the picture, and be sure enough to be set up
 * without asking (unless it is marked `quiet`). A map without one has to come back with nothing.
 */
export function runCases(cases: Case[]) {
  for (const c of cases) {
    (c.slow && !SLOW ? it.skip : it)(c.name, () => {
      const img = makeMap(c.spec);
      const f = detectPrintedGrid(img, { any: true, hint: 70, shape: 'square' });
      const auto = !!f && f.strength >= AUTO_GRID_STRENGTH;
      const got = JSON.stringify(f);
      if (!c.truth) {
        if (c.soft) expect(auto, `set up without asking: ${got}`).toBe(false);
        else expect(f, `found a grid where there is none: ${got}`).toBeNull();
        return;
      }
      if (!f) { expect(c.soft, 'the grid was missed').toBe(true); return; }
      expect(gridError(f.cut, c.truth, img.width, img.height), `the wrong grid: ${got}`).toBeLessThan(1.5);
      if (c.quiet) expect(auto, `should wait to be asked: ${got}`).toBe(false);
      else if (!c.soft) expect(auto, `should be sure enough to set up without asking: ${got}`).toBe(true);
    }, 120000);
  }
}
