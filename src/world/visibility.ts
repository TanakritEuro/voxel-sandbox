// Visibility culling for caves: which parts of which chunks could be seen from the player,
// through open space.
//
// Per chunk, a flood fill through see-through blocks (anything not opaque) finds its open
// regions. Regions touching none of the chunk's 6 faces are pockets: sealed inside it, seen
// only from within, and getting in means digging, which works the regions out again. The
// others are numbered (`Regions`): which faces each touches, and which region every block on
// the chunk's faces belongs to, so a region can be linked to the neighbour's regions it shares
// open blocks with across a face.
//
// The walk (`walkRegions`) then goes outwards from the region the eye is in: from a region
// out through any face it touches, into the neighbour's regions it's linked to, never in the
// direction opposite one already taken (so it can't turn back round a solid wall towards the
// player). Unlike a walk from chunk to chunk (Tommaso Checchi's "advanced cave culling", which
// this was until Milestone 15, kept below as `reachableChunks` for comparison), it can't come
// into a chunk by the sky and leave it by a tunnel the sky isn't joined to.

import { BLOCKS } from './blocks';
import { CHUNK_SIZE, chunkKey } from './coords';

// Local copies: imported bindings can cost a lookup each time in the hot loops (they do under Vitest).
const S = CHUNK_SIZE;
const VOLUME = S * S * S;
/** Blocks on one face of a chunk. */
const FACE_CELLS = S * S;

/** Faces, in order: -x, +x, -y, +y, -z, +z. The opposite of face f is f ^ 1. */
export const FACE_OFFSETS: readonly (readonly [number, number, number])[] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

const SEE_THROUGH = new Uint8Array(256);
BLOCKS.forEach((info, b) => (SEE_THROUGH[b] = info.opaque ? 0 : 1));

/** Can you see through block `b`? (Regions only change when a block changes this.) */
export const seeThrough = (b: number): boolean => SEE_THROUGH[b] === 1;

// ---------------------------------------------------------------------------------------------
// Regions

/** At most this many numbered regions a chunk; beyond it the smallest share the last number. */
export const MAX_REGIONS = 12;
/** In a region map or on a face: a solid block, or a pocket's. */
export const NO_REGION = 255;

/**
 * A chunk's open regions, numbered 0..count-1 in the order a scan (x fastest, then z, then y)
 * first meets them, so the same blocks always give the same numbers.
 */
export interface Regions {
  readonly count: number;
  /** Per region, the faces it touches (bit f for face f). */
  readonly faces: Uint8Array;
  /** The region of each block on the chunk's faces: face f's at f * 1024 + `faceCell`; `NO_REGION` if solid. */
  readonly border: Uint8Array;
  /** `OPEN_REGIONS` or `SOLID_REGIONS` (or a copy of one from a worker): shared, never cached on. */
  readonly shared?: boolean;
  /**
   * Links to the neighbour across each face (`linkMask`; face f's at f * MAX_REGIONS), kept with
   * the neighbour's regions they were worked out from.
   */
  links?: Uint16Array;
  linkedWith?: (Regions | null)[];
  /** `border` four cells at a time (made when first needed: a view, so not sent between threads). */
  words?: Uint32Array;
}

/** An all-air chunk, or one not loaded yet (assume it's open): one region, everywhere. */
export const OPEN_REGIONS: Regions = { count: 1, faces: Uint8Array.of(63), border: new Uint8Array(6 * FACE_CELLS), shared: true };
/** A chunk with no open region touching its faces. */
export const SOLID_REGIONS: Regions = { count: 0, faces: new Uint8Array(0), border: new Uint8Array(6 * FACE_CELLS).fill(NO_REGION), shared: true };

/**
 * Where block (u, v) of a face is kept in `Regions.border`: for x faces u is z and v is y, for y
 * faces u is x and v is z, for z faces u is x and v is y, so a face and the neighbour's opposite
 * face put the blocks that touch in the same cell.
 */
