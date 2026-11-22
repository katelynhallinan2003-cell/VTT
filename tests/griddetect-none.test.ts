import { describe } from 'vitest';
import { CORPUS } from './helpers/gridcorpus';
import { runCases } from './helpers/gridrun';

describe('maps with no printed grid: nothing is found', () => {
  runCases(CORPUS.filter((c) => !c.truth));
});
