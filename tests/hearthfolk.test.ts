import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createMob, type Mob } from '../src/mobs/brain';
import { homesOf } from '../src/mobs/folk';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { poseOf } from '../src/mobs/pose';
import { packMobSounds, packMobs, unpackMobSounds, unpackMobs } from '../src/net/mobState';
import { BLOCKS, FACINGS } from '../src/world/blocks';
import { MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../src/world/coords';
import { findNearest } from '../src/world/find';
import { SETTLEMENT_REACH } from '../src/world/settlements';
import { World } from '../src/world/world';

// Seed 123's nearest settlement to the origin, and the land over it.
const world = new World(123, { generation: 4 });
const at = findNearest(world.generator, 'settlement', 0, 0)!;
const st = world.generator.settlementsIn(at.x, at.z, at.x, at.z)[0];
const columns: [number, number][] = [];
for (let cz = toChunk(st.z - SETTLEMENT_REACH - 8); cz <= toChunk(st.z + SETTLEMENT_REACH + 8); cz++)
  for (let cx = toChunk(st.x - SETTLEMENT_REACH - 8); cx <= toChunk(st.x + SETTLEMENT_REACH + 8); cx++) columns.push([cx, cz]);
for (const [cx, cz] of columns) world.ensureColumn(cx, cz);
const beds = st.huts.reduce((n, h) => n + h.beds, 0);

const saved = { ...TUNING.folk };
const budget = TUNING.mobs.pathBudgetMs;
// No time limit on path searches: these are about where the folk go, not when (a busy machine would hold them back).
TUNING.mobs.pathBudgetMs = 1e9;
afterEach(() => Object.assign(TUNING.folk, saved));
afterAll(() => {
  TUNING.mobs.pathBudgetMs = budget;
});

/** A manager with the settlement's folk come (every column told it's loaded). */
function settled(daylight = 1, seed = 1): MobManager {
  const m = new MobManager(world, seed);
  m.update(0, [], daylight);
  for (const [cx, cz] of columns) m.columnLoaded(cx, cz);
  return m;
}
const folkOf = (m: MobManager) => m.mobs.filter((x) => x.kind === MobKind.Hearthfolk);

/** Run the manager `seconds` at `daylight`, with players standing at `players`, in steps of 1/20 s. */
function run(m: MobManager, seconds: number, daylight: number, players: [number, number][] = [], each?: () => void): void {
  for (let t = 0; t < seconds; t += 0.05) {
    m.update(0.05, players, daylight);
    each?.();
  }
}

const across = (mob: Mob, x: number, z: number) => Math.hypot(mob.body.x - x, mob.body.z - z);

describe('the hearthfolk', () => {
  it('are a kind about a player’s size, never hurt, fed or counted with the animals', () => {
    const k = KINDS[MobKind.Hearthfolk];
    expect(k.folk).toBe(true);
    expect(k.height).toBeCloseTo(1.8);
    expect(k.food).toBeUndefined();
    expect(k.hostile).toBeUndefined();
    expect(k.biomes).toEqual([]);
  });

  it('come with their settlement, one beside each bed, once', () => {
    // Not until the well's column and the homes' are here: the well's alone isn't enough.
    const bare = new World(123, { generation: 4 });
    bare.ensureColumn(toChunk(st.x), toChunk(st.z));
    const early = new MobManager(bare, 1);
    early.update(0, [], 1);
    early.columnLoaded(toChunk(st.x), toChunk(st.z));
    expect(early.mobs.length).toBe(0);
    const m = new MobManager(world, 1);
    m.update(0, [], 1);
    m.columnLoaded(toChunk(st.x), toChunk(st.z));
    const folk = folkOf(m);
    expect(folk.length).toBe(beds);
    expect(m.settlements).toBe(1);
    for (const [cx, cz] of columns) m.columnLoaded(cx, cz);
    expect(folkOf(m).length).toBe(beds);
    const homes = homesOf(st);
    folk.forEach((f, i) => {
      expect(f.home).toEqual(homes[i]);
      const [ux, uy, uz] = homes[i].up;
      expect([Math.floor(f.body.x), f.body.y, Math.floor(f.body.z)]).toEqual([ux, uy, uz]);
      // Standing on the floor with room above.
      expect(BLOCKS[world.getBlock(ux, uy - 1, uz)].passable).toBe(false);
      for (let k = 0; k < 2; k++) expect(BLOCKS[world.getBlock(ux, uy + k, uz)].passable).toBe(true);
      expect(f.state).not.toBe('sleep');
    });
    // One trader, at its counter by day.
    expect(homes.filter((h) => h.spot).length).toBe(1);
  });

  it('come in bed at night', () => {
    const m = settled(0.1);
    for (const f of folkOf(m)) expect(f.state).toBe('sleep');
  });

  it('aren’t counted in the cap: the animals still come', () => {
    const m = new MobManager(world, 5, 4);
    m.update(0, [], 1);
    for (const [cx, cz] of columns) m.columnLoaded(cx, cz);
    for (let i = 0; i < 400; i++) m.trySpawn(st.x, st.z);
    expect(folkOf(m).length).toBe(beds);
    expect(m.mobs.length - beds).toBe(4);
  });

  it('go when their land unloads, and come back as they were when it loads', () => {
    const local = new World(123, { generation: 4 });
    for (const [cx, cz] of columns) local.ensureColumn(cx, cz);
    const m = new MobManager(local, 1);
    m.update(0, [], 1);
    for (const [cx, cz] of columns) m.columnLoaded(cx, cz);
    expect(m.mobs.length).toBe(beds);
    // Far from any player: still here.
    m.update(0.05, [[st.x + 5000, st.z]], 1);
    expect(m.mobs.length).toBe(beds);
    // The well's column goes: all of them do.
    const [wx, wz] = [toChunk(st.x), toChunk(st.z)];
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
      const c = local.getChunk(wx, cy, wz);
      if (c) local.unload(c);
    }
    m.update(0.05, [], 1);
    expect(m.mobs.length).toBe(0);
    expect(m.settlements).toBe(0);
    local.ensureColumn(wx, wz);
    m.columnLoaded(wx, wz);
    expect(m.mobs.length).toBe(beds);
  });

  it('can’t be hurt: a hit is a step back and a cry', () => {
    const m = settled();
    const f = folkOf(m)[0];
    m.takeSounds();
    for (let i = 0; i < 30; i++) expect(m.hit(f, f.body.x - 1, f.body.z, 3)).toBe(false);
    expect(m.mobs).toContain(f);
    expect(f.hits).toBe(0);
    expect(f.body.vx).toBeGreaterThan(0);
    expect(f.body.vx).toBeLessThanOrEqual(TUNING.folk.knockback);
    expect(f.state).not.toBe('flee');
    expect(m.takeSounds().filter((s) => s.voice === 'hurt').length).toBe(30);
  });

  it('wander about their settlement by day, never far from the well', () => {
    const m = settled();
    const folk = folkOf(m);
    let furthest = 0;
    run(m, 90, 1, [], () => {
      for (const f of folk) furthest = Math.max(furthest, across(f, st.x + 0.5, st.z + 0.5));
    });
    expect(furthest).toBeLessThanOrEqual(TUNING.folk.reach + 2);
    // They've been about: most walked some way.
    expect(folk.filter((f) => f.walked > 4).length).toBeGreaterThanOrEqual(folk.length / 2);
    // The trader spends much of its day by the counter.
    const trader = folk.find((f) => f.home!.spot)!;
    let atCounter = 0;
    const [sx, , sz] = trader.home!.spot!;
    run(m, 60, 1, [], () => {
      if (across(trader, sx + 0.5, sz + 0.5) < 1) atCounter++;
    });
    expect(atCounter).toBeGreaterThan(300);
  });

  it('walk home at dusk, through their open doors, and lie in their own beds until morning', () => {
    // Only walking home counts here: none is put there.
    TUNING.folk.homeTries = 1000;
    TUNING.folk.homeSeconds = 1000;
    const m = settled();
    run(m, 40, 1);
    const folk = folkOf(m);
    // Out of their huts, most of them.
    const out = folk.filter((f) => {
      const [ux, , uz] = f.home!.up;
      return across(f, ux + 0.5, uz + 0.5) > 4;
    });
    expect(out.length).toBeGreaterThan(0);
    run(m, 60, 0.2);
    for (const f of folk) {
      expect(f.state).toBe('sleep');
      const [bx, by, bz] = f.home!.bed;
      // In its own bed: its feet at the foot, lying the way the bed does.
      expect(Math.floor(f.body.x)).toBe(bx);
      expect(Math.floor(f.body.z)).toBe(bz);
      expect(f.body.y).toBeCloseTo(by + 0.5);
      const [fx, fz] = FACINGS[f.home!.bedFacing];
      expect(f.yaw).toBeCloseTo(Math.atan2(fx, fz));
      expect(poseOf(f, 0).lie).toBe(true);
    }
    // Still there a while later, then up in the morning beside the bed.
    const where = folk.map((f) => [f.body.x, f.body.y, f.body.z]);
    run(m, 10, 0.1);
    expect(folk.map((f) => [f.body.x, f.body.y, f.body.z])).toEqual(where);
    run(m, 0.2, 1);
    for (const f of folk) {
      expect(f.state).not.toBe('sleep');
      const [ux, , uz] = f.home!.up;
      expect(across(f, ux + 0.5, uz + 0.5)).toBeLessThan(1);
    }
  });

  it('are put to bed if they can’t find the way', () => {
    TUNING.folk.homeTries = 1;
    const m = settled();
    const f = folkOf(m)[0];
    // Somewhere with no way home: high in the air over the well.
    f.body.y = st.y + 60;
    f.body.vy = 0;
    run(m, 5, 0.2);
    expect(f.state).toBe('sleep');
  });

  it('turn to a player who comes near, greeting them once a visit', () => {
    const m = settled();
    const f = folkOf(m)[1];
    run(m, 0.5, 1);
    m.takeSounds();
    // A player two blocks in front of it.
    const px = f.body.x + 2;
    const pz = f.body.z;
    f.state = 'idle';
    f.path = null;
    run(m, 1.5, 1, [[px, pz]]);
    expect(f.state).toBe('greet');
    const mine = (list: ReturnType<MobManager['takeSounds']>) => list.filter((s) => s.voice === 'greet' && Math.hypot(s.x - f.body.x, s.z - f.body.z) < 0.5);
    expect(mine(m.takeSounds()).length).toBe(1);
    // Facing them.
    expect(-Math.sin(f.yaw)).toBeGreaterThan(0.9);
    // Not again while they stay.
    run(m, TUNING.folk.greetSeconds + 2, 1, [[px, pz]]);
    expect(f.state).not.toBe('greet');
    expect(mine(m.takeSounds()).length).toBe(0);
  });

  it('run from a gloamer', () => {
    const m = settled();
    const f = folkOf(m)[0];
    run(m, 0.2, 1);
    const g = createMob(9999, MobKind.Gloamer, f.body.x + 3, f.body.y, f.body.z, 7);
    m.mobs.push(g);
    // (At dusk: by day a gloamer fades; and with a player about, or it goes.)
    run(m, 0.2, 0.2, [[f.body.x, f.body.z + 30]]);
    expect(f.state).toBe('flee');
  });

  it('go to guests with their state and greetings', () => {
    const m = settled(0.1);
    const f = folkOf(m)[0];
    const [snap] = unpackMobs(packMobs([f]))!;
    expect(snap.kind).toBe(MobKind.Hearthfolk);
    expect(snap.state).toBe('sleep');
    const sounds = unpackMobSounds(packMobSounds([{ voice: 'greet', kind: MobKind.Hearthfolk, x: 1, y: 2, z: 3 }]))!;
    expect(sounds[0].voice).toBe('greet');
  });

  it('stand still where they are shown, with no home (`?showcase=hearthfolk`)', () => {
    const m = new MobManager(world, 1);
    m.showcase(st.x + 3, st.y + 1, st.z, 0, [MobKind.Hearthfolk]);
    const [lone] = m.mobs;
    expect(lone.home).toBe(null);
    const x = lone.body.x;
    run(m, 5, 1, [[st.x + 3, st.z]]);
    expect(lone.body.x).toBeCloseTo(x);
    expect(lone.state).toBe('idle');
  });
});
