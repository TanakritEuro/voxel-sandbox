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
  /** Torches on a wall, by the side their wall is on: placed with the torch, never picked. */
  WallTorchNegX = 23,
  WallTorchPosX = 24,
  WallTorchNegZ = 25,
  WallTorchPosZ = 26,
  /** Flowing water, an eighth deep (1) to seven eighths (7), and falling water: made by the flow, never picked. */
  WaterFlow1 = 27,
  WaterFlow2 = 28,
  WaterFlow3 = 29,
  WaterFlow4 = 30,
  WaterFlow5 = 31,
  WaterFlow6 = 32,
  WaterFlow7 = 33,
  WaterFalling = 34,
  /**
   * Logic (Milestone 10). Copper wire by its power, 0–15 (35–50); the picker offers it at 0
   * (`wire`, `wirePower`).
   */
  Wire = 35,
  /** Switches and buttons, off and on; signal lamps, dark and lit; the charged block (always on). */
  Switch = 51,
  SwitchOn = 52,
  Button = 53,
  ButtonOn = 54,
  SignalLamp = 55,
  SignalLampOn = 56,
  ChargedBlock = 57,
  /** Inverters by facing (`FACINGS`), off and on (58–65): `inverter`, `gateOf`. */
  Inverter = 58,
  /** Delays by facing and setting (1–4 ticks), off and on (66–97): `delay`, `gateOf`. */
  Delay = 66,
  /** Furnaces by facing (`FACINGS`: the way the front looks), out and burning (98–105): `furnace`, `furnaceOf`. */
  Furnace = 98,
  /** Homes (Milestone 13). Chests by facing (106–109): `chest`, `chestOf`. */
  Chest = 106,
  /** Doors by facing (the way the player looked placing it), closed and open, lower and upper half (110–125): `door`, `doorOf`. */
  Door = 110,
  /** Beds by facing (the way the head points), foot and head (126–133): `bed`, `bedOf`. */
  Bed = 126,
  /** Tilled earth, for planting in. */
  Farmland = 134,
  /** Wheat by stage, 0 (just sown) to 7 (ripe) (135–142): `wheat`, `wheatStage`. */
  Wheat = 135,
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
  /**
   * A full cube, or a torch: a small stick standing on the block below, or leaning out from the
   * wall beside it (`wall`), never merged. Or a thin logic block standing on the block below:
   * wire (a 1/16 sheet), a switch, a button, or a gate's plate (1/8).
   */
  shape: 'cube' | 'torch' | 'wire' | 'switch' | 'button' | 'plate' | 'panel' | 'slab' | 'cross';
  /**
   * What a body bumps into when it isn't the whole block (a door's panel, a bed): from (x0, y0, z0)
   * to (x1, y1, z1) within the block, 0–1. Only for blocks that aren't passable.
   */
  box?: readonly [number, number, number, number, number, number];
  /** A wall torch's wall: the horizontal step from it to the block it hangs on. */
  wall?: { x: number; z: number };
  /** Offered by the block picker (wall torches aren't: they are the torch, placed on a wall). */
  pickable: boolean;
  /** Drawn in the transparent pass (sorted, blended). */
  transparent: boolean;
  /**
   * Drawn with holes (alpha-tested, in the opaque pass): its faces against the same block
   * are drawn too, so a canopy of leaves isn't hollow when seen through the holes.
   */
  cutout: boolean;
  /** Swum in, not walked on (water). */
  liquid: boolean;
  /** How deep a liquid is, from the block's bottom (1 full, level / 8 flowing); 0 for the rest. */
  liquidHeight: number;
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
  /** A front (a furnace's): its texture on the side facing `FACINGS[facing]`, in place of `textures.side`. */
  front?: { texture: TextureName; facing: number };
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
  pickable: true,
  transparent: false,
  cutout: false,
  liquid: false,
  liquidHeight: 0,
  hardness,
  light: 0,
  lightCost: 0,
  textures,
  top: hex(top),
  side: hex(side),
  bottom: hex(bottom),
});

/** A thin logic block (wire, switch, button, gate): walked through, broken in a click, standing on the block below. */
const thin = (name: string, shape: BlockInfo['shape'], textures: BlockInfo['textures'], colour: number, pickable: boolean): Omit<BlockInfo, 'sound'> => ({
  ...solid(name, 0.05, textures, colour),
  opaque: false,
  passable: true,
  shape,
  pickable,
});

