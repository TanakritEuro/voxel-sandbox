// The four kinds of mob: invented animals, all passive, each at home in a biome or two. Their
// size, how they move and how far their paths may go; their looks are in `render/mobRenderer.ts`.

import { Biome } from '../world/biomes';
import { Block } from '../world/blocks';

export enum MobKind {
  Mossback = 0,
  Hopper = 1,
  CragGoat = 2,
  DuneBeetle = 3,
}

export interface KindInfo {
  name: string;
  /** The body's box: half its width, and its height (blocks). */
  halfWidth: number;
  height: number;
  /** Blocks a second, wandering and fleeing. */
  walkSpeed: number;
  runSpeed: number;
  /** Feet rise this far in a jump (enough for its step: 1.25 for one block, 2.25 for two). */
  jumpHeight: number;
  /** Paths: highest step up, deepest drop, whether it swims, places looked at before giving up. */
  step: number;
  drop: number;
  swim: boolean;
  maxNodes: number;
  /** Moves by hopping: jumps whenever it's on the ground and going somewhere. */
  hops: boolean;
  /** Where it appears: biomes, the blocks it stands on, how many together. */
  biomes: readonly Biome[];
  ground: readonly Block[];
  group: readonly [number, number];
}

export const KINDS: readonly KindInfo[] = [
  {
    name: 'Mossback',
    halfWidth: 0.45,
    height: 1.0,
    walkSpeed: 1.6,
    runSpeed: 4.2,
    jumpHeight: 1.25,
    step: 1,
    drop: 3,
    swim: true,
    maxNodes: 500,
    hops: false,
    biomes: [Biome.Forest, Biome.Plains],
    ground: [Block.Grass, Block.Dirt],
    group: [2, 4],
  },
  {
    name: 'Hopper',
    halfWidth: 0.25,
    height: 0.5,
    walkSpeed: 2.4,
    runSpeed: 5.5,
    jumpHeight: 1.25,
    step: 1,
    drop: 3,
    swim: false,
    maxNodes: 500,
    hops: true,
    biomes: [Biome.Plains],
    ground: [Block.Grass],
    group: [1, 3],
  },
  {
    name: 'Crag goat',
    halfWidth: 0.35,
    height: 1.1,
    walkSpeed: 2.0,
    runSpeed: 4.8,
    jumpHeight: 2.25,
    step: 2,
    drop: 5,
    swim: false,
    maxNodes: 1200,
    hops: false,
    biomes: [Biome.Mountains],
    ground: [Block.Snow, Block.SnowyGrass, Block.Stone, Block.Gravel],
    group: [1, 3],
  },
  {
    name: 'Dune beetle',
    halfWidth: 0.4,
    height: 0.4,
    walkSpeed: 1.8,
    runSpeed: 4.0,
    jumpHeight: 1.25,
    step: 1,
    drop: 3,
    swim: false,
    maxNodes: 500,
    hops: false,
    biomes: [Biome.Desert],
    ground: [Block.Sand, Block.Sandstone],
    group: [1, 3],
  },
];

/** Room a kind needs above its feet, in whole blocks (for paths). */
export const headroom = (k: KindInfo): number => Math.ceil(k.height - 1e-9);
