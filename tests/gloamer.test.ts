import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createMob, directContext, type MobContext, type Prey, stepBrain } from '../src/mobs/brain';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { packMobs, unpackMobs } from '../src/net/mobState';
import { RECIPES } from '../src/survival/crafting';
import { FUELS } from '../src/survival/furnace';
import { Item } from '../src/survival/items';
import { Block } from '../src/world/blocks';
import { World } from '../src/world/world';
import { Grid } from './grid';

const G = KINDS[MobKind.Gloamer];
const H = G.hostile!;
const STEP = TUNING.mobs.step;

/** A gloamer and a player on a stone floor; `seconds` of its brain, counting the hits it makes. */
function chase(start: [number, number], player: Prey, seconds: number, daylight = 0) {
  const grid = new Grid().floor(-40, 40, -40, 40, 1);
  const mob = createMob(1, MobKind.Gloamer, start[0] + 0.5, 1, start[1] + 0.5, 7);
  const hits: number[] = [];
  const ctx: MobContext = { ...directContext(grid, daylight), prey: [player], attack: (_m, t) => hits.push(t) };
  let firstHit = -1;
  for (let i = 0; i < seconds / STEP; i++) {
    stepBrain(mob, ctx);
    if (hits.length && firstHit < 0) firstHit = i * STEP;
  }
  return { mob, hits, firstHit };
}

// The land round the spawn of seed 20261022: columns -2..2 each way.
const world = new World(20261022);
for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) world.ensureColumn(cx, cz);
const top = (x: number, z: number) => {
  let y = 255;
  while (y > 0 && world.getBlock(x, y, z) === Block.Air) y--;
  return y;
};

