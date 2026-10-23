// Features placed into generated chunks: ore veins and trees.
//
// A vein starts at a seeded spot in some chunk and wanders a few blocks, never more than
// REACH from its start; it only replaces stone. Every chunk replays the veins of itself and
// its 26 neighbours and keeps the blocks that land inside it, so a vein crossing a chunk
// border comes out whole, whichever chunk is generated first or alone.

import { createRng, hash3 } from '../math';
import type { Biome } from './biomes';
import { Block } from './blocks';
import { CHUNK_SIZE } from './coords';

// Local copies: imported bindings can cost a lookup each time in the hot loops (they do under Vitest).
const S = CHUNK_SIZE;
const STONE = Block.Stone;

interface Ore {
  block: Block;
  /** Veins started per chunk (each in range or not). */
  perChunk: number;
  /** Blocks a vein tries to place, min and max. */
  size: [number, number];
  /** Only between these heights. */
  minY: number;
  maxY: number;
}

export const ORES: readonly Ore[] = [
  { block: Block.CoalOre, perChunk: 14, size: [5, 12], minY: 5, maxY: 200 },
  { block: Block.IronOre, perChunk: 7, size: [4, 8], minY: 5, maxY: 100 },
  { block: Block.CopperOre, perChunk: 4, size: [7, 14], minY: 5, maxY: 70 },
  { block: Block.CrystalOre, perChunk: 1, size: [1, 4], minY: 5, maxY: 24 },
];

/** A vein never wanders further than this from its start (in each axis). */
const REACH = 3;

/** Replace stone with ore wherever a vein from this chunk or a neighbour passes. Returns blocks placed. */
export function placeOres(blocks: Uint8Array, cx: number, cy: number, cz: number, seed: number): number {
  const x0 = cx * S;
  const y0 = cy * S;
  const z0 = cz * S;
  let placed = 0;
  for (let ncy = cy - 1; ncy <= cy + 1; ncy++)
    for (let ncz = cz - 1; ncz <= cz + 1; ncz++)
      for (let ncx = cx - 1; ncx <= cx + 1; ncx++)
        ORES.forEach((ore, o) => {
          for (let v = 0; v < ore.perChunk; v++) {
            const rng = createRng(Math.floor(hash3(seed ^ (o * 7919 + v * 104729), ncx, ncy, ncz) * 4294967296));
            const sx = ncx * S + Math.floor(rng() * S);
            const sy = ncy * S + Math.floor(rng() * S);
            const sz = ncz * S + Math.floor(rng() * S);
            if (sy < ore.minY || sy > ore.maxY) continue;
            // Too far from this chunk for any of it to land here.
            if (sx < x0 - REACH || sx >= x0 + S + REACH || sy < y0 - REACH || sy >= y0 + S + REACH || sz < z0 - REACH || sz >= z0 + S + REACH) continue;
            const size = ore.size[0] + Math.floor(rng() * (ore.size[1] - ore.size[0] + 1));
            let x = sx;
            let y = sy;
            let z = sz;
            for (let n = 0; n < size; n++) {
              const lx = x - x0;
              const ly = y - y0;
              const lz = z - z0;
              if (lx >= 0 && lx < S && ly >= 0 && ly < S && lz >= 0 && lz < S && y >= ore.minY && y <= ore.maxY) {
                const i = (ly * S + lz) * S + lx;
                if (blocks[i] === STONE) {
                  blocks[i] = ore.block;
                  placed++;
                }
              }
              // One step along a random axis, turned back at the edge of the vein's reach.
              const axis = Math.floor(rng() * 3);
              const step = rng() < 0.5 ? -1 : 1;
              if (axis === 0) x = Math.abs(x + step - sx) > REACH ? x - step : x + step;
              else if (axis === 1) y = Math.abs(y + step - sy) > REACH ? y - step : y + step;
              else z = Math.abs(z + step - sz) > REACH ? z - step : z + step;
            }
          }
        });
  return placed;
}

// Trees. A tree's place is decided per 5 × 5-block cell of the world, from the seed and the
// cell alone: a chance by biome, a spot in the cell, a height; then it must stand on its
// biome's ground (grass, snowy grass or snow, desert sand), on dry land not cut by a cave. Each
// column job asks for the trees within TREE_REACH of its chunks and writes the parts that
// fall inside them, going through trees in world order: trunks may replace leaves, leaves
// only fill air, so overlapping trees come out the same whatever the load order.

export enum TreeKind {
  Oak = 0,
  Spruce = 1,
  Cactus = 2,
}

export interface Tree {
  x: number;
  z: number;
  /** The lowest trunk block (the ground is one below). */
  y: number;
  kind: TreeKind;
  /** Trunk blocks. */
  height: number;
}

/** What tree placement needs to know about the ground; the generator answers it. */
export interface Ground {
  height(x: number, z: number): number;
  biome(x: number, z: number): Biome;
  /** The block on top of the column (before caves). */
  top(x: number, z: number): Block;
  /** Above the water. */
  dry(x: number, z: number): boolean;
  /** Has a cave carved the block at (x, y, z)? */
  carved(x: number, y: number, z: number): boolean;
}

const CELL = 5;
/** Furthest a tree's blocks reach from its trunk, sideways. */
export const TREE_REACH = 2;
/** Tallest a tree reaches above its lowest trunk block (spruce: 9 trunk, a leaf on top). */
export const TREE_TOP = 10;

