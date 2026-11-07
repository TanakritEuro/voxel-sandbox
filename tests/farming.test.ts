import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { canMake, RECIPES } from '../src/survival/crafting';
import { dropsOf } from '../src/survival/drops';
import { Crops, type CropWorld, growingLight, sowable, stageTime, tillable } from '../src/survival/farming';
import { Inventory } from '../src/survival/inventory';
import { foodOf, Item } from '../src/survival/items';
import { bed, Block, door, torchSupport, wheat, wheatStage } from '../src/world/blocks';
import { Grid } from './grid';

const F = TUNING.survival.farming;

/** A field: farmland at y 0 under (0..n-1, 0), wheat sown above each, every block lit `light`. */
function field(n: number, light = 15 << 4) {
  const grid = new Grid();
  const crops = new Crops();
  for (let x = 0; x < n; x++) {
    grid.set(x, 0, 0, Block.Farmland).set(x, 1, 0, wheat(0));
    crops.sow(x, 1, 0);
  }
  const world: CropWorld & { light: number; unloaded: Set<number> } = {
    light,
    unloaded: new Set<number>(),
    getBlock: (x, y, z) => grid.getBlock(x, y, z),
    getLight() {
      return this.light;
    },
    loaded(x) {
      return !this.unloaded.has(x);
    },
  };
  /** Step the crops a second at a time for `seconds`, making their changes; the time each stage was reached, by plant. */
  const grow = (seconds: number, daylight = 1) => {
    const reached: number[][] = Array.from({ length: n }, () => []);
    for (let t = 1; t <= seconds; t++)
      for (const [x, y, z, b] of crops.step(1, world, daylight)) {
        grid.set(x, y, z, b);
        reached[x][wheatStage(b)] = t;
      }
    return reached;
  };
  return { grid, crops, world, grow };
}

describe('tilling and sowing', () => {
  it('till grass or dirt with air above, and nothing else', () => {
    const g = new Grid().set(0, 0, 0, Block.Grass).set(1, 0, 0, Block.Dirt).set(2, 0, 0, Block.Stone).set(3, 0, 0, Block.Grass).set(3, 1, 0, Block.Torch).set(4, 0, 0, Block.Sand);
    expect([0, 1, 2, 3, 4].map((x) => tillable(g, x, 0, 0))).toEqual([true, true, false, false, false]);
  });

  it('sow only on farmland with air above', () => {
    const g = new Grid().set(0, 0, 0, Block.Farmland).set(1, 0, 0, Block.Dirt).set(2, 0, 0, Block.Farmland).set(2, 1, 0, wheat(0));
    expect([0, 1, 2].map((x) => sowable(g, x, 0, 0))).toEqual([true, false, false]);
  });

  it('wheat stands on the block below it as a torch does (breaking the farmland takes it), as does a door, not its upper half or a bed', () => {
    expect(torchSupport(wheat(3))).toEqual([0, -1, 0]);
    expect(torchSupport(door(1, false, false))).toEqual([0, -1, 0]);
    expect(torchSupport(door(1, true, true))).toBe(null);
    expect(torchSupport(bed(2, true))).toBe(null);
    expect(torchSupport(Block.Farmland)).toBe(null);
  });
});

