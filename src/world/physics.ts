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
// slow sink, Space swims up, and swimming into a wall with Space held climbs out. Flowing water
// carries bodies down its slope (`currentAt`), walking, wading or swimming.

import { TUNING } from '../config';
import { type Block, BLOCKS } from './blocks';
import { connectedBoxes, joinsAt } from './shapes';

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
  /** The box reaches below a liquid's surface (as of the last step). */
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
  // Only with a block of boxes about (a door, a bed, a slab, stairs) does a sweep look inside the
  // blocks the body is already in.
  const boxed = nearBox(body, dx, dy, dz, world);
  return { y: sweep(body, 1, dy, world, boxed), x: sweep(body, 0, dx, world, boxed), z: sweep(body, 2, dz, world, boxed) };
}

/**
 * `moveBody`, stepping up: a move on the ground that something stops sideways is tried again
 * `TUNING.player.stepUp` higher (as far up as there's room) and brought back down onto what's there,
 * and that is kept if it gets further across. So a slab, a stair or a bed is walked up; a whole
 * block isn't (nothing is gained half a block up). The y of the hits is whether it ended on
 * something.
 */
export function moveStepping(body: Body, dx: number, dy: number, dz: number, world: BlockSource): Hits {
  const x0 = body.x;
  const y0 = body.y;
  const z0 = body.z;
  const hits = moveBody(body, dx, dy, dz, world);
  if (!hits.x && !hits.z) return hits;
  const plain = [body.x, body.y, body.z];
  const gotPlain = Math.hypot(body.x - x0, body.z - z0);
  body.x = x0;
  body.y = y0;
  body.z = z0;
  moveBody(body, 0, TUNING.player.stepUp, 0, world);
  const rose = body.y - y0;
  const across = moveBody(body, dx, 0, dz, world);
  const gotStep = Math.hypot(body.x - x0, body.z - z0);
  const down = moveBody(body, 0, -rose + Math.min(dy, 0), 0, world);
  if (rose > EPS && gotStep > gotPlain + EPS && down.y) return { x: across.x, y: true, z: across.z };
  body.x = plain[0];
  body.y = plain[1];
  body.z = plain[2];
  return hits;
}

/**
 * Is a block of boxes (a door, a bed, a slab, stairs, a fence, a pane) anywhere the body's box could
 * be during a move of (dx, dy, dz): in the box stretched by the move on each axis, and a block lower
 * (a fence's boxes reach up into the block above it)?
 */
