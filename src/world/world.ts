// The world: a sparse map of chunks with block access in world coordinates.
// Pure simulation (no Three.js), so the same code runs in tests and, later, in workers.

import { Block } from './blocks';
import { CHUNK_MASK, CHUNK_VOLUME, chunkKey, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal } from './coords';
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

  constructor(seed: number) {
    this.generator = new Generator(seed);
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
    let missing = false;
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) if (!this.chunks.has(chunkKey(cx, cy, cz))) missing = true;
    if (!missing) return;
    const generated = this.generator.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y);
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
      if (!this.chunks.has(chunkKey(cx, cy, cz))) this.addGenerated(cx, cy, cz, generated[cy - MIN_CHUNK_Y]);
    }
  }

  /** Store a freshly generated chunk; null means all air. */
  private addGenerated(cx: number, cy: number, cz: number, blocks: Uint8Array | null): void {
    const chunk = new Chunk(cx, cy, cz, blocks ?? new Uint8Array(CHUNK_VOLUME), blocks === null);
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

  /** Remove a chunk's data (when far away). Modified chunks should be saved first (Milestone 4). */
  unload(chunk: Chunk): void {
    this.chunks.delete(chunk.key);
  }
}
