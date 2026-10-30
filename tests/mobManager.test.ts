import { afterEach, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createMob } from '../src/mobs/brain';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { drawnAt } from '../src/render/mobRenderer';
import { Block, BLOCKS } from '../src/world/blocks';
import { World } from '../src/world/world';

// The land round the spawn of seed 20261022: columns -2..2 each way (blocks -64..95).
const world = new World(20261022);
for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) world.ensureColumn(cx, cz);
const top = (x: number, z: number) => {
  let y = 255;
  while (y > 0 && world.getBlock(x, y, z) === Block.Air) y--;
  return y;
};
/** The first column in the loaded land whose top block passes `test`. */
function columnWhere(test: (block: Block) => boolean): [number, number] {
  for (let z = -60; z < 90; z += 3) for (let x = -60; x < 90; x += 3) if (test(world.getBlock(x, top(x, z), z))) return [x, z];
  throw new Error('no such column');
}

const saved = { ...TUNING.mobs };
afterEach(() => Object.assign(TUNING.mobs, saved));

describe('mob spawning', () => {
  it('stands a kind only on its own ground, open to the sky, in loaded land', () => {
    const m = new MobManager(world, 1);
    const [gx, gz] = columnWhere((b) => b === Block.Grass);
    expect(m.groundAt(gx, gz, MobKind.Mossback)).toBe(top(gx, gz) + 1);
    expect(m.groundAt(gx, gz, MobKind.DuneBeetle)).toBe(null); // grass isn't sand
    const [wx, wz] = columnWhere((b) => b === Block.Water);
    expect(m.groundAt(wx, wz, MobKind.Mossback)).toBe(null);
    const [lx, lz] = columnWhere((b) => BLOCKS[b].cutout); // under a tree's leaves
    expect(m.groundAt(lx, lz, MobKind.Mossback)).toBe(null);
    expect(m.groundAt(500, 500, MobKind.Mossback)).toBe(null); // not loaded
  });

  it('puts groups of the right kinds on the right ground, away from the player, up to the cap', () => {
    const m = new MobManager(world, 7, 12);
    for (let i = 0; i < 400; i++) m.trySpawn(16, 16);
    expect(m.mobs.length).toBe(12);
    for (const mob of m.mobs) {
      const k = KINDS[mob.kind];
      const x = Math.floor(mob.body.x);
      const z = Math.floor(mob.body.z);
      expect(k.biomes).toContain(world.generator.climate.dominant(x, z));
      expect(k.ground).toContain(world.getBlock(x, Math.floor(mob.body.y) - 1, z));
      expect(Math.floor(mob.body.y) - 1).toBe(top(x, z)); // on the top: open to the sky
      expect(Math.hypot(mob.body.x - 16, mob.body.z - 16)).toBeGreaterThanOrEqual(TUNING.mobs.spawnDistance[0]);
    }
    // Every id once.
    expect(new Set(m.mobs.map((mob) => mob.id)).size).toBe(12);
  });

  it('lets mobs go when the player is far, or their land unloads', () => {
    const m = new MobManager(world, 3);
    const [gx, gz] = columnWhere((b) => b === Block.Grass);
    m.mobs.push(createMob(1, MobKind.Mossback, gx + 0.5, top(gx, gz) + 1, gz + 0.5, 1));
    m.update(0, gx, gz, 1);
    expect(m.mobs.length).toBeGreaterThanOrEqual(1);
    const near = m.mobs.length;
    m.update(0, gx + TUNING.mobs.despawnDistance + 1, gz, 1);
    expect(m.mobs.length).toBeLessThan(near);
    expect(m.mobs.some((mob) => mob.id === 1)).toBe(false);
    // A mob in a column that isn't loaded goes too.
    m.mobs.push(createMob(2, MobKind.Mossback, 500.5, 80, 500.5, 2));
    m.update(0, 500, 500, 1);
    expect(m.mobs.some((mob) => mob.id === 2)).toBe(false);
  });

  it('puts path searches off once the frame budget is used, and searches when it is not', () => {
    const [gx, gz] = columnWhere((b) => b === Block.Grass);
    const make = () => {
      const m = new MobManager(world, 5, 0); // no spawning: just these
      for (let i = 0; i < 6; i++) {
        const mob = createMob(i + 1, MobKind.Mossback, gx + 0.5, top(gx, gz) + 1, gz + 0.5, i + 1);
        mob.timer = 0; // looking for a place to wander to
        m.mobs.push(mob);
      }
      return m;
    };
    TUNING.mobs.pathBudgetMs = -1; // used up before it starts
    const starved = make();
    starved.update(0.1, gx, gz, 1);
    expect(starved.searches).toBe(0);
    expect(starved.deferred).toBeGreaterThan(0);
    TUNING.mobs.pathBudgetMs = 1000;
    const fed = make();
    fed.update(0.1, gx, gz, 1);
    expect(fed.searches).toBeGreaterThan(0);
    expect(fed.deferred).toBe(0);
  });

  it('draws a mob between its last two steps, turning the short way', () => {
    const mob = createMob(1, MobKind.Hopper, 2, 10, 4, 1);
    mob.yaw = -3;
    const [x, y, z, yaw] = drawnAt(mob, { x: 0, y: 10, z: 0, yaw: 3 }, 0.5);
    expect([x, y, z]).toEqual([1, 10, 2]);
    // From 3 to -3 the short way is through π, not back through 0.
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(0.15);
    expect(drawnAt(mob, undefined, 0.5)).toEqual([2, 10, 4, -3]);
  });
});
