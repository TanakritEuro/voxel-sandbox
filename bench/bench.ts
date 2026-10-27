// Headless benchmark: generates and meshes a fixed set of chunks the way the game does and
// prints how long each step takes, plus the size of the result. `npm run bench`; numbers go
// in the milestone notes. Same seed and chunk set every time, so runs are comparable.
//
// Totals are the figure to compare between versions: per-item means change meaning when
// the work is split differently (columns instead of chunks, empty chunks skipped).

import { it } from 'vitest';
import { wallsFor } from '../src/chunkLoader';
import { TUNING } from '../src/config';
import { meshCulled } from '../src/mesh/culled';
import { type Lod, prepareLod } from '../src/mesh/lod';
import { type ChunkMesh, meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { decodeRle, encodeRle } from '../src/save/rle';
import { Block, BLOCKS } from '../src/world/blocks';
import { chunkKey, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../src/world/coords';
import { DARK, FULL_SUN, lightColumn } from '../src/world/light';
import { ALL_CONNECTED, reachableChunks } from '../src/world/visibility';
import { createBody, NO_INPUT, stepPlayer } from '../src/world/physics';
import { World } from '../src/world/world';

const SEED = 20261022;
/** Columns within this many chunks of the origin are meshed; one ring further is generated for their borders. */
const RADIUS = 8;
const RUNS = 5;
const CHUNKS_PER_COLUMN = MAX_CHUNK_Y - MIN_CHUNK_Y + 1;

type Mesher = (padded: Uint8Array, cx: number, cy: number, cz: number, light: Uint8Array) => ChunkMesh;
/** Far chunks (`mesh/lod.ts`) as the loader asks for them: walled on every side (`wallsFor`), coarsened copies (in the worker the padded arrays are coarsened in place), flat faces. */
const lodMesher =
  (lod: Lod): Mesher =>
  (padded, cx, cy, cz, light) => {
    const b = padded.slice();
    const l = light.slice();
    prepareLod(b, l, lod, wallsFor(lod));
    return meshChunk(b, cx, cy, cz, l, true);
  };
const MESHERS: Record<string, Mesher> = { culled: meshCulled, greedy: meshChunk, 'lod 1': lodMesher(1), 'lod 2': lodMesher(2) };

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
  const light = newTiming();
  const borders = newTiming();
  const pad = newTiming();
  const mesh: Record<string, Timing> = Object.fromEntries(Object.keys(MESHERS).map((k) => [k, newTiming()]));
  const sizes: Record<string, { triangles: number; bytes: number }> = {};
  let emptyChunks = 0;
  let meshedChunks = 0;
  let seenLine = '';
  let lightLine = '';

  // One warm-up run (JIT), then RUNS measured ones.
  for (let run = 0; run <= RUNS; run++) {
    const world = new World(SEED);
    // Generation and light (in the workers), and light across column borders (on the main thread).
    const genTimes: number[] = [];
    const lightTimes: number[] = [];
    const borderTimes: number[] = [];
    let raised = 0;
    for (const [cx, cz] of genColumns) {
      const t0 = performance.now();
      const chunks = world.generator.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y);
      const t1 = performance.now();
      const lit = lightColumn(chunks);
      const t2 = performance.now();
      raised += world.addColumn(cx, cz, chunks, undefined, lit);
      genTimes.push(t1 - t0);
      lightTimes.push(t2 - t1);
      borderTimes.push(performance.now() - t2);
    }

    // As the loader does: all-air chunks are neither padded nor meshed.
    const padTimes: number[] = [];
    const padded: [Uint8Array, number, number, number, Uint8Array][] = [];
    for (const [cx, cz] of meshColumns) {
      for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
        if (world.getChunk(cx, cy, cz)!.empty) continue;
        const t0 = performance.now();
        padded.push([paddedBlocks(world, cx, cy, cz), cx, cy, cz, paddedLight(world, cx, cy, cz)]);
        padTimes.push(performance.now() - t0);
      }
    }

    const meshTimes: Record<string, number[]> = {};
    for (const [name, mesher] of Object.entries(MESHERS)) {
      const times: number[] = [];
      let triangles = 0;
      let bytes = 0;
      for (const [p, cx, cy, cz, l] of padded) {
        const t0 = performance.now();
        const m = mesher(p, cx, cy, cz, l);
        times.push(performance.now() - t0);
        for (const d of [m.opaque, m.transparent]) {
          triangles += d.indices.length / 3;
          bytes += d.positions.byteLength + d.colors.byteLength + d.uvl.byteLength + d.indices.byteLength;
        }
      }
      meshTimes[name] = times;
      sizes[name] = { triangles, bytes };
    }

    if (run === 0) {
      emptyChunks = [...world.chunks.values()].filter((c) => c.empty).length;
      meshedChunks = padded.length;
      // What visibility culling leaves to mesh and draw, seen from the spawn point's chunk.
      const spawn = world.generator.findLand(0, 0);
      const eye = world.generator.height(spawn.x, spawn.z) + 2;
      const seen = reachableChunks(
        [toChunk(spawn.x), toChunk(eye), toChunk(spawn.z)],
        (x, y, z) => y >= MIN_CHUNK_Y && y <= MAX_CHUNK_Y && x * x + z * z <= RADIUS * RADIUS,
        (x, y, z) => world.getChunk(x, y, z)?.connectivity ?? ALL_CONNECTED,
      );
      let seenChunks = 0;
      let seenTriangles = 0;
      for (const [p, cx, cy, cz, l] of padded) {
        if (!seen.has(chunkKey(cx, cy, cz))) continue;
        const m = meshChunk(p, cx, cy, cz, l);
        seenChunks++;
        seenTriangles += (m.opaque.indices.length + m.transparent.indices.length) / 3;
      }
      seenLine = `seen from spawn (visibility culling): ${seenChunks} of ${meshedChunks} chunks, ${Math.round(seenTriangles / 1000)}k of ${Math.round(sizes.greedy.triangles / 1000)}k greedy triangles`;
      const all = [...world.chunks.values()];
      const shared = (a: Uint8Array) => all.filter((c) => c.light === a).length;
      lightLine = `light: ${all.length - shared(FULL_SUN) - shared(DARK)} chunks with their own array (${(world.lightBytes / 2 ** 20).toFixed(1)} MB), ${shared(FULL_SUN)} all sun, ${shared(DARK)} all dark; ${raised} blocks lit across column borders`;
      continue;
    }
    record(gen, genTimes);
    record(light, lightTimes);
    record(borders, borderTimes);
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
    row('light', light, genColumns.length, 'columns'),
    row('light borders', borders, genColumns.length, 'columns', ' (main thread)'),
    row('pad', pad, meshedChunks, 'chunks'),
    ...Object.entries(mesh).map(([name, t]) =>
      row(`mesh (${name})`, t, meshedChunks, 'chunks', `: ${Math.round(sizes[name].triangles / 1000)}k triangles, ${(sizes[name].bytes / 2 ** 20).toFixed(1)} MB vertex data`),
    ),
    seenLine,
    lightLine,
    '',
  ];
  console.log(lines.join('\n'));
});

