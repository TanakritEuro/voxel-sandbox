// Terrain generation: a pure function of the seed and the chunk coordinate, so any chunk can
// be generated in any order, on any thread, and always comes out the same.
//
// A column job computes a height map a few blocks wider than its 32 × 32 columns (for slopes
// at the edges, and the ground of trees just outside them), then fills each column from its
// layers: what the biome puts on top and underneath, bare stone on steep slopes, sand or
// gravel under water, and water up to sea level. Then caves, ores and trees.

import { Biome, BIOME_COUNT, Climate } from './biomes';
import { Caves } from './caves';
import { type Ground, placeOres, placeTrees, TREE_REACH, TREE_TOP, treesIn } from './features';
import { Block } from './blocks';
import { CHUNK_BITS, CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, WORLD_HEIGHT } from './coords';
import { hash3 } from '../math';
import { Noise } from './noise';
import { Rivers } from './rivers';
import { placeStructures, type Structure, structureBlocks, type StructureKind, structuresIn, structureTop } from './structures';

export { SEA_LEVEL } from './coords';
/** Columns this steep (blocks up or down to a neighbour) show bare stone on top. */
const STEEP = 3;
/** Height map border around a column job's 32 × 32 columns: trees just outside them, and one more for their slopes. */
const BORDER = TREE_REACH + 1;
// Local copies: imported bindings can cost a lookup each time in the hot loops (they do under Vitest).
const S = CHUNK_SIZE;
const COLUMNS = S * S;
const Y_SHIFT = 2 * CHUNK_BITS;
const SPAN = S + 2 * BORDER;

/** What decides a column's blocks. */
export interface ColumnInfo {
  /** The y of the topmost solid block. */
  height: number;
  biome: Biome;
  /** Most blocks up or down to a neighbouring column. */
  slope: number;
  /** Mountains: above this y the top is snow. */
  snowLine: number;
}

/** A run of one block in a column: world y in [from, to). */
type Run = [from: number, to: number, block: Block];

/** Most runs a column has (stone, sandstone, under, top, water). */
const MAX_RUNS = 5;

/**
 * Write a column's blocks, bottom up, as runs of (from, to, block) into `out` starting at
 * `at`; returns how many. Everything above the last run is air. Allocates nothing: the
 * generator calls it for every column.
 */
export function writeLayers({ height: h, biome, slope, snowLine }: ColumnInfo, out: Int16Array, at: number): number {
  const steep = slope >= STEEP && biome !== Biome.Desert;
  let top: Block = Block.Grass;
  let under: Block = Block.Dirt;
  let depth = 3; // blocks of `under` below the top
  if (biome === Biome.Swamp && h <= SEA_LEVEL + 1) {
    // Swamp pools and the water's edge are mud (not sand or gravel); a block above it, grass.
    if (h <= SEA_LEVEL) {
      top = under = Block.Mud;
      depth = 2;
    }
  } else if (h < SEA_LEVEL - 4) {
    if (biome === Biome.Desert) top = under = Block.Sand;
    else {
      top = under = Block.Gravel;
      depth = 2;
    }
  } else if (h <= SEA_LEVEL + 1 && !(biome === Biome.Mountains && h >= snowLine)) top = under = Block.Sand;
  else if (steep) {
    top = under = Block.Stone;
    depth = 0;
  } else if (biome === Biome.Desert) top = under = Block.Sand;
  else if (biome === Biome.Savanna) top = Block.DryGrass;
  else if (biome === Biome.Mountains) {
    if (h >= snowLine) {
      top = Block.Snow;
      under = Block.Stone;
      depth = 0;
    } else top = Block.SnowyGrass;
  }

  let n = 0;
  const run = (from: number, to: number, block: Block) => {
    out[at + n * 3] = from;
    out[at + n * 3 + 1] = to;
    out[at + n * 3 + 2] = block;
    n++;
  };
  // Desert sand sits on sandstone before the stone.
  const sandstone = biome === Biome.Desert && h >= SEA_LEVEL - 4 ? 4 : 0;
  run(0, h - depth - sandstone, Block.Stone);
  if (sandstone) run(h - depth - sandstone, h - depth, Block.Sandstone);
  if (depth) run(h - depth, h, under);
  run(h, h + 1, top);
  if (h < SEA_LEVEL) run(h + 1, SEA_LEVEL + 1, Block.Water);
  return n;
}

