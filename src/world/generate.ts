// Terrain generation: a pure function of the seed and the chunk coordinate, so any chunk can
// be generated in any order, on any thread, and always comes out the same.
//
// A column job computes a height map one block wider than its 32 × 32 columns (the border
// gives slopes at the edges), then fills each column from its layers: what the biome puts
// on top and underneath, bare stone on steep slopes, sand or gravel under water, and water up
// to sea level. Caves and trees come in later steps of Milestone 3.

import { Biome, Climate } from './biomes';
import { Block } from './blocks';
import { CHUNK_BITS, CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from './coords';
import { hash3 } from '../math';
import { Noise } from './noise';

export const SEA_LEVEL = 62;
/** Columns this steep (blocks up or down to a neighbour) show bare stone on top. */
const STEEP = 3;
/** Height map border around a column job's 32 × 32 columns. */
const BORDER = 1;
const SPAN = CHUNK_SIZE + 2 * BORDER;

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

/** A column's blocks, bottom up, as runs. Everything above the last run is air. */
export function columnLayers({ height: h, biome, slope, snowLine }: ColumnInfo): Run[] {
  const runs: Run[] = [];
  const steep = slope >= STEEP && biome !== Biome.Desert;
  let top: Block;
  let under: Block;
  let depth: number; // blocks of `under` below the top
  if (h < SEA_LEVEL - 4) [top, under, depth] = biome === Biome.Desert ? [Block.Sand, Block.Sand, 3] : [Block.Gravel, Block.Gravel, 2];
  else if (h <= SEA_LEVEL + 1 && !(biome === Biome.Mountains && h >= snowLine)) [top, under, depth] = [Block.Sand, Block.Sand, 3];
  else if (steep) [top, under, depth] = [Block.Stone, Block.Stone, 0];
  else if (biome === Biome.Desert) [top, under, depth] = [Block.Sand, Block.Sand, 3];
  else if (biome === Biome.Mountains) [top, under, depth] = h >= snowLine ? [Block.Snow, Block.Stone, 0] : [Block.SnowyGrass, Block.Dirt, 3];
  else [top, under, depth] = [Block.Grass, Block.Dirt, 3];

  // Desert sand sits on sandstone before the stone.
  const sandstone = biome === Biome.Desert && h >= SEA_LEVEL - 4 ? 4 : 0;
  runs.push([0, h - depth - sandstone, Block.Stone]);
  if (sandstone) runs.push([h - depth - sandstone, h - depth, Block.Sandstone]);
  if (depth) runs.push([h - depth, h, under]);
  runs.push([h, h + 1, top]);
  if (h < SEA_LEVEL) runs.push([h + 1, SEA_LEVEL + 1, Block.Water]);
  return runs;
}

export class Generator {
  readonly climate: Climate;
  private readonly detail: Noise;
  private readonly weights = new Float64Array(4);

  constructor(readonly seed: number) {
    this.climate = new Climate(seed);
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
    let first = 0;
    let second = 1;
    if (weights[second] > weights[first]) [first, second] = [second, first];
    for (let i = 2; i < weights.length; i++) {
      if (weights[i] > weights[first]) [first, second] = [i, first];
      else if (weights[i] > weights[second]) second = i;
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

  private snowLine(x: number, z: number): number {
    return SEA_LEVEL + 58 + Math.round(this.detail.noise2(x / 40, z / 40) * 8);
  }

  /** A dry-land column near (x, z) to spawn on: searches outwards in a square spiral. */
  findLand(x: number, z: number): { x: number; z: number } {
    for (let r = 0; r < 512; r += 8) {
      for (let dz = -r; dz <= r; dz += 8) {
        for (let dx = -r; dx <= r; dx += 8) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.height(x + dx, z + dz) > SEA_LEVEL + 3) return { x: x + dx, z: z + dz };
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
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    // Heights over the columns and a border, and the biome of each inner column.
    const heights = new Int32Array(SPAN * SPAN);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const weights = this.weights;
    for (let j = 0; j < SPAN; j++) {
      for (let i = 0; i < SPAN; i++) {
        const x = x0 + i - BORDER;
        const z = z0 + j - BORDER;
        this.climate.weights(x, z, weights);
        heights[j * SPAN + i] = this.height(x, z, weights);
        const inner = i >= BORDER && j >= BORDER && i < SPAN - BORDER && j < SPAN - BORDER;
        if (inner) biomes[(j - BORDER) * CHUNK_SIZE + (i - BORDER)] = this.biome(x, z, weights);
      }
    }

    // Each column's runs, and the highest block anywhere (chunks above it are all air).
    const columns: Run[][] = [];
    let top = SEA_LEVEL;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const at = (lz + BORDER) * SPAN + lx + BORDER;
        const h = heights[at];
        const slope = Math.max(
          Math.abs(heights[at + 1] - h),
          Math.abs(heights[at - 1] - h),
          Math.abs(heights[at + SPAN] - h),
          Math.abs(heights[at - SPAN] - h),
        );
        const biome = biomes[lz * CHUNK_SIZE + lx] as Biome;
        columns.push(columnLayers({ height: h, biome, slope, snowLine: this.snowLine(x0 + lx, z0 + lz) }));
        top = Math.max(top, h);
      }
    }

    const out: (Uint8Array | null)[] = [];
    for (let cy = cyMin; cy <= cyMax; cy++) {
      const y0 = cy * CHUNK_SIZE;
      // Every column is filled up to its height or sea level, whichever is higher, so this is exact.
      if (y0 > top) {
        out.push(null);
        continue;
      }
      const blocks = new Uint8Array(CHUNK_VOLUME);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const column = (lz << CHUNK_BITS) | lx;
          for (const [from, to, block] of columns[lz * CHUNK_SIZE + lx]) fillRun(blocks, column, y0, from, to, block);
        }
      }
      out.push(blocks);
    }
    return out;
  }
}

/** Set world y in [from, to) of one column of a chunk whose bottom is y0. `column` is the local z and x bits. */
function fillRun(blocks: Uint8Array, column: number, y0: number, from: number, to: number, block: Block): void {
  const end = Math.min(to, y0 + CHUNK_SIZE) - y0;
  for (let ly = Math.max(from, y0) - y0; ly < end; ly++) blocks[(ly << (2 * CHUNK_BITS)) | column] = block;
}
