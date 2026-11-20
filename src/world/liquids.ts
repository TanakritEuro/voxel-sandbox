// Flowing liquids, water and lava: one cellular automaton over the blocks, run for each liquid from
// its description (`Liquid`: its blocks, how far it spreads and looks for a drop). Pure. Below, as
// for water; lava spreads 3 rather than 7, and looks 2 for a drop rather than 4. To each liquid the
// other is solid; lava touching water (beside, above or below) turns to basalt if it's a source,
// stone if it isn't.
//
// Sources (`Block.Water`: the sea, lakes, water placed) never move. The rest is worked out each
// tick from the neighbours, as they were at the start of the tick:
// - water above: falling water (`WaterFalling`, a full block deep);
// - between two sources, standing on something solid or on a source: a new source;
// - otherwise one level less than the highest water spreading into it from the side, as flowing
//   water (levels 7 down to 1); none spreading into it, no water.
// Water spreads sideways only standing on something solid: over air or other water it falls
// instead. A source or falling water spreads at 7, flowing water at one less than its own level.
// On flat ground it goes only the ways that lead soonest to a drop within `dropSearch` blocks, if
// there are any, so it runs off ledges rather than spreading evenly.
//
// Every change in a tick comes from the start-of-tick state and is returned, not made, so the
// order blocks are looked at doesn't matter: the caller applies them all before the next tick.
// Only blocks woken are looked at: an edit wakes the block and its six neighbours, and every
// change the water makes wakes its own. A settled pool costs nothing. At most `budget` blocks a
// tick, oldest first; the rest wait. Unloaded land counts as a wall.

import { TUNING } from '../config';
import { Block, BLOCKS } from './blocks';
import { MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, WORLD_HEIGHT } from './coords';
import type { BlockSource } from './physics';
import { wakeColumnBlocks } from './wake';
import type { World } from './world';

/** The blocks, and which columns are loaded: a liquid treats unloaded land as a wall. */
export interface LiquidWorld extends BlockSource {
  hasColumn(cx: number, cz: number): boolean;
}

/** A block a tick sets at (x, y, z). */
export type LiquidChange = [number, number, number, Block];

/** A liquid: its blocks and how it moves. */
export interface Liquid {
  name: 'water' | 'lava';
  source: Block;
  falling: Block;
  /** Flowing at level 1; levels up to `levels` follow it. */
  flow1: Block;
  /** Flowing levels: how far it spreads from a source on flat ground. */
  levels: number;
  /** How often it's ticked (seconds), how many blocks a tick at most, how far it looks for a drop. */
  tuning: { tickSeconds: number; maxPerTick: number; dropSearch: number };
}

export const WATER: Liquid = { name: 'water', source: Block.Water, falling: Block.WaterFalling, flow1: Block.WaterFlow1, levels: 7, tuning: TUNING.water };
export const LAVA: Liquid = { name: 'lava', source: Block.Lava, falling: Block.LavaFalling, flow1: Block.LavaFlow1, levels: 3, tuning: TUNING.lava };

// What each block is to a liquid: in its way (the other liquid too), somewhere it can go (air,
// torches), or the liquid itself.
const SOLID = 0;
const OPEN = 1;
const SOURCE = 2;
const FALLING = 3;
const FLOWING = 4;
function kinds(liquid: Liquid): Uint8Array {
  const kind = new Uint8Array(256);
  BLOCKS.forEach((info, b) => {
    const own = b === liquid.source || b === liquid.falling || (b >= liquid.flow1 && b < liquid.flow1 + liquid.levels);
    kind[b] = own ? (b === liquid.source ? SOURCE : b === liquid.falling ? FALLING : FLOWING) : info.passable && !info.liquid ? OPEN : SOLID;
  });
  return kind;
}
const WATER_KIND = kinds(WATER);

/** Water of any kind: what lava turns to stone against. */
const WATERY = new Uint8Array(256);
WATER_KIND.forEach((k, b) => (WATERY[b] = k >= SOURCE ? 1 : 0));

/** Flowing water at `level` (1–7). */
export const flowing = (level: number): Block => (Block.WaterFlow1 + level - 1) as Block;

/** The level of flowing water (1–7); 0 for anything else. */
export const flowLevel = (b: Block): number => (WATER_KIND[b] === FLOWING ? b - Block.WaterFlow1 + 1 : 0);

/** The four sideways steps: +x, -x, +z, -z (each one's opposite is its index ^ 1). */
const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];

// Positions as one number: x and z offset into 21 bits each, y above them.
const OFF = 1 << 20;
const SPAN = 1 << 21;
const keyOf = (x: number, y: number, z: number) => (y * SPAN + (x + OFF)) * SPAN + (z + OFF);

