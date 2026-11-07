import { describe, expect, it } from 'vitest';
import { MemoryStore, newWorldRecord } from '../src/save/store';
import { CHEST_SLOTS, Chests } from '../src/survival/chest';
import { canMake, RECIPES } from '../src/survival/crafting';
import { Inventory } from '../src/survival/inventory';
import { Item } from '../src/survival/items';
import { moveAll } from '../src/ui/backpack';
import { Block } from '../src/world/blocks';

describe('chests', () => {
  it('keep 27 slots each by place, and forget one broken, giving what was in it', () => {
    const chests = new Chests();
    const a = chests.at(1, 60, -2);
    expect(a.size).toBe(CHEST_SLOTS);
    expect(a.slots.length).toBe(27);
    a.add(Block.Stone, 100);
    a.add(Item.IronPick, 1, 30);
    expect(chests.at(1, 60, -2)).toBe(a);
    expect(chests.get(2, 60, -2)).toBe(undefined);
    expect(chests.remove(1, 60, -2)).toEqual([
      { item: Block.Stone, count: 64 },
      { item: Block.Stone, count: 36 },
      { item: Item.IronPick, count: 1, wear: 30 },
    ]);
    expect(chests.get(1, 60, -2)).toBe(undefined);
    expect(chests.remove(1, 60, -2)).toEqual([]);
  });

  it('save what they hold (not empty ones), and load cleaned', () => {
    const chests = new Chests();
    chests.at(0, 70, 0).add(Item.Coal, 12);
    chests.at(5, 70, 5); // looked in, nothing put there
    const saved = JSON.parse(JSON.stringify(chests.toJSON()));
    expect(Object.keys(saved)).toEqual(['0,70,0']);
    const back = Chests.from(saved);
    expect(back.get(0, 70, 0)!.slots[0]).toEqual({ item: Item.Coal, count: 12 });
    expect(back.size).toBe(1);
    // Junk: a bad place, a stack too big, something that isn't an item, not an object at all.
    // (A stack over its item's size is dropped, as a saved inventory's is.)
    const cleaned = Chests.from({ 'a,b,c': [{ item: 1, count: 1 }], '1,2': [], '3,4,5': [{ item: Block.Dirt, count: 999 }, { item: 9999, count: 1 }, 'x', { item: Block.Dirt, count: 9 }] });
    expect(cleaned.size).toBe(1);
    expect(cleaned.get(3, 4, 5)!.slots.slice(0, 4)).toEqual([null, null, null, { item: Block.Dirt, count: 9 }]);
    expect(Chests.from(null).size).toBe(0);
    expect(Chests.from([1, 2]).size).toBe(0);
  });

  it("go into the world record and come back with it", async () => {
    const store = new MemoryStore();
    const record = newWorldRecord('w', 'Home', 7, 0.3, 'survival');
    const chests = new Chests();
    chests.at(-4, 63, 9).add(Item.Berries, 6);
    record.containers = chests.toJSON();
    await store.putWorld(record);
    const loaded = (await store.getWorld('w'))!;
    expect(Chests.from(loaded.containers).get(-4, 63, 9)!.count(Item.Berries)).toBe(6);
  });

  it('move a stack between a chest and the inventory with Shift, as much as fits', () => {
    const pack = new Inventory();
    const chest = new Inventory(CHEST_SLOTS);
    pack.slots[3] = { item: Block.Planks, count: 40 };
    moveAll(pack, 3, chest);
    expect(pack.slots[3]).toBe(null);
    expect(chest.slots[0]).toEqual({ item: Block.Planks, count: 40 });
    // A full chest takes what it can: onto the planks there, then nothing.
    for (let i = 1; i < CHEST_SLOTS; i++) chest.slots[i] = { item: Block.Stone, count: 64 };
    pack.slots[0] = { item: Block.Planks, count: 50 };
    moveAll(pack, 0, chest);
    expect(chest.slots[0]).toEqual({ item: Block.Planks, count: 64 });
    expect(pack.slots[0]).toEqual({ item: Block.Planks, count: 26 });
    // Back out: into the inventory.
    moveAll(chest, 5, pack);
    expect(chest.slots[5]).toBe(null);
    expect(pack.count(Block.Stone)).toBe(64);
    // An empty slot: nothing.
    moveAll(chest, 5, pack);
    expect(pack.count(Block.Stone)).toBe(64);
  });

  it('are made from 8 planks', () => {
    const recipe = RECIPES.find((r) => r.makes === Block.Chest)!;
    expect(recipe.cost).toEqual([[Block.Planks, 8]]);
    const pack = new Inventory();
    pack.add(Block.Planks, 7);
    expect(canMake(pack, recipe)).toBe(false);
    pack.add(Block.Planks, 1);
    expect(canMake(pack, recipe)).toBe(true);
  });
});
