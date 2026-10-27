// Lower detail for far chunks (Milestone 6 step 4), made by changing the mesher's input rather
// than the mesher: the padded blocks are coarsened in place into cells of 2 × 2 × 2 (LOD 1) or
// 4 × 4 × 4 (LOD 2) blocks, each cell all one block, and the ordinary greedy mesher then merges
// them into big faces. Positions stay in world space and textures keep their size in blocks.
//
// A cell is solid when at least half its blocks are (opaque cubes and leaves), and takes the
// highest solid block in it, so grass tops stay green and snow white. Otherwise its solid blocks
// are taken out (water where the cell has water, else air) and everything else is kept as it
// was: water and glass stay at full detail, the sea level exact.
//
// The one-block border from the neighbours can't be coarsened exactly (a cell of the neighbour's
// is 2 or 4 blocks deep). For LOD 1 a patch of the border counts as solid only when all of it
// is: the neighbour's cell then has a whole layer, half of it, solid, so it is solid too, and no
// face is ever left out at a chunk border (some hidden ones are made). For LOD 2 a layer is only
// a quarter of a cell, which proves nothing (real chunks had holes), so the border never counts
// as solid: far chunks wall their edges, the hidden walls costing some quads.
//
// Seams: where a column borders one of another level, its surfaces don't meet the neighbour's,
// and there would be gaps. On the sides asked for, the border is made air (`wallSeams`), so
// the chunk makes walls there that cover them (the loader walls every side of a far chunk,
// `wallsFor`). Pure.

import { Block, BLOCKS } from '../world/blocks';
import { CHUNK_SIZE } from '../world/coords';
import { SUNLIT } from '../world/light';
import { PADDED } from './padding';

const S = CHUNK_SIZE;
const P = PADDED;
const AIR = Block.Air;
const WATER = Block.Water;

/** Blocks a cell's solidity counts: opaque cubes and leaves (not air, water, glass or torches). */
const SOLID = new Uint8Array(256);
const OPAQUE = new Uint8Array(256);
BLOCKS.forEach((info, b) => {
  SOLID[b] = (info.opaque || info.cutout) && info.shape === 'cube' ? 1 : 0;
  OPAQUE[b] = info.opaque && info.shape === 'cube' ? 1 : 0;
});

/** Cell size in blocks by level of detail. */
export const LOD_CELL = [1, 2, 4] as const;
export type Lod = 0 | 1 | 2;

/** Sides of a chunk that border a column of another level (`MeshJob.seams`). */
export const SEAM_NEG_X = 1;
export const SEAM_POS_X = 2;
export const SEAM_NEG_Z = 4;
export const SEAM_POS_Z = 8;

const at = (x: number, y: number, z: number): number => (y * P + z) * P + x;

/** Make the padded blocks and light ready to mesh at `lod`, with walls on the `seams` sides. In place. */
export function prepareLod(blocks: Uint8Array, light: Uint8Array, lod: Lod, seams: number): void {
  if (lod > 0) coarsen(blocks, light, LOD_CELL[lod]);
  if (seams) wallSeams(blocks, light, seams);
}

/** Light levels packed as sun << 4 | block light: the brighter of each. */
const brighter = (a: number, b: number): number => (Math.max(a >> 4, b >> 4) << 4) | Math.max(a & 15, b & 15);

