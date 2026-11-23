// The hearthfolk (Milestone 22): the people of the settlements. Each lives in a hut, has a bed there,
// and keeps to its settlement. Pure, like `brain.ts`, whose path following and moving it uses.
//
//   idle    stands and looks about for a while, then picks somewhere round the well to go (a trader,
//           more often than not, goes back to stand by its counter);
//   wander  walks a path there;
//   greet   a player has come within `TUNING.folk.greet`: it stops and turns to them for a few
//           seconds, greeting them now and then (`MobContext.greet`), once a visit;
//   flee    a hostile mob within `scatter`: it runs the other way for a few seconds;
//   home    at dusk: a path to the place beside its bed; there, into bed. With no way after a few
//           tries, or after too long, it's put there (a stuck one is put back home);
//   sleep   lying in bed until morning, not moving at all; it gets up beside the bed.
//
// Never further than `reach` from the well for long: past it, its next walk is back towards the well.
// Hits don't hurt it (`brain.ts`'s `hurt`: a step back).

import { TUNING } from '../config';
import { FACINGS } from '../world/blocks';
import { backFacing, localPlace, type Settlement } from '../world/settlements';
import { between, feet, follow, goTo, type Mob, type MobContext, moveAndTurn, placeToward, type Prey, setPath, standingAt } from './brain';
import { headroom, KINDS } from './kinds';

/** Where one of the hearthfolk lives. */
export interface FolkHome {
  /** Its settlement, by cell (`settlementKey`). */
  settlement: number;
  /** The well's middle: the column, and the ground's y there. */
  well: [number, number, number];
  /** Its bed's foot: the block the bed is in, and the way its head points (`FACINGS`). */
  bed: [number, number, number];
  bedFacing: number;
  /** Where it gets up and goes to bed from: the floor beside the bed's foot (feet's block). */
  up: [number, number, number];
  /** A trader's place by its counter, and the way it looks from there; null for the rest. */
  spot: [number, number, number] | null;
  spotFacing: number;
}

/** A settlement's key, by its cell. */
export const settlementKey = (st: { gx: number; gz: number }): number => (st.gx + 32768) * 65536 + (st.gz + 32768);

/** The homes in a settlement: one for each bed, in its huts' order (the trader's first). */
export function homesOf(st: Settlement): FolkHome[] {
  const out: FolkHome[] = [];
  for (const hut of st.huts) {
    const sides = hut.beds === 2 ? [-2, 2] : [-2];
    sides.forEach((a, n) => {
      const [bx, bz] = localPlace(hut, a, -1);
      // Beside the bed's foot, towards the middle of the room.
      const [ux, uz] = localPlace(hut, a - Math.sign(a), -1);
      // The trader stands beside its counter, by the doorstep (the counter's at 2 and 3 across, out front).
      const spot = hut.trader && n === 0 ? localPlace(hut, 1, 4) : null;
      out.push({
        settlement: settlementKey(st),
        well: [st.x, st.y, st.z],
        bed: [bx, hut.y + 1, bz],
        bedFacing: backFacing(hut.facing),
        up: [ux, hut.y + 1, uz],
        spot: spot ? [spot[0], hut.y + 1, spot[1]] : null,
        spotFacing: hut.facing,
      });
    });
  }
  return out;
}

/** How far up from the bed's block a lying body's feet are drawn from: the bed is half a block high. */
export const BED_TOP = 0.5;

/** Into bed: lying along it, feet at its foot, head on the pillow, still. */
export function intoBed(mob: Mob): void {
  const h = mob.home!;
  const [fx, fz] = FACINGS[h.bedFacing];
  const b = mob.body;
  b.x = h.bed[0] + 0.5 - fx * 0.3;
  b.z = h.bed[2] + 0.5 - fz * 0.3;
  b.y = h.bed[1] + BED_TOP;
  b.vx = b.vy = b.vz = 0;
  b.onGround = true;
  // Looking from the head towards the feet (it lies on its back, its head the way the bed's points).
  mob.yaw = Math.atan2(fx, fz);
  mob.state = 'sleep';
  mob.path = null;
  mob.goal = null;
}

