// `?find=<kind>`: the nearest place of a kind to a point, searched with the generator alone (no
// chunks generated), for looking at new land in the browser and for playtesting. Pure.

import { SEA_LEVEL } from './coords';
import type { Generator } from './generate';

export const FINDABLE = ['river'] as const;
export type Findable = (typeof FINDABLE)[number];

export const isFindable = (s: string | null): s is Findable => (FINDABLE as readonly string[]).includes(s ?? '');

/** Is column (x, z) one of `kind`? */
function matches(g: Generator, kind: Findable, x: number, z: number): boolean {
  switch (kind) {
    case 'river':
      // Water where the land would be dry without the river.
      return g.height(x, z) < SEA_LEVEL && SEA_LEVEL + g.climate.height(x, z) > SEA_LEVEL + 3;
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
