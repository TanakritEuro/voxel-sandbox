import { describe, expect, it } from 'vitest';
import { Block, BLOCKS } from '../src/world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y, WORLD_HEIGHT } from '../src/world/coords';
import { ORES, placeOres } from '../src/world/features';
import { caveLimit, SEA_LEVEL } from '../src/world/generate';
import { World } from '../src/world/world';

const SEED = 20261022;
const S = CHUNK_SIZE;
const CAVES_ONLY = { caves: true, ores: false };
const NONE = { caves: false, ores: false };

/** Worlds of the columns cx, cz in [-r, r], with and without a generation pass. */
function pair(r: number, withOptions: { caves: boolean; ores: boolean }, without: { caves: boolean; ores: boolean }) {
  const a = new World(SEED, withOptions);
  const b = new World(SEED, without);
  for (let cz = -r; cz <= r; cz++)
    for (let cx = -r; cx <= r; cx++) {
      a.ensureColumn(cx, cz);
      b.ensureColumn(cx, cz);
    }
  return { a, b };
}

const solid = (b: Block) => b !== Block.Air && b !== Block.Water;

describe('caves', () => {
  const { a: caved, b: plain } = pair(2, CAVES_ONLY, NONE);
  const g = caved.generator;
  /** Every block of the columns in [-r, r] (chunk columns), x, z in world blocks. */
  function* blocks(r: number): Iterable<[number, number, number]> {
    for (let z = -r * S; z < (r + 1) * S; z++) for (let x = -r * S; x < (r + 1) * S; x++) for (let y = 0; y < WORLD_HEIGHT; y++) yield [x, y, z];
  }

  it('only turn solid blocks into air, exactly where carvedAt says, never in the bottom layers', () => {
    let carved = 0;
    for (let z = -S; z < 2 * S; z += 3)
      for (let x = -S; x < 2 * S; x += 3) {
        const h = g.height(x, z);
        const limit = caveLimit(h, Math.min(h, g.height(x + 1, z), g.height(x - 1, z), g.height(x, z + 1), g.height(x, z - 1)));
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const before = plain.getBlock(x, y, z);
          const after = caved.getBlock(x, y, z);
          if (after !== before) {
            expect(after).toBe(Block.Air);
            expect(solid(before)).toBe(true);
            expect(y).toBeGreaterThanOrEqual(4);
            carved++;
          }
          if (solid(before)) expect(after === Block.Air, `${x} ${y} ${z}`).toBe(g.caves.carvedAt(x, y, z, limit));
        }
      }
    expect(carved).toBeGreaterThan(100);
  });

  it('open a few percent of the underground', () => {
    let open = 0;
    let all = 0;
    for (const [x, y, z] of blocks(1)) {
      if (y < 4 || y > g.height(x, z) - 8) continue;
      all++;
      if (caved.getBlock(x, y, z) === Block.Air) open++;
    }
    expect(open / all).toBeGreaterThan(0.02);
    expect(open / all).toBeLessThan(0.15);
  });

  it('never leave air beside or under water', () => {
    let water = 0;
    for (let z = -2 * S + 1; z < 3 * S - 1; z++)
      for (let x = -2 * S + 1; x < 3 * S - 1; x++)
        for (let y = 0; y <= SEA_LEVEL; y++) {
          if (caved.getBlock(x, y, z) !== Block.Water) continue;
          water++;
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
            expect(caved.getBlock(x + dx, y + dy, z + dz), `${x + dx} ${y + dy} ${z + dz}`).not.toBe(Block.Air);
          }
        }
    expect(water).toBeGreaterThan(1000);
  });

  it('open onto dry land in places', () => {
    const world = new World(SEED, CAVES_ONLY);
    let entrances = 0;
    for (let cz = -6; cz <= 6; cz++)
      for (let cx = -6; cx <= 6; cx++) {
        world.ensureColumn(cx, cz);
        for (let lz = 0; lz < S; lz += 2)
          for (let lx = 0; lx < S; lx += 2) {
            const x = cx * S + lx;
            const z = cz * S + lz;
            const h = world.generator.height(x, z);
            if (h > SEA_LEVEL + 2 && world.getBlock(x, h, z) === Block.Air) entrances++;
          }
      }
    expect(entrances).toBeGreaterThan(0);
  });
});

describe('ores', () => {
  const { a: ored, b: bare } = pair(2, { caves: true, ores: true }, CAVES_ONLY);
  const oreOf = new Map(ORES.map((o) => [o.block, o]));

  it('only replace stone, each within its depth range, all four found', () => {
    const counts = new Map<Block, number>();
    for (let z = -2 * S; z < 3 * S; z += 1)
      for (let x = -2 * S; x < 3 * S; x += 2)
        for (let y = 0; y < 220; y++) {
          const after = ored.getBlock(x, y, z);
          const before = bare.getBlock(x, y, z);
          if (after === before) continue;
          expect(before, BLOCKS[after].name).toBe(Block.Stone);
          const ore = oreOf.get(after)!;
          expect(ore, BLOCKS[after].name).toBeDefined();
          expect(y).toBeGreaterThanOrEqual(ore.minY);
          expect(y).toBeLessThanOrEqual(ore.maxY);
          counts.set(after, (counts.get(after) ?? 0) + 1);
        }
    for (const o of ORES) expect(counts.get(o.block) ?? 0, BLOCKS[o.block].name).toBeGreaterThan(0);
    // Coal is the most common; crystal the rarest.
    expect(counts.get(Block.CoalOre)!).toBeGreaterThan(counts.get(Block.IronOre)!);
    expect(counts.get(Block.IronOre)!).toBeGreaterThan(counts.get(Block.CrystalOre)!);
  });

  it('cross chunk borders whole: a vein can lie in two chunks, each placing its own part', () => {
    // Two all-stone chunks side by side, low enough for every ore.
    const left = new Uint8Array(S * S * S).fill(Block.Stone);
    const right = new Uint8Array(S * S * S).fill(Block.Stone);
    placeOres(left, 0, 0, 0, SEED);
    placeOres(right, 1, 0, 0, SEED);
    // Ore on both sides of the shared face, touching across it.
    let touching = 0;
    for (let y = 0; y < S; y++)
      for (let z = 0; z < S; z++) {
        const l = left[(y * S + z) * S + (S - 1)];
        const r = right[(y * S + z) * S];
        if (l !== Block.Stone && l === r) touching++;
      }
    expect(touching).toBeGreaterThan(0);
    // And each chunk's result doesn't depend on the other having been generated.
    const again = new Uint8Array(S * S * S).fill(Block.Stone);
    placeOres(again, 1, 0, 0, SEED);
    expect(again).toEqual(right);
  });

  it('come out the same whichever order chunks load in', () => {
    const forward = new World(SEED);
    const backward = new World(SEED);
    const columns: [number, number][] = [];
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) columns.push([cx, cz]);
    for (const [cx, cz] of columns) forward.ensureColumn(cx, cz);
    for (const [cx, cz] of [...columns].reverse()) backward.ensureColumn(cx, cz);
    for (const [cx, cz] of columns)
      for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) expect(forward.getChunk(cx, cy, cz)!.blocks).toEqual(backward.getChunk(cx, cy, cz)!.blocks);
  });
});
