import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { hash3 } from '../src/math';
import { canMake, make, RECIPES } from '../src/survival/crafting';
import { digTime, dropsOf } from '../src/survival/drops';
import { HOTBAR_SLOTS, Inventory, SLOTS } from '../src/survival/inventory';
import { ALL_ITEMS, isItem, Item, itemInfo, toolOf } from '../src/survival/items';
import { breakWith, heldTool, placeableIn } from '../src/survival/play';
import { Mining } from '../src/world/mining';
import { itemArt } from '../src/render/itemIcons';
import { itemMesh } from '../src/render/heldBlock';
import { Block, BLOCKS, delay, inverter, wire } from '../src/world/blocks';

/** An inventory with these in it, in order. */
function holding(...stacks: [number, number][]): Inventory {
  const inv = new Inventory();
  for (const [item, n] of stacks) inv.add(item, n);
  return inv;
}

/** Every slot full of `item` but the ones given. */
function fullOf(item: number, ...others: [number, number, number][]): Inventory {
  const inv = new Inventory();
  for (let i = 0; i < SLOTS; i++) inv.slots[i] = { item, count: 64 };
  for (const [slot, other, n] of others) inv.slots[slot] = { item: other, count: n };
  return inv;
}

describe('items', () => {
  it('are the placeable blocks and the rest from 256, each named, tools one to a slot', () => {
    expect(isItem(Block.Stone)).toBe(true);
    expect(isItem(Block.Air)).toBe(false);
    expect(isItem(Block.SwitchOn)).toBe(false); // a state, not an item
    expect(isItem(Item.Stick)).toBe(true);
    expect(isItem(Item.IronSpade + 1)).toBe(false);
    for (const id of ALL_ITEMS) expect(itemInfo(id).name).not.toBe('');
    expect(itemInfo(Item.StoneAxe)).toMatchObject({ name: 'Stone axe', stack: 1, tool: { kind: 'axe', tier: 2, speed: 4, wear: 130 } });
    expect(itemInfo(Block.Planks).stack).toBe(64);
  });
});

