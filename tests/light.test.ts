import { describe, expect, it } from 'vitest';
import { Block, BLOCKS } from '../src/world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, WORLD_HEIGHT } from '../src/world/coords';
import { SEA_LEVEL, SURFACE_ONLY } from '../src/world/generate';
import { DARK, FULL_SUN, SUNLIT } from '../src/world/light';
import { World } from '../src/world/world';

const SEED = 20261022;
const S = CHUNK_SIZE;
const H = WORLD_HEIGHT;

const sun = (world: World, x: number, y: number, z: number) => world.getLight(x, y, z) >> 4;

/**
 * Light of columns cx0..cx1 × cz0..cz1 lit all at once, as if nothing outside them existed
 * (but the sky), worked out independently of `light.ts`: brightest first, one level at a time
 * (Dijkstra with a bucket per level), instead of flood fills that raise blocks again and again.
 * Returns sun << 4 | block light per block, indexed ((y * D) + z) * W + x from the region's corner.
 */
function reference(world: World, cx0: number, cz0: number, cx1: number, cz1: number): Uint8Array {
  const W = (cx1 - cx0 + 1) * S;
  const D = (cz1 - cz0 + 1) * S;
  const N = W * D * H;
  const x0 = cx0 * S;
  const z0 = cz0 * S;
  const blocks = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) blocks[(y * D + z) * W + x] = world.getBlock(x0 + x, y, z0 + z);
  const opaque = (i: number) => BLOCKS[blocks[i]].opaque;
  const clear = (i: number) => !opaque(i) && BLOCKS[blocks[i]].lightCost === 0;

  const channel = (sources: (level: Uint8Array, buckets: number[][]) => void, sunRule: boolean): Uint8Array => {
    const level = new Uint8Array(N);
    const buckets: number[][] = Array.from({ length: 16 }, () => []);
    sources(level, buckets);
    for (let l = 15; l >= 2; l--) {
      const bucket = buckets[l];
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        if (level[i] !== l) continue;
        const x = i % W;
        const z = Math.floor(i / W) % D;
        const y = Math.floor(i / (W * D));
        const neighbours: [number, boolean][] = [];
        if (x > 0) neighbours.push([i - 1, false]);
        if (x < W - 1) neighbours.push([i + 1, false]);
        if (z > 0) neighbours.push([i - W, false]);
        if (z < D - 1) neighbours.push([i + W, false]);
        if (y < H - 1) neighbours.push([i + W * D, false]);
        if (y > 0) neighbours.push([i - W * D, true]);
        for (const [n, down] of neighbours) {
          if (opaque(n)) continue;
          const to = sunRule && down && l === 15 && clear(n) ? 15 : l - 1 - BLOCKS[blocks[n]].lightCost;
          if (to > level[n]) {
            level[n] = to;
            buckets[to].push(n);
          }
        }
      }
    }
    return level;
  };

  const sunlight = channel((level, buckets) => {
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++)
        for (let y = H - 1; y >= 0; y--) {
          const i = (y * D + z) * W + x;
          if (!clear(i)) break;
          level[i] = 15;
          buckets[15].push(i);
        }
  }, true);
  const blockLight = channel((level, buckets) => {
    for (let i = 0; i < N; i++) {
      const e = BLOCKS[blocks[i]].light;
      if (e) {
        level[i] = e;
        buckets[e].push(i);
      }
    }
  }, false);
  return sunlight.map((s, i) => (s << 4) | blockLight[i]);
}

/** The region's light as the world has it, in the layout `reference` uses. */
function lightOf(world: World, cx0: number, cz0: number, cx1: number, cz1: number): Uint8Array {
  const W = (cx1 - cx0 + 1) * S;
  const D = (cz1 - cz0 + 1) * S;
  const out = new Uint8Array(W * D * H);
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) out[(y * D + z) * W + x] = world.getLight(cx0 * S + x, y, cz0 * S + z);
  return out;
}

/** Columns of the region in a given order. */
function load(order: [number, number][]): { world: World; raised: number } {
  const world = new World(SEED);
  let raised = 0;
  for (const [cx, cz] of order) raised += world.addColumn(cx, cz, world.generator.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y));
  return { world, raised };
}