export const faceCell = (u: number, v: number): number => v * S + u;

/** The block index of cell (u, v) on face f. */
function faceBlock(face: number, u: number, v: number): number {
  const at = face & 1 ? S - 1 : 0;
  const axis = face >> 1;
  const x = axis === 0 ? at : u;
  const y = axis === 1 ? at : v;
  const z = axis === 0 ? u : axis === 1 ? v : at;
  return x + z * S + y * S * S;
}

/** Block index of every face cell, face by face (6 × 1024). */
const FACE_BLOCKS = new Int32Array(6 * FACE_CELLS);
for (let f = 0; f < 6; f++) for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) FACE_BLOCKS[f * FACE_CELLS + faceCell(u, v)] = faceBlock(f, u, v);

/** The faces of the chunk each block lies on (bit f for face f), so the flood needs no coordinates. */
const EDGE = new Uint8Array(VOLUME);
for (let i = 0; i < VOLUME; i++) {
  const x = i & (S - 1);
  const z = (i >> 5) & (S - 1);
  const y = i >> 10;
  EDGE[i] = (x === 0 ? 1 : 0) | (x === S - 1 ? 2 : 0) | (y === 0 ? 4 : 0) | (y === S - 1 ? 8 : 0) | (z === 0 ? 16 : 0) | (z === S - 1 ? 32 : 0);
}

// Reused for every chunk (one set per thread). Floods are labelled from 1; 0 is unvisited or solid.
// (At most VOLUME / 2 floods: no two open blocks of different floods touch.)
const labels = new Uint16Array(VOLUME);
const queue = new Int32Array(VOLUME);
const sizes = new Int32Array(VOLUME + 1);
const touched = new Uint8Array(VOLUME + 1);
const numberOf = new Uint8Array(VOLUME + 1);
const scratchMap = new Uint8Array(VOLUME);

/**
 * A chunk's regions, and the region of every block into `map` (32³, `NO_REGION` for solid blocks
 * and pockets).
 */
export function regionMap(blocks: Uint8Array, map: Uint8Array): Regions {
  const see = SEE_THROUGH;
  labels.fill(0);
  let floods = 0;
  for (let start = 0; start < VOLUME; start++) {
    if (labels[start] || !see[blocks[start]]) continue;
    // Flood one open region, noting the faces it touches.
    const label = ++floods;
    let faces = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const i = queue[head++];
      // On a face of the chunk: note it, and don't step out that way; else step to each open neighbour.
      const edge = EDGE[i];
      faces |= edge;
      let j: number;
      if (!(edge & 1) && !labels[(j = i - 1)] && see[blocks[j]]) {
        labels[j] = label;
        queue[tail++] = j;
      }
      if (!(edge & 2) && !labels[(j = i + 1)] && see[blocks[j]]) {
        labels[j] = label;
        queue[tail++] = j;
      }
      if (!(edge & 4) && !labels[(j = i - S * S)] && see[blocks[j]]) {
        labels[j] = label;
        queue[tail++] = j;
      }
      if (!(edge & 8) && !labels[(j = i + S * S)] && see[blocks[j]]) {
        labels[j] = label;
        queue[tail++] = j;
      }
      if (!(edge & 16) && !labels[(j = i - S)] && see[blocks[j]]) {
        labels[j] = label;
        queue[tail++] = j;
      }
      if (!(edge & 32) && !labels[(j = i + S)] && see[blocks[j]]) {
        labels[j] = label;
        queue[tail++] = j;
      }
    }
    sizes[label] = tail;
    touched[label] = faces;
  }

  // Number the regions touching a face, in scan order; past MAX_REGIONS, the largest keep their
  // own numbers and the rest share the last.
  let candidates = 0;
  for (let l = 1; l <= floods; l++) if (touched[l]) candidates++;
  let count = 0;
  if (candidates <= MAX_REGIONS) {
    for (let l = 1; l <= floods; l++) numberOf[l] = touched[l] ? count++ : NO_REGION;
  } else {
    const order: number[] = [];
    for (let l = 1; l <= floods; l++) if (touched[l]) order.push(l);
    order.sort((a, b) => sizes[b] - sizes[a] || a - b);
    const keep = new Set(order.slice(0, MAX_REGIONS - 1));
    for (let l = 1; l <= floods; l++) numberOf[l] = !touched[l] ? NO_REGION : keep.has(l) ? count++ : MAX_REGIONS - 1;
    count = MAX_REGIONS;
  }
  numberOf[0] = NO_REGION;
  for (let i = 0; i < VOLUME; i++) map[i] = numberOf[labels[i]];
  if (count === 0) return SOLID_REGIONS;

  const faces = new Uint8Array(count);
  for (let l = 1; l <= floods; l++) if (numberOf[l] !== NO_REGION) faces[numberOf[l]] |= touched[l];
  const border = new Uint8Array(6 * FACE_CELLS);
  let solidCells = 0;
  for (let c = 0; c < 6 * FACE_CELLS; c++) {
    const r = map[FACE_BLOCKS[c]];
    border[c] = r;
    if (r === NO_REGION) solidCells++;
  }
  // Open on every face, one region: the same as all air for the walk.
  if (count === 1 && solidCells === 0) return OPEN_REGIONS;
  return { count, faces, border, links: new Uint16Array(6 * MAX_REGIONS), linkedWith: [null, null, null, null, null, null] };
}

