// Which torches a block holds up: the floor torch on top of it, and wall torches hanging on its
// sides. Breaking the block takes them too. Pure.

import { torchSupport } from './blocks';
import type { World } from './world';

/** The steps from a block to where a torch it holds could be: above, and beside on four sides. */
const AROUND: readonly [number, number, number][] = [
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Positions of the torches block (x, y, z) holds up. */
export function torchesHeldBy(world: World, x: number, y: number, z: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [dx, dy, dz] of AROUND) {
    const support = torchSupport(world.getBlock(x + dx, y + dy, z + dz));
    // Its support is the step back to (x, y, z).
    if (support && support[0] === -dx && support[1] === -dy && support[2] === -dz) out.push([x + dx, y + dy, z + dz]);
  }
  return out;
}
