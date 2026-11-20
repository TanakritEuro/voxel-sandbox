// Structures (generation version 2): small invented ruins and camps, each with a chest, placed
// per 112 x 112-block cell of the world from the seed and the cell alone, like trees but rarer and
// bigger. A structure stands only on dry, nearly level land, decided from the generator's height
// function (not a chunk's height map), so every chunk decides the same; each column job asks for
// the structures within reach of its chunks and writes the parts inside them, after everything else.
// Version 3 adds dungeons: buried rooms of mossy brick, one chance per 96 x 96-block cell, deep under
// the ground (floor at y 12–31), open wherever a cave runs through their walls. Pure.

import { hash3 } from '../math';
import { Biome } from './biomes';
import { Block, chest, FACINGS, furnace, slab, stairs } from './blocks';
import { CHUNK_SIZE, SEA_LEVEL } from './coords';

export enum StructureKind {
  /** Broken brick walls round a floor, a chest inside. */
  Ruin = 0,
  /** A plank tent, a cold hearth (a furnace) and a chest. */
  Camp = 1,
  /** Version 3: a buried room of mossy brick, 9 x 5 x 9, a chest of better loot inside. */
  Dungeon = 2,
}

/** What placing structures asks of the generator. */
export interface StructureGround {
  height(x: number, z: number): number;
  biome(x: number, z: number): Biome;
  /** Has a cave carved the block at (x, y, z)? */
  caveAt(x: number, y: number, z: number): boolean;
  /** Which blocks of column (x, z) from y0 to y1 a cave carved (1), at once. */
  caveColumn(x: number, z: number, y0: number, y1: number): Uint8Array;
}

export interface Structure {
  kind: StructureKind;
  /** Its middle, and the y of its floor (the ground there). */
  x: number;
  z: number;
  y: number;
  /** The way its door (a ruin's gap, a tent's open end) faces: an index into `FACINGS`. */
  facing: number;
  /** Half its width: it covers x - half..x + half and the same in z. */
  half: number;
  /** Its chest. */
  chest: [number, number, number];
}

/** The world is split into cells this wide; each has a structure or not. */
export const STRUCTURE_CELL = 112;
const CELL = STRUCTURE_CELL;
/** A structure's middle is at least this far inside its cell. */
const MARGIN = 12;
/** The chance a cell has one (before the land rules it out). */
const CHANCE = 0.8;
/** Half widths by kind. */
const HALF = [4, 3, 4];
/** Blocks cleared above the floor, by kind (a dungeon's: up to its ceiling). */
const HEIGHT = [6, 5, 4];

/** Dungeons' cells, the chance one has one, how far inside it its middle is. */
export const DUNGEON_CELL = 96;
const DUNGEON_CHANCE = 0.75;
const DUNGEON_MARGIN = 8;
/** Its floor's height: from `DUNGEON_LOW` up to `DUNGEON_HIGH` (its ceiling 4 above, at most y 35). */
const DUNGEON_LOW = 12;
const DUNGEON_HIGH = 31;
/** Rock over its ceiling, at the least, everywhere above it. */
const DUNGEON_COVER = 4;
/** Furthest a structure's blocks reach from its middle, sideways. */
export const STRUCTURE_REACH = 4;
/** The most its ground may differ from the floor, anywhere under it. */
const LEVEL = 3;

/** Its kind for the biome at its middle (and a coin on the plains), or null for none there. */
function kindFor(biome: Biome, coin: number, height: number): StructureKind | null {
  switch (biome) {
    case Biome.Forest:
      return StructureKind.Ruin;
    case Biome.Mountains:
      // Below the snow, on the lower slopes.
      return height < SEA_LEVEL + 40 ? StructureKind.Ruin : null;
    case Biome.Plains:
      return coin < 0.5 ? StructureKind.Ruin : StructureKind.Camp;
    case Biome.Savanna:
    case Biome.Desert:
      return StructureKind.Camp;
    default:
      return null;
  }
}

