// Visibility culling for caves (after Tommaso Checchi's "advanced cave culling"): which
// chunks could possibly be seen from the player's chunk, through open space.
//
// Per chunk, a flood fill through see-through blocks (anything not opaque) finds the open
// regions and which of the chunk's 6 faces each touches; every pair of faces some region
// touches is "connected" (15 pairs, a bit each). The walk then goes outwards from the
// player's chunk: into a neighbour through a face, and out of it only through a face
// connected to the one it came in by, never in the direction opposite one already taken
// (so it can't turn back round a solid wall towards the player). Chunks it never reaches
// can't be seen and needn't be meshed or drawn.

import { BLOCKS } from './blocks';
import { CHUNK_SIZE, chunkKey } from './coords';

// Local copies: imported bindings can cost a lookup each time in the hot loops (they do under Vitest).
const S = CHUNK_SIZE;
const VOLUME = S * S * S;
/** Index step along x, y and z (layout: x fastest, then z, then y). */
const STRIDE = [1, S * S, S];

/** Faces, in order: -x, +x, -y, +y, -z, +z. The opposite of face f is f ^ 1. */
export const FACE_OFFSETS: readonly (readonly [number, number, number])[] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

/** Bit for the pair of faces a, b (a ≠ b): 15 pairs. */
const PAIR = new Int32Array(36).fill(-1);
{
  let bit = 0;
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++) {
      PAIR[a * 6 + b] = PAIR[b * 6 + a] = bit;
      bit++;
    }
}
/** Every pair connected: an all-air chunk, or one not loaded yet (assume it's open). */
export const ALL_CONNECTED = (1 << 15) - 1;

/** Can you see through the chunk from face a to face b? */
export const connects = (mask: number, a: number, b: number): boolean => a === b || (mask & (1 << PAIR[a * 6 + b])) !== 0;

/** The pair bits for every pair within a set of faces (6-bit), precomputed. */
const PAIRS_OF = new Int32Array(64);
for (let faces = 0; faces < 64; faces++)
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) if (faces & (1 << a) && faces & (1 << b)) PAIRS_OF[faces] |= 1 << PAIR[a * 6 + b];

const SEE_THROUGH = new Uint8Array(256);
BLOCKS.forEach((info, b) => (SEE_THROUGH[b] = info.opaque ? 0 : 1));

// Reused for every chunk (one set per thread).
const visited = new Uint8Array(VOLUME);
const queue = new Int32Array(VOLUME);

/** Which faces of a chunk see each other through its open space: a 15-bit mask of `connects` pairs. */
export function chunkConnectivity(blocks: Uint8Array): number {
  visited.fill(0);
  let mask = 0;
  for (let start = 0; start < VOLUME; start++) {
    if (visited[start] || !SEE_THROUGH[blocks[start]]) continue;
    // Flood one open region, noting the faces it touches.
    let faces = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i & (S - 1);
      const z = (i >> 5) & (S - 1);
      const y = i >> 10;
      // Per face: at the chunk's edge note the face, else step to the open neighbour.
      for (let face = 0; face < 6; face++) {
        const axis = face >> 1;
        const at = axis === 0 ? x : axis === 1 ? y : z;
        const high = face & 1;
        if (at === (high ? S - 1 : 0)) {
          faces |= 1 << face;
          continue;
        }
        const j = i + (high ? STRIDE[axis] : -STRIDE[axis]);
        if (visited[j] || !SEE_THROUGH[blocks[j]]) continue;
        visited[j] = 1;
        queue[tail++] = j;
      }
    }
    mask |= PAIRS_OF[faces];
    if (mask === ALL_CONNECTED) break;
  }
  return mask;
}

/**
 * The chunks that could be seen from chunk `start`: the walk described above, within the
 * chunks `inRange` allows. `connectivity` gives a chunk's mask (ALL_CONNECTED for one not
 * loaded yet, so the walk carries on into it until it is). Returns their keys.
 */
export function reachableChunks(
  start: readonly [number, number, number],
  inRange: (cx: number, cy: number, cz: number) => boolean,
  connectivity: (cx: number, cy: number, cz: number) => number,
): Set<string> {
  const seen = new Set<string>([chunkKey(...start)]);
  // Queue of [cx, cy, cz, face entered by (-1 for the start), directions taken so far (6 bits)].
  const queue: [number, number, number, number, number][] = [[start[0], start[1], start[2], -1, 0]];
  for (let head = 0; head < queue.length; head++) {
    const [cx, cy, cz, from, taken] = queue[head];
    const mask = from < 0 ? ALL_CONNECTED : connectivity(cx, cy, cz);
    for (let face = 0; face < 6; face++) {
      if (taken & (1 << (face ^ 1))) continue; // never back towards where we came from
      if (from >= 0 && !connects(mask, from, face)) continue;
      const [dx, dy, dz] = FACE_OFFSETS[face];
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      if (!inRange(nx, ny, nz)) continue;
      const key = chunkKey(nx, ny, nz);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny, nz, face ^ 1, taken | (1 << face)]);
    }
  }
  return seen;
}
