// Block textures, made by code at startup: 16 × 16 pixel art, one layer of a texture array
// each. Pure (typed arrays out, no DOM or Three.js), so they're tested headless and the
// mesher can look up layer numbers in a worker. All looks are invented: seeded noise,
// speckles, stripes and rings, nothing copied.

import { createRng, type Rng } from '../math';

export const TEXTURE_SIZE = 16;
const AREA = TEXTURE_SIZE * TEXTURE_SIZE;

/** Layers of the texture array, in order. Block faces name these in `BLOCKS[b].textures`. */
export const TEXTURE_NAMES = [
  'stone',
  'dirt',
  'grass_top',
  'grass_side',
  'sand',
  'water',
  'wood_side',
  'wood_top',
  'leaves',
  'planks',
  'glass',
  'snow',
  'snowy_grass_side',
  'sandstone_top',
  'sandstone_side',
  'gravel',
  'coal_ore',
  'iron_ore',
  'copper_ore',
  'crystal_ore',
  'spruce_side',
  'spruce_top',
  'spruce_leaves',
  'cactus_side',
  'cactus_top',
  'torch',
  'torch_top',
  'torch_item',
  'lamp',
  // Logic (Milestone 10).
  'copper_plate',
  'wire_off',
  'wire_on',
  'wire_item',
  'switch_handle',
  'switch_handle_on',
  'switch_item',
  'button_item',
  'signal_lamp',
  'signal_lamp_on',
  'charged',
  'inverter',
  'inverter_on',
  'delay_1',
  'delay_2',
  'delay_3',
  'delay_4',
  'delay_1_on',
  'delay_2_on',
  'delay_3_on',
  'delay_4_on',
  // Survival (Milestone 12).
  'furnace_side',
  'furnace_top',
  'furnace_front',
  'furnace_front_lit',
] as const;
export type TextureName = (typeof TEXTURE_NAMES)[number];

export const textureLayer = (name: TextureName): number => TEXTURE_NAMES.indexOf(name);

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** One 16 × 16 RGBA layer being painted. Row 0 is the top of the image. */
class Canvas {
  constructor(
    readonly data: Uint8Array,
    readonly rng: Rng,
  ) {}

  set(x: number, y: number, [r, g, b]: RGB, brightness = 1, alpha = 255): void {
    const i = ((y & 15) * TEXTURE_SIZE + (x & 15)) * 4;
    this.data[i] = clampByte(r * brightness);
    this.data[i + 1] = clampByte(g * brightness);
    this.data[i + 2] = clampByte(b * brightness);
    this.data[i + 3] = alpha;
  }

  /** Every pixel the colour, each a little lighter or darker (`variation` 0.2 = ±10 %). */
  speckle(colour: RGB, variation: number, alpha = 255): void {
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) this.set(x, y, colour, 1 + (this.rng() - 0.5) * variation, alpha);
  }

  /** `count` small clusters of 1–3 pixels in a colour. */
  spots(count: number, colour: RGB, variation = 0.1): void {
    for (let n = 0; n < count; n++) {
      const x = Math.floor(this.rng() * TEXTURE_SIZE);
      const y = Math.floor(this.rng() * TEXTURE_SIZE);
      const size = 1 + Math.floor(this.rng() * 3);
      for (let k = 0; k < size; k++) this.set(x + (k === 1 ? 1 : 0), y + (k === 2 ? 1 : 0), colour, 1 + (this.rng() - 0.5) * variation);
    }
  }
}

const STONE = hex(0x8a8d91);
const DIRT = hex(0x86603e);
const GRASS = hex(0x6aa84f);
const SAND = hex(0xdccb8e);
const BARK = hex(0x6b4a2b);
const WOOD = hex(0xa7854f);
const LEAVES = hex(0x3f8a36);
const PLANKS = hex(0xb88c55);
const SNOW = hex(0xeef3f7);
const SPRUCE_BARK = hex(0x3f2c1c);
const CACTUS = hex(0x4f8a33);
const SANDSTONE = hex(0xd3bf86);
const FLAME = hex(0xffc24a);
const FLAME_CORE = hex(0xfff2b0);
const STICK = hex(0x7a5532);
const COPPER = hex(0xb87333);
const COPPER_DARK = hex(0x6e3f1c);
const BOARD = hex(0x3a2c24);
const LIT = hex(0xffa848);
const LIT_CORE = hex(0xfff0c0);