describe('the inventory', () => {
  it('fills stacks already there first, then empty slots from the hotbar on, and says what didn’t fit', () => {
    const inv = new Inventory();
    expect(inv.add(Block.Dirt, 70)).toBe(0);
    expect(inv.slots.slice(0, 2)).toEqual([
      { item: Block.Dirt, count: 64 },
      { item: Block.Dirt, count: 6 },
    ]);
    inv.add(Block.Stone, 3);
    inv.add(Block.Dirt, 60); // 58 onto the 6, then 2 in a new slot after the stone
    expect(inv.slots.slice(0, 4).map((s) => s && [s.item, s.count])).toEqual([
      [Block.Dirt, 64],
      [Block.Dirt, 64],
      [Block.Stone, 3],
      [Block.Dirt, 2],
    ]);
    expect(inv.count(Block.Dirt)).toBe(130);
    const full = fullOf(Block.Sand, [5, Block.Sand, 60]);
    expect(full.add(Block.Sand, 10)).toBe(6);
    expect(full.add(Block.Gravel, 1)).toBe(1);
  });

  it('never stacks tools, and wears one out after its blocks', () => {
    const inv = holding([Item.WoodPick, 1], [Item.WoodPick, 1]);
    expect(inv.slots.slice(0, 2).map((s) => s?.count)).toEqual([1, 1]);
    for (let i = 1; i < 60; i++) expect(inv.wearTool(0)).toBe(false);
    expect(inv.slots[0]).toEqual({ item: Item.WoodPick, count: 1, wear: 59 });
    expect(inv.wearTool(0)).toBe(true);
    expect(inv.slots[0]).toBe(null);
    expect(inv.wearTool(1 + 5)).toBe(false); // an empty slot
  });

  it('picks up, splits, puts down one, merges and swaps, as the inventory screen does', () => {
    const inv = holding([Block.Dirt, 10], [Block.Stone, 5]);
    // Half of 10 picked up.
    let held = inv.pick(0, true)!;
    expect([held.count, inv.slots[0]!.count]).toEqual([5, 5]);
    // One put down in an empty slot, then the rest merged back.
    held = inv.put(10, held, true)!;
    expect([held.count, inv.slots[10]]).toEqual([4, { item: Block.Dirt, count: 1 }]);
    expect(inv.put(0, held)).toBe(null);
    expect(inv.slots[0]!.count).toBe(9);
    // A stack put on a different one swaps them.
    const stone = inv.pick(1)!;
    expect(inv.put(0, stone)).toEqual({ item: Block.Dirt, count: 9 });
    expect(inv.slots[0]).toEqual({ item: Block.Stone, count: 5 });
    // Merging stops at 64.
    const big = new Inventory();
    big.slots[0] = { item: Block.Sand, count: 60 };
    big.slots[1] = { item: Block.Sand, count: 64 };
    expect(big.put(0, big.pick(1)!)).toEqual({ item: Block.Sand, count: 60 });
    expect(big.slots[0]!.count).toBe(64);
  });

  it('moves a stack between the hotbar and the rest with Shift, merging first', () => {
    const inv = holding([Block.Dirt, 64], [Block.Stone, 10]);
    inv.slots[HOTBAR_SLOTS + 3] = { item: Block.Stone, count: 60 };
    inv.shiftMove(1); // 4 onto the 60, 6 into the first empty slot past the hotbar
    expect(inv.slots[1]).toBe(null);
    expect(inv.slots[HOTBAR_SLOTS + 3]!.count).toBe(64);
    expect(inv.slots[HOTBAR_SLOTS]).toEqual({ item: Block.Stone, count: 6 });
    inv.shiftMove(HOTBAR_SLOTS);
    expect(inv.slots[1]).toEqual({ item: Block.Stone, count: 6 });
  });

  it('spends from the last slots first, and takes one at a time when placing', () => {
    const inv = holding([Block.Planks, 3]);
    inv.slots[30] = { item: Block.Planks, count: 2 };
    inv.spend([[Block.Planks, 3]]);
    expect([inv.slots[0]!.count, inv.slots[30]]).toEqual([2, null]);
    expect(inv.takeOne(0)).toBe(Block.Planks);
    expect(inv.takeOne(0)).toBe(Block.Planks);
    expect(inv.takeOne(0)).toBe(null);
  });

  it('loads as it was saved, leaving out what isn’t right', () => {
    const inv = holding([Block.Dirt, 64], [Item.IronPick, 1], [Item.Coal, 12]);
    inv.wearTool(1);
    expect(Inventory.from(JSON.parse(JSON.stringify(inv))).toJSON()).toEqual(inv.toJSON());
    const cleaned = Inventory.from([
      { item: Block.Dirt, count: 65 },
      { item: Block.SwitchOn, count: 1 },
      { item: 999, count: 1 },
      { item: Item.WoodPick, count: 1, wear: 60 },
      { item: Block.Sand, count: 2.5 },
      'stone',
      { item: Block.Sand, count: 2 },
    ]);
    expect(cleaned.slots.filter((s) => s)).toEqual([{ item: Block.Sand, count: 2 }]);
    expect(Inventory.from(null).slots.every((s) => s === null)).toBe(true);
  });
});