it('player physics', () => {
  // A walk over generated terrain: sprinting and jumping, turning every few seconds, through
  // hills and into the sea, so the steps see slopes, walls and water.
  const world = new World(SEED);
  for (const [cx, cz] of columns(4)) world.ensureColumn(cx, cz);
  const spawn = world.generator.findLand(0, 0);
  const steps = Math.round(120 / TUNING.player.step);
  const totals: number[] = [];
  let walked = 0;
  for (let run = 0; run <= RUNS; run++) {
    walked = 0;
    const body = createBody(spawn.x + 0.5, world.generator.height(spawn.x, spawn.z) + 1, spawn.z + 0.5);
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) {
      const yaw = Math.floor(i / 600) * 2.1;
      const { x, z } = body;
      stepPlayer(body, { ...NO_INPUT, forward: 1, yaw, jump: true, sprint: true }, world);
      walked += Math.hypot(body.x - x, body.z - z);
    }
    if (run > 0) totals.push(performance.now() - t0);
  }
  const total = median(totals);
  const perStep = (total / steps) * 1000;
  console.log(
    `player physics: ${steps} steps (120 s walking, sprinting, jumping: ${Math.round(walked)} blocks covered) in ${total.toFixed(1)} ms, ` +
      `${perStep.toFixed(2)} µs a step; ${((perStep * 4) / 1000).toFixed(3)} ms for the 4 steps of a 30 fps frame\n`,
  );
});

