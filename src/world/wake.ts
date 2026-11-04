// Waking what moves on its own (flowing water, logic) when a column loads: the blocks of its kind in
// the column itself, if it was read from the save (so what was left going carries on), and those
// on the faces of the loaded columns beside it that look into it (held back by it while it
// wasn't loaded). Generated land has none of either, so the faces only cost a look. Pure.

import { CHUNK_SIZE, CHUNK_VOLUME, MAX_CHUNK_Y, MIN_CHUNK_Y } from './coords';
import { EMPTY_BLOCKS, type World } from './world';

const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];

/**
 * Column (cx, cz) has just loaded: call `wake` for every block that `kind` says moves, in it if
 * `saved`, and on the faces of its loaded neighbours looking into it. Returns how many.
 */
export function wakeColumnBlocks(world: World, cx: number, cz: number, saved: boolean, kind: Uint8Array, wake: (x: number, y: number, z: number) => void): number {
  const S = CHUNK_SIZE;
  let woken = 0;
  for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
    const own = saved ? world.getChunk(cx, cy, cz) : undefined;
    if (own && own.blocks !== EMPTY_BLOCKS) {
      const blocks = own.blocks;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (!kind[blocks[i]]) continue;
        wake(cx * S + (i & 31), cy * S + (i >> 10), cz * S + ((i >> 5) & 31));
        woken++;
      }
    }
    for (let d = 0; d < 4; d++) {
      const n = world.getChunk(cx + DX[d], cy, cz + DZ[d]);
      if (!n || n.blocks === EMPTY_BLOCKS) continue;
      // The face of the neighbour that looks back towards (cx, cz).
      for (let a = 0; a < S; a++) {
        const lx = DX[d] > 0 ? 0 : DX[d] < 0 ? S - 1 : a;
        const lz = DZ[d] > 0 ? 0 : DZ[d] < 0 ? S - 1 : a;
        for (let ly = 0; ly < S; ly++) {
          if (!kind[n.blocks[(ly * S + lz) * S + lx]]) continue;
          wake(n.cx * S + lx, cy * S + ly, n.cz * S + lz);
          woken++;
        }
      }
    }
  }
  return woken;
}
