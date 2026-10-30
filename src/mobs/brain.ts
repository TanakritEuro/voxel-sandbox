// What a mob does: a small state machine, stepped with its body at a fixed rate. Pure: blocks,
// daylight and paths come in through a `MobContext`, randomness from the mob's own seeded RNG,
// so a test replays a mob exactly.
//
//   idle    stands, grazes and looks about for a while, then picks a place to wander to;
//   wander  walks a path (A*, `pathfind.ts`) to a spot 4–12 blocks away, then idles again;
//   flee    after a hit: knocked back, then runs from where the hit came from for a few seconds;
//   rest    at night: lies down and stays put until morning.
//
// Following a path: steer at the next waypoint's middle, jump when it's higher, on to the next
// within `arrive`. No closer to it for `stuckSeconds` (a block placed in the way, another mob):
// ask for a way to the same goal again; none: give up and idle.

import { TUNING } from '../config';
import { createRng, type Rng } from '../math';
import { BLOCKS } from '../world/blocks';
import { type BlockSource, type Body, createBody, stepMob } from '../world/physics';
import { headroom, KINDS, type MobKind } from './kinds';
import { findPath, type Path, type PathOptions } from './pathfind';

export type MobState = 'idle' | 'wander' | 'flee' | 'rest';

export interface Mob {
  readonly id: number;
  readonly kind: MobKind;
  readonly body: Body;
  /** Facing, radians; 0 looks along -z, as the camera does. */
  yaw: number;
  state: MobState;
  /** Seconds left idling or fleeing. */
  timer: number;
  /** The way it's going and the index of the next waypoint in it. */
  path: Path | null;
  next: number;
  /** Where the path was asked to go, and how near will do (to ask again when stuck). */
  goal: [number, number, number] | null;
  near: number;
  /** Getting stuck: the closest it has been to the waypoint, and seconds since it got closer. */
  best: number;
  sinceBest: number;
  /** Where a hit came from (it flees from there). */
  threat: { x: number; z: number } | null;
  /** Ground covered, for the walk animation; seconds since the last hit, for the flash. */
  walked: number;
  sinceHurt: number;
  hits: number;
  readonly rng: Rng;
}

/** What a mob reads from the world. */
export interface MobContext {
  blocks: BlockSource;
  /** Daylight, 0 at night to 1 at noon (`render/sky.ts`). */
  daylight: number;
  /** A way from start to goal for this mob: the path, null for none, or undefined to ask again later (the search budget is used up). */
  findPath(mob: Mob, start: [number, number, number], goal: [number, number, number], near: number): Path | null | undefined;
}

/** The pathfinder's options for a kind. */
export function pathOptions(kind: MobKind, near: number): Partial<PathOptions> {
  const k = KINDS[kind];
  return { height: headroom(k), step: k.step, drop: k.drop, swim: k.swim, maxNodes: k.maxNodes, near };
}

/** A context that searches at once, with no budget (tests, and the game's own wraps this). */
export function directContext(blocks: BlockSource, daylight = 1): MobContext {
  return { blocks, daylight, findPath: (mob, start, goal, near) => findPath(blocks, start, goal, pathOptions(mob.kind, near)).path };
}

export function createMob(id: number, kind: MobKind, x: number, y: number, z: number, seed: number): Mob {
  const k = KINDS[kind];
  const rng = createRng(seed);
  return {
    id,
    kind,
    body: createBody(x, y, z, k.halfWidth, k.height),
    yaw: rng() * 2 * Math.PI,
    state: 'idle',
    timer: rng() * TUNING.mobs.idle[1],
    path: null,
    next: 0,
    goal: null,
    near: 0,
    best: Number.POSITIVE_INFINITY,
    sinceBest: 0,
    threat: null,
    walked: 0,
    sinceHurt: Number.POSITIVE_INFINITY,
    hits: 0,
    rng,
  };
}

/** The block its feet are in. */
const feet = (mob: Mob): [number, number, number] => [Math.floor(mob.body.x), Math.floor(mob.body.y + 0.01), Math.floor(mob.body.z)];

const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * rng();

/** Hit from (x, z): knocked away and up, then it flees. */
export function hurt(mob: Mob, fromX: number, fromZ: number): void {
  const b = mob.body;
  const dx = b.x - fromX;
  const dz = b.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  b.vx = (dx / d) * 6;
  b.vz = (dz / d) * 6;
  b.vy = 5;
  b.onGround = false;
  mob.hits++;
  mob.sinceHurt = 0;
  mob.threat = { x: fromX, z: fromZ };
  mob.state = 'flee';
  mob.timer = TUNING.mobs.fleeSeconds;
  mob.path = null;
  mob.goal = null;
}

/** Send the mob along a path to `goal` (within `near`); false if there's none (or it must wait). */
export function goTo(mob: Mob, ctx: MobContext, goal: [number, number, number], near = 0): boolean {
  const path = ctx.findPath(mob, feet(mob), goal, near);
  if (!path) return false;
  mob.path = path;
  mob.next = 0;
  mob.goal = goal;
  mob.near = near;
  mob.best = Number.POSITIVE_INFINITY;
  mob.sinceBest = 0;
  return true;
}