it('edits', () => {
  // What an edit costs on the main thread: light, then remeshing every chunk it made stale
  // (as `main.ts` does). The worst cases are lights near a chunk corner, where the change
  // reaches into 8 chunks.
  const world = new World(SEED);
  for (const [cx, cz] of columns(3)) world.ensureColumn(cx, cz);
  const g = world.generator;
  const opaque = (x: number, y: number, z: number) => BLOCKS[world.getBlock(x, y, z)].opaque;

  // On the surface at the corner of four columns; and in the dark air of a cave nearest a chunk corner.
  const surface: [number, number, number] = [31, g.height(31, 31) + 1, 31];
  let cave: [number, number, number] | null = null;
  let best = Infinity;
  for (let y = 10; y < 60; y++)
    for (let z = -32; z < 64; z++)
      for (let x = -32; x < 64; x++) {
        if (world.getBlock(x, y, z) !== Block.Air || world.getLight(x, y, z) !== 0 || !opaque(x, y - 1, z)) continue;
        const d = Math.abs(((x + 16) & 31) - 16) + Math.abs(((y + 16) & 31) - 16) + Math.abs(((z + 16) & 31) - 16);
        if (d < best) [best, cave] = [d, [x, y, z]];
      }
  const cases: [string, [number, number, number], Block][] = [
    ['torch at a chunk corner, surface', surface, Block.Torch],
    ['torch near a chunk corner, cave', cave!, Block.Torch],
    ['lamp near a chunk corner, cave', cave!, Block.Lamp],
  ];

  const edit = (x: number, y: number, z: number, block: Block) => {
    const t0 = performance.now();
    const stale = world.setBlock(x, y, z, block);
    const light = world.lightMs;
    for (const c of stale) if (!c.empty) meshChunk(paddedBlocks(world, c.cx, c.cy, c.cz), c.cx, c.cy, c.cz, paddedLight(world, c.cx, c.cy, c.cz));
    return { ms: performance.now() - t0, light, chunks: stale.length };
  };
  const lines = ['', 'edits (main thread, median of 5): light, then remeshing what changed'];
  for (const [name, [x, y, z], block] of cases) {
    const place: number[] = [];
    const remove: number[] = [];
    const placeLight: number[] = [];
    const removeLight: number[] = [];
    let chunks = 0;
    for (let run = 0; run <= RUNS; run++) {
      const a = edit(x, y, z, block);
      const b = edit(x, y, z, Block.Air);
      if (run === 0) continue;
      place.push(a.ms);
      placeLight.push(a.light);
      remove.push(b.ms);
      removeLight.push(b.light);
      chunks = Math.max(a.chunks, b.chunks);
    }
    lines.push(
      `  ${name.padEnd(34)} place ${median(place).toFixed(1)} ms (light ${median(placeLight).toFixed(2)}), remove ${median(remove).toFixed(1)} ms (light ${median(removeLight).toFixed(2)}), ${chunks} chunks`,
    );
  }
  console.log(lines.join('\n') + '\n');
});

it('saving', () => {
  // What a saved chunk costs: RLE size and time, over every chunk with blocks within the radius
  // (an edited chunk is a generated one with a few blocks changed).
  const world = new World(SEED);
  for (const [cx, cz] of columns(RADIUS)) world.ensureColumn(cx, cz);
  const chunks = [...world.chunks.values()].filter((c) => !c.empty).map((c) => c.blocks);
  const encode: number[] = [];
  const decode: number[] = [];
  let bytes = 0;
  let biggest = 0;
  for (let run = 0; run <= RUNS; run++) {
    const t0 = performance.now();
    const packed = chunks.map((c) => encodeRle(c));
    const t1 = performance.now();
    for (const d of packed) decodeRle(d);
    const t2 = performance.now();
    if (run === 0) {
      bytes = packed.reduce((sum, d) => sum + d.length, 0);
      biggest = Math.max(...packed.map((d) => d.length));
      continue;
    }
    encode.push(t1 - t0);
    decode.push(t2 - t1);
  }
  const raw = chunks.length * chunks[0].length;
  console.log(
    `saving: ${chunks.length} chunks with blocks, RLE ${(bytes / 2 ** 20).toFixed(2)} MB of ${(raw / 2 ** 20).toFixed(1)} MB (${((bytes / raw) * 100).toFixed(1)} %), ` +
      `mean ${(bytes / chunks.length / 1024).toFixed(1)} KB, largest ${(biggest / 1024).toFixed(1)} KB; ` +
      `encode ${(median(encode) / chunks.length).toFixed(3)} ms, decode ${(median(decode) / chunks.length).toFixed(3)} ms a chunk\n`,
  );
});
