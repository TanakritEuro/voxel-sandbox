// What a mob does: a small state machine, stepped with its body at a fixed rate. Pure: blocks,
// daylight and paths come in through a `MobContext`, randomness from the mob's own seeded RNG,
// so a test replays a mob exactly.
//
//   idle    stands, grazes and looks about for a while, then picks a place to wander to;
//   wander  walks a path (A*, `pathfind.ts`) to a spot 4–12 blocks away, then idles again;
//   flee    after a hit: knocked back, then runs from where the hit came from for a few seconds;
//   rest    at night: lies down and stays put until morning.
//   hunt    a hostile kind (`KindInfo.hostile`) that sees a player within its sight: paths to them,
//           asking for the way again every second or when they've moved off, and hits them every
//           so often (its kind's `hostile.every`) when within reach. It never rests or flees; a
//           hit knocks it back a little.
//   court   a kept animal in love paired with a mate (`mobs.ts` pairs them, and makes the young one
//           when they meet): paths to the mate, asking again every second; straight at it with no way.
//
// A young one (`grow` above 0) is smaller, by its age (`sizeOf`), its box growing with it where there's
// room; it walks and runs faster, and idling far from its `lead` (a grown one of its kind, chosen by
// the manager) it goes back to it.
//
// Following a path: steer at the next waypoint's middle, jump when it's higher, on to the next
// within `arrive`. No closer to it for `stuckSeconds` (a block placed in the way, another mob):
// ask for a way to the same goal again; none: give up and idle.

import { TUNING } from '../config';
import { createRng, type Rng } from '../math';
import { BLOCKS } from '../world/blocks';
import { type BlockSource, type Body, createBody, HALF_WIDTH, HEIGHT, stepMob } from '../world/physics';
import { headroom, KINDS, type MobKind } from './kinds';
import { type FolkHome, stepFolk } from './folk';
import { findPath, type Path, type PathOptions } from './pathfind';

// The hearthfolk (Milestone 22) think in `folk.ts`: by day they wander round their settlement, turn to a
// player who comes near (greet) and run from hostile mobs; at dusk they walk home (home) and lie in bed
// (sleep) until morning. They can't be hurt.

export type MobState = 'idle' | 'wander' | 'flee' | 'rest' | 'hunt' | 'court' | 'sleep' | 'home' | 'greet';

/** A player a hostile mob can hunt: where their feet are. */
export interface Prey {
  x: number;
  y: number;
  z: number;
}

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
  /** Points of hitting taken (it goes at its kind's `health`). */
  hits: number;
  /** Hunting: the player (an index into the prey) and seconds until it may hit again. */
  target: number;
  cooldown: number;
  /** Fed by a player, and so theirs (`kept.ts`): never despawned, saved. */
  kept: boolean;
  /** Seconds left growing up (0: grown), and before it may breed again. */
  grow: number;
  wait: number;
  /** Seconds left in love, and the mate it's courting (paired by the manager). */
  love: number;
  mate: Mob | null;
  /** A young one's grown one to stay near. */
  lead: Mob | null;
  /** The hearthfolk: where it lives (null for any other kind, or a showcased one). */
  home: FolkHome | null;
  /** The hearthfolk: seconds since it last greeted anyone, and whether it has turned to the player near it now. */
  greeted: number;
  noticed: boolean;
  readonly rng: Rng;
}

/** What a mob reads from the world. */
export interface MobContext {
  blocks: BlockSource;
  /** Daylight, 0 at night to 1 at noon (`render/sky.ts`). */
  daylight: number;
  /** A way from start to goal for this mob: the path, null for none, or undefined to ask again later (the search budget is used up). */
  findPath(mob: Mob, start: [number, number, number], goal: [number, number, number], near: number): Path | null | undefined;
  /** The players a hostile mob may hunt (none: it wanders). */
  prey?: readonly Prey[];
  /** A hostile mob hits player `target` (an index into `prey`). */
  attack?(mob: Mob, target: number): void;
  /** Every player (the hearthfolk turn to them), whatever the mode. */
  players?: readonly Prey[];
  /** Where the hostile mobs are (the hearthfolk run from them). */
  dangers?: readonly Prey[];
  /** One of the hearthfolk greets a player. */
  greet?(mob: Mob): void;
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
    target: -1,
    cooldown: 0,
    kept: false,
    grow: 0,
    wait: 0,
    love: 0,
    mate: null,
    lead: null,
    home: null,
    greeted: Number.POSITIVE_INFINITY,
    noticed: false,
    rng,
  };
}

