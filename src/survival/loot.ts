// Loot (Milestone 16): what a structure's chest holds the first time anyone opens or breaks it,
// from a table by the structure's kind, seeded by the chest's place: the same chest always holds
// the same. `Chests` fills it once and never again. Pure.

import { createRng, hash3 } from '../math';
import { Block } from '../world/blocks';
import { StructureKind } from '../world/structures';
import { CHEST_SLOTS } from './chest';
import type { Stack } from './inventory';
import { Item } from './items';

/** A line of a loot table: the item, how many (min..max), and the chance it's there at all. */
type Line = [item: number, min: number, max: number, chance: number];

/** Ruins: what was left behind, ores and tools. */
const RUIN: readonly Line[] = [
  [Item.Coal, 2, 8, 0.8],
  [Item.Copper, 2, 6, 0.5],
  [Item.Iron, 1, 4, 0.5],
  [Item.Crystal, 1, 2, 0.15],
  [Block.Torch, 2, 6, 0.5],
  [Item.Bread, 1, 2, 0.3],
  [Item.Seeds, 2, 4, 0.3],
  [Item.StonePick, 1, 1, 0.25],
  [Item.IronPick, 1, 1, 0.08],
];

/** Camps: provisions, light and an axe. */
const CAMP: readonly Line[] = [
  [Item.Bread, 1, 4, 0.8],
  [Item.Berries, 2, 6, 0.6],
  [Item.Seeds, 2, 6, 0.5],
  [Block.Torch, 3, 8, 0.7],
  [Item.Stick, 2, 6, 0.4],
  [Item.Coal, 1, 4, 0.5],
  [Item.Iron, 1, 2, 0.2],
  [Item.StoneAxe, 1, 1, 0.3],
  [Item.IronAxe, 1, 1, 0.05],
];

/** Dungeons (version 3): better than a ruin's: iron, crystal, an iron tool now and then, things to see by. */
const DUNGEON: readonly Line[] = [
  // Always some iron: a dungeon's chest is never empty.
  [Item.Iron, 3, 8, 1],
  [Item.RawIron, 2, 6, 0.5],
  [Item.Crystal, 1, 4, 0.6],
  [Item.Coal, 4, 12, 0.6],
  [Block.Torch, 4, 12, 0.6],
  [Block.Lantern, 1, 3, 0.4],
  [Item.Bread, 2, 4, 0.5],
  [Item.CookedMeat, 1, 3, 0.3],
  [Block.Rail, 6, 16, 0.25],
  [Item.IronPick, 1, 1, 0.3],
  [Item.IronSpade, 1, 1, 0.15],
  [Item.IronAxe, 1, 1, 0.15],
];

/** A settlement's huts (version 4): a household's things, food and the makings of more. */
const HUT: readonly Line[] = [
  [Item.Bread, 1, 3, 0.7],
  [Item.Wheat, 2, 6, 0.6],
  [Item.Seeds, 2, 6, 0.5],
  [Item.Berries, 2, 5, 0.3],
  [Block.Torch, 2, 4, 0.5],
  [Block.Planks, 4, 8, 0.4],
  [Item.Stick, 2, 4, 0.3],
  [Block.Thatch, 2, 4, 0.2],
  [Block.Lantern, 1, 1, 0.1],
];

export const LOOT: Record<StructureKind, readonly Line[]> = { [StructureKind.Ruin]: RUIN, [StructureKind.Camp]: CAMP, [StructureKind.Dungeon]: DUNGEON, [StructureKind.Hut]: HUT };

/** The slots of the chest of a structure of `kind` at (x, y, z): each line's stack, if it comes up, in a slot of its own. */
export function lootFor(seed: number, kind: StructureKind, x: number, y: number, z: number): (Stack | null)[] {
  const rng = createRng(Math.floor(hash3(seed ^ 0x100f, x, y, z) * 4294967296));
  const slots = new Array<Stack | null>(CHEST_SLOTS).fill(null);
  for (const [item, min, max, chance] of LOOT[kind]) {
    if (rng() >= chance) continue;
    const count = min + Math.floor(rng() * (max - min + 1));
    // A slot not taken yet, anywhere in the chest.
    let slot = Math.floor(rng() * CHEST_SLOTS);
    while (slots[slot]) slot = (slot + 1) % CHEST_SLOTS;
    slots[slot] = { item, count };
  }
  return slots;
}

/** What a world answers about its structures' chests (`Generator`). */
export interface LootWorld {
  seed: number;
  lootAt(x: number, y: number, z: number): StructureKind | null;
}

/** The loot source for a world's `Chests`: a structure's chest's slots, or null where no structure's chest is. */
export const lootSource =
  (world: LootWorld) =>
  (x: number, y: number, z: number): (Stack | null)[] | null => {
    const kind = world.lootAt(x, y, z);
    return kind === null ? null : lootFor(world.seed, kind, x, y, z);
  };
