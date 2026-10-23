// Coordinates. World blocks are integer (x, y, z); block (x, y, z) fills the unit cube
// [x, x+1) × [y, y+1) × [z, z+1). +Y is up.
//
// Chunks are cubes of CHUNK_SIZE blocks. A chunk's coordinate (cx, cy, cz) is the world
// coordinate divided by CHUNK_SIZE, rounded down (so -1 is in chunk -1, not 0).

export const CHUNK_BITS = 5;
export const CHUNK_SIZE = 1 << CHUNK_BITS; // 32
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;

/** The world's vertical extent in chunks: y from 0 to 255, room for mountains above sea level 62. */
export const MIN_CHUNK_Y = 0;
export const MAX_CHUNK_Y = 7;
export const WORLD_HEIGHT = (MAX_CHUNK_Y - MIN_CHUNK_Y + 1) * CHUNK_SIZE;

export const toChunk = (v: number): number => v >> CHUNK_BITS;
export const toLocal = (v: number): number => v & CHUNK_MASK;

/** Index into a chunk's block array: x fastest, then z, then y (columns are contiguous per layer). */
export const localIndex = (x: number, y: number, z: number): number => (y << (2 * CHUNK_BITS)) | (z << CHUNK_BITS) | x;

export const chunkKey = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`;
