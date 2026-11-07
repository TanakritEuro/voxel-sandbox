import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { canMake, RECIPES } from '../src/survival/crafting';
import { Inventory } from '../src/survival/inventory';
import { itemInfo, Item } from '../src/survival/items';
import { bedFoot, bedFrom, canSleep, wakeAt } from '../src/survival/sleep';
import { bed, Block } from '../src/world/blocks';
import { Grid } from './grid';

/** A floor at y 0 and a bed on it at y 1, its foot at (0, 1, 0), its head along +x. */
const room = () => new Grid().floor(-5, 5, -5, 5).set(0, 1, 0, bed(0, false)).set(1, 1, 0, bed(0, true));

describe('sleeping', () => {
  it('is for the night, with nothing hostile within 8 blocks', () => {
    expect(canSleep(0.2, Infinity)).toBe('ok');
    expect(canSleep(TUNING.sleep.night, Infinity)).toBe('day');
    expect(canSleep(1, Infinity)).toBe('day');
    expect(canSleep(0.2, 8)).toBe('near');
    expect(canSleep(0.2, 8.5)).toBe('ok');
    // Day comes first: by day it's the sun that says no.
    expect(canSleep(0.9, 2)).toBe('day');
  });

  it('knows a bed by its foot, clicked on either half', () => {
    const g = room();
    expect(bedFoot(g, 0, 1, 0)).toEqual([0, 1, 0]);
    expect(bedFoot(g, 1, 1, 0)).toEqual([0, 1, 0]);
    expect(bedFoot(g, 2, 1, 0)).toBe(null);
  });

  it('keeps a bed as three whole numbers, and nothing else', () => {
    expect(bedFrom([4, 70, -2])).toEqual([4, 70, -2]);
    for (const junk of [undefined, null, [1, 2], [1, 2, 3.5], ['1', 2, 3], 'x', { x: 1 }]) expect(bedFrom(junk)).toBe(null);
  });
});

describe('waking at a bed', () => {
  it('is beside its foot, on the floor, the middle of the block', () => {
    // Head along +x: beside the foot are (0, ±1).
    const at = wakeAt(room(), [0, 1, 0])!;
    expect(at[1]).toBe(1);
    expect(Math.abs(at[2] - 0.5)).toBe(1);
    expect(at[0]).toBe(0.5);
  });

  it("goes beside the head when the foot's sides are walled, then off the foot's end, then onto the bed", () => {
    const g = room().pillar(0, 1, 1, 2).pillar(0, -1, 1, 2);
    expect(wakeAt(g, [0, 1, 0])).toEqual([1.5, 1, expect.any(Number)]);
    g.pillar(1, 1, 1, 2).pillar(1, -1, 1, 2);
    expect(wakeAt(g, [0, 1, 0])).toEqual([-0.5, 1, 0.5]);
    g.pillar(-1, 0, 1, 2);
    expect(wakeAt(g, [0, 1, 0])).toEqual([0.5, 1 + TUNING.sleep.onBed, 0.5]);
  });

  it("doesn't wake beside it with no floor there, or under a low ceiling", () => {
    const g = room();
    // No floor at (0, 0, 1); a ceiling over (0, 1, -1).
    g.set(0, 0, 1, Block.Air).set(0, 2, -1, Block.Stone);
    const at = wakeAt(g, [0, 1, 0])!;
    expect(at).not.toEqual([0.5, 1, 1.5]);
    expect(at).not.toEqual([0.5, 1, -0.5]);
  });

  it('is nowhere when the bed is gone, or the place kept is its head', () => {
    const g = room();
    expect(wakeAt(g, [1, 1, 0])).toBe(null);
    g.set(0, 1, 0, Block.Air);
    expect(wakeAt(g, [0, 1, 0])).toBe(null);
  });
});

describe('beds made', () => {
  it('from 3 planks and 3 moss (from mossbacks)', () => {
    expect(itemInfo(Item.Moss).name).toBe('Moss');
    const recipe = RECIPES.find((r) => r.makes === Block.Bed)!;
    expect(recipe.cost).toEqual([
      [Block.Planks, 3],
      [Item.Moss, 3],
    ]);
    const pack = new Inventory();
    pack.add(Block.Planks, 3);
    pack.add(Item.Moss, 2);
    expect(canMake(pack, recipe)).toBe(false);
    pack.add(Item.Moss, 1);
    expect(canMake(pack, recipe)).toBe(true);
  });
});
