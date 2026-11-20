// Deep caves (Milestone 19, generation version 3): below `DEEP_TOP`, each place belongs to a deep
// biome from a 3D noise sampled once per 8 x 8 x 8 cell: crystal caverns, mushroom grottoes, or plain
// caves. After caves and ores are carved and placed in a chunk (`decorate`):
// - in crystal caverns, crystal clusters grow on the floor here and there, and stone beside the air
//   turns to crystal ore now and then;
// - in grottoes, the floor (the solid block under air) is grotto floor.
// Giant mushrooms stand on grotto floors, from a seeded hash per 8 x 8 column cell, found with the
// caves' own `carved` (as trees find their ground), and written into every chunk they reach, so they
// don't depend on which chunks are made first. Pure.

import { hash3 } from '../math';
import { Block } from './blocks';
import { CHUNK_SIZE } from './coords';
import { Noise } from './noise';

/** Deep biomes only below this height. */
export const DEEP_TOP = 40;
/** Nothing deep below this (the caves' floor and, later, lava lakes). */
const DEEP_BOTTOM = 12;

export enum DeepBiome {
  None = 0,
  Crystal = 1,
  Grotto = 2,
}

/** Cells of the biome noise, and how wide its features are (blocks). */
const CELL = 8;
const SCALE = 1 / 72;
/** The noise above `BIOME` is crystal, below `-BIOME` grotto. */
const BIOME = 0.32;
/** Chances: a cluster on a crystal cavern's floor block, crystal ore in its wall, a mushroom in a cell. */
const CLUSTER = 0.12;
const WALL_ORE = 0.035;
const MUSHROOM = 0.9;
/** Column cells for mushrooms, and the most a mushroom reaches from its stem. */
export const MUSHROOM_CELL = 6;
/** Columns tried in each cell for a mushroom. */
const TRIES = 3;
export const MUSHROOM_REACH = 3;

/**
 * Which blocks of column (x, z) from y0 to y1 are cave (1 where carved: `Caves.carvedColumn`), for the
 * mushroom search.
 */
export type CaveColumn = (x: number, z: number, y0: number, y1: number) => Uint8Array;

/** A giant mushroom: its stem's foot (on the floor), how tall the stem is, and the cap's radius. */
export interface Mushroom {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
}

const S = CHUNK_SIZE;
const AIR = Block.Air;
const STONE = Block.Stone;

export class Deep {
  private readonly noise: Noise;
  /** Cells' biomes looked up in one `mushroomsIn` (nearby columns share them). */
  private readonly seenCells = new Map<number, DeepBiome>();
  /** One chunk's cells' biomes, 4 x 4 x 4 (reused). */
  private readonly cells = new Uint8Array((S / CELL) ** 3);

  constructor(private readonly seed: number) {
    this.noise = new Noise(seed ^ 0xdee9);
  }

  /** The deep biome at (x, y, z): none above `DEEP_TOP` or below `DEEP_BOTTOM`. */
  biomeAt(x: number, y: number, z: number): DeepBiome {
    if (y >= DEEP_TOP || y < DEEP_BOTTOM) return DeepBiome.None;
    const cx = Math.floor(x / CELL) * CELL + CELL / 2;
    const cy = Math.floor(y / CELL) * CELL + CELL / 2;
    const cz = Math.floor(z / CELL) * CELL + CELL / 2;
    const v = this.noise.noise3(cx * SCALE, cy * SCALE * 1.5, cz * SCALE);
    return v > BIOME ? DeepBiome.Crystal : v < -BIOME ? DeepBiome.Grotto : DeepBiome.None;
  }

  /** `biomeAt` through `seenCells`. */
  private cachedBiome(x: number, y: number, z: number): DeepBiome {
    const k = ((Math.floor(x / CELL) + 0x8000) * 0x10000 + (Math.floor(z / CELL) + 0x8000)) * 64 + Math.floor(y / CELL);
    let b = this.seenCells.get(k);
    if (b === undefined) this.seenCells.set(k, (b = this.biomeAt(x, y, z)));
    return b;
  }

