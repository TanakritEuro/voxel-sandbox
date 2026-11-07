// Headless benchmark: generates and meshes a fixed set of chunks the way the game does and
// prints how long each step takes, plus the size of the result. `npm run bench`; numbers go
// in the milestone notes. Same seed and chunk set every time, so runs are comparable.
//
// Totals are the figure to compare between versions: per-item means change meaning when
// the work is split differently (columns instead of chunks, empty chunks skipped).

import { it } from 'vitest';
import { wallsFor } from '../src/chunkLoader';
import { TUNING } from '../src/config';
import { createRng } from '../src/math';
import { BlockCache } from '../src/mobs/blockCache';
import { createMob, type Mob, type MobContext, pathOptions, stepBrain } from '../src/mobs/brain';
import { MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { findPath } from '../src/mobs/pathfind';
import { meshCulled } from '../src/mesh/culled';
import { type Lod, prepareLod } from '../src/mesh/lod';
import { type ChunkMesh, meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { decodeRle, encodeRle } from '../src/save/rle';
import { Block, BLOCKS, delay, inverter } from '../src/world/blocks';
import { chunkKey, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../src/world/coords';
import { DARK, FULL_SUN, lightColumn } from '../src/world/light';
import { ALL_CONNECTED, reachableChunks } from '../src/world/visibility';
import { createBody, NO_INPUT, stepPlayer } from '../src/world/physics';
import { wakeColumn, WaterFlow } from '../src/world/water';
import { LogicFlow } from '../src/world/logic';
import { GroundItems } from '../src/survival/ground';
import { CHEST_SLOTS, Chests } from '../src/survival/chest';
import { FUEL, Furnaces, INPUT } from '../src/survival/furnace';
import { ALL_ITEMS, Item } from '../src/survival/items';
import { furnace, furnaceOf } from '../src/world/blocks';
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
  // A logic tick's light: 15 signal lamps two blocks apart along the surface, lit and then put
  // out at once in one `setBlocks` (as a chaser does, in shade so their light shows).
  const lamps = Array.from({ length: 15 }, (_, i) => [i * 2, g.height(i * 2, 40) + 1, 40] as const);
  const set = (b: Block) => world.setBlocks(lamps.map(([x, y, z]) => [x, y, z, b] as const));
  set(Block.SignalLamp);
  const on: number[] = [];
  const off: number[] = [];
  for (let run = 0; run <= RUNS; run++) {
    set(Block.SignalLampOn);
    const a = world.lightMs;
    set(Block.SignalLamp);
    if (run === 0) continue;
    on.push(a);
    off.push(world.lightMs);
  }
  lines.push(`  ${'15 signal lamps at once, setBlocks'.padEnd(34)} on: light ${median(on).toFixed(2)} ms, off: light ${median(off).toFixed(2)} ms`);
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

it('mob paths', () => {
  // Searches between random places on the surface 4–16 blocks apart, over the spawn's plains and
  // forest and over the mountains (seed 20261022 around (-368, 400)), as a mossback (1 high,
  // steps of 1, drops of 3) and a crag goat (steps of 2, drops of 5) would ask for them.
  const world = new World(SEED);
  const rng = createRng(5);
  const lines = [''];
  for (const [label, ox, oz] of [['spawn', 0, 0], ['mountains', -368, 400]] as const) {
    const ccx = toChunk(ox);
    const ccz = toChunk(oz);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) world.ensureColumn(ccx + dx, ccz + dz);
    // Where feet stand on dry ground at (x, z), or null over water.
    const surface = (x: number, z: number): number | null => {
      let y = 255;
      while (y > 0 && BLOCKS[world.getBlock(x, y - 1, z)].passable && !BLOCKS[world.getBlock(x, y - 1, z)].liquid) y--;
      return BLOCKS[world.getBlock(x, y - 1, z)].liquid ? null : y;
    };
    for (const [kind, opts] of [['mossback', { step: 1, drop: 3 }], ['mossback, 500 places', { step: 1, drop: 3, maxNodes: 500 }], ['crag goat', { step: 2, drop: 5 }]] as const) {
      const times: number[] = [];
      const nodes: number[] = [];
      let found = 0;
      const N = 300;
      for (let i = 0; i < N; ) {
        const x = ox + Math.floor((rng() - 0.5) * 40);
        const z = oz + Math.floor((rng() - 0.5) * 40);
        const a = 2 * Math.PI * rng();
        const r = 4 + 12 * rng();
        const gx = Math.round(x + Math.cos(a) * r);
        const gz = Math.round(z + Math.sin(a) * r);
        const sy = surface(x, z);
        const gy = surface(gx, gz);
        if (sy === null || gy === null) continue;
        i++;
        const t0 = performance.now();
        const search = findPath(new BlockCache(world), [x, sy, z], [gx, gy, gz], { ...opts, swim: true });
        times.push(performance.now() - t0);
        nodes.push(search.expanded);
        if (search.path) found++;
      }
      lines.push(
        `mob paths (${label}, ${kind}): ${N} searches, ${Math.round((found / N) * 100)}% found; ms median ${median(times).toFixed(3)}, p95 ${percentile(times, 0.95).toFixed(3)}, max ${Math.max(...times).toFixed(3)}; places looked at median ${median(nodes)}, max ${Math.max(...nodes)}`,
      );
    }
  }
  console.log(lines.join('\n') + '\n');
});

it('mobs', () => {
  // 24 mobs (mossbacks and hoppers) on the land round the spawn, thinking, finding paths and
  // moving for 60 s, read through a fresh BlockCache each 60 fps frame as the game does: the
  // main thread's time a frame for all of them.
  const world = new World(SEED);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) world.ensureColumn(dx, dz);
  const rng = createRng(9);
  const mobs: Mob[] = [];
  while (mobs.length < 24) {
    const x = Math.floor((rng() - 0.5) * 60);
    const z = Math.floor((rng() - 0.5) * 60);
    let y = 255;
    while (y > 0 && BLOCKS[world.getBlock(x, y - 1, z)].passable && !BLOCKS[world.getBlock(x, y - 1, z)].liquid) y--;
    if (BLOCKS[world.getBlock(x, y - 1, z)].liquid) continue;
    mobs.push(createMob(mobs.length, mobs.length % 2 ? MobKind.Hopper : MobKind.Mossback, x + 0.5, y, z + 0.5, mobs.length + 1));
  }
  const frame = 1 / 60;
  const steps = Math.round(frame / TUNING.mobs.step);
  const times: number[] = [];
  let searches = 0;
  for (let f = 0; f < 60 * 60; f++) {
    const t0 = performance.now();
    const blocks = new BlockCache(world);
    const ctx: MobContext = {
      blocks,
      daylight: 1,
      findPath: (mob, start, goal, near) => {
        searches++;
        return findPath(blocks, start, goal, pathOptions(mob.kind, near)).path;
      },
    };
    for (const mob of mobs) for (let s = 0; s < steps; s++) stepBrain(mob, ctx);
    times.push(performance.now() - t0);
  }
  const walked = mobs.reduce((s, m) => s + m.walked, 0);
  console.log(
    `\nmobs: 24 for 60 s (${steps} steps a 60 fps frame): ms a frame median ${median(times).toFixed(3)}, p95 ${percentile(times, 0.95).toFixed(3)}, max ${Math.max(...times).toFixed(3)}; ` +
      `${searches} path searches, ${Math.round(walked)} blocks walked\n`,
  );
});

it('water', () => {
  // Flowing water (world/water.ts) on generated land round the spawn, ticked until it settles: a
  // source put on open ground, the sea let into a cave down a shaft from the seabed, and the
  // worst case, the seabed over a 32 × 32 room opened at once. Per tick: the simulation's time,
  // then its changes made, either one at a time with World.setBlock (a light update each) or
  // all at once with World.setBlocks (one light update), each on a fresh world.
  const lines = [''];
  {
    // What loading a column costs the water: a look along the faces of the columns beside it
    // (`wakeColumn`), on generated land with no moving water, as while flying.
    const world = new World(SEED);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) world.ensureColumn(dx, dz);
    const flow = new WaterFlow();
    const times: number[] = [];
    for (let run = 0; run < 5; run++)
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const t0 = performance.now();
          wakeColumn(flow, world, dx, dz, false);
          times.push(performance.now() - t0);
        }
    lines.push(`water: waking on a column's load ${median(times).toFixed(3)} ms median, ${Math.max(...times).toFixed(3)} max (${flow.pending} woken)`);
  }
  for (const batched of [false, true]) {
    const world = new World(SEED);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) world.ensureColumn(dx, dz);
    const top = (x: number, z: number) => {
      let y = 255;
      while (y > 0 && world.getBlock(x, y, z) === Block.Air) y--;
      return y;
    };
    const near = (test: (x: number, z: number) => boolean): [number, number] | null => {
      for (let r = 0; r < 90; r++)
        for (let z = -r; z <= r; z++)
          for (let x = -r; x <= r; x++) if (Math.max(Math.abs(x), Math.abs(z)) === r && test(x, z)) return [x, z];
      return null;
    };
    const bedAt = (x: number, z: number) => {
      let y = 62;
      while (y > 0 && world.getBlock(x, y, z) === Block.Water) y--;
      return y;
    };
    /** Under the sea at (x, z): the seabed's top and the first air below it within 30 blocks. */
    const caveUnder = (x: number, z: number): [number, number] | null => {
      if (world.getBlock(x, 62, z) !== Block.Water) return null;
      const y = bedAt(x, z);
      for (let d = y - 1; d > Math.max(1, y - 30); d--) if (world.getBlock(x, d, z) === Block.Air) return [y, d];
      return null;
    };
    const run = (label: string, begin: (flow: WaterFlow) => void) => {
      const flow = new WaterFlow();
      begin(flow);
      const sim: number[] = [];
      const apply: number[] = [];
      const light: number[] = [];
      let changed = 0;
      let most = 0;
      let stale = 0;
      let ticks = 0;
      for (; ticks < 400 && flow.pending; ticks++) {
        const t0 = performance.now();
        const changes = flow.tick(world);
        const t1 = performance.now();
        const chunks = new Set<unknown>();
        let lightMs = 0;
        if (batched) {
          for (const c of world.setBlocks(changes)) chunks.add(c);
          lightMs = changes.length ? world.lightMs : 0;
        } else
          for (const [x, y, z, b] of changes) {
            for (const c of world.setBlock(x, y, z, b)) chunks.add(c);
            lightMs += world.lightMs;
          }
        sim.push(t1 - t0);
        apply.push(performance.now() - t1);
        light.push(lightMs);
        changed += changes.length;
        most = Math.max(most, changes.length);
        stale = Math.max(stale, chunks.size);
      }
      lines.push(
        `water (${label}, ${batched ? 'setBlocks' : 'setBlock each'}): ${ticks} ticks${flow.pending ? ` (still going: ${flow.pending} woken)` : ' to settle'}, ${changed} changes, at most ${most} a tick and ${stale} chunks stale; ` +
          `ms a tick: simulation median ${median(sim).toFixed(3)}, max ${Math.max(...sim).toFixed(3)}; making the changes median ${median(apply).toFixed(2)}, max ${Math.max(...apply).toFixed(2)} (light max ${Math.max(...light).toFixed(2)})`,
      );
    };
    const grass = near((x, z) => world.getBlock(x, top(x, z), z) === Block.Grass);
    if (grass) {
      const [x, z] = grass;
      run(`a source on grass at ${x}, ${z}`, (flow) => {
        world.setBlock(x, top(x, z) + 1, z, Block.Water);
        flow.wake(x, top(x, z), z);
      });
    }
    const shaft = near((x, z) => caveUnder(x, z) !== null);
    if (shaft) {
      const [x, z] = shaft;
      const [bed, cave] = caveUnder(x, z)!;
      run(`the sea into a cave at ${x}, ${z}, a shaft from ${bed} to ${cave}`, (flow) => {
        for (let y = bed; y > cave; y--) {
          world.setBlock(x, y, z, Block.Air);
          flow.wake(x, y, z);
        }
      });
    } else lines.push('water: no cave under the sea near the spawn');
    // The worst case: a room 32 × 32 and 6 high carved under the seabed, then the 2 blocks of
    // ceiling between it and the sea taken away at once (a thousand columns pouring in).
    const sea = near((x, z) => {
      if (x + 32 > 127 || z + 32 > 127) return false;
      for (let dz = 0; dz < 32; dz += 4) for (let dx = 0; dx < 32; dx += 4) if (world.getBlock(x + dx, 62, z + dz) !== Block.Water || top(x + dx, z + dz) !== 62) return false;
      return bedAt(x, z) > 30;
    });
    if (sea) {
      const [sx, sz] = sea;
      let floor = 62;
      for (let dz = 0; dz < 32; dz++) for (let dx = 0; dx < 32; dx++) floor = Math.min(floor, bedAt(sx + dx, sz + dz));
      const roof = floor - 2;
      for (let dz = 0; dz < 32; dz++) for (let dx = 0; dx < 32; dx++) for (let y = roof - 6; y < roof; y++) world.setBlock(sx + dx, y, sz + dz, Block.Air);
      run(`a 32 × 32 room under the sea at ${sx}, ${sz} opened at once`, (flow) => {
        for (let dz = 0; dz < 32; dz++)
          for (let dx = 0; dx < 32; dx++)
            for (let y = bedAt(sx + dx, sz + dz); y >= roof; y--) {
              world.setBlock(sx + dx, y, sz + dz, Block.Air);
              flow.wake(sx + dx, y, sz + dz);
            }
      });
    } else lines.push('water: no open sea 32 × 32 near the spawn');
  }
  console.log(lines.join('\n') + '\n');
});