/** Local (a across, b forward towards the door) to world, for a structure facing `facing`. */
function place(s: { x: number; z: number; facing: number }, a: number, b: number): [number, number] {
  const [fx, fz] = FACINGS[s.facing];
  // Right of forward, a quarter turn.
  const rx = -fz;
  const rz = fx;
  return [s.x + a * rx + b * fx, s.z + a * rz + b * fz];
}

/** The facing index of a world direction. */
const facingOf = (dx: number, dz: number): number => FACINGS.findIndex(([x, z]) => x === dx && z === dz);

/** The cell (gx, gz)'s structure, if it has one where the land allows. */
export function structureInCell(seed: number, gx: number, gz: number, ground: StructureGround): Structure | null {
  if (hash3(seed, gx, 301, gz) >= CHANCE) return null;
  const x = gx * CELL + MARGIN + Math.floor(hash3(seed, gx, 302, gz) * (CELL - 2 * MARGIN));
  const z = gz * CELL + MARGIN + Math.floor(hash3(seed, gx, 303, gz) * (CELL - 2 * MARGIN));
  const y = ground.height(x, z);
  if (y < SEA_LEVEL + 2) return null;
  const kind = kindFor(ground.biome(x, z), hash3(seed, gx, 304, gz), y);
  if (kind === null) return null;
  const half = HALF[kind];
  // Nearly level and dry, at the corners and halfway along each side.
  for (const [dx, dz] of [
    [-half, -half],
    [half, -half],
    [-half, half],
    [half, half],
    [0, -half],
    [0, half],
    [-half, 0],
    [half, 0],
  ]) {
    const h = ground.height(x + dx, z + dz);
    if (h < SEA_LEVEL + 2 || Math.abs(h - y) > LEVEL) return null;
  }
  // Not where a cave opens at the floor: the middle, the corners and halfway along the sides.
  for (const [dx, dz] of [[0, 0], [-half, -half], [half, -half], [-half, half], [half, half], [0, -half], [0, half], [-half, 0], [half, 0]])
    for (let k = y - 2; k <= y; k++) if (ground.caveAt(x + dx, k, z + dz)) return null;
  const facing = Math.floor(hash3(seed, gx, 305, gz) * 4);
  const s = { kind, x, z, y, facing, half };
  // A ruin's chest in the back corner on the left; a camp's beside the tent, at the open end.
  const [cx, cz] = kind === StructureKind.Ruin ? place(s, -2, -2) : place(s, -2, 3);
  return { ...s, chest: [cx, y + 1, cz] };
}

/**
 * The dungeon of cell (gx, gz) (`DUNGEON_CELL` wide), if it has one: buried, its middle and corners under
 * `DUNGEON_COVER` of ground at least.
 */
export function dungeonInCell(seed: number, gx: number, gz: number, ground: StructureGround): Structure | null {
  const C = DUNGEON_CELL;
  if (hash3(seed ^ 0xd06e, gx, 401, gz) >= DUNGEON_CHANCE) return null;
  const x = gx * C + DUNGEON_MARGIN + Math.floor(hash3(seed ^ 0xd06e, gx, 402, gz) * (C - 2 * DUNGEON_MARGIN));
  const z = gz * C + DUNGEON_MARGIN + Math.floor(hash3(seed ^ 0xd06e, gx, 403, gz) * (C - 2 * DUNGEON_MARGIN));
  const y = DUNGEON_LOW + Math.floor(hash3(seed ^ 0xd06e, gx, 404, gz) * (DUNGEON_HIGH - DUNGEON_LOW + 1));
  const half = HALF[StructureKind.Dungeon];
  const ceiling = y + HEIGHT[StructureKind.Dungeon];
  for (const [dx, dz] of [[0, 0], [-half, -half], [half, -half], [-half, half], [half, half]]) if (ground.height(x + dx, z + dz) < ceiling + DUNGEON_COVER) return null;
  const facing = Math.floor(hash3(seed ^ 0xd06e, gx, 405, gz) * 4);
  const s = { kind: StructureKind.Dungeon, x, z, y, facing, half };
  // The chest in a back corner, inside the walls.
  const [cx, cz] = place(s, -(half - 1), -(half - 1));
  return { ...s, chest: [cx, y + 1, cz] };
}