/** Out of bed, standing beside it. */
export function outOfBed(mob: Mob): void {
  const h = mob.home;
  const b = mob.body;
  if (h) {
    b.x = h.up[0] + 0.5;
    b.y = h.up[1];
    b.z = h.up[2] + 0.5;
  }
  b.vx = b.vy = b.vz = 0;
  mob.state = 'idle';
  mob.timer = between(mob.rng, [1, 3]);
}

/** Across distance from (x, z) to a place. */
const across = (mob: Mob, x: number, z: number) => Math.hypot(mob.body.x - x, mob.body.z - z);

/** Turn towards a point, at most the turning speed. */
function turnToward(mob: Mob, x: number, z: number, dt: number): void {
  const want = Math.atan2(-(x - mob.body.x), -(z - mob.body.z));
  let turn = want - mob.yaw;
  turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
  const most = TUNING.mobs.turnSpeed * dt;
  mob.yaw += Math.max(-most, Math.min(most, turn));
}

/** The nearest of `list` within `r` across, or null. */
function nearestWithin(mob: Mob, list: readonly Prey[] | undefined, r: number): Prey | null {
  let best: Prey | null = null;
  let bestD = r;
  for (const p of list ?? []) {
    const d = across(mob, p.x, p.z);
    if (d <= bestD) [best, bestD] = [p, d];
  }
  return best;
}

/** Somewhere to go round the well (a trader: its counter, mostly), or null. */
function placeToGo(mob: Mob, ctx: MobContext): [number, number, number] | null {
  const F = TUNING.folk;
  const h = mob.home!;
  if (h.spot && mob.rng() < F.counter) return h.spot;
  const angle = mob.rng() * 2 * Math.PI;
  const r = 3 + mob.rng() * (F.roam - 3);
  const x = Math.floor(h.well[0] + 0.5 + Math.sin(angle) * r);
  const z = Math.floor(h.well[2] + 0.5 + Math.cos(angle) * r);
  const y = standingAt(ctx.blocks, x, z, h.well[1] + 1, headroom(KINDS[mob.kind]));
  return y === null ? null : [x, y, z];
}

