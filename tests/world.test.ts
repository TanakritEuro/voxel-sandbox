import { describe, expect, it } from 'vitest';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, localIndex, toChunk, toLocal } from '../src/world/coords';
import { Generator, SEA_LEVEL, SURFACE_ONLY } from '../src/world/generate';
import { World } from '../src/world/world';

describe('coordinates', () => {
  it('rounds negative coordinates down to the right chunk', () => {
    expect(toChunk(0)).toBe(0);
    expect(toChunk(31)).toBe(0);
    expect(toChunk(32)).toBe(1);
    expect(toChunk(-1)).toBe(-1);
    expect(toChunk(-32)).toBe(-1);
    expect(toChunk(-33)).toBe(-2);
    expect(toLocal(-1)).toBe(31);
    expect(localIndex(31, 31, 31)).toBe(CHUNK_SIZE ** 3 - 1);
  });
});

describe('generation', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = new Generator(1).generate(3, 1, -2);
    const b = new Generator(1).generate(3, 1, -2);
    const c = new Generator(2).generate(3, 1, -2);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('builds columns of stone, then dirt or sand, a surface block, then water or air', () => {
    const world = new World(42, SURFACE_ONLY);
    for (let cy = 0; cy <= 3; cy++) world.ensureChunk(0, cy, 0);
    for (const [x, z] of [[3, 5], [17, 9], [30, 30]]) {
      const h = world.generator.height(x, z);
      const top = world.getBlock(x, h, z);
      expect([Block.Grass, Block.Sand]).toContain(top);
      expect(world.getBlock(x, h - 5, z)).toBe(Block.Stone);
      expect(world.getBlock(x, h + 1, z)).toBe(h + 1 <= SEA_LEVEL ? Block.Water : Block.Air);
    }
  });
});

describe('world', () => {
  it('reads and writes blocks across chunk boundaries, including negative coordinates', () => {
    const world = new World(1);
    world.ensureChunk(-1, 2, -1);
    world.ensureChunk(0, 2, 0);
    world.setBlock(-1, 70, -1, Block.Planks);
    world.setBlock(0, 70, 0, Block.Glass);
    expect(world.getBlock(-1, 70, -1)).toBe(Block.Planks);
    expect(world.getBlock(0, 70, 0)).toBe(Block.Glass);
    expect(world.getChunk(-1, 2, -1)!.blocks[localIndex(31, 6, 31)]).toBe(Block.Planks);
  });

  it('marks neighbouring chunks stale when a border block changes', () => {
    const world = new World(1);
    world.ensureChunk(0, 2, 0);
    world.ensureChunk(1, 2, 0);
    world.ensureChunk(0, 2, 1);
    expect(world.setBlock(31, 70, 31, Block.Stone).map((c) => c.key).sort()).toEqual(['0,2,0', '0,2,1', '1,2,0']);
    expect(world.setBlock(10, 70, 10, Block.Dirt).map((c) => c.key)).toEqual(['0,2,0']);
  });

  it('treats below the world as stone and above it as air', () => {
    const world = new World(1);
    expect(world.getBlock(0, -1, 0)).toBe(Block.Stone);
    expect(world.getBlock(0, 1000, 0)).toBe(Block.Air);
  });
});

describe('spawn', () => {
  it('finds dry land', () => {
    const g = new Generator(20261022);
    const land = g.findLand(0, 0);
    expect(g.height(land.x, land.z)).toBeGreaterThan(SEA_LEVEL + 3);
  });
});
