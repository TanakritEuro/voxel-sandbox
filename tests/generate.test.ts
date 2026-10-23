import { describe, expect, it } from 'vitest';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { Generator, SEA_LEVEL } from '../src/world/generate';
import { EMPTY_BLOCKS, World } from '../src/world/world';

/** The scaffold's generator, one block at a time: what the column generator must reproduce. */
function generateReference(g: Generator, cx: number, cy: number, cz: number): Uint8Array {
  const blocks = new Uint8Array(CHUNK_VOLUME);
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const h = g.height(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz);
      const beach = h <= SEA_LEVEL + 1;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const y = cy * CHUNK_SIZE + ly;
        let b: Block = Block.Air;
        if (y < h - 3) b = Block.Stone;
        else if (y < h) b = beach ? Block.Sand : Block.Dirt;
        else if (y === h) b = beach ? Block.Sand : Block.Grass;
        else if (y <= SEA_LEVEL) b = Block.Water;
        blocks[localIndex(lx, ly, lz)] = b;
      }
    }
  }
  return blocks;
}

describe('column generation', () => {
  it('matches generating each block on its own, with all-air chunks as null', () => {
    const g = new Generator(20261022);
    let nulls = 0;
    for (const [cx, cz] of [[0, 0], [-3, 2], [5, -7], [12, 12]]) {
      const column = g.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y);
      expect(column).toHaveLength(MAX_CHUNK_Y - MIN_CHUNK_Y + 1);
      column.forEach((blocks, i) => {
        const reference = generateReference(g, cx, MIN_CHUNK_Y + i, cz);
        if (blocks === null) {
          nulls++;
          expect(reference.every((b) => b === Block.Air)).toBe(true);
        } else {
          expect(blocks).toEqual(reference);
          expect(blocks.some((b) => b !== Block.Air)).toBe(true);
        }
      });
    }
    expect(nulls).toBeGreaterThan(0);
  });

  it('gives the same chunk for a partial range as for the whole column', () => {
    const g = new Generator(5);
    const whole = g.generateColumn(2, -4, MIN_CHUNK_Y, MAX_CHUNK_Y);
    expect(g.generateColumn(2, -4, 1, 1)[0]).toEqual(whole[1 - MIN_CHUNK_Y]);
    expect(g.generate(2, 1, -4)).toEqual(whole[1 - MIN_CHUNK_Y]);
  });

  it('stores all-air chunks as empty air until edited', () => {
    const world = new World(20261022);
    world.ensureColumn(0, 0);
    const top = world.getChunk(0, MAX_CHUNK_Y, 0)!;
    const bottom = world.getChunk(0, MIN_CHUNK_Y, 0)!;
    expect(top.empty).toBe(true);
    expect(top.blocks.every((b) => b === Block.Air)).toBe(true);
    expect(bottom.empty).toBe(false);
    world.setBlock(3, MAX_CHUNK_Y * CHUNK_SIZE + 3, 3, Block.Stone);
    expect(top.empty).toBe(false);
  });

  it('shares one array between all-air chunks and gives a chunk its own on its first edit', () => {
    const world = new World(20261022);
    for (let cz = 0; cz <= 1; cz++) for (let cx = 0; cx <= 1; cx++) world.ensureColumn(cx, cz);
    const empties = [...world.chunks.values()].filter((c) => c.empty);
    expect(empties.length).toBeGreaterThan(3);
    for (const c of empties) expect(c.blocks).toBe(EMPTY_BLOCKS);
    const [edited, ...others] = empties;
    const y = edited.cy * CHUNK_SIZE + 3;
    world.setBlock(edited.cx * CHUNK_SIZE + 3, y, edited.cz * CHUNK_SIZE + 3, Block.Glass);
    expect(edited.blocks).not.toBe(EMPTY_BLOCKS);
    expect(world.getBlock(edited.cx * CHUNK_SIZE + 3, y, edited.cz * CHUNK_SIZE + 3)).toBe(Block.Glass);
    for (const c of others) expect(c.blocks).toBe(EMPTY_BLOCKS);
    expect(EMPTY_BLOCKS.every((b) => b === Block.Air)).toBe(true);
    // Only chunks with their own arrays count, plus the shared one once.
    const owned = [...world.chunks.values()].filter((c) => c.blocks !== EMPTY_BLOCKS).length;
    expect(world.blockBytes).toBe((owned + 1) * CHUNK_VOLUME);
  });

  it('fills in only the missing chunks of a column, keeping edited ones', () => {
    const world = new World(1);
    world.ensureChunk(0, 1, 0);
    world.setBlock(4, 40, 4, Block.Glass);
    world.ensureColumn(0, 0);
    expect(world.getBlock(4, 40, 4)).toBe(Block.Glass);
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) expect(world.getChunk(0, cy, 0)).toBeDefined();
  });
});