/** A column's blocks, bottom up, as runs (`writeLayers` as an array, for tests and tools). */
export function columnLayers(info: ColumnInfo): Run[] {
  const out = new Int16Array(MAX_RUNS * 3);
  const n = writeLayers(info, out, 0);
  const runs: Run[] = [];
  for (let i = 0; i < n; i++) runs.push([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]);
  return runs;
}

/**
 * Versions of world generation. A world keeps the version it was made with, so land it hasn't
 * edited yet comes out the same next to land it has: 1 is the world before Milestone 16, 2 adds
 * rivers, savanna and swamp, and structures.
 */
export type Generation = 1 | 2;
/** The version new worlds get. */
export const GENERATION: Generation = 2;
/** A version as saved or sent: 2 if it says so, else 1 (worlds from before versions say nothing). */
export const generationOf = (v: unknown): Generation => (v === 2 ? 2 : 1);

/**
 * Generation passes that can be switched off (all on by default), for tests that compare with and
 * without them; and the version (1 unless given: the game always gives a world's own).
 */
export interface GeneratorOptions {
  caves?: boolean;
  ores?: boolean;
  trees?: boolean;
  /** Version 2's rivers. */
  rivers?: boolean;
  generation?: Generation;
}

/** Just the terrain's layers: for tests of the surface. */
export const SURFACE_ONLY: GeneratorOptions = { caves: false, ores: false, trees: false };

/** The block on top of a column, as its layers have it (before caves). */
export function topBlock(info: ColumnInfo): Block {
  const out = new Int16Array(MAX_RUNS * 3);
  const n = writeLayers(info, out, 0);
  for (let r = 0; r < n; r++) if (out[r * 3] === info.height) return out[r * 3 + 2];
  return Block.Air;
}

/**
 * How high caves may carve in a column: up to its surface on dry land, but never within 4
 * blocks below water in it or a neighbour, so no water hangs over or beside air (water
 * doesn't flow). `h` is the column's height, `lowest` the lowest of it and its 4 neighbours.
 */
export const caveLimit = (h: number, lowest: number): number => (lowest <= SEA_LEVEL ? lowest - 4 : h);

export class Generator {
  readonly climate: Climate;
  readonly caves: Caves;
  /** Version 2's rivers. */
  readonly rivers: Rivers;
  readonly options: Required<GeneratorOptions>;
  private readonly detail: Noise;
  private readonly weights = new Float64Array(BIOME_COUNT);
  /** Biome weights for `height` when it isn't given them (kept apart from `weights`, which callers pass in). */
  private readonly ownWeights = new Float64Array(BIOME_COUNT);

  constructor(
    readonly seed: number,
    options: GeneratorOptions = {},
  ) {
    this.options = { caves: true, ores: true, trees: true, rivers: true, generation: 1, ...options };
    this.climate = new Climate(seed, this.options.generation);
    this.caves = new Caves(seed);
    this.detail = new Noise(seed ^ 0x51e7);
    this.rivers = new Rivers(seed);
  }

  /** Surface height at world column (x, z): the y of the topmost solid block. Version 2 cuts rivers' valleys into it. */
  height(x: number, z: number, weights?: Float64Array): number {
    let h: number;
    if (this.options.generation === 1 || !this.options.rivers) h = SEA_LEVEL + this.climate.height(x, z, weights);
    else {
      const w = weights ?? this.climate.weights(x, z, this.ownWeights);
      h = this.rivers.carve(SEA_LEVEL + this.climate.height(x, z, w), x, z, riverStrength(w));
    }
    return Math.max(1, Math.min(WORLD_HEIGHT - 12, Math.floor(h)));
  }

