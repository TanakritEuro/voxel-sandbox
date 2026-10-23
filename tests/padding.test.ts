import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { PADDED, paddedBlocks, paddedIndex, PADDED_VOLUME } from '../src/mesh/padding';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { World } from '../src/world/world';

/** The obvious version: one `getBlock` per cell. */
function paddedReference(world: World, cx: number, cy: number, cz: number): Uint8Array {
  const out = new Uint8Array(PADDED_VOLUME);
  for (let y = 0; y < PADDED; y++)
    for (let z = 0; z < PADDED; z++)
      for (let x = 0; x < PADDED; x++)
        out[paddedIndex(x, y, z)] = world.getBlock(cx * CHUNK_SIZE + x - 1, cy * CHUNK_SIZE + y - 1, cz * CHUNK_SIZE + z - 1);
  return out;
}

describe('paddedBlocks', () => {
  it('matches reading every cell from the world, at edges, corners and the world bottom and top', () => {
    const world = new World(7);
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++)
      for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureChunk(cx, cy, cz);
    // Distinct blocks on every edge and corner of the middle chunks' neighbourhoods.
    const rng = createRng(3);
    const edge = [-1, 0, 31, 32];
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++)
      for (const x of edge)
        for (const z of edge)
          for (const ly of [-1, 0, 15, 31, 32]) {
            const y = cy * CHUNK_SIZE + ly;
            if (y >= 0 && y < (MAX_CHUNK_Y + 1) * CHUNK_SIZE) world.setBlock(x, y, z, 1 + Math.floor(rng() * 9));
          }
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) expect(paddedBlocks(world, 0, cy, 0)).toEqual(paddedReference(world, 0, cy, 0));
  });

  it('reads unloaded neighbours as air', () => {
    const world = new World(7);
    world.ensureChunk(0, 1, 0);
    const padded = paddedBlocks(world, 0, 1, 0);
    expect(padded).toEqual(paddedReference(world, 0, 1, 0));
    expect(padded[paddedIndex(0, 5, 5)]).toBe(Block.Air);
  });

  it('writes into a reused array', () => {
    const world = new World(7);
    world.ensureChunk(0, 0, 0);
    const out = new Uint8Array(PADDED_VOLUME).fill(99);
    expect(paddedBlocks(world, 0, 0, 0, out)).toBe(out);
    expect(out).toEqual(paddedReference(world, 0, 0, 0));
  });
});
