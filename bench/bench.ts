// Headless benchmark: generates and meshes a fixed set of chunks and prints how long each
// step takes per chunk, plus the size of the result. `npm run bench`; numbers go in the
// milestone notes. Same seed and chunk set every time, so runs are comparable.

import { it } from 'vitest';
import { type ChunkMesh, meshChunk, paddedBlocks } from '../src/mesh/mesher';
import { MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { World } from '../src/world/world';

const SEED = 20261022;
/** Columns within this many chunks of the origin are meshed; one ring further is generated for their borders. */
const RADIUS = 8;
const RUNS = 5;

type Mesher = (padded: Uint8Array, cx: number, cy: number, cz: number) => ChunkMesh;
const MESHERS: Record<string, Mesher> = { culled: meshChunk };

function columns(radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let cz = -radius; cz <= radius; cz++)
    for (let cx = -radius; cx <= radius; cx++) if (cx * cx + cz * cz <= radius * radius) out.push([cx, cz]);
  return out;
}

interface Timing {
  /** Mean ms per item of each run. */
  means: number[];
  /** Every item's ms, all runs. */
  all: number[];
}

const newTiming = (): Timing => ({ means: [], all: [] });

function record(t: Timing, times: number[]): void {
  t.means.push(times.reduce((a, b) => a + b, 0) / times.length);
  t.all.push(...times);
}

const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const percentile = (v: number[], p: number): number => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))];
const ms = (v: number): string => v.toFixed(3).padStart(8);

it('bench', () => {
  const genColumns = columns(RADIUS + 1);
  const meshColumns = columns(RADIUS);
  const gen = newTiming();
  const pad = newTiming();
  const mesh: Record<string, Timing> = Object.fromEntries(Object.keys(MESHERS).map((k) => [k, newTiming()]));
  const sizes: Record<string, { triangles: number; bytes: number }> = {};
  let emptyChunks = 0;

  // One warm-up run (JIT), then RUNS measured ones.
  for (let run = 0; run <= RUNS; run++) {
    const world = new World(SEED);
    const genTimes: number[] = [];
    for (const [cx, cz] of genColumns) {
      for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
        const t0 = performance.now();
        world.ensureChunk(cx, cy, cz);
        genTimes.push(performance.now() - t0);
      }
    }

    const padTimes: number[] = [];
    const padded: [Uint8Array, number, number, number][] = [];
    for (const [cx, cz] of meshColumns) {
      for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
        const t0 = performance.now();
        padded.push([paddedBlocks(world, cx, cy, cz), cx, cy, cz]);
        padTimes.push(performance.now() - t0);
      }
    }

    const meshTimes: Record<string, number[]> = {};
    for (const [name, mesher] of Object.entries(MESHERS)) {
      const times: number[] = [];
      let triangles = 0;
      let bytes = 0;
      for (const [p, cx, cy, cz] of padded) {
        const t0 = performance.now();
        const m = mesher(p, cx, cy, cz);
        times.push(performance.now() - t0);
        for (const d of [m.opaque, m.transparent]) {
          triangles += d.indices.length / 3;
          bytes += d.positions.byteLength + d.colors.byteLength + d.indices.byteLength;
        }
      }
      meshTimes[name] = times;
      sizes[name] = { triangles, bytes };
    }

    if (run === 0) {
      emptyChunks = [...world.chunks.values()].filter((c) => c.blocks.every((b) => b === 0)).length;
      continue;
    }
    record(gen, genTimes);
    record(pad, padTimes);
    for (const name of Object.keys(MESHERS)) record(mesh[name], meshTimes[name]);
  }

  const genCount = genColumns.length * (MAX_CHUNK_Y - MIN_CHUNK_Y + 1);
  const meshCount = meshColumns.length * (MAX_CHUNK_Y - MIN_CHUNK_Y + 1);
  const row = (label: string, t: Timing, extra = '') =>
    `${label.padEnd(16)}${ms(median(t.means))}${ms(percentile(t.all, 0.95))}${ms(Math.max(...t.all))}  ${extra}`;
  const lines = [
    '',
    `seed ${SEED}, radius ${RADIUS}: ${genCount} chunks generated (${emptyChunks} all air), ${meshCount} meshed; median of ${RUNS} runs`,
    `${''.padEnd(16)}${'mean ms'.padStart(8)}${'p95'.padStart(8)}${'max'.padStart(8)}  per chunk`,
    row('generate', gen),
    row('pad', pad),
    ...Object.entries(mesh).map(([name, t]) =>
      row(`mesh (${name})`, t, `${Math.round(sizes[name].triangles / 1000)}k triangles, ${(sizes[name].bytes / 2 ** 20).toFixed(1)} MB vertex data`),
    ),
    '',
  ];
  console.log(lines.join('\n'));
});