/** Per biome (plains, forest, desert, mountains): the chance a cell has a tree, which tree, on what ground. */
const TREE_CHANCE = [0.1, 0.7, 0.08, 0.3];
const TREE_KIND = [TreeKind.Oak, TreeKind.Oak, TreeKind.Cactus, TreeKind.Spruce];
const TREE_GROUND: readonly (readonly Block[])[] = [[Block.Grass], [Block.Grass], [Block.Sand], [Block.SnowyGrass, Block.Snow]];
const MOST_CHANCE = Math.max(...TREE_CHANCE);
const TREE_HEIGHTS: Record<TreeKind, [number, number]> = {
  [TreeKind.Oak]: [4, 6],
  [TreeKind.Spruce]: [6, 9],
  [TreeKind.Cactus]: [2, 4],
};

/** The trees whose trunks stand in [x0, x1] × [z0, z1], in world order (z, then x). */
export function treesIn(seed: number, x0: number, z0: number, x1: number, z1: number, ground: Ground): Tree[] {
  const trees: Tree[] = [];
  for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
      const chance = hash3(seed, gx, 101, gz);
      if (chance >= MOST_CHANCE) continue; // no biome is this sure: skip the lookups
      const x = gx * CELL + Math.floor(hash3(seed, gx, 102, gz) * CELL);
      const z = gz * CELL + Math.floor(hash3(seed, gx, 103, gz) * CELL);
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const biome = ground.biome(x, z);
      if (chance >= TREE_CHANCE[biome]) continue;
      if (!TREE_GROUND[biome].includes(ground.top(x, z)) || !ground.dry(x, z)) continue;
      const h = ground.height(x, z);
      if (ground.carved(x, h, z)) continue;
      const kind = TREE_KIND[biome];
      const [lo, hi] = TREE_HEIGHTS[kind];
      trees.push({ x, z, y: h + 1, kind, height: lo + Math.floor(hash3(seed, gx, 104, gz) * (hi - lo + 1)) });
    }
  }
  return trees;
}

const AIR = Block.Air;

/** Write the parts of `trees` that fall in chunk (cx, cy, cz). */
export function placeTrees(blocks: Uint8Array, cx: number, cy: number, cz: number, trees: readonly Tree[], seed: number): void {
  const x0 = cx * S;
  const y0 = cy * S;
  const z0 = cz * S;
  const index = (x: number, y: number, z: number): number => {
    const lx = x - x0;
    const ly = y - y0;
    const lz = z - z0;
    return lx >= 0 && lx < S && ly >= 0 && ly < S && lz >= 0 && lz < S ? (ly * S + lz) * S + lx : -1;
  };
  const leaf = (x: number, y: number, z: number, block: Block) => {
    const i = index(x, y, z);
    if (i >= 0 && blocks[i] === AIR) blocks[i] = block;
  };
  for (const t of trees) {
    if (t.y - 1 >= y0 + S || t.y + TREE_TOP < y0) continue; // nothing of it in this chunk
    const wood = t.kind === TreeKind.Oak ? Block.Wood : t.kind === TreeKind.Spruce ? Block.SpruceWood : Block.Cactus;
    const leaves = t.kind === TreeKind.Oak ? Block.Leaves : Block.SpruceLeaves;
    // Trunk: through air and other trees' leaves.
    for (let i = 0; i < t.height; i++) {
      const at = index(t.x, t.y + i, t.z);
      if (at >= 0 && (blocks[at] === AIR || blocks[at] === Block.Leaves || blocks[at] === Block.SpruceLeaves)) blocks[at] = wood;
    }
    if (t.kind === TreeKind.Cactus) continue;
    // Grass doesn't grow under a trunk.
    const ground = index(t.x, t.y - 1, t.z);
    if (ground >= 0 && (blocks[ground] === Block.Grass || blocks[ground] === Block.SnowyGrass)) blocks[ground] = Block.Dirt;
    const top = t.y + t.height - 1;
    if (t.kind === TreeKind.Oak) {
      // Two wide layers round the top of the trunk, a narrow one level with it, a cross above.
      for (let y = top - 2; y <= top + 1; y++) {
        const r = y < top ? 2 : 1;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (y === top + 1 && (corner || (dx !== 0 && dz !== 0))) continue;
            // Corners come and go by a seeded coin, so canopies aren't all square.
            if (corner && hash3(seed, t.x + dx, y, t.z + dz) < (r === 2 ? 0.6 : 0.5)) continue;
            leaf(t.x + dx, y, t.z + dz, leaves);
          }
      }
    } else {
      // A cone: a tip above the trunk, then layers alternately narrow and wide downwards,
      // leaving the lowest two trunk blocks bare.
      leaf(t.x, top + 1, t.z, leaves);
      for (let y = top; y >= t.y + 2; y--) {
        const k = top - y;
        const wide = k >= 2 && k % 2 === 0;
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const reach = Math.abs(dx) + Math.abs(dz);
            if (k < 2 ? reach > 1 : wide ? reach > 3 : Math.max(Math.abs(dx), Math.abs(dz)) > 1) continue;
            leaf(t.x + dx, y, t.z + dz, leaves);
          }
      }
    }
  }
}