/** A gate's plate: copper with a darker rim, an arrow up the middle (towards row 0: the way the gate faces), lit when on. */
function gatePlate(c: Canvas, on: boolean): void {
  for (let y = 0; y < TEXTURE_SIZE; y++)
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const rim = x === 0 || y === 0 || x === TEXTURE_SIZE - 1 || y === TEXTURE_SIZE - 1;
      c.set(x, y, rim ? COPPER_DARK : COPPER, 1 + (c.rng() - 0.5) * 0.12);
    }
  const ink = on ? LIT : BOARD;
  for (let y = 3; y < 13; y++) for (const x of [7, 8]) c.set(x, y, ink);
  for (let k = 1; k <= 3; k++) for (const x of [7 - k, 8 + k]) c.set(x, 2 + k, ink);
}

/** A delay: the gate's arrow and `setting` dots beside it. */
function delayPlate(c: Canvas, setting: number, on: boolean): void {
  gatePlate(c, on);
  for (let n = 0; n < setting; n++) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.set(11 + dx, 11 - n * 3 + dy, on ? LIT_CORE : COPPER_DARK);
}

/** A copper trace board: dark, a cross of copper through the middle (wire joins every way). */
function traces(c: Canvas, on: boolean): void {
  c.speckle(on ? hex(0x5a3a28) : BOARD, 0.15);
  const line = on ? LIT : COPPER;
  for (let i = 0; i < TEXTURE_SIZE; i++)
    for (const j of [7, 8]) {
      c.set(i, j, line, 1 + (c.rng() - 0.5) * 0.1);
      c.set(j, i, line, 1 + (c.rng() - 0.5) * 0.1);
    }
  if (on) for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) c.set(x, y, LIT_CORE);
}

