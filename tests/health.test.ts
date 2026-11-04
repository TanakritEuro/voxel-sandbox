import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { type Condition, Health } from '../src/survival/health';
import { Block } from '../src/world/blocks';
import { createBody, NO_INPUT, stepPlayer, touches } from '../src/world/physics';
import { Grid } from './grid';

const S = TUNING.survival;
/** Standing still on dry land, nothing touching. */
const STILL: Condition = { y: 1, onGround: true, inWater: false, flying: false, eyeInWater: false, touchingCactus: false };

/**
 * A body let go with its feet `height` above a stone floor at y 1 (or into water `water` deep
 * over it), run through the real physics at its fixed step, health stepped every frame of 60 a
 * second. Returns the points lost.
 */
function drop(height: number, water = 0): number {
  const world = new Grid().floor(-3, 3, -3, 3, 1);
  for (let y = 1; y <= water; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) world.set(x, y, z, Block.Water);
  const body = createBody(0.5, 1 + height, 0.5);
  const health = new Health();
  // Standing on a ledge that's gone this frame.
  health.step(1 / 60, { ...STILL, y: body.y });
  let lost = 0;
  const steps = Math.round(1 / 60 / TUNING.player.step);
  for (let frame = 0; frame < 60 * 6; frame++) {
    for (let i = 0; i < steps; i++) stepPlayer(body, NO_INPUT, world);
    lost += health.step(1 / 60, { ...STILL, y: body.y, onGround: body.onGround, inWater: body.inWater });
  }
  expect(body.onGround).toBe(true);
  return lost;
}

describe('health', () => {
  it('costs nothing for a fall of 3 blocks, a point a block beyond: 1 for 4, 7 for 10', () => {
    expect([drop(1), drop(3), drop(4), drop(10)]).toEqual([0, 0, 1, 7]);
  });

  it('costs nothing falling into water', () => {
    expect(drop(10, 3)).toBe(0);
  });

  it('runs out of air after 10 s under water, then costs a point a second; air comes back above', () => {
    const health = new Health();
    const under = { ...STILL, eyeInWater: true };
    let lost = 0;
    for (let t = 0; t < 9.9 * 60; t++) lost += health.step(1 / 60, under);
    expect(lost).toBe(0);
    expect(health.air).toBeCloseTo(0.1, 1);
    for (let t = 0; t < 5.2 * 60; t++) lost += health.step(1 / 60, under);
    expect(lost).toBe(5);
    expect(health.cause).toBe('drowning');
    for (let t = 0; t < 2 * 60; t++) health.step(1 / 60, STILL);
    expect(health.air).toBe(S.air);
  });

  it('costs a point at once on touching a cactus, then one every half second', () => {
    const health = new Health();
    const prickly = { ...STILL, touchingCactus: true };
    expect(health.step(1 / 60, prickly)).toBe(1);
    let lost = 0;
    for (let t = 1; t < 60; t++) lost += health.step(1 / 60, prickly);
    expect(lost).toBe(1); // one more at half a second; the next at a second
    expect(health.cause).toBe('cactus');
  });

  it('heals a point every 4 s from 5 s after the last hurt, up to full', () => {
    const health = new Health();
    health.step(1 / 60, { ...STILL, touchingCactus: true });
    health.step(1 / 60, STILL);
    expect(health.health).toBe(19);
    const run = (seconds: number) => {
      for (let t = 0; t < seconds * 60; t++) health.step(1 / 60, STILL);
    };
    run(8.9);
    expect(health.health).toBe(19);
    run(0.2);
    expect(health.health).toBe(20);
    run(30);
    expect(health.health).toBe(20);
  });

  it('is death at 0, which a reset makes full again', () => {
    const health = new Health();
    health.health = 1;
    expect(health.dead).toBe(false);
    health.step(1 / 60, { ...STILL, touchingCactus: true });
    expect(health.dead).toBe(true);
    // Dead, it doesn't heal on its own.
    for (let t = 0; t < 20 * 60; t++) health.step(1 / 60, STILL);
    expect(health.health).toBe(0);
    health.reset();
    expect([health.health, health.air, health.dead, health.cause]).toEqual([S.maxHealth, S.air, false, null]);
  });

  it('loads as saved, a broken or dead save as full', () => {
    const health = new Health();
    health.health = 7;
    health.air = 3.5;
    expect(Health.from(JSON.parse(JSON.stringify(health))).toJSON()).toEqual({ health: 7, air: 3.5 });
    expect(Health.from({ health: 0, air: 50 }).toJSON()).toEqual({ health: S.maxHealth, air: S.air });
    expect(Health.from('full').toJSON()).toEqual({ health: S.maxHealth, air: S.air });
  });
});

describe('touching a block', () => {
  it('feels a cactus beside, under or over the body, not one a block away', () => {
    const body = createBody(0.5, 1, 0.5);
    const at = (x: number, y: number, z: number) => touches(body, new Grid().set(x, y, z, Block.Cactus), Block.Cactus);
    // Standing in (0, 1, 0), the box 0.2 to 0.8 across: beside means a block whose face is 0.2 away.
    body.x = 0.25; // 0.05 from the face at x 0, the cactus at x -1
    expect(at(-1, 1, 0)).toBe(true);
    expect(at(-2, 1, 0)).toBe(false);
    expect(at(0, 0, 0)).toBe(true); // under the feet
    expect(at(0, 3, 0)).toBe(false); // above a 1.8 tall head with room
    body.x = 0.5;
    expect(at(-1, 1, 0)).toBe(false); // 0.2 away
  });
});
