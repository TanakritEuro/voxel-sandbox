// The world: a sparse map of chunks with block access in world coordinates.
// Pure simulation (no Three.js), so the same code runs in tests and, later, in workers.

import { Block } from './blocks';
import { CHUNK_MASK, CHUNK_VOLUME, chunkKey, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal } from './coords';
import { Generator, type GeneratorOptions } from './generate';
import { DARK, FULL_SUN, lightBorders, lightColumn, type PackedLight, SUNLIT, unpackLight, updateLight } from './light';
import { ALL_CONNECTED, chunkConnectivity } from './visibility';

/**
 * The blocks of every all-air chunk until it's edited: one shared array, so the half of the
 * world that is sky costs nothing. Never written to; `setBlock` gives a chunk its own first.
 */
export const EMPTY_BLOCKS = new Uint8Array(CHUNK_VOLUME);

export class Chunk {
  /** Bumped on every edit, so the renderer knows to remesh. */
  version = 0;
  /** Edited by the player since it was generated or loaded (`save/saver.ts` keeps track of what to write). */
  modified = false;
  /** Which faces see each other through open space (`visibility.ts`); -1 until worked out. */
  private connections = -1;
  /** Sun << 4 | block light per block (`light.ts`); `FULL_SUN` or `DARK` (shared, read-only) until it differs. */
  light: Uint8Array = DARK;

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
    /** Block ids; `EMPTY_BLOCKS` (shared, read-only) until an all-air chunk is first edited. */
    public blocks: Uint8Array,
    /** All air as generated and not edited since: nothing to mesh. */
    public empty = false,
  ) {
    this.key = chunkKey(cx, cy, cz);
  }

  /** "cx,cy,cz": made once, as maps keyed by it are asked thousands of times a frame. */
  readonly key: string;

  /** Faces connected through the chunk's open space: given by the worker that made it, else worked out when first asked. */
  get connectivity(): number {
    if (this.connections < 0) this.connections = this.empty ? ALL_CONNECTED : chunkConnectivity(this.blocks);
    return this.connections;
  }

  set connectivity(mask: number) {
    this.connections = mask;
  }

  /** The light array, made the chunk's own first if it was a shared one: call before writing to it. */
  ownLight(): Uint8Array {
    if (this.light === FULL_SUN || this.light === DARK) this.light = this.light.slice();
    return this.light;
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

  /** The chunk, generating its column first if needed (light needs the whole column). Undefined outside the world's vertical range. */
  ensureChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    if (cy < MIN_CHUNK_Y || cy > MAX_CHUNK_Y) return undefined;
    this.ensureColumn(cx, cz);
    return this.getChunk(cx, cy, cz);
  }

  /** Generate whatever is missing of the column (cx, cz), all heights at once. */
  ensureColumn(cx: number, cz: number): void {
    if (!this.hasColumn(cx, cz)) this.addColumn(cx, cz, this.generator.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y));
  }

  /** Whether every chunk of the column (cx, cz) is loaded. */
  hasColumn(cx: number, cz: number): boolean {
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) if (!this.chunks.has(chunkKey(cx, cy, cz))) return false;
    return true;
  }

  /**
   * Store a generated column (from `generateColumn`, here or in a worker), except chunks
   * already loaded: edited chunks stay as they are. Its light, if not given, is worked out
   * here; then light flows across its borders with the loaded columns beside it. Returns the
   * number of blocks that flow lit or brightened.
   */
  addColumn(cx: number, cz: number, chunks: (Uint8Array | null)[], connectivity?: number[], light: PackedLight[] = lightColumn(chunks)): number {
    chunks.forEach((blocks, i) => {
      const cy = MIN_CHUNK_Y + i;
      if (this.chunks.has(chunkKey(cx, cy, cz))) return;
      this.addGenerated(cx, cy, cz, blocks);
      const chunk = this.getChunk(cx, cy, cz)!;
      chunk.light = unpackLight(light[i]);
      if (connectivity) chunk.connectivity = connectivity[i];
    });
    return lightBorders(this, cx, cz);
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

  /** Light at world (x, y, z), packed (sun << 4 | block light): full sun above the world, none below it or in unloaded chunks. */
  getLight(x: number, y: number, z: number): number {
    const cy = toChunk(y);
    if (cy < MIN_CHUNK_Y) return 0;
    if (cy > MAX_CHUNK_Y) return SUNLIT;
    const chunk = this.chunks.get(chunkKey(toChunk(x), cy, toChunk(z)));
    return chunk ? chunk.light[localIndex(toLocal(x), toLocal(y), toLocal(z))] : 0;
  }

  /**
   * Set a block and bring the light around it up to date. Returns the chunks whose meshes
   * are now stale: the block's own chunk, every neighbour whose padded copy includes it (up
   * to 7 at a chunk corner: face neighbours' border faces may appear or vanish, diagonal
   * ones' corner AO may change), and every chunk whose light changed or pads light that did.
   * All of them get a new version. `lightMs` is how long the light took.
   */
  setBlock(x: number, y: number, z: number, block: Block): Chunk[] {
    const stale = this.setBlockOnly(x, y, z, block);
    if (!stale.length) return stale;
    const t0 = performance.now();
    const lit = updateLight(this, x, y, z);
    this.lightMs = performance.now() - t0;
    for (const c of stale) lit.delete(c);
    for (const c of lit) {
      c.version++;
      stale.push(c);
    }
    return stale;
  }

  /** Time the light of the last `setBlock` took (ms). */
  lightMs = 0;

  private setBlockOnly(x: number, y: number, z: number, block: Block): Chunk[] {
    const chunk = this.getChunk(toChunk(x), toChunk(y), toChunk(z));
    if (!chunk) return [];
    const i = localIndex(toLocal(x), toLocal(y), toLocal(z));
    if (chunk.blocks[i] === block) return [];
    if (chunk.blocks === EMPTY_BLOCKS) chunk.blocks = new Uint8Array(CHUNK_VOLUME);
    chunk.blocks[i] = block;
    chunk.version++;
    chunk.modified = true;
    chunk.empty = false;
    chunk.connectivity = -1; // worked out again when next asked

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

  /** Bytes of light data held: chunks with their own arrays, plus the two shared ones. */
  get lightBytes(): number {
    let owned = 0;
    for (const chunk of this.chunks.values()) if (chunk.light !== FULL_SUN && chunk.light !== DARK) owned++;
    return (owned + 2) * CHUNK_VOLUME;
  }

  /** Remove a chunk's data (when far away). Edited chunks should be saved first (`ChunkSaves.unloading`). */
  unload(chunk: Chunk): void {
    this.chunks.delete(chunk.key);
  }
}
