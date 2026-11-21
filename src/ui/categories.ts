// Where things go on the screens that list them (Milestone 20): the block picker's tabs, and crafting's
// groups. Every placeable block has a kind and every recipe a group, named here one by one (tests check
// none is missing), so a new block or recipe has to be given a place. Pure.

import type { Recipe } from '../survival/crafting';
import { Item } from '../survival/items';
import { Block, BLOCKS, slabOf, stairsOf } from '../world/blocks';

export const BLOCK_KINDS = ['Building', 'Nature', 'Home', 'Light', 'Logic', 'Travel', 'Deep'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

const KIND_OF = new Map<Block, BlockKind>();
const put = (kind: BlockKind, blocks: readonly Block[]) => blocks.forEach((b) => KIND_OF.set(b, kind));
put('Building', [Block.Stone, Block.Planks, Block.Glass, Block.Sandstone, Block.StoneBricks, Block.MossyBricks, Block.Fence, Block.Pane]);
put('Nature', [
  Block.Dirt,
  Block.Grass,
  Block.Sand,
  Block.Water,
  Block.Wood,
  Block.Leaves,
  Block.Snow,
  Block.SnowyGrass,
  Block.Gravel,
  Block.CoalOre,
  Block.IronOre,
  Block.CopperOre,
  Block.CrystalOre,
  Block.SpruceWood,
  Block.SpruceLeaves,
  Block.Cactus,
  Block.DryGrass,
  Block.Mud,
  Block.Reeds,
  Block.ParasolWood,
  Block.ParasolLeaves,
]);
put('Home', [Block.Furnace, Block.Chest, Block.Door, Block.Bed]);
put('Light', [Block.Torch, Block.Lamp, Block.Lantern]);
put('Logic', [Block.Wire, Block.Switch, Block.Button, Block.SignalLamp, Block.ChargedBlock, Block.Inverter, Block.Delay]);
put('Travel', [Block.Rail, Block.PoweredRail]);
put('Deep', [Block.CrystalCluster, Block.GrottoFloor, Block.MushroomStem, Block.MushroomCap, Block.Lava, Block.Basalt]);

/** A placeable block's tab in the picker (slabs and stairs are Building); undefined for one not given a place. */
export function kindOf(block: Block): BlockKind | undefined {
  if (slabOf(block) || stairsOf(block)) return 'Building';
  return KIND_OF.get(block);
}

/** Does `block`'s name match what's typed? Any part of it, any case; nothing typed matches everything. */
export function nameMatches(block: Block, typed: string): boolean {
  const t = typed.trim().toLowerCase();
  return t === '' || BLOCKS[block].name.toLowerCase().includes(t);
}

export const RECIPE_GROUPS = ['Basics', 'Tools', 'Building', 'Light', 'Logic', 'Travel', 'Food'] as const;
export type RecipeGroup = (typeof RECIPE_GROUPS)[number];

const GROUP_OF = new Map<number, RecipeGroup>();
const group = (g: RecipeGroup, items: readonly number[]) => items.forEach((i) => GROUP_OF.set(i, g));
group('Basics', [Block.Planks, Item.Stick, Item.Paper]);
group('Tools', [Item.WoodPick, Item.WoodAxe, Item.WoodSpade, Item.StonePick, Item.StoneAxe, Item.StoneSpade, Item.IronPick, Item.IronAxe, Item.IronSpade]);
group('Building', [Block.StoneBricks, Block.Sandstone, Block.Pane, Block.Fence, Block.Furnace, Block.Chest, Block.Door, Block.Bed]);
group('Light', [Block.Torch, Block.Lantern, Block.Lamp]);
group('Logic', [Block.Wire, Block.Switch, Block.Button, Block.SignalLamp, Block.ChargedBlock, Block.Inverter, Block.Delay]);
group('Travel', [Block.Rail, Block.PoweredRail, Item.Cart, Item.ChestCart, Item.Boat, Item.Map]);
group('Food', [Item.Bread]);

/** A recipe's group in the crafting list (slabs and stairs are Building); undefined for one not given a place. */
export function groupOf(recipe: Recipe): RecipeGroup | undefined {
  if (slabOf(recipe.makes as Block) || stairsOf(recipe.makes as Block)) return 'Building';
  return GROUP_OF.get(recipe.makes);
}
