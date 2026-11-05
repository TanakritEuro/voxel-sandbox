// The kinds of mob: four invented animals, all passive, each at home in a biome or two; and the
// gloamer, a hostile thing of the dark (survival only), that appears where it's dark rather than
// in a biome and hunts players. Their size, how they move and how far their paths may go, how
// much hitting they take; their looks are in `render/mobRenderer.ts`.

import { Biome } from '../world/biomes';
import { Block } from '../world/blocks';

export enum MobKind {
  Mossback = 0,
  Hopper = 1,
  CragGoat = 2,
  DuneBeetle = 3,
  Gloamer = 4,
}

/** What makes a kind hostile: it hunts players and hits them. */
export interface Hostile {
  /** Hunts the nearest player this close (blocks). */
  sight: number;
  /** Hits a player whose box comes this close to its own (blocks): `damage` points and a `push` (blocks / s), every `every` s. */
  reach: number;
  damage: number;
  push: number;
  every: number;
  /** Appears only where the light (sunlight by the daylight, or block light) is at most this. */
  darkness: number;
  /** Fades away in daylight where the sunlight on it is at least this. */
  fadeSun: number;
  /** At most this many for each player, this far from them (blocks: from and to). */
  most: number;
  distance: readonly [number, number];
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
  /** Points of hitting it takes to go (a hand hits for 1, `TUNING.mobs.toolDamage`). */
  health: number;
  hostile?: Hostile;
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
    health: 3,
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
    health: 3,
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
    health: 3,
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
    health: 3,
  },
  {
    // Thin and tall, long-armed, faster than a walk and slower than a sprint.
    name: 'Gloamer',
    halfWidth: 0.3,
    height: 1.9,
    walkSpeed: 1.4,
    runSpeed: 4.8,
    jumpHeight: 1.25,
    step: 1,
    drop: 3,
    swim: false,
    maxNodes: 1500,
    hops: false,
    biomes: [],
    ground: [],
    group: [1, 1],
    health: 8,
    // It sees further than it appears, so it comes for a player from where it appears.
    hostile: { sight: 32, reach: 0.9, damage: 3, push: 5, every: 1, darkness: 4, fadeSun: 12, most: 4, distance: [24, 36] },
  },
];

/** Room a kind needs above its feet, in whole blocks (for paths). */
export const headroom = (k: KindInfo): number => Math.ceil(k.height - 1e-9);