/** Gates' facings: the way a gate passes its signal on (+x, -x, +z, -z). */
export const FACINGS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A door's panel and a bed's height, in blocks. */
export const PANEL = 3 / 16;
export const BED_HEIGHT = 1 / 2;

/**
 * The side of its block a door's panel is against (an index into `FACINGS`): closed, the side
 * nearest the player who placed it (looking along `facing`); open, swung a quarter turn about the
 * hinge on their left to the left side.
 */
export function doorSide(facing: number, open: boolean): number {
  const [fx, fz] = FACINGS[facing];
  if (!open) return facing ^ 1;
  // Left of (fx, fz), seen from above with y up: (fz, -fx).
  const lx = fz;
  const lz = -fx;
  return FACINGS.findIndex(([x, z]) => x === lx && z === lz);
}

/** A panel's box against side `side` (an index into `FACINGS`) of its block, the whole height. */
function panelBox(side: number): readonly [number, number, number, number, number, number] {
  const [sx, sz] = FACINGS[side];
  const x0 = sx > 0 ? 1 - PANEL : 0;
  const x1 = sx < 0 ? PANEL : 1;
  const z0 = sz > 0 ? 1 - PANEL : 0;
  const z1 = sz < 0 ? PANEL : 1;
  return [x0, 0, z0, x1, 1, z1];
}

/** Water: a source (the sea, lakes, water placed), and what flowing and falling water copy. */
const WATER: Omit<BlockInfo, 'sound'> = {
  ...solid('Water', Infinity, faces('water'), 0x3a78c9),
  opaque: false,
  passable: true,
  targetable: false,
  transparent: true,
  liquid: true,
  liquidHeight: 1,
  lightCost: 1,
};

