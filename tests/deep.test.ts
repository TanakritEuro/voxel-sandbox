import { describe, expect, it } from 'vitest';
import { dropsOf } from '../src/survival/drops';
import { Item } from '../src/survival/items';
import { Block, BLOCKS, torchSupport } from '../src/world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { DEEP_TOP, DeepBiome, LAVA_LEVEL } from '../src/world/deep';
import { findNearest } from '../src/world/find';
import { Generator } from '../src/world/generate';

const SEED = 20261022;
const g3 = new Generator(SEED, { generation: 3 });
const g2 = new Generator(SEED, { generation: 2 });

/** Every block of column (cx, cz) by version 3, with its place. */
function* blocksOf(chunks: (Uint8Array | null)[], cx: number, cz: number): IterableIterator<[number, number, number, number]> {
  for (let n = 0; n < chunks.length; n++) {
    const c = chunks[n];
    if (!c) continue;
    const y0 = (MIN_CHUNK_Y + n) * CHUNK_SIZE;
    for (let i = 0; i < c.length; i++) yield [cx * CHUNK_SIZE + (i & 31), y0 + (i >> 10), cz * CHUNK_SIZE + ((i >> 5) & 31), c[i]];
  }
}

describe('deep caves (generation version 3)', () => {
  // 7 x 7 columns round the origin, by both versions.
  const columns: [number, number][] = [];
  for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) columns.push([cx, cz]);
  const v3 = new Map(columns.map(([cx, cz]) => [`${cx},${cz}`, g3.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y)]));

  it('open wider caverns and grow crystal clusters, grotto floors and giant mushrooms in them, all below y 40, changing nothing above it; lava lakes at y 10 and below', () => {
    const counts = new Map<number, number>();
    let highest = 0;
    let highestLava = 0;
    let differ = 0;
    // Dungeons' rooms are theirs (dungeons.test.ts).
    const dungeons = g3.dungeonsIn(-96, -96, 127, 127);
    const inDungeon = (x: number, y: number, z: number) => dungeons.some((d) => Math.abs(x - d.x) <= d.half && Math.abs(z - d.z) <= d.half && y >= d.y && y <= d.y + 4);
    for (const [cx, cz] of columns) {
      const a = v3.get(`${cx},${cz}`)!;
      const b = g2.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y);
      const old = [...blocksOf(b, cx, cz)];
      let k = 0;
      for (const [x, y, z, block] of blocksOf(a, cx, cz)) {
        const was = old[k++][3];
        if (block === was || inDungeon(x, y, z)) continue;
        differ++;
        highest = Math.max(highest, y);
        if (block === Block.Lava) {
          highestLava = Math.max(highestLava, y);
          // Only where version 2 had cave, or version 3 opened it.
          expect([Block.Air, Block.Stone, Block.Dirt, Block.Gravel, Block.CoalOre, Block.CopperOre, Block.IronOre, Block.CrystalOre]).toContain(was);
        }
        counts.set(block, (counts.get(block) ?? 0) + 1);
      }
    }
    expect(differ).toBeGreaterThan(0);
    expect(highest).toBeLessThan(DEEP_TOP);
    for (const b of [Block.CrystalCluster, Block.GrottoFloor, Block.MushroomStem, Block.MushroomCap, Block.CrystalOre, Block.Lava]) expect(counts.get(b) ?? 0, BLOCKS[b].name).toBeGreaterThan(0);
    expect(highestLava).toBe(LAVA_LEVEL);
    // Nothing else is new but air: deep biomes open their caves into wider caverns.
    expect(counts.get(Block.Air) ?? 0).toBeGreaterThan(0);
    for (const b of counts.keys()) expect([Block.Air, Block.CrystalCluster, Block.GrottoFloor, Block.MushroomStem, Block.MushroomCap, Block.CrystalOre, Block.Lava]).toContain(b);
  });

  it('put each in its own biome: clusters in crystal caverns on stone, grotto floors and mushrooms in grottoes', () => {
    for (const [cx, cz] of columns.slice(0, 20)) {
      const chunks = v3.get(`${cx},${cz}`)!;
      for (const [x, y, z, b] of blocksOf(chunks, cx, cz)) {
        if (b === Block.CrystalCluster) expect(g3.deep.biomeAt(x, y, z)).toBe(DeepBiome.Crystal);
        if (b === Block.GrottoFloor) expect(g3.deep.biomeAt(x, y, z)).toBe(DeepBiome.Grotto);
      }
    }
    expect(g3.deep.biomeAt(0, DEEP_TOP, 0)).toBe(DeepBiome.None);
    expect(g3.deep.biomeAt(0, 5, 0)).toBe(DeepBiome.None);
  });

  it("write a giant mushroom's cap whole across chunk borders", () => {
    const carved = (x: number, y: number, z: number) => g3.caves.carvedAt(x, y, z, g3.caveLimitAt(x, z));
    const all = g3.deep.mushroomsIn(-80, -80, 79, 79, (x, z, y0, y1) => g3.caves.carvedColumn(x, z, g3.caveLimitAt(x, z), y0, y1));
    // One whose cap reaches into the next column over.
    const m = all.find((s) => {
      const lx = ((s.x % 32) + 32) % 32;
      return lx < s.radius || lx >= 32 - s.radius;
    })!;
    expect(m).toBeDefined();
    const block = (x: number, y: number, z: number) => {
      const cx = Math.floor(x / 32);
      const cz = Math.floor(z / 32);
      const chunks = v3.get(`${cx},${cz}`) ?? g3.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y);
      const c = chunks[Math.floor(y / 32) - MIN_CHUNK_Y]!;
      return c[((y & 31) << 10) | ((z & 31) << 5) | (x & 31)];
    };
    const top = m.y + m.height;
    for (let k = 0; k < m.height; k++) expect(block(m.x, m.y + k, m.z)).toBe(Block.MushroomStem);
    // Every place of the cap that's cave holds cap, on both sides of the border.
    let checked = 0;
    for (let dz = -m.radius; dz <= m.radius; dz++)
      for (let dx = -m.radius; dx <= m.radius; dx++) {
        if (dx * dx + dz * dz > m.radius * m.radius + 1 || !carved(m.x + dx, top, m.z + dz)) continue;
        expect(block(m.x + dx, top, m.z + dz)).toBe(Block.MushroomCap);
        checked++;
      }
    expect(checked).toBeGreaterThan(5);
  });

  it("give a whole column's cave at once exactly as block by block", () => {
    let carved = 0;
    for (let x = -40; x < 40; x += 3)
      for (let z = -40; z < 40; z += 5) {
        const limit = g3.caveLimitAt(x, z);
        const column = g3.caves.carvedColumn(x, z, limit, 0, 80);
        for (let y = 0; y <= 80; y++) {
          expect(column[y] === 1, `${x},${y},${z}`).toBe(g3.caves.carvedAt(x, y, z, limit));
          carved += column[y];
        }
      }
    expect(carved).toBeGreaterThan(100);
  });

  it('are blocks of their own: clusters glowing crossed sheets that give a crystal, caps glowing', () => {
    const cluster = BLOCKS[Block.CrystalCluster];
    expect([cluster.shape, cluster.passable, cluster.light]).toEqual(['cross', true, 12]);
    expect(torchSupport(Block.CrystalCluster)).toEqual([0, -1, 0]);
    expect(dropsOf(Block.CrystalCluster, undefined, 0)).toEqual([[Item.Crystal, 1]]);
    expect(BLOCKS[Block.MushroomCap].light).toBe(12);
    expect(dropsOf(Block.MushroomStem, undefined, 0)).toEqual([[Block.MushroomStem, 1]]);
  });

  it('are found by ?find=crystal and ?find=grotto: a cave floor to stand on in them', () => {
    for (const [kind, biome] of [
      ['crystal', DeepBiome.Crystal],
      ['grotto', DeepBiome.Grotto],
    ] as const) {
      const at = findNearest(g3, kind, 0, 0)!;
      expect(at.y).toBeDefined();
      expect(g3.deep.biomeAt(at.x, at.y!, at.z)).toBe(biome);
      const limit = g3.caveLimitAt(at.x, at.z);
      expect([g3.caves.carvedAt(at.x, at.y!, at.z, limit), g3.caves.carvedAt(at.x, at.y! + 1, at.z, limit), g3.caves.carvedAt(at.x, at.y! - 1, at.z, limit)]).toEqual([true, true, false]);
    }
    // Not in older worlds.
    expect(findNearest(g2, 'crystal', 0, 0)).toBe(null);
  });
});
