// Player physics: a 0.6 × 1.8 × 0.6 box moved through the block grid. Pure (no Three.js, no
// DOM), stepped at a fixed rate (`TUNING.player.step`), so it is tested headless and gives
// the same path at any frame rate.
//
// Collision moves one axis at a time, y then x then z. Each move checks every layer of
// blocks the box passes through on the way, not only where it ends up, so it can't tunnel
// however fast it goes; a blocked move ends exactly against the block's face.

import { TUNING } from '../config';
import { type Block, BLOCKS } from './blocks';

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
}

/** What the player asks for this step. */
export interface MoveInput {
  /** -1..1, along and across the facing direction. */
  forward: number;
  strafe: number;
  /** Facing, radians; 0 looks along -z (as the camera does). */
  yaw: number;
  /** Held: jumps whenever on the ground. */
  jump: boolean;
  sprint: boolean;
  flying: boolean;
  /** Flying only: -1..1, down / up. */
  up: number;
}

export const createBody = (x: number, y: number, z: number): Body => ({ x, y, z, vx: 0, vy: 0, vz: 0, onGround: false });

export const NO_INPUT: MoveInput = { forward: 0, strafe: 0, yaw: 0, jump: false, sprint: false, flying: false, up: 0 };

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
  const below = axis === 1 ? 0 : HALF_WIDTH;
  const above = axis === 1 ? HEIGHT : HALF_WIDTH;
  const min = [body.x - HALF_WIDTH, body.y, body.z - HALF_WIDTH];
  const max = [body.x + HALF_WIDTH, body.y + HEIGHT, body.z + HALF_WIDTH];
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

  // Turn the horizontal velocity towards the wanted one, by at most the acceleration.
  const speed = input.sprint ? P.sprintSpeed : P.walkSpeed;
  const maxChange = (body.onGround ? P.groundAccel : P.airAccel) * dt;
  const dvx = wx * speed - body.vx;
  const dvz = wz * speed - body.vz;
  const change = Math.hypot(dvx, dvz);
  const k = change > maxChange ? maxChange / change : 1;
  const vx = body.vx + dvx * k;
  const vz = body.vz + dvz * k;

  const vy0 = input.jump && body.onGround ? Math.sqrt(2 * P.gravity * P.jumpHeight) : body.vy;
  const vy = Math.max(vy0 - P.gravity * dt, -P.terminalVelocity);

  // Move by the average of the velocities at the start and end of the step: exact for steady
  // acceleration, so a jump peaks at jumpHeight whatever the step length.
  const dy = ((vy0 + vy) / 2) * dt;
  const hits = moveBody(body, ((body.vx + vx) / 2) * dt, dy, ((body.vz + vz) / 2) * dt, world);
  body.vx = hits.x ? 0 : vx;
  body.vy = hits.y ? 0 : vy;
  body.vz = hits.z ? 0 : vz;
  body.onGround = hits.y && dy < 0;
}
