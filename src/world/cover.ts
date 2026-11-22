// Cover: for every column of blocks, how high the rain gets down (the top of the highest block
// that stops it) and what falls there by the climate (nothing, rain or snow). Sunlight can't
// say it: it goes through glass at full strength. A tile a chunk column, CHUNK_SIZE² places,
// z then x, two bytes a place: the height in half blocks (0–512) in the first and the low two
// bits of the second, what falls above them. The generate worker makes it; an edit looks again
// at its own column of blocks (`World`). Pure.

import { TUNING } from '../config';
import { hash3 } from '../math';
import { Biome, BIOME_COUNT, type Climate } from './biomes';
import { BLOCKS } from './blocks';
import { CHUNK_SIZE, MIN_CHUNK_Y } from './coords';

export enum Fall {
  None = 0,
  Rain = 1,
  Snow = 2,
}

/** Bytes a place, and a tile. */
export const COVER_STRIDE = 2;
export const COVER_BYTES = CHUNK_SIZE * CHUNK_SIZE * COVER_STRIDE;
/** The climate is sampled every this many blocks (a divisor of CHUNK_SIZE). */
const SAMPLE = 8;
/** Keeps the dither's hash apart from the land's. */
const SALT = 0x2d1f_fa11;

/**
 * How far up its block each id stops rain, in half blocks: 0 not at all, 1 up to halfway (a
 * lower slab, a bed, shallow liquid), else 2 (leaves and glass too). Only what fills its block
 * seen from above shelters what's under it, and liquids: not air, torches, wire, rails or
 * plants, nor fences, panes, doors and lanterns (whose ground would be left a dry square).
 */
export const RAIN_STOP = new Uint8Array(256);
BLOCKS.forEach((info, b) => {
  if (info.liquid) RAIN_STOP[b] = Math.ceil(info.liquidHeight * 2);
  else if (!info.passable && !info.connects) {
    const boxes = info.boxes ?? [[0, 0, 0, 1, 1, 1]];
    if (boxes.some(([x0, , z0, x1, , z1]) => x0 === 0 && z0 === 0 && x1 === 1 && z1 === 1)) RAIN_STOP[b] = Math.ceil(Math.max(...boxes.map((box) => box[4])) * 2);
  }
});

/** The height rain gets down to at place `i` (z * CHUNK_SIZE + x) of a tile, in half blocks. */
export const coverHeight = (tile: Uint8Array, i: number): number => tile[i * COVER_STRIDE] | ((tile[i * COVER_STRIDE + 1] & 3) << 8);
/** What falls at place `i` of a tile. */
export const coverFall = (tile: Uint8Array, i: number): Fall => tile[i * COVER_STRIDE + 1] >> 2;

function setHeight(tile: Uint8Array, i: number, half: number): void {
  const at = i * COVER_STRIDE;
  tile[at] = half & 255;
  tile[at + 1] = (tile[at + 1] & ~3) | (half >> 8);
}

/**
 * How far under its cover a top can be and still be open to the sky: a stair's lower step.
 */
export const UNDER_COVER = 0.5;
/**
 * The same for far chunks' coarser tops, in cells of their detail. Coarsening takes thin things
 * off (canopies, ledges): with one cell 3–10 % of the tops seen from above were missed, with two
 * 1.3–3.8 %.
 */
export const UNDER_COVER_CELLS = 2;

/**
 * Whether settled snow lies at height `y` of place `i` of a tile with `blockLight` there and
 * this much of it `settled`: enough to hear underfoot, where the shader draws it.
 */
export function snowLies(tile: Uint8Array, i: number, y: number, blockLight: number, settled: number): boolean {
  const W = TUNING.weather;
  if (settled < W.snowSteps || blockLight >= W.melts || coverFall(tile, i) !== Fall.Snow) return false;
  return y >= coverHeight(tile, i) / 2 - UNDER_COVER - 0.01;
}

/** What falls with this much snowy mountain and this much dry biome (desert and savanna); `dither` is -0.5–0.5. */
export function fallOf(snowy: number, dry: number, dither: number): Fall {
  const W = TUNING.weather;
  const nudge = dither * W.dither;
  if (snowy + nudge >= W.snowAt) return Fall.Snow;
  return dry + nudge >= W.dryAt ? Fall.None : Fall.Rain;
}

