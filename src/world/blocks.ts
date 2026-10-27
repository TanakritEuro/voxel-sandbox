// Block types. A block is one byte in a chunk; 0 is air.
//
// Each block names a texture for its top, sides and bottom (`textures.ts` makes them), which
// is what grass needs. The plain colours are each face's average look, kept for the
// reference mesher and anything that wants a block's colour without its texture.

import type { TextureName } from './textures';

export enum Block {
  Air = 0,
  Stone = 1,
  Dirt = 2,
  Grass = 3,
  Sand = 4,
  Water = 5,
  Wood = 6,
  Leaves = 7,
  Planks = 8,
  Glass = 9,
  Snow = 10,
  SnowyGrass = 11,
  Sandstone = 12,
  Gravel = 13,
  CoalOre = 14,
  IronOre = 15,
  CopperOre = 16,
  CrystalOre = 17,
  SpruceWood = 18,
  SpruceLeaves = 19,
  Cactus = 20,
  Torch = 21,
  Lamp = 22,
}

type RGB = [number, number, number];

/** What a block sounds like underfoot, dug, broken and placed (`audio/sound.ts` has a recipe for each). */
export type BlockSound = 'stone' | 'dirt' | 'grass' | 'sand' | 'gravel' | 'snow' | 'wood' | 'leaves' | 'glass' | 'water';

export interface BlockInfo {
  name: string;
  /** Opaque blocks hide the faces of whatever is next to them. */
  opaque: boolean;
  /** Can be walked through (air, water, torches). */
  passable: boolean;
  /** The raycast stops at it, so it can be broken and built against (not air or water). */
  targetable: boolean;
  /** A full cube, or a torch: a small stick standing on the block below, never merged. */
  shape: 'cube' | 'torch';
  /** Drawn in the transparent pass (sorted, blended). */
  transparent: boolean;
  /**
   * Drawn with holes (alpha-tested, in the opaque pass): its faces against the same block
   * are drawn too, so a canopy of leaves isn't hollow when seen through the holes.
   */
  cutout: boolean;
  /** Swum in, not walked on (water). */
  liquid: boolean;
  /** Seconds of holding the button to break it (by hand; there are no tools). */
  hardness: number;
  /** Light it gives, 0–15 (`light.ts`). */
  light: number;
  /**
   * Extra light lost passing through it, beyond the 1 every step costs (leaves and water: 1,
   * so forests are shaded and deep water is dark). Opaque blocks stop light whatever this is.
   */
  lightCost: number;
  textures: { top: TextureName; side: TextureName; bottom: TextureName };
  /** The hotbar icon, if not the side texture. */
  icon?: TextureName;
  sound: BlockSound;
  /** RGB 0–1 for the top, sides and bottom. */
  top: RGB;
  side: RGB;
  bottom: RGB;
}

const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const faces = (top: TextureName, side = top, bottom = side) => ({ top, side, bottom });
const solid = (name: string, hardness: number, textures: BlockInfo['textures'], top: number, side = top, bottom = side): Omit<BlockInfo, 'sound'> => ({
  name,
  opaque: true,
  passable: false,
  targetable: true,
  shape: 'cube',
  transparent: false,
  cutout: false,
  liquid: false,
  hardness,
  light: 0,
  lightCost: 0,
  textures,
  top: hex(top),
  side: hex(side),
  bottom: hex(bottom),
});

const TABLE: readonly Omit<BlockInfo, 'sound'>[] = [
  // Never drawn; its textures are only there to fill the table.
  { ...solid('Air', 0, faces('stone'), 0), opaque: false, passable: true, targetable: false },
  solid('Stone', 2.5, faces('stone'), 0x8a8d91),
  solid('Dirt', 0.6, faces('dirt'), 0x86603e),
  solid('Grass', 0.7, faces('grass_top', 'grass_side', 'dirt'), 0x6aa84f, 0x7d7a45, 0x86603e),
  solid('Sand', 0.6, faces('sand'), 0xdccb8e),
  // Not a raycast target, so never broken.
  { ...solid('Water', Infinity, faces('water'), 0x3a78c9), opaque: false, passable: true, targetable: false, transparent: true, liquid: true, lightCost: 1 },
  solid('Wood', 1.5, faces('wood_top', 'wood_side'), 0xa7854f, 0x6b4a2b),
  { ...solid('Leaves', 0.3, faces('leaves'), 0x3f8a36), opaque: false, cutout: true, lightCost: 1 },
  solid('Planks', 1.5, faces('planks'), 0xb88c55),
  { ...solid('Glass', 0.4, faces('glass'), 0xcfe8f2), opaque: false, transparent: true },
  solid('Snow', 0.4, faces('snow'), 0xeef3f7),
  solid('Snowy grass', 0.7, faces('snow', 'snowy_grass_side', 'dirt'), 0xeef3f7, 0xa99886, 0x86603e),
  solid('Sandstone', 1.2, faces('sandstone_top', 'sandstone_side'), 0xd3bf86),
  solid('Gravel', 0.7, faces('gravel'), 0x8d8680),
  solid('Coal ore', 3, faces('coal_ore'), 0x6d6f72),
  solid('Iron ore', 3.5, faces('iron_ore'), 0x958a80),
  solid('Copper ore', 3, faces('copper_ore'), 0x8f8577),
  { ...solid('Crystal ore', 4.5, faces('crystal_ore'), 0x8aa3ab), light: 6 },
  solid('Spruce wood', 1.5, faces('spruce_top', 'spruce_side'), 0x7a5a38, 0x3f2c1c),
  { ...solid('Spruce leaves', 0.3, faces('spruce_leaves'), 0x2f5f3a), opaque: false, cutout: true, lightCost: 1 },
  solid('Cactus', 0.4, faces('cactus_top', 'cactus_side'), 0x5c9a3c, 0x4f8a33),
  {
    ...solid('Torch', 0.05, faces('torch_top', 'torch'), 0xffc24a, 0x7a5532),
    opaque: false,
    passable: true,
    shape: 'torch',
    light: 14,
    icon: 'torch_item',
  },
  { ...solid('Lamp', 0.6, faces('lamp'), 0xe8c070), light: 15 },
];

/** Each block's sound; stone (and the ores, sandstone) unless listed. */
const SOUNDS: Partial<Record<Block, BlockSound>> = {
  [Block.Dirt]: 'dirt',
  [Block.Grass]: 'grass',
  [Block.Sand]: 'sand',
  [Block.Water]: 'water',
  [Block.Wood]: 'wood',
  [Block.Leaves]: 'leaves',
  [Block.Planks]: 'wood',
  [Block.Glass]: 'glass',
  [Block.Snow]: 'snow',
  [Block.SnowyGrass]: 'snow',
  [Block.Gravel]: 'gravel',
  [Block.SpruceWood]: 'wood',
  [Block.SpruceLeaves]: 'leaves',
  [Block.Cactus]: 'leaves',
  [Block.Torch]: 'wood',
  [Block.Lamp]: 'glass',
};

export const BLOCKS: readonly BlockInfo[] = TABLE.map((info, b) => ({ ...info, sound: SOUNDS[b as Block] ?? 'stone' }));

/** Blocks the player can place, in hotbar order (keys 1–9). */
export const HOTBAR: readonly Block[] = [
  Block.Grass,
  Block.Dirt,
  Block.Stone,
  Block.Torch,
  Block.Planks,
  Block.Wood,
  Block.Lamp,
  Block.Glass,
  Block.Water,
];
