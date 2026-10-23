// Terrain generation: a pure function of the seed and the chunk coordinate, so any chunk can
// be generated in any order, on any thread, and always comes out the same.
//
// Scaffold terrain: a heightmap from fractal noise, grass / dirt / stone layers, sand
// beaches and water up to sea level. Caves, biomes and trees come in Milestone 3.

import { Block } from './blocks';
import { CHUNK_BITS, CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from './coords';
import { Noise } from './noise';

export const SEA_LEVEL = 62;

export class Generator {
  private readonly noise: Noise;

  constructor(readonly seed: number) {
    this.noise = new Noise(seed);
  }

  /** Surface height at world column (x, z): the y of the topmost solid block. */
  height(x: number, z: number): number {
    const n = this.noise;
    // Broad rolling land, with a second noise deciding where it gets hilly.
    const base = n.fbm2(x / 220, z / 220, 4);
    const hilliness = 0.5 + 0.5 * n.noise2(x / 400 + 100, z / 400 - 100);
    const detail = n.fbm2(x / 60, z / 60, 4);
    const h = SEA_LEVEL + 6 + base * 30 + detail * 26 * hilliness * hilliness;
    return Math.max(1, Math.min(WORLD_HEIGHT - 12, Math.floor(h)));
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
   * The chunks cyMin..cyMax of column (cx, cz), sharing one heightmap (the noise is most of
   * the cost). A chunk that would be all air comes back as null.
   */
  generateColumn(cx: number, cz: number, cyMin: number, cyMax: number): (Uint8Array | null)[] {
    const heights = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    let top = SEA_LEVEL;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const h = this.height(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz);
        heights[lz * CHUNK_SIZE + lx] = h;
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
          const h = heights[lz * CHUNK_SIZE + lx];
          const beach = h <= SEA_LEVEL + 1;
          const column = (lz << CHUNK_BITS) | lx;
          fillRun(blocks, column, y0, 0, h - 3, Block.Stone);
          fillRun(blocks, column, y0, h - 3, h, beach ? Block.Sand : Block.Dirt);
          fillRun(blocks, column, y0, h, h + 1, beach ? Block.Sand : Block.Grass);
          fillRun(blocks, column, y0, h + 1, SEA_LEVEL + 1, Block.Water);
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
