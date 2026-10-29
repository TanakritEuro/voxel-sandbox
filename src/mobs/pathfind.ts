// Paths for mobs: A* over the places a mob can stand, on the block grid. Pure.
//
// A node is a block position (x, y, z) a mob's feet can be at: something solid under it and room
// for the mob's height above, dry (or, for kinds that swim, the water's surface). From a node the
// search tries the eight columns around it, diagonals only with both sides open so nothing cuts a
// corner, and in each takes the highest place within the mob's climb (`step`) and fall (`drop`):
// with room over its head to jump up, or an open column to drop down. Steps cost their length
// (1 or √2), climbing a little more, swimming four times as much; the heuristic is the octile
// distance, which never overestimates.
//
// A search gives up after `maxNodes` places or beyond `range` blocks from where it started, so a
// mob with no way somewhere learns it quickly. Blocks come through `getBlock`, which reads an
// unloaded chunk as air: with nothing to stand on there, no path goes into one.
//
// Costs and links live in typed arrays indexed by a node's place in the box the range allows,
// reused from search to search (a stamp says which search wrote them), so a search allocates
// next to nothing.

import { BLOCKS } from '../world/blocks';
import { WORLD_HEIGHT } from '../world/coords';
import type { BlockSource } from '../world/physics';

export interface PathOptions {
  /** Room the mob needs above its feet, in whole blocks. */
  height: number;
  /** Highest step up it takes, and deepest drop, in blocks. */
  step: number;
  drop: number;
  /** May it swim across water (at the surface)? */
  swim: boolean;
  /** Places looked at before giving up, and blocks from the start (on x or z) it may go. */
  maxNodes: number;
  range: number;
  /** Arrive within this many blocks of the target, across (0: exactly there). */
  near: number;
}

/** The farthest any search may range (the size of the reused arrays). */
export const MAX_RANGE = 24;

export const DEFAULT_PATH: PathOptions = { height: 1, step: 1, drop: 3, swim: false, maxNodes: 2000, range: MAX_RANGE, near: 0 };

/** A path: the places to walk through, from the first after the start to the end. */
export type Path = [number, number, number][];

export interface Search {
  path: Path | null;
  /** Places taken off the open list (for measuring). */
  expanded: number;
}

/** Extra cost of a step up, per block; and what a swimming step costs against a dry one. */
const CLIMB_COST = 0.5;
const SWIM_COST = 4;
const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

// Block flags as local arrays: the hot loop reads them thousands of times a search.
const PASSABLE = new Uint8Array(256);
const LIQUID = new Uint8Array(256);
BLOCKS.forEach((info, b) => {
  PASSABLE[b] = info.passable ? 1 : 0;
  LIQUID[b] = info.liquid ? 1 : 0;
});

// The reused arrays: one entry per block in the box (2 MAX_RANGE + 3)² × WORLD_HEIGHT.
const SPAN = 2 * (MAX_RANGE + 1) + 1;
const H = WORLD_HEIGHT;
const SIZE = SPAN * SPAN * H;
const cost = new Float32Array(SIZE);
const estimate = new Float32Array(SIZE);
const parent = new Int32Array(SIZE);
/** The search that last touched an entry: 2 × search + 1 when closed, 2 × search when open. */
const mark = new Uint32Array(SIZE);
let searchNo = 0;
/** The open list: a binary heap of node indices by `estimate`. */
let heap = new Int32Array(4096);
let heapSize = 0;

function push(n: number): void {
  if (heapSize === heap.length) {
    const bigger = new Int32Array(heap.length * 2);
    bigger.set(heap);
    heap = bigger;
  }
  let i = heapSize++;
  const f = estimate[n];
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (estimate[heap[p]] <= f) break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = n;
}

function pop(): number {
  const top = heap[0];
  const last = heap[--heapSize];
  if (heapSize > 0) {
    const f = estimate[last];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= heapSize) break;
      const r = l + 1;
      const m = r < heapSize && estimate[heap[r]] < estimate[heap[l]] ? r : l;
      if (estimate[heap[m]] >= f) break;
      heap[i] = heap[m];
      i = m;
    }
    heap[i] = last;
  }
  return top;
}

/** Octile distance across, plus nothing for height (climbing only ever adds). */
function octile(dx: number, dz: number): number {
  const a = Math.abs(dx);
  const b = Math.abs(dz);
  return a > b ? a + (SQRT2 - 1) * b : b + (SQRT2 - 1) * a;
}

/**
 * The cheapest way from `start` (the block the mob's feet are in) to `goal` (within `near`
 * across, and a block up or down), or null when there's none within the limits.
 */
