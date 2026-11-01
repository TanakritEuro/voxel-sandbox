import { afterEach, describe, expect, it } from 'vitest';
import { heard } from '../src/audio/cues';
import { TUNING } from '../src/config';
import { createRng } from '../src/math';
import { createMob } from '../src/mobs/brain';
import { mobOnRay } from '../src/mobs/hit';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { MAX_PARTICLES, Particles } from '../src/render/particles';
import { Block } from '../src/world/blocks';
import { raycast } from '../src/world/raycast';
import { World } from '../src/world/world';

// Generated land round the spawn of seed 20261022 (blocks -32..63 each way).
const world = new World(20261022);
for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
const top = (x: number, z: number) => {
  let y = 255;
  while (y > 0 && world.getBlock(x, y, z) === Block.Air) y--;
  return y;
};
/** A stretch of grass flat for 6 blocks along +x, and the height its mobs stand at. */
function flatGrass(): [number, number, number] {
  for (let z = -20; z < 50; z++) {
    for (let x = -20; x < 50; x++) {
      const y = top(x, z);
      if (world.getBlock(x, y, z) !== Block.Grass) continue;
      let flat = true;
      for (let i = 1; i < 6; i++) flat &&= top(x + i, z) === y && world.getBlock(x + i, y, z) === Block.Grass;
      if (flat) return [x, y + 1, z];
    }
  }
  throw new Error('no flat grass');
}

const saved = { ...TUNING.mobs };
afterEach(() => Object.assign(TUNING.mobs, saved));

describe('hitting mobs', () => {
  it('finds the nearest mob in front within reach, not one behind, beside or too far', () => {
    const near = createMob(1, MobKind.Mossback, 3.5, 0, 0.5, 1);
    const far = createMob(2, MobKind.Mossback, 6.5, 0, 0.5, 2);
    const behind = createMob(3, MobKind.Mossback, -3.5, 0, 0.5, 3);
    const beside = createMob(4, MobKind.Hopper, 2.5, 0, 3.5, 4);
    const mobs = [far, behind, near, beside];
    const eye = { x: 0, y: 0.5, z: 0.5 };
    const east = { x: 1, y: 0, z: 0 };
    const hit = mobOnRay(mobs, eye, east, 5);
    expect(hit?.mob).toBe(near);
    // It enters the near one's box at its west side.
    expect(hit?.distance).toBeCloseTo(3.5 - KINDS[MobKind.Mossback].halfWidth);
    expect(mobOnRay(mobs, eye, east, 2.5)).toBe(null); // out of reach
    expect(mobOnRay([behind, beside], eye, east, 10)).toBe(null);
    // Over its back and under its feet: misses.
    expect(mobOnRay([near], { x: 0, y: 1.2, z: 0.5 }, east, 10)).toBe(null);
    expect(mobOnRay([near], { x: 0, y: -0.1, z: 0.5 }, east, 10)).toBe(null);
  });

  it("can't hit a mob behind a block: the block's distance is the reach", () => {
    const [x, y, z] = flatGrass();
    const mob = createMob(1, MobKind.Mossback, x + 4.5, y, z + 0.5, 1);
    const eye = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    const east = { x: 1, y: 0, z: 0 };
    const reach = TUNING.edit.reach;
    const open = raycast(world, eye, east, reach);
    expect(mobOnRay([mob], eye, east, open ? open.distance : reach)?.mob).toBe(mob);
    world.setBlock(x + 2, y, z, Block.Stone);
    const wall = raycast(world, eye, east, reach);
    expect(wall?.x).toBe(x + 2);
    expect(mobOnRay([mob], eye, east, wall ? wall.distance : reach)).toBe(null);
    world.setBlock(x + 2, y, z, Block.Air);
  });

  it('knocks a mob away and makes it flee; the third hit takes it away in a puff', () => {
    const [x, y, z] = flatGrass();
    const m = new MobManager(world, 1, 0);
    const mob = createMob(1, MobKind.Mossback, x + 3.5, y, z + 0.5, 1);
    m.mobs.push(mob);
    expect(m.hit(mob, x + 0.5, z + 0.5)).toBe(false);
    expect(mob.body.vx).toBeGreaterThan(0); // away from the player, to the east
    expect(mob.body.vy).toBeGreaterThan(0);
    expect(mob.state).toBe('flee');
    expect(m.hit(mob, x + 0.5, z + 0.5)).toBe(false);
    expect(m.mobs).toContain(mob);
    expect(m.hit(mob, x + 0.5, z + 0.5)).toBe(true);
    expect(m.mobs).not.toContain(mob);
    expect(m.before.has(mob)).toBe(false);
    expect(m.takeSounds().map((s) => s.voice)).toEqual(['hurt', 'hurt', 'hurt', 'puff']);
    expect(m.takeSounds()).toEqual([]);
  });
});