it('logic', () => {
  // Logic blocks' ticks (world/logic.ts) on a board in memory, the changes made each tick: a
  // 32 x 32 grid of wire fed by a switch flipped every 10 ticks, and a chaser of 50 stages (a delay
  // passing the pulse on to a wire with a lamp beside it, then the next delay) driven by a clock
  // (an inverter feeding itself through a delay of 4), each for 600 ticks (a minute).
  const run = (label: string, build: (put: (x: number, z: number, b: Block) => void) => void, each?: (t: number, put: (x: number, z: number, b: Block) => void) => void) => {
    const blocks = new Map<string, Block>();
    const board = {
      getBlock: (x: number, y: number, z: number) => (y === 0 ? Block.Stone : (blocks.get(`${x},${y},${z}`) ?? Block.Air)),
      hasColumn: () => true,
    };
    const flow = new LogicFlow();
    const put = (x: number, z: number, b: Block) => {
      blocks.set(`${x},1,${z}`, b);
      flow.wake(x, 1, z);
    };
    build(put);
    const times: number[] = [];
    let changes = 0;
    let most = 0;
    let wires = 0;
    for (let t = 0; t < 600; t++) {
      each?.(t, put);
      const t0 = performance.now();
      const out = flow.tick(board);
      times.push(performance.now() - t0);
      for (const [x, y, z, b] of out) blocks.set(`${x},${y},${z}`, b);
      changes += out.length;
      most = Math.max(most, out.length);
      wires = Math.max(wires, flow.wires);
    }
    return `logic (${label}): 600 ticks, ${changes} changes, at most ${most} a tick and ${wires} wires worked out; ms a tick median ${median(times).toFixed(3)}, p95 ${percentile(times, 0.95).toFixed(3)}, max ${Math.max(...times).toFixed(3)} (the first, everything just placed, ${times[0].toFixed(3)}; after it ${Math.max(...times.slice(1)).toFixed(3)})`;
  };
  const lines = [''];
  lines.push(
    run(
      'a 32 x 32 wire grid, switched every 10 ticks',
      (put) => {
        put(-1, 0, Block.Switch);
        for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) put(x, z, Block.Wire);
      },
      (t, put) => {
        if (t % 10 === 0) put(-1, 0, (t / 10) % 2 ? Block.Switch : Block.SwitchOn);
      },
    ),
  );
  lines.push(
    run('a 50-stage chaser on a clock', (put) => {
      // The clock (10 ticks round): an inverter facing +x at (0, 0) feeds the wire (1, 0), (1, -1),
      // (0, -1); a delay of 4 at (-1, -1) facing -x reads that and feeds the wire (-2, -1), (-2, 0),
      // (-1, 0), which is behind the inverter.
      put(0, 0, inverter(0, false));
      for (const [x, z] of [[1, 0], [1, -1], [0, -1], [-2, -1], [-2, 0], [-1, 0]]) put(x, z, Block.Wire);
      put(-1, -1, delay(1, 4, false));
      // The chaser: from the clock's wire, delay, wire (a lamp beside it), delay, ... along +x.
      for (let i = 0; i < 50; i++) {
        put(2 + i * 2, 0, delay(0, 1, false));
        put(3 + i * 2, 0, Block.Wire);
        put(3 + i * 2, 1, Block.SignalLamp);
      }
    }),
  );
  console.log(lines.join('\n') + '\n');
});