const TABLE: readonly Omit<BlockInfo, 'sound'>[] = [
  // Never drawn; its textures are only there to fill the table.
  { ...solid('Air', 0, faces('stone'), 0), opaque: false, passable: true, targetable: false },
  solid('Stone', 2.5, faces('stone'), 0x8a8d91),
  solid('Dirt', 0.6, faces('dirt'), 0x86603e),
  solid('Grass', 0.7, faces('grass_top', 'grass_side', 'dirt'), 0x6aa84f, 0x7d7a45, 0x86603e),
  solid('Sand', 0.6, faces('sand'), 0xdccb8e),
  // Not a raycast target, so never broken.
  WATER,
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
  ...([
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const).map(([x, z]) => ({
    ...solid('Wall torch', 0.05, faces('torch_top', 'torch'), 0xffc24a, 0x7a5532),
    opaque: false,
    passable: true,
    shape: 'torch' as const,
    wall: { x, z },
    pickable: false,
    light: 14,
    icon: 'torch_item' as const,
  })),
  ...[1, 2, 3, 4, 5, 6, 7].map((level) => ({ ...WATER, pickable: false, liquidHeight: level / 8 })),
  { ...WATER, pickable: false },
  // Logic. Wire by power (its sides and top the same sheet).
  ...Array.from({ length: 16 }, (_, power) => ({
    ...thin('Copper wire', 'wire', faces(power ? 'wire_on' : 'wire_off'), power ? 0xe8893a : 0x8a5a32, power === 0),
    icon: 'wire_item' as const,
  })),
  // A switch: its base (top) and handle (side) textures.
  { ...thin('Switch', 'switch', faces('copper_plate', 'switch_handle'), 0xb87333, true), icon: 'switch_item' as const },
  { ...thin('Switch', 'switch', faces('copper_plate', 'switch_handle_on'), 0xb87333, false), icon: 'switch_item' as const },
  { ...thin('Button', 'button', faces('copper_plate'), 0xb87333, true), icon: 'button_item' as const },
  { ...thin('Button', 'button', faces('copper_plate'), 0xb87333, false), icon: 'button_item' as const },
  { ...solid('Signal lamp', 0.6, faces('signal_lamp'), 0x6a5a48), pickable: true },
  { ...solid('Signal lamp', 0.6, faces('signal_lamp_on'), 0xffc070), pickable: false, light: 15 },
  solid('Charged block', 1.5, faces('charged'), 0xd0703a),
  // Gates: their tops by state (the plate's edges copper), each facing off and on.
  ...FACINGS.flatMap((_, facing) =>
    [false, true].map((on) => ({ ...thin('Inverter', 'plate', faces(on ? 'inverter_on' : 'inverter', 'copper_plate'), 0xb87333, facing === 0 && !on), icon: 'inverter' as const })),
  ),
  ...FACINGS.flatMap((_, facing) =>
    ([1, 2, 3, 4] as const).flatMap((setting) =>
      [false, true].map((on) => ({
        ...thin('Delay', 'plate', faces(`delay_${setting}${on ? '_on' : ''}` as TextureName, 'copper_plate'), 0xb87333, facing === 0 && setting === 1 && !on),
        icon: 'delay_1' as const,
      })),
    ),
  ),
  // Furnaces: stone brick sides and top, the front by facing, out and burning (giving light).
  ...FACINGS.flatMap((_, facing) =>
    [false, true].map((lit) => ({
      ...solid('Furnace', 3.5, faces('furnace_top', 'furnace_side', 'furnace_top'), 0x77797c),
      pickable: facing === 0 && !lit,
      light: lit ? 13 : 0,
      front: { texture: lit ? ('furnace_front_lit' as const) : ('furnace_front' as const), facing },
    })),
  ),
  // Chests: boards and a latch on the front, facing the player who placed it.
  ...FACINGS.map((_, facing) => ({
    ...solid('Chest', 2.5, faces('chest_top', 'chest_side', 'chest_top'), 0x9a6a3a),
    pickable: facing === 0,
    front: { texture: 'chest_front' as const, facing },
  })),
  // Doors: a panel against one side of the block, the side by facing and whether it's open.
  ...FACINGS.flatMap((_, facing) =>
    [false, true].flatMap((open) =>
      [false, true].map((upper) => ({
        ...solid('Door', 3, faces(upper ? 'door_upper' : 'door_lower'), 0xa67c4a),
        opaque: false,
        shape: 'panel' as const,
        box: panelBox(doorSide(facing, open)),
        pickable: facing === 0 && !open && !upper,
        icon: 'door_item' as const,
      })),
    ),
  ),
  // Beds: half a block high, a blanket over the foot and a pillow at the head.
  ...FACINGS.flatMap((_, facing) =>
    [false, true].map((head) => ({
      ...solid('Bed', 0.4, faces(head ? 'bed_head' : 'bed_foot', 'bed_side', 'planks'), 0xb04a3a),
      opaque: false,
      shape: 'slab' as const,
      box: [0, 0, 0, 1, BED_HEIGHT, 1] as const,
      pickable: facing === 0 && !head,
      icon: 'bed_item' as const,
    })),
  ),
  { ...solid('Farmland', 0.6, faces('farmland', 'dirt'), 0x5e4126, 0x86603e), pickable: false },
  // Wheat: two crossed sheets, growing taller and turning gold.
  ...Array.from({ length: 8 }, (_, stage) => ({
    ...solid('Wheat', 0.05, faces(`wheat_${stage}` as TextureName), stage < 7 ? 0x6aa84f : 0xd8b54a),
    opaque: false,
    passable: true,
    shape: 'cross' as const,
    cutout: true,
    pickable: false,
  })),
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
  [Block.WallTorchNegX]: 'wood',
  [Block.WallTorchPosX]: 'wood',
  [Block.WallTorchNegZ]: 'wood',
  [Block.WallTorchPosZ]: 'wood',
  [Block.WaterFlow1]: 'water',
  [Block.WaterFlow2]: 'water',
  [Block.WaterFlow3]: 'water',
  [Block.WaterFlow4]: 'water',
  [Block.WaterFlow5]: 'water',
  [Block.WaterFlow6]: 'water',
  [Block.WaterFlow7]: 'water',
  [Block.WaterFalling]: 'water',
  [Block.Switch]: 'wood',
  [Block.SwitchOn]: 'wood',
  [Block.Button]: 'wood',
  [Block.ButtonOn]: 'wood',
  [Block.SignalLamp]: 'glass',
  [Block.SignalLampOn]: 'glass',
  [Block.Farmland]: 'dirt',
};
for (let b = Block.Chest; b < Block.Farmland; b++) SOUNDS[b as Block] = 'wood';
for (let b = Block.Wheat; b < Block.Wheat + 8; b++) SOUNDS[b as Block] = 'leaves';

export const BLOCKS: readonly BlockInfo[] = TABLE.map((info, b) => ({ ...info, sound: SOUNDS[b as Block] ?? 'stone' }));

/** Every block the creative picker offers: all but air, wall torches and moving water, in id order. */
export const PLACEABLE: readonly Block[] = BLOCKS.map((_, b) => b as Block).filter((b) => b !== Block.Air && BLOCKS[b].pickable);

/**
 * The torch block to place against the face of a block whose normal is (nx, ny, nz): a floor
 * torch on a top, a wall torch on a side (its wall the block clicked), none under a ceiling.
 */
export function torchFor(nx: number, ny: number, nz: number): Block | null {
  if (ny > 0) return Block.Torch;
  if (ny < 0) return null;
  return nx < 0 ? Block.WallTorchPosX : nx > 0 ? Block.WallTorchNegX : nz < 0 ? Block.WallTorchPosZ : Block.WallTorchNegZ;
}

/**
 * For a torch, the step to the block holding it up (below, or its wall); for a thin logic block,
 * the block below; null for other blocks.
 */
export function torchSupport(block: Block): [number, number, number] | null {
  const info = BLOCKS[block];
  if (info.shape === 'cube') return null;
  return info.wall ? [info.wall.x, 0, info.wall.z] : [0, -1, 0];
}

/** Is `block` a torch, on a floor or a wall? */
export const isTorch = (block: Block): boolean => BLOCKS[block].shape === 'torch';

// --- Logic blocks ----------------------------------------------------------------------------

/** Copper wire at `power` (0–15). */
export const wire = (power: number): Block => (Block.Wire + power) as Block;

/** A wire's power (0–15), or -1 if `block` isn't wire. */
export const wirePower = (block: Block): number => (block >= Block.Wire && block <= Block.Wire + 15 ? block - Block.Wire : -1);

/** An inverter facing `facing` (an index into `FACINGS`), off or on. */
export const inverter = (facing: number, on: boolean): Block => (Block.Inverter + facing * 2 + (on ? 1 : 0)) as Block;

/** A delay facing `facing`, set to `setting` ticks (1–4), off or on. */
export const delay = (facing: number, setting: number, on: boolean): Block => (Block.Delay + (facing * 4 + setting - 1) * 2 + (on ? 1 : 0)) as Block;

/** A gate: which, the way it faces (an index into `FACINGS`), on or off, and a delay's setting (1 for an inverter). */
export interface Gate {
  kind: 'inverter' | 'delay';
  facing: number;
  on: boolean;
  setting: number;
}

/** What gate `block` is, or null if it isn't one. */
export function gateOf(block: Block): Gate | null {
  if (block >= Block.Inverter && block < Block.Delay) {
    const n = block - Block.Inverter;
    return { kind: 'inverter', facing: n >> 1, on: (n & 1) === 1, setting: 1 };
  }
  if (block >= Block.Delay && block < Block.Delay + 32) {
    const n = block - Block.Delay;
    return { kind: 'delay', facing: n >> 3, on: (n & 1) === 1, setting: ((n >> 1) & 3) + 1 };
  }
  return null;
}

/** The facing (an index into `FACINGS`) nearest the way a player looking along `yaw` faces. */
export function facingFromYaw(yaw: number): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return Math.abs(fx) >= Math.abs(fz) ? (fx > 0 ? 0 : 1) : fz > 0 ? 2 : 3;
}