/** The square the drop search can reach, around the water spreading (side `2 * dropSearch + 1`). */
const REACH = 8;
const SIDE = 2 * REACH + 1;

export class LiquidFlow {
  /** What each block is to this liquid; moving (flowing or falling, not a source). */
  private readonly kind: Uint8Array;
  readonly moving = new Uint8Array(256);
  /** Blocks to look at next tick, in the order they were woken. */
  private readonly active = new Set<number>();
  // Per tick: blocks read (by key), columns loaded, and the ways each spreading block goes.
  private readonly blocks = new Map<number, Block>();
  private readonly columns = new Map<number, boolean>();
  private readonly ways = new Map<number, number>();
  private world: LiquidWorld | null = null;
  // The drop search: cells seen (by tick stamp), and the queue (offsets from the start).
  private readonly seen = new Uint32Array(SIDE * SIDE);
  private stamp = 0;
  private readonly queue = new Int16Array(SIDE * SIDE * 3);
  /** For `?stats`: changes in the last tick. */
  changed = 0;

  constructor(readonly liquid: Liquid = WATER) {
    this.kind = kinds(liquid);
    this.kind.forEach((k, b) => (this.moving[b] = k === FLOWING || k === FALLING ? 1 : 0));
  }

  /** Blocks waiting to be looked at. */
  get pending(): number {
    return this.active.size;
  }

  /** Something changed at (x, y, z): look at it and its six neighbours next tick. */
  wake(x: number, y: number, z: number): void {
    this.wakeOne(x, y, z);
    this.wakeOne(x + 1, y, z);
    this.wakeOne(x - 1, y, z);
    this.wakeOne(x, y + 1, z);
    this.wakeOne(x, y - 1, z);
    this.wakeOne(x, y, z + 1);
    this.wakeOne(x, y, z - 1);
  }

  private wakeOne(x: number, y: number, z: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.active.add(keyOf(x, y, z));
  }

  /**
   * One tick: up to `budget` woken blocks, oldest first, each worked out from the world as it is
   * now. Returns the changes, which the caller must make before the next tick; what they touch is
   * woken for it.
   */
  tick(world: LiquidWorld, budget: number = this.liquid.tuning.maxPerTick): LiquidChange[] {
    this.world = world;
    this.blocks.clear();
    this.columns.clear();
    this.ways.clear();
    const keys: number[] = [];
    for (const k of this.active) {
      if (keys.length >= budget) break;
      keys.push(k);
    }
    for (const k of keys) this.active.delete(k);
    const changes: LiquidChange[] = [];
    for (const k of keys) {
      const z = (k % SPAN) - OFF;
      const rest = Math.floor(k / SPAN);
      const x = (rest % SPAN) - OFF;
      const y = Math.floor(rest / SPAN);
      const now = this.block(x, y, z);
      const want = this.wanted(x, y, z, now);
      if (want !== now) changes.push([x, y, z, want]);
    }
    for (const [x, y, z] of changes) this.wake(x, y, z);
    this.changed = changes.length;
    this.world = null;
    return changes;
  }

