// Rivers (generation version 2): valleys cut down below sea level along the zero lines of a
// low-frequency noise, so they wind across the land, never end in the middle of it on their own,
// and fill with the sea's own still water (no flowing water needed). A river is narrowest where
// its strength is low, and fades out entirely towards high mountains, so peaks keep their shape.
// Pure: the ground height in, the ground height out.

import { SEA_LEVEL } from './coords';
import { Noise } from './noise';

/** Blocks across one swing of the river noise: rivers some hundreds of blocks apart. */
const SCALE = 900;
/** Octaves: the second and third make the river wind. */
const OCTAVES = 3;
/**
 * Half-widths in noise units (|noise| below these): the river's water, and its valley's edge. At
 * this scale the noise changes about 1/600 a block, so about 5 and 21 blocks.
 */
export const RIVER_CORE = 0.008;
export const RIVER_BANK = 0.035;
/** The bed's depth below sea level in the middle, and at the water's edge. */
const DEEPEST = 4;
const SHALLOWEST = 1;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

export class Rivers {
  private readonly noise: Noise;

  constructor(seed: number) {
    this.noise = new Noise(seed ^ 0x71e3a5);
  }

  /** How far column (x, z) is from a river's middle line, in noise units (0 on it). */
  distance(x: number, z: number): number {
    return Math.abs(this.noise.fbm2(x / SCALE, z / SCALE, OCTAVES));
  }

  /**
   * Ground height `h` (y of the top, before rounding) at column (x, z), brought down into a
   * river's valley, never raised. `strength` (0–1) narrows the river: at 0 there is none.
   */
  carve(h: number, x: number, z: number, strength: number): number {
    if (strength <= 0) return h;
    const d = this.distance(x, z) / strength;
    if (d >= RIVER_BANK) return h;
    let y: number;
    if (d < RIVER_CORE) {
      // The bed: deepest in the middle, shallow at the water's edge.
      y = SEA_LEVEL - SHALLOWEST - (DEEPEST - SHALLOWEST) * (1 - d / RIVER_CORE);
    } else {
      // The valley: from the water's level up to the land, eased at both ends.
      y = SEA_LEVEL + (h - SEA_LEVEL) * smoothstep((d - RIVER_CORE) / (RIVER_BANK - RIVER_CORE));
    }
    return Math.min(h, y);
  }
}