/** One step of one of the hearthfolk (from `stepBrain`). */
export function stepFolk(mob: Mob, ctx: MobContext, dt: number): void {
  const F = TUNING.folk;
  const M = TUNING.mobs;
  const k = KINDS[mob.kind];
  const b = mob.body;
  const h = mob.home;
  mob.greeted += dt;

  // In bed: still until morning (or with no home: up at once).
  if (mob.state === 'sleep') {
    if (h && ctx.daylight <= F.wake) {
      b.vx = b.vy = b.vz = 0;
      return;
    }
    outOfBed(mob);
  }

  // Something hostile near: run.
  const danger = nearestWithin(mob, ctx.dangers, F.scatter);
  if (danger && mob.state !== 'flee') {
    mob.state = 'flee';
    mob.threat = { x: danger.x, z: danger.z };
    mob.timer = M.fleeSeconds;
    mob.path = null;
  }

  const night = h !== null && ctx.daylight < F.home;
  if (mob.state === 'flee') {
    mob.timer -= dt;
    if (mob.timer <= 0) {
      mob.state = 'idle';
      mob.timer = 0;
      mob.path = null;
      mob.threat = null;
    } else {
      if (!mob.path && mob.threat) {
        const away = Math.atan2(b.x - mob.threat.x, b.z - mob.threat.z) + (mob.rng() - 0.5) * 1.2;
        const goal = placeToward(mob, ctx, away, M.fleeDistance);
        if (!goal || !goTo(mob, ctx, goal, 3)) {
          mob.path = null;
          return moveAndTurn(mob, ctx, Math.sin(away) * k.runSpeed, Math.cos(away) * k.runSpeed, false, dt);
        }
      }
      return follow(mob, ctx, k.runSpeed, dt);
    }
  }

  // Dusk: home to bed.
  if (night) {
    if (mob.state !== 'home') {
      mob.state = 'home';
      mob.path = null;
      mob.timer = 0;
      // Tries at a way home, and seconds on the way (`hits` and `cooldown` are free: never hurt, never hunting).
      mob.hits = 0;
      mob.cooldown = 0;
    }
    return goHome(mob, ctx, dt);
  }
  if (mob.state === 'home') {
    mob.state = 'idle';
    mob.timer = 0;
    mob.path = null;
  }

  // A player near: stop and turn to them, once a visit.
  const player = h ? nearestWithin(mob, ctx.players, F.greet) : null;
  if (!nearestWithin(mob, ctx.players, F.greet + 2)) mob.noticed = false;
  if (player && !mob.noticed && (mob.state === 'idle' || mob.state === 'wander')) {
    mob.noticed = true;
    mob.state = 'greet';
    mob.timer = F.greetSeconds;
    mob.path = null;
    if (mob.greeted >= F.greetAgain) {
      mob.greeted = 0;
      ctx.greet?.(mob);
    }
  }
  if (mob.state === 'greet') {
    mob.timer -= dt;
    const still = nearestWithin(mob, ctx.players, F.greet + 1);
    if (!still || mob.timer <= 0) {
      mob.state = 'idle';
      mob.timer = between(mob.rng, F.idle);
    } else turnToward(mob, still.x, still.z, dt);
    return moveAndTurn(mob, ctx, 0, 0, false, dt);
  }

  if (mob.state === 'idle') {
    mob.timer -= dt;
    // A trader at its counter looks out from it.
    if (h?.spot && across(mob, h.spot[0] + 0.5, h.spot[2] + 0.5) < 0.8) {
      const [fx, fz] = FACINGS[h.spotFacing];
      turnToward(mob, b.x + fx, b.z + fz, dt);
    }
    if (mob.timer <= 0 && h) {
      // Too far from the well: back towards it; else somewhere round it.
      const far = across(mob, h.well[0] + 0.5, h.well[2] + 0.5) > F.reach;
      const goal = far ? [h.well[0] + 3, h.well[1] + 1, h.well[2]] as [number, number, number] : placeToGo(mob, ctx);
      if (goal && goTo(mob, ctx, goal, far ? 4 : 0)) mob.state = 'wander';
      else mob.timer = 0.5 + mob.rng();
    }
  }
  follow(mob, ctx, mob.state === 'wander' ? k.walkSpeed : 0, dt);
}

/** Going home: a way to the place beside its bed, followed; there, into bed. */
function goHome(mob: Mob, ctx: MobContext, dt: number): void {
  const F = TUNING.folk;
  const k = KINDS[mob.kind];
  const h = mob.home!;
  const [ux, uy, uz] = h.up;
  mob.cooldown += dt;
  if (across(mob, ux + 0.5, uz + 0.5) <= F.arrive && Math.abs(mob.body.y - uy) < 1) return intoBed(mob);
  if (mob.cooldown > F.homeSeconds) return intoBed(mob);
  if (!mob.path) {
    mob.timer -= dt;
    if (mob.timer <= 0) {
      const path = ctx.findPath(mob, feet(mob), h.up, 0);
      if (path === undefined) mob.timer = 0.2;
      else if (path === null) {
        // (Its `hits` count tries here: the hearthfolk are never hurt.)
        if (++mob.hits >= F.homeTries) return intoBed(mob);
        mob.timer = 2;
      } else if (!path.length) return intoBed(mob);
      else setPath(mob, path, h.up, 0);
    }
  }
  follow(mob, ctx, k.walkSpeed, dt);
}
