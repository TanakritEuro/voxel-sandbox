// Generation version 1 is the world as it was before Milestone 16: worlds made then keep their
// land. These checksums were taken from the generator before the milestone changed anything; a
// version 1 generator must still make exactly the same blocks.

import { describe, expect, it } from 'vitest';
import { ChunkLoader } from '../src/chunkLoader';
import { TUNING } from '../src/config';
import { MemoryStore, newWorldRecord, type WorldRecord } from '../src/save/store';
import { handleJob } from '../src/workers/jobs';
import type { Job } from '../src/workers/protocol';
import { MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { GENERATION, Generator, generationOf } from '../src/world/generate';
import { World } from '../src/world/world';

/** FNV-1a over a column's chunks (an all-air chunk as one byte of 255). */
export function columnChecksum(chunks: (Uint8Array | null)[]): string {
  let h = 0x811c9dc5;
  for (const c of chunks) {
    if (!c) {
      h = Math.imul(h ^ 255, 0x01000193);
      continue;
    }
    for (let i = 0; i < c.length; i++) h = Math.imul(h ^ c[i], 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Columns across biomes, caves, trees and the sea, for three seeds. */
export const CHECKED: [seed: number, cx: number, cz: number][] = [
  [20261022, 0, 0],
  [20261022, 3, -2],
  [20261022, -12, 9],
  [20261022, 25, 25],
  [20261022, -30, -14],
  [20261022, 47, -60],
  [20261022, -2, 2],
  [20261022, -4, 3],
  [7, 0, 0],
  [7, 18, -33],
  [123, -9, 40],
  [123, 60, 5],
];

/** Taken at the end of Milestone 15 (commit 4ded664), before generation versions existed. */
const EXPECTED: Record<string, string> = {
  '123 -9,40': '271ef208',
  '123 60,5': 'e9c5761b',
  '20261022 -12,9': 'bdc59968',
  '20261022 -2,2': '81ecfc4b',
  '20261022 -30,-14': 'e9794bb5',
  '20261022 -4,3': 'bee24df0',
  '20261022 0,0': 'a0169d9b',
  '20261022 25,25': '25815913',
  '20261022 3,-2': '68bfb7fe',
  '20261022 47,-60': '7662c2dc',
  '7 0,0': 'aff0c55d',
  '7 18,-33': '5e5076c1',
};

describe('generation version 1', () => {
  it('makes exactly the blocks it made before Milestone 16', () => {
    const generators = new Map<number, Generator>();
    const got: Record<string, string> = {};
    for (const [seed, cx, cz] of CHECKED) {
      let g = generators.get(seed);
      if (!g) generators.set(seed, (g = new Generator(seed, { generation: 1 })));
      got[`${seed} ${cx},${cz}`] = columnChecksum(g.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y));
    }
    expect(got).toEqual(EXPECTED);
  });
});

describe('generation versions', () => {
  it('are the newest for new worlds, 1 for worlds from before versions, and kept through saving', async () => {
    const fresh = newWorldRecord('w', 'New', 5, 0.3);
    expect(fresh.generation).toBe(GENERATION);
    expect(GENERATION).toBe(3);
    const old: WorldRecord = { ...fresh, generation: undefined };
    delete old.generation;
    expect(generationOf(old.generation)).toBe(1);
    for (const junk of [0, 4, '2', null, 1.5]) expect(generationOf(junk)).toBe(1);
    expect(generationOf(3)).toBe(3);
    const store = new MemoryStore();
    await store.putWorld(fresh);
    await store.putWorld({ ...old, id: 'o' });
    expect(generationOf((await store.getWorld('w'))!.generation)).toBe(3);
    expect(generationOf((await store.getWorld('o'))!.generation)).toBe(1);
  });

  it('go from the world to its generate jobs, and the worker makes what that version makes', () => {
    const budget = TUNING.view.applyBudgetMs;
    TUNING.view.applyBudgetMs = 1e9; // no time limit: this is about what's asked, not when
    for (const generation of [1, 2, 3] as const) {
      const world = new World(9, { generation });
      const jobs: Job[] = [];
      const loader = new ChunkLoader(world, { set: () => {}, remove: () => {}, show: () => {} }, { capacity: 4, run: (job) => void jobs.push(job), onResult: () => {} });
      loader.update(0, 70, 0, 1, 0);
      const generate = jobs.filter((j) => j.kind === 'generate');
      expect(generate.length).toBeGreaterThan(0);
      for (const j of generate) if (j.kind === 'generate') expect(j.generation).toBe(generation);
      const r = handleJob({ kind: 'generate', id: 1, seed: 9, generation, cx: 2, cz: -1, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y, saved: [] });
      if (r.kind !== 'generate') throw new Error('not generated');
      expect(r.chunks).toEqual(new Generator(9, { generation }).generateColumn(2, -1, MIN_CHUNK_Y, MAX_CHUNK_Y));
    }
    TUNING.view.applyBudgetMs = budget;
  });
});