const PAINTERS: Record<TextureName, (c: Canvas) => void> = {
  stone(c) {
    c.speckle(STONE, 0.18);
    c.spots(9, hex(0x6f7276));
    c.spots(5, hex(0xa2a5a9));
  },
  dirt(c) {
    c.speckle(DIRT, 0.25);
    c.spots(8, hex(0x6c4b2e));
    c.spots(4, hex(0x9c7a58));
  },
  grass_top(c) {
    c.speckle(GRASS, 0.28);
    c.spots(10, hex(0x5a9343));
    c.spots(6, hex(0x7cbc5f));
  },
  grass_side(c) {
    PAINTERS.dirt(c);
    // Grass over the top edge, hanging down unevenly.
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const depth = 3 + (c.rng() < 0.55 ? 1 : 0) + (c.rng() < 0.2 ? 1 : 0);
      for (let y = 0; y < depth; y++) c.set(x, y, GRASS, 1 + (c.rng() - 0.5) * 0.28);
    }
  },
  sand(c) {
    c.speckle(SAND, 0.1);
    c.spots(7, hex(0xc7b67a));
    c.spots(4, hex(0xebdcaa));
  },
  water(c) {
    c.speckle(hex(0x3a78c9), 0.12, 185);
    // Light ripples: short horizontal streaks.
    for (let n = 0; n < 7; n++) {
      const x = Math.floor(c.rng() * TEXTURE_SIZE);
      const y = Math.floor(c.rng() * TEXTURE_SIZE);
      const length = 2 + Math.floor(c.rng() * 4);
      for (let k = 0; k < length; k++) c.set(x + k, y, hex(0x6f9fe0), 1, 200);
    }
  },
  wood_side(c) {
    // Bark: vertical stripes, each column its own shade, with darker cracks.
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const column = 0.85 + c.rng() * 0.3;
      for (let y = 0; y < TEXTURE_SIZE; y++) c.set(x, y, BARK, column * (1 + (c.rng() - 0.5) * 0.12));
    }
    for (let n = 0; n < 5; n++) {
      const x = Math.floor(c.rng() * TEXTURE_SIZE);
      const y = Math.floor(c.rng() * TEXTURE_SIZE);
      const length = 2 + Math.floor(c.rng() * 4);
      for (let k = 0; k < length; k++) c.set(x, y + k, BARK, 0.65);
    }
  },
  wood_top(c) {
    // Growth rings round the middle, bark round the edge.
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const edge = x === 0 || y === 0 || x === TEXTURE_SIZE - 1 || y === TEXTURE_SIZE - 1;
        const ring = Math.floor(Math.hypot(x - 7.5, y - 7.5) * 1.1) % 2;
        c.set(x, y, edge ? BARK : WOOD, (edge ? 1 : ring ? 0.86 : 1.04) * (1 + (c.rng() - 0.5) * 0.08));
      }
  },
  leaves(c) {
    // About a third of the pixels are holes (alpha 0): alpha-tested, you see through them.
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        if (c.rng() < 0.32) c.set(x, y, LEAVES, 0.5, 0);
        else c.set(x, y, LEAVES, 1 + (c.rng() - 0.5) * 0.45);
      }
  },
  planks(c) {
    // Four boards, each its own shade, a dark seam under each and a staggered end joint.
    for (let board = 0; board < 4; board++) {
      const shade = 0.9 + c.rng() * 0.2;
      const joint = Math.floor(c.rng() * TEXTURE_SIZE);
      for (let row = 0; row < 4; row++) {
        const y = board * 4 + row;
        for (let x = 0; x < TEXTURE_SIZE; x++) {
          const seam = row === 3 || x === joint;
          c.set(x, y, PLANKS, (seam ? 0.7 : shade) * (1 + (c.rng() - 0.5) * 0.1));
        }
      }
    }
  },
  snow(c) {
    c.speckle(SNOW, 0.06);
    c.spots(6, hex(0xd8e3ee));
  },
  snowy_grass_side(c) {
    PAINTERS.dirt(c);
    // Snow over the top edge, a little ragged.
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const depth = 3 + (c.rng() < 0.4 ? 1 : 0);
      for (let y = 0; y < depth; y++) c.set(x, y, SNOW, 1 + (c.rng() - 0.5) * 0.06);
    }
  },
  sandstone_top(c) {
    c.speckle(SANDSTONE, 0.08);
    c.spots(5, hex(0xc2ad74));
  },
  sandstone_side(c) {
    // Layers: bands of slightly different shades, a darker line between them.
    const bands = [0, 4, 9, 13];
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      const band = bands.filter((b) => b <= y).length;
      const line = bands.includes(y) && y > 0;
      for (let x = 0; x < TEXTURE_SIZE; x++) c.set(x, y, SANDSTONE, (line ? 0.82 : 0.94 + band * 0.03) * (1 + (c.rng() - 0.5) * 0.06));
    }
  },
  gravel(c) {
    // Pebbles: grey stones of several shades, small dark gaps.
    c.speckle(hex(0x8d8680), 0.3);
    c.spots(10, hex(0x6b6560));
    c.spots(10, hex(0xa8a19a));
    c.spots(6, hex(0x5a5550));
  },
  coal_ore(c) {
    ore(c, [hex(0x232323), hex(0x3a3a3a)]);
  },
  iron_ore(c) {
    ore(c, [hex(0xc99b7a), hex(0xe0b896)]);
  },
  copper_ore(c) {
    ore(c, [hex(0xc96b32), hex(0x4fa38c)]);
  },
  crystal_ore(c) {
    ore(c, [hex(0x5fe3f2), hex(0xb8f6ff)]);
  },
  spruce_side(c) {
    // Darker bark than oak, with finer vertical grooves.
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const column = x % 3 === 0 ? 0.75 : 0.95 + c.rng() * 0.15;
      for (let y = 0; y < TEXTURE_SIZE; y++) c.set(x, y, SPRUCE_BARK, column * (1 + (c.rng() - 0.5) * 0.12));
    }
  },
  spruce_top(c) {
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const edge = x === 0 || y === 0 || x === TEXTURE_SIZE - 1 || y === TEXTURE_SIZE - 1;
        const ring = Math.floor(Math.hypot(x - 7.5, y - 7.5) * 1.4) % 2;
        c.set(x, y, edge ? SPRUCE_BARK : hex(0x7a5a38), (edge ? 1 : ring ? 0.85 : 1.03) * (1 + (c.rng() - 0.5) * 0.08));
      }
  },
  spruce_leaves(c) {
    // Needles: dark, denser than oak leaves (fewer holes), with short light strokes.
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        if (c.rng() < 0.24) c.set(x, y, hex(0x2f5f3a), 0.5, 0);
        else c.set(x, y, hex(0x2f5f3a), 1 + (c.rng() - 0.5) * 0.4);
      }
    for (let n = 0; n < 8; n++) {
      const x = Math.floor(c.rng() * TEXTURE_SIZE);
      const y = Math.floor(c.rng() * TEXTURE_SIZE);
      c.set(x, y, hex(0x4c8a55));
      c.set(x + 1, y + 1, hex(0x4c8a55));
    }
  },
  cactus_side(c) {
    // Ribs down the sides, pale spines along them.
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const rib = x % 4 === 1 ? 1.12 : x % 4 === 3 ? 0.82 : 1;
      for (let y = 0; y < TEXTURE_SIZE; y++) c.set(x, y, CACTUS, rib * (1 + (c.rng() - 0.5) * 0.1));
    }
    for (let y = 2; y < TEXTURE_SIZE; y += 4) for (let x = 1; x < TEXTURE_SIZE; x += 4) c.set(x, y + (x % 8 === 1 ? 0 : 2), hex(0xe8e2b8));
  },
  cactus_top(c) {
    c.speckle(hex(0x5c9a3c), 0.12);
    for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11], [7, 7], [8, 8]]) c.set(x, y, hex(0xe8e2b8));
  },
  torch(c) {
    // The torch's sides are 2 pixels wide in the world but take the whole texture across, so
    // every row is one colour: flame at the top, the stick below.
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      const [colour, shade] = y < 2 ? [FLAME_CORE, 1] : y < 4 ? [FLAME, 1] : [STICK, y % 3 === 0 ? 0.85 : 1];
      for (let x = 0; x < TEXTURE_SIZE; x++) c.set(x, y, colour, shade);
    }
  },
  torch_top(c) {
    c.speckle(FLAME_CORE, 0.08);
  },
  torch_item(c) {
    // The hotbar icon: a stick with a flame, on nothing.
    for (let y = 0; y < TEXTURE_SIZE; y++) for (let x = 0; x < TEXTURE_SIZE; x++) c.set(x, y, STICK, 1, 0);
    for (let y = 6; y < TEXTURE_SIZE; y++) for (const x of [7, 8]) c.set(x, y, STICK, x === 8 ? 0.8 : 1);
    for (const [x, y, colour] of [[7, 2, FLAME], [8, 2, FLAME], [6, 3, FLAME], [7, 3, FLAME_CORE], [8, 3, FLAME_CORE], [9, 3, FLAME], [6, 4, FLAME], [7, 4, FLAME_CORE], [8, 4, FLAME_CORE], [9, 4, FLAME], [7, 5, FLAME], [8, 5, FLAME]] as [number, number, RGB][])
      c.set(x, y, colour);
  },
  lamp(c) {
    // Warm glass panes in a dark metal frame with a cross bar.
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const frame = x === 0 || y === 0 || x === TEXTURE_SIZE - 1 || y === TEXTURE_SIZE - 1 || x === 7 || x === 8 || y === 7 || y === 8;
        if (frame) c.set(x, y, hex(0x4a4640), 1 + (c.rng() - 0.5) * 0.1);
        else {
          // Brighter towards each pane's middle.
          const px = x < 7 ? x - 3.5 : x - 11.5;
          const py = y < 7 ? y - 3.5 : y - 11.5;
          c.set(x, y, hex(0xffd27a), 1.12 - Math.hypot(px, py) * 0.07 + (c.rng() - 0.5) * 0.06);
        }
      }
  },
  copper_plate(c) {
    c.speckle(COPPER, 0.14);
    c.spots(5, COPPER_DARK, 0.1);
  },
  wire_off(c) {
    traces(c, false);
  },
  wire_on(c) {
    traces(c, true);
  },
  wire_item(c) {
    // The picker's icon: a cross of copper on nothing.
    for (let y = 0; y < TEXTURE_SIZE; y++) for (let x = 0; x < TEXTURE_SIZE; x++) c.set(x, y, COPPER, 1, 0);
    for (let i = 2; i < 14; i++) for (const j of [7, 8]) {
      c.set(i, j, COPPER);
      c.set(j, i, COPPER, 0.85);
    }
  },
  switch_handle(c) {
    // A dark handle with a red knob at the top (off).
    for (let y = 0; y < TEXTURE_SIZE; y++) for (let x = 0; x < TEXTURE_SIZE; x++) c.set(x, y, y < 4 ? hex(0xb03a2e) : hex(0x3a3634), 1 + (c.rng() - 0.5) * 0.1);
  },
  switch_handle_on(c) {
    // The same with a lit knob (on).
    for (let y = 0; y < TEXTURE_SIZE; y++) for (let x = 0; x < TEXTURE_SIZE; x++) c.set(x, y, y < 4 ? LIT : hex(0x3a3634), 1 + (c.rng() - 0.5) * 0.1);
  },
  switch_item(c) {
    for (let y = 0; y < TEXTURE_SIZE; y++) for (let x = 0; x < TEXTURE_SIZE; x++) c.set(x, y, COPPER, 1, 0);
    for (let y = 11; y < 15; y++) for (let x = 3; x < 13; x++) c.set(x, y, COPPER, y === 11 ? 1.1 : 0.9);
    for (let k = 0; k < 8; k++) for (const w of [0, 1]) c.set(6 + Math.floor(k / 2) + w, 10 - k, hex(0x3a3634));
    for (const [x, y] of [[10, 2], [11, 2], [10, 3], [11, 3]]) c.set(x, y, hex(0xb03a2e));
  },
  button_item(c) {
    for (let y = 0; y < TEXTURE_SIZE; y++) for (let x = 0; x < TEXTURE_SIZE; x++) c.set(x, y, COPPER, 1, 0);
    for (let y = 6; y < 11; y++) for (let x = 4; x < 12; x++) c.set(x, y, COPPER, y === 6 ? 1.15 : 0.95);
  },
  signal_lamp(c) {
    // Dark glass panes in a copper frame.
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const frame = x === 0 || y === 0 || x === TEXTURE_SIZE - 1 || y === TEXTURE_SIZE - 1 || x === 7 || x === 8 || y === 7 || y === 8;
        c.set(x, y, frame ? COPPER_DARK : hex(0x4a3a30), 1 + (c.rng() - 0.5) * 0.12);
      }
  },
  signal_lamp_on(c) {
    // Lit: the panes glowing, brightest in their middles.
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const frame = x === 0 || y === 0 || x === TEXTURE_SIZE - 1 || y === TEXTURE_SIZE - 1 || x === 7 || x === 8 || y === 7 || y === 8;
        if (frame) c.set(x, y, COPPER, 1 + (c.rng() - 0.5) * 0.1);
        else {
          const px = x < 7 ? x - 3.5 : x - 11.5;
          const py = y < 7 ? y - 3.5 : y - 11.5;
          c.set(x, y, Math.hypot(px, py) < 1.6 ? LIT_CORE : LIT, 1.05 - Math.hypot(px, py) * 0.05);
        }
      }
  },
  charged(c) {
    // Copper round a bright core.
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        c.set(x, y, d < 3 ? LIT_CORE : d < 5 ? LIT : COPPER, 1 + (c.rng() - 0.5) * 0.12);
      }
  },
  inverter(c) {
    gatePlate(c, false);
    for (let x = 4; x < 12; x++) c.set(x, 9, BOARD);
  },
  inverter_on(c) {
    gatePlate(c, true);
    for (let x = 4; x < 12; x++) c.set(x, 9, LIT);
  },
  delay_1: (c) => delayPlate(c, 1, false),
  delay_2: (c) => delayPlate(c, 2, false),
  delay_3: (c) => delayPlate(c, 3, false),
  delay_4: (c) => delayPlate(c, 4, false),
  delay_1_on: (c) => delayPlate(c, 1, true),
  delay_2_on: (c) => delayPlate(c, 2, true),
  delay_3_on: (c) => delayPlate(c, 3, true),
  delay_4_on: (c) => delayPlate(c, 4, true),
  furnace_side: (c) => bricks(c),
  furnace_top(c) {
    bricks(c);
    // A dark vent in the middle.
    for (let y = 6; y < 10; y++) for (let x = 5; x < 11; x++) c.set(x, y, hex(0x2a2a2c), 1 + (c.rng() - 0.5) * 0.2);
  },
  furnace_front: (c) => furnaceFront(c, false),
  furnace_front_lit: (c) => furnaceFront(c, true),
  glass(c) {
    // Nearly clear, a light frame and a few highlights.
    const pane = hex(0xcfe8f2);
    for (let y = 0; y < TEXTURE_SIZE; y++)
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const edge = x === 0 || y === 0 || x === TEXTURE_SIZE - 1 || y === TEXTURE_SIZE - 1;
        c.set(x, y, pane, edge ? 1.05 : 1, edge ? 235 : 28);
      }
    for (const [x, y] of [[3, 3], [4, 4], [5, 5], [3, 5], [10, 11], [11, 12]]) c.set(x, y, hex(0xffffff), 1, 130);
  },
};

