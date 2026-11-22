import { describe } from 'vitest';
import { CORPUS } from './helpers/gridcorpus';
import { runCases } from './helpers/gridrun';

describe('finding a printed square grid on lifelike maps', () => {
  runCases(CORPUS.filter((c) => c.truth?.shape === 'square'));
});
