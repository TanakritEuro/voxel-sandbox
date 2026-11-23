// Generation version 4 (Milestone 22) is version 3 with settlements: worlds made with it keep their land.
// Away from settlements it makes what version 3 makes (the first columns, the same checksums as version
// 3's); the last five are a settlement's columns. A later change to generation must leave these alone.

import { describe, expect, it } from 'vitest';
import { MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { Generator } from '../src/world/generate';
import { CHECKED, columnChecksum } from './generationV1.test';

/** A settlement's columns: its well's, and a hut's. */
export const SETTLED: [seed: number, cx: number, cz: number][] = [
  [20261022, 11, -6],
  [7, 2, 13],
  [7, 2, 14],
  [123, -16, -8],
  [123, -16, -7],
];

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
  '20261022 11,-6': '7826bc88',
  '7 2,13': 'cbc07245',
  '7 2,14': 'be56b0ff',
  '123 -16,-8': '3c737b42',
  '123 -16,-7': 'e6de6e8b',
};

describe('generation version 4', () => {
  it('makes exactly the blocks it made when it came (Milestone 22)', () => {
    const got: Record<string, string> = {};
    for (const [seed, cx, cz] of [...CHECKED, ...SETTLED]) got[`${seed} ${cx},${cz}`] = columnChecksum(new Generator(seed, { generation: 4 }).generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y));
    expect(got).toEqual(EXPECTED);
  });
});