/** Is `block` a thin logic block, standing on the block below it? */
export const isThinLogic = (block: Block): boolean => {
  const s = BLOCKS[block].shape;
  return s === 'wire' || s === 'switch' || s === 'button' || s === 'plate';
};

/** A furnace facing `facing` (`FACINGS`), burning or not. */
export const furnace = (facing: number, lit: boolean): Block => (Block.Furnace + facing * 2 + (lit ? 1 : 0)) as Block;

/** A furnace's facing and whether it burns; null for any other block. */
export function furnaceOf(block: Block): { facing: number; lit: boolean } | null {
  const i = block - Block.Furnace;
  return i >= 0 && i < 8 ? { facing: i >> 1, lit: (i & 1) === 1 } : null;
}

// --- Homes ------------------------------------------------------------------------------------

/** A chest facing `facing` (`FACINGS`: the way its front looks). */
export const chest = (facing: number): Block => (Block.Chest + facing) as Block;

/** A chest's facing; null for any other block. */
export function chestOf(block: Block): { facing: number } | null {
  const i = block - Block.Chest;
  return i >= 0 && i < 4 ? { facing: i } : null;
}

/** A door placed by a player looking along `facing`, open or closed, its lower or upper half. */
export const door = (facing: number, open: boolean, upper: boolean): Block => (Block.Door + facing * 4 + (open ? 2 : 0) + (upper ? 1 : 0)) as Block;