/** How big a mob is drawn and bumps, of its kind's size: half when born, whole when grown. */
export function sizeOf(mob: Mob): number {
  return mob.grow > 0 ? 1 - 0.5 * Math.min(1, mob.grow / TUNING.mobs.breeding.grow) : 1;
}

/** Its box made its size now (a guest's mirror, or a young one born or loaded). */
export function fitBody(mob: Mob): void {
  const k = KINDS[mob.kind];
  const s = sizeOf(mob);
  mob.body.halfWidth = k.halfWidth * s;
  mob.body.height = k.height * s;
}

/** A young one's box grows with it, but only where it fits (not into a wall or a ceiling). */
function grow(mob: Mob, blocks: BlockSource): void {
  const k = KINDS[mob.kind];
  const s = sizeOf(mob);
  const b = mob.body;
  const w = k.halfWidth * s;
  const h = k.height * s;
  if (w <= b.halfWidth && h <= b.height) {
    b.halfWidth = w;
    b.height = h;
    return;
  }
  const e = 1e-3;
  for (let y = Math.floor(b.y + e); y <= Math.floor(b.y + h - e); y++)
    for (let z = Math.floor(b.z - w + e); z <= Math.floor(b.z + w - e); z++)
      for (let x = Math.floor(b.x - w + e); x <= Math.floor(b.x + w - e); x++) if (!BLOCKS[blocks.getBlock(x, y, z)].passable) return;
  b.halfWidth = w;
  b.height = h;
}

/** The block its feet are in. */
export const feet = (mob: Mob): [number, number, number] => [Math.floor(mob.body.x), Math.floor(mob.body.y + 0.01), Math.floor(mob.body.z)];

export const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * rng();

/** Hit from (x, z) for `points`: knocked away and up, then it flees (a hostile one, knocked back less, comes on again). */
export function hurt(mob: Mob, fromX: number, fromZ: number, points = 1): void {
  const b = mob.body;
  // The hearthfolk can't be hurt: a step back (none in bed), nothing else.
  if (KINDS[mob.kind].folk) {
    mob.sinceHurt = 0;
    if (mob.state === 'sleep') return;
    const d = Math.hypot(b.x - fromX, b.z - fromZ) || 1;
    b.vx = ((b.x - fromX) / d) * TUNING.folk.knockback;
    b.vz = ((b.z - fromZ) / d) * TUNING.folk.knockback;
    b.vy = 2;
    b.onGround = false;
    return;
  }
  const hostile = KINDS[mob.kind].hostile !== undefined;
  const dx = b.x - fromX;
  const dz = b.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  const knock = TUNING.mobs.knockback * (hostile ? 0.5 : 1);
  b.vx = (dx / d) * knock;
  b.vz = (dz / d) * knock;
  b.vy = TUNING.mobs.knockUp * (hostile ? 0.6 : 1);
  b.onGround = false;
  mob.hits += points;
  mob.sinceHurt = 0;
  mob.path = null;
  mob.goal = null;
  if (hostile) return;
  mob.threat = { x: fromX, z: fromZ };
  mob.state = 'flee';
  mob.timer = TUNING.mobs.fleeSeconds;
}

/** How far apart the boxes of mob `mob` and a player standing at `p` are (0 when they touch or overlap). */
function gapTo(mob: Mob, p: Prey): number {
  const b = mob.body;
  const dx = Math.max(0, Math.abs(b.x - p.x) - b.halfWidth - HALF_WIDTH);
  const dz = Math.max(0, Math.abs(b.z - p.z) - b.halfWidth - HALF_WIDTH);
  const dy = Math.max(0, p.y - (b.y + b.height), b.y - (p.y + HEIGHT));
  return Math.hypot(dx, dy, dz);
}

/**
 * A hostile mob's hunting, before it moves: the nearest player within sight becomes its target
 * (none: it goes back to wandering); it asks for a way to them every second, or when they've moved
 * off from where it was going; within reach it stands, faces them and hits every `hostile.every` s. Returns
 * the speed it should go along its path, or a straight line to run if it has no way.
 */