it('ground items', () => {
  // Items on the ground (survival/ground.ts) as the game steps them, a frame at a time against the
  // World as the game passes it: the cap of 256 dropped 5 blocks over 32 x 32 blocks, a player
  // standing among them taking nothing (a full inventory), for 10 s. The first second is falling
  // and settling; after it those on land lie asleep, and those in water float, awake. Twice: on land
  // round the spawn, and over the sea at the origin.
  const world = new World(SEED);
  const g = world.generator;
  const spawn = g.findLand(0, 0);
  const lines = [''];
  for (const [label, ox, oz] of [
    ['on land round the spawn', spawn.x, spawn.z],
    ['over the sea at the origin', 0, 0],
  ] as const) {
    for (let cz = toChunk(oz) - 2; cz <= toChunk(oz) + 2; cz++) for (let cx = toChunk(ox) - 2; cx <= toChunk(ox) + 2; cx++) world.ensureColumn(cx, cz);
    const ground = new GroundItems();
    const rng = createRng(5);
    const items = [Block.Dirt, Block.Stone, Block.Sand, Block.Planks, Block.Torch];
    for (let i = 0; i < TUNING.survival.ground.cap; i++) {
      const x = ox + Math.floor(rng() * 32) - 16;
      const z = oz + Math.floor(rng() * 32) - 16;
      ground.drop(x + 0.5, g.height(x, z) + 6, z + 0.5, { item: items[i % items.length], count: 1 }, rng() - 0.5, 2, rng() - 0.5);
    }
    const player = { x: ox + 0.5, y: g.height(ox, oz) + 1, z: oz + 0.5 };
    const loaded = (x: number, z: number) => world.hasColumn(toChunk(Math.floor(x)), toChunk(Math.floor(z)));
    const falling: number[] = [];
    const resting: number[] = [];
    for (let f = 0; f < 600; f++) {
      const t0 = performance.now();
      ground.update(1 / 60, world, loaded, [player], (it) => it.count);
      (f < 60 ? falling : resting).push(performance.now() - t0);
    }
    const asleep = ground.items.filter((it) => it.asleep).length;
    const floating = ground.items.filter((it) => it.body.inWater).length;
    lines.push(
      `ground items ${label}: ${ground.items.length} lying (${asleep} asleep, ${floating} floating, after 10 s); ms a frame falling (the first second) median ${median(falling).toFixed(3)}, max ${Math.max(...falling).toFixed(3)}; after it median ${median(resting).toFixed(3)}, p95 ${percentile(resting, 0.95).toFixed(3)}, max ${Math.max(...resting).toFixed(3)}`,
    );
  }
  console.log(lines.join('\n') + '\n');
});