const weights = new Float64Array(BIOME_COUNT);
const CORNERS = CHUNK_SIZE / SAMPLE + 1;
const snowyAt = new Float64Array(CORNERS * CORNERS);
const dryAt = new Float64Array(CORNERS * CORNERS);
const found = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
/** The places still open to the sky as the scan comes down, packed at the front. */
const open = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);

/** The tile for column (cx, cz) of these chunks (MIN_CHUNK_Y up; null for all air). */
export function coverTile(chunks: readonly (Uint8Array | null)[], cx: number, cz: number, seed: number, climate: Climate): Uint8Array {
  const S = CHUNK_SIZE;
  const area = S * S;
  const stop = RAIN_STOP;
  const heights = found;
  heights.fill(0);
  // Only places still open are looked at on the way down: mountains leave a few open a long way.
  const todo = open;
  for (let i = 0; i < area; i++) todo[i] = i;
  let left = area;
  for (let c = chunks.length - 1; c >= 0 && left; c--) {
    const blocks = chunks[c];
    if (!blocks) continue;
    const base = (c + MIN_CHUNK_Y) * S;
    for (let y = S - 1; y >= 0 && left; y--) {
      const layer = y * area;
      const below = (base + y) * 2;
      let still = 0;
      for (let k = 0; k < left; k++) {
        const i = todo[k];
        const half = stop[blocks[layer + i]];
        if (half) heights[i] = below + half;
        else todo[still++] = i;
      }
      left = still;
    }
  }

  const x0 = cx * S;
  const z0 = cz * S;
  const n = CORNERS;
  const step = SAMPLE;
  const w = weights;
  const snowy = snowyAt;
  const dry = dryAt;
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < n; k++) {
      climate.weights(x0 + k * step, z0 + j * step, w);
      snowy[j * n + k] = w[Biome.Mountains];
      dry[j * n + k] = w[Biome.Desert] + w[Biome.Savanna];
    }
  }

  const tile = new Uint8Array(COVER_BYTES);
  const salted = seed ^ SALT;
  const hash = hash3;
  const fallAt = fallOf;
  const stride = COVER_STRIDE;
  for (let z = 0; z < S; z++) {
    const j = (z / step) | 0;
    const fz = (z - j * step) / step;
    for (let x = 0; x < S; x++) {
      const k = (x / step) | 0;
      const fx = (x - k * step) / step;
      const a = j * n + k;
      const top = (1 - fz) * (1 - fx);
      const topRight = (1 - fz) * fx;
      const bottom = fz * (1 - fx);
      const bottomRight = fz * fx;
      const s = snowy[a] * top + snowy[a + 1] * topRight + snowy[a + n] * bottom + snowy[a + n + 1] * bottomRight;
      const d = dry[a] * top + dry[a + 1] * topRight + dry[a + n] * bottom + dry[a + n + 1] * bottomRight;
      const fall = fallAt(s, d, hash(salted, x0 + x, 0, z0 + z) - 0.5);
      const i = z * S + x;
      const height = heights[i];
      tile[i * stride] = height & 255;
      tile[i * stride + 1] = (height >> 8) | (fall << 2);
    }
  }
  return tile;
}

/**
 * Block y of place `i` of a tile is now `block`: put its cover right, reading the blocks below
 * (`read`) only when the top was taken away. Returns whether it changed.
 */
export function updateCover(tile: Uint8Array, i: number, y: number, block: number, read: (y: number) => number): boolean {
  const was = coverHeight(tile, i);
  /** The block the cover is now at the top of (-1: none). */
  const top = Math.ceil(was / 2) - 1;
  if (y < top) return false;
  let now = 0;
  const half = RAIN_STOP[block];
  if (half) now = y * 2 + half;
  else if (y > top) return false;
  else {
    for (let below = y - 1; below >= MIN_CHUNK_Y * CHUNK_SIZE; below--) {
      const stops = RAIN_STOP[read(below)];
      if (!stops) continue;
      now = below * 2 + stops;
      break;
    }
  }
  if (now === was) return false;
  setHeight(tile, i, now);
  return true;
}
