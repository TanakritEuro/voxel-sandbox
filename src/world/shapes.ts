// Placing slabs and stairs (Milestone 14). Pure.
//
// - A slab goes in the lower half on a top face, the upper half on a ceiling, and on a side the
//   half of the side that was clicked.
// - A slab clicked onto the open half of a slab of its own material (its top, or an upper one's
//   underside), or put where one is in the other half, makes the whole block.
// - Stairs' back goes the way the player looks; they're upside down on a ceiling or the upper half
//   of a side.

import { Block, BLOCKS, facingFromYaw, SHAPE_MATERIALS, slab, slabOf, stairs, stairsOf } from './blocks';

interface Blocks {
  getBlock(x: number, y: number, z: number): Block;
}

/** What the click hit: the block, the face's normal, and where on it (the hit point's height). */
export interface ShapeClick {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** The hit point's height (world y). */
  py: number;
}

/** Is `block` a slab or stairs, placed by `shapePlacement`? */
export const isShape = (block: Block): boolean => slabOf(block) !== null || stairsOf(block) !== null;

/** The upper half of a side, a ceiling: what makes a slab upper and stairs upside down. */
function high(click: ShapeClick): boolean {
  if (click.ny > 0) return false;
  if (click.ny < 0) return true;
  return click.py - Math.floor(click.py) >= 0.5;
}

/** Can a block go at (x, y, z): nothing there but air or a liquid? */
const free = (world: Blocks, x: number, y: number, z: number): boolean => {
  const b = world.getBlock(x, y, z);
  return b === Block.Air || BLOCKS[b].liquid;
};

/**
 * Where and what placing `item` (a slab or stairs as the hotbar holds it) on `click` makes, by a
 * player looking along `yaw`: the place and block, or null if it can't go.
 */
export function shapePlacement(world: Blocks, item: Block, click: ShapeClick, yaw: number): [number, number, number, Block] | null {
  const s = slabOf(item);
  if (s) {
    const whole = SHAPE_MATERIALS[s.material].block;
    // Onto the open half of its own kind: the whole block, there.
    const on = slabOf(world.getBlock(click.x, click.y, click.z));
    if (on && on.material === s.material && ((click.ny > 0 && !on.upper) || (click.ny < 0 && on.upper))) return [click.x, click.y, click.z, whole];
    const x = click.x + click.nx;
    const y = click.y + click.ny;
    const z = click.z + click.nz;
    const upper = high(click);
    // Where one of its kind is in the other half: whole.
    const there = slabOf(world.getBlock(x, y, z));
    if (there) return there.material === s.material && there.upper !== upper ? [x, y, z, whole] : null;
    return free(world, x, y, z) ? [x, y, z, slab(s.material, upper)] : null;
  }
  const t = stairsOf(item);
  if (t) {
    const x = click.x + click.nx;
    const y = click.y + click.ny;
    const z = click.z + click.nz;
    return free(world, x, y, z) ? [x, y, z, stairs(t.material, facingFromYaw(yaw), high(click))] : null;
  }
  return null;
}
