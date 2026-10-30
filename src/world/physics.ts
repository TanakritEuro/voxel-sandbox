// Player physics: a 0.6 × 1.8 × 0.6 box moved through the block grid; mobs use the same with
// boxes of their own size. Pure (no Three.js, no DOM), stepped at a fixed rate
// (`TUNING.player.step`), so it is tested headless and gives the same path at any frame rate.
//
// Collision moves one axis at a time, y then x then z. Each move checks every layer of
// blocks the box passes through on the way, not only where it ends up, so it can't tunnel
// however fast it goes; a blocked move ends exactly against the block's face.
//
// Crouching on the ground cuts short any move that would leave nothing under the box, so
// you can walk up to an edge and along it but not off it. In water, gravity gives way to a
// slow sink, Space swims up, and swimming into a wall with Space held climbs out.

import { TUNING } from '../config';
import { type Block, BLOCKS } from './blocks';

/** The player's box: half its width (x and z), and its height. */
export const HALF_WIDTH = 0.3;
export const HEIGHT = 1.8;
/** A box touching a block's face doesn't overlap it: coordinates within this of a face count as outside. */
const EPS = 1e-6;

export interface BlockSource {
  getBlock(x: number, y: number, z: number): Block;
}

export interface Body {
  /** Feet: the centre of the bottom of the box. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Standing on something since the last step. */
  onGround: boolean;
  /** The box overlaps a liquid block (as of the last step). */
  inWater: boolean;
  /** The box: half its width on x and z, and its height (the player's, or a mob's). */
  halfWidth: number;
  height: number;
}

/** What the player asks for this step. */
export interface MoveInput {
  /** -1..1, along and across the facing direction. */
  forward: number;
  strafe: number;
  /** Facing, radians; 0 looks along -z (as the camera does). */
  yaw: number;
  /** Held: jumps whenever on the ground; swims up in water. */
  jump: boolean;
  sprint: boolean;
  /** Walking only: slower, and won't step off edges. */
  crouch: boolean;
  flying: boolean;
  /** Flying only: -1..1, down / up. */
  up: number;
}

export const createBody = (x: number, y: number, z: number, halfWidth = HALF_WIDTH, height = HEIGHT): Body => ({
  x,
  y,
  z,
  vx: 0,
  vy: 0,
  vz: 0,
  onGround: false,
  inWater: false,
  halfWidth,
  height,
});

export const NO_INPUT: MoveInput = { forward: 0, strafe: 0, yaw: 0, jump: false, sprint: false, crouch: false, flying: false, up: 0 };

/** Which axes ran into a block. */
export interface Hits {
  x: boolean;
  y: boolean;
  z: boolean;
}

/** Move the body by (dx, dy, dz) through the blocks: y first, then x, then z. */
export function moveBody(body: Body, dx: number, dy: number, dz: number, world: BlockSource): Hits {
  return { y: sweep(body, 1, dy, world), x: sweep(body, 0, dx, world), z: sweep(body, 2, dz, world) };
}

const solid = (world: BlockSource, x: number, y: number, z: number): boolean => !BLOCKS[world.getBlock(x, y, z)].passable;

/** Move along one axis as far as `d`, stopping against the first solid block. True if it stopped. */
function sweep(body: Body, axis: 0 | 1 | 2, d: number, world: BlockSource): boolean {
  if (d === 0) return false;
  const pos = [body.x, body.y, body.z];
  // Distance from the body's position to the box's low and high side, per axis.
  const w = body.halfWidth;
  const below = axis === 1 ? 0 : w;
  const above = axis === 1 ? body.height : w;
  const min = [body.x - w, body.y, body.z - w];
  const max = [body.x + w, body.y + body.height, body.z + w];
  // The blocks the box covers across the move, on the other two axes.
  const a1 = (axis + 1) % 3;
  const a2 = (axis + 2) % 3;
  const lo1 = Math.floor(min[a1] + EPS);
  const hi1 = Math.floor(max[a1] - EPS);
  const lo2 = Math.floor(min[a2] + EPS);
  const hi2 = Math.floor(max[a2] - EPS);
  const cell = [0, 0, 0];
  const layerSolid = (c: number): boolean => {
    cell[axis] = c;
    for (let u = lo1; u <= hi1; u++) {
      cell[a1] = u;
      for (let v = lo2; v <= hi2; v++) {
        cell[a2] = v;
        if (solid(world, cell[0], cell[1], cell[2])) return true;
      }
    }
    return false;
  };

  let stop: number | null = null;
  if (d > 0) {
    for (let c = Math.floor(max[axis] - EPS) + 1; c <= Math.floor(max[axis] + d - EPS); c++) {
      if (layerSolid(c)) {
        stop = c - above;
        break;
      }
    }
  } else {
    for (let c = Math.floor(min[axis] + EPS) - 1; c >= Math.floor(min[axis] + d + EPS); c--) {
      if (layerSolid(c)) {
        stop = c + 1 + below;
        break;
      }
    }
  }
  const next = stop ?? pos[axis] + d;
  if (axis === 0) body.x = next;
  else if (axis === 1) body.y = next;
  else body.z = next;
  return stop !== null;
}

