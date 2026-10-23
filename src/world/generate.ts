// Terrain generation: a pure function of the seed and the chunk coordinate, so any chunk can
// be generated in any order, on any thread, and always comes out the same.
//
// Scaffold terrain: a heightmap from fractal noise, grass / dirt / stone layers, sand
// beaches and water up to sea level. Caves, biomes and trees come in Milestone 3.

import { Block } from './blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, localIndex, WORLD_HEIGHT } from './coords';
import { Noise } from './noise';

export const SEA_LEVEL = 40;

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

  /** Fill a chunk's blocks. */
  generate(cx: number, cy: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const h = this.height(x0 + lx, z0 + lz);
        const beach = h <= SEA_LEVEL + 1;
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const y = y0 + ly;
          let b: Block = Block.Air;
          if (y < h - 3) b = Block.Stone;
          else if (y < h) b = beach ? Block.Sand : Block.Dirt;
          else if (y === h) b = beach ? Block.Sand : Block.Grass;
          else if (y <= SEA_LEVEL) b = Block.Water;
          if (b !== Block.Air) blocks[localIndex(lx, ly, lz)] = b;
        }
      }
    }
    return blocks;
  }
}
