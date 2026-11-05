import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { type Condition, Health } from '../src/survival/health';
import { SMELTS } from '../src/survival/furnace';
import { foodOf, Item } from '../src/survival/items';
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
    health.hunger = 9;
    expect(Health.from(JSON.parse(JSON.stringify(health))).toJSON()).toEqual({ health: 7, air: 3.5, hunger: 9 });
    expect(Health.from({ health: 0, air: 50, hunger: 21 }).toJSON()).toEqual({ health: S.maxHealth, air: S.air, hunger: S.maxHunger });
    expect(Health.from('full').toJSON()).toEqual({ health: S.maxHealth, air: S.air, hunger: S.maxHunger });
    // From before hunger: full.
    expect(Health.from({ health: 7, air: 3.5 }).hunger).toBe(S.maxHunger);
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

describe('hunger', () => {
  const minutes = (h: Health, m: number, c: Partial<Condition> = {}) => {
    for (let t = 0; t < m * 60 * 60; t++) h.step(1 / 60, { ...STILL, ...c });
  };

  it('goes down a point a minute standing, faster sprinting, swimming or digging', () => {
    const still = new Health();
    minutes(still, 10);
    expect(still.hunger).toBe(S.maxHunger - 10);
    const sprint = new Health();
    minutes(sprint, 1, { sprinting: true });
    expect(sprint.hunger).toBe(S.maxHunger - 4);
    const hard = new Health();
    minutes(hard, 2, { sprinting: true, swimming: true, digging: true });
    expect(hard.hunger).toBe(S.maxHunger - Math.floor(2 * (S.hungerBase + S.hungerSprint + S.hungerSwim + S.hungerDig)));
  });

  it('lets health come back only well fed, at a cost', () => {
    const lean = new Health();
    lean.health = 10;
    lean.hunger = S.healHunger - 1;
    minutes(lean, 0.5);
    expect(lean.health).toBe(10);
    const fed = new Health();
    fed.health = 14;
    minutes(fed, 0.5); // 5 s wait, then a point every 4 s: 6 points in 30 s
    expect(fed.health).toBe(20);
    // 6 points healed at half a point each, and half a minute standing.
    expect(fed.hunger).toBe(S.maxHunger - 3);
  });

  it('starving costs a point every 4 s, down to 1 and no further', () => {
    const h = new Health();
    h.health = 5;
    h.hunger = 0;
    for (let t = 0; t < 4.05 * 60; t++) h.step(1 / 60, STILL);
    expect(h.health).toBe(4);
    expect(h.cause).toBe('starving');
    minutes(h, 1);
    expect(h.health).toBe(1);
    expect(h.dead).toBe(false);
  });

  it('comes back eating, as much as the food gives, and not when full', () => {
    const h = new Health();
    expect(h.eat(foodOf(Item.CookedMeat))).toBe(false);
    h.hunger = 5;
    expect(h.eat(foodOf(Item.RawMeat))).toBe(true);
    expect(h.hunger).toBe(8);
    expect(h.eat(foodOf(Item.CookedMeat))).toBe(true);
    expect(h.hunger).toBe(16);
    expect(h.eat(foodOf(Item.Berries))).toBe(true);
    expect(h.eat(foodOf(Item.CookedMeat))).toBe(true);
    expect(h.hunger).toBe(S.maxHunger);
    h.reset();
    h.hunger = 3;
    h.reset();
    expect(h.hunger).toBe(S.maxHunger);
  });

  it('food is meat, raw or cooked in the furnace, and berries; nothing else is eaten', () => {
    expect([foodOf(Item.RawMeat), foodOf(Item.CookedMeat), foodOf(Item.Berries)]).toEqual([3, 8, 2]);
    expect(foodOf(Item.Coal)).toBe(0);
    expect(foodOf(Block.Dirt)).toBe(0);
    expect(foodOf(undefined)).toBe(0);
    expect(SMELTS.get(Item.RawMeat)).toBe(Item.CookedMeat);
  });
});
