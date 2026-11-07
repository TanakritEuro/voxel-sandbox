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
    const info = BLOCKS[block];
    if (info.targetable) {
      if (!info.box) return { x, y, z, block, nx, ny, nz, distance: t };
      // A door or bed: only where its box is; through the rest of the block.
      const hit = intoBox(origin, dir, x, y, z, info.box);
      if (hit && hit[0] <= maxDistance) {
        const n = hit[1];
        return n < 0 ? { x, y, z, block, nx, ny, nz, distance: t } : { x, y, z, block, nx: n === 0 ? -Math.sign(dir.x) : 0, ny: n === 1 ? -Math.sign(dir.y) : 0, nz: n === 2 ? -Math.sign(dir.z) : 0, distance: hit[0] };
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
  box: readonly [number, number, number, number, number, number],
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