/** A door half's facing, whether it's open, and which half; null for any other block. */
export function doorOf(block: Block): { facing: number; open: boolean; upper: boolean } | null {
  const i = block - Block.Door;
  return i >= 0 && i < 16 ? { facing: i >> 2, open: (i & 2) !== 0, upper: (i & 1) !== 0 } : null;
}

/** A bed whose head points along `facing`: its foot or its head. */
export const bed = (facing: number, head: boolean): Block => (Block.Bed + facing * 2 + (head ? 1 : 0)) as Block;

/** A bed half's facing (the way the head points) and which half; null for any other block. */
export function bedOf(block: Block): { facing: number; head: boolean } | null {
  const i = block - Block.Bed;
  return i >= 0 && i < 8 ? { facing: i >> 1, head: (i & 1) === 1 } : null;
}

/** Wheat at `stage` (0 sown, 7 ripe). */
export const wheat = (stage: number): Block => (Block.Wheat + stage) as Block;

/** Wheat's stage, or -1 for any other block. */
export const wheatStage = (block: Block): number => (block >= Block.Wheat && block < Block.Wheat + 8 ? block - Block.Wheat : -1);

/**
 * The block to place for `block` from the hotbar against a face whose normal is (nx, ny, nz), by a
 * player looking along `yaw`: thin logic blocks only on a top, a gate facing the way the player
 * looks; a furnace or chest with its front to the player; null where it can't go. Anything else as
 * it is (doors and beds, two blocks each, are placed by `world/parts.ts`).
 */
export function logicPlacement(block: Block, ny: number, yaw: number): Block | null {
  // Its front towards the player: the opposite of the way they look (facings come in pairs).
  if (furnaceOf(block)) return furnace(facingFromYaw(yaw) ^ 1, false);
  if (chestOf(block)) return chest(facingFromYaw(yaw) ^ 1);
  if (!isThinLogic(block)) return block;
  if (ny <= 0) return null;
  const gate = gateOf(block);
  if (!gate) return block;
  const facing = facingFromYaw(yaw);
  return gate.kind === 'inverter' ? inverter(facing, false) : delay(facing, 1, false);
}

/**
 * What a right click on `block` makes of it: a switch flipped, a button pressed (a pressed one
 * stays as it is), a delay's setting the next one round, a door's half opened or shut; null if it
 * isn't something to use.
 */
export function useBlock(block: Block): Block | null {
  if (block === Block.Switch) return Block.SwitchOn;
  if (block === Block.SwitchOn) return Block.Switch;
  if (block === Block.Button || block === Block.ButtonOn) return Block.ButtonOn;
  const gate = gateOf(block);
  if (gate?.kind === 'delay') return delay(gate.facing, (gate.setting % 4) + 1, gate.on);
  // A door's half opened or closed (its other half with it: `useAt` in world/parts.ts).
  const d = doorOf(block);
  if (d) return door(d.facing, !d.open, d.upper);
  return null;
}

/** The hotbar a new world starts with (keys 1–9); the picker changes it, per world. */
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

/**
 * A world's hotbar from its record: nine placeable blocks. Anything else in a slot (a record
 * from before the picker, a block id that doesn't exist, air) gets the default for that slot.
 */
export function hotbarFrom(saved: unknown): Block[] {
  const list = Array.isArray(saved) ? saved : [];
  return HOTBAR.map((fallback, i) => {
    const b: unknown = list[i];
    return typeof b === 'number' && PLACEABLE.includes(b as Block) ? (b as Block) : fallback;
  });
}
