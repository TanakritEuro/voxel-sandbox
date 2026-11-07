// Blocks in pairs: a door is two blocks (lower and upper half), a bed two (foot and head). Placing
// one makes both, or neither when there isn't room; breaking either takes the other with it, as a
// block takes the torches it holds up. Pure.

import { Block, BLOCKS, bed, bedOf, door, doorOf, FACINGS, facingFromYaw, useBlock } from './blocks';

interface Blocks {
  getBlock(x: number, y: number, z: number): Block;
}

/** A block to set: where, and what. */
export type Part = [number, number, number, Block];

/** Is `block` one of a pair (a door's half, a bed's)? */
export const isPaired = (block: Block): boolean => doorOf(block) !== null || bedOf(block) !== null;

/** The step from a half to its other half; null for blocks that aren't in pairs. */
export function partnerStep(block: Block): [number, number, number] | null {
  const d = doorOf(block);
  if (d) return [0, d.upper ? -1 : 1, 0];
  const b = bedOf(block);
  if (b) {
    const [fx, fz] = FACINGS[b.facing];
    return b.head ? [-fx, 0, -fz] : [fx, 0, fz];
  }
  return null;
}

/** Does `other` belong with `block` as its other half (the same door or bed)? */
function matches(block: Block, other: Block): boolean {
  const d = doorOf(block);
  const o = doorOf(other);
  if (d && o) return d.facing === o.facing && d.upper !== o.upper;
  const b = bedOf(block);
  const p = bedOf(other);
  return !!b && !!p && b.facing === p.facing && b.head !== p.head;
}

/** Where the other half of the block at (x, y, z) is, if it's there; null if it isn't (or the block isn't paired). */
export function partnerOf(world: Blocks, x: number, y: number, z: number): [number, number, number] | null {
  const block = world.getBlock(x, y, z);
  const step = partnerStep(block);
  if (!step) return null;
  const [px, py, pz] = [x + step[0], y + step[1], z + step[2]];
  return matches(block, world.getBlock(px, py, pz)) ? [px, py, pz] : null;
}

/** Can a half go at (x, y, z): nothing there but air or a liquid? */
const free = (world: Blocks, x: number, y: number, z: number): boolean => {
  const b = world.getBlock(x, y, z);
  return b === Block.Air || BLOCKS[b].liquid;
};

/** Something solid to stand on under (x, y, z)? */
const floor = (world: Blocks, x: number, y: number, z: number): boolean => BLOCKS[world.getBlock(x, y - 1, z)].opaque;

/**
 * The blocks placing a door or bed (`item`, as the hotbar holds it) at (x, y, z) makes, by a player
 * looking along `yaw`: a door's lower half there and its upper above, a bed's foot there and its
 * head the way they look. Null when either place isn't free or there's no floor under it.
 */
export function pairPlacement(world: Blocks, item: Block, x: number, y: number, z: number, yaw: number): Part[] | null {
  const facing = facingFromYaw(yaw);
  if (doorOf(item)) {
    if (!free(world, x, y, z) || !free(world, x, y + 1, z) || !floor(world, x, y, z)) return null;
    return [
      [x, y, z, door(facing, false, false)],
      [x, y + 1, z, door(facing, false, true)],
    ];
  }
  if (bedOf(item)) {
    const [fx, fz] = FACINGS[facing];
    const hx = x + fx;
    const hz = z + fz;
    if (!free(world, x, y, z) || !free(world, hx, y, hz) || !floor(world, x, y, z) || !floor(world, hx, y, hz)) return null;
    return [
      [x, y, z, bed(facing, false)],
      [hx, y, hz, bed(facing, true)],
    ];
  }
  return null;
}

/**
 * What a right click on the block at (x, y, z) sets (`useBlock`): a door's two halves opened or
 * shut together, or the one block for anything else to use; null if it isn't something to use.
 */
export function useAt(world: Blocks, x: number, y: number, z: number): Part[] | null {
  const block = world.getBlock(x, y, z);
  const used = useBlock(block);
  if (used === null) return null;
  const out: Part[] = [[x, y, z, used]];
  const d = doorOf(block);
  const partner = d ? partnerOf(world, x, y, z) : null;
  if (d && partner) out.push([partner[0], partner[1], partner[2], door(d.facing, !d.open, !d.upper)]);
  return out;
}