/** Calls `test` for the blocks the body's box overlaps, until it returns true. */
function anyOverlapped(body: Body, test: (bx: number, by: number, bz: number) => boolean): boolean {
  const { x, y, z, halfWidth: w } = body;
  for (let by = Math.floor(y + EPS); by <= Math.floor(y + body.height - EPS); by++)
    for (let bz = Math.floor(z - w + EPS); bz <= Math.floor(z + w - EPS); bz++)
      for (let bx = Math.floor(x - w + EPS); bx <= Math.floor(x + w - EPS); bx++) if (test(bx, by, bz)) return true;
  return false;
}

/** Does the box overlap any liquid? */
export const touchesLiquid = (body: Body, world: BlockSource): boolean => anyOverlapped(body, (x, y, z) => BLOCKS[world.getBlock(x, y, z)].liquid);

/** Is there a solid block under some part of the box, with the feet at (x, body.y, z)? */
function supported(body: Body, x: number, z: number, world: BlockSource): boolean {
  const below = Math.floor(body.y - EPS);
  const w = body.halfWidth;
  for (let bz = Math.floor(z - w + EPS); bz <= Math.floor(z + w - EPS); bz++)
    for (let bx = Math.floor(x - w + EPS); bx <= Math.floor(x + w - EPS); bx++) if (solid(world, bx, below, bz)) return true;
  return false;
}

/** Crouching moves are cut short in steps of this (blocks) until something is still underneath. */
const EDGE_STEP = 0.005;

/** Shorten a horizontal move, axis by axis, so the box keeps something under it. */
function stayOnEdge(body: Body, dx: number, dz: number, world: BlockSource): [number, number] {
  const shorten = (d: number) => (Math.abs(d) <= EDGE_STEP ? 0 : d - Math.sign(d) * EDGE_STEP);
  while (dx !== 0 && !supported(body, body.x + dx, body.z, world)) dx = shorten(dx);
  while (dz !== 0 && !supported(body, body.x + dx, body.z + dz, world)) dz = shorten(dz);
  return [dx, dz];
}

/** Would a block at (x, y, z) overlap the body's box? Touching isn't overlapping. For placing blocks. */
export function overlapsBlock(body: Body, x: number, y: number, z: number): boolean {
  return (
    x < body.x + body.halfWidth - EPS &&
    x + 1 > body.x - body.halfWidth + EPS &&
    y < body.y + body.height - EPS &&
    y + 1 > body.y + EPS &&
    z < body.z + body.halfWidth - EPS &&
    z + 1 > body.z - body.halfWidth + EPS
  );
}