function nearBox(body: Body, dx: number, dy: number, dz: number, world: BlockSource): boolean {
  const w = body.halfWidth;
  const x0 = Math.floor(body.x - w + Math.min(dx, 0) + EPS);
  const x1 = Math.floor(body.x + w + Math.max(dx, 0) - EPS);
  const y0 = Math.floor(body.y + Math.min(dy, 0) + EPS) - 1;
  const y1 = Math.floor(body.y + body.height + Math.max(dy, 0) - EPS);
  const z0 = Math.floor(body.z - w + Math.min(dz, 0) + EPS);
  const z1 = Math.floor(body.z + w + Math.max(dz, 0) - EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (SOLID_BOX[world.getBlock(x, y, z)] >= 2) return true;
  return false;
}

const solid = (world: BlockSource, x: number, y: number, z: number): boolean => !BLOCKS[world.getBlock(x, y, z)].passable;

/** Component `a` (0 x, 1 y, 2 z) of (x, y, z). */
const pick = (a: number, x: number, y: number, z: number): number => (a === 0 ? x : a === 1 ? y : z);

/**
 * What a body bumps into in each block: SOLID_BOX[b] 0 for passable blocks, 1 for a whole cube, 2
 * for boxes of its own (`BlockInfo.boxes`: a door's panel, a bed, a slab, stairs' two), which are
 * BOXES[k .. k + 5] for k from BOX_START[b] * 6 up to BOX_START[b + 1] * 6; 3 for a fence or pane,
 * whose boxes come from its neighbours (`connectedBoxes`, a fence's 1.5 high).
 */
const SOLID_BOX = new Uint8Array(256);
const BOX_START = new Uint16Array(257);
const BOXES = new Float64Array(BLOCKS.reduce((n, info) => n + (info.boxes?.length ?? 1), 0) * 6);
{
  let n = 0;
  BLOCKS.forEach((info, b) => {
    SOLID_BOX[b] = info.passable ? 0 : info.connects ? 3 : info.boxes ? 2 : 1;
    BOX_START[b] = n;
    for (const box of info.boxes ?? [[0, 0, 0, 1, 1, 1] as const]) BOXES.set(box, n++ * 6);
  });
  for (let b = BLOCKS.length; b <= 256; b++) BOX_START[b] = n;
}

/**
 * Move along one axis as far as `d`, stopping against the first solid thing ahead: a whole block's
 * face, or the face of a block's own box (a door's panel, a bed's top), which can be inside a block
 * the body is already in. A box the body already overlaps doesn't stop it. True if it stopped.
 */
function sweep(body: Body, axis: 0 | 1 | 2, d: number, world: BlockSource, boxed: boolean): boolean {
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
  // With boxes about, a block lower too on y (a fence below reaches up into the body's blocks).
  const reach = (a: number) => (boxed && a === 1 ? 1 : 0);
  const lo1 = Math.floor(min[a1] + EPS) - reach(a1);
  const hi1 = Math.floor(max[a1] - EPS);
  const lo2 = Math.floor(min[a2] + EPS) - reach(a2);
  const hi2 = Math.floor(max[a2] - EPS);
  /** The lowest block the body is in: whole blocks below it (the extra row) are never in the way. */
  const feet = Math.floor(min[1] + EPS);
  const cell = [0, 0, 0];
  /** One box, at (u, v) on the other two axes and `c` along the axis: the nearest face ahead so far. */
  let best = NaN;
  const boxStop = (u: number, v: number, c: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    // Clear of the body on the other two axes: no bump.
    if (u + pick(a1, x0, y0, z0) >= max[a1] - EPS || u + pick(a1, x1, y1, z1) <= min[a1] + EPS) return;
    if (v + pick(a2, x0, y0, z0) >= max[a2] - EPS || v + pick(a2, x1, y1, z1) <= min[a2] + EPS) return;
    const lo = c + pick(axis, x0, y0, z0);
    const hi = c + pick(axis, x1, y1, z1);
    if (d > 0) {
      if (lo >= face - EPS && lo <= face + d - EPS && !(lo >= best)) best = lo;
    } else if (hi <= face + EPS && hi >= face + d + EPS && !(hi <= best)) best = hi;
  };
  const face = d > 0 ? max[axis] : min[axis];
  /**
   * In the layer of blocks at `c` along the axis, the nearest face ahead within the move: the
   * lowest low side (moving up the axis) or the highest high side (moving down); NaN if none.
   */
  const layerStop = (c: number): number => {
    cell[axis] = c;
    best = NaN;
    for (let u = lo1; u <= hi1; u++) {
      cell[a1] = u;
      for (let v = lo2; v <= hi2; v++) {
        cell[a2] = v;
        const block = world.getBlock(cell[0], cell[1], cell[2]);
        const kind = SOLID_BOX[block];
        if (kind === 0) continue;
        if (kind === 1) {
          if (cell[1] < feet && axis !== 1) continue;
          if (d > 0) {
            if (c >= face - EPS && c <= face + d - EPS && !(c >= best)) best = c;
          } else if (c + 1 <= face + EPS && c + 1 >= face + d + EPS && !(c + 1 <= best)) best = c + 1;
          continue;
        }
        if (kind === 3) {
          // A fence or pane: its boxes by what's beside it.
          const kindOf = BLOCKS[block].connects!;
          for (const b of connectedBoxes(kindOf, joinsAt(world, kindOf, cell[0], cell[1], cell[2]), true)) boxStop(u, v, c, b[0], b[1], b[2], b[3], b[4], b[5]);
          continue;
        }
        for (let k = BOX_START[block] * 6, end = BOX_START[block + 1] * 6; k < end; k += 6)
          boxStop(u, v, c, BOXES[k], BOXES[k + 1], BOXES[k + 2], BOXES[k + 3], BOXES[k + 4], BOXES[k + 5]);
      }
    }
    return best;
  };

  let stop: number | null = null;
  if (d > 0) {
    // From the layer the body's low side is in (a box there may be ahead of it) to the move's end;
    // with no box about, from the first layer past its face, as only whole blocks can be there.
    for (let c = boxed ? Math.floor(min[axis] + EPS) : Math.floor(face - EPS) + 1; c <= Math.floor(face + d - EPS); c++) {
      const at = layerStop(c);
      if (at === at) {
        stop = at - above;
        break;
      }
    }
  } else {
    for (let c = boxed ? Math.floor(max[axis] - EPS) : Math.floor(face + EPS) - 1; c >= Math.floor(face + d + EPS) - reach(axis); c--) {
      const at = layerStop(c);
      if (at === at) {
        stop = at + below;
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

/**
 * Is the box in a liquid it overlaps? In a full block (a source, falling water), as soon as it
 * overlaps it; in shallower flowing water, only when the surface is more than `swim.wade` of the
 * body's height over its feet, so a puddle is waded through.
 */
export function touchesLiquid(body: Body, world: BlockSource): boolean {
  const wade = TUNING.player.swim.wade * body.height;
  return anyOverlapped(body, (x, y, z) => {
    const info = BLOCKS[world.getBlock(x, y, z)];
    if (!info.liquid) return false;
    return info.liquidHeight >= 1 || y + info.liquidHeight - body.y > wade;
  });
}

/** How deep the water in block (x, y, z) is: a full block with water above it, else its `liquidHeight` (0 if it isn't water). */
function depthAt(world: BlockSource, x: number, y: number, z: number): number {
  const info = BLOCKS[world.getBlock(x, y, z)];
  if (!info.liquid) return 0;
  return BLOCKS[world.getBlock(x, y + 1, z)].liquid ? 1 : info.liquidHeight;
}

/**
 * Which way the water the box is in flows, as a horizontal unit vector, or (0, 0) in still water.
 * Each water block it reaches below the surface of pushes towards each neighbour by how much
 * shallower that is: other water by the difference in depth, an open block over a drop (where
 * the water falls) by its whole depth. Sources among sources (the sea, a lake) don't push.
 */
export function currentAt(body: Body, world: BlockSource): [number, number] {
  let cx = 0;
  let cz = 0;
  anyOverlapped(body, (x, y, z) => {
    const h = depthAt(world, x, y, z);
    if (h === 0 || body.y >= y + h) return false;
    for (const [dx, dz] of SIDEWAYS) {
      const n = BLOCKS[world.getBlock(x + dx, y, z + dz)];
      let fall = 0;
      if (n.liquid) fall = h - depthAt(world, x + dx, y, z + dz);
      else if (n.passable && BLOCKS[world.getBlock(x + dx, y - 1, z + dz)].passable) fall = h;
      cx += dx * fall;
      cz += dz * fall;
    }
    return false;
  });
  const n = Math.hypot(cx, cz);
  return n > 1e-6 ? [cx / n, cz / n] : [0, 0];
}

const SIDEWAYS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Is the point (x, y, z) under a liquid's surface? */
export function underLiquid(world: BlockSource, x: number, y: number, z: number): boolean {
  const by = Math.floor(y);
  const info = BLOCKS[world.getBlock(Math.floor(x), by, Math.floor(z))];
  return info.liquid && y < by + info.liquidHeight;
}

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

/**
 * Is a block of kind `block` within `margin` of the body's box: beside it, under or over it (a
 * cactus felt)? The box's corners count too, a little generously.
 */
export function touches(body: Body, world: BlockSource, block: Block, margin = 0.05): boolean {
  const w = body.halfWidth + margin;
  for (let y = Math.floor(body.y - margin); y <= Math.floor(body.y + body.height + margin); y++)
    for (let z = Math.floor(body.z - w); z <= Math.floor(body.z + w); z++)
      for (let x = Math.floor(body.x - w); x <= Math.floor(body.x + w); x++) if (world.getBlock(x, y, z) === block) return true;
  return false;
}

/** Would a block at (x, y, z) overlap the body's box? Touching isn't overlapping. For placing blocks. */
export function overlapsBlock(body: Body, x: number, y: number, z: number, block?: Block): boolean {
  // A block of boxes (a door, a bed, a slab, stairs) only where its boxes are.
  const start = block !== undefined && SOLID_BOX[block] === 2 ? BOX_START[block] : -1;
  const end = start < 0 ? -1 : BOX_START[block! + 1];
  const overlaps = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    x + x0 < body.x + body.halfWidth - EPS &&
    x + x1 > body.x - body.halfWidth + EPS &&
    y + y0 < body.y + body.height - EPS &&
    y + y1 > body.y + EPS &&
    z + z0 < body.z + body.halfWidth - EPS &&
    z + z1 > body.z - body.halfWidth + EPS;
  if (start < 0) return overlaps(0, 0, 0, 1, 1, 1);
  for (let i = start; i < end; i++) {
    const k = i * 6;
    if (overlaps(BOXES[k], BOXES[k + 1], BOXES[k + 2], BOXES[k + 3], BOXES[k + 4], BOXES[k + 5])) return true;
  }
  return false;
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
  // Flowing water carries the body along: the velocity it heads for has the current added.
  const [fx, fz] = currentAt(body, world);
  const push = TUNING.water.push;
  let vx: number;
  let vz: number;
  let vy0: number;
  let vy: number;
  if (swimming) {
    // Water pulls every velocity towards the wanted one: across at swimming speed, up while
    // Space is held, otherwise down to a slow sink.
    const k = 1 - Math.exp(-swim.drag * dt);
    vx = body.vx + (wx * speed + fx * push - body.vx) * k;
    vz = body.vz + (wz * speed + fz * push - body.vz) * k;
    vy0 = body.vy;
    vy = vy0 + ((input.jump ? swim.upSpeed : -swim.maxSink) - vy0) * k;
  } else {
    // Turn the horizontal velocity towards the wanted one, by at most the acceleration.
    const maxChange = (body.onGround ? P.groundAccel : P.airAccel) * dt;
    const dvx = wx * speed + fx * push - body.vx;
    const dvz = wz * speed + fz * push - body.vz;
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
  // On the ground, walking or running (not crouching, not swimming), half a block is stepped up.
  const hits = body.onGround && !input.crouch && !swimming ? moveStepping(body, dx, dy, dz, world) : moveBody(body, dx, dy, dz, world);
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
  // Flowing water carries it along, as the player.
  const [fx, fz] = currentAt(body, world);
  const wantX = move.vx + fx * TUNING.water.push;
  const wantZ = move.vz + fz * TUNING.water.push;
  let vx: number;
  let vz: number;
  let vy0: number;
  let vy: number;
  if (body.inWater) {
    const k = 1 - Math.exp(-M.waterDrag * dt);
    vx = body.vx + (wantX - body.vx) * k;
    vz = body.vz + (wantZ - body.vz) * k;
    vy0 = body.vy;
    // Up while the head is under, otherwise sink back gently: it bobs at the surface.
    const headUnder = underLiquid(world, body.x, body.y + body.height * 0.6, body.z);
    vy = vy0 + ((headUnder ? M.floatSpeed : -0.5) - vy0) * k;
  } else {
    const maxChange = (body.onGround ? M.groundAccel : M.airAccel) * dt;
    const dvx = wantX - body.vx;
    const dvz = wantZ - body.vz;
    const change = Math.hypot(dvx, dvz);
    const k = change > maxChange ? maxChange / change : 1;
    vx = body.vx + dvx * k;
    vz = body.vz + dvz * k;
    vy0 = move.jump && body.onGround ? Math.sqrt(2 * P.gravity * move.jumpHeight) : body.vy;
    vy = Math.max(vy0 - P.gravity * dt, -P.terminalVelocity);
  }
  // On the ground, half a block is stepped up, as the player does.
  const mover = body.onGround && !body.inWater ? moveStepping : moveBody;
  const hits = mover(body, ((body.vx + vx) / 2) * dt, ((vy0 + vy) / 2) * dt, ((body.vz + vz) / 2) * dt, world);
  body.vx = hits.x ? 0 : vx;
  body.vy = hits.y ? 0 : vy;
  body.vz = hits.z ? 0 : vz;
  body.onGround = hits.y && vy0 + vy < 0;
  if (body.inWater && move.jump && (hits.x || hits.z)) body.vy = P.swim.exitBoost;
}
