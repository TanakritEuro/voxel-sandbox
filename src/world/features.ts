// Features placed into generated chunks. So far: ore veins.
//
// A vein starts at a seeded spot in some chunk and wanders a few blocks, never more than
// REACH from its start; it only replaces stone. Every chunk replays the veins of itself and
// its 26 neighbours and keeps the blocks that land inside it, so a vein crossing a chunk
// border comes out whole, whichever chunk is generated first or alone.

import { createRng, hash3 } from '../math';
import { Block } from './blocks';
import { CHUNK_SIZE } from './coords';

// Local copies: imported bindings can cost a lookup each time in the hot loops (they do under Vitest).
const S = CHUNK_SIZE;
const STONE = Block.Stone;

interface Ore {
  block: Block;
  /** Veins started per chunk (each in range or not). */
  perChunk: number;
  /** Blocks a vein tries to place, min and max. */
  size: [number, number];
  /** Only between these heights. */
  minY: number;
  maxY: number;
}

export const ORES: readonly Ore[] = [
  { block: Block.CoalOre, perChunk: 14, size: [5, 12], minY: 5, maxY: 200 },
  { block: Block.IronOre, perChunk: 7, size: [4, 8], minY: 5, maxY: 100 },
  { block: Block.CopperOre, perChunk: 4, size: [7, 14], minY: 5, maxY: 70 },
  { block: Block.CrystalOre, perChunk: 1, size: [1, 4], minY: 5, maxY: 24 },
];

/** A vein never wanders further than this from its start (in each axis). */
const REACH = 3;

/** Replace stone with ore wherever a vein from this chunk or a neighbour passes. Returns blocks placed. */
export function placeOres(blocks: Uint8Array, cx: number, cy: number, cz: number, seed: number): number {
  const x0 = cx * S;
  const y0 = cy * S;
  const z0 = cz * S;
  let placed = 0;
  for (let ncy = cy - 1; ncy <= cy + 1; ncy++)
    for (let ncz = cz - 1; ncz <= cz + 1; ncz++)
      for (let ncx = cx - 1; ncx <= cx + 1; ncx++)
        ORES.forEach((ore, o) => {
          for (let v = 0; v < ore.perChunk; v++) {
            const rng = createRng(Math.floor(hash3(seed ^ (o * 7919 + v * 104729), ncx, ncy, ncz) * 4294967296));
            const sx = ncx * S + Math.floor(rng() * S);
            const sy = ncy * S + Math.floor(rng() * S);
            const sz = ncz * S + Math.floor(rng() * S);
            if (sy < ore.minY || sy > ore.maxY) continue;
            // Too far from this chunk for any of it to land here.
            if (sx < x0 - REACH || sx >= x0 + S + REACH || sy < y0 - REACH || sy >= y0 + S + REACH || sz < z0 - REACH || sz >= z0 + S + REACH) continue;
            const size = ore.size[0] + Math.floor(rng() * (ore.size[1] - ore.size[0] + 1));
            let x = sx;
            let y = sy;
            let z = sz;
            for (let n = 0; n < size; n++) {
              const lx = x - x0;
              const ly = y - y0;
              const lz = z - z0;
              if (lx >= 0 && lx < S && ly >= 0 && ly < S && lz >= 0 && lz < S && y >= ore.minY && y <= ore.maxY) {
                const i = (ly * S + lz) * S + lx;
                if (blocks[i] === STONE) {
                  blocks[i] = ore.block;
                  placed++;
                }
              }
              // One step along a random axis, turned back at the edge of the vein's reach.
              const axis = Math.floor(rng() * 3);
              const step = rng() < 0.5 ? -1 : 1;
              if (axis === 0) x = Math.abs(x + step - sx) > REACH ? x - step : x + step;
              else if (axis === 1) y = Math.abs(y + step - sy) > REACH ? y - step : y + step;
              else z = Math.abs(z + step - sz) > REACH ? z - step : z + step;
            }
          }
        });
  return placed;
}