/** A chunk's regions (`regionMap` without keeping the map). */
export const chunkRegions = (blocks: Uint8Array): Regions => regionMap(blocks, scratchMap);

/** Bytes of region data a chunk holds (the shared ones count nothing). */
export const regionBytes = (r: Regions): number => (r.shared ? 0 : r.border.byteLength + r.faces.byteLength);

/**
 * Which of `theirs` (the neighbour across face `face`) region `r` of `mine` shares open blocks
 * with on that face: a mask of their regions. Worked out for all of mine at once (1024 cells) the
 * first time it's asked, and kept on `mine` until either side's regions are replaced.
 */
export function linkMask(mine: Regions, face: number, theirs: Regions, r: number): number {
  if (mine.count === 0 || theirs.count === 0) return 0;
  const back = face ^ 1;
  if (mine.shared) {
    // Open everywhere: joined to every region of theirs on that face.
    let m = 0;
    for (let t = 0; t < theirs.count; t++) if (theirs.faces[t] & (1 << back)) m |= 1 << t;
    return m;
  }
  if (theirs.shared) return mine.faces[r] & (1 << face) ? 1 : 0;
  const links = mine.links!;
  const at = face * MAX_REGIONS;
  if (mine.linkedWith![face] !== theirs) {
    links.fill(0, at, at + MAX_REGIONS);
    const a = mine.border;
    const b = theirs.border;
    const ao = face * FACE_CELLS;
    const bo = back * FACE_CELLS;
    // Four cells at a time: most runs of four are rock on one side, or one region on each.
    const aw = (mine.words ??= new Uint32Array(a.buffer, a.byteOffset, a.length / 4));
    const bw = (theirs.words ??= new Uint32Array(b.buffer, b.byteOffset, b.length / 4));
    const aq = ao / 4;
    const bq = bo / 4;
    for (let k = 0; k < FACE_CELLS / 4; k++) {
      const wa = aw[aq + k];
      const wb = bw[bq + k];
      if (wa === 0xffffffff || wb === 0xffffffff) continue;
      const ra = wa & 255;
      const rb = wb & 255;
      if (wa === ra * 0x01010101 && wb === rb * 0x01010101) {
        links[at + ra] |= 1 << rb;
        continue;
      }
      for (let c = 4 * k; c < 4 * k + 4; c++) {
        const ca = a[ao + c];
        const cb = b[bo + c];
        if (ca !== NO_REGION && cb !== NO_REGION) links[at + ca] |= 1 << cb;
      }
    }
    mine.linkedWith![face] = theirs;
  }
  return links[at + r];
}

