import { afterEach, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createMob, type Mob, sizeOf } from '../src/mobs/brain';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { unpackMobs, packMobs } from '../src/net/mobState';
import { MobMirror } from '../src/net/mobMirror';
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
const saved = { ...TUNING.mobs, breeding: { ...TUNING.mobs.breeding } };
afterEach(() => Object.assign(TUNING.mobs, { ...saved, breeding: { ...saved.breeding } }));
const B = () => TUNING.mobs.breeding;

/** A manager with no spawning, and kept, grown animals of `kinds` standing at the given (x, z)s. */
function keptAt(...at: [MobKind, number, number][]) {
  const m = new MobManager(world, 3, 0);
  const mobs = at.map(([kind, x, z], i) => {
    const mob = createMob(i + 1, kind, x + 0.5, top(x, z), z + 0.5, i + 1);
    mob.kept = true;
    m.mobs.push(mob);
    return mob;
  });
  return { m, mobs };
}

/** Step the manager `seconds` with the player at (10, 10) in daylight. */
function run(m: MobManager, seconds: number, until?: () => boolean): number {
  // Frames of 0.1 s: within the fixed step's catch-up, so the seconds are all stepped.
  for (let t = 0; t < seconds; t += 0.1) {
    m.update(0.1, [[10, 10]], 1);
    if (until?.()) return t;
  }
  return seconds;
}

const young = (m: MobManager) => m.mobs.filter((x) => x.grow > 0);