describe('wheat growing', () => {
  it('goes up a stage at a time to ripe in about 8 minutes of light, each stage a little different, then stops', () => {
    const { grid, grow } = field(6);
    const total = 7 * F.stageSeconds;
    const reached = grow(Math.ceil(total * 1.25));
    for (let x = 0; x < 6; x++) {
      expect(grid.getBlock(x, 1, 0)).toBe(wheat(7));
      // Each stage when its own time says, to the second.
      let t = 0;
      for (let s = 1; s <= 7; s++) {
        t += Math.ceil(stageTime(x, 1, 0, s - 1));
        expect(Math.abs(reached[x][s] - t)).toBeLessThanOrEqual(1);
        t = reached[x][s];
      }
      expect(reached[x][7]).toBeGreaterThan(total * 0.8);
      expect(reached[x][7]).toBeLessThan(total * 1.2 + 7);
    }
    // Not all in step.
    expect(new Set(reached.map((r) => r[7])).size).toBeGreaterThan(1);
  });

  it('gives each stage of each plant between 0.8 and 1.2 of the tuning', () => {
    for (let x = -20; x < 20; x++)
      for (let s = 0; s < 7; s++) {
        const t = stageTime(x, 64, 3 * x, s);
        expect(t).toBeGreaterThanOrEqual(F.stageSeconds * 0.8);
        expect(t).toBeLessThanOrEqual(F.stageSeconds * 1.2);
      }
  });

  it('needs light 9 or more: the sun by day, a torch at night, not the dark or a night sky', () => {
    expect(growingLight(15 << 4, 1)).toBe(true);
    expect(growingLight(15 << 4, 0.5)).toBe(false); // the sun at 7.5 of 15
    expect(growingLight(15 << 4, 0.6)).toBe(true); // 9
    expect(growingLight(10, 0)).toBe(true); // a torch's light at night
    expect(growingLight(8, 0)).toBe(false);
    const dark = field(2, 0);
    dark.grow(600);
    expect(dark.grid.getBlock(0, 1, 0)).toBe(wheat(0));
    const lit = field(2, 12);
    lit.grow(120, 0);
    expect(wheatStage(lit.grid.getBlock(0, 1, 0))).toBeGreaterThan(0);
  });

  it('waits in unloaded land, and forgets a plant that is no longer wheat', () => {
    const { grid, crops, world, grow } = field(3);
    world.unloaded.add(1);
    grow(200);
    expect(wheatStage(grid.getBlock(0, 1, 0))).toBeGreaterThan(0);
    expect(grid.getBlock(1, 1, 0)).toBe(wheat(0));
    expect(crops.grown(1, 1, 0)).toBe(0);
    grid.set(2, 1, 0, Block.Air);
    grow(1);
    expect(crops.grown(2, 1, 0)).toBe(undefined);
    expect(crops.size).toBe(2);
  });

  it('is saved and loaded with the seconds into its stage, junk dropped', () => {
    const { crops, grow } = field(2);
    grow(30);
    const back = Crops.from(JSON.parse(JSON.stringify(crops.toJSON())));
    expect(back.grown(0, 1, 0)).toBe(crops.grown(0, 1, 0));
    expect(back.size).toBe(2);
    const cleaned = Crops.from({ '1,2,3': 5, 'a,b,c': 1, '4,5': 1, '6,7,8': -1, '9,9,9': 'x', '1,1,1': Infinity });
    expect(cleaned.size).toBe(1);
    expect(cleaned.grown(1, 2, 3)).toBe(5);
    expect(Crops.from(undefined).size).toBe(0);
  });
});

describe('the harvest', () => {
  it('gives seeds from grass one time in eight, with its dirt', () => {
    expect(dropsOf(Block.Grass, undefined, 0.05)).toEqual([
      [Block.Dirt, 1],
      [Item.Seeds, 1],
    ]);
    expect(dropsOf(Block.Grass, undefined, 1 / F.seedsFromGrass + 0.01)).toEqual([[Block.Dirt, 1]]);
  });

  it('gives wheat and 1 to 3 seeds from ripe wheat, and a seed back from unripe', () => {
    expect(dropsOf(wheat(7), undefined, 0)).toEqual([
      [Item.Wheat, 1],
      [Item.Seeds, 1],
    ]);
    expect(dropsOf(wheat(7), undefined, 0.99)).toEqual([
      [Item.Wheat, 1],
      [Item.Seeds, 3],
    ]);
    for (let s = 0; s < 7; s++) expect(dropsOf(wheat(s), undefined, 0.5)).toEqual([[Item.Seeds, 1]]);
  });

  it('makes bread of 3 wheat, food for 5', () => {
    const recipe = RECIPES.find((r) => r.makes === Item.Bread)!;
    expect(recipe.cost).toEqual([[Item.Wheat, 3]]);
    const pack = new Inventory();
    pack.add(Item.Wheat, 2);
    expect(canMake(pack, recipe)).toBe(false);
    pack.add(Item.Wheat, 1);
    expect(canMake(pack, recipe)).toBe(true);
    expect(foodOf(Item.Bread)).toBe(5);
  });
});
