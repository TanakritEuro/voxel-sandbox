// Voxel raycast by grid traversal (Amanatides & Woo, 1987): step from cell to cell along the
// ray, always crossing the nearest cell boundary next, so no block is ever skipped.

import { BLOCKS, type Block, type Box } from './blocks';
import type { World } from './world';

export interface RayHit {
  /** The block hit. */
  x: number;
  y: number;
  z: number;
  block: Block;
  /** Face normal of the side that was hit: where a placed block goes. */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
  /** Where the ray met it (on its face, or a box's): for placing in the upper or lower half of a side. */
  px: number;
  py: number;
  pz: number;
}

/** First targetable block (solid, or a torch) along the ray from `origin` in unit direction `dir`, within `maxDistance`. */
export function raycast(
  world: World,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDistance: number,
): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x);
  const stepY = Math.sign(dir.y);
  const stepZ = Math.sign(dir.z);
  // Distance along the ray to cross one whole cell on each axis.
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
  // Distance along the ray to the first boundary on each axis.
  const frac = (p: number, s: number) => (s > 0 ? Math.floor(p) + 1 - p : p - Math.floor(p));
  let tMaxX = stepX !== 0 ? frac(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? frac(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? frac(origin.z, stepZ) * tDeltaZ : Infinity;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;
  while (t <= maxDistance) {
    const block = world.getBlock(x, y, z);
    const info = BLOCKS[block];
    if (info.targetable) {
      if (!info.boxes) return at(origin, dir, x, y, z, block, nx, ny, nz, t);
      // A door, bed, slab or stairs: only where its boxes are (the nearest); through the rest of the block.
      let best: [number, number] | null = null;
      for (const box of info.boxes) {
        const hit = intoBox(origin, dir, x, y, z, box);
        if (hit && (!best || hit[0] < best[0])) best = hit;
      }
      if (best && best[0] <= maxDistance) {
        const n = best[1];
        return n < 0
          ? at(origin, dir, x, y, z, block, nx, ny, nz, t)
          : at(origin, dir, x, y, z, block, n === 0 ? -Math.sign(dir.x) : 0, n === 1 ? -Math.sign(dir.y) : 0, n === 2 ? -Math.sign(dir.z) : 0, best[0]);
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      ny = -stepY;
      nx = nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nz = -stepZ;
      nx = ny = 0;
    }
  }
  return null;
}

/** A hit on block (x, y, z) at `distance` along the ray, the face by its normal. */
function at(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, x: number, y: number, z: number, block: Block, nx: number, ny: number, nz: number, distance: number): RayHit {
  return { x, y, z, block, nx, ny, nz, distance, px: origin.x + dir.x * distance, py: origin.y + dir.y * distance, pz: origin.z + dir.z * distance };
}

/**
 * Where the ray meets the box (within block (x, y, z)): its distance, and the axis of the face it
 * goes in by (-1 if it starts inside). Null if it misses.
 */
function intoBox(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
  box: Box,
): [number, number] | null {
  const o = [origin.x, origin.y, origin.z];
  const v = [dir.x, dir.y, dir.z];
  const at = [x, y, z];
  let near = -Infinity;
  let far = Infinity;
  let axis = -1;
  for (let a = 0; a < 3; a++) {
    const lo = at[a] + box[a];
    const hi = at[a] + box[a + 3];
    if (v[a] === 0) {
      if (o[a] < lo || o[a] > hi) return null;
      continue;
    }
    let t0 = (lo - o[a]) / v[a];
    let t1 = (hi - o[a]) / v[a];
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > near) {
      near = t0;
      axis = a;
    }
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  if (far < 0) return null;
  return near < 0 ? [0, -1] : [near, axis];
}
