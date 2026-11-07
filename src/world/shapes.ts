// Placing slabs and stairs (Milestone 14). Pure.
//
// - A slab goes in the lower half on a top face, the upper half on a ceiling, and on a side the
//   half of the side that was clicked.
// - A slab clicked onto the open half of a slab of its own material (its top, or an upper one's
//   underside), or put where one is in the other half, makes the whole block.
// - Stairs' back goes the way the player looks; they're upside down on a ceiling or the upper half
//   of a side.

import { Block, BLOCKS, type Box, facingFromYaw, SHAPE_MATERIALS, slab, slabOf, stairs, stairsOf } from './blocks';

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

// --- Fences and panes ---------------------------------------------------------------------------

const px = (n: number) => n / 16;

/** Do a fence or pane of kind `kind` and the block `nb` beside it join: the same kind, or a whole solid block? */
export function joins(kind: 'fence' | 'pane', nb: Block): boolean {
  const info = BLOCKS[nb];
  return info.connects === kind || (info.opaque && info.shape === 'cube');
}

/** Which of its four sides (bits by `FACINGS` index: +x, -x, +z, -z) the fence or pane at (x, y, z) joins. */
export function joinsAt(world: Blocks, kind: 'fence' | 'pane', x: number, y: number, z: number): number {
  return (
    (joins(kind, world.getBlock(x + 1, y, z)) ? 1 : 0) |
    (joins(kind, world.getBlock(x - 1, y, z)) ? 2 : 0) |
    (joins(kind, world.getBlock(x, y, z + 1)) ? 4 : 0) |
    (joins(kind, world.getBlock(x, y, z - 1)) ? 8 : 0)
  );
}

/** An arm from the middle band (`a` to `b` across) to side `side` (a `FACINGS` index), from height y0 to y1. */
function arm(side: number, a: number, b: number, y0: number, y1: number): Box {
  switch (side) {
    case 0:
      return [b, y0, a, 1, y1, b];
    case 1:
      return [0, y0, a, a, y1, b];
    case 2:
      return [a, y0, b, b, y1, 1];
    default:
      return [a, y0, 0, b, y1, a];
  }
}

/**
 * A fence's or pane's boxes, joining the sides in `sides` (bits as `joinsAt`):
 * - a fence drawn: a post (4/16 across) and two rails (2/16 thick) to each side it joins;
 * - a fence bumped into (`collision`): the post and a bar to each side, 1.5 high, so it can't be jumped;
 * - a pane: a sheet 2/16 thick from the middle to each side it joins, or to all four with none.
 */
export function connectedBoxes(kind: 'fence' | 'pane', sides: number, collision = false): Box[] {
  const out: Box[] = [];
  if (kind === 'fence') {
    const top = collision ? 1.5 : 1;
    out.push([px(6), 0, px(6), px(10), top, px(10)]);
    for (let side = 0; side < 4; side++) {
      if (!(sides & (1 << side))) continue;
      if (collision) out.push(arm(side, px(6), px(10), 0, 1.5));
      else out.push(arm(side, px(7), px(9), px(6), px(9)), arm(side, px(7), px(9), px(12), px(15)));
    }
    return out;
  }
  out.push([px(7), 0, px(7), px(9), 1, px(9)]);
  const to = sides || 15;
  for (let side = 0; side < 4; side++) if (to & (1 << side)) out.push(arm(side, px(7), px(9), 0, 1));
  return out;
}

/** The boxes of the block at (x, y, z) as drawn (and clicked): its own, a fence's or pane's by its neighbours; null for a whole cube. */
export function blockBoxes(world: Blocks, x: number, y: number, z: number): readonly Box[] | null {
  const info = BLOCKS[world.getBlock(x, y, z)];
  if (info.connects) return connectedBoxes(info.connects, joinsAt(world, info.connects, x, y, z));
  return info.boxes ?? null;
}