/** `linkMask` for every region of mine (for tests and tools). */
export function linksOf(mine: Regions, face: number, theirs: Regions): Uint16Array {
  const out = new Uint16Array(MAX_REGIONS);
  for (let r = 0; r < Math.max(1, mine.count); r++) out[r] = linkMask(mine, face, theirs, r);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The walk

/** What a walk reached: per chunk in a grid round the start, the regions, and the faces seen from the other side. */
export class Reach {
  /** Grid width (x and z), from `cx - radius` and `cz - radius`. */
  readonly width: number;
  /** Per chunk, the regions reached (bit r). */
  readonly regions: Uint16Array;
  /**
   * Per chunk, its faces a reached region of the neighbour looks onto (bit f for face f): the
   * walls on that face, whose open side is in the neighbour, can be seen.
   */
  readonly faces: Uint8Array;
  /** Chunks with anything reached (regions or faces). */
  chunks = 0;
  /** The regions the walk took each chunk to have (undefined where it didn't look), to tell when they've changed since. */
  used: (Regions | undefined)[] = [];
  /** Regions reached, all chunks. */
  regionCount = 0;

  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly radius: number,
    readonly minY: number,
    readonly maxY: number,
  ) {
    this.width = 2 * radius + 1;
    const size = this.width * this.width * (maxY - minY + 1);
    this.regions = new Uint16Array(size);
    this.faces = new Uint8Array(size);
  }

  /** The chunk's place in the grid, or -1 outside it. */
  index(cx: number, cy: number, cz: number): number {
    const dx = cx - this.cx + this.radius;
    const dz = cz - this.cz + this.radius;
    if (dx < 0 || dz < 0 || dx >= this.width || dz >= this.width || cy < this.minY || cy > this.maxY) return -1;
    return ((cy - this.minY) * this.width + dz) * this.width + dx;
  }

  /** Could any of the chunk be seen? */
  has(cx: number, cy: number, cz: number): boolean {
    const i = this.index(cx, cy, cz);
    return i >= 0 && (this.regions[i] | this.faces[i]) !== 0;
  }
}

/** Grows as needed; one per thread. */
let nodes = new Int32Array(0);
let nodeTaken = new Uint8Array(0);

/**
 * Walk from chunk `start` (inside minY..maxY), from its regions in `startRegions` (a mask; all of
 * them if none of those exist), through the chunks within `radius` columns of it. `regionsOf`
 * gives a chunk's regions, or undefined for one not loaded yet, which counts as open, so the walk
 * carries on into it until it is.
 */