/** The dungeons whose blocks may reach into [x0, x1] x [z0, z1] (version 3), in world order. */
export function dungeonsIn(seed: number, x0: number, z0: number, x1: number, z1: number, ground: StructureGround): Structure[] {
  const out: Structure[] = [];
  const C = DUNGEON_CELL;
  for (let gz = Math.floor((z0 - STRUCTURE_REACH) / C); gz <= Math.floor((z1 + STRUCTURE_REACH) / C); gz++)
    for (let gx = Math.floor((x0 - STRUCTURE_REACH) / C); gx <= Math.floor((x1 + STRUCTURE_REACH) / C); gx++) {
      const s = dungeonInCell(seed, gx, gz, ground);
      if (!s) continue;
      if (s.x + s.half < x0 || s.x - s.half > x1 || s.z + s.half < z0 || s.z - s.half > z1) continue;
      out.push(s);
    }
  return out;
}

/** The structures whose blocks may reach into [x0, x1] x [z0, z1], in world order (cells by z, then x). */
export function structuresIn(seed: number, x0: number, z0: number, x1: number, z1: number, ground: StructureGround): Structure[] {
  const out: Structure[] = [];
  for (let gz = Math.floor((z0 - STRUCTURE_REACH) / CELL); gz <= Math.floor((z1 + STRUCTURE_REACH) / CELL); gz++)
    for (let gx = Math.floor((x0 - STRUCTURE_REACH) / CELL); gx <= Math.floor((x1 + STRUCTURE_REACH) / CELL); gx++) {
      const s = structureInCell(seed, gx, gz, ground);
      if (!s) continue;
      if (s.x + s.half < x0 || s.x - s.half > x1 || s.z + s.half < z0 || s.z - s.half > z1) continue;
      out.push(s);
    }
  return out;
}

/** A block of a structure: world place and block. */
export type Placed = [x: number, y: number, z: number, block: Block];

/**
 * A structure's blocks, in the order to write them: the air cleared above its floor and the ground
 * filled up to it (stone, or sandstone in the desert, under a ruin's brick floor; earth under a camp),
 * then what it's built of.
 */
