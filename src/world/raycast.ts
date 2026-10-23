// Voxel raycast by grid traversal (Amanatides & Woo, 1987): step from cell to cell along the
// ray, always crossing the nearest cell boundary next, so no block is ever skipped.

import { BLOCKS, type Block } from './blocks';
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
    if (BLOCKS[block].targetable) return { x, y, z, block, nx, ny, nz, distance: t };
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
