// The world: a sparse map of chunks with block access in world coordinates.
// Pure simulation (no Three.js), so the same code runs in tests and, later, in workers.

import { Block } from './blocks';
import { CHUNK_MASK, CHUNK_VOLUME, chunkKey, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal } from './coords';
import { Generator, type GeneratorOptions } from './generate';

/**
 * The blocks of every all-air chunk until it's edited: one shared array, so the half of the
 * world that is sky costs nothing. Never written to; `setBlock` gives a chunk its own first.
 */
export const EMPTY_BLOCKS = new Uint8Array(CHUNK_VOLUME);

export class Chunk {
  /** Bumped on every edit, so the renderer knows to remesh. */
  version = 0;
  /** Edited by the player since generation (these must be saved, Milestone 4). */
  modified = false;

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
    /** Block ids; `EMPTY_BLOCKS` (shared, read-only) until an all-air chunk is first edited. */
    public blocks: Uint8Array,
    /** All air as generated and not edited since: nothing to mesh. */
    public empty = false,
  ) {}

  get key(): string {
    return chunkKey(this.cx, this.cy, this.cz);
  }
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly generator: Generator;

  constructor(seed: number, options?: GeneratorOptions) {
    this.generator = new Generator(seed, options);
  }

  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  /** The chunk, generating it first if needed. Undefined outside the world's vertical range. */
  ensureChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    if (cy < MIN_CHUNK_Y || cy > MAX_CHUNK_Y) return undefined;
    if (!this.chunks.has(chunkKey(cx, cy, cz))) this.addGenerated(cx, cy, cz, this.generator.generateColumn(cx, cz, cy, cy)[0]);
    return this.getChunk(cx, cy, cz);
  }

  /** Generate whatever is missing of the column (cx, cz), all heights at once. */
  ensureColumn(cx: number, cz: number): void {
    if (!this.hasColumn(cx, cz)) this.addColumn(cx, cz, MIN_CHUNK_Y, this.generator.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y));
  }

  /** Whether every chunk of the column (cx, cz) is loaded. */
  hasColumn(cx: number, cz: number): boolean {
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) if (!this.chunks.has(chunkKey(cx, cy, cz))) return false;
    return true;
  }

  /**
   * Store generated chunks cyMin.. upwards of a column (from `generateColumn`, here or in a
   * worker), except those already loaded: edited chunks stay as they are.
   */
  addColumn(cx: number, cz: number, cyMin: number, chunks: (Uint8Array | null)[]): void {
    chunks.forEach((blocks, i) => {
      if (!this.chunks.has(chunkKey(cx, cyMin + i, cz))) this.addGenerated(cx, cyMin + i, cz, blocks);
    });
  }

  /** Store a freshly generated chunk; null means all air. */
  private addGenerated(cx: number, cy: number, cz: number, blocks: Uint8Array | null): void {
    const chunk = new Chunk(cx, cy, cz, blocks ?? EMPTY_BLOCKS, blocks === null);
    this.chunks.set(chunk.key, chunk);
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
   * every neighbour whose padded copy includes it (up to 7 at a chunk corner). Face
   * neighbours' border faces may appear or vanish; diagonal ones' corner AO may change.
   */
  setBlock(x: number, y: number, z: number, block: Block): Chunk[] {
    const chunk = this.getChunk(toChunk(x), toChunk(y), toChunk(z));
    if (!chunk) return [];
    const i = localIndex(toLocal(x), toLocal(y), toLocal(z));
    if (chunk.blocks[i] === block) return [];
    if (chunk.blocks === EMPTY_BLOCKS) chunk.blocks = new Uint8Array(CHUNK_VOLUME);
    chunk.blocks[i] = block;
    chunk.version++;
    chunk.modified = true;
    chunk.empty = false;

    // Per axis, the chunk offsets whose border reaches this block: 0, and -1 or +1 at an edge.
    const sides = (l: number) => (l === 0 ? [0, -1] : l === CHUNK_MASK ? [0, 1] : [0]);
    const stale: Chunk[] = [];
    for (const dy of sides(toLocal(y))) {
      for (const dz of sides(toLocal(z))) {
        for (const dx of sides(toLocal(x))) {
          const n = this.getChunk(chunk.cx + dx, chunk.cy + dy, chunk.cz + dz);
          if (!n) continue;
          if (n !== chunk) n.version++;
          stale.push(n);
        }
      }
    }
    return stale;
  }

  /** Bytes of block data held: chunks with their own arrays (the shared empty one counts once). */
  get blockBytes(): number {
    let owned = 0;
    for (const chunk of this.chunks.values()) if (chunk.blocks !== EMPTY_BLOCKS) owned++;
    return (owned + 1) * CHUNK_VOLUME;
  }

  /** Remove a chunk's data (when far away). Modified chunks should be saved first (Milestone 4). */
  unload(chunk: Chunk): void {
    this.chunks.delete(chunk.key);
  }
}