describe('drops and digging', () => {
  const wood = toolOf(Item.WoodPick);
  const stone = toolOf(Item.StonePick);
  const iron = toolOf(Item.IronPick);

  it('gives dirt from grass, faster with a spade', () => {
    expect(dropsOf(Block.Grass, undefined, 0.5)).toEqual([[Block.Dirt, 1]]);
    expect(digTime(Block.Grass, undefined)).toBe(BLOCKS[Block.Grass].hardness);
    expect(digTime(Block.Grass, toolOf(Item.StoneSpade))).toBeCloseTo(BLOCKS[Block.Grass].hardness / 4);
    expect(digTime(Block.Grass, wood)).toBe(BLOCKS[Block.Grass].hardness); // a pick is no help
  });

  it('takes three times as long to break stone by hand, and gives nothing; a wooden pick gives stone', () => {
    const h = BLOCKS[Block.Stone].hardness;
    expect(digTime(Block.Stone, undefined)).toBe(h * TUNING.survival.withoutPick);
    expect(dropsOf(Block.Stone, undefined, 0)).toEqual([]);
    expect(dropsOf(Block.Stone, toolOf(Item.WoodAxe), 0)).toEqual([]);
    expect(digTime(Block.Stone, wood)).toBe(h / 2);
    expect(dropsOf(Block.Stone, wood, 0)).toEqual([[Block.Stone, 1]]);
  });

  it('needs a pick of each ore’s tier', () => {
    const gives = (ore: Block) => [undefined, wood, stone, iron].map((t) => dropsOf(ore, t, 0).length);
    expect(gives(Block.CoalOre)).toEqual([0, 1, 1, 1]);
    expect(gives(Block.CopperOre)).toEqual([0, 0, 1, 1]);
    expect(gives(Block.IronOre)).toEqual([0, 0, 1, 1]);
    expect(gives(Block.CrystalOre)).toEqual([0, 0, 0, 1]);
    expect(dropsOf(Block.IronOre, stone, 0)).toEqual([[Item.Iron, 1]]);
    expect(dropsOf(Block.CrystalOre, iron, 0)).toEqual([[Item.Crystal, 1]]);
    // Too low a tier is as slow as the hand.
    expect(digTime(Block.CrystalOre, stone)).toBe(digTime(Block.CrystalOre, undefined));
  });

  it('gives a stick from leaves one time in eight, the same rolls each run', () => {
    let sticks = 0;
    for (let i = 0; i < 8000; i++) sticks += dropsOf(Block.Leaves, undefined, hash3(7, i, 64, -i)).length;
    expect(sticks).toBeGreaterThan(900);
    expect(sticks).toBeLessThan(1100);
    expect(dropsOf(Block.SpruceLeaves, undefined, 0.01)).toEqual([[Item.Stick, 1]]);
    expect(dropsOf(Block.SpruceLeaves, undefined, 0.5)).toEqual([]);
  });

  it('gives blocks back as placed: torches, wire, lamps, switches and gates in any state; glass nothing', () => {
    expect(dropsOf(Block.WallTorchNegZ, undefined, 0)).toEqual([[Block.Torch, 1]]);
    expect(dropsOf(wire(9), undefined, 0)).toEqual([[Block.Wire, 1]]);
    expect(dropsOf(Block.SignalLampOn, wood, 0)).toEqual([[Block.SignalLamp, 1]]);
    expect(dropsOf(Block.SwitchOn, undefined, 0)).toEqual([[Block.Switch, 1]]);
    expect(dropsOf(inverter(3, true), undefined, 0)).toEqual([[Block.Inverter, 1]]);
    expect(dropsOf(delay(2, 4, true), undefined, 0)).toEqual([[Block.Delay, 1]]);
    expect(dropsOf(Block.Glass, undefined, 0)).toEqual([]);
  });

  it('only ever gives items', () => {
    for (let b = 0; b < BLOCKS.length; b++) for (const t of [undefined, iron]) for (const [item] of dropsOf(b as Block, t, 0)) expect(isItem(item)).toBe(true);
  });
});

describe('crafting', () => {
  it('spends exactly each recipe’s cost and adds what it makes', () => {
    for (const recipe of RECIPES) {
      const inv = holding(...recipe.cost.map(([item, n]) => [item, n] as [number, number]), [Block.Gravel, 3]);
      expect(canMake(inv, recipe)).toBe(true);
      expect(make(inv, recipe)).toBe(1);
      for (const [item] of recipe.cost) expect(inv.count(item)).toBe(0);
      expect(inv.count(recipe.makes)).toBe(recipe.count);
      expect(inv.count(Block.Gravel)).toBe(3);
      expect(isItem(recipe.makes)).toBe(true);
    }
  });

  it('makes as many as it can with Shift, and stops when the cost runs out', () => {
    const planks = RECIPES.find((r) => r.makes === Block.Planks && r.cost[0][0] === Block.Wood)!;
    const inv = holding([Block.Wood, 10]);
    expect(make(inv, planks, Infinity)).toBe(10);
    expect(inv.count(Block.Planks)).toBe(40);
    expect(canMake(inv, planks)).toBe(false);
  });

  it('makes nothing when what it makes wouldn’t fit', () => {
    const sticks = RECIPES.find((r) => r.makes === Item.Stick)!;
    // Four planks among full stacks of dirt: two spent leave two, and the sticks have nowhere to go.
    const inv = fullOf(Block.Dirt, [7, Block.Planks, 4]);
    expect(canMake(inv, sticks)).toBe(false);
    expect(make(inv, sticks)).toBe(0);
    expect(inv.count(Block.Planks)).toBe(4);
    // Two planks: spending them frees their slot.
    expect(make(fullOf(Block.Dirt, [7, Block.Planks, 2]), sticks)).toBe(1);
  });

  it('has a way to every tool, torch and logic block from what the ground gives', () => {
    const made = new Set(RECIPES.map((r) => r.makes));
    for (const want of [Item.WoodPick, Item.StoneSpade, Item.IronAxe, Block.Torch, Block.Glass, Block.Wire, Block.Switch, Block.Button, Block.SignalLamp, Block.ChargedBlock, Block.Inverter, Block.Delay])
      expect(made.has(want)).toBe(true);
  });
});

