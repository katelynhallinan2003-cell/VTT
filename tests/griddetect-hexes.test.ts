import { describe } from 'vitest';
import { CORPUS } from './helpers/gridcorpus';
import { runCases } from './helpers/gridrun';

describe('finding a printed hex grid on lifelike maps', () => {
  runCases(CORPUS.filter((c) => c.truth && c.truth.shape !== 'square'));
});