export function findPath(world: BlockSource, start: readonly [number, number, number], goal: readonly [number, number, number], options: Partial<PathOptions> = {}): Search {
  const o: PathOptions = { ...DEFAULT_PATH, ...options };
  const range = Math.min(o.range, MAX_RANGE);
  const { height, step, drop, swim, near } = o;
  const [sx, sy, sz] = start;
  const [gx, gy, gz] = goal;
  const R = MAX_RANGE + 1;
  const ox = sx - R;
  const oz = sz - R;
  const nearY = near > 0 ? 1 : 0;
  if (sy < 1 || sy >= H) return { path: null, expanded: 0 };

  const get = (x: number, y: number, z: number) => world.getBlock(x, y, z);
  /** Room for `h` blocks from y up, all open (passable, not liquid). */
  const room = (x: number, y: number, z: number, h: number): boolean => {
    for (let i = 0; i < h; i++) {
      const b = get(x, y + i, z);
      if (!PASSABLE[b] || LIQUID[b]) return false;
    }
    return true;
  };
  /** 1 standing on dry ground, 2 swimming at the surface, 0 not a place to be. */
  const placeAt = (x: number, y: number, z: number): number => {
    if (y < 1 || y + height > H) return 0;
    if (!PASSABLE[get(x, y - 1, z)] && room(x, y, z, height)) return 1;
    if (swim && LIQUID[get(x, y, z)] && !LIQUID[get(x, y + 1, z)] && room(x, y + 1, z, height > 1 ? height - 1 : 1)) return 2;
    return 0;
  };

  searchNo++;
  if (searchNo >= 0x7fffffff) {
    mark.fill(0);
    searchNo = 1;
  }
  const OPEN = searchNo * 2;
  const CLOSED = OPEN + 1;
  heapSize = 0;
  const index = (x: number, y: number, z: number) => ((x - ox) * SPAN + (z - oz)) * H + y;
  const s = index(sx, sy, sz);
  cost[s] = 0;
  estimate[s] = octile(gx - sx, gz - sz);
  parent[s] = -1;
  mark[s] = OPEN;
  push(s);
  let expanded = 0;

  while (heapSize > 0 && expanded < o.maxNodes) {
    const n = pop();
    if (mark[n] === CLOSED) continue;
    mark[n] = CLOSED;
    expanded++;
    const y = n % H;
    const col = (n - y) / H;
    const z = (col % SPAN) + oz;
    const x = (col - (z - oz)) / SPAN + ox;
    if (octile(x - gx, z - gz) <= near + 1e-6 && Math.abs(y - gy) <= nearY) return { path: walkBack(n, ox, oz), expanded };
    const here = cost[n];
    for (let d = 0; d < 8; d++) {
      const dx = DX[d];
      const dz = DZ[d];
      const nx = x + dx;
      const nz = z + dz;
      if (nx - sx > range || sx - nx > range || nz - sz > range || sz - nz > range) continue;
      // No cutting corners: both sides of a diagonal open at this height.
      if (dx !== 0 && dz !== 0 && (!room(x + dx, y, z, height) || !room(x, y, z + dz, height))) continue;
      // The highest place within the climb and drop it can get to in that column.
      let ny = y + step;
      let kind = 0;
      for (; ny >= y - drop; ny--) {
        kind = placeAt(nx, ny, nz);
        if (!kind) continue;
        // Up: room over its head here to jump. Down: walk out at this height, an open column to fall through.
        if (ny > y ? room(x, y + height, z, ny - y) : ny < y ? room(nx, ny, nz, y - ny + height) : true) break;
        kind = 0;
      }
      if (!kind) continue;
      const m = index(nx, ny, nz);
      if (mark[m] === CLOSED) continue;
      const total = here + (dx !== 0 && dz !== 0 ? SQRT2 : 1) * (kind === 2 ? SWIM_COST : 1) + (ny > y ? (ny - y) * CLIMB_COST : 0);
      if (mark[m] === OPEN && total >= cost[m]) continue;
      cost[m] = total;
      estimate[m] = total + octile(gx - nx, gz - nz);
      parent[m] = n;
      mark[m] = OPEN;
      push(m);
    }
  }
  return { path: null, expanded };
}

function walkBack(end: number, ox: number, oz: number): Path {
  const path: Path = [];
  for (let n = end; parent[n] !== -1; n = parent[n]) {
    const y = n % H;
    const col = (n - y) / H;
    const z = (col % SPAN) + oz;
    path.push([(col - (z - oz)) / SPAN + ox, y, z]);
  }
  return path.reverse();
}
