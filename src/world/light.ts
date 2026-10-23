// Light: sunlight and block light, 4 bits each, packed in one byte per block (sun << 4 |
// block light) in a Uint8Array per chunk, laid out like its blocks (`coords.ts`).
//
// Sunlight is 15 under the open sky and goes straight down through clear blocks (air, glass)
// without loss. Every other step (sideways, up, or down through anything else) costs 1, plus
// the block's `lightCost` (leaves, water). Block light spreads the same way from blocks that
// give light. Opaque blocks stop both. A block's light is the most any source reaches it
// with, and flood fills that only ever raise light (BFS) arrive at exactly that whatever
// order they run in: light, like the blocks, doesn't depend on load order.
//
// Worked out in two places (edits come in step 3):
// - `lightColumn`, in the worker that generated a column: that column alone, dark outside it.
// - `lightBorders`, on the main thread when a column is added: light flows across its borders
//   with the loaded columns next to it, and on into them as far as it reaches.
// Light travels at most 14 blocks, less than a chunk, so once a chunk's 3 × 3 columns are
// loaded, its light and its neighbours' within a block of it are final: the rule meshing
// already waits for.

import { BLOCKS } from './blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, WORLD_HEIGHT } from './coords';
import type { World } from './world';

/** Bit offset of each channel in the packed byte. */
export const SUN = 4;
export const BLOCK_LIGHT = 0;
/** The packed byte of a block in full sunlight and no block light. */
export const SUNLIT = 0xf0;

/** Light of every chunk that is all open sky; shared, never written (copied on the first change). */
export const FULL_SUN = new Uint8Array(CHUNK_VOLUME).fill(SUNLIT);
/** Light of every chunk with none at all (solid rock, unlit caves); shared like `FULL_SUN`. */
export const DARK = new Uint8Array(CHUNK_VOLUME);

/** A chunk's light as a worker hands it over: its own array, or `SUNLIT` / 0 for `FULL_SUN` / `DARK`. */
export type PackedLight = Uint8Array | number;

export const unpackLight = (light: PackedLight): Uint8Array =>
  typeof light !== 'number' ? light : light === SUNLIT ? FULL_SUN : DARK;

// Per block id. Local tables: imported bindings cost a lookup each in hot loops (under Vitest).
const OPAQUE = new Uint8Array(256);
/** What a step into the block costs: 1 + its lightCost. */
const STEP = new Uint8Array(256);
/** Sunlight goes straight down through it at full strength. */
const CLEAR = new Uint8Array(256);
const EMIT = new Uint8Array(256);
BLOCKS.forEach((info, b) => {
  OPAQUE[b] = info.opaque ? 1 : 0;
  STEP[b] = 1 + info.lightCost;
  CLEAR[b] = !info.opaque && info.lightCost === 0 ? 1 : 0;
  EMIT[b] = info.light;
});
const ANY_EMITTER = EMIT.some((l) => l > 0);

const S = CHUNK_SIZE;
const V = CHUNK_VOLUME;
const HEIGHT = WORLD_HEIGHT;
const CHUNKS = MAX_CHUNK_Y - MIN_CHUNK_Y + 1;
/** One horizontal layer of a column. */
const LAYER = S * S;
const COLUMN = V * CHUNKS;

// --- A column on its own (in a worker) ---------------------------------------------------
//
// The column's chunks laid end to end are one array indexed (y << 10) | (z << 5) | x with y
// over the whole height, because chunks are stored y-major. Reused for every column (one set
// per thread).

const blocks = new Uint8Array(COLUMN);
const light = new Uint8Array(COLUMN);
/** Per (x, z): the lowest y in full sunlight (HEIGHT if the top block isn't clear). */
const lowest = new Int32Array(LAYER);
let queue = new Int32Array(1 << 16);
let tail = 0;

function push(i: number): void {
  if (tail === queue.length) {
    const bigger = new Int32Array(queue.length * 2);
    bigger.set(queue);
    queue = bigger;
  }
  queue[tail++] = i;
}

