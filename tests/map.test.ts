import { describe, expect, it } from 'vitest';
import { RECIPES } from '../src/survival/crafting';
import { Item } from '../src/survival/items';
import { PARCHMENT, TILE, TILE_BYTES, tileOf, WorldMap } from '../src/survival/map';
import { Block, BLOCKS } from '../src/world/blocks';
import { World } from '../src/world/world';

/** Column (0, 0) of seed 20261022 and its neighbours, with a stone platform over all of (0, 0) at y 120. */
function platform(): World {
  const world = new World(20261022);
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
  const changes: [number, number, number, Block][] = [];
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) changes.push([x, 120, z, Block.Stone]);
  // A step up at (6, 10): its pixel (3, 5) higher than the one north, the next one south lower.
  changes.push([6, 121, 10, Block.Stone]);
  // A shallow pool a block deep at (20, 20), a deep one six deep at (24, 24).
  changes.push([20, 120, 20, Block.Water]);
  for (let y = 115; y <= 120; y++) changes.push([24, y, 24, Block.Water]);
  world.setBlocks(changes);
  return world;
}

const at = (tile: Uint8Array, i: number, j: number) => ({ block: tile[j * TILE + i], shade: tile[TILE * TILE + j * TILE + i] });

describe('the map', () => {
  it("takes a column's tile: each 2 x 2 blocks' top block, land shaded against the land north, water by depth", () => {
    const world = platform();
    const tile = tileOf(world, 0, 0);
    expect(tile.length).toBe(TILE_BYTES);
    expect(at(tile, 1, 1)).toEqual({ block: Block.Stone, shade: 1 }); // level
    expect(at(tile, 3, 5)).toEqual({ block: Block.Stone, shade: 2 }); // the step: higher than north
    expect(at(tile, 3, 6)).toEqual({ block: Block.Stone, shade: 0 }); // south of it: lower
    expect(at(tile, 10, 10)).toEqual({ block: Block.Water, shade: 2 }); // shallow
    expect(at(tile, 12, 12)).toEqual({ block: Block.Water, shade: 0 }); // deep
    // The top row against the land 2 blocks north, in the next column (lower than the platform).
    expect(at(tile, 5, 0).shade).toBe(2);
    // A generated column: each pixel's block is the column's top there.
    const other = tileOf(world, 1, 0);
    for (const [i, j] of [[0, 0], [7, 3], [15, 15]]) {
      let y = 255;
      while (y > 0 && world.getBlock(32 + i * 2, y, j * 2) === Block.Air) y--;
      expect(at(other, i, j).block).toBe(world.getBlock(32 + i * 2, y, j * 2));
    }
  });

  it('explores the loaded columns round a player, nearest first, a few at a time, and again after an edit', () => {
    const world = platform();
    const map = new WorldMap();
    expect(map.explore(world, 10, 10, 4, 2)).toBe(2);
    expect(map.tile(0, 0)).toBeDefined(); // the player's own first
    // Only the 9 loaded columns, however many tries.
    for (let i = 0; i < 10; i++) map.explore(world, 10, 10, 4, 2);
    expect(map.size).toBe(9);
    expect(map.explore(world, 10, 10, 4, 2)).toBe(0);
    // An edit: taken again.
    world.setBlock(2, 121, 2, Block.Planks);
    map.touch(0, 0);
    expect(map.explore(world, 10, 10, 4, 2)).toBe(1);
    expect(at(map.tile(0, 0)!, 1, 1).block).toBe(Block.Planks);
    map.touch(50, 50); // not explored: nothing to do
    expect(map.explore(world, 10, 10, 4, 2)).toBe(0);
  });

  it('paints any window: explored land in its colours by shade, the rest parchment', () => {
    const world = platform();
    const map = new WorldMap();
    for (let i = 0; i < 5; i++) map.explore(world, 10, 10, 1, 9);
    const out = new Uint8ClampedArray(4 * 4 * 4);
    // 4 x 4 pixels, 2 blocks each, round (4, 4): all level stone.
    map.paint(out, 4, 4, 4, 4, 2);
    const stone = BLOCKS[Block.Stone].top.map((c) => Math.round(c * 255));
    // Pixel (1, 1), level (the top row is lighter: higher than the land north of the platform).
    expect(Array.from(out.subarray(20, 23)).map(Math.round)).toEqual(stone);
    expect(out[23]).toBe(255);
    expect(out[0]).toBeGreaterThan(stone[0]);
    // Far off: parchment.
    map.paint(out, 4, 4, 5000, 5000, 2);
    expect(Array.from(out.subarray(0, 3))).toEqual([...PARCHMENT]);
  });

  it('is saved and loaded tile for tile, small, with junk left out', () => {
    const world = platform();
    const map = new WorldMap();
    for (let i = 0; i < 10; i++) map.explore(world, 10, 10, 1, 9);
    const saved = JSON.parse(JSON.stringify(map.toJSON()));
    const back = WorldMap.from(saved);
    expect(back.size).toBe(9);
    expect(back.tile(1, -1)).toEqual(map.tile(1, -1));
    // A generated column's tile is a few hundred bytes as saved, at most.
    const bytes = Object.values(saved as Record<string, string>).map((s) => s.length);
    expect(Math.max(...bytes)).toBeLessThan(800);
    const junk = WorldMap.from({ ...saved, 'a,b': saved['0,0'], '3,3': 'not base 64!', '4,4': btoa('xy'), '5,5': 12 });
    expect(junk.size).toBe(9);
    expect(WorldMap.from('nothing').size).toBe(0);
    expect(WorldMap.from(null).size).toBe(0);
  });

  it('is made from paper, made from reeds', () => {
    expect(RECIPES.find((r) => r.makes === Item.Paper)).toMatchObject({ count: 3, cost: [[Block.Reeds, 3]] });
    expect(RECIPES.find((r) => r.makes === Item.Map)).toMatchObject({ count: 1, cost: [[Item.Paper, 8], [Item.Copper, 1]] });
  });
});
