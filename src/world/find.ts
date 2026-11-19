// `?find=<kind>`: the nearest place of a kind to a point, searched with the generator alone (no
// chunks generated), for looking at new land in the browser and for playtesting. Pure.

import { Biome } from './biomes';
import { SEA_LEVEL } from './coords';
import type { Generator } from './generate';
import { STRUCTURE_CELL, StructureKind, structureInCell } from './structures';

export const FINDABLE = ['river', 'savanna', 'swamp', 'ruin', 'camp'] as const;
export type Findable = (typeof FINDABLE)[number];

export const isFindable = (s: string | null): s is Findable => (FINDABLE as readonly string[]).includes(s ?? '');

/** Is column (x, z) one of `kind`? */
function matches(g: Generator, kind: Findable, x: number, z: number): boolean {
  switch (kind) {
    case 'river':
      // Water where the land would be dry without the river.
      return g.height(x, z) < SEA_LEVEL && SEA_LEVEL + g.climate.height(x, z) > SEA_LEVEL + 3;
    case 'ruin':
    case 'camp':
      return false; // searched by cell, in `findNearest`
    case 'savanna':
    case 'swamp':
    {
      // Well inside it: most of the weight here and 32 blocks out every way, on its own ground (the
      // savanna's dry grass, above the beaches; the swamp's grass, above its mud).
      const biome = kind === 'savanna' ? Biome.Savanna : Biome.Swamp;
      if (g.height(x, z) < SEA_LEVEL + (kind === 'savanna' ? 3 : 1)) return false;
      for (const [dx, dz] of [[0, 0], [32, 0], [-32, 0], [0, 32], [0, -32]]) if (g.climate.weights(x + dx, z + dz)[biome] <= 0.7) return false;
      return true;
    }
  }
}

/**
 * The nearest column of `kind` to (x, z), looking every `step` blocks outwards in square rings up
 * to `radius`; null if there is none.
 */
export function findNearest(g: Generator, kind: Findable, x: number, z: number, radius = 4096, step = 8): { x: number; z: number } | null {
  if (kind === 'ruin' || kind === 'camp') return nearestStructure(g, kind === 'ruin' ? StructureKind.Ruin : StructureKind.Camp, x, z, radius);
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

/** Structure cells' width (`structures.ts`). */
const CELL = STRUCTURE_CELL;

/** The nearest structure of `kind` to (x, z): cells in rings outwards; a place just in front of its door. */
function nearestStructure(g: Generator, kind: StructureKind, x: number, z: number, radius: number): { x: number; z: number } | null {
  if (g.options.generation === 1) return null;
  const gx0 = Math.floor(x / CELL);
  const gz0 = Math.floor(z / CELL);
  let best = null as { x: number; z: number; d: number } | null;
  for (let r = 0; r * CELL <= radius; r++) {
    for (let gz = gz0 - r; gz <= gz0 + r; gz++)
      for (let gx = gx0 - r; gx <= gx0 + r; gx++) {
        if (Math.max(Math.abs(gx - gx0), Math.abs(gz - gz0)) !== r) continue;
        const s = structureInCell(g.seed, gx, gz, g);
        if (!s || s.kind !== kind) continue;
        const d = Math.hypot(s.x - x, s.z - z);
        // Out of its door: two blocks past its edge.
        const [fx, fz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][s.facing];
        if (!best || d < best.d) best = { x: s.x + fx * (s.half + 2), z: s.z + fz * (s.half + 2), d };
      }
    // A nearer one can't be in a later ring once one is found in this one (a ring further is a cell further).
    if (best) return { x: best.x, z: best.z };
  }
  return null;
}