/** Give block i light `l` on the channel at `shift` if that's more than it has, and queue it to spread. */
function raiseTo(i: number, l: number, shift: number): void {
  const cur = light[i];
  if (l <= ((cur >> shift) & 15)) return;
  light[i] = (cur & ~(15 << shift)) | (l << shift);
  push(i);
}

/** Light reaching block i in one step from a block with light `level`. */
function step(i: number, level: number, shift: number): void {
  const b = blocks[i];
  if (!OPAQUE[b]) raiseTo(i, level - STEP[b], shift);
}

/** Spread the queued blocks' light on one channel through the column, raising only. */
function spreadColumn(shift: number): void {
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const level = (light[i] >> shift) & 15;
    if (level <= 1) continue;
    const x = i & (S - 1);
    const z = (i >> 5) & (S - 1);
    if (x > 0) step(i - 1, level, shift);
    if (x < S - 1) step(i + 1, level, shift);
    if (z > 0) step(i - S, level, shift);
    if (z < S - 1) step(i + S, level, shift);
    if (i < COLUMN - LAYER) step(i + LAYER, level, shift);
    if (i >= LAYER) {
      const below = i - LAYER;
      if (shift === SUN && level === 15 && CLEAR[blocks[below]]) raiseTo(below, 15, shift);
      else step(below, level, shift);
    }
  }
  tail = 0;
}

/**
 * Light a whole column (chunks MIN_CHUNK_Y.. upwards, null for all air) as if nothing
 * around it gave light, apart from the sky above. Chunks wholly in sun or wholly dark come
 * back as `SUNLIT` / 0 rather than arrays.
 */
export function lightColumn(chunks: readonly (Uint8Array | null)[]): PackedLight[] {
  for (let c = 0; c < CHUNKS; c++) {
    const chunk = chunks[c];
    if (chunk) blocks.set(chunk, c * V);
    else blocks.fill(0, c * V, (c + 1) * V);
  }
  light.fill(0);

  // Open sky: full sun from the top down to the first block that isn't clear.
  for (let c = 0; c < LAYER; c++) {
    let i = COLUMN - LAYER + c;
    while (i >= 0 && CLEAR[blocks[i]]) {
      light[i] = SUNLIT;
      i -= LAYER;
    }
    lowest[c] = (i >> 10) + 1;
  }
  // It spreads from where it meets shade: the sunlit blocks beside a column that is shaded at
  // that height, and the lowest sunlit block of each column (down into leaves or water).
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const c = z * S + x;
      const low = lowest[c];
      if (low >= HEIGHT) continue;
      let top = low + 1;
      if (x > 0) top = Math.max(top, lowest[c - 1]);
      if (x < S - 1) top = Math.max(top, lowest[c + 1]);
      if (z > 0) top = Math.max(top, lowest[c - S]);
      if (z < S - 1) top = Math.max(top, lowest[c + S]);
      top = Math.min(top, HEIGHT);
      for (let y = low; y < top; y++) push(y * LAYER + c);
    }
  }
  spreadColumn(SUN);

  if (ANY_EMITTER) {
    for (let c = 0; c < CHUNKS; c++) {
      if (!chunks[c]) continue;
      for (let i = c * V, end = i + V; i < end; i++) {
        const e = EMIT[blocks[i]];
        if (e) raiseTo(i, e, BLOCK_LIGHT);
      }
    }
    spreadColumn(BLOCK_LIGHT);
  }

  const out: PackedLight[] = [];
  for (let c = 0; c < CHUNKS; c++) out.push(pack(c * V));
  return out;
}

/** The chunk starting at `start`: a fill value if it's all one of the shared ones, else a copy. */
function pack(start: number): PackedLight {
  const first = light[start];
  if (first === 0 || first === SUNLIT) {
    let i = start + 1;
    const end = start + V;
    while (i < end && light[i] === first) i++;
    if (i === end) return first;
  }
  return light.slice(start, start + V);
}

// --- Across chunks (main thread) ---------------------------------------------------------

/** Blocks queued to spread, as world (x, y, z) triples. */
let worldQueue = new Int32Array(3 << 12);
let worldTail = 0;