it('furnaces', () => {
  // 50 furnaces burning, stepped a frame at a time as the game's tickFurnaces does: the block
  // looked up in the World, the furnace stepped, its block lit or put out when that changes.
  const world = new World(SEED);
  world.ensureColumn(0, 0);
  const all = new Furnaces();
  for (let i = 0; i < 50; i++) {
    const x = i % 10;
    const z = Math.floor(i / 10);
    world.setBlock(x, 120, z, furnace(0, false));
    const f = all.at(x, 120, z);
    f.slots.slots[INPUT] = { item: Item.RawIron, count: 64 };
    f.slots.slots[FUEL] = { item: Item.Coal, count: 8 };
  }
  const times: number[] = [];
  let changes = 0;
  for (let frame = 0; frame < 600; frame++) {
    const t0 = performance.now();
    for (const [x, y, z, f] of all.entries()) {
      const b = furnaceOf(world.getBlock(x, y, z));
      if (!b) continue;
      f.step(1 / 60);
      if (b.lit !== f.lit) {
        world.setBlock(x, y, z, furnace(b.facing, f.lit));
        changes++;
      }
    }
    times.push(performance.now() - t0);
  }
  console.log(
    `\nfurnaces: 50 burning for 10 s, ${changes} blocks lit or put out (the light updates with them); ms a frame median ${median(times).toFixed(3)}, p95 ${percentile(times, 0.95).toFixed(3)}, max ${Math.max(...times).toFixed(3)} (the first, lighting all 50: ${times[0].toFixed(3)})\n`,
  );
});

