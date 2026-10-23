// The mesher's input: a chunk's blocks plus a one-block border from its 26 neighbours, so
// faces and (later) ambient occlusion at the chunk's edges can be decided without the world.
// This is what gets posted to a mesh worker.

import { Block } from '../world/blocks';
import { CHUNK_SIZE, MIN_CHUNK_Y } from '../world/coords';
import type { World } from '../world/world';

const S = CHUNK_SIZE;
/** Padded size: one block of the neighbours on every side. */
export const PADDED = S + 2;
export const PADDED_VOLUME = PADDED ** 3;

/** Index into a padded array; (1, 1, 1) is the chunk's local (0, 0, 0). Same order as chunks: x, then z, then y. */
export const paddedIndex = (x: number, y: number, z: number): number => (y * PADDED + z) * PADDED + x;

// Per padded coordinate 0..33: which neighbour (-1, 0, 1) it falls in and its local coordinate there.
const SIDE = new Int8Array(PADDED);
const LOCAL = new Uint8Array(PADDED);
for (let p = 0; p < PADDED; p++) {
  SIDE[p] = p === 0 ? -1 : p === PADDED - 1 ? 1 : 0;
  LOCAL[p] = p === 0 ? S - 1 : p === PADDED - 1 ? 0 : p - 1;
}

/**
 * Copy a chunk's blocks plus a one-block border from its neighbours into `out`. Reads as
 * `World.getBlock` would: stone below the world, air above it and in unloaded chunks.
 * Copies whole rows of x at a time.
 */
export function paddedBlocks(world: World, cx: number, cy: number, cz: number, out: Uint8Array = new Uint8Array(PADDED_VOLUME)): Uint8Array {
  // The 27 chunks around (and including) this one, indexed (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1),
  // with the block an absent one reads as.
  const blocks: (Uint8Array | undefined)[] = [];
  const fill: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        blocks.push(world.getChunk(cx + dx, cy + dy, cz + dz)?.blocks);
        fill.push(cy + dy < MIN_CHUNK_Y ? Block.Stone : Block.Air);
      }
    }
  }

  for (let py = 0; py < PADDED; py++) {
    for (let pz = 0; pz < PADDED; pz++) {
      const n = (SIDE[py] + 1) * 9 + (SIDE[pz] + 1) * 3; // the dx = -1 neighbour of this row
      const src = (LOCAL[py] * S + LOCAL[pz]) * S; // local (0, ly, lz)
      const row = paddedIndex(0, py, pz);
      const west = blocks[n];
      const middle = blocks[n + 1];
      const east = blocks[n + 2];
      out[row] = west ? west[src + S - 1] : fill[n];
      if (middle) out.set(middle.subarray(src, src + S), row + 1);
      else out.fill(fill[n + 1], row + 1, row + 1 + S);
      out[row + PADDED - 1] = east ? east[src] : fill[n + 2];
    }
  }
  return out;
}