  /** Clusters, wall ore and grotto floors in chunk (cx, cy, cz)'s blocks, as described at the top. */
  decorate(blocks: Uint8Array, cx: number, cy: number, cz: number): void {
    const y0 = cy * S;
    if (y0 >= DEEP_TOP || y0 + S <= DEEP_BOTTOM) return;
    const x0 = cx * S;
    const z0 = cz * S;
    const N = S / CELL;
    const cells = this.cells;
    let any = false;
    for (let j = 0; j < N; j++)
      for (let k = 0; k < N; k++)
        for (let i = 0; i < N; i++) {
          const b = this.biomeAt(x0 + i * CELL, y0 + j * CELL, z0 + k * CELL);
          cells[(j * N + k) * N + i] = b;
          if (b) any = true;
        }
    if (!any) return;
    const seed = this.seed;
    const yFrom = Math.max(DEEP_BOTTOM, y0) - y0;
    const yTo = Math.min(DEEP_TOP, y0 + S) - y0;
    for (let ly = yFrom; ly < yTo; ly++) {
      for (let lz = 0; lz < S; lz++) {
        for (let lx = 0; lx < S; lx++) {
          const biome = cells[(((ly / CELL) | 0) * N + ((lz / CELL) | 0)) * N + ((lx / CELL) | 0)];
          if (!biome) continue;
          const i = (ly << 10) | (lz << 5) | lx;
          const b = blocks[i];
          const x = x0 + lx;
          const y = y0 + ly;
          const z = z0 + lz;
          if (biome === DeepBiome.Crystal) {
            if (b === AIR && ly > 0 && blocks[i - 1024] === STONE) {
              if (hash3(seed ^ 0xc1a5, x, y, z) < CLUSTER) blocks[i] = Block.CrystalCluster;
            } else if (b === STONE && touchesAir(blocks, lx, ly, lz) && hash3(seed ^ 0x0e5c, x, y, z) < WALL_ORE) blocks[i] = Block.CrystalOre;
          } else if (b !== AIR && b !== Block.Water && ly < S - 1 && blocks[i + 1024] === AIR && isGround(b)) blocks[i] = Block.GrottoFloor;
        }
      }
    }
  }