/** Where the first difference is, for a readable failure. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

describe('light', () => {
  it('is full sun in the open air and none inside the ground; shared arrays for chunks all one or the other', () => {
    const world = new World(SEED, SURFACE_ONLY);
    world.ensureColumn(0, 0);
    let land = 0;
    for (let z = 1; z < S - 1; z++)
      for (let x = 1; x < S - 1; x++) {
        const h = world.generator.height(x, z);
        if (h <= SEA_LEVEL) continue;
        land++;
        for (let y = h + 1; y < H; y++) expect(sun(world, x, y, z)).toBe(15);
        expect(world.getLight(x, h, z)).toBe(0);
        expect(world.getLight(x, h - 10, z)).toBe(0);
      }
    expect(land).toBeGreaterThan(0);
    expect(world.getChunk(0, MAX_CHUNK_Y, 0)!.light).toBe(FULL_SUN);
    expect(world.getChunk(0, 0, 0)!.light).toBe(DARK);
    expect(world.getLight(0, H + 5, 0)).toBe(SUNLIT);
    expect(world.getLight(0, -1, 0)).toBe(0);
  });

  it('loses 2 a block going down through water', () => {
    const world = new World(SEED, SURFACE_ONLY);
    // A deep sea column whose neighbours are deep too.
    const g = world.generator;
    let found: [number, number] | null = null;
    for (let z = -400; z <= 400 && !found; z += 7)
      for (let x = -400; x <= 400 && !found; x += 7) {
        let deep = true;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (g.height(x + dx, z + dz) > SEA_LEVEL - 10) deep = false;
        if (deep) found = [x, z];
      }
    expect(found).not.toBeNull();
    const [x, z] = found!;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.ensureColumn(toChunk(x) + dx, toChunk(z) + dz);
    expect(world.getBlock(x, SEA_LEVEL, z)).toBe(Block.Water);
    expect(sun(world, x, SEA_LEVEL + 1, z)).toBe(15);
    for (let d = 0; d < 7; d++) expect(sun(world, x, SEA_LEVEL - d, z)).toBe(13 - 2 * d);
    expect(sun(world, x, SEA_LEVEL - 7, z)).toBe(0);
  });

  // A cave mouth (?at=-48,71) and a forest (?at=-121,-226): openings, overhangs, canopies.
  const REGIONS: [string, number, number][] = [
    ['a cave mouth', toChunk(-48) - 1, toChunk(71) - 1],
    ['a forest', toChunk(-121) - 1, toChunk(-226) - 1],
  ];

  for (const [name, cx0, cz0] of REGIONS) {
    it(`in ${name}: across column borders, equals lighting the whole area at once, in any load order`, () => {
      const cx1 = cx0 + 2;
      const cz1 = cz0 + 1;
      const columns: [number, number][] = [];
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) columns.push([cx, cz]);
      const shuffled = [columns[4], columns[0], columns[5], columns[2], columns[1], columns[3]];
      const orders = [columns, [...columns].reverse(), shuffled];

      const { world, raised } = load(orders[0]);
      const expected = reference(world, cx0, cz0, cx1, cz1);
      // Light that crossed a border (else the test would show nothing).
      expect(raised).toBeGreaterThan(0);
      // Shade: air neither in full sun nor dark.
      let shaded = 0;
      for (let i = 0; i < expected.length; i++) if (expected[i] >> 4 > 0 && expected[i] >> 4 < 15) shaded++;
      expect(shaded).toBeGreaterThan(1000);

      for (const order of orders) {
        const got = lightOf(order === orders[0] ? world : load(order).world, cx0, cz0, cx1, cz1);
        const at = firstDifference(got, expected);
        expect(at, `first difference at index ${at}`).toBe(-1);
      }
    });
  }

  it('glows round crystal ore (block light 6), across borders as well', () => {
    // Find crystal ore near a column border and light the columns around it.
    const world = new World(SEED);
    let ore: [number, number, number] | null = null;
    const nearBorder = (l: number) => l < 2 || l >= S - 2;
    for (let cx = 0; cx < 24 && !ore; cx++) {
      world.ensureColumn(cx, 0);
      for (let y = 5; y < 25 && !ore; y++)
        for (let z = 0; z < S && !ore; z++)
          for (let x = 0; x < S && !ore; x++)
            if ((nearBorder(x) || nearBorder(z)) && world.getBlock(cx * S + x, y, z) === Block.CrystalOre) ore = [cx * S + x, y, z];
    }
    expect(ore).not.toBeNull();
    const [x, y, z] = ore!;
    const cx0 = toChunk(x) - 1;
    const cz0 = toChunk(z) - 1;
    const order: [number, number][] = [];
    for (let cz = cz0; cz <= cz0 + 2; cz++) for (let cx = cx0; cx <= cx0 + 2; cx++) order.push([cx, cz]);
    const { world: lit } = load(order);
    expect(lit.getLight(x, y, z) & 15).toBe(6);
    const expected = reference(lit, cx0, cz0, cx0 + 2, cz0 + 2);
    expect(firstDifference(lightOf(lit, cx0, cz0, cx0 + 2, cz0 + 2), expected)).toBe(-1);
    let glowing = 0;
    for (const l of expected) if (l & 15) glowing++;
    expect(glowing).toBeGreaterThan(6);
  });

  it('copies a shared array before changing it', () => {
    const world = new World(SEED, SURFACE_ONLY);
    world.ensureColumn(0, 0);
    const chunk = world.getChunk(0, MAX_CHUNK_Y, 0)!;
    expect(chunk.light).toBe(FULL_SUN);
    chunk.ownLight()[0] = 0;
    expect(chunk.light).not.toBe(FULL_SUN);
    expect(FULL_SUN.every((l) => l === SUNLIT)).toBe(true);
    expect(world.lightBytes).toBe(
      ([...world.chunks.values()].filter((c) => c.light !== FULL_SUN && c.light !== DARK).length + 2) * S ** 3,
    );
  });
});
