// Headless benchmark: generates and meshes a fixed set of chunks the way the game does and
// prints how long each step takes, plus the size of the result. `npm run bench`; numbers go
// in the milestone notes. Same seed and chunk set every time, so runs are comparable.
//
// Totals are the figure to compare between versions: per-item means change meaning when
// the work is split differently (columns instead of chunks, empty chunks skipped).

import { it } from 'vitest';
import { meshCulled } from '../src/mesh/culled';
import { type ChunkMesh, meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { World } from '../src/world/world';

const SEED = 20261022;
/** Columns within this many chunks of the origin are meshed; one ring further is generated for their borders. */
const RADIUS = 8;
const RUNS = 5;
const CHUNKS_PER_COLUMN = MAX_CHUNK_Y - MIN_CHUNK_Y + 1;

type Mesher = (padded: Uint8Array, cx: number, cy: number, cz: number) => ChunkMesh;
const MESHERS: Record<string, Mesher> = { culled: meshCulled, greedy: meshChunk };

function columns(radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let cz = -radius; cz <= radius; cz++)
    for (let cx = -radius; cx <= radius; cx++) if (cx * cx + cz * cz <= radius * radius) out.push([cx, cz]);
  return out;
}

interface Timing {
  /** Total ms of each run. */
  totals: number[];
  /** Every item's ms, all runs. */
  all: number[];
}

const newTiming = (): Timing => ({ totals: [], all: [] });

function record(t: Timing, times: number[]): void {
  t.totals.push(times.reduce((a, b) => a + b, 0));
  t.all.push(...times);
}

const median = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const percentile = (v: number[], p: number): number => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))];
const num = (v: number, digits = 3): string => v.toFixed(digits).padStart(9);

it('bench', () => {
  const genColumns = columns(RADIUS + 1);
  const meshColumns = columns(RADIUS);
  const gen = newTiming();
  const pad = newTiming();
  const mesh: Record<string, Timing> = Object.fromEntries(Object.keys(MESHERS).map((k) => [k, newTiming()]));
  const sizes: Record<string, { triangles: number; bytes: number }> = {};
  let emptyChunks = 0;
  let meshedChunks = 0;

  // One warm-up run (JIT), then RUNS measured ones.
  for (let run = 0; run <= RUNS; run++) {
    const world = new World(SEED);
    const genTimes: number[] = [];
    for (const [cx, cz] of genColumns) {
      const t0 = performance.now();
      world.ensureColumn(cx, cz);
      genTimes.push(performance.now() - t0);
    }

    // As the loader does: all-air chunks are neither padded nor meshed.
    const padTimes: number[] = [];
    const padded: [Uint8Array, number, number, number][] = [];
    for (const [cx, cz] of meshColumns) {
      for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
        if (world.getChunk(cx, cy, cz)!.empty) continue;
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
      emptyChunks = [...world.chunks.values()].filter((c) => c.empty).length;
      meshedChunks = padded.length;
      continue;
    }
    record(gen, genTimes);
    record(pad, padTimes);
    for (const name of Object.keys(MESHERS)) record(mesh[name], meshTimes[name]);
  }

  const genChunks = genColumns.length * CHUNKS_PER_COLUMN;
  const row = (label: string, t: Timing, items: number, unit: string, extra = '') =>
    `${label.padEnd(16)}${num(median(t.totals), 0)}${num(median(t.totals) / items)}${num(percentile(t.all, 0.95))}${num(Math.max(...t.all))}  ${items} ${unit}${extra}`;
  const lines = [
    '',
    `seed ${SEED}, radius ${RADIUS}: ${genChunks} chunks generated (${emptyChunks} all air), ${meshedChunks} meshed; median of ${RUNS} runs`,
    `${''.padEnd(16)}${'total ms'.padStart(9)}${'mean'.padStart(9)}${'p95'.padStart(9)}${'max'.padStart(9)}  per`,
    row('generate', gen, genColumns.length, 'columns'),
    row('pad', pad, meshedChunks, 'chunks'),
    ...Object.entries(mesh).map(([name, t]) =>
      row(`mesh (${name})`, t, meshedChunks, 'chunks', `: ${Math.round(sizes[name].triangles / 1000)}k triangles, ${(sizes[name].bytes / 2 ** 20).toFixed(1)} MB vertex data`),
    ),
    '',
  ];
  console.log(lines.join('\n'));
});
