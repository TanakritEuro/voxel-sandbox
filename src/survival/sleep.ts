// Beds (Milestone 13): whether a player may sleep, and where they wake. Pure.
//
// - Sleeping is for the night (daylight under `TUNING.sleep.night`), and not with a hostile mob
//   within `TUNING.sleep.near` blocks.
// - A bed clicked in survival becomes where its player wakes after dying (kept with the inventory,
//   by the place of its foot). Waking is beside the bed, on the floor, where there's room; on top of
//   it if there's none round it. A bed that's gone wakes nobody.

import { TUNING } from '../config';
import { BLOCKS, bedOf, type Block, FACINGS } from '../world/blocks';
import { partnerStep } from '../world/parts';

interface Blocks {
  getBlock(x: number, y: number, z: number): Block;
}

/** Where a bed is: its foot's block. */
export type BedPlace = [number, number, number];

/** Why not: 'day' (the sun is up), 'near' (something hostile is close); or 'ok'. */
export type SleepCheck = 'ok' | 'day' | 'near';

/** May a player sleep with the sky at `daylight`, the nearest hostile mob `nearest` blocks away (Infinity: none)? */
export function canSleep(daylight: number, nearest: number): SleepCheck {
  if (daylight >= TUNING.sleep.night) return 'day';
  if (nearest <= TUNING.sleep.near) return 'near';
  return 'ok';
}

/** The foot of the bed with a half at (x, y, z); null if there's no bed there. */
export function bedFoot(world: Blocks, x: number, y: number, z: number): BedPlace | null {
  const b = bedOf(world.getBlock(x, y, z));
  if (!b) return null;
  if (!b.head) return [x, y, z];
  const step = partnerStep(world.getBlock(x, y, z))!;
  return [x + step[0], y + step[1], z + step[2]];
}

/** A kept bed from what was saved: three whole numbers, or null. */
export function bedFrom(saved: unknown): BedPlace | null {
  if (!Array.isArray(saved) || saved.length !== 3 || !saved.every(Number.isInteger)) return null;
  return [saved[0], saved[1], saved[2]];
}

/** Is there room for a body to stand with its feet in block (x, y, z): two free blocks, a solid one under? */
function room(world: Blocks, x: number, y: number, z: number): boolean {
  return BLOCKS[world.getBlock(x, y, z)].passable && BLOCKS[world.getBlock(x, y + 1, z)].passable && !BLOCKS[world.getBlock(x, y - 1, z)].passable;
}

/**
 * Where to wake for the bed whose foot is at `foot`: the feet's place (the middle of a block's
 * floor) beside the foot or the head, the foot's sides first; on the bed if there's no room round
 * it; null if the bed is gone.
 */
export function wakeAt(world: Blocks, foot: BedPlace): [number, number, number] | null {
  const [x, y, z] = foot;
  const b = bedOf(world.getBlock(x, y, z));
  if (!b || b.head) return null;
  const [fx, fz] = FACINGS[b.facing];
  // Beside the foot, then beside the head, then off the foot's end.
  const spots: [number, number][] = [
    [x + fz, z - fx],
    [x - fz, z + fx],
    [x + fx + fz, z + fz - fx],
    [x + fx - fz, z + fz + fx],
    [x - fx, z - fz],
  ];
  for (const [sx, sz] of spots) if (room(world, sx, y, sz)) return [sx + 0.5, y, sz + 0.5];
  return [x + 0.5, y + TUNING.sleep.onBed, z + 0.5];
}