function hunt(mob: Mob, ctx: MobContext, dt: number): { speed: number; straight: [number, number] | null } {
  const k = KINDS[mob.kind];
  const h = k.hostile!;
  const b = mob.body;
  mob.cooldown = Math.max(0, mob.cooldown - dt);
  const prey = ctx.prey ?? [];
  let best = -1;
  let bestD = h.sight;
  prey.forEach((p, i) => {
    // A deep kind leaves alone a player above its depth.
    if (h.below !== undefined && p.y >= h.below) return;
    const d = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
    if (d <= bestD) [best, bestD] = [i, d];
  });
  if (best < 0) {
    if (mob.state === 'hunt') {
      mob.state = 'idle';
      mob.timer = between(mob.rng, TUNING.mobs.idle);
      mob.path = null;
    }
    mob.target = -1;
    return { speed: 0, straight: null };
  }
  const p = prey[best];
  mob.target = best;
  if (mob.state !== 'hunt') {
    mob.state = 'hunt';
    mob.timer = 0;
    mob.path = null;
  }
  // Within reach: stand, face them, hit when it may.
  if (gapTo(mob, p) <= h.reach) {
    mob.path = null;
    mob.yaw = Math.atan2(-(p.x - b.x), -(p.z - b.z));
    if (mob.cooldown <= 0) {
      mob.cooldown = h.every;
      ctx.attack?.(mob, best);
    }
    return { speed: 0, straight: null };
  }
  // A way to them, asked for again every second or, along one, when they've moved off from its end.
  // With no way to them (in a cave under them, say), not again for `huntRetry` s: a search that
  // finds nothing is the costliest kind. One put off (the frame's budget used) is asked again soon.
  mob.timer -= dt;
  const goal: [number, number, number] = [Math.floor(p.x), Math.floor(p.y + 0.01), Math.floor(p.z)];
  const off = mob.goal ? Math.hypot(mob.goal[0] - goal[0], mob.goal[1] - goal[1], mob.goal[2] - goal[2]) : Infinity;
  // (With none, or past its end, it goes straight at them until then.)
  if (mob.timer <= 0 || (mob.path && off > 3)) {
    const path = ctx.findPath(mob, feet(mob), goal, 1);
    if (path === undefined) mob.timer = 0.2;
    else if (path === null) {
      mob.timer = TUNING.mobs.huntRetry;
      mob.path = null;
    } else {
      mob.timer = 1;
      setPath(mob, path, goal, 1);
    }
  }
  if (mob.path) return { speed: k.runSpeed, straight: null };
  // No way found (yet): straight at them.
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const d = Math.hypot(dx, dz) || 1;
  return { speed: k.runSpeed, straight: [(dx / d) * k.runSpeed, (dz / d) * k.runSpeed] };
}

/**
 * Courting: a way to the mate, asked for again every second (with none, not for 2 s); the speed to go
 * along it, or a straight line at the mate with no way. Out of love or with no mate: idle again.
 */
function court(mob: Mob, ctx: MobContext, dt: number): { speed: number; straight: [number, number] | null } {
  const k = KINDS[mob.kind];
  const m = mob.mate;
  if (!m || mob.love <= 0) {
    mob.state = 'idle';
    mob.timer = between(mob.rng, TUNING.mobs.idle);
    mob.path = null;
    mob.mate = null;
    return { speed: 0, straight: null };
  }
  mob.timer -= dt;
  if (mob.timer <= 0) {
    const goal = feet(m);
    const path = ctx.findPath(mob, feet(mob), goal, 1);
    if (path === undefined) mob.timer = 0.2;
    else if (path === null) {
      mob.timer = 2;
      mob.path = null;
    } else {
      mob.timer = 1;
      setPath(mob, path, goal, 1);
    }
  }
  if (mob.path) return { speed: k.walkSpeed, straight: null };
  const dx = m.body.x - mob.body.x;
  const dz = m.body.z - mob.body.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.1) return { speed: 0, straight: [0, 0] };
  return { speed: k.walkSpeed, straight: [(dx / d) * k.walkSpeed, (dz / d) * k.walkSpeed] };
}

/** Send the mob along a path to `goal` (within `near`); false if there's none (or it must wait). */
export function goTo(mob: Mob, ctx: MobContext, goal: [number, number, number], near = 0): boolean {
  const path = ctx.findPath(mob, feet(mob), goal, near);
  if (!path) return false;
  setPath(mob, path, goal, near);
  return true;
}