  /** What the block at (x, y, z), now `b`, should be after this tick. */
  private wanted(x: number, y: number, z: number, b: Block): Block {
    const KIND = this.kind;
    const L = this.liquid;
    const kind = KIND[b];
    if (kind === SOLID) return b;
    // Lava against water: basalt from a source, stone from the rest.
    if (L === LAVA && kind >= SOURCE && this.touchesWater(x, y, z)) return kind === SOURCE ? Block.Basalt : Block.Stone;
    if (kind === SOURCE) return b;
    // The liquid above falls in.
    const above = KIND[this.block(x, y + 1, z)];
    if (above >= SOURCE) return L.falling;
    let sources = 0;
    let best = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const nz = z + DZ[d];
      const nb = this.block(nx, y, nz);
      const nk = KIND[nb];
      if (nk < SOURCE) continue;
      if (nk === SOURCE) sources++;
      // It spreads only standing on something solid, and into this block only if it's one of its ways.
      const level = nk === FLOWING ? nb - L.flow1 : L.levels;
      if (level <= best || KIND[this.block(nx, y - 1, nz)] !== SOLID) continue;
      if (this.waysOf(nx, y, nz) & (1 << (d ^ 1))) best = level;
    }
    if (sources >= 2) {
      const below = KIND[this.block(x, y - 1, z)];
      if (below === SOLID || below === SOURCE) return L.source;
    }
    if (best > 0) return (L.flow1 + best - 1) as Block;
    return kind === OPEN ? b : Block.Air;
  }

  /** Is there water beside, above or below (x, y, z)? */
  private touchesWater(x: number, y: number, z: number): boolean {
    for (let d = 0; d < 4; d++) if (WATERY[this.block(x + DX[d], y, z + DZ[d])]) return true;
    return WATERY[this.block(x, y + 1, z)] === 1 || WATERY[this.block(x, y - 1, z)] === 1;
  }

  /**
   * The ways water spreading from (x, y, z) goes, a bit per direction: towards the nearest drop
   * within `dropSearch` blocks, or every way it can if there's none.
   */
  private waysOf(x: number, y: number, z: number): number {
    const k = keyOf(x, y, z);
    const known = this.ways.get(k);
    if (known !== undefined) return known;
    let open = 0;
    let nearest = Number.POSITIVE_INFINITY;
    let mask = 0;
    for (let d = 0; d < 4; d++) {
      if (!this.enterable(this.block(x + DX[d], y, z + DZ[d]))) continue;
      open |= 1 << d;
      const far = this.dropFrom(x, y, z, d);
      if (far < nearest) {
        nearest = far;
        mask = 1 << d;
      } else if (far === nearest && far !== Number.POSITIVE_INFINITY) mask |= 1 << d;
    }
    const ways = nearest === Number.POSITIVE_INFINITY ? open : mask;
    this.ways.set(k, ways);
    return ways;
  }

  /**
   * Steps to the nearest drop (a block water can fall into from above) going from (x, y, z) first
   * towards `d`, then any way on the same level through blocks water can go into, not back
   * through (x, y, z); infinity if none within `dropSearch` steps.
   */
  private dropFrom(x: number, y: number, z: number, d: number): number {
    const limit = Math.min(this.liquid.tuning.dropSearch, REACH);
    const stamp = ++this.stamp;
    const seen = this.seen;
    const q = this.queue;
    const at = (ox: number, oz: number) => (oz + REACH) * SIDE + (ox + REACH);
    seen[at(0, 0)] = stamp;
    seen[at(DX[d], DZ[d])] = stamp;
    let head = 0;
    let tail = 0;
    q[tail++] = DX[d];
    q[tail++] = DZ[d];
    q[tail++] = 1;
    while (head < tail) {
      const ox = q[head++];
      const oz = q[head++];
      const steps = q[head++];
      if (this.enterable(this.block(x + ox, y - 1, z + oz))) return steps;
      if (steps >= limit) continue;
      for (let e = 0; e < 4; e++) {
        const px = ox + DX[e];
        const pz = oz + DZ[e];
        if (seen[at(px, pz)] === stamp || !this.enterable(this.block(x + px, y, z + pz))) continue;
        seen[at(px, pz)] = stamp;
        q[tail++] = px;
        q[tail++] = pz;
        q[tail++] = steps + 1;
      }
    }
    return Number.POSITIVE_INFINITY;
  }

  /** Can the liquid go into this block: air, a torch, or its own flowing (not a source, not falling)? */
  private enterable(b: Block): boolean {
    const k = this.kind[b];
    return k === OPEN || k === FLOWING;
  }

  /** The block at (x, y, z) as this tick sees it: unloaded land is stone, so a wall. */
  private block(x: number, y: number, z: number): Block {
    const k = keyOf(x, y, z);
    let b = this.blocks.get(k);
    if (b === undefined) {
      const cy = toChunk(y);
      if (cy < MIN_CHUNK_Y) b = Block.Stone;
      else if (cy > MAX_CHUNK_Y) b = Block.Air;
      else b = this.loaded(x, z) ? this.world!.getBlock(x, y, z) : Block.Stone;
      this.blocks.set(k, b);
    }
    return b;
  }

  private loaded(x: number, z: number): boolean {
    const cx = toChunk(x);
    const cz = toChunk(z);
    const k = (cx + 0x8000) * 0x10000 + (cz + 0x8000);
    let yes = this.columns.get(k);
    if (yes === undefined) {
      yes = this.world!.hasColumn(cx, cz);
      this.columns.set(k, yes);
    }
    return yes;
  }
}

/**
 * Column (cx, cz) has just been loaded: wake the moving liquid in it if it was read from the save
 * (`saved`: water left mid-flow carries on), and the moving water in the loaded columns beside it
 * on the faces looking into it (held back while it wasn't loaded, as by a wall). Generated land
 * has no moving water, so those faces only cost a look. Returns the blocks woken.
 */
export function wakeColumn(flow: LiquidFlow, world: World, cx: number, cz: number, saved: boolean): number {
  return wakeColumnBlocks(world, cx, cz, saved, flow.moving, (x, y, z) => flow.wake(x, y, z));
}
