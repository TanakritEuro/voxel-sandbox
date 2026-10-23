// The mesher's input: a chunk's blocks plus a one-block border from its 26 neighbours, so
// faces, ambient occlusion and light at the chunk's edges can be decided without the world;
// and its light, padded the same way. This is what gets posted to a mesh worker.

import { Block } from '../world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../world/coords';
import { SUNLIT } from '../world/light';
import type { Chunk, World } from '../world/world';

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
 */
export function paddedBlocks(world: World, cx: number, cy: number, cz: number, out: Uint8Array = new Uint8Array(PADDED_VOLUME)): Uint8Array {
  return pad(world, cx, cy, cz, out, (c) => c.blocks, Block.Stone, Block.Air, Block.Air);
}

/**
 * The same for light (`light.ts`). Reads as `World.getLight` would: dark below the world and
 * in unloaded chunks, full sun above it.
 */
export function paddedLight(world: World, cx: number, cy: number, cz: number, out: Uint8Array = new Uint8Array(PADDED_VOLUME)): Uint8Array {
  return pad(world, cx, cy, cz, out, (c) => c.light, 0, SUNLIT, 0);
}

/** Padded light for meshing shapes without caring about light (tests): full sun everywhere. */
export const ALL_SUNLIT = new Uint8Array(PADDED_VOLUME).fill(SUNLIT);

/**
 * Copy `pick` of a chunk and a one-block border of its neighbours' into `out`, whole rows of x
 * at a time. Absent chunks read as `below` under the world, `above` over it, else `unloaded`.
 */
function pad(world: World, cx: number, cy: number, cz: number, out: Uint8Array, pick: (c: Chunk) => Uint8Array, below: number, above: number, unloaded: number): Uint8Array {
  // The 27 chunks around (and including) this one, indexed (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1),
  // with the value an absent one reads as.
  const blocks: (Uint8Array | undefined)[] = [];
  const fill: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = world.getChunk(cx + dx, cy + dy, cz + dz);
        blocks.push(chunk && pick(chunk));
        fill.push(cy + dy < MIN_CHUNK_Y ? below : cy + dy > MAX_CHUNK_Y ? above : unloaded);
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
