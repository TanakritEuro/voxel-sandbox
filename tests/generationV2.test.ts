// Generation version 2 is the world as it was before Milestone 19: worlds made with it keep their
// land. These checksums were taken from the generator before the milestone changed anything (commit
// 7a75b21); a version 2 generator must still make exactly the same blocks.

import { describe, expect, it } from 'vitest';
import { MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { Generator } from '../src/world/generate';
import { CHECKED, columnChecksum } from './generationV1.test';

const EXPECTED: Record<string, string> = {
  '20261022 0,0': 'f0dc5f11',
  '20261022 3,-2': '9e5607ea',
  '20261022 -12,9': 'bdc59968',
  '20261022 25,25': '28703d80',
  '20261022 -30,-14': 'e9794bb5',
  '20261022 47,-60': '1abb935e',
  '20261022 -2,2': 'f5b1b0da',
  '20261022 -4,3': '361576f4',
  '7 0,0': 'd3c73fda',
  '7 18,-33': '7d68fce3',
  '123 -9,40': 'db503046',
  '123 60,5': '113200d8',
};

describe('generation version 2', () => {
  it('makes exactly the blocks it made before Milestone 19', () => {
    const got: Record<string, string> = {};
    for (const [seed, cx, cz] of CHECKED) got[`${seed} ${cx},${cz}`] = columnChecksum(new Generator(seed, { generation: 2 }).generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y));
    expect(got).toEqual(EXPECTED);
  });
});
