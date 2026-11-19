// `?find=<kind>`: the nearest place of a kind to a point, searched with the generator alone (no
// chunks generated), for looking at new land in the browser and for playtesting. Pure.

import { Biome } from './biomes';
import { SEA_LEVEL } from './coords';
import type { Generator } from './generate';

export const FINDABLE = ['river', 'savanna', 'swamp'] as const;
export type Findable = (typeof FINDABLE)[number];

export const isFindable = (s: string | null): s is Findable => (FINDABLE as readonly string[]).includes(s ?? '');

/** Is column (x, z) one of `kind`? */
function matches(g: Generator, kind: Findable, x: number, z: number): boolean {
  switch (kind) {
    case 'river':
      // Water where the land would be dry without the river.
      return g.height(x, z) < SEA_LEVEL && SEA_LEVEL + g.climate.height(x, z) > SEA_LEVEL + 3;
    case 'savanna':
    case 'swamp':
      // Well inside it (most of the weight), on dry land.
      return g.climate.weights(x, z)[kind === 'savanna' ? Biome.Savanna : Biome.Swamp] > 0.7 && g.height(x, z) >= SEA_LEVEL;
  }
}

/**
 * The nearest column of `kind` to (x, z), looking every `step` blocks outwards in square rings up
 * to `radius`; null if there is none.
 */
export function findNearest(g: Generator, kind: Findable, x: number, z: number, radius = 4096, step = 8): { x: number; z: number } | null {
  for (let r = 0; r <= radius; r += step) {
    for (let dz = -r; dz <= r; dz += step) {
      for (let dx = -r; dx <= r; dx += step) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (matches(g, kind, x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
    }
  }
  return null;
}

/**
 * The nearest dry column to (x, z), out to 48 blocks, block by block: somewhere to stand by what
 * was found (`Generator.findLand` wants land well above the sea, which a swamp's isn't). (x, z)
 * itself if there is none.
 */
export function dryNear(g: Generator, x: number, z: number): { x: number; z: number } {
  for (let r = 0; r <= 48; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (g.height(x + dx, z + dz) >= SEA_LEVEL) return { x: x + dx, z: z + dz };
      }
  return { x, z };
}