/** The chunk's blocks in cells of k³, and its border in patches of k² (see the top of the file). */
export function coarsen(blocks: Uint8Array, light: Uint8Array, k: number): void {
  const half = (k * k * k) / 2;
  // A column of cells at a time, from the top down: a thin surface layer (snow, grass) in a cell
  // that isn't solid is taken out, and the solid cell under it takes its block instead. Only a
  // layer covering at least half the cell's floor, of opaque blocks: not a tree trunk or leaves.
  for (let z0 = 1; z0 <= S; z0 += k) {
    for (let x0 = 1; x0 <= S; x0 += k) {
      let surface = AIR;
      for (let y0 = S + 1 - k; y0 >= 1; y0 -= k) {
        let solid = 0;
        let top = AIR;
        let fill = AIR;
        let lit = 0;
        let floor = 0;
        let floorBlock = AIR;
        // From the top layer down, so `top` is the highest solid block.
        for (let y = y0 + k - 1; y >= y0; y--) {
          for (let z = z0; z < z0 + k; z++) {
            for (let x = x0; x < x0 + k; x++) {
              const i = at(x, y, z);
              const b = blocks[i];
              if (SOLID[b]) {
                solid++;
                if (top === AIR) top = b;
                if (y === y0 && OPAQUE[b]) {
                  floor++;
                  floorBlock = b;
                }
              } else {
                if (b === WATER) fill = WATER;
                lit = brighter(lit, light[i]);
              }
            }
          }
        }
        if (solid === 0) {
          surface = AIR;
          continue;
        }
        const whole = solid >= half;
        if (whole) {
          if (surface !== AIR) top = surface;
          surface = AIR;
        } else surface = floor * 2 >= k * k ? floorBlock : AIR;
        for (let y = y0; y < y0 + k; y++) {
          for (let z = z0; z < z0 + k; z++) {
            for (let x = x0; x < x0 + k; x++) {
              const i = at(x, y, z);
              if (whole) blocks[i] = top;
              else if (SOLID[blocks[i]]) {
                blocks[i] = fill;
                light[i] = lit;
              }
            }
          }
        }
      }
    }
  }
  // The border's six faces (not its edges and corners), in patches of k × k.
  for (let axis = 0; axis < 3; axis++) {
    for (const layer of [0, P - 1]) {
      for (let v0 = 1; v0 <= S; v0 += k) {
        for (let u0 = 1; u0 <= S; u0 += k) {
          border(blocks, light, axis, layer, u0, v0, k);
        }
      }
    }
  }
}

/** Index of the border block at `layer` on `axis` and (u, v) on the other two axes in order. */
function borderIndex(axis: number, layer: number, u: number, v: number): number {
  return axis === 0 ? at(layer, v, u) : axis === 1 ? at(u, layer, v) : at(u, v, layer);
}

function border(blocks: Uint8Array, light: Uint8Array, axis: number, layer: number, u0: number, v0: number, k: number): void {
  let solid = 0;
  let top = AIR;
  let fill = AIR;
  let lit = 0;
  for (let v = v0; v < v0 + k; v++) {
    for (let u = u0; u < u0 + k; u++) {
      const i = borderIndex(axis, layer, u, v);
      const b = blocks[i];
      if (SOLID[b]) {
        solid++;
        top = b;
      } else {
        if (b === WATER) fill = WATER;
        lit = brighter(lit, light[i]);
      }
    }
  }
  // Not lit by anything known (all of it was solid): full sun, as for seams.
  if (!lit) lit = SUNLIT;
  if (solid === 0 || (solid === k * k && k <= 2)) {
    // All solid: one block, as the neighbour's cell would be (`top` is any of them; a type only
    // matters for AO and culling here, both the same for every solid block).
    if (solid) for (let v = v0; v < v0 + k; v++) for (let u = u0; u < u0 + k; u++) blocks[borderIndex(axis, layer, u, v)] = top;
    return;
  }
  for (let v = v0; v < v0 + k; v++) {
    for (let u = u0; u < u0 + k; u++) {
      const i = borderIndex(axis, layer, u, v);
      if (SOLID[blocks[i]]) {
        blocks[i] = fill;
        light[i] = lit;
      }
    }
  }
}

/**
 * The border on the `seams` sides made air where it was solid (water and air are kept), lit
 * by full sun: the chunk then makes walls on those sides, covering the gaps between its
 * surfaces and the neighbour's of another level.
 */
export function wallSeams(blocks: Uint8Array, light: Uint8Array, seams: number): void {
  const sides: [number, number, number][] = [
    [SEAM_NEG_X, 0, 0],
    [SEAM_POS_X, 0, P - 1],
    [SEAM_NEG_Z, 2, 0],
    [SEAM_POS_Z, 2, P - 1],
  ];
  for (const [bit, axis, layer] of sides) {
    if (!(seams & bit)) continue;
    for (let y = 0; y < P; y++) {
      for (let w = 0; w < P; w++) {
        const i = axis === 0 ? at(layer, y, w) : at(w, y, layer);
        if (SOLID[blocks[i]]) {
          blocks[i] = AIR;
          light[i] = SUNLIT;
        }
      }
    }
  }
}
