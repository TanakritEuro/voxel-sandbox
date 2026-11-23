// Generation version 3 is the world as it was before Milestone 22: worlds made with it keep their
// land. These checksums were taken from the generator before the milestone changed anything (commit
// 19ac841); a version 3 generator must still make exactly the same blocks, settlements' columns too.

import { describe, expect, it } from 'vitest';
import { MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { Generator } from '../src/world/generate';
import { CHECKED, columnChecksum } from './generationV1.test';
import { SETTLED } from './generationV4.test';

const EXPECTED: Record<string, string> = {
  '20261022 0,0': '906a2fc9',
  '20261022 3,-2': 'ffaefba6',
  '20261022 -12,9': '0b448103',
  '20261022 25,25': '30fee7eb',
  '20261022 -30,-14': 'd6f0c66d',
  '20261022 47,-60': '986f445e',
  '20261022 -2,2': '9562e7be',
  '20261022 -4,3': '064fa84c',
  '7 0,0': 'dc36c0e6',
  '7 18,-33': '734f059e',
  '123 -9,40': 'e7ce0ef2',
  '123 60,5': '7f608218',
  // Where version 4 puts a settlement (taken from 19ac841's generator too).
  '20261022 11,-6': 'cb2dec04',
  '7 2,13': 'd7552d45',
  '7 2,14': '88aa46c8',
  '123 -16,-8': 'c9b389e1',
  '123 -16,-7': '54e52399',
};

describe('generation version 3', () => {
  it('makes exactly the blocks it made before Milestone 22', () => {
    const got: Record<string, string> = {};
    for (const [seed, cx, cz] of [...CHECKED, ...SETTLED]) got[`${seed} ${cx},${cz}`] = columnChecksum(new Generator(seed, { generation: 3 }).generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y));
    expect(got).toEqual(EXPECTED);
  });
});