describe('breeding', () => {
  it('a kept, grown animal fed its food falls in love; not again while in love or waiting; a wild one is only kept', () => {
    const { m, mobs } = keptAt([MobKind.Mossback, 10, 10]);
    const [a] = mobs;
    expect(m.feed(a, Item.Wheat)).toBe(true);
    expect(a.love).toBe(B().love);
    expect(m.feed(a, Item.Wheat)).toBe(false); // in love already: not eaten
    a.love = 0;
    a.wait = 10;
    expect(m.feed(a, Item.Wheat)).toBe(false); // waiting
    const wild = createMob(9, MobKind.Mossback, 12.5, top(12, 10), 10.5, 9);
    m.mobs.push(wild);
    expect(m.feed(wild, Item.Wheat)).toBe(true);
    expect([wild.kept, wild.love]).toEqual([true, 0]);
  });

  it('two of a kind in love court, meet and make one young one, kept and half size; each parent then waits', () => {
    const { m, mobs } = keptAt([MobKind.Mossback, 8, 10], [MobKind.Mossback, 13, 10]);
    const [a, b] = mobs;
    for (const x of mobs) m.feed(x, Item.Wheat);
    m.update(0.25, [[10, 10]], 1);
    expect([a.state, b.state]).toEqual(['court', 'court']);
    expect(a.mate).toBe(b);
    const born: Mob[] = [];
    run(m, 25, () => (born.push(...m.takeBorn()), born.length > 0));
    expect(born).toHaveLength(1);
    const y = born[0];
    expect(y.kind).toBe(MobKind.Mossback);
    expect(y.kept).toBe(true);
    expect(y.grow).toBeCloseTo(B().grow, 0);
    expect(y.body.halfWidth).toBeCloseTo(KINDS[MobKind.Mossback].halfWidth / 2, 2);
    expect(y.body.height).toBeCloseTo(KINDS[MobKind.Mossback].height / 2, 2);
    for (const p of mobs) {
      expect(p.love).toBe(0);
      expect(p.mate).toBe(null);
      expect(p.wait).toBeGreaterThan(B().wait - 1);
      expect(p.state).not.toBe('court');
    }
    // Only the one, and none again while they wait.
    for (const x of mobs) expect(m.feed(x, Item.Wheat)).toBe(false);
    run(m, 10);
    expect(young(m)).toHaveLength(1);
    expect(m.keptRecords()).toHaveLength(3);
  });

  it('not with another kind, not beyond its reach, not wild, and not while one waits', () => {
    const tries: [MobKind, number, number][][] = [
      [[MobKind.Mossback, 8, 10], [MobKind.CragGoat, 11, 10]],
      [[MobKind.Mossback, 0, 10], [MobKind.Mossback, 0 + TUNING.mobs.breeding.near + 4, 10]],
    ];
    for (const at of tries) {
      const { m, mobs } = keptAt(...at);
      for (const x of mobs) m.feed(x, KINDS[x.kind].food!);
      run(m, 8);
      expect(mobs.map((x) => x.state)).not.toContain('court');
      expect(young(m)).toEqual([]);
    }
    // One of the two wild (fed, so kept, but not in love), and one waiting.
    for (const [wild, waiting] of [[true, false], [false, true]]) {
      const { m, mobs } = keptAt([MobKind.Mossback, 8, 10], [MobKind.Mossback, 11, 10]);
      m.feed(mobs[0], Item.Wheat);
      if (wild) mobs[1].kept = false;
      if (waiting) mobs[1].wait = 100;
      m.feed(mobs[1], Item.Wheat);
      run(m, 8);
      expect(young(m)).toEqual([]);
    }
  });

  it('at the kept cap, no young one, but the parents wait all the same', () => {
    TUNING.mobs.kept = 2;
    const { m, mobs } = keptAt([MobKind.Hopper, 8, 10], [MobKind.Hopper, 10, 10]);
    for (const x of mobs) m.feed(x, Item.Seeds);
    run(m, 25, () => mobs[0].wait > 0);
    expect(young(m)).toEqual([]);
    expect(mobs.every((x) => x.wait > 0)).toBe(true);
  });

  it('a young one grows to full size in its time, its box with it, faster for being fed', () => {
    const { m, mobs } = keptAt([MobKind.Hopper, 10, 10]);
    const [y] = mobs;
    y.grow = B().grow;
    expect(sizeOf(y)).toBe(0.5);
    expect(m.feed(y, Item.Seeds)).toBe(true);
    expect(y.grow).toBeCloseTo(B().grow * (1 - B().feedGrow));
    run(m, B().grow * (1 - B().feedGrow) * 0.5);
    expect(sizeOf(y)).toBeGreaterThan(0.7);
    expect(sizeOf(y)).toBeLessThan(0.8);
    expect(y.body.height).toBeCloseTo(KINDS[MobKind.Hopper].height * sizeOf(y), 1);
    run(m, B().grow);
    expect(y.grow).toBe(0);
    expect(sizeOf(y)).toBe(1);
    expect(y.body.halfWidth).toBeCloseTo(KINDS[MobKind.Hopper].halfWidth);
    expect(y.body.height).toBeCloseTo(KINDS[MobKind.Hopper].height);
  });

  it('a young one keeps near a grown one of its kind, and is faster', () => {
    const { m, mobs } = keptAt([MobKind.Mossback, 2, 10], [MobKind.Mossback, 14, 10]);
    const [lead, y] = mobs;
    lead.timer = Number.POSITIVE_INFINITY; // stays put
    y.grow = B().grow;
    m.update(0.25, [[10, 10]], 1);
    expect(y.lead).toBe(lead);
    run(m, 30);
    expect(Math.hypot(y.body.x - lead.body.x, y.body.z - lead.body.z)).toBeLessThan(B().follow + 1.5);
  });
});

describe('the young, for guests', () => {
  it("carry their age, and a guest's mirror draws them at their size", () => {
    const mob = createMob(4, MobKind.Ambler, 0.5, 70, 0.5, 1);
    mob.grow = TUNING.mobs.breeding.grow;
    const [snap] = unpackMobs(packMobs([mob]))!;
    expect(snap.grow).toBe(mob.grow);
    const mirror = new MobMirror();
    mirror.push(1, [snap]);
    mirror.update(5);
    const seen = mirror.byId(4)!;
    expect(sizeOf(seen)).toBe(0.5);
    expect(seen.body.height).toBeCloseTo(KINDS[MobKind.Ambler].height / 2);
  });

  it('?farmyard: kept animals of every kind, every other one young', () => {
    const m = new MobManager(world, 3, 0);
    expect(m.farmyard(10, 10, 12)).toBe(12);
    expect(m.mobs.every((x) => x.kept)).toBe(true);
    expect(new Set(m.mobs.map((x) => x.kind)).size).toBe(KINDS.filter((k) => !k.hostile).length);
    expect(young(m)).toHaveLength(6);
  });
});
