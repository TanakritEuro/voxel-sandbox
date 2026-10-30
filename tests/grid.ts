// A small world of blocks set by hand, for tests of paths and mobs; everything else is air.

import { Block } from '../src/world/blocks';
import type { BlockSource } from '../src/world/physics';

export class Grid implements BlockSource {
  private readonly blocks = new Map<string, Block>();

  set(x: number, y: number, z: number, b: Block): this {
    this.blocks.set(`${x},${y},${z}`, b);
    return this;
  }

  getBlock(x: number, y: number, z: number): Block {
    return this.blocks.get(`${x},${y},${z}`) ?? Block.Air;
  }

  /** A floor of stone at y - 1 over x0..x1, z0..z1, so feet stand at y. */
  floor(x0: number, x1: number, z0: number, z1: number, y = 1): this {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.set(x, y - 1, z, Block.Stone);
    return this;
  }

  /** A column of stone from y0 to y1 at (x, z). */
  pillar(x: number, z: number, y0: number, y1: number): this {
    for (let y = y0; y <= y1; y++) this.set(x, y, z, Block.Stone);
    return this;
  }
}