export function walkRegions(
  start: readonly [number, number, number],
  startRegions: number,
  radius: number,
  minY: number,
  maxY: number,
  regionsOf: (cx: number, cy: number, cz: number) => Regions | undefined,
): Reach {
  const [sx, sy, sz] = start;
  const reach = new Reach(sx, sz, radius, minY, maxY);
  const w = reach.width;
  const plane = w * w;
  const size = plane * (maxY - minY + 1);
  const reached = reach.regions;
  const seenFaces = reach.faces;
  // Columns inside the circle.
  const inCircle = new Uint8Array(plane);
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) inCircle[(dz + radius) * w + dx + radius] = dx * dx + dz * dz <= radius * radius ? 1 : 0;
  // Each chunk's regions, looked up once.
  const regs: (Regions | undefined)[] = new Array(size);
  const get = (i: number): Regions => {
    let r = regs[i];
    if (r === undefined) {
      const dx = i % w;
      const t = (i - dx) / w;
      const dz = t % w;
      const ly = (t - dz) / w;
      r = regionsOf(sx - radius + dx, minY + ly, sz - radius + dz) ?? OPEN_REGIONS;
      regs[i] = r;
    }
    return r;
  };
  if (nodes.length < size * MAX_REGIONS) {
    nodes = new Int32Array(size * MAX_REGIONS);
    nodeTaken = new Uint8Array(size * MAX_REGIONS);
  }
  const queue = nodes;
  const takenOf = nodeTaken;
  let tail = 0;

  const i0 = reach.index(sx, sy, sz);
  let first = get(i0);
  // A chunk with no open region (the eye in the rock): as if it were open, as the old walk did.
  if (first.count === 0) regs[i0] = first = OPEN_REGIONS;
  let mask = startRegions & ((1 << first.count) - 1);
  if (mask === 0) mask = (1 << first.count) - 1;
  reached[i0] = mask;
  for (let r = 0; r < first.count; r++) {
    if (!(mask & (1 << r))) continue;
    queue[tail] = i0 * 16 + r;
    takenOf[tail++] = 0;
  }

  for (let head = 0; head < tail; head++) {
    const node = queue[head];
    const taken = takenOf[head];
    const i = node >> 4;
    const r = node & 15;
    const mine = get(i);
    const touches = mine.faces[r];
    const dx = i % w;
    const t = (i - dx) / w;
    const dz = t % w;
    const ly = (t - dz) / w;
    for (let face = 0; face < 6; face++) {
      if (!(touches & (1 << face))) continue;
      let ni: number;
      if (face === 0) {
        if (dx === 0 || !inCircle[dz * w + dx - 1]) continue;
        ni = i - 1;
      } else if (face === 1) {
        if (dx === w - 1 || !inCircle[dz * w + dx + 1]) continue;
        ni = i + 1;
      } else if (face === 2) {
        if (ly === 0) continue;
        ni = i - plane;
      } else if (face === 3) {
        if (minY + ly === maxY) continue;
        ni = i + plane;
      } else if (face === 4) {
        if (dz === 0 || !inCircle[(dz - 1) * w + dx]) continue;
        ni = i - w;
      } else {
        if (dz === w - 1 || !inCircle[(dz + 1) * w + dx]) continue;
        ni = i + w;
      }
      // The neighbour's walls on this face look into this region.
      seenFaces[ni] |= 1 << (face ^ 1);
      if (taken & (1 << (face ^ 1))) continue; // never back towards where we came from
      const fresh = linkMask(mine, face, get(ni), r) & ~reached[ni];
      if (!fresh) continue;
      reached[ni] |= fresh;
      for (let b = 0; b < MAX_REGIONS; b++) {
        if (!(fresh & (1 << b))) continue;
        queue[tail] = ni * 16 + b;
        takenOf[tail++] = taken | (1 << face);
      }
    }
  }

  let chunks = 0;
  for (let i = 0; i < size; i++) if (reached[i] | seenFaces[i]) chunks++;
  reach.chunks = chunks;
  reach.regionCount = tail;
  reach.used = regs;
  return reach;
}

// ---------------------------------------------------------------------------------------------
// The walk from chunk to chunk (until Milestone 15): kept for comparison in the bench and tests.

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

/** Which faces of a chunk see each other through its open space: a 15-bit mask of `connects` pairs. */
export function connectivityOf(regions: Regions): number {
  let mask = 0;
  for (let r = 0; r < regions.count; r++) mask |= PAIRS_OF[regions.faces[r]];
  return mask;
}

/** `connectivityOf` the chunk's regions. */
export const chunkConnectivity = (blocks: Uint8Array): number => connectivityOf(chunkRegions(blocks));

/**
 * The chunks that could be seen from chunk `start` by the walk from chunk to chunk: into a
 * neighbour through a face, and out of it only through a face connected to the one it came in
 * by, within the chunks `inRange` allows. `connectivity` gives a chunk's mask (ALL_CONNECTED for
 * one not loaded yet). Returns their keys.
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
