// The world: a sparse map of chunks with block access in world coordinates.
// Pure simulation (no Three.js), so the same code runs in tests and, later, in workers.

import { Block } from './blocks';
import { chunkKey, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal, CHUNK_MASK } from './coords';
import { Generator } from './generate';

export class Chunk {
  /** Bumped on every edit, so the renderer knows to remesh. */
  version = 0;
  /** Edited by the player since generation (these must be saved, Milestone 4). */
  modified = false;

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
    readonly blocks: Uint8Array,
  ) {}

  get key(): string {
    return chunkKey(this.cx, this.cy, this.cz);
  }
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly generator: Generator;

  constructor(seed: number) {
    this.generator = new Generator(seed);
  }

  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  /** The chunk, generating it first if needed. Undefined outside the world's vertical range. */
  ensureChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    if (cy < MIN_CHUNK_Y || cy > MAX_CHUNK_Y) return undefined;
    const key = chunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cy, cz, this.generator.generate(cx, cy, cz));
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /**
   * Block at world (x, y, z). Below the world is stone and above it is air; inside the
   * vertical range, an unloaded chunk reads as air.
   */
  getBlock(x: number, y: number, z: number): Block {
    const cy = toChunk(y);
    if (cy < MIN_CHUNK_Y) return Block.Stone;
    if (cy > MAX_CHUNK_Y) return Block.Air;
    const chunk = this.chunks.get(chunkKey(toChunk(x), cy, toChunk(z)));
    return chunk ? (chunk.blocks[localIndex(toLocal(x), toLocal(y), toLocal(z))] as Block) : Block.Air;
  }

  /**
   * Set a block. Returns the chunks whose meshes are now stale: the block's own chunk, plus
   * neighbours when the block is on a chunk face (their border faces may appear or vanish).
   */
  setBlock(x: number, y: number, z: number, block: Block): Chunk[] {
    const chunk = this.getChunk(toChunk(x), toChunk(y), toChunk(z));
    if (!chunk) return [];
    const i = localIndex(toLocal(x), toLocal(y), toLocal(z));
    if (chunk.blocks[i] === block) return [];
    chunk.blocks[i] = block;
    chunk.version++;
    chunk.modified = true;

    const stale = [chunk];
    const lx = toLocal(x);
    const ly = toLocal(y);
    const lz = toLocal(z);
    const touch = (dx: number, dy: number, dz: number) => {
      const n = this.getChunk(chunk.cx + dx, chunk.cy + dy, chunk.cz + dz);
      if (n) {
        n.version++;
        stale.push(n);
      }
    };
    if (lx === 0) touch(-1, 0, 0);
    if (lx === CHUNK_MASK) touch(1, 0, 0);
    if (ly === 0) touch(0, -1, 0);
    if (ly === CHUNK_MASK) touch(0, 1, 0);
    if (lz === 0) touch(0, 0, -1);
    if (lz === CHUNK_MASK) touch(0, 0, 1);
    return stale;
  }

  /** Remove a chunk's data (when far away). Modified chunks should be saved first (Milestone 4). */
  unload(chunk: Chunk): void {
    this.chunks.delete(chunk.key);
  }
}
