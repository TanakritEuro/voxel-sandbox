import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createMob, directContext, goTo, hurt, type Mob, type MobContext, stepBrain } from '../src/mobs/brain';
import { MobKind } from '../src/mobs/kinds';
import { Block } from '../src/world/blocks';
import { Grid } from './grid';

/** Step a mob for `seconds`, calling `each` after every step (stop early when it returns true). */
function run(mob: Mob, ctx: MobContext, seconds: number, each?: (mob: Mob) => boolean | void): void {
  const steps = Math.round(seconds / TUNING.mobs.step);
  for (let i = 0; i < steps; i++) {
    stepBrain(mob, ctx);
    if (each?.(mob)) return;
  }
}

const field = () => new Grid().floor(-30, 30, -30, 30);
const across = (mob: Mob, x: number, z: number) => Math.hypot(mob.body.x - x, mob.body.z - z);

describe('mobs', () => {
  it('wander to a place they found a way to, and idle again', () => {
    const ctx = directContext(field());
    const mob = createMob(1, MobKind.Mossback, 0.5, 1, 0.5, 7);
    mob.timer = 0;
    const states = new Set<string>();
    let lowest = Number.POSITIVE_INFINITY;
    run(mob, ctx, 20, (m) => {
      states.add(m.state);
      lowest = Math.min(lowest, m.body.y);
      return states.has('wander') && m.state === 'idle';
    });
    expect(states.has('wander')).toBe(true);
    expect(mob.state).toBe('idle');
    const d = across(mob, 0.5, 0.5);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(13);
    expect(lowest).toBeGreaterThanOrEqual(1 - 1e-9); // never in the floor
    expect(mob.walked).toBeGreaterThan(3);
  });

  it('jump up a step on the way', () => {
    // Ground at feet 1 for x < 5, a terrace a block higher from x = 5.
    const w = new Grid().floor(-5, 4, -3, 3);
    for (let x = 5; x <= 12; x++) for (let z = -3; z <= 3; z++) w.pillar(x, z, 0, 1);
    const ctx = directContext(w);
    const mob = createMob(1, MobKind.Mossback, 0.5, 1, 0.5, 3);
    expect(goTo(mob, ctx, [9, 2, 0])).toBe(true);
    mob.state = 'wander';
    run(mob, ctx, 10, (m) => m.state === 'idle');
    expect(mob.state).toBe('idle');
    expect(mob.body.y).toBe(2);
    expect(across(mob, 9.5, 0.5)).toBeLessThan(TUNING.mobs.arrive + 0.05);
  });

  it('find another way when a wall goes up in front of them', () => {
    const w = field();
    const ctx = directContext(w);
    const mob = createMob(1, MobKind.Mossback, 0.5, 1, 0.5, 11);
    expect(goTo(mob, ctx, [12, 1, 0])).toBe(true);
    mob.state = 'wander';
    run(mob, ctx, 1);
    // Two blocks high, too tall to climb, right across the way.
    for (let z = -4; z <= 4; z++) w.pillar(6, z, 1, 2);
    run(mob, ctx, 20, (m) => m.state === 'idle');
    expect(mob.state).toBe('idle');
    expect(across(mob, 12.5, 0.5)).toBeLessThan(0.5);
  });

  it('run from a hit, and calm down after a while', () => {
    const ctx = directContext(field());
    const mob = createMob(1, MobKind.Mossback, 0.5, 1, 0.5, 5);
    mob.timer = 1000; // idling: it won't wander off by itself
    const [tx, tz] = [-2, 0.5];
    hurt(mob, tx, tz);
    expect(mob.state).toBe('flee');
    expect(mob.hits).toBe(1);
    run(mob, ctx, TUNING.mobs.fleeSeconds - 0.1);
    expect(across(mob, tx, tz)).toBeGreaterThan(2.5 + 5);
    run(mob, ctx, 0.5);
    expect(mob.state).toBe('idle');
  });

  it('rest at night and stay put, and wake in the morning', () => {
    const ctx = directContext(field(), 0.05);
    const mob = createMob(1, MobKind.Mossback, 0.5, 1, 0.5, 9);
    mob.timer = 0;
    run(mob, ctx, 1);
    expect(mob.state).toBe('rest');
    const [x, z] = [mob.body.x, mob.body.z];
    run(mob, ctx, 10);
    expect([mob.body.x, mob.body.z]).toEqual([x, z]);
    ctx.daylight = 1;
    run(mob, ctx, 0.1);
    expect(mob.state).toBe('idle');
  });

  it('climb what their kind climbs: a crag goat two blocks, a mossback not', () => {
    const w = new Grid().floor(-5, 4, -3, 3);
    for (let x = 5; x <= 12; x++) for (let z = -3; z <= 3; z++) w.pillar(x, z, 0, 2);
    const ctx = directContext(w);
    const moss = createMob(1, MobKind.Mossback, 0.5, 1, 0.5, 1);
    expect(goTo(moss, ctx, [9, 3, 0])).toBe(false);
    const goat = createMob(2, MobKind.CragGoat, 0.5, 1, 0.5, 1);
    expect(goTo(goat, ctx, [9, 3, 0])).toBe(true);
    goat.state = 'wander';
    run(goat, ctx, 10, (m) => m.state === 'idle');
    expect(goat.body.y).toBe(3);
  });

  it('hop when they are hoppers', () => {
    const ctx = directContext(field());
    const mob = createMob(1, MobKind.Hopper, 0.5, 1, 0.5, 2);
    expect(goTo(mob, ctx, [8, 1, 0])).toBe(true);
    mob.state = 'wander';
    let hops = 0;
    let wasOnGround = true;
    run(mob, ctx, 10, (m) => {
      if (wasOnGround && !m.body.onGround && m.body.vy > 0) hops++;
      wasOnGround = m.body.onGround;
      return m.state === 'idle';
    });
    expect(mob.state).toBe('idle');
    expect(hops).toBeGreaterThan(3);
  });

  it('keep their heads above water', () => {
    // A pool three deep: water at y 1..3, its bed at y 0.
    const w = field();
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 1; y <= 3; y++) w.set(x, y, z, Block.Water);
    const ctx = directContext(w);
    const mob = createMob(1, MobKind.Mossback, 0.5, 1, 0.5, 4);
    mob.timer = 1000;
    run(mob, ctx, 5);
    expect(mob.body.inWater).toBe(true);
    // Its head (the top half of it) is out, above the water's top at y 4.
    expect(mob.body.y + mob.body.height).toBeGreaterThan(4.3);
  });

  it('do the same thing every time from the same seed', () => {
    const track = () => {
      const ctx = directContext(field());
      const mob = createMob(1, MobKind.Mossback, 0.5, 1, 0.5, 42);
      const points: number[] = [];
      run(mob, ctx, 30, (m) => void points.push(m.body.x, m.body.z));
      return points;
    };
    expect(track()).toEqual(track());
  });
});
