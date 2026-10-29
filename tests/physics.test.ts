import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { FixedStep } from '../src/math';
import { Block } from '../src/world/blocks';
import { type Body, type BlockSource, createBody, HALF_WIDTH, type MoveInput, moveBody, NO_INPUT, stepPlayer } from '../src/world/physics';

/** Floor top at y = 41: every block at y ≤ 40 is stone. */
const FLOOR = 41;

/** A world made by a function of the block position. */
const worldOf = (block: (x: number, y: number, z: number) => Block): BlockSource => ({ getBlock: block });
const floorAnd = (extra: (x: number, y: number, z: number) => boolean): BlockSource =>
  worldOf((x, y, z) => (y < FLOOR || extra(x, y, z) ? Block.Stone : Block.Air));
const flat = floorAnd(() => false);

/** Facing that makes `forward` point along +x, or +x+z. */
const EAST = -Math.PI / 2;
const SOUTH_EAST = (-3 * Math.PI) / 4;

const input = (over: Partial<MoveInput>): MoveInput => ({ ...NO_INPUT, ...over });

function run(body: Body, world: BlockSource, seconds: number, inp: MoveInput | ((t: number) => MoveInput)): void {
  const step = TUNING.player.step;
  for (let i = 0; i < Math.round(seconds / step); i++) stepPlayer(body, typeof inp === 'function' ? inp(i * step) : inp, world);
}

/** A body standing on the flat floor at (x, z). */
function standing(x: number, z: number, world = flat): Body {
  const body = createBody(x, FLOOR, z);
  run(body, world, 0.1, NO_INPUT);
  return body;
}

describe('falling and landing', () => {
  it('lands exactly on the floor and stays there', () => {
    const body = createBody(0.5, 50, 0.5);
    run(body, flat, 3, NO_INPUT);
    expect(body.y).toBe(FLOOR);
    expect(body.vy).toBe(0);
    expect(body.onGround).toBe(true);
  });

  it('does not tunnel through a one-block floor, however far it moves in a step', () => {
    const thin = worldOf((_x, y) => (y === 40 ? Block.Stone : Block.Air));
    const body = createBody(0.5, 300, 0.5);
    moveBody(body, 0, -1000, 0, thin);
    expect(body.y).toBe(FLOOR);
    const falling = createBody(0.5, 300, 0.5);
    falling.vy = -TUNING.player.terminalVelocity;
    run(falling, thin, 8, NO_INPUT);
    expect(falling.y).toBe(FLOOR);
  });

  it('falls no faster than terminal velocity', () => {
    const body = createBody(0.5, 10_000, 0.5);
    run(body, flat, 5, NO_INPUT);
    expect(body.vy).toBe(-TUNING.player.terminalVelocity);
  });
});

describe('walls', () => {
  const wall = floorAnd((x) => x === 10);

  it('stops the box exactly at the face', () => {
    const body = standing(5.5, 0.5, wall);
    run(body, wall, 3, input({ forward: 1, yaw: EAST }));
    expect(body.x).toBeCloseTo(10 - HALF_WIDTH, 12);
    expect(body.vx).toBe(0);
    expect(body.y).toBe(FLOOR);
  });

  it('slides along a wall walked into at an angle', () => {
    const body = standing(5.5, 0.5, wall);
    run(body, wall, 3, input({ forward: 1, yaw: SOUTH_EAST }));
    expect(body.x).toBeCloseTo(10 - HALF_WIDTH, 12);
    expect(body.vz).toBeCloseTo(TUNING.player.walkSpeed * Math.SQRT1_2, 9);
    expect(body.z).toBeGreaterThan(8);
  });

  it('stops on both axes in an inside corner', () => {
    const corner = floorAnd((x, _y, z) => x === 10 || z === 10);
    const body = standing(5.5, 5.5, corner);
    run(body, corner, 3, input({ forward: 1, yaw: SOUTH_EAST }));
    expect(body.x).toBeCloseTo(10 - HALF_WIDTH, 12);
    expect(body.z).toBeCloseTo(10 - HALF_WIDTH, 12);
  });

  it('fits through a gap one block wide and two high, not one high', () => {
    // A wall at x = 10 with an opening at z = 0, from the floor up `height` blocks.
    const gap = (height: number) => floorAnd((x, y, z) => x === 10 && !(z === 0 && y < FLOOR + height));
    const through = standing(5.5, 0.5, gap(2));
    run(through, gap(2), 3, input({ forward: 1, yaw: EAST }));
    expect(through.x).toBeGreaterThan(12);
    const blocked = standing(5.5, 0.5, gap(1));
    run(blocked, gap(1), 3, input({ forward: 1, yaw: EAST }));
    expect(blocked.x).toBeCloseTo(10 - HALF_WIDTH, 12);
  });
});