/** Stone bricks: courses 4 high, joints offset course to course, mortar darker. */
function bricks(c: Canvas): void {
  const brick = hex(0x83868a);
  const mortar = hex(0x55585c);
  for (let y = 0; y < TEXTURE_SIZE; y++)
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const course = y >> 2;
      const joint = y % 4 === 3 || (x + (course % 2) * 4) % 8 === 7;
      c.set(x, y, joint ? mortar : brick, 1 + (c.rng() - 0.5) * (joint ? 0.1 : 0.16));
    }
}

/** A furnace's front: bricks round an arched opening, dark when out, a fire in it when burning. */
function furnaceFront(c: Canvas, lit: boolean): void {
  bricks(c);
  const dark = hex(0x1c1c1e);
  for (let y = 7; y < 14; y++)
    for (let x = 3; x < 13; x++) {
      // The arch: rounded at the top corners.
      if (y === 7 && (x < 5 || x > 10)) continue;
      if (!lit) {
        c.set(x, y, dark, 1 + (c.rng() - 0.5) * 0.2);
        continue;
      }
      const heat = (y - 7) / 6 + (c.rng() - 0.5) * 0.5;
      c.set(x, y, heat > 0.7 ? LIT_CORE : heat > 0.35 ? FLAME : LIT, 1 + (c.rng() - 0.5) * 0.15);
    }
  // A grate over it.
  for (let x = 3; x < 13; x += 3) c.set(x, 13, hex(0x3a3a3c));
}

/** Stone with clusters of mineral in the given colours (a main one and a highlight). */
function ore(c: Canvas, [main, light]: RGB[]): void {
  PAINTERS.stone(c);
  for (let n = 0; n < 6; n++) {
    const x = 1 + Math.floor(c.rng() * (TEXTURE_SIZE - 3));
    const y = 1 + Math.floor(c.rng() * (TEXTURE_SIZE - 3));
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (c.rng() < 0.8) c.set(x + dx, y + dy, main, 1 + (c.rng() - 0.5) * 0.15);
    c.set(x + (c.rng() < 0.5 ? 0 : 1), y, light);
  }
}

/** A seed per texture name, so each looks the same every time and differs from the others. */
function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Every layer, in `TEXTURE_NAMES` order: RGBA, TEXTURE_SIZE² pixels a layer, row 0 at the top. */
export function makeTextures(): Uint8Array {
  const out = new Uint8Array(TEXTURE_NAMES.length * AREA * 4);
  TEXTURE_NAMES.forEach((name, layer) => {
    PAINTERS[name](new Canvas(out.subarray(layer * AREA * 4, (layer + 1) * AREA * 4), createRng(seedOf(name))));
  });
  return out;
}
