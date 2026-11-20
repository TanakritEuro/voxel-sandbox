// Boats (Milestone 18). Pure.
//
// A boat floats with its bottom `draft` under the water's surface (found in the column under its
// middle), sprung towards that height and damped, so it settles and rides over a step in the water.
// Its rider rows: W and S forwards and back (back at half speed), A and D turn it. Its speed eases
// towards what's rowed (water drag), plus the current where the water flows (`currentAt`); a shore
// stops it (it's a box like any other). Out of the water it falls, and on land it drags to a stop,
// rowed only feebly.

import { TUNING } from '../config';
import { BLOCKS } from '../world/blocks';
import { type BlockSource, currentAt, moveBody } from '../world/physics';
import type { Vehicle } from './vehicle';

/** A rider's rowing: forwards (1) or back (-1), turning right (1) or left (-1). */
export interface Rowing {
  forward: number;
  turn: number;
}

/**
 * The height of the water's surface in the column at (x, z), looking from a little above `y` down to a
 * little below; null if there's no water there.
 */
export function surfaceAt(blocks: BlockSource, x: number, y: number, z: number): number | null {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  for (let by = Math.floor(y) + 1; by >= Math.floor(y) - 1; by--) {
    const info = BLOCKS[blocks.getBlock(bx, by, bz)];
    if (!info.liquid) continue;
    // The top of this water: a full block if there's more water over it.
    let top = by;
    while (BLOCKS[blocks.getBlock(bx, top + 1, bz)].liquid) top++;
    return top + BLOCKS[blocks.getBlock(bx, top, bz)].liquidHeight;
  }
  return null;
}

/** One step of a boat (`dt` seconds), rowed by `rowing` if someone's in it and rowing. */
export function stepBoat(v: Vehicle, blocks: BlockSource, dt: number = TUNING.vehicles.step, rowing: Rowing | null = null): void {
  const B = TUNING.vehicles.boat;
  const b = v.body;
  const surface = surfaceAt(blocks, b.x, b.y, b.z);
  const afloat = surface !== null && b.y <= surface - B.draft + 0.5;
  // Turning (D turns right: the facing's angle goes down).
  if (rowing) v.yaw -= rowing.turn * B.turn * dt;
  // The speed it's rowed to, and the current's.
  const forward = rowing ? Math.max(-0.5, Math.min(1, rowing.forward)) : 0;
  const speed = forward * (afloat ? B.speed : B.landSpeed);
  let wx = -Math.sin(v.yaw) * speed;
  let wz = -Math.cos(v.yaw) * speed;
  if (afloat) {
    const [cx, cz] = currentAt(b, blocks);
    wx += cx * TUNING.water.push;
    wz += cz * TUNING.water.push;
  }
  const ease = 1 - Math.exp(-(afloat ? B.waterDrag : B.landDrag) * dt);
  b.vx += (wx - b.vx) * ease;
  b.vz += (wz - b.vz) * ease;
  // Up and down: sprung to the surface afloat, falling otherwise.
  if (afloat) b.vy += ((surface - B.draft - b.y) * B.spring - b.vy * B.damping) * dt;
  else b.vy -= TUNING.player.gravity * dt;
  const hits = moveBody(b, b.vx * dt, b.vy * dt, b.vz * dt, blocks);
  if (hits.x) b.vx = 0;
  if (hits.z) b.vz = 0;
  if (hits.y) {
    b.onGround = b.vy < 0;
    b.vy = 0;
  } else b.onGround = false;
  b.inWater = afloat;
  v.pitch = 0;
}

/**
 * Where a boat could be put along a ray (from `o`, unit `d`, within `reach`): the first water whose
 * surface the ray reaches, a boat's middle on it there; null if there's none, or something solid comes
 * first.
 */
export function waterOnRay(blocks: BlockSource, o: readonly [number, number, number], d: readonly [number, number, number], reach: number): [number, number, number] | null {
  for (let t = 0; t <= reach; t += 0.05) {
    const x = o[0] + d[0] * t;
    const y = o[1] + d[1] * t;
    const z = o[2] + d[2] * t;
    const info = BLOCKS[blocks.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
    if (info.liquid) {
      const s = surfaceAt(blocks, x, y, z);
      if (s !== null && y <= s) return [Math.floor(x) + 0.5, s - TUNING.vehicles.boat.draft, Math.floor(z) + 0.5];
      continue;
    }
    if (!info.passable) return null;
  }
  return null;
}
