import { describe, expect, it } from 'vitest';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { biomeFogs } from '../src/render/fog';
import { Biome, BIOME_COUNT } from '../src/world/biomes';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, SEA_LEVEL, toChunk } from '../src/world/coords';
import { TreeKind, treesIn } from '../src/world/features';
import { findNearest } from '../src/world/find';
import { columnLayers, Generator } from '../src/world/generate';
import { World } from '../src/world/world';

const SEED = 20261022;
const v1 = new Generator(SEED, { generation: 1 });
const v2 = new Generator(SEED, { generation: 2 });
const S = CHUNK_SIZE;

describe('savanna and swamp (generation 2)', () => {
  it('cover a fair share of the dry land, and none in version 1', () => {
    const counts = new Array(BIOME_COUNT).fill(0);
    let land = 0;
    for (let z = -2048; z < 2048; z += 16)
      for (let x = -2048; x < 2048; x += 16) {
        if (v2.height(x, z) < SEA_LEVEL) continue;
        land++;
        counts[v2.biome(x, z)]++;
        const old = v1.biome(x, z);
        expect(old === Biome.Savanna || old === Biome.Swamp).toBe(false);
      }
    expect(counts[Biome.Savanna] / land).toBeGreaterThan(0.03);
    expect(counts[Biome.Swamp] / land).toBeGreaterThan(0.02);
  });

  it('lay dry grass on the savanna, and mud at the swamp water with grass above it', () => {
    const top = (biome: Biome, height: number) => columnLayers({ height, biome, slope: 0, snowLine: 200 }).at(-1)![2];
    expect(top(Biome.Savanna, SEA_LEVEL + 6)).toBe(Block.DryGrass);
    expect(top(Biome.Savanna, SEA_LEVEL + 1)).toBe(Block.Sand); // a beach, as anywhere
    const under = (biome: Biome, height: number) => columnLayers({ height, biome, slope: 0, snowLine: 200 }).find(([from, to]) => from <= height && height < to)![2];
    expect(under(Biome.Swamp, SEA_LEVEL)).toBe(Block.Mud);
    expect(under(Biome.Swamp, SEA_LEVEL - 6)).toBe(Block.Mud); // pool beds, not gravel
    expect(top(Biome.Swamp, SEA_LEVEL + 1)).toBe(Block.Grass);
    expect(top(Biome.Swamp, SEA_LEVEL + 4)).toBe(Block.Grass);
  });

  it('grow parasol trees on the savanna and swamp oaks in the swamp, each with its crown', () => {
    const ground = v2.ground();
    const found = new Map<TreeKind, number>();
    for (const [biome, kind] of [
      [Biome.Savanna, TreeKind.Parasol],
      [Biome.Swamp, TreeKind.SwampOak],
    ] as const) {
      const at = findNearest(v2, biome === Biome.Savanna ? 'savanna' : 'swamp', 0, 0)!;
      const trees = treesIn(SEED, at.x - 160, at.z - 160, at.x + 160, at.z + 160, ground).filter((t) => t.kind === kind);
      found.set(kind, trees.length);
      for (const t of trees) {
        expect(ground.biome(t.x, t.z)).toBe(biome);
        expect(ground.top(t.x, t.z)).toBe(biome === Biome.Savanna ? Block.DryGrass : Block.Grass);
      }
      // The first one, in the blocks.
      const t = trees[0];
      const world = new World(SEED, { generation: 2 });
      for (let cz = toChunk(t.z) - 1; cz <= toChunk(t.z) + 1; cz++) for (let cx = toChunk(t.x) - 1; cx <= toChunk(t.x) + 1; cx++) world.ensureColumn(cx, cz);
      const top = t.y + t.height - 1;
      if (kind === TreeKind.Parasol) {
        for (let i = 0; i < t.height; i++) expect(world.getBlock(t.x, t.y + i, t.z)).toBe(Block.ParasolWood);
        // The crown is wide and flat, level with the trunk's top: 2 out always, 3 out where a coin keeps
        // it (at least one way); nothing below it but the trunk.
        for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) expect(world.getBlock(t.x + dx, top, t.z + dz)).toBe(Block.ParasolLeaves);
        expect([[3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dz]) => world.getBlock(t.x + dx, top, t.z + dz) === Block.ParasolLeaves)).toBe(true);
        expect(world.getBlock(t.x + 1, top - 2, t.z)).not.toBe(Block.ParasolLeaves);
        expect(world.getBlock(t.x, top + 1, t.z)).toBe(Block.ParasolLeaves);
      } else {
        for (let i = 0; i < t.height; i++) expect(world.getBlock(t.x, t.y + i, t.z)).toBe(Block.Wood);
        // Some leaves hang below the canopy's lowest layer, at its edge.
        let hanging = 0;
        for (const s of trees.slice(0, 10)) {
          const w = new World(SEED, { generation: 2 });
          for (let cz = toChunk(s.z) - 1; cz <= toChunk(s.z) + 1; cz++) for (let cx = toChunk(s.x) - 1; cx <= toChunk(s.x) + 1; cx++) w.ensureColumn(cx, cz);
          const low = s.y + s.height - 3;
          for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === 2 && w.getBlock(s.x + dx, low - 1, s.z + dz) === Block.Leaves) hanging++;
        }
        expect(hanging).toBeGreaterThan(0);
      }
    }
    expect(found.get(TreeKind.Parasol)).toBeGreaterThan(0);
    expect(found.get(TreeKind.SwampOak)).toBeGreaterThan(0);
  });

  it('put reeds on the ground by the water, in the swamp and the savanna, and none in version 1', () => {
    for (const [kind, generation] of [
      ['swamp', 2],
      ['savanna', 2],
    ] as const) {
      const at = findNearest(v2, kind, 0, 0)!;
      const world = new World(SEED, { generation });
      const old = new World(SEED, { generation: 1 });
      let reeds = 0;
      let byWater = 0;
      // Columns 2 round loaded, the reeds of those 1 round looked at (their neighbours all loaded).
      for (let cz = toChunk(at.z) - 2; cz <= toChunk(at.z) + 2; cz++)
        for (let cx = toChunk(at.x) - 2; cx <= toChunk(at.x) + 2; cx++) {
          world.ensureColumn(cx, cz);
          old.ensureColumn(cx, cz);
        }
      for (let cz = toChunk(at.z) - 1; cz <= toChunk(at.z) + 1; cz++)
        for (let cx = toChunk(at.x) - 1; cx <= toChunk(at.x) + 1; cx++) {
          for (let z = cz * S; z < (cz + 1) * S; z++)
            for (let x = cx * S; x < (cx + 1) * S; x++)
              for (let y = SEA_LEVEL - 2; y < SEA_LEVEL + 30; y++) {
                expect(old.getBlock(x, y, z)).not.toBe(Block.Reeds);
                if (world.getBlock(x, y, z) !== Block.Reeds) continue;
                reeds++;
                expect([Block.Mud, Block.Grass, Block.Sand, Block.DryGrass], `under reeds at ${x},${y},${z}`).toContain(world.getBlock(x, y - 1, z));
                if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => world.getBlock(x + dx, SEA_LEVEL, z + dz) === Block.Water)) byWater++;
              }
        }
      expect(reeds, kind).toBeGreaterThan(5);
      // All of the savanna's by the water; the swamp has them away from it too.
      expect(byWater / reeds, kind).toBeGreaterThan(kind === 'savanna' ? 0.99 : 0.25);
    }
  });

  it('have fogs, animals and finds', () => {
    expect(biomeFogs()).toHaveLength(BIOME_COUNT);
    expect(KINDS[MobKind.Hopper].biomes).toContain(Biome.Savanna);
    expect(KINDS[MobKind.Mossback].biomes).toContain(Biome.Swamp);
    for (const kind of ['savanna', 'swamp'] as const) {
      const at = findNearest(v2, kind, 0, 0)!;
      expect(v2.biome(at.x, at.z)).toBe(kind === 'savanna' ? Biome.Savanna : Biome.Swamp);
      expect(v2.height(at.x, at.z)).toBeGreaterThanOrEqual(SEA_LEVEL);
      expect(findNearest(v1, kind, 0, 0, 512)).toBeNull();
    }
  });
});
