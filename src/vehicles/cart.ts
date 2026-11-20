// Carts on rails (Milestone 18). Pure.
//
// A rail's path through its block (`railPoint`, `railTangent`): straight from the middle of one end's
// side to the other's; on a slope rising a block on the way; on a curve a quarter circle round the
// corner between the two sides, half a block out. A cart on a rail is where along that path it is
// (`OnRail.s`) and its speed along it, and each step:
// - gravity pulls it down a slope (`gravity` times the slope's steepness);
// - a powered rail that's on pushes it the way it's going up to `max` (from a standstill, away from a
//   dead end), one that's off brakes it to a stop;
// - rolling drag slows it, a part of its speed and a little more, so from top speed it runs about a
//   hundred blocks on the level;
// - a rider's push (the way they look) starts it from a near standstill;
// - it moves along, on through each end into the rail joined there (`nextRail`), entering it from
//   either end; at an end joined to nothing (a dead end, a rail broken) it stops.
// Its body follows the path, and it faces along it. Off rails it falls and slides to a stop as a box
// (`stepMob`), and lands back on a rail if it comes down on one.

import { TUNING } from '../config';
import { railOf } from '../world/blocks';
import { type BlockSource, stepMob } from '../world/physics';
import { nextRail, RAIL_ENDS, RAIL_RISE } from '../world/rails';
import type { OnRail, Vehicle } from './vehicle';

/** The middle of each side (`FACINGS` order) within a block, on x and z. */
const SIDE_MIDDLE: readonly (readonly [number, number])[] = [
  [1, 0.5],
  [0, 0.5],
  [0.5, 1],
  [0.5, 0],
];

const isCurve = (shape: number) => shape >= 6;

/** How long a rail's path is (blocks). */
export function railLength(shape: number): number {
  if (isCurve(shape)) return Math.PI / 4;
  return RAIL_RISE[shape] >= 0 ? Math.SQRT2 : 1;
}

/** A curve's corner (on x and z) and its two ends' angles about it. */
function arc(shape: number): { cx: number; cz: number; a0: number; a1: number } {
  const [e0, e1] = RAIL_ENDS[shape];
  const xEnd = e0 < 2 ? e0 : e1;
  const zEnd = e0 < 2 ? e1 : e0;
  const cx = xEnd === 0 ? 1 : 0;
  const cz = zEnd === 2 ? 1 : 0;
  const angle = (d: number) => Math.atan2(SIDE_MIDDLE[d][1] - cz, SIDE_MIDDLE[d][0] - cx);
  let a0 = angle(e0);
  let a1 = angle(e1);
  // The quarter turn between them, not the three-quarter one.
  if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
  return { cx, cz, a0, a1 };
}

/** Where on a rail's path `s` along is, within its block: (x, y, z), y up from the block's floor. */
export function railPoint(shape: number, s: number): [number, number, number] {
  const L = railLength(shape);
  const t = Math.max(0, Math.min(1, s / L));
  const [e0, e1] = RAIL_ENDS[shape];
  if (isCurve(shape)) {
    const { cx, cz, a0, a1 } = arc(shape);
    const a = a0 + (a1 - a0) * t;
    return [cx + 0.5 * Math.cos(a), 0, cz + 0.5 * Math.sin(a)];
  }
  const [x0, z0] = SIDE_MIDDLE[e0];
  const [x1, z1] = SIDE_MIDDLE[e1];
  const rise = RAIL_RISE[shape];
  const y0 = rise === e0 ? 1 : 0;
  const y1 = rise === e1 ? 1 : 0;
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t];
}

/** The unit direction along a rail's path at `s`, towards its second end. */
export function railTangent(shape: number, s: number): [number, number, number] {
  if (isCurve(shape)) {
    const { a0, a1 } = arc(shape);
    const a = a0 + (a1 - a0) * Math.max(0, Math.min(1, s / railLength(shape)));
    const sign = Math.sign(a1 - a0);
    return [-Math.sin(a) * sign, 0, Math.cos(a) * sign];
  }
  const [e0, e1] = RAIL_ENDS[shape];
  const rise = RAIL_RISE[shape];
  const dx = SIDE_MIDDLE[e1][0] - SIDE_MIDDLE[e0][0];
  const dz = SIDE_MIDDLE[e1][1] - SIDE_MIDDLE[e0][1];
  const dy = (rise === e1 ? 1 : 0) - (rise === e0 ? 1 : 0);
  const n = Math.hypot(dx, dy, dz);
  return [dx / n, dy / n, dz / n];
}

/** The rail's shape at a place, if there's a rail there. */
const shapeAt = (blocks: BlockSource, x: number, y: number, z: number) => railOf(blocks.getBlock(x, y, z))?.shape ?? -1;

/** Put the cart's body where it is on its rail, facing along it. */
function place(v: Vehicle, r: OnRail, shape: number): void {
  const [px, py, pz] = railPoint(shape, r.s);
  const [tx, ty, tz] = railTangent(shape, r.s);
  const b = v.body;
  b.x = r.x + px;
  b.y = r.y + py;
  b.z = r.z + pz;
  b.vx = b.vy = b.vz = 0;
  b.onGround = true;
  // Facing the way it's going (along the path backwards if it's going backwards); standing still,
  // whichever way along the rail it faced.
  const moving = Math.abs(v.speed) > 0.01;
  const dir = moving ? (v.speed < 0 ? -1 : 1) : -Math.sin(v.yaw) * tx - Math.cos(v.yaw) * tz >= 0 ? 1 : -1;
  v.yaw = Math.atan2(-tx * dir, -tz * dir);
  v.pitch = Math.asin(ty * dir);
}