  /**
   * The biome whose blocks cover a column: the one with the most weight, except near a
   * border, where a seeded coin picks between the two strongest so the line between them
   * frays instead of running straight.
   */
  biome(x: number, z: number, weights: Float64Array = this.climate.weights(x, z, this.weights)): Biome {
    let first = weights[1] > weights[0] ? 1 : 0;
    let second = 1 - first;
    for (let i = 2; i < weights.length; i++) {
      if (weights[i] > weights[first]) {
        second = first;
        first = i;
      } else if (weights[i] > weights[second]) second = i;
    }
    const chanceOfSecond = Math.max(0, 0.5 - (weights[first] - weights[second]) * 4);
    return hash3(this.seed, x, 7, z) < chanceOfSecond ? second : first;
  }

  /** Everything that decides the blocks of column (x, z). */
  column(x: number, z: number): ColumnInfo {
    const weights = this.climate.weights(x, z, this.weights);
    const height = this.height(x, z, weights);
    const biome = this.biome(x, z, weights);
    let slope = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) slope = Math.max(slope, Math.abs(this.height(x + dx, z + dz) - height));
    return { height, biome, slope, snowLine: this.snowLine(x, z) };
  }

  /**
   * The ground as trees see it, column by column (slow: each answer from scratch). Column
   * jobs answer the same questions from their height map; tests use this.
   */
  ground(): Ground {
    const lowest = (x: number, z: number) =>
      Math.min(this.height(x, z), this.height(x + 1, z), this.height(x - 1, z), this.height(x, z + 1), this.height(x, z - 1));
    return {
      height: (x, z) => this.height(x, z),
      biome: (x, z) => this.biome(x, z),
      top: (x, z) => topBlock(this.column(x, z)),
      dry: (x, z) => this.height(x, z) > SEA_LEVEL + 1,
      carved: (x, y, z) => this.options.caves && this.caves.carvedAt(x, y, z, caveLimit(this.height(x, z), lowest(x, z))),
    };
  }

  /** Has a cave carved the block at (x, y, z)? (Slow: the column's height and its neighbours' each time.) */
  caveAt(x: number, y: number, z: number): boolean {
    if (!this.options.caves) return false;
    const h = this.height(x, z);
    const lowest = Math.min(h, this.height(x + 1, z), this.height(x - 1, z), this.height(x, z + 1), this.height(x, z - 1));
    return this.caves.carvedAt(x, y, z, caveLimit(h, lowest));
  }

  /** Does a tree stand in column (x, z)? */
  treeAt(x: number, z: number): boolean {
    return this.options.trees && treesIn(this.seed, x, z, x, z, this.ground()).length > 0;
  }

  private snowLine(x: number, z: number): number {
    return SEA_LEVEL + 58 + Math.round(this.detail.noise2(x / 40, z / 40) * 8);
  }

  /** A dry-land column near (x, z) to spawn on, with no tree standing in it: searches outwards in a square spiral. */
  findLand(x: number, z: number): { x: number; z: number } {
    for (let r = 0; r < 512; r += 8) {
      for (let dz = -r; dz <= r; dz += 8) {
        for (let dx = -r; dx <= r; dx += 8) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.height(x + dx, z + dz) > SEA_LEVEL + 3 && !this.treeAt(x + dx, z + dz)) return { x: x + dx, z: z + dz };
        }
      }
    }
    return { x, z };
  }

  /**
   * Where reeds stand in the 32 x 32 columns from (x0, z0) (version 2): the y above the ground, by
   * column (z * 32 + x), or -1. In the savanna and the swamp, on ground at or a block above the water
   * with water beside it, by a seeded chance; in the swamp, now and then away from it too. Never where
   * a cave has taken the ground. `heights` and `biomes` are a column job's, with its border.
   */
  private reedsIn(x0: number, z0: number, heights: Int32Array, biomes: Uint8Array, ground: Ground): Int16Array {
    const out = new Int16Array(COLUMNS).fill(-1);
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const at = (lz + BORDER) * SPAN + lx + BORDER;
        const biome = biomes[at];
        if (biome !== Biome.Savanna && biome !== Biome.Swamp) continue;
        const h = heights[at];
        if (h < SEA_LEVEL) continue;
        const x = x0 + lx;
        const z = z0 + lz;
        const wet = heights[at + 1] < SEA_LEVEL || heights[at - 1] < SEA_LEVEL || heights[at + SPAN] < SEA_LEVEL || heights[at - SPAN] < SEA_LEVEL;
        const chance = wet && h <= SEA_LEVEL + 1 ? (biome === Biome.Swamp ? REEDS_BY_WATER.swamp : REEDS_BY_WATER.savanna) : biome === Biome.Swamp ? REEDS_INLAND : 0;
        if (hash3(this.seed, x, 211, z) >= chance || ground.carved(x, h, z)) continue;
        out[lz * S + lx] = h + 1;
      }
    }
    return out;
  }

  /** Version 2's structures whose blocks may reach into [x0, x1] x [z0, z1] (none in version 1). */
  structuresIn(x0: number, z0: number, x1: number, z1: number): Structure[] {
    return this.options.generation === 1 ? [] : structuresIn(this.seed, x0, z0, x1, z1, this);
  }

  /** The kind of structure whose chest stands at (x, y, z), or null if none does (its loot is for that kind). */
  lootAt(x: number, y: number, z: number): StructureKind | null {
    for (const st of this.structuresIn(x, z, x, z)) if (st.chest[0] === x && st.chest[1] === y && st.chest[2] === z) return st.kind;
    return null;
  }

  /** Fill one chunk's blocks. */
  generate(cx: number, cy: number, cz: number): Uint8Array {
    return this.generateColumn(cx, cz, cy, cy)[0] ?? new Uint8Array(CHUNK_VOLUME);
  }

  /**
   * The chunks cyMin..cyMax of column (cx, cz), sharing one height map (the noise is most of
   * the cost). A chunk that would be all air comes back as null.
   */
  generateColumn(cx: number, cz: number, cyMin: number, cyMax: number): (Uint8Array | null)[] {
    const x0 = cx * S;
    const z0 = cz * S;
    // Heights and biomes over the columns and a border.
    const heights = new Int32Array(SPAN * SPAN);
    const biomes = new Uint8Array(SPAN * SPAN);
    const weights = this.weights;
    for (let j = 0; j < SPAN; j++) {
      for (let i = 0; i < SPAN; i++) {
        const x = x0 + i - BORDER;
        const z = z0 + j - BORDER;
        this.climate.weights(x, z, weights);
        heights[j * SPAN + i] = this.height(x, z, weights);
        biomes[j * SPAN + i] = this.biome(x, z, weights);
      }
    }
    // Top blocks and cave limits wherever slopes are known (all but the outermost ring).
    const tops = new Uint8Array(SPAN * SPAN);
    const spanLimits = new Int16Array(SPAN * SPAN);
    for (let j = 1; j < SPAN - 1; j++) {
      for (let i = 1; i < SPAN - 1; i++) {
        const at = j * SPAN + i;
        const h = heights[at];
        const near = [heights[at + 1], heights[at - 1], heights[at + SPAN], heights[at - SPAN]];
        const slope = Math.max(...near.map((n) => Math.abs(n - h)));
        tops[at] = topBlock({ height: h, biome: biomes[at] as Biome, slope, snowLine: this.snowLine(x0 + i - BORDER, z0 + j - BORDER) });
        spanLimits[at] = caveLimit(h, Math.min(h, ...near));
      }
    }
    // Trees standing within reach of these columns, asked of the height map above.
    const index = (x: number, z: number) => (z - z0 + BORDER) * SPAN + (x - x0 + BORDER);
    const ground: Ground = {
      height: (x, z) => heights[index(x, z)],
      biome: (x, z) => biomes[index(x, z)] as Biome,
      top: (x, z) => tops[index(x, z)],
      dry: (x, z) => heights[index(x, z)] > SEA_LEVEL + 1,
      carved: (x, y, z) => this.options.caves && this.caves.carvedAt(x, y, z, spanLimits[index(x, z)]),
    };
    const trees = this.options.trees ? treesIn(this.seed, x0 - TREE_REACH, z0 - TREE_REACH, x0 + S - 1 + TREE_REACH, z0 + S - 1 + TREE_REACH, ground) : [];

    // Each column's runs, and the highest block anywhere (chunks above it are all air).
    const runs = new Int16Array(COLUMNS * MAX_RUNS * 3);
    const counts = new Uint8Array(COLUMNS);
    const limits = new Int16Array(COLUMNS);
    let top = SEA_LEVEL;
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const at = (lz + BORDER) * SPAN + lx + BORDER;
        const h = heights[at];
        const slope = Math.max(
          Math.abs(heights[at + 1] - h),
          Math.abs(heights[at - 1] - h),
          Math.abs(heights[at + SPAN] - h),
          Math.abs(heights[at - SPAN] - h),
        );
        const c = lz * S + lx;
        const info = { height: h, biome: biomes[at] as Biome, slope, snowLine: this.snowLine(x0 + lx, z0 + lz) };
        counts[c] = writeLayers(info, runs, c * MAX_RUNS * 3);
        limits[c] = caveLimit(h, Math.min(h, heights[at + 1], heights[at - 1], heights[at + SPAN], heights[at - SPAN]));
        top = Math.max(top, h);
      }
    }
    for (const t of trees) top = Math.max(top, t.y + TREE_TOP);
    const reeds = this.options.generation === 1 ? null : this.reedsIn(x0, z0, heights, biomes, ground);
    // Structures reaching into these columns, and what each writes.
    const structures = this.options.generation === 1 ? [] : this.structuresIn(x0, z0, x0 + S - 1, z0 + S - 1);
    const built = structures.map((st) => structureBlocks(this.seed, st, this));
    for (const st of structures) top = Math.max(top, structureTop(st));

    const out: (Uint8Array | null)[] = [];
    for (let cy = cyMin; cy <= cyMax; cy++) {
      const y0 = cy * S;
      // Every column is filled up to its height or sea level, whichever is higher, so this is exact.
      if (y0 > top) {
        out.push(null);
        continue;
      }
      const blocks = new Uint8Array(CHUNK_VOLUME);
      for (let c = 0; c < COLUMNS; c++) {
        // c is z * 32 + x, the same bits as a chunk index's column part.
        for (let r = c * MAX_RUNS * 3, end = r + counts[c] * 3; r < end; r += 3) fillRun(blocks, c, y0, runs[r], runs[r + 1], runs[r + 2]);
      }
      if (this.options.caves) this.caves.carve(blocks, cx, cy, cz, limits);
      if (this.options.ores) placeOres(blocks, cx, cy, cz, this.seed);
      if (trees.length) placeTrees(blocks, cx, cy, cz, trees, this.seed);
      if (reeds) {
        for (let c = 0; c < COLUMNS; c++) {
          const ly: number = reeds[c] - y0;
          if (ly < 0 || ly >= S) continue;
          const i = (ly << Y_SHIFT) | c;
          if (blocks[i] === Block.Air) blocks[i] = Block.Reeds;
        }
      }
      if (built.length) placeStructures(blocks, cx, cy, cz, built);
      out.push(blocks);
    }
    return out;
  }
}

/**
 * How much river there can be where the biomes weigh `weights`: all of it until mountains weigh
 * in, none where they weigh half or more, so rivers narrow and end before the peaks.
 */
export function riverStrength(weights: ArrayLike<number>): number {
  return Math.max(0, Math.min(1, 1 - (weights[Biome.Mountains] - 0.1) * 2.5));
}

/** Reeds' chance in a column at the water's edge, in the savanna and in the swamp; and in the swamp away from it. */
const REEDS_BY_WATER = { savanna: 0.35, swamp: 0.6 };
const REEDS_INLAND = 0.04;

/** Set world y in [from, to) of one column of a chunk whose bottom is y0. `column` is the local z and x bits. */
function fillRun(blocks: Uint8Array, column: number, y0: number, from: number, to: number, block: Block): void {
  const end = Math.min(to, y0 + S) - y0;
  for (let ly = Math.max(from, y0) - y0; ly < end; ly++) blocks[(ly << Y_SHIFT) | column] = block;
}
