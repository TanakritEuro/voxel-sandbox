// Crafting, from a list (not a grid to arrange): each recipe spends its cost from the inventory and
// adds what it makes. Made only if the inventory has the cost and what's made fits once the cost is
// spent. Pure.

import { Block } from '../world/blocks';
import { type Cost, Inventory } from './inventory';
import { Item } from './items';

export interface Recipe {
  makes: number;
  count: number;
  cost: Cost;
}

const r = (makes: number, count: number, ...cost: [number, number][]): Recipe => ({ makes, count, cost });

/** Every recipe, in the order the inventory screen lists them. */
export const RECIPES: readonly Recipe[] = [
  r(Block.Planks, 4, [Block.Wood, 1]),
  r(Block.Planks, 4, [Block.SpruceWood, 1]),
  r(Item.Stick, 4, [Block.Planks, 2]),
  r(Block.Torch, 4, [Item.Stick, 1], [Item.Coal, 1]),
  r(Block.Torch, 4, [Item.Stick, 1], [Item.Ember, 1]),
  ...(
    [
      [Block.Planks, Item.WoodPick],
      [Block.Stone, Item.StonePick],
      [Item.Iron, Item.IronPick],
    ] as const
  ).flatMap(([from, pick]) => [r(pick, 1, [from, 3], [Item.Stick, 2]), r(pick + 1, 1, [from, 3], [Item.Stick, 2]), r(pick + 2, 1, [from, 1], [Item.Stick, 2])]),
  r(Block.Furnace, 1, [Block.Stone, 8]),
  r(Block.Chest, 1, [Block.Planks, 8]),
  r(Block.Door, 1, [Block.Planks, 6]),
  r(Block.Sandstone, 1, [Block.Sand, 4]),
  r(Block.Lamp, 1, [Block.Glass, 4], [Item.Crystal, 1]),
  r(Block.Wire, 8, [Item.Copper, 1]),
  r(Block.Switch, 1, [Item.Copper, 1], [Item.Stick, 1], [Block.Stone, 1]),
  r(Block.Button, 1, [Item.Copper, 1], [Block.Stone, 1]),
  r(Block.SignalLamp, 1, [Block.Glass, 1], [Item.Copper, 2]),
  r(Block.ChargedBlock, 1, [Item.Copper, 4], [Item.Crystal, 1]),
  r(Block.Inverter, 1, [Item.Copper, 3], [Block.Stone, 1]),
  r(Block.Delay, 1, [Item.Copper, 3], [Block.Stone, 1], [Item.Coal, 1]),
];

/** Can `recipe` be made once now: the cost there, and what it makes fitting after spending it? */
export function canMake(inventory: Inventory, recipe: Recipe): boolean {
  if (!inventory.has(recipe.cost)) return false;
  const after = inventory.clone();
  after.spend(recipe.cost);
  return after.fits([[recipe.makes, recipe.count]]);
}

/** Make `recipe` up to `times` times (as many as can be, for Infinity); returns how many times it was made. */
export function make(inventory: Inventory, recipe: Recipe, times = 1): number {
  let made = 0;
  while (made < times && canMake(inventory, recipe)) {
    inventory.spend(recipe.cost);
    inventory.add(recipe.makes, recipe.count);
    made++;
  }
  return made;
}