describe('mob sounds', () => {
  it('call now and then, each mob in its own time, and not at rest', () => {
    const [x, y, z] = flatGrass();
    const m = new MobManager(world, 2, 0);
    for (let i = 0; i < 3; i++) m.mobs.push(createMob(i + 1, MobKind.Mossback, x + 0.5 + i, y, z + 0.5, i + 1));
    const minute = 60;
    for (let t = 0; t < minute; t += 0.1) m.update(0.1, [[x, z]], 1);
    const calls = m.takeSounds().filter((s) => s.voice === 'call');
    const [lo, hi] = TUNING.mobs.calls;
    // Each calls between a minute / hi and a minute / lo times, give or take the first.
    expect(calls.length).toBeGreaterThanOrEqual(3 * Math.floor(minute / hi));
    expect(calls.length).toBeLessThanOrEqual(3 * Math.ceil(minute / lo + 1));
    for (const mob of m.mobs) mob.state = 'rest';
    m.mobs.forEach((mob) => (mob.timer = Number.POSITIVE_INFINITY));
    for (let t = 0; t < minute; t += 0.1) m.update(0.1, [[x, z]], 0); // night: they stay at rest
    expect(m.takeSounds().filter((s) => s.voice === 'call')).toEqual([]);
  });

  it('thump when a hopper lands', () => {
    const [x, y, z] = flatGrass();
    const m = new MobManager(world, 3, 0);
    const hopper = createMob(1, MobKind.Hopper, x + 0.5, y + 2, z + 0.5, 1);
    hopper.timer = Number.POSITIVE_INFINITY; // idle where it is
    m.mobs.push(hopper);
    for (let t = 0; t < 1; t += 1 / 60) m.update(1 / 60, [[x, z]], 1);
    expect(m.takeSounds().filter((s) => s.voice === 'land').length).toBe(1);
  });

  it('are heard louder nearer, not at all far off, and from their side', () => {
    const H = TUNING.mobs.hearing;
    const close = heard(0, 0, -2, 0, 0, 0, 0)!;
    const mid = heard(0, 0, -H / 2, 0, 0, 0, 0)!;
    expect(close.gain).toBeGreaterThan(mid.gain);
    expect(mid.gain).toBeGreaterThan(0);
    expect(heard(0, 0, -H - 1, 0, 0, 0, 0)).toBe(null);
    expect(close.pan).toBeCloseTo(0); // straight ahead
    // Looking along -z, +x is on the right; turned half round, on the left.
    expect(heard(5, 0, 0, 0, 0, 0, 0)!.pan).toBeGreaterThan(0.5);
    expect(heard(5, 0, 0, 0, 0, 0, Math.PI)!.pan).toBeLessThan(-0.5);
    // Turned a quarter left (yaw π/2 looks along -x), -z is on the right.
    expect(heard(0, 0, -5, 0, 0, 0, Math.PI / 2)!.pan).toBeGreaterThan(0.5);
  });
});

describe('the puff', () => {
  it("comes out of the mob's body and drifts up", () => {
    const p = new Particles(createRng(4));
    p.puff(10.5, 20, 10.5, 0.45, 1, 1);
    expect(p.alive).toBe(TUNING.particles.puffCount);
    const ys: number[] = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (p.life[i] <= 0) continue;
      expect(Math.abs(p.position[i * 3] - 10.5)).toBeLessThanOrEqual(0.45);
      expect(p.position[i * 3 + 1] - 20).toBeGreaterThanOrEqual(0);
      expect(p.position[i * 3 + 1] - 20).toBeLessThanOrEqual(1);
      ys.push(p.position[i * 3 + 1]);
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const before = mean(ys);
    for (let t = 0; t < 0.4; t += 1 / 60) p.step(1 / 60, () => false);
    const after: number[] = [];
    for (let i = 0; i < MAX_PARTICLES; i++) if (p.life[i] > 0) after.push(p.position[i * 3 + 1]);
    expect(mean(after)).toBeGreaterThan(before + 0.2);
  });
});