describe('the gloamer', () => {
  it('hunts a player it sees, reaching them and hitting every so often; at night too, never resting', () => {
    const player = { x: 10.5, y: 1, z: 0.5 };
    const { mob, hits, firstHit } = chase([0, 0], player, 8);
    expect(mob.state).toBe('hunt');
    expect(firstHit).toBeGreaterThan(0);
    // 10 blocks at 4.8 a second, less reach: there in under 3 s.
    expect(firstHit).toBeLessThan(3);
    expect(Math.hypot(mob.body.x - player.x, mob.body.z - player.z)).toBeLessThan(1.6);
    // Once every `every` s from then on.
    expect(hits.length).toBeGreaterThanOrEqual(Math.floor((8 - firstHit) / H.every));
    expect(hits.length).toBeLessThanOrEqual(Math.ceil((8 - firstHit) / H.every) + 1);
    expect(hits.every((t) => t === 0)).toBe(true);
  });

  it('takes an empty path (it starts near enough) as no way, and goes straight at the player', () => {
    // A path search whose start already counts as there gives no waypoints at all; once this read
    // past the end of it and stopped the game.
    const grid = new Grid().floor(-10, 10, -10, 10, 1);
    const mob = createMob(1, MobKind.Gloamer, 0.5, 1, 0.5, 7);
    const hits: number[] = [];
    const ctx: MobContext = { ...directContext(grid, 0), findPath: () => [], prey: [{ x: 5.5, y: 1, z: 0.5 }], attack: (_m, t) => hits.push(t) };
    expect(() => {
      for (let i = 0; i < 3 / STEP; i++) stepBrain(mob, ctx);
    }).not.toThrow();
    expect(hits.length).toBeGreaterThan(0);
  });

  it("asks for a way it can't have only every so often, and one put off again soon", () => {
    // Under a player it sees but can't reach (as from a cave): no way. Once it asked again every
    // frame (no goal kept).
    const grid = new Grid().floor(-40, 40, -40, 40, 1);
    const player = { x: 10.5, y: 20, z: 0.5 };
    const count = (answer: null | undefined) => {
      const mob = createMob(1, MobKind.Gloamer, 0.5, 1, 0.5, 7);
      let asked = 0;
      const ctx: MobContext = { ...directContext(grid, 0), findPath: () => (asked++, answer), prey: [player] };
      for (let i = 0; i < 10 / STEP; i++) stepBrain(mob, ctx);
      return asked;
    };
    // No way: at the start, then every `huntRetry` s.
    expect(count(null)).toBe(Math.ceil(10 / TUNING.mobs.huntRetry));
    // Put off: about 5 a second, not every step.
    expect(count(undefined)).toBeGreaterThan(40);
    expect(count(undefined)).toBeLessThanOrEqual(51);
  });

  it('leaves alone a player beyond its sight', () => {
    const { mob, hits } = chase([0, 0], { x: H.sight + 5, y: 1, z: 0.5 }, 5);
    expect(mob.state).not.toBe('hunt');
    expect(hits.length).toBe(0);
  });

  it('takes 8 points of hitting: 8 hits by hand, 4 with a pick or spade, 3 with an axe; animals 3 by hand, 1 with an axe', () => {
    const D = TUNING.mobs.toolDamage;
    const hitsToGo = (kind: MobKind, points: number) => {
      const m = new MobManager(world, 1, 0);
      const mob = createMob(1, kind, 0.5, top(0, 0) + 1, 0.5, 1);
      m.mobs.push(mob);
      let n = 0;
      while (m.mobs.includes(mob) && n < 20) {
        m.hit(mob, -3, 0, points);
        n++;
      }
      return n;
    };
    expect([D.hand, D.pick, D.spade, D.axe].map((p) => hitsToGo(MobKind.Gloamer, p))).toEqual([8, 4, 4, 3]);
    expect([hitsToGo(MobKind.Mossback, D.hand), hitsToGo(MobKind.Mossback, D.axe)]).toEqual([3, 1]);
  });

  it('is knocked back less than an animal by a hit, and comes on again', () => {
    const m = new MobManager(world, 1, 0);
    const g = createMob(1, MobKind.Gloamer, 0.5, 80, 0.5, 1);
    const a = createMob(2, MobKind.Mossback, 0.5, 80, 0.5, 1);
    m.mobs.push(g, a);
    m.hit(g, -3, 0.5);
    m.hit(a, -3, 0.5);
    expect(g.body.vx).toBeLessThan(a.body.vx);
    expect(a.state).toBe('flee');
    expect(g.state).not.toBe('flee');
  });

  it('appears only in the dark, 24–36 blocks from a player, at most 3 for each', () => {
    const lightAt = (x: number, y: number, z: number, daylight: number) => {
      const l = world.getLight(x, y, z);
      return Math.max(Math.round((l >> 4) * daylight), l & 15);
    };
    for (const daylight of [0, 1]) {
      const m = new MobManager(world, 3, 0);
      const player = { x: 16.5, y: top(16, 16) + 1, z: 16.5 };
      for (let i = 0; i < 4000; i++) m.trySpawnHostile(player, [player], daylight);
      const gloamers = m.mobs.filter((g) => g.kind === MobKind.Gloamer);
      expect(gloamers.length).toBeGreaterThan(0);
      expect(gloamers.length).toBeLessThanOrEqual(H.most);
      for (const g of gloamers) {
        const b = g.body;
        expect(lightAt(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z), daylight)).toBeLessThanOrEqual(H.darkness);
        const d = Math.hypot(b.x - player.x, b.z - player.z);
        expect(d).toBeGreaterThanOrEqual(H.distance[0] - 1);
        expect(d).toBeLessThanOrEqual(H.distance[1] + 1);
      }
      // By day, only where the sun doesn't reach: under the ground.
      if (daylight === 1) for (const g of gloamers) expect(world.getLight(Math.floor(g.body.x), Math.floor(g.body.y), Math.floor(g.body.z)) >> 4).toBeLessThanOrEqual(H.darkness);
    }
    // With nobody to hunt (creative), none come.
    const m = new MobManager(world, 3, 0);
    for (let i = 0; i < 200; i++) m.update(1 / 60, [[16.5, 16.5]], 0);
    expect(m.mobs.some((g) => g.kind === MobKind.Gloamer)).toBe(false);
  });

  it('fades into a puff out in the sun by day, not in a cave', () => {
    const m = new MobManager(world, 1, 0);
    const out = createMob(1, MobKind.Gloamer, 20.5, top(20, 20) + 1, 20.5, 1);
    // A cave: two blocks of air dug deep in the stone, no way for the sun in.
    world.setBlocks([
      [30, 20, 30, Block.Air],
      [30, 21, 30, Block.Air],
    ]);
    const cave = createMob(2, MobKind.Gloamer, 30.5, 20, 30.5, 2);
    m.mobs.push(out, cave);
    m.update(1 / 60, [[25, 25]], 1);
    expect(m.mobs).toEqual([cave]);
    expect(m.takeFaded()).toEqual([out]);
    expect(m.takeSounds().some((s) => s.voice === 'puff')).toBe(true);
    // At night it stays out.
    const night = new MobManager(world, 1, 0);
    night.mobs.push(createMob(3, MobKind.Gloamer, 20.5, top(20, 20) + 1, 20.5, 3));
    night.update(1 / 60, [[25, 25]], 0);
    expect(night.mobs.length).toBe(1);
  });

  it('leaves an ember: fuel for 12, and torches with a stick; hunting goes to guests', () => {
    expect(FUELS.get(Item.Ember)).toBe(12);
    expect(RECIPES.some((r) => r.makes === Block.Torch && r.cost.some(([item]) => item === Item.Ember))).toBe(true);
    const g = createMob(5, MobKind.Gloamer, 1.5, 70, 2.5, 1);
    g.state = 'hunt';
    expect(unpackMobs(packMobs([g]))![0]).toMatchObject({ kind: MobKind.Gloamer, state: 'hunt' });
  });
});
