import { afterEach, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createMob } from '../src/mobs/brain';
import { KeptAnimals } from '../src/mobs/kept';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { Item } from '../src/survival/items';
import { Block } from '../src/world/blocks';
import { World } from '../src/world/world';

// The land round the spawn of seed 20261022: columns -2..2 each way.
const world = new World(20261022);
for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) world.ensureColumn(cx, cz);
const top = (x: number, z: number) => {
  let y = 255;
  while (y > 0 && world.getBlock(x, y, z) === Block.Air) y--;
  return y + 1;
};
const saved = { ...TUNING.mobs };
afterEach(() => Object.assign(TUNING.mobs, saved));

/** A manager with no spawning, and a mossback standing at (x, z). */
function withMossback(x = 10, z = 10) {
  const m = new MobManager(world, 3, 0);
  const mob = createMob(1, MobKind.Mossback, x + 0.5, top(x, z), z + 0.5, 1);
  m.mobs.push(mob);
  return { m, mob };
}

describe('kept animals', () => {
  it('each animal kind eats one thing; hostile kinds nothing', () => {
    for (const k of KINDS) {
      if (k.hostile) expect(k.food).toBeUndefined();
      else expect([Item.Wheat, Item.Seeds, Item.Berries]).toContain(k.food);
    }
    expect(KINDS[MobKind.Hopper].food).toBe(Item.Seeds);
    expect(KINDS[MobKind.Wader].food).toBe(Item.Berries);
  });

  it('are made by feeding a wild animal its food, and only its food', () => {
    const { m, mob } = withMossback();
    expect(m.feed(mob, Item.Berries)).toBe(false);
    expect(mob.kept).toBe(false);
    expect(m.feed(mob, Item.Wheat)).toBe(true);
    expect(mob.kept).toBe(true);
    expect(m.keptCount).toBe(1);
    expect(m.feed(mob, Item.Wheat)).toBe(true); // fed again: still kept, still one
    expect(m.keptCount).toBe(1);
  });

  it('stop being made at the cap: fed past it, an animal stays wild', () => {
    TUNING.mobs.kept = 2;
    const m = new MobManager(world, 3, 0);
    const three = [0, 1, 2].map((i) => createMob(i, MobKind.Mossback, 10.5 + i, top(10 + i, 10), 10.5, i));
    m.mobs.push(...three);
    for (const mob of three) expect(m.feed(mob, Item.Wheat)).toBe(true);
    expect(three.map((mob) => mob.kept)).toEqual([true, true, false]);
  });

  it("don't count against the wild cap, and aren't let go for being far from the player", () => {
    const { m, mob } = withMossback();
    m.feed(mob, Item.Wheat);
    const wild = createMob(2, MobKind.Mossback, 12.5, top(12, 10), 10.5, 2);
    m.mobs.push(wild);
    // The player far away (but the land still loaded).
    m.update(0, [[10 + TUNING.mobs.despawnDistance + 5, 10]], 1);
    expect(m.mobs).toContain(mob);
    expect(m.mobs).not.toContain(wild);
  });

  it('are stored when their column unloads and come back where they were when it loads', () => {
    const own = new World(20261022);
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) own.ensureColumn(cx, cz);
    const m = new MobManager(own, 3, 0);
    const mob = createMob(1, MobKind.Hopper, 10.5, top(10, 10), 10.5, 1);
    m.mobs.push(mob);
    m.feed(mob, Item.Seeds);
    mob.grow = 30;
    mob.wait = 12;
    for (const c of [...own.chunks.values()]) if (c.cx === 0 && c.cz === 0) own.unload(c);
    m.update(0, [[10, 10]], 1);
    expect(m.mobs).toEqual([]);
    expect(m.kept.stored).toBe(1);
    expect(m.keptCount).toBe(1);
    own.ensureColumn(0, 0);
    m.columnLoaded(0, 0);
    expect(m.kept.stored).toBe(0);
    expect(m.mobs).toHaveLength(1);
    const back = m.mobs[0];
    expect(back.kept).toBe(true);
    expect(back.kind).toBe(MobKind.Hopper);
    expect([back.body.x, back.body.z]).toEqual([10.5, 10.5]);
    expect([back.grow, back.wait]).toEqual([30, 12]);
  });

  it('are saved and loaded, here and stored, and what was saved is cleaned', () => {
    const { m, mob } = withMossback();
    m.feed(mob, Item.Wheat);
    m.kept.store({ kind: MobKind.Ambler, x: 400.5, y: 70, z: -3.5, grow: 0, wait: 5 });
    const saved = JSON.parse(JSON.stringify(m.keptRecords()));
    expect(saved).toHaveLength(2);
    const back = KeptAnimals.from(saved);
    expect(back.stored).toBe(2);
    expect(back.take(12, -1)).toEqual([{ kind: MobKind.Ambler, x: 400.5, y: 70, z: -3.5, grow: 0, wait: 5 }]);
    const junk = KeptAnimals.from([
      { kind: MobKind.Gloamer, x: 0, y: 70, z: 0 }, // hostile: never kept
      { kind: 99, x: 0, y: 70, z: 0 },
      { kind: MobKind.Hopper, x: 'a', y: 70, z: 0 },
      { kind: MobKind.Hopper, x: 1, y: 70, z: 2, grow: -4, wait: 'soon' }, // times cleaned to 0
      null,
      7,
    ]);
    expect(junk.all()).toEqual([{ kind: MobKind.Hopper, x: 1, y: 70, z: 2, grow: 0, wait: 0 }]);
    expect(KeptAnimals.from('nothing').stored).toBe(0);
    TUNING.mobs.kept = 1;
    expect(KeptAnimals.from(saved).stored).toBe(1);
  });
});
