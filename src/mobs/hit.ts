// Hitting mobs: which one the crosshair is on. A ray against each mob's box (its body: the
// half-width either side, its height up from the feet), the nearest one it enters within reach.
// The game passes the distance to the block looked at as the reach, so a mob behind a block
// can't be hit through it. Pure.

import type { Mob } from './brain';

interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface MobHit {
  mob: Mob;
  /** Along the ray to where it enters the mob's box (blocks). */
  distance: number;
}

/** The nearest mob whose box the ray from `origin` along the unit `dir` enters within `reach`, or null. */
export function mobOnRay(mobs: readonly Mob[], origin: V3, dir: V3, reach: number): MobHit | null {
  let best: MobHit | null = null;
  for (const mob of mobs) {
    const b = mob.body;
    const w = b.halfWidth;
    const d = rayBox(origin, dir, b.x - w, b.y, b.z - w, b.x + w, b.y + b.height, b.z + w);
    if (d <= reach && (!best || d < best.distance)) best = { mob, distance: d };
  }
  return best;
}

/** Where a ray enters a box (0 from inside it), or infinity if it misses (slabs, one axis at a time). */
function rayBox(o: V3, d: V3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, x0, x1],
    [o.y, d.y, y0, y1],
    [o.z, d.z, z0, z1],
  ];
  for (const [from, step, lo, hi] of axes) {
    if (step === 0) {
      if (from < lo || from > hi) return Number.POSITIVE_INFINITY;
      continue;
    }
    let t0 = (lo - from) / step;
    let t1 = (hi - from) / step;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return Number.POSITIVE_INFINITY;
  }
  return near;
}
