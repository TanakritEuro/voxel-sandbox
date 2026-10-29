// Blocks for path searches, read as `World.getBlock` reads them but much faster: a search looks
// at thousands of blocks, and `getBlock` builds a string key for each one's chunk. This keeps the
// chunks it has looked up by a number key. Make one per search (or per frame): an edit can give
// an all-air chunk a block array of its own, which a longer-lived cache would miss.

import { Block } from '../world/blocks';
import { localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal } from '../world/coords';
import type { BlockSource } from '../world/physics';
import type { World } from '../world/world';

export class BlockCache implements BlockSource {
  private readonly chunks = new Map<number, Uint8Array | null>();
  /** The chunk looked at last, by key: most reads are in the same chunk as the one before. */
  private lastKey = -1;
  private last: Uint8Array | null = null;

  constructor(private readonly world: World) {}

  getBlock(x: number, y: number, z: number): Block {
    const cy = toChunk(y);
    if (cy < MIN_CHUNK_Y) return Block.Stone;
    if (cy > MAX_CHUNK_Y) return Block.Air;
    const cx = toChunk(x);
    const cz = toChunk(z);
    const key = ((cx + 0x8000) * 0x10000 + (cz + 0x8000)) * 16 + cy;
    let blocks = this.last;
    if (key !== this.lastKey) {
      let found = this.chunks.get(key);
      if (found === undefined) {
        found = this.world.getChunk(cx, cy, cz)?.blocks ?? null;
        this.chunks.set(key, found);
      }
      blocks = this.last = found;
      this.lastKey = key;
    }
    // Unloaded: air, as `World.getBlock` has it.
    return blocks ? (blocks[localIndex(toLocal(x), toLocal(y), toLocal(z))] as Block) : Block.Air;
  }
}
