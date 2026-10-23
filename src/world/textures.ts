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
const SANDSTONE = hex(0xd3bf86);

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