it('gloamers', () => {
  // The mob manager with gloamers hunting a player standing still at night on the land round the
  // spawn, as the game steps it a frame at a time: animals off, gloamers appearing in the dark up to
  // their cap of 4 and coming for the player (paths, hits). Then 10 s of it.
  const world = new World(SEED);
  const spawn = world.generator.findLand(0, 0);
  for (let cz = toChunk(spawn.z) - 3; cz <= toChunk(spawn.z) + 3; cz++) for (let cx = toChunk(spawn.x) - 3; cx <= toChunk(spawn.x) + 3; cx++) world.ensureColumn(cx, cz);
  const player = { x: spawn.x + 0.5, y: world.generator.height(spawn.x, spawn.z) + 1, z: spawn.z + 0.5 };
  const m = new MobManager(world, 9, 0);
  // Gather them first (a few seconds of tries), then time.
  for (let f = 0; f < 600 && m.mobs.length < 4; f++) m.update(1 / 60, [[player.x, player.z]], 0, [player]);
  const times: number[] = [];
  let hits = 0;
  let hunting = 0;
  for (let f = 0; f < 600; f++) {
    m.update(1 / 60, [[player.x, player.z]], 0, [player]);
    times.push(m.ms);
    hits += m.takeAttacks().length;
    hunting = Math.max(hunting, m.mobs.filter((g) => g.state === 'hunt').length);
  }
  console.log(
    `\ngloamers: ${m.mobs.length} round a player at night (${hunting} hunting at most), 10 s: ${hits} hits on the player, ${m.searches} path searches (${m.deferred} put off); ms a frame median ${median(times).toFixed(3)}, p95 ${percentile(times, 0.95).toFixed(3)}, max ${Math.max(...times).toFixed(3)}\n`,
  );
});

