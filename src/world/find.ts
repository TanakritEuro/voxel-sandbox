// `?find=<kind>`: the nearest place of a kind to a point, searched with the generator alone (no
// chunks generated), for looking at new land in the browser and for playtesting. Pure.

import { Biome } from './biomes';
import { SEA_LEVEL } from './coords';
import type { Generator } from './generate';
import { DUNGEON_CELL, STRUCTURE_CELL, StructureKind, structureInCell } from './structures';
import { DEEP_TOP, DeepBiome, LAVA_LEVEL } from './deep';

export const FINDABLE = ['river', 'savanna', 'swamp', 'ruin', 'camp', 'crystal', 'grotto', 'lava', 'dungeon'] as const;
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
    case 'crystal':
    case 'grotto':
    case 'lava':
    case 'dungeon':
      return false; // searched by cell, or underground, in `findNearest`
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
 * to `radius`; null if there is none. Underground kinds (version 3's deep caves) come with the height
 * to stand at, on a cave's floor in it.
 */
export function findNearest(g: Generator, kind: Findable, x: number, z: number, radius = 4096, step = 8): { x: number; z: number; y?: number } | null {
  if (kind === 'ruin' || kind === 'camp') return nearestStructure(g, kind === 'ruin' ? StructureKind.Ruin : StructureKind.Camp, x, z, radius);
  if (kind === 'crystal' || kind === 'grotto') return nearestDeep(g, kind === 'crystal' ? DeepBiome.Crystal : DeepBiome.Grotto, x, z, Math.min(radius, 1024), step);
  if (kind === 'lava') return nearestLava(g, x, z, Math.min(radius, 1024), step);
  if (kind === 'dungeon') return nearestDungeon(g, x, z, Math.min(radius, 2048));
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

/**
 * The nearest cave floor in deep biome `biome` to (x, z): columns every `step` blocks in rings
 * outwards, each looked down from `DEEP_TOP` for a block of cave with cave above and rock below, and room
 * round it (cave 3 blocks out each way at head height): in a cavern, not a passing tunnel.
 */
function nearestDeep(g: Generator, biome: DeepBiome, x: number, z: number, radius: number, step: number): { x: number; z: number; y: number } | null {
  if (g.options.generation < 3) return null;
  for (let r = 0; r <= radius; r += step)
    for (let dz = -r; dz <= r; dz += step)
      for (let dx = -r; dx <= r; dx += step) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = x + dx;
        const cz = z + dz;
        let limit: number | null = null;
        for (let y = DEEP_TOP - 2; y > 12; y--) {
          if (g.deep.biomeAt(cx, y, cz) !== biome) continue;
          limit ??= g.caveLimitAt(cx, cz);
          const cave = (ax: number, ay: number, az: number) => g.caves.carvedAt(ax, ay, az, ax === cx && az === cz ? limit! : g.caveLimitAt(ax, az));
          if (!cave(cx, y, cz) || !cave(cx, y + 1, cz) || cave(cx, y - 1, cz)) continue;
          if ([[3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx2, dz2]) => cave(cx + dx2, y + 1, cz + dz2))) return { x: cx, z: cz, y };
        }
      }
  return null;
}

/**
 * The nearest shore of a lava lake to (x, z): a cave floor of rock just above the lava's level, with room
 * over it and the lake 2 to 4 blocks off one way (cave at the lava's level there, so lava). Version 3 only.
 */
function nearestLava(g: Generator, x: number, z: number, radius: number, step: number): { x: number; z: number; y: number } | null {
  if (g.options.generation < 3) return null;
  const cave = (ax: number, ay: number, az: number) => g.caves.carvedAt(ax, ay, az, g.caveLimitAt(ax, az));
  for (let r = 0; r <= radius; r += step)
    for (let dz = -r; dz <= r; dz += step)
      for (let dx = -r; dx <= r; dx += step) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        // Near a lake at all: the lava's level is cave here.
        if (!cave(x + dx, LAVA_LEVEL, z + dz)) continue;
        // A shore within a few blocks: rock at the lava's level with two of cave over it, and the lake beside.
        for (let sz = -4; sz <= 4; sz++)
          for (let sx = -4; sx <= 4; sx++) {
            const cx = x + dx + sx;
            const cz = z + dz + sz;
            const y = LAVA_LEVEL + 1;
            if (cave(cx, LAVA_LEVEL, cz) || !cave(cx, y, cz) || !cave(cx, y + 1, cz)) continue;
            for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
              for (let d = 2; d <= 4; d++) if (cave(cx + ox * d, LAVA_LEVEL, cz + oz * d) && cave(cx + ox * d, y, cz + oz * d)) return { x: cx, z: cz, y };
          }
      }
  return null;
}

/** The nearest dungeon to (x, z) (version 3): inside it, standing on its floor in the middle. */
function nearestDungeon(g: Generator, x: number, z: number, radius: number): { x: number; z: number; y: number } | null {
  let best: { x: number; z: number; y: number; d: number } | null = null;
  for (let r = DUNGEON_CELL / 2; r <= radius && !best; r += DUNGEON_CELL)
    for (const d of g.dungeonsIn(x - r, z - r, x + r, z + r)) {
      const dist = Math.hypot(d.x - x, d.z - z);
      if (dist <= r && (!best || dist < best.d)) best = { x: d.x, z: d.z, y: d.y + 1, d: dist };
    }
  return best && { x: best.x, z: best.z, y: best.y };
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