export function structureBlocks(seed: number, s: Structure, ground: StructureGround): Placed[] {
  if (s.kind === StructureKind.Dungeon) return dungeonBlocks(seed, s, ground);
  const out: Placed[] = [];
  const { y, half } = s;
  const desert = ground.biome(s.x, s.z) === Biome.Desert;
  const fill = s.kind === StructureKind.Ruin ? (desert ? Block.Sandstone : Block.Stone) : Block.Dirt;
  // Clear the volume and level the ground.
  for (let dz = -half; dz <= half; dz++)
    for (let dx = -half; dx <= half; dx++) {
      const x = s.x + dx;
      const z = s.z + dz;
      const g = ground.height(x, z);
      for (let k = y + 1; k <= y + HEIGHT[s.kind]; k++) out.push([x, k, z, Block.Air]);
      for (let k = g + 1; k < y; k++) out.push([x, k, z, fill]);
      if (s.kind === StructureKind.Ruin) out.push([x, y, z, hash3(seed, x, y + 306, z) < 0.3 ? Block.MossyBricks : Block.StoneBricks]);
      else if (g < y) out.push([x, y, z, Block.Dirt]);
    }
  const brick = (x: number, k: number, z: number) => (hash3(seed, x, k + 308, z) < 0.35 ? Block.MossyBricks : Block.StoneBricks);
  if (s.kind === StructureKind.Ruin) {
    // Walls round the edge, broken to 0–4 high (the corners standing), a doorway in the front.
    for (let a = -half; a <= half; a++)
      for (let b = -half; b <= half; b++) {
        if (Math.abs(a) !== half && Math.abs(b) !== half) {
          // Rubble inside, now and then.
          const [x, z] = place(s, a, b);
          if (hash3(seed, x, 309, z) < 0.07 && !(a === -2 && b === -2)) out.push([x, y + 1, z, brick(x, y + 1, z)]);
          continue;
        }
        const [x, z] = place(s, a, b);
        const corner = Math.abs(a) === half && Math.abs(b) === half;
        const door = b === half && Math.abs(a) <= 0;
        const h = door ? 0 : corner ? 4 : Math.floor(hash3(seed, x, 307, z) * 5);
        for (let k = 1; k <= h; k++) out.push([x, y + k, z, brick(x, y + k, z)]);
      }
  } else {
    // A tent along the way it faces: plank stairs sloping down outwards on each side, a slab along the ridge.
    // (Stairs' tall back is on the side they face: inwards, towards the ridge.)
    for (let b = -2; b <= 2; b++) {
      const [lx, lz] = place(s, -1, b);
      const [rx, rz] = place(s, 1, b);
      const [mx, mz] = place(s, 0, b);
      out.push([lx, y + 1, lz, stairs(1, facingOf(...dirOf(s, 1)), false)]);
      out.push([rx, y + 1, rz, stairs(1, facingOf(...dirOf(s, -1)), false)]);
      out.push([mx, y + 2, mz, slab(1, false)]);
    }
    // A cold hearth beside the tent, facing out.
    const [hx, hz] = place(s, 2, 3);
    out.push([hx, y + 1, hz, furnace(s.facing, false)]);
  }
  const [cx, cy, cz] = s.chest;
  out.push([cx, cy, cz, chest(s.facing)]);
  return out;
}

/**
 * A dungeon's blocks: the room inside cleared; its walls, floor and ceiling of mossy brick (and some stone
 * brick), except where a cave runs through them, which stays open; its chest.
 */
function dungeonBlocks(seed: number, s: Structure, ground: StructureGround): Placed[] {
  const out: Placed[] = [];
  const { y, half } = s;
  const top = y + HEIGHT[StructureKind.Dungeon];
  for (let dz = -half; dz <= half; dz++)
    for (let dx = -half; dx <= half; dx++) {
      const x = s.x + dx;
      const z = s.z + dz;
      const wall = Math.abs(dx) === half || Math.abs(dz) === half;
      const cave = ground.caveColumn(x, z, y, top);
      for (let k = y; k <= top; k++) {
        if (!wall && k > y && k < top) out.push([x, k, z, Block.Air]);
        else if (!cave[k - y]) out.push([x, k, z, hash3(seed, x, k + 410, z) < 0.65 ? Block.MossyBricks : Block.StoneBricks]);
      }
    }
  const [cx, cy, cz] = s.chest;
  out.push([cx, cy, cz, chest(s.facing)]);
  return out;
}

/** The world direction of local +a (sign 1) or -a (sign -1) for a structure. */
function dirOf(s: { facing: number }, sign: number): [number, number] {
  const [fx, fz] = FACINGS[s.facing];
  return [-fz * sign, fx * sign];
}

/** The highest y a structure writes. */
export const structureTop = (s: Structure): number => s.y + HEIGHT[s.kind];

/** Write the parts of `placed` lists that fall in chunk (cx, cy, cz). */
export function placeStructures(blocks: Uint8Array, cx: number, cy: number, cz: number, placed: readonly Placed[][]): void {
  const S = CHUNK_SIZE;
  const x0 = cx * S;
  const y0 = cy * S;
  const z0 = cz * S;
  for (const list of placed)
    for (const [x, y, z, b] of list) {
      const lx = x - x0;
      const ly = y - y0;
      const lz = z - z0;
      if (lx < 0 || lx >= S || ly < 0 || ly >= S || lz < 0 || lz >= S) continue;
      blocks[(ly * S + lz) * S + lx] = b;
    }
}