/** Where feet can stand in column (x, z) within a few blocks of height y, or null. */
function standingAt(blocks: BlockSource, x: number, z: number, y: number, height: number): number | null {
  for (let ny = y + 4; ny >= y - 6; ny--) {
    const below = BLOCKS[blocks.getBlock(x, ny - 1, z)];
    if (below.passable) continue;
    let room = true;
    for (let i = 0; i < height && room; i++) {
      const b = BLOCKS[blocks.getBlock(x, ny + i, z)];
      room = b.passable && !b.liquid;
    }
    if (room) return ny;
  }
  return null;
}

/** A place a direction and distance away to wander or flee to, if one stands there. */
function placeToward(mob: Mob, ctx: MobContext, angle: number, distance: number): [number, number, number] | null {
  const b = mob.body;
  const x = Math.floor(b.x + Math.sin(angle) * distance);
  const z = Math.floor(b.z + Math.cos(angle) * distance);
  const y = standingAt(ctx.blocks, x, z, Math.floor(b.y + 0.01), headroom(KINDS[mob.kind]));
  return y === null ? null : [x, y, z];
}

/** One step of thinking and moving. */
export function stepBrain(mob: Mob, ctx: MobContext, dt = TUNING.mobs.step): void {
  const M = TUNING.mobs;
  const k = KINDS[mob.kind];
  const b = mob.body;
  mob.sinceHurt += dt;

  // Night: rest (unless running from something); morning: wake up.
  if (ctx.daylight < M.rest && mob.state !== 'flee' && mob.state !== 'rest') {
    mob.state = 'rest';
    mob.path = null;
  } else if (mob.state === 'rest' && ctx.daylight > M.wake) {
    mob.state = 'idle';
    mob.timer = between(mob.rng, [0.5, 3]);
  }

  let speed = 0;
  if (mob.state === 'idle') {
    mob.timer -= dt;
    if (mob.timer <= 0) {
      const goal = placeToward(mob, ctx, mob.rng() * 2 * Math.PI, between(mob.rng, M.wander));
      const found = goal ? goTo(mob, ctx, goal, 0) : false;
      if (found) mob.state = 'wander';
      // No way there: look about a little longer, then try another place.
      else mob.timer = 0.5 + mob.rng();
    }
  } else if (mob.state === 'flee') {
    mob.timer -= dt;
    if (mob.timer <= 0) {
      mob.state = 'idle';
      mob.timer = between(mob.rng, M.idle);
      mob.path = null;
      mob.threat = null;
    } else {
      speed = k.runSpeed;
      if (!mob.path && mob.threat) {
        // Away from the threat, give or take a little.
        const away = Math.atan2(b.x - mob.threat.x, b.z - mob.threat.z) + (mob.rng() - 0.5) * 1.2;
        const goal = placeToward(mob, ctx, away, M.fleeDistance);
        if (!goal || !goTo(mob, ctx, goal, 3)) {
          // Nowhere found: run straight away and hope.
          mob.path = null;
          return moveAndTurn(mob, ctx, Math.sin(away) * speed, Math.cos(away) * speed, false, dt);
        }
      }
    }
  } else if (mob.state === 'wander') {
    speed = k.walkSpeed;
  }

  let vx = 0;
  let vz = 0;
  let jump = false;
  if ((mob.state === 'wander' || mob.state === 'flee') && mob.path) {
    const w = mob.path[mob.next];
    const dx = w[0] + 0.5 - b.x;
    const dz = w[2] + 0.5 - b.z;
    const d = Math.hypot(dx, dz);
    if (d < M.arrive && b.y > w[1] - 0.5) {
      mob.next++;
      mob.best = Number.POSITIVE_INFINITY;
      mob.sinceBest = 0;
      if (mob.next >= mob.path.length) {
        mob.path = null;
        if (mob.state === 'wander') {
          mob.state = 'idle';
          mob.timer = between(mob.rng, M.idle);
        }
      }
    } else {
      vx = (dx / d) * speed;
      vz = (dz / d) * speed;
      // Up a step: jump once close to it.
      jump = w[1] > Math.floor(b.y + 0.01) && d < 1.3;
      if (d < mob.best - 0.05) {
        mob.best = d;
        mob.sinceBest = 0;
      } else if ((mob.sinceBest += dt) > M.stuckSeconds) {
        // Stuck: a new way to the same place, or give up.
        const goal = mob.goal;
        mob.path = null;
        if (!goal || !goTo(mob, ctx, goal, mob.near)) {
          if (mob.state === 'wander') {
            mob.state = 'idle';
            mob.timer = 0.5 + mob.rng();
          }
        }
      }
    }
  }
  moveAndTurn(mob, ctx, vx, vz, jump, dt);
}

function moveAndTurn(mob: Mob, ctx: MobContext, vx: number, vz: number, jump: boolean, dt: number): void {
  const k = KINDS[mob.kind];
  const b = mob.body;
  const moving = vx !== 0 || vz !== 0;
  const x0 = b.x;
  const z0 = b.z;
  stepMob(b, { vx, vz, jump: jump || (k.hops && moving), jumpHeight: k.hops && !jump ? 0.6 : k.jumpHeight }, ctx.blocks, dt);
  mob.walked += Math.hypot(b.x - x0, b.z - z0);
  if (moving) {
    // Turn towards where it's going, at most turnSpeed a second.
    const want = Math.atan2(-vx, -vz);
    let turn = want - mob.yaw;
    turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
    const most = TUNING.mobs.turnSpeed * dt;
    mob.yaw += Math.max(-most, Math.min(most, turn));
  }
}