/** Advance the body by one physics step. */
export function stepPlayer(body: Body, input: MoveInput, world: BlockSource, dt = TUNING.player.step): void {
  const P = TUNING.player;
  // The wanted horizontal direction, at most unit length (diagonals aren't faster).
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wx = -input.forward * sin + input.strafe * cos;
  let wz = -input.forward * cos - input.strafe * sin;
  const wanted = Math.hypot(wx, wz);
  if (wanted > 1) {
    wx /= wanted;
    wz /= wanted;
  }

  if (input.flying) {
    const speed = TUNING.fly.speed * (input.sprint ? TUNING.fly.sprintMultiplier : 1);
    const vy = input.up * speed;
    const hits = moveBody(body, wx * speed * dt, vy * dt, wz * speed * dt, world);
    body.vx = hits.x ? 0 : wx * speed;
    body.vy = hits.y ? 0 : vy;
    body.vz = hits.z ? 0 : wz * speed;
    body.onGround = hits.y && vy < 0;
    return;
  }

  body.inWater = touchesLiquid(body, world);
  const swim = P.swim;
  const swimming = body.inWater;
  const speed = swimming ? swim.speed : input.crouch ? P.crouchSpeed : input.sprint ? P.sprintSpeed : P.walkSpeed;
  let vx: number;
  let vz: number;
  let vy0: number;
  let vy: number;
  if (swimming) {
    // Water pulls every velocity towards the wanted one: across at swimming speed, up while
    // Space is held, otherwise down to a slow sink.
    const k = 1 - Math.exp(-swim.drag * dt);
    vx = body.vx + (wx * speed - body.vx) * k;
    vz = body.vz + (wz * speed - body.vz) * k;
    vy0 = body.vy;
    vy = vy0 + ((input.jump ? swim.upSpeed : -swim.maxSink) - vy0) * k;
  } else {
    // Turn the horizontal velocity towards the wanted one, by at most the acceleration.
    const maxChange = (body.onGround ? P.groundAccel : P.airAccel) * dt;
    const dvx = wx * speed - body.vx;
    const dvz = wz * speed - body.vz;
    const change = Math.hypot(dvx, dvz);
    const k = change > maxChange ? maxChange / change : 1;
    vx = body.vx + dvx * k;
    vz = body.vz + dvz * k;
    vy0 = input.jump && body.onGround ? Math.sqrt(2 * P.gravity * P.jumpHeight) : body.vy;
    vy = Math.max(vy0 - P.gravity * dt, -P.terminalVelocity);
  }

  // Move by the average of the velocities at the start and end of the step: exact for steady
  // acceleration, so a jump peaks at jumpHeight whatever the step length.
  let dx = ((body.vx + vx) / 2) * dt;
  let dz = ((body.vz + vz) / 2) * dt;
  const dy = ((vy0 + vy) / 2) * dt;
  let edgeX = false;
  let edgeZ = false;
  if (input.crouch && body.onGround && !swimming) {
    const [sx, sz] = stayOnEdge(body, dx, dz, world);
    edgeX = sx !== dx;
    edgeZ = sz !== dz;
    dx = sx;
    dz = sz;
  }
  const hits = moveBody(body, dx, dy, dz, world);
  body.vx = hits.x || edgeX ? 0 : vx;
  body.vy = hits.y ? 0 : vy;
  body.vz = hits.z || edgeZ ? 0 : vz;
  body.onGround = hits.y && dy < 0;
  // Swimming into a wall with Space held climbs it, to get out onto a bank.
  if (swimming && input.jump && (hits.x || hits.z)) body.vy = swim.exitBoost;
}

/** What a mob wants this step: a horizontal velocity, and whether to jump (and how high). */
export interface MobMove {
  vx: number;
  vz: number;
  jump: boolean;
  jumpHeight: number;
}

/**
 * Advance a mob's body one step: its velocity turns towards the one it wants (`TUNING.mobs`
 * acceleration, less in the air), it jumps when asked on the ground, gravity as for the player.
 * In water it rises to the surface and keeps its head out, and jumping against a bank climbs
 * out, as the player does.
 */
export function stepMob(body: Body, move: MobMove, world: BlockSource, dt = TUNING.mobs.step): void {
  const M = TUNING.mobs;
  const P = TUNING.player;
  body.inWater = touchesLiquid(body, world);
  let vx: number;
  let vz: number;
  let vy0: number;
  let vy: number;
  if (body.inWater) {
    const k = 1 - Math.exp(-M.waterDrag * dt);
    vx = body.vx + (move.vx - body.vx) * k;
    vz = body.vz + (move.vz - body.vz) * k;
    vy0 = body.vy;
    // Up while the head is under, otherwise sink back gently: it bobs at the surface.
    const headUnder = BLOCKS[world.getBlock(Math.floor(body.x), Math.floor(body.y + body.height * 0.6), Math.floor(body.z))].liquid;
    vy = vy0 + ((headUnder ? M.floatSpeed : -0.5) - vy0) * k;
  } else {
    const maxChange = (body.onGround ? M.groundAccel : M.airAccel) * dt;
    const dvx = move.vx - body.vx;
    const dvz = move.vz - body.vz;
    const change = Math.hypot(dvx, dvz);
    const k = change > maxChange ? maxChange / change : 1;
    vx = body.vx + dvx * k;
    vz = body.vz + dvz * k;
    vy0 = move.jump && body.onGround ? Math.sqrt(2 * P.gravity * move.jumpHeight) : body.vy;
    vy = Math.max(vy0 - P.gravity * dt, -P.terminalVelocity);
  }
  const hits = moveBody(body, ((body.vx + vx) / 2) * dt, ((vy0 + vy) / 2) * dt, ((body.vz + vz) / 2) * dt, world);
  body.vx = hits.x ? 0 : vx;
  body.vy = hits.y ? 0 : vy;
  body.vz = hits.z ? 0 : vz;
  body.onGround = hits.y && vy0 + vy < 0;
  if (body.inWater && move.jump && (hits.x || hits.z)) body.vy = P.swim.exitBoost;
}