  /**
   * The giant mushrooms whose stems stand in columns x0..x1, z0..z1, from a seeded hash per
   * `MUSHROOM_CELL` cell: up to `TRIES` columns in it, the first with a grotto floor and room above it
   * (`carved`: is the block cave?).
   */
  mushroomsIn(x0: number, z0: number, x1: number, z1: number, column: CaveColumn): Mushroom[] {
    const out: Mushroom[] = [];
    const C = MUSHROOM_CELL;
    this.seenCells.clear();
    for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++)
      for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++) {
        if (hash3(this.seed ^ 0x5b0, gx, 0, gz) >= MUSHROOM) continue;
        const height = 4 + Math.floor(hash3(this.seed ^ 0x5b3, gx, 3, gz) * 4);
        // A few tries at a column in the cell, the first that stands on a grotto's floor winning.
        for (let t = 0; t < TRIES; t++) {
          const x = gx * C + Math.floor(hash3(this.seed ^ 0x5b1, gx, 1 + t * 2, gz) * C);
          const z = gz * C + Math.floor(hash3(this.seed ^ 0x5b2, gx, 2 + t * 2, gz) * C);
          const m = this.standing(x, z, height, column);
          if (!m) continue;
          // Only those whose stems are in the columns asked about (each is found in its own cell, whoever asks).
          if (m.x >= x0 && m.x <= x1 && m.z >= z0 && m.z <= z1) out.push(m);
          break;
        }
      }
    return out;
  }

  /**
   * A giant mushroom of up to `height` standing in column (x, z): on the highest grotto floor with room
   * over it for a stem of at least 3 and its cap, as tall as the room allows; null if there's none.
   */
  private standing(x: number, z: number, height: number, column: CaveColumn): Mushroom | null {
    // The biome by cell (it's the same 8 blocks at a time): a column with no grotto in it is skipped.
    const grotto: boolean[] = [];
    let low = Infinity;
    let high = -Infinity;
    for (let cy = Math.floor(DEEP_BOTTOM / CELL); cy * CELL < DEEP_TOP; cy++) {
      grotto[cy] = this.cachedBiome(x, cy * CELL, z) === DeepBiome.Grotto;
      if (grotto[cy]) [low, high] = [Math.min(low, cy * CELL), Math.max(high, cy * CELL + CELL - 1)];
    }
    if (low === Infinity) return null;
    // The cave from just below the lowest grotto cell to as high as a mushroom in the highest could reach.
    const from = Math.max(low, DEEP_BOTTOM) - 1;
    const to = Math.min(high + height + 2, DEEP_TOP);
    const c = column(x, z, from, to);
    const carved = (y: number) => y >= from && y <= to && c[y - from] === 1;
    for (let y = DEEP_TOP - 3; y > DEEP_BOTTOM; y--) {
      if (!grotto[Math.floor(y / CELL)] || !carved(y) || carved(y - 1)) continue;
      let room = 1;
      while (room <= height + 1 && carved(y + room)) room++;
      // The cap below `DEEP_TOP`, as everything deep is.
      const fits = Math.min(height, room - 2, DEEP_TOP - 2 - y);
      if (fits >= 3) return { x, y, z, height: fits, radius: fits >= 6 ? 3 : 2 };
    }
    return null;
  }
}

/** Mushrooms' blocks in chunk (cx, cy, cz): their stems and caps, only into air (a cave's). */
export function placeMushrooms(blocks: Uint8Array, cx: number, cy: number, cz: number, mushrooms: readonly Mushroom[]): void {
  const x0 = cx * S;
  const y0 = cy * S;
  const z0 = cz * S;
  const put = (x: number, y: number, z: number, b: Block) => {
    const lx = x - x0;
    const ly = y - y0;
    const lz = z - z0;
    if (lx < 0 || lx >= S || ly < 0 || ly >= S || lz < 0 || lz >= S) return;
    const i = (ly << 10) | (lz << 5) | lx;
    if (blocks[i] === AIR) blocks[i] = b;
  };
  for (const m of mushrooms) {
    for (let k = 0; k < m.height; k++) put(m.x, m.y + k, m.z, Block.MushroomStem);
    const top = m.y + m.height;
    const r = m.radius;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dz * dz;
        if (d <= r * r + 1) put(m.x + dx, top, m.z + dz, Block.MushroomCap);
        // The rim, a block lower.
        if (d > (r - 1) * (r - 1) + 1 && d <= r * r + 1) put(m.x + dx, top - 1, m.z + dz, Block.MushroomCap);
      }
  }
}

/** Ground a grotto's floor covers: stone, earth and gravel (not ores, not wood or leaves). */
const isGround = (b: number) => b === STONE || b === Block.Dirt || b === Block.Gravel || b === Block.Grass || b === Block.Sand || b === Block.Sandstone;

/** Is any of the block's six neighbours within the chunk air? */
function touchesAir(blocks: Uint8Array, lx: number, ly: number, lz: number): boolean {
  const i = (ly << 10) | (lz << 5) | lx;
  return (
    (lx > 0 && blocks[i - 1] === AIR) ||
    (lx < S - 1 && blocks[i + 1] === AIR) ||
    (lz > 0 && blocks[i - 32] === AIR) ||
    (lz < S - 1 && blocks[i + 32] === AIR) ||
    (ly > 0 && blocks[i - 1024] === AIR) ||
    (ly < S - 1 && blocks[i + 1024] === AIR)
  );
}
