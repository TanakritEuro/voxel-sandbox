// The world: a sparse map of chunks with block access in world coordinates.
// Pure simulation (no Three.js), so the same code runs in tests and, later, in workers.

import { Block } from './blocks';
import { CHUNK_BITS, CHUNK_MASK, CHUNK_VOLUME, chunkKey, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal } from './coords';
import { coverTile, RAIN_STOP, updateCover } from './cover';
import { Generator, type GeneratorOptions } from './generate';
import { DARK, FULL_SUN, lightBorders, lightColumn, type PackedLight, sameLight, SUNLIT, unpackLight, updateLight, updateLightAt } from './light';
import { chunkRegions, OPEN_REGIONS, type Regions, seeThrough, SOLID_REGIONS } from './visibility';

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
  /** Its open regions (`visibility.ts`); null until worked out. */
  private regionData: Regions | null = null;
  /**
   * The version at which a block last changed between see-through and not, which may number its
   * regions differently: meshes made before it don't match the regions (`chunkLoader.ts`).
   */
  regionsVersion = 0;
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

  /**
   * Its open regions: given by the worker that made it, else worked out when first asked (and
   * again after an edit that changed whether a block can be seen through).
   */
  get regions(): Regions {
    this.regionData ??= this.empty ? OPEN_REGIONS : chunkRegions(this.blocks);
    return this.regionData;
  }

  /** Regions from a worker (copies of the shared ones made the shared ones again), or null to work them out when next asked. */
  set regions(regions: Regions | null) {
    this.regionData = regions === null ? null : regions.count === 0 ? SOLID_REGIONS : regions.shared ? OPEN_REGIONS : regions;
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
  /** Columns' cover tiles (`cover.ts`), by "cx,cz": given by the worker, or worked out when first asked for. */
  private readonly covers = new Map<string, Uint8Array>();
  /** Columns whose cover changed, came or went, for whoever draws it to take up and clear (`render/coverMap.ts`). */
  readonly coverChanged = new Map<string, readonly [number, number]>();

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
  addColumn(cx: number, cz: number, chunks: (Uint8Array | null)[], regions?: (Regions | null)[], light: PackedLight[] = lightColumn(chunks), cover?: Uint8Array): number {
    // The cover given is of these chunks: no good if any already loaded stays instead.
    let asGiven = cover !== undefined;
    chunks.forEach((blocks, i) => {
      const cy = MIN_CHUNK_Y + i;
      if (this.chunks.has(chunkKey(cx, cy, cz))) {
        asGiven = false;
        return;
      }
      this.addGenerated(cx, cy, cz, blocks);
      const chunk = this.getChunk(cx, cy, cz)!;
      chunk.light = unpackLight(light[i]);
      if (regions?.[i]) chunk.regions = regions[i];
    });
    const key = coverKey(cx, cz);
    if (asGiven) this.covers.set(key, cover!);
    else this.covers.delete(key);
    this.coverChanged.set(key, [cx, cz]);
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

  /** Column (cx, cz)'s cover tile (`cover.ts`), worked out now if it wasn't given; undefined if it isn't loaded. */
  coverOf(cx: number, cz: number): Uint8Array | undefined {
    const key = coverKey(cx, cz);
    let tile = this.covers.get(key);
    if (tile || !this.hasColumn(cx, cz)) return tile;
    const chunks: (Uint8Array | null)[] = [];
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
      const chunk = this.getChunk(cx, cy, cz)!;
      chunks.push(chunk.empty ? null : chunk.blocks);
    }
    tile = coverTile(chunks, cx, cz, this.generator.seed, this.generator.climate);
    this.covers.set(key, tile);
    return tile;
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

  /**
   * Set many blocks (`[x, y, z, block]` each: a tick of flowing water), then bring the light up
   * to date for all of them at once. Returns the chunks whose meshes are now stale, each once,
   * as `setBlock` would for them all. `lightMs` is how long the light took.
   */
  setBlocks(changes: readonly (readonly [number, number, number, Block])[]): Chunk[] {
    const stale = new Set<Chunk>();
    const at: number[] = [];
    for (const [x, y, z, block] of changes) {
      const was = this.getBlock(x, y, z);
      const s = this.setBlockOnly(x, y, z, block);
      if (!s.length) continue;
      for (const c of s) stale.add(c);
      // Only blocks that treat light differently change it (not a wire's power, say).
      if (!sameLight(was, block)) at.push(x, y, z);
    }
    if (!at.length) {
      this.lightMs = 0;
      return [...stale];
    }
    const t0 = performance.now();
    const lit = updateLightAt(this, at);
    this.lightMs = performance.now() - t0;
    for (const c of lit) {
      if (stale.has(c)) continue;
      c.version++;
      stale.add(c);
    }
    return [...stale];
  }

  /** Time the light of the last `setBlock` or `setBlocks` took (ms). */
  lightMs = 0;

  private setBlockOnly(x: number, y: number, z: number, block: Block): Chunk[] {
    const chunk = this.getChunk(toChunk(x), toChunk(y), toChunk(z));
    if (!chunk) return [];
    const i = localIndex(toLocal(x), toLocal(y), toLocal(z));
    const was = chunk.blocks[i];
    if (was === block) return [];
    if (chunk.blocks === EMPTY_BLOCKS) chunk.blocks = new Uint8Array(CHUNK_VOLUME);
    chunk.blocks[i] = block;
    chunk.version++;
    chunk.modified = true;
    chunk.empty = false;
    // Opened or closed: the regions are worked out again when next asked.
    if (seeThrough(was) !== seeThrough(block)) {
      chunk.regions = null;
      chunk.regionsVersion = chunk.version;
    }
    // Only a block stopping rain otherwise can move the cover (most edits can't: a wire's power, say).
    if (RAIN_STOP[was] !== RAIN_STOP[block]) {
      const key = coverKey(chunk.cx, chunk.cz);
      const tile = this.covers.get(key);
      if (tile && updateCover(tile, (toLocal(z) << CHUNK_BITS) | toLocal(x), y, block, (below) => this.getBlock(x, below, z)))
        this.coverChanged.set(key, [chunk.cx, chunk.cz]);
    }

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
    const key = coverKey(chunk.cx, chunk.cz);
    this.covers.delete(key);
    this.coverChanged.set(key, [chunk.cx, chunk.cz]);
  }
}

const coverKey = (cx: number, cz: number): string => `${cx},${cz}`;
