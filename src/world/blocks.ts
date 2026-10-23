// Block types. A block is one byte in a chunk; 0 is air.
//
// Colours are placeholders (one colour per face group). Milestone 2 replaces them with a
// texture atlas; keep the per-face idea (top / side / bottom), it's what grass needs.

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
}

export interface BlockInfo {
  name: string;
  /** Opaque blocks hide the faces of whatever is next to them. */
  opaque: boolean;
  /** Can be walked through and is not a raycast target (air, water). */
  passable: boolean;
  /** Drawn in the transparent pass (sorted, blended). */
  transparent: boolean;
  /** Swum in, not walked on (water). */
  liquid: boolean;
  /** Seconds of holding the button to break it (by hand; there are no tools). */
  hardness: number;
  /** RGB 0–1 for the top, sides and bottom. */
  top: [number, number, number];
  side: [number, number, number];
  bottom: [number, number, number];
}

const hex = (h: number): [number, number, number] => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const solid = (name: string, hardness: number, top: number, side = top, bottom = side): BlockInfo => ({
  name,
  opaque: true,
  passable: false,
  transparent: false,
  liquid: false,
  hardness,
  top: hex(top),
  side: hex(side),
  bottom: hex(bottom),
});

export const BLOCKS: readonly BlockInfo[] = [
  { name: 'Air', opaque: false, passable: true, transparent: false, liquid: false, hardness: 0, top: [0, 0, 0], side: [0, 0, 0], bottom: [0, 0, 0] },
  solid('Stone', 2.5, 0x8a8d91),
  solid('Dirt', 0.6, 0x86603e),
  solid('Grass', 0.7, 0x6aa84f, 0x7d7a45, 0x86603e),
  solid('Sand', 0.6, 0xdccb8e),
  // Not a raycast target, so never broken.
  { name: 'Water', opaque: false, passable: true, transparent: true, liquid: true, hardness: Infinity, top: hex(0x3a78c9), side: hex(0x3a78c9), bottom: hex(0x3a78c9) },
  solid('Wood', 1.5, 0xa7854f, 0x6b4a2b),
  { ...solid('Leaves', 0.3, 0x3f8a36), opaque: false },
  solid('Planks', 1.5, 0xb88c55),
  { ...solid('Glass', 0.4, 0xcfe8f2), opaque: false, transparent: true },
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
