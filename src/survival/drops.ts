// What breaking a block gives in a survival world, and how long it takes with what's held. Stone
// and ores need a pick good enough for them: with less they take `TUNING.survival.withoutPick`
// times as long and give nothing. The right tool divides a block's hardness by its speed. Leaves'
// sticks come from a roll the caller makes (seeded, so a test can say what drops). Pure.

import { TUNING } from '../config';
import { Block, BLOCKS, furnace, furnaceOf, gateOf, isTorch, PLACEABLE, wirePower } from '../world/blocks';
import type { Cost } from './inventory';
import { Item, type Tool, type ToolKind } from './items';

const RIGHT_TOOL = new Map<Block, ToolKind>();
for (const b of [Block.Stone, Block.Sandstone, Block.CoalOre, Block.CopperOre, Block.IronOre, Block.CrystalOre, Block.Lamp, Block.ChargedBlock, Block.SignalLamp, Block.SignalLampOn])
  RIGHT_TOOL.set(b, 'pick');
for (let f = 0; f < 4; f++) for (const lit of [false, true]) RIGHT_TOOL.set(furnace(f, lit), 'pick');
for (const b of [Block.Wood, Block.SpruceWood, Block.Planks]) RIGHT_TOOL.set(b, 'axe');
for (const b of [Block.Dirt, Block.Grass, Block.Sand, Block.Gravel, Block.Snow, Block.SnowyGrass]) RIGHT_TOOL.set(b, 'spade');

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

/** What a block gives, when it isn't itself. */
const GIVES = new Map<Block, number>([
  [Block.Grass, Block.Dirt],
  [Block.SnowyGrass, Block.Dirt],
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
 * under one in `TUNING.survival.leafStick`.
 */
export function dropsOf(block: Block, tool: Tool | undefined, roll: number): Cost {
  if (!canHarvest(block, tool)) return [];
  if (block === Block.Leaves || block === Block.SpruceLeaves) return roll < 1 / TUNING.survival.leafStick ? [[Item.Stick, 1]] : [];
  if (block === Block.Glass) return [];
  const given = GIVES.get(block);
  if (given !== undefined) return [[given, 1]];
  if (isTorch(block)) return [[Block.Torch, 1]];
  if (wirePower(block) >= 0) return [[Block.Wire, 1]];
  const gate = gateOf(block);
  if (gate) return [[gate.kind === 'inverter' ? Block.Inverter : Block.Delay, 1]];
  if (furnaceOf(block)) return [[Block.Furnace, 1]];
  return PLACEABLE_SET.has(block) ? [[block, 1]] : [];
}