it('gloamers at noon', () => {
  // The same player at noon: gloamers appear only in caves, where the sun doesn't reach, and those
  // within sight hunt a player they mostly can't get to. Gathered for up to a minute, then 10 s.
  const world = new World(SEED);
  const spawn = world.generator.findLand(0, 0);
  for (let cz = toChunk(spawn.z) - 3; cz <= toChunk(spawn.z) + 3; cz++) for (let cx = toChunk(spawn.x) - 3; cx <= toChunk(spawn.x) + 3; cx++) world.ensureColumn(cx, cz);
  const player = { x: spawn.x + 0.5, y: world.generator.height(spawn.x, spawn.z) + 1, z: spawn.z + 0.5 };
  const m = new MobManager(world, 9, 0);
  for (let f = 0; f < 3600 && m.mobs.length < 3; f++) m.update(1 / 60, [[player.x, player.z]], 1, [player]);
  const times: number[] = [];
  let hits = 0;
  let hunting = 0;
  const searches = m.searches;
  for (let f = 0; f < 600; f++) {
    m.update(1 / 60, [[player.x, player.z]], 1, [player]);
    times.push(m.ms);
    hits += m.takeAttacks().length;
    hunting = Math.max(hunting, m.mobs.filter((g) => g.state === 'hunt').length);
  }
  console.log(
    `\ngloamers at noon: ${m.mobs.length} in caves round a player (${hunting} hunting at most), 10 s: ${hits} hits on the player, ${m.searches - searches} path searches; ms a frame median ${median(times).toFixed(3)}, p95 ${percentile(times, 0.95).toFixed(3)}, max ${Math.max(...times).toFixed(3)}, over 2 ms ${times.filter((t) => t > 2).length} frames\n`,
  );
});

it('chests', () => {
  // A record's chests as saving writes them every 10 s: 100 chests, every slot full (27 stacks
  // each, every kind of item round), made into JSON and read back.
  const chests = new Chests();
  for (let c = 0; c < 100; c++) {
    const inv = chests.at(c, 64, 0);
    for (let i = 0; i < CHEST_SLOTS; i++) inv.slots[i] = { item: ALL_ITEMS[(c * CHEST_SLOTS + i) % ALL_ITEMS.length], count: 1 };
  }
  const out: number[] = [];
  const back: number[] = [];
  let bytes = 0;
  for (let run = 0; run <= RUNS; run++) {
    const t0 = performance.now();
    const json = JSON.stringify(chests.toJSON());
    const t1 = performance.now();
    Chests.from(JSON.parse(json));
    const t2 = performance.now();
    bytes = json.length;
    if (run > 0) {
      out.push(t1 - t0);
      back.push(t2 - t1);
    }
  }
  console.log(`\nchests: 100 full (2700 stacks), ${(bytes / 1024).toFixed(1)} KB of JSON; saving ${median(out).toFixed(3)} ms, loading ${median(back).toFixed(3)} ms\n`);
});
