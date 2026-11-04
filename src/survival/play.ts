// What breaking and placing do to a survival player's inventory, apart from the game so it can be
// tested: the selected slot's tool (if it holds one), breaking a block with it (the drops in, a
// wear on the tool), and the block a slot can place. Pure.

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

export interface Harvest {
  /** What went into the inventory. */
  got: Cost;
  /** What there was no room for (gone). */
  noRoom: Cost;
  /** The tool that wore out breaking it, if one did. */
  woreOut: number | null;
}

/**
 * Block `block` broken holding slot `slot`: its drops (from `roll`, in [0, 1)) into the inventory,
 * and the tool there worn by one (not with `wear` false: a torch that went with the block broken).
 */
export function harvest(inventory: Inventory, slot: number, block: Block, roll: number, wear = true): Harvest {
  const held = inventory.slots[slot];
  const tool = heldTool(inventory, slot);
  const got: [number, number][] = [];
  const noRoom: [number, number][] = [];
  for (const [item, n] of dropsOf(block, tool, roll)) {
    const left = inventory.add(item, n);
    if (n - left) got.push([item, n - left]);
    if (left) noRoom.push([item, left]);
  }
  const woreOut = wear && tool && held && inventory.wearTool(slot) ? held.item : null;
  return { got, noRoom, woreOut };
}
