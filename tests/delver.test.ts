import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createMob, directContext, type MobContext, type Prey, stepBrain } from '../src/mobs/brain';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { packMobs, unpackMobs } from '../src/net/mobState';
import { Item } from '../src/survival/items';
import { Block } from '../src/world/blocks';
import { World } from '../src/world/world';
import { Grid } from './grid';

const D = KINDS[MobKind.Delver];
const H = D.hostile!;
const STEP = TUNING.mobs.step;

/** A delver and a player on stone floors; `seconds` of its brain, counting the hits it makes. */
function chase(floor: number, player: Prey, seconds: number) {
  const grid = new Grid().floor(-30, 30, -30, 30, floor);
  if (player.y !== floor) grid.floor(-30, 30, -30, 30, player.y);
  const mob = createMob(1, MobKind.Delver, 0.5, floor, 0.5, 7);
  const hits: number[] = [];
  const ctx: MobContext = { ...directContext(grid, 0), prey: [player], attack: (_m, t) => hits.push(t) };
  let firstHit = -1;
  let highest = -Infinity;
  for (let i = 0; i < seconds / STEP; i++) {
    stepBrain(mob, ctx);
    highest = Math.max(highest, mob.body.y);
    if (hits.length && firstHit < 0) firstHit = i * STEP;
  }
  return { mob, hits, firstHit, highest };
}

// The land round the spawn of seed 20261022, with a dark room dug at y 20–21 under it (69 × 69 blocks).
const world = new World(20261022);
for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) world.ensureColumn(cx, cz);
const room: [number, number, number, Block][] = [];
for (let z = -34; z <= 34; z++) for (let x = -34; x <= 34; x++) room.push([x, 20, z, Block.Air], [x, 21, z, Block.Air]);
world.setBlocks(room);
const top = (x: number, z: number) => {
  let y = 255;
  while (y > 0 && world.getBlock(x, y, z) === Block.Air) y--;
  return y;
};