describe('jumping', () => {
  it('peaks at the jump height', () => {
    const body = standing(0.5, 0.5);
    let top = body.y;
    run(body, flat, 1, (t) => {
      top = Math.max(top, body.y);
      return input({ jump: t < 0.05 });
    });
    expect(top - FLOOR).toBeGreaterThan(TUNING.player.jumpHeight - 0.02);
    expect(top - FLOOR).toBeLessThanOrEqual(TUNING.player.jumpHeight + 1e-9);
    expect(body.y).toBe(FLOOR);
  });

  it('climbs onto a one-block step but not a two-block one', () => {
    const step = (height: number) => floorAnd((x, y) => x >= 8 && y < FLOOR + height);
    const up = standing(5.5, 0.5, step(1));
    run(up, step(1), 3, input({ forward: 1, yaw: EAST, jump: true }));
    expect(up.x).toBeGreaterThan(9);
    run(up, step(1), 1, NO_INPUT);
    expect(up.y).toBe(FLOOR + 1);
    const stuck = standing(5.5, 0.5, step(2));
    run(stuck, step(2), 3, input({ forward: 1, yaw: EAST, jump: true }));
    run(stuck, step(2), 1, NO_INPUT);
    expect(stuck.x).toBeCloseTo(8 - HALF_WIDTH, 12);
    expect(stuck.y).toBe(FLOOR);
  });

  it('stops rising at a ceiling', () => {
    // Ceiling blocks from y = 43: 2 blocks of room, 0.2 above the head.
    const low = floorAnd((_x, y) => y >= FLOOR + 2);
    const body = standing(0.5, 0.5, low);
    let top = body.y;
    run(body, low, 1, (t) => {
      top = Math.max(top, body.y);
      return input({ jump: t < 0.05 });
    });
    expect(top).toBeCloseTo(FLOOR + 2 - 1.8, 12);
    expect(body.y).toBe(FLOOR);
  });
});

describe('flying', () => {
  it('has no gravity, and collides', () => {
    const roofed = floorAnd((_x, y) => y >= 60);
    const body = createBody(0.5, 50, 0.5);
    run(body, roofed, 1, input({ flying: true }));
    expect(body.y).toBe(50);
    run(body, roofed, 5, input({ flying: true, up: 1 }));
    expect(body.y).toBeCloseTo(60 - 1.8, 12);
    run(body, roofed, 10, input({ flying: true, up: -1 }));
    expect(body.y).toBe(FLOOR);
  });
});

