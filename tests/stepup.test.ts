import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { bed, Block, slab, stairs } from '../src/world/blocks';
import { type BlockSource, createBody, type MoveInput, NO_INPUT, stepMob, stepPlayer } from '../src/world/physics';
import { Grid } from './grid';

/** Looking along +x. */
const EAST = -Math.PI / 2;
const walk = (over: Partial<MoveInput> = {}): MoveInput => ({ ...NO_INPUT, forward: 1, yaw: EAST, ...over });

/** A player standing at (x, 1, 0.5) on a stone floor, settled. */
function standing(world: BlockSource, x = -2.5) {
  const body = createBody(x, 1, 0.5);
  for (let i = 0; i < 20; i++) stepPlayer(body, NO_INPUT, world);
  return body;
}

/** `seconds` of `input`, a physics step at a time. */
function run(body: ReturnType<typeof createBody>, world: BlockSource, seconds: number, input: MoveInput): void {
  for (let i = 0; i < Math.round(seconds / TUNING.player.step); i++) stepPlayer(body, input, world);
}

describe('stepping up', () => {
  it('walks onto a slab without jumping, and on along it', () => {
    const g = new Grid().floor(-5, 10, -5, 5);
    for (let x = 0; x < 5; x++) g.set(x, 1, 0, slab(0, false));
    const body = standing(g);
    run(body, g, 1.5, walk());
    expect(body.x).toBeGreaterThan(1);
    expect(body.y).toBeCloseTo(1.5, 6);
    expect(body.onGround).toBe(true);
  });

  it('walks up a flight of stairs, a block for each', () => {
    const g = new Grid().floor(-5, 10, -5, 5);
    for (let s = 0; s < 4; s++) {
      g.set(s, 1 + s, 0, stairs(0, 0, false));
      for (let y = 1; y < 1 + s; y++) g.set(s, y, 0, Block.Stone);
    }
    // A landing at the top, 4 high, and walls either side, so it goes straight up.
    for (let x = 4; x < 10; x++) g.pillar(x, 0, 1, 4);
    for (let x = -5; x < 10; x++) g.pillar(x, 1, 1, 6).pillar(x, -1, 1, 6);
    const body = standing(g);
    run(body, g, 3, walk());
    expect(body.x).toBeGreaterThan(3);
    expect(body.y).toBeCloseTo(5, 6);
  });

  it('walks onto a bed too, but not up a whole block, and not crouching', () => {
    const bedWorld = new Grid().floor(-5, 10, -5, 5).set(0, 1, 0, bed(0, false)).set(1, 1, 0, bed(0, true));
    const onBed = standing(bedWorld);
    run(onBed, bedWorld, 1, walk());
    expect(onBed.y).toBeCloseTo(1.5, 6);
    const wall = new Grid().floor(-5, 10, -5, 5).set(0, 1, 0, Block.Stone);
    const stopped = standing(wall);
    run(stopped, wall, 2, walk());
    expect(stopped.x).toBeCloseTo(-0.3, 6);
    expect(stopped.y).toBeCloseTo(1, 6);
    const slabbed = new Grid().floor(-5, 10, -5, 5).set(0, 1, 0, slab(0, false));
    const crouched = standing(slabbed);
    run(crouched, slabbed, 4, walk({ crouch: true }));
    expect(crouched.x).toBeCloseTo(-0.3, 6);
    expect(crouched.y).toBeCloseTo(1, 6);
  });

  it("doesn't step up with no room for its head", () => {
    // A slab ahead, and a ceiling 2 above the floor: room to stand on the floor (1.8), not half a block up.
    const g = new Grid().floor(-5, 10, -5, 5).set(0, 1, 0, slab(0, false));
    for (let x = -3; x <= 2; x++) g.set(x, 3, 0, Block.Stone);
    const body = standing(g);
    run(body, g, 2, walk());
    expect(body.x).toBeCloseTo(-0.3, 6);
    expect(body.y).toBeCloseTo(1, 6);
  });

  it("doesn't climb in the air", () => {
    // Falling past a slab's edge: it doesn't catch onto it.
    const g = new Grid().floor(-5, 10, -5, 5).set(0, 5, 0, slab(0, false));
    const body = createBody(-0.5, 5.1, 0.5);
    body.onGround = false;
    stepPlayer(body, walk(), g);
    for (let i = 0; i < 30; i++) stepPlayer(body, walk(), g);
    expect(body.y).toBeLessThan(5);
  });

  it('lets a mob step up a slab as the player does', () => {
    const g = new Grid().floor(-5, 10, -5, 5);
    for (let x = 0; x < 9; x++) g.set(x, 1, 0, slab(0, false));
    const body = createBody(-2.5, 1, 0.5, 0.3, 0.9);
    for (let i = 0; i < 20; i++) stepMob(body, { vx: 0, vz: 0, jump: false, jumpHeight: 0 }, g);
    for (let i = 0; i < Math.round(3 / TUNING.mobs.step); i++) stepMob(body, { vx: 2, vz: 0, jump: false, jumpHeight: 0 }, g);
    expect(body.x).toBeGreaterThan(0.5);
    expect(body.y).toBeCloseTo(1.5, 6);
  });
});