/**
 * Put `v` on the rail at (x, y, z) if there's one, at the point of its path nearest the body
 * (sampled), keeping its speed along the way it was going; true if it's on one now.
 */
export function putOnRail(v: Vehicle, blocks: BlockSource, x: number, y: number, z: number): boolean {
  const shape = shapeAt(blocks, x, y, z);
  if (shape < 0) return false;
  const L = railLength(shape);
  const b = v.body;
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let k = 0; k <= 16; k++) {
    const s = (L * k) / 16;
    const [px, , pz] = railPoint(shape, s);
    const d = Math.hypot(x + px - b.x, z + pz - b.z);
    if (d < bestD) [best, bestD] = [s, d];
  }
  const [tx, , tz] = railTangent(shape, best);
  v.speed = b.vx * tx + b.vz * tz;
  v.rail = { x, y, z, s: best };
  place(v, v.rail, shape);
  return true;
}

/** A rider's push: the way they look on x and z (a unit vector), or null. */
export type Push = readonly [number, number] | null;

/** One step of a cart (`dt` seconds), on its rail or off. */
export function stepCart(v: Vehicle, blocks: BlockSource, dt: number = TUNING.vehicles.step, push: Push = null): void {
  const r = v.rail;
  const shape = r ? shapeAt(blocks, r.x, r.y, r.z) : -1;
  if (!r || shape < 0) {
    v.rail = null;
    offRail(v, blocks, dt);
    return;
  }
  const C = TUNING.vehicles.cart;
  const [tx, ty, tz] = railTangent(shape, r.s);
  let speed = v.speed;
  // Down a slope.
  speed -= C.gravity * ty * dt;
  const kind = railOf(blocks.getBlock(r.x, r.y, r.z))!;
  let boosted = false;
  if (kind.powered && kind.on) {
    let dir = Math.sign(speed);
    if (Math.abs(speed) < 0.05) {
      // From a standstill: away from a dead end, if one end is.
      const [e0, e1] = RAIL_ENDS[shape];
      const open0 = nextRail(blocks, r.x, r.y, r.z, shape, e0) !== null;
      const open1 = nextRail(blocks, r.x, r.y, r.z, shape, e1) !== null;
      dir = open0 === open1 ? 0 : open1 ? 1 : -1;
    }
    if (dir !== 0 && Math.abs(speed) < C.max) {
      speed = dir * Math.min(C.max, Math.abs(speed) + C.boost * dt);
      boosted = true;
    }
  } else if (kind.powered) speed -= Math.sign(speed) * Math.min(Math.abs(speed), C.brake * dt);
  // A rider's push from a near standstill.
  if (push && Math.abs(speed) < C.pushUpTo) {
    const along = push[0] * tx + push[1] * tz;
    if (Math.abs(along) > 0.3) speed = Math.max(-C.pushUpTo, Math.min(C.pushUpTo, speed + Math.sign(along) * C.push * dt));
  }
  // Rolling drag.
  if (!boosted) speed -= Math.sign(speed) * Math.min(Math.abs(speed), (C.drag * Math.abs(speed) + C.roll) * dt);
  speed = Math.max(-C.max, Math.min(C.max, speed));
  v.speed = speed;
  // Along, on through the ends.
  let at: OnRail = r;
  let s = r.s + speed * dt;
  let here = shape;
  for (let n = 0; n < 4; n++) {
    const L = railLength(here);
    if (s >= 0 && s <= L) break;
    const out = s > L ? 1 : 0;
    const end = RAIL_ENDS[here][out];
    const over = out ? s - L : -s;
    const next = nextRail(blocks, at.x, at.y, at.z, here, end);
    if (!next) {
      // A dead end: stop at it.
      s = out ? L : 0;
      v.speed = 0;
      break;
    }
    // Entered through its end facing back this way: from its first end forwards, or its second backwards.
    const entered = end ^ 1;
    const fromFirst = RAIL_ENDS[next.shape][0] === entered;
    const nl = railLength(next.shape);
    s = fromFirst ? over : nl - over;
    v.speed = (fromFirst ? 1 : -1) * Math.abs(v.speed);
    at = { x: next.x, y: next.y, z: next.z, s };
    here = next.shape;
  }
  at.s = Math.max(0, Math.min(railLength(here), s));
  v.rail = at;
  place(v, at, here);
}

/** Off rails: a box falling and sliding to a stop; back on a rail if it comes to rest in one's block. */
function offRail(v: Vehicle, blocks: BlockSource, dt: number): void {
  const b = v.body;
  const slow = Math.exp(-3 * dt);
  stepMob(b, { vx: b.vx * slow, vz: b.vz * slow, jump: false, jumpHeight: 0 }, blocks, dt);
  if (!b.onGround) return;
  const x = Math.floor(b.x);
  const z = Math.floor(b.z);
  for (const dy of [0, -1]) if (putOnRail(v, blocks, x, Math.floor(b.y + 0.01) + dy, z)) return;
}