describe('fixed step', () => {
  it('gives the same movement at any frame rate', () => {
    // Input changes on times that are whole frames at every rate tried.
    const schedule = (t: number): MoveInput =>
      t < 0.5
        ? input({ forward: 1, yaw: 0.3 })
        : t < 1
          ? input({ forward: 1, yaw: 0.3, jump: true })
          : t < 1.5
            ? input({ strafe: -1, yaw: 1.1, sprint: true })
            : NO_INPUT;
    const world = floorAnd((x, y, z) => x === 6 && z < 0 && y < FLOOR + 1);
    const results = [30, 60, 144].map((fps) => {
      const body = createBody(0.5, FLOOR, 0.5);
      const clock = new FixedStep(TUNING.player.step);
      let steps = 0;
      for (let frame = 0; frame < 2 * fps; frame++) {
        const inp = schedule(frame / fps);
        const n = clock.advance(1 / fps);
        for (let i = 0; i < n; i++) stepPlayer(body, inp, world);
        steps += n;
      }
      return { body, steps };
    });
    expect(results[0].steps).toBe(240);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('drops the backlog after a long stall and keeps alpha in 0..1', () => {
    const clock = new FixedStep(1 / 120);
    expect(clock.advance(5)).toBe(8);
    expect(clock.advance(0.004)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.48, 9);
    expect(clock.advance(0.005)).toBe(1);
    expect(clock.alpha).toBeGreaterThanOrEqual(0);
    expect(clock.alpha).toBeLessThan(1);
  });
});

describe('crouching', () => {
  // A 5 × 5 platform floating over nothing: blocks x, z in 0..4 at y = 40.
  const platform = worldOf((x, y, z) => (y === 40 && x >= 0 && x <= 4 && z >= 0 && z <= 4 ? Block.Stone : Block.Air));
  const onPlatform = (b: Body) => b.y === FLOOR && b.x - HALF_WIDTH < 5 && b.x + HALF_WIDTH > 0 && b.z - HALF_WIDTH < 5 && b.z + HALF_WIDTH > 0;

  it('stays on the platform walking towards every edge and corner, up to the edge', () => {
    const directions: [string, number, (b: Body) => boolean][] = [
      ['+x', EAST, (b) => b.x > 5 + HALF_WIDTH - 0.02],
      ['-x', Math.PI / 2, (b) => b.x < -HALF_WIDTH + 0.02],
      ['+z', Math.PI, (b) => b.z > 5 + HALF_WIDTH - 0.02],
      ['-z', 0, (b) => b.z < -HALF_WIDTH + 0.02],
      ['corner', SOUTH_EAST, (b) => b.x > 5 + HALF_WIDTH - 0.02 && b.z > 5 + HALF_WIDTH - 0.02],
    ];
    for (const [name, yaw, atEdge] of directions) {
      const body = standing(2.5, 2.5, platform);
      run(body, platform, 6, input({ forward: 1, yaw, crouch: true }));
      expect(onPlatform(body), name).toBe(true);
      expect(atEdge(body), name).toBe(true);
    }
  });

  it('slides along an edge', () => {
    const body = standing(4.5, 0.5, platform);
    run(body, platform, 2, input({ forward: 1, yaw: SOUTH_EAST, crouch: true }));
    expect(body.x).toBeGreaterThan(5 + HALF_WIDTH - 0.02);
    expect(body.z).toBeGreaterThan(1.5);
    expect(body.z).toBeLessThan(3);
    expect(onPlatform(body)).toBe(true);
  });

  it('walks off without crouching, and crouches at crouching speed', () => {
    const body = standing(2.5, 2.5, platform);
    run(body, platform, 3, input({ forward: 1, yaw: EAST }));
    expect(body.y).toBeLessThan(FLOOR - 5);
    const slow = standing(0.5, 0.5);
    run(slow, flat, 1, input({ forward: 1, yaw: EAST, crouch: true }));
    expect(slow.vx).toBeCloseTo(TUNING.player.crouchSpeed, 9);
  });
});

describe('swimming', () => {
  // A pool: floor top at 30, water up to 41 (blocks 30..40) for x < 10, a bank at x ≥ 10 whose top is 42.
  const SURFACE = 41;
  const pool = worldOf((x, y) => (y < 30 || (x >= 10 && y < SURFACE + 1) ? Block.Stone : y < SURFACE ? Block.Water : Block.Air));
  const swim = TUNING.player.swim;

  it('sinks slowly to the bottom', () => {
    const body = createBody(5.5, 38, 0.5);
    run(body, pool, 1, NO_INPUT);
    expect(body.inWater).toBe(true);
    expect(body.vy).toBeGreaterThanOrEqual(-swim.maxSink - 1e-9);
    run(body, pool, 10, NO_INPUT);
    expect(body.y).toBe(30);
  });

  it('is slowed down by the water when falling in', () => {
    const body = createBody(5.5, 70, 0.5);
    let wet = 0;
    run(body, pool, 6, () => {
      if (body.inWater) wet += TUNING.player.step;
      if (wet > 1.5) expect(body.vy).toBeGreaterThan(-swim.maxSink - 0.5);
      return NO_INPUT;
    });
    expect(body.y).toBe(30);
  });

  it('swims up to the surface and bobs there with Space held', () => {
    const body = createBody(5.5, 30, 0.5);
    let low = Infinity;
    let high = -Infinity;
    run(body, pool, 8, (t) => {
      if (t > 6) {
        low = Math.min(low, body.y);
        high = Math.max(high, body.y);
      }
      return input({ jump: true });
    });
    expect(high).toBeGreaterThan(SURFACE - 0.1);
    expect(high).toBeLessThan(SURFACE + 0.7);
    expect(low).toBeGreaterThan(SURFACE - 1.5);
  });

  it('climbs out onto a bank one block above the water', () => {
    const body = createBody(7.5, 36, 0.5);
    run(body, pool, 5, input({ forward: 1, yaw: EAST, jump: true }));
    run(body, pool, 1, NO_INPUT);
    expect(body.x).toBeGreaterThan(10);
    expect(body.y).toBe(SURFACE + 1);
    expect(body.inWater).toBe(false);
  });
});

describe('bodies of other sizes', () => {
  // A tunnel along +x from x = 3: one block high (a roof at FLOOR + 1) and one block wide (walls at z = -1 and 1).
  const tunnel = floorAnd((x, y, z) => x >= 3 && (y === FLOOR + 1 || z === -1 || z === 1));

  it('fit where they are small enough, and are stopped where they are not', () => {
    // The player (1.8 high) stops at the tunnel's mouth; a half-block-high mob goes in.
    const player = createBody(1.5, FLOOR, 0.5);
    moveBody(player, 5, 0, 0, tunnel);
    expect(player.x).toBe(3 - HALF_WIDTH);
    const small = createBody(1.5, FLOOR, 0.5, 0.25, 0.5);
    moveBody(small, 5, 0, 0, tunnel);
    expect(small.x).toBe(6.5);
    // Wider than the tunnel: stopped at its mouth too, against the walls' ends.
    const wide = createBody(1.5, FLOOR, 0.5, 0.6, 0.5);
    moveBody(wide, 5, 0, 0, tunnel);
    expect(wide.x).toBe(3 - 0.6);
  });

  it('stand, fall and land by their own height', () => {
    const body = createBody(0.5, 50, 0.5, 0.25, 0.5);
    run(body, flat, 3, NO_INPUT);
    expect(body.y).toBe(FLOOR);
    expect(body.onGround).toBe(true);
    // A low ceiling stops a short body's jump later than the player's.
    const roof = floorAnd((_x, y) => y === FLOOR + 1);
    const short = createBody(0.5, FLOOR, 0.5, 0.25, 0.5);
    moveBody(short, 0, 0.6, 0, roof);
    expect(short.y).toBeCloseTo(FLOOR + 0.5);
  });
});