/** Follow `path` to `goal` from its start. */
export function setPath(mob: Mob, path: Path, goal: [number, number, number], near: number): void {
  // No waypoints at all: it starts near enough, so there's no way to walk (a hunter goes straight).
  mob.path = path.length ? path : null;
  mob.next = 0;
  mob.goal = goal;
  mob.near = near;
  mob.best = Number.POSITIVE_INFINITY;
  mob.sinceBest = 0;
}

/** Where feet can stand in column (x, z) within a few blocks of height y, or null. */
export function standingAt(blocks: BlockSource, x: number, z: number, y: number, height: number): number | null {
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
export function placeToward(mob: Mob, ctx: MobContext, angle: number, distance: number): [number, number, number] | null {
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
  mob.love = Math.max(0, mob.love - dt);
  mob.wait = Math.max(0, mob.wait - dt);
  if (mob.grow > 0) {
    mob.grow = Math.max(0, mob.grow - dt);
    grow(mob, ctx.blocks);
  }
  const young = mob.grow > 0 ? M.breeding.youngSpeed : 1;
  if (k.folk) return stepFolk(mob, ctx, dt);

  // A hostile kind hunts the players it sees, and never rests.
  if (k.hostile) {
    const { speed, straight } = hunt(mob, ctx, dt);
    if (mob.state === 'hunt') {
      if (straight) return moveAndTurn(mob, ctx, straight[0], straight[1], false, dt);
      if (!mob.path) return moveAndTurn(mob, ctx, 0, 0, false, dt);
      return follow(mob, ctx, speed, dt);
    }
  } else if (mob.state === 'court') {
    const { speed, straight } = court(mob, ctx, dt);
    if (mob.state === 'court') {
      if (straight) return moveAndTurn(mob, ctx, straight[0] * young, straight[1] * young, false, dt);
      return follow(mob, ctx, speed * young, dt);
    }
  } else if (ctx.daylight < M.rest && mob.state !== 'flee' && mob.state !== 'rest') {
    // Night: rest (unless running from something or courting); morning: wake up.
    mob.state = 'rest';
    mob.path = null;
  } else if (mob.state === 'rest' && ctx.daylight > M.wake) {
    mob.state = 'idle';
    mob.timer = between(mob.rng, [0.5, 3]);
  }

  let speed = 0;
  if (mob.state === 'idle') {
    mob.timer -= dt;
    // A young one far from its grown one goes back to it at once.
    const lead = mob.grow > 0 ? mob.lead : null;
    const away = lead ? Math.hypot(lead.body.x - b.x, lead.body.z - b.z) : 0;
    if (lead && away > M.breeding.follow * 2) mob.timer = Math.min(mob.timer, 0);
    if (mob.timer <= 0) {
      let goal = lead && away > M.breeding.follow ? feet(lead) : placeToward(mob, ctx, mob.rng() * 2 * Math.PI, between(mob.rng, M.wander) * (lead ? 0.5 : 1));
      // A deep kind wanders only below its depth.
      const below = k.hostile?.below;
      if (goal && below !== undefined && goal[1] >= below) goal = null;
      const found = goal ? goTo(mob, ctx, goal, lead && away > M.breeding.follow ? 2 : 0) : false;
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
  follow(mob, ctx, speed * young, dt);
}

/** Along its path (if it has one, wandering, fleeing, hunting, courting or going home) at `speed`, then moving and turning. */
export function follow(mob: Mob, ctx: MobContext, speed: number, dt: number): void {
  const M = TUNING.mobs;
  const b = mob.body;
  let vx = 0;
  let vz = 0;
  let jump = false;
  // Wandering with no way to go (it's there already): idle again.
  if (mob.state === 'wander' && (!mob.path || mob.next >= mob.path.length)) {
    mob.path = null;
    mob.state = 'idle';
    mob.timer = between(mob.rng, M.idle);
  }
  if ((mob.state === 'wander' || mob.state === 'flee' || mob.state === 'hunt' || mob.state === 'court' || mob.state === 'home') && mob.path && mob.next < mob.path.length) {
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

export function moveAndTurn(mob: Mob, ctx: MobContext, vx: number, vz: number, jump: boolean, dt: number): void {
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
