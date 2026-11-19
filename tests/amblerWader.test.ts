import { describe, expect, it } from 'vitest';
import { pathOptions } from '../src/mobs/brain';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { Biome } from '../src/world/biomes';
import { Block } from '../src/world/blocks';
import { toChunk } from '../src/world/coords';
import { findNearest } from '../src/world/find';
import { World } from '../src/world/world';

const SEED = 20261022;

/** A version 2 world loaded 3 columns round the nearest place of `kind`, and that place. */
function landAround(kind: 'savanna' | 'swamp'): { world: World; x: number; z: number } {
  const world = new World(SEED, { generation: 2 });
  const at = findNearest(world.generator, kind, 0, 0)!;
  for (let cz = toChunk(at.z) - 3; cz <= toChunk(at.z) + 3; cz++) for (let cx = toChunk(at.x) - 3; cx <= toChunk(at.x) + 3; cx++) world.ensureColumn(cx, cz);
  return { world, x: at.x, z: at.z };
}

describe('the ambler and the wader', () => {
  for (const [biome, kind, name] of [
    [Biome.Savanna, MobKind.Ambler, 'savanna'],
    [Biome.Swamp, MobKind.Wader, 'swamp'],
  ] as const) {
    it(`appear in the ${name}, on their own ground, and every kind spawned there is at home`, () => {
      const { world, x, z } = landAround(name);
      const m = new MobManager(world, 11, 40);
      for (let i = 0; i < 600; i++) m.trySpawn(x, z);
      const ours = m.mobs.filter((mob) => mob.kind === kind);
      expect(ours.length).toBeGreaterThan(0);
      for (const mob of m.mobs) {
        const bx = Math.floor(mob.body.x);
        const bz = Math.floor(mob.body.z);
        expect(KINDS[mob.kind].biomes, KINDS[mob.kind].name).toContain(world.generator.biome(bx, bz));
        expect(KINDS[mob.kind].ground).toContain(world.getBlock(bx, Math.floor(mob.body.y) - 1, bz));
      }
      // The swamp's are waders only: mossbacks have left it to them.
      if (biome === Biome.Swamp) expect(m.mobs.every((mob) => world.generator.biome(Math.floor(mob.body.x), Math.floor(mob.body.z)) !== Biome.Swamp || mob.kind === MobKind.Wader)).toBe(true);
    });
  }

  it("are where they're said to be, a wader's paths swimming and an ambler's not", () => {
    expect(KINDS[MobKind.Ambler].biomes).toEqual([Biome.Savanna]);
    expect(KINDS[MobKind.Ambler].ground).toEqual([Block.DryGrass]);
    expect(KINDS[MobKind.Wader].biomes).toEqual([Biome.Swamp]);
    expect(KINDS[MobKind.Mossback].biomes).not.toContain(Biome.Swamp);
    expect(pathOptions(MobKind.Wader, 1).swim).toBe(true);
    expect(pathOptions(MobKind.Ambler, 1).swim).toBe(false);
  });
});
