// Terrain generation: a pure function of the seed and the chunk coordinate, so any chunk can
// be generated in any order, on any thread, and always comes out the same.
//
// A column job computes a height map a few blocks wider than its 32 × 32 columns (for slopes
// at the edges, and the ground of trees just outside them), then fills each column from its
// layers: what the biome puts on top and underneath, bare stone on steep slopes, sand or
// gravel under water, and water up to sea level. Then caves, ores and trees.

import { Biome, Climate } from './biomes';
import { Caves } from './caves';
import { type Ground, placeOres, placeTrees, TREE_REACH, TREE_TOP, treesIn } from './features';
import { Block } from './blocks';
import { CHUNK_BITS, CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from './coords';
import { hash3 } from '../math';
import { Noise } from './noise';

export const SEA_LEVEL = 62;
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
  if (h < SEA_LEVEL - 4) {
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

/** Generation passes that can be switched off (all on by default), for tests that compare with and without them. */
export interface GeneratorOptions {
  caves?: boolean;
  ores?: boolean;
  trees?: boolean;
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
  readonly options: Required<GeneratorOptions>;
  private readonly detail: Noise;
  private readonly weights = new Float64Array(4);

  constructor(
    readonly seed: number,
    options: GeneratorOptions = {},
  ) {
    this.options = { caves: true, ores: true, trees: true, ...options };
    this.climate = new Climate(seed);
    this.caves = new Caves(seed);
    this.detail = new Noise(seed ^ 0x51e7);
  }

  /** Surface height at world column (x, z): the y of the topmost solid block. */
  height(x: number, z: number, weights?: Float64Array): number {
    const h = SEA_LEVEL + this.climate.height(x, z, weights);
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
      out.push(blocks);
    }
    return out;
  }
}

/** Set world y in [from, to) of one column of a chunk whose bottom is y0. `column` is the local z and x bits. */
function fillRun(blocks: Uint8Array, column: number, y0: number, from: number, to: number, block: Block): void {
  const end = Math.min(to, y0 + S) - y0;
  for (let ly = Math.max(from, y0) - y0; ly < end; ly++) blocks[(ly << Y_SHIFT) | column] = block;
}