describe('the delver', () => {
  it('is slow and tough: 12 points of hitting, 4 a hit every 2 s, never fading in the sun', () => {
    expect([D.walkSpeed, D.runSpeed, D.health, H.damage, H.every, H.sight, H.below, H.most]).toEqual([1.0, 2.6, 12, 4, 2, 16, 40, 2]);
    expect(H.fadeSun).toBeGreaterThan(15);
    const m = new MobManager(world, 1, 0);
    const out = createMob(1, MobKind.Delver, 20.5, top(20, 20) + 1, 20.5, 1);
    m.mobs.push(out);
    m.update(1 / 60, [[20, 20]], 1);
    expect(m.mobs).toEqual([out]);
    // 12 hits by hand, 6 with a pick, 4 with an axe.
    const T = TUNING.mobs.toolDamage;
    const hitsToGo = (points: number) => {
      const mm = new MobManager(world, 1, 0);
      const mob = createMob(2, MobKind.Delver, 20.5, top(20, 20) + 1, 20.5, 2);
      mm.mobs.push(mob);
      let n = 0;
      while (mm.mobs.includes(mob) && n < 30) {
        mm.hit(mob, 17, 20, points);
        n++;
      }
      return n;
    };
    expect([T.hand, T.pick, T.axe].map(hitsToGo)).toEqual([12, 6, 4]);
  });

  it('leaves raw iron, 1 or 2', () => {
    expect(H.loot).toEqual({ item: Item.RawIron, count: [1, 2] });
    expect(KINDS[MobKind.Gloamer].hostile!.loot).toEqual({ item: Item.Ember, count: [1, 1] });
  });

  it('hunts a player below its depth, slowly, hitting every 2 s', () => {
    const player = { x: 8.5, y: 20, z: 0.5 };
    const { mob, hits, firstHit } = chase(20, player, 10);
    expect(mob.state).toBe('hunt');
    // 8 blocks at 2.6 a second, less reach: about 3 s.
    expect(firstHit).toBeGreaterThan(2);
    expect(firstHit).toBeLessThan(4.5);
    expect(hits.length).toBeGreaterThanOrEqual(Math.floor((10 - firstHit) / H.every));
    expect(hits.length).toBeLessThanOrEqual(Math.ceil((10 - firstHit) / H.every) + 1);
  });

  it('leaves alone a player above its depth, and wanders only below it', () => {
    // The player 4 blocks up a slope it could climb, on a floor at its depth.
    const grid = new Grid().floor(-20, -1, -20, 20, 39);
    for (let x = 0; x <= 20; x++) for (let z = -20; z <= 20; z++) grid.set(x, 39, z, Block.Stone);
    const player = { x: 4.5, y: 40, z: 0.5 };
    const mob = createMob(1, MobKind.Delver, -6.5, 39, 0.5, 3);
    const hits: number[] = [];
    const ctx: MobContext = { ...directContext(grid, 0), prey: [player], attack: (_m, t) => hits.push(t) };
    let highest = -Infinity;
    for (let i = 0; i < 120 / STEP; i++) {
      stepBrain(mob, ctx);
      highest = Math.max(highest, mob.body.y);
    }
    expect(hits).toEqual([]);
    expect(mob.state).not.toBe('hunt');
    expect(highest).toBeLessThan(H.below!);
    // With the player down at its level, it comes.
    const { mob: m2 } = chase(39, { x: 8.5, y: 39, z: 0.5 }, 1);
    expect(m2.state).toBe('hunt');
  });

  it('appears only in the dark below its depth, at most 2 for each player; never round a player on the surface', () => {
    const m = new MobManager(world, 3, 0);
    const below = { x: 0.5, y: 20, z: 0.5 };
    for (let i = 0; i < 4000; i++) m.trySpawnHostile(below, [below], 1);
    const delvers = m.mobs.filter((g) => g.kind === MobKind.Delver);
    expect(delvers.length).toBeGreaterThan(0);
    expect(delvers.length).toBeLessThanOrEqual(H.most);
    for (const g of delvers) {
      const b = g.body;
      expect(b.y).toBeLessThan(H.below!);
      expect(world.getLight(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z)) & 15).toBeLessThanOrEqual(H.darkness);
      expect(Math.hypot(b.x - below.x, b.z - below.z)).toBeGreaterThanOrEqual(H.distance[0] - 1);
    }
    // Gloamers still come too: the kinds take turns.
    expect(m.mobs.some((g) => g.kind === MobKind.Gloamer)).toBe(true);
    const up = new MobManager(world, 3, 0);
    const surface = { x: 16.5, y: top(16, 16) + 1, z: 16.5 };
    for (let i = 0; i < 2000; i++) up.trySpawnHostile(surface, [surface], 0);
    expect(up.mobs.some((g) => g.kind === MobKind.Delver)).toBe(false);
    expect(up.mobs.some((g) => g.kind === MobKind.Gloamer)).toBe(true);
  });

  it('goes to guests, and its hits say what it was', () => {
    const g = createMob(5, MobKind.Delver, 1.5, 20, 2.5, 1);
    g.state = 'hunt';
    expect(unpackMobs(packMobs([g]))![0]).toMatchObject({ kind: MobKind.Delver, state: 'hunt' });
    // In the room, next to the player: its hit comes with its kind.
    const m = new MobManager(world, 1, 0);
    m.mobs.push(createMob(7, MobKind.Delver, 4.5, 20, 0.5, 6));
    const prey = [{ x: 5.5, y: 20, z: 0.5 }];
    let attack;
    for (let i = 0; i < 120 && !attack; i++) {
      m.update(1 / 30, [[5.5, 0.5]], 0, prey);
      attack = m.takeAttacks()[0];
    }
    expect(attack).toMatchObject({ kind: MobKind.Delver, damage: 4 });
  });
});
