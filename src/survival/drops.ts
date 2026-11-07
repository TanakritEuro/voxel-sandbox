// What breaking a block gives in a survival world, and how long it takes with what's held. Stone
// and ores need a pick good enough for them: with less they take `TUNING.survival.withoutPick`
// times as long and give nothing. The right tool divides a block's hardness by its speed. Leaves'
// sticks come from a roll the caller makes (seeded, so a test can say what drops). Pure.

import { TUNING } from '../config';
import { bedOf, Block, BLOCKS, chestOf, doorOf, furnace, furnaceOf, gateOf, isTorch, PLACEABLE, SHAPE_MATERIALS, slab, slabOf, stairs, stairsOf, wheatStage, wirePower } from '../world/blocks';
import type { Cost } from './inventory';
import { Item, type Tool, type ToolKind } from './items';

const RIGHT_TOOL = new Map<Block, ToolKind>();
for (const b of [Block.Stone, Block.Sandstone, Block.CoalOre, Block.CopperOre, Block.IronOre, Block.CrystalOre, Block.Lamp, Block.ChargedBlock, Block.SignalLamp, Block.SignalLampOn])
  RIGHT_TOOL.set(b, 'pick');
for (let f = 0; f < 4; f++) for (const lit of [false, true]) RIGHT_TOOL.set(furnace(f, lit), 'pick');
for (const b of [Block.Wood, Block.SpruceWood, Block.Planks]) RIGHT_TOOL.set(b, 'axe');
// Chests, doors and beds: wood.
for (let b = Block.Chest; b < Block.Farmland; b++) RIGHT_TOOL.set(b as Block, 'axe');
for (const b of [Block.Dirt, Block.Grass, Block.Sand, Block.Gravel, Block.Snow, Block.SnowyGrass, Block.Farmland]) RIGHT_TOOL.set(b, 'spade');

// Slabs and stairs dig as their material does.
for (let b = Block.Slab; b < Block.Stairs + 24; b++) {
  const m = SHAPE_MATERIALS[(slabOf(b as Block) ?? stairsOf(b as Block))!.material].block;
  const tool = RIGHT_TOOL.get(m);
  if (tool) RIGHT_TOOL.set(b as Block, tool);
}

/** The pick tier a block needs to give anything (1 wood, 2 stone, 3 iron). */
const PICK_TIER = new Map<Block, number>([
  [Block.Stone, 1],
  [Block.Sandstone, 1],
  [Block.CoalOre, 1],
  [Block.CopperOre, 2],
  [Block.IronOre, 2],
  [Block.CrystalOre, 3],
  ...[0, 1, 2, 3].flatMap((f) => [false, true].map((lit) => [furnace(f, lit), 1] as [Block, number])),
]);
for (let b = Block.Slab; b < Block.Stairs + 24; b++) {
  const tier = PICK_TIER.get(SHAPE_MATERIALS[(slabOf(b as Block) ?? stairsOf(b as Block))!.material].block);
  if (tier) PICK_TIER.set(b as Block, tier);
}

/** What a block gives, when it isn't itself. */
const GIVES = new Map<Block, number>([
  [Block.Grass, Block.Dirt],
  [Block.SnowyGrass, Block.Dirt],
  [Block.Farmland, Block.Dirt],
  [Block.CoalOre, Item.Coal],
  [Block.CopperOre, Item.RawCopper],
  [Block.IronOre, Item.RawIron],
  [Block.CrystalOre, Item.Crystal],
  [Block.SignalLampOn, Block.SignalLamp],
  [Block.SwitchOn, Block.Switch],
  [Block.ButtonOn, Block.Button],
]);

const PLACEABLE_SET = new Set<number>(PLACEABLE);

/** The tool that digs `block` faster, if one does. */
export const rightTool = (block: Block): ToolKind | null => RIGHT_TOOL.get(block) ?? null;

/** The pick tier `block` needs to give anything; 0 if it needs none. */
export const pickTier = (block: Block): number => PICK_TIER.get(block) ?? 0;

/** Is `tool` (or the hand) good enough for `block` to give anything? */
export const canHarvest = (block: Block, tool: Tool | undefined): boolean => {
  const need = pickTier(block);
  return need === 0 || (tool?.kind === 'pick' && tool.tier >= need);
};

/** Seconds to break `block` holding `tool` (undefined: the hand, or something that isn't a tool). */
export function digTime(block: Block, tool: Tool | undefined): number {
  const hardness = BLOCKS[block].hardness;
  if (!canHarvest(block, tool)) return hardness * TUNING.survival.withoutPick;
  return tool && tool.kind === rightTool(block) ? hardness / tool.speed : hardness;
}

/**
 * What breaking `block` with `tool` gives: usually the block itself, as placed (a lit lamp a lamp,
 * powered wire wire, a gate off facing the first way), something else for grass and ores, nothing
 * from glass or without the pick a block needs, and from leaves a stick when `roll` (in [0, 1)) is
 * under one in `TUNING.survival.leafStick`, or berries in the one in `leafBerries` after that; seeds
 * from grass by the roll too, and wheat's seeds.
 */
export function dropsOf(block: Block, tool: Tool | undefined, roll: number): Cost {
  if (!canHarvest(block, tool)) return [];
  if (block === Block.Leaves || block === Block.SpruceLeaves) {
    const stick = 1 / TUNING.survival.leafStick;
    return roll < stick ? [[Item.Stick, 1]] : roll < stick + 1 / TUNING.survival.leafBerries ? [[Item.Berries, 1]] : [];
  }
  if (block === Block.Glass) return [];
  // Grass gives its dirt, and seeds one time in `farming.seedsFromGrass`; wheat ripe gives wheat and
  // 1 to `farming.ripeSeeds` seeds, unripe just its seed back.
  const F = TUNING.survival.farming;
  if (block === Block.Grass) return roll < 1 / F.seedsFromGrass ? [[Block.Dirt, 1], [Item.Seeds, 1]] : [[Block.Dirt, 1]];
  const stage = wheatStage(block);
  if (stage === 7) return [[Item.Wheat, 1], [Item.Seeds, 1 + Math.floor(roll * F.ripeSeeds)]];
  if (stage >= 0) return [[Item.Seeds, 1]];
  const given = GIVES.get(block);
  if (given !== undefined) return [[given, 1]];
  if (isTorch(block)) return [[Block.Torch, 1]];
  if (wirePower(block) >= 0) return [[Block.Wire, 1]];
  const gate = gateOf(block);
  if (gate) return [[gate.kind === 'inverter' ? Block.Inverter : Block.Delay, 1]];
  if (furnaceOf(block)) return [[Block.Furnace, 1]];
  // Either half of a door or bed gives the one (the other half goes with it, giving nothing).
  if (chestOf(block)) return [[Block.Chest, 1]];
  if (doorOf(block)) return [[Block.Door, 1]];
  if (bedOf(block)) return [[Block.Bed, 1]];
  // A slab or stairs, as the picker has them (a slab made whole is its block, and gives that).
  const sl = slabOf(block);
  if (sl) return [[slab(sl.material, false), 1]];
  const st = stairsOf(block);
  if (st) return [[stairs(st.material, 0, false), 1]];
  return PLACEABLE_SET.has(block) ? [[block, 1]] : [];
}