function pushWorld(x: number, y: number, z: number): void {
  if (worldTail + 3 > worldQueue.length) {
    const bigger = new Int32Array(worldQueue.length * 2);
    bigger.set(worldQueue);
    worldQueue = bigger;
  }
  worldQueue[worldTail++] = x;
  worldQueue[worldTail++] = y;
  worldQueue[worldTail++] = z;
}

/** Block (x, y, z) gets light from a neighbour with `level` on one channel, if more than it has. Returns 1 if raised. */
function stepWorld(world: World, x: number, y: number, z: number, level: number, shift: number, down: boolean): number {
  if (y < 0 || y >= HEIGHT) return 0;
  const chunk = world.getChunk(x >> 5, y >> 5, z >> 5);
  if (!chunk) return 0;
  const i = localIndex(x & (S - 1), y & (S - 1), z & (S - 1));
  const b = chunk.blocks[i];
  if (OPAQUE[b]) return 0;
  const l = down && shift === SUN && level === 15 && CLEAR[b] ? 15 : level - STEP[b];
  const cur = chunk.light[i];
  if (l <= ((cur >> shift) & 15)) return 0;
  chunk.ownLight()[i] = (cur & ~(15 << shift)) | (l << shift);
  pushWorld(x, y, z);
  return 1;
}

/** Spread the queued blocks' light on one channel through the loaded chunks, raising only. Returns the blocks raised. */
function spreadWorld(world: World, shift: number): number {
  let raised = 0;
  for (let head = 0; head < worldTail; head += 3) {
    const x = worldQueue[head];
    const y = worldQueue[head + 1];
    const z = worldQueue[head + 2];
    const level = (world.getLight(x, y, z) >> shift) & 15;
    if (level <= 1) continue;
    raised +=
      stepWorld(world, x + 1, y, z, level, shift, false) +
      stepWorld(world, x - 1, y, z, level, shift, false) +
      stepWorld(world, x, y, z + 1, level, shift, false) +
      stepWorld(world, x, y, z - 1, level, shift, false) +
      stepWorld(world, x, y + 1, z, level, shift, false) +
      stepWorld(world, x, y - 1, z, level, shift, true);
  }
  worldTail = 0;
  return raised;
}

/** The four columns beside one, as (dx, dz). */
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Column (cx, cz) has just been added, lit on its own: let light flow both ways across its
 * borders with the loaded columns beside it, and on as far as it reaches. Returns the
 * number of blocks whose light went up.
 */
export function lightBorders(world: World, cx: number, cz: number): number {
  let raised = 0;
  for (const shift of [SUN, BLOCK_LIGHT]) {
    for (const [dx, dz] of SIDES) {
      if (!world.hasColumn(cx + dx, cz + dz)) continue;
      for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
        const a = world.getChunk(cx, cy, cz)!;
        const b = world.getChunk(cx + dx, cy, cz + dz)!;
        // Both all sun or both all dark: nothing flows.
        if (a.light === b.light && (a.light === FULL_SUN || a.light === DARK)) continue;
        // The layer of `a` against the border and the facing layer of `b`, in local coordinates.
        const ax = dx > 0 ? S - 1 : 0;
        const az = dz > 0 ? S - 1 : 0;
        const bx = dx < 0 ? S - 1 : 0;
        const bz = dz < 0 ? S - 1 : 0;
        for (let ly = 0; ly < S; ly++) {
          for (let t = 0; t < S; t++) {
            const ia = dx !== 0 ? localIndex(ax, ly, t) : localIndex(t, ly, az);
            const ib = dx !== 0 ? localIndex(bx, ly, t) : localIndex(t, ly, bz);
            const la = (a.light[ia] >> shift) & 15;
            const lb = (b.light[ib] >> shift) & 15;
            if (la === lb) continue;
            const wx = cx * S + (dx !== 0 ? ax : t);
            const wy = cy * S + ly;
            const wz = cz * S + (dx !== 0 ? t : az);
            // From the brighter side to the darker one.
            if (la > lb) raised += stepWorld(world, wx + dx, wy, wz + dz, la, shift, false);
            else raised += stepWorld(world, wx, wy, wz, lb, shift, false);
          }
        }
      }
    }
    raised += spreadWorld(world, shift);
  }
  return raised;
}
