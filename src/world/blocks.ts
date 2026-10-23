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
}

type RGB = [number, number, number];

export interface BlockInfo {
  name: string;
  /** Opaque blocks hide the faces of whatever is next to them. */
  opaque: boolean;
  /** Can be walked through and is not a raycast target (air, water). */
  passable: boolean;
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
  /** RGB 0–1 for the top, sides and bottom. */
  top: RGB;
  side: RGB;
  bottom: RGB;
}

const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const faces = (top: TextureName, side = top, bottom = side) => ({ top, side, bottom });
const solid = (name: string, hardness: number, textures: BlockInfo['textures'], top: number, side = top, bottom = side): BlockInfo => ({
  name,
  opaque: true,
  passable: false,
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

export const BLOCKS: readonly BlockInfo[] = [
  // Never drawn; its textures are only there to fill the table.
  { ...solid('Air', 0, faces('stone'), 0), opaque: false, passable: true },
  solid('Stone', 2.5, faces('stone'), 0x8a8d91),
  solid('Dirt', 0.6, faces('dirt'), 0x86603e),
  solid('Grass', 0.7, faces('grass_top', 'grass_side', 'dirt'), 0x6aa84f, 0x7d7a45, 0x86603e),
  solid('Sand', 0.6, faces('sand'), 0xdccb8e),
  // Not a raycast target, so never broken.
  { ...solid('Water', Infinity, faces('water'), 0x3a78c9), opaque: false, passable: true, transparent: true, liquid: true, lightCost: 1 },
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
];

/** Blocks the player can place, in hotbar order (keys 1–9). */
export const HOTBAR: readonly Block[] = [
  Block.Grass,
  Block.Dirt,
  Block.Stone,
  Block.Sand,
  Block.Planks,
  Block.Wood,
  Block.Leaves,
  Block.Glass,
  Block.Water,
];