describe('breaking and placing in survival', () => {
  it('says what a block gives (for the ground) and wears the tool held, leaving the inventory else alone', () => {
    const inv = holding([Item.WoodPick, 1], [Block.Planks, 3]);
    expect(heldTool(inv, 0)?.kind).toBe('pick');
    expect(heldTool(inv, 1)).toBeUndefined();
    expect(breakWith(inv, 0, Block.Stone, 0)).toEqual({ drops: [[Block.Stone, 1]], woreOut: null });
    expect(inv.slots[0]!.wear).toBe(1);
    expect(inv.count(Block.Stone)).toBe(0);
    // A torch that went with it: no wear.
    expect(breakWith(inv, 0, Block.WallTorchPosX, 0, false).drops).toEqual([[Block.Torch, 1]]);
    expect(inv.slots[0]!.wear).toBe(1);
    // By hand, stone gives nothing.
    expect(breakWith(inv, 1, Block.Stone, 0).drops).toEqual([]);
  });

  it('says which tool wore out, gone from its slot', () => {
    const inv = holding([Block.Sand, 4]);
    inv.slots[4] = { item: Item.StoneSpade, count: 1, wear: 129 };
    expect(breakWith(inv, 4, Block.Dirt, 0)).toEqual({ drops: [[Block.Dirt, 1]], woreOut: Item.StoneSpade });
    expect(inv.slots[4]).toBe(null);
  });

  it('places only blocks, one at a time', () => {
    const inv = holding([Block.Torch, 2], [Item.Stick, 5]);
    expect(placeableIn(inv, 0)).toBe(Block.Torch);
    expect(placeableIn(inv, 1)).toBe(null);
    expect(placeableIn(inv, 2)).toBe(null);
  });

  it('takes as long to break as it is told: by the tool held, in survival', () => {
    const mining = new Mining();
    const pick = toolOf(Item.StonePick);
    mining.timeOf = (b) => digTime(b, pick);
    const at = { x: 0, y: 0, z: 0, block: Block.Stone };
    const t = BLOCKS[Block.Stone].hardness / 4;
    let broke = -1;
    for (let i = 1; i <= 120 && broke < 0; i++) if (mining.update(at, true, 1 / 60)) broke = i / 60;
    expect(broke).toBeGreaterThanOrEqual(t - 1e-9);
    expect(broke).toBeLessThan(t + 1 / 30);
  });
});

describe('item pictures', () => {
  it('give every item that isn’t a block a 16 × 16 picture, the same each time, with something in it', () => {
    for (const id of ALL_ITEMS) {
      const art = itemArt(id);
      if (id < Item.Stick) {
        expect(art).toBe(null);
        continue;
      }
      expect(art!.length).toBe(16 * 16 * 4);
      let filled = 0;
      for (let i = 3; i < art!.length; i += 4) if (art![i]) filled++;
      expect(filled).toBeGreaterThan(10);
      expect(itemArt(id)).toEqual(art);
    }
    // Tools of one kind differ by material.
    expect(itemArt(Item.WoodPick)).not.toEqual(itemArt(Item.IronPick));
  });

  it('are held as a slab with only the faces that show', () => {
    const art = new Uint8Array(16 * 16 * 4);
    const fill = (x: number, y: number) => art.set([200, 100, 50, 255], (y * 16 + x) * 4);
    fill(3, 3);
    // One pixel: a box, 6 faces of 2 triangles.
    expect(itemMesh(art).positions.length).toBe(6 * 6 * 3);
    // Two side by side: the faces between them go (10 faces).
    fill(4, 3);
    const two = itemMesh(art);
    expect(two.positions.length).toBe(10 * 6 * 3);
    expect(two.colours.length).toBe(two.positions.length);
    // Within the picture's square, a sixteenth thick.
    for (let i = 0; i < two.positions.length; i += 3) {
      expect(Math.abs(two.positions[i])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(two.positions[i + 2])).toBeLessThanOrEqual(1 / 32 + 1e-9);
    }
    // A real tool: far fewer faces than six a pixel.
    const pick = itemArt(Item.StonePick)!;
    let pixels = 0;
    for (let i = 3; i < pick.length; i += 4) if (pick[i]) pixels++;
    expect(itemMesh(pick).positions.length / 18).toBeLessThan(pixels * 5);
  });
});
