import { describe, expect, it } from 'vitest';
import { fitted } from '../src/render/icons';
import { RECIPES } from '../src/survival/crafting';
import { Item, itemInfo } from '../src/survival/items';
import { BLOCK_KINDS, groupOf, kindOf, nameMatches, RECIPE_GROUPS } from '../src/ui/categories';
import { tooltipOf } from '../src/ui/tooltip';
import { Block, BLOCKS, PLACEABLE, slab } from '../src/world/blocks';

describe("the picker's and survival's screens", () => {
  it('give every placeable block a tab, each tab some blocks', () => {
    for (const b of PLACEABLE) expect(kindOf(b), BLOCKS[b].name).toBeDefined();
    for (const kind of BLOCK_KINDS) expect(PLACEABLE.filter((b) => kindOf(b) === kind).length, kind).toBeGreaterThan(0);
    expect([kindOf(Block.Lantern), kindOf(Block.Lava), kindOf(slab(1, false)), kindOf(Block.Rail), kindOf(Block.Bed)]).toEqual(['Light', 'Deep', 'Building', 'Travel', 'Home']);
  });

  it('find blocks by any part of their names, any case', () => {
    expect(nameMatches(Block.MossyBricks, 'brick')).toBe(true);
    expect(nameMatches(Block.MossyBricks, '  MOSSY ')).toBe(true);
    expect(nameMatches(Block.MossyBricks, 'lava')).toBe(false);
    expect(nameMatches(Block.Stone, '')).toBe(true);
    expect(PLACEABLE.filter((b) => nameMatches(b, 'rail')).map((b) => BLOCKS[b].name)).toEqual(['Rail', 'Powered rail']);
  });

  it('put every recipe in a crafting group, each group some recipes', () => {
    for (const r of RECIPES) expect(groupOf(r), itemInfo(r.makes).name).toBeDefined();
    for (const g of RECIPE_GROUPS) expect(RECIPES.filter((r) => groupOf(r) === g).length, g).toBeGreaterThan(0);
  });

  it("say what's worth knowing in a slot's tooltip: a tool's uses left, food, smelting, fuel", () => {
    const pick = itemInfo(Item.IronPick).tool!.wear;
    const worn = tooltipOf({ item: Item.IronPick, count: 1, wear: pick - 10 });
    expect(worn.title).toBe('Iron pick');
    expect(worn.lines).toEqual([`10 of ${pick} uses left`]);
    expect(worn.left).toBeCloseTo(10 / pick, 6);
    expect(tooltipOf({ item: Item.Bread, count: 3 })).toMatchObject({ title: 'Bread × 3', lines: [`Eat for ${itemInfo(Item.Bread).food} hunger`] });
    expect(tooltipOf({ item: Item.RawIron, count: 1 }).lines).toEqual(['Smelts into iron']);
    expect(tooltipOf({ item: Item.Coal, count: 1 }).lines).toEqual(['Fuel: smelts 8 things']);
    expect(tooltipOf({ item: Block.Stone, count: 64 })).toEqual({ title: 'Stone × 64', lines: [] });
  });

  it("draw small shapes' icons large enough to see, and others as they are", () => {
    const lantern = fitted(BLOCKS[Block.Lantern].boxes!);
    const width = (bs: readonly (readonly number[])[]) => Math.max(...bs.map((b) => b[3])) - Math.min(...bs.map((b) => b[0]));
    const height = (bs: readonly (readonly number[])[]) => Math.max(...bs.map((b) => b[4])) - Math.min(...bs.map((b) => b[1]));
    expect(width(lantern)).toBeGreaterThan(width(BLOCKS[Block.Lantern].boxes!) * 1.5);
    expect(Math.min(...lantern.map((b) => b[1]))).toBe(0);
    expect(height(lantern)).toBeLessThanOrEqual(1);
    for (const b of lantern) for (const v of b) expect(v >= 0 && v <= 1).toBe(true);
    // A slab fills the block across: left alone.
    const s = BLOCKS[slab(0, false)].boxes!;
    expect(fitted(s)).toBe(s);
  });
});
