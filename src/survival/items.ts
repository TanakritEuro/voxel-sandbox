// Items, for survival worlds: every block a player can place is an item of the same id (below
// 256), and what isn't a block (sticks, the metals, tools) has an id from 256. Names are invented.
// Pure: no DOM.

import { TUNING } from '../config';
import { Block, BLOCKS, PLACEABLE } from '../world/blocks';

/** The items that aren't blocks. */
export enum Item {
  Stick = 256,
  Coal,
  Copper,
  Iron,
  Crystal,
  WoodPick,
  WoodAxe,
  WoodSpade,
  StonePick,
  StoneAxe,
  StoneSpade,
  IronPick,
  IronAxe,
  IronSpade,
  RawCopper,
  RawIron,
  RawMeat,
  CookedMeat,
  Berries,
  Ember,
  /** Farming (Milestone 13). */
  Seeds,
  Wheat,
  Bread,
  /** From mossbacks, for beds. */
  Moss,
}

/** What a tool digs: a pick stone and ores, an axe wood, a spade earth. */
export type ToolKind = 'pick' | 'axe' | 'spade';

export interface Tool {
  kind: ToolKind;
  /** 1 wood, 2 stone, 3 iron (0 is the hand). */
  tier: number;
  /** Dividing the hardness of a block it's the right tool for. */
  speed: number;
  /** Blocks it breaks before it's worn out. */
  wear: number;
}

export interface ItemInfo {
  name: string;
  /** Most of it a slot holds. */
  stack: number;
  tool?: Tool;
  /** Hunger points it gives back, eaten. */
  food?: number;
}

const S = TUNING.survival;
const material = (name: string): ItemInfo => ({ name, stack: S.stack });
const tool = (name: string, kind: ToolKind, tier: number): ItemInfo => ({
  name,
  stack: 1,
  tool: { kind, tier, speed: S.toolSpeed[tier], wear: S.toolWear[tier] },
});

/** The items from 256, in `Item` order. */
const ITEMS: readonly ItemInfo[] = [
  material('Stick'),
  material('Coal'),
  material('Copper'),
  material('Iron'),
  material('Crystal'),
  ...(
    [
      ['Wooden', 1],
      ['Stone', 2],
      ['Iron', 3],
    ] as const
  ).flatMap(([what, tier]) => [tool(`${what} pick`, 'pick', tier), tool(`${what} axe`, 'axe', tier), tool(`${what} spade`, 'spade', tier)]),
  material('Raw copper'),
  material('Raw iron'),
  { name: 'Raw meat', stack: S.stack, food: S.food.rawMeat },
  { name: 'Cooked meat', stack: S.stack, food: S.food.cookedMeat },
  { name: 'Berries', stack: S.stack, food: S.food.berries },
  material('Ember'),
  material('Seeds'),
  material('Wheat'),
  { name: 'Bread', stack: S.stack, food: S.food.bread },
  material('Moss'),
];

const PLACEABLE_SET = new Set<number>(PLACEABLE);
const BLOCK_ITEMS = new Map<number, ItemInfo>(PLACEABLE.map((b) => [b, { name: BLOCKS[b].name, stack: S.stack }]));

/** Is `id` an item: a block a player can place, or one of `Item`? */
export const isItem = (id: number): boolean => PLACEABLE_SET.has(id) || (id >= Item.Stick && id < Item.Stick + ITEMS.length);

/** Is item `id` a block (placed as itself)? */
export const isBlockItem = (id: number): id is Block => PLACEABLE_SET.has(id);

/** Item `id`'s name, stack size and, for a tool, what it does. Only for ids `isItem` accepts. */
export function itemInfo(id: number): ItemInfo {
  const info = id >= Item.Stick ? ITEMS[id - Item.Stick] : BLOCK_ITEMS.get(id);
  if (!info) throw new Error(`not an item: ${id}`);
  return info;
}

/** The hunger points `id` gives back eaten, or 0 if it isn't food. */
export const foodOf = (id: number | undefined): number => (id !== undefined && isItem(id) ? (itemInfo(id).food ?? 0) : 0);

/** The tool `id` is, if it's one. */
export const toolOf = (id: number | undefined): Tool | undefined => (id !== undefined && isItem(id) ? itemInfo(id).tool : undefined);

/** Every item, blocks first, for tests and the icon painter. */
export const ALL_ITEMS: readonly number[] = [...PLACEABLE, ...ITEMS.map((_, i) => Item.Stick + i)];
