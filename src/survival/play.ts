// What breaking and placing do in survival, apart from the game so it can be tested: the selected
// slot's tool (if it holds one), breaking a block with it (what it gives, for the ground, and a wear
// on the tool), and the block a slot can place. Pure.

import { type Block } from '../world/blocks';
import { dropsOf } from './drops';
import type { Cost, Inventory } from './inventory';
import { isBlockItem, type Tool, toolOf } from './items';

/** The tool in slot `slot`, if it holds one (else the hand). */
export const heldTool = (inventory: Inventory, slot: number): Tool | undefined => toolOf(inventory.slots[slot]?.item);

/** The block slot `slot` can place, or null (empty, or not a block). */
export function placeableIn(inventory: Inventory, slot: number): Block | null {
  const item = inventory.slots[slot]?.item;
  return item !== undefined && isBlockItem(item) ? item : null;
}

export interface Broken {
  /** What it gives, to drop on the ground. */
  drops: Cost;
  /** The tool that wore out breaking it, if one did. */
  woreOut: number | null;
}

/**
 * Block `block` broken holding slot `slot`: what it gives (from `roll`, in [0, 1)), and the tool
 * there worn by one (not with `wear` false: a torch that went with the block broken).
 */
export function breakWith(inventory: Inventory, slot: number, block: Block, roll: number, wear = true): Broken {
  const held = inventory.slots[slot];
  const tool = heldTool(inventory, slot);
  const drops = dropsOf(block, tool, roll);
  const woreOut = wear && tool && held && inventory.wearTool(slot) ? held.item : null;
  return { drops, woreOut };
}
