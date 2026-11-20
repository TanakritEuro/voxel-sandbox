import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { canMake, make, RECIPES } from '../src/survival/crafting';
import { dropsOf } from '../src/survival/drops';
import { Inventory } from '../src/survival/inventory';
import { Item } from '../src/survival/items';
import { LOOT } from '../src/survival/loot';
import { Block, BLOCKS, lanternFor, PLACEABLE, torchSupport } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { createBody, moveBody } from '../src/world/physics';
import { raycast } from '../src/world/raycast';
import { StructureKind } from '../src/world/structures';
import { torchesHeldBy } from '../src/world/torches';
import { Chunk, World } from '../src/world/world';

/** A world of one empty chunk at (0, 1, 0): blocks 0..31 across, 32..63 up. */
function emptyWorld(): World {
  const world = new World(1);
  const c = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
  world.chunks.set(c.key, c);
  return world;
}

describe('the lantern', () => {
  it('stands on a floor, hangs under a ceiling, and against a wall takes whichever holds it', () => {
    const S = Block.Stone;
    const A = Block.Air;
    expect(lanternFor(1, S, A)).toBe(Block.Lantern);
    expect(lanternFor(-1, A, S)).toBe(Block.LanternHanging);
    expect(lanternFor(0, S, S)).toBe(Block.Lantern);
    expect(lanternFor(0, A, S)).toBe(Block.LanternHanging);
    expect(lanternFor(0, A, A)).toBe(null);
    // Nothing solid to hold it: none (a torch or glass doesn't hold it).
    expect(lanternFor(1, Block.Glass, A)).toBe(null);
    // The picker offers the standing one.
    expect(PLACEABLE).toContain(Block.Lantern);
    expect(PLACEABLE).not.toContain(Block.LanternHanging);
  });

  it('is held up by the block under it or over it, and goes with it, giving a lantern', () => {
    expect(torchSupport(Block.Lantern)).toEqual([0, -1, 0]);
    expect(torchSupport(Block.LanternHanging)).toEqual([0, 1, 0]);
    const world = emptyWorld();
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(5, 41, 5, Block.Lantern);
    world.setBlock(5, 39, 5, Block.LanternHanging);
    expect(torchesHeldBy(world, 5, 40, 5).sort()).toEqual([
      [5, 39, 5],
      [5, 41, 5],
    ]);
    expect(dropsOf(Block.LanternHanging, undefined, 0)).toEqual([[Block.Lantern, 1]]);
    expect(dropsOf(Block.Lantern, undefined, 0)).toEqual([[Block.Lantern, 1]]);
  });

  it('gives light 15', () => {
    const world = emptyWorld();
    for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) world.setBlock(x, 63, z, Block.Stone);
    world.setBlock(10, 50, 10, Block.Stone);
    world.setBlock(10, 49, 10, Block.LanternHanging);
    expect(world.getLight(10, 49, 10) & 15).toBe(15);
    expect(world.getLight(10, 45, 10) & 15).toBe(11);
  });

  it('is made from an iron and a torch, and found in dungeons', () => {
    const recipe = RECIPES.find((r) => r.makes === Block.Lantern)!;
    expect(recipe.cost).toEqual([
      [Item.Iron, 1],
      [Block.Torch, 1],
    ]);
    const pack = new Inventory();
    pack.add(Item.Iron);
    pack.add(Block.Torch);
    expect(canMake(pack, recipe)).toBe(true);
    make(pack, recipe);
    expect(pack.count(Block.Lantern)).toBe(1);
    expect(LOOT[StructureKind.Dungeon].some(([item]) => item === Block.Lantern)).toBe(true);
  });

  it('is a small box: drawn, hit and bumped into as its boxes, in the solid pass', () => {
    const world = emptyWorld();
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(5, 41, 5, Block.Lantern);
    const m = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0, paddedLight(world, 0, 1, 0));
    expect(m.transparent.indices.length).toBe(0);
    // The stone's 6 faces (the lantern hides none), and the two boxes' 5 each (the body's bottom on the stone, the cap's on the body).
    const quads = m.opaque.indices.length / 6;
    expect(quads).toBe(6 + 5 + 5);
    // A ray over the lantern's corner misses it; one at its middle hits.
    const miss = raycast(world, { x: 5.05, y: 41.3, z: 3 }, { x: 0, y: 0, z: 1 }, 5);
    expect(miss?.y === 41).toBe(false);
    const hit = raycast(world, { x: 5.5, y: 41.2, z: 3 }, { x: 0, y: 0, z: 1 }, 5)!;
    expect([hit.x, hit.y, hit.z]).toEqual([5, 41, 5]);
    // Walking into it stops at its side, not the block's.
    const body = createBody(5.5, 41, 3.5);
    moveBody(body, 0, 0, 2, world);
    expect(body.z + body.halfWidth).toBeCloseTo(5 + 5 / 16, 5);
    expect(BLOCKS[Block.Lantern].light).toBe(15);
  });
});
