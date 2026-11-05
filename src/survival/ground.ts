// Items lying on the ground (survival): what breaking a block gives, and what's thrown. Each is a
// small box moved by the block physics at its own step (`TUNING.survival.ground`): falling, sliding
// to a stop, bobbing at the top of water. One that has come to rest sleeps, and only looks now and
// then at the block under it, to fall when that goes. The same items lying close together merge
// into one stack. A player within reach picks one up, as much of it as fits; with no room it stays.
// After a while, or when its land unloads, it's gone, and past the cap the oldest go first. Not
// saved. Pure: the game says where the players are and takes what they pick up.

import { TUNING } from '../config';
import { BLOCKS } from '../world/blocks';
import { createBody, HALF_WIDTH, HEIGHT, moveBody, touchesLiquid, underLiquid, type Body, type BlockSource } from '../world/physics';
import type { Stack } from './inventory';
import { itemInfo } from './items';

const G = TUNING.survival.ground;
/** Half an item's width, and its height: a quarter of a block. */
const HALF = 0.125;
const SIZE = 0.25;

export interface GroundItem {
  /** Unique while it lies there (for drawing and for guests). */
  id: number;
  item: number;
  count: number;
  wear?: number;
  body: Body;
  /** Seconds on the ground. */
  age: number;
  /** Seconds before it may be picked up (thrown ones). */
  delay: number;
  /** At rest: no physics until the block under it goes. */
  asleep: boolean;
}

/** Where a player's feet are. */
export interface Picker {
  x: number;
  y: number;
  z: number;
}

export class GroundItems {
  readonly items: GroundItem[] = [];
  private nextId = 1;
  private clock = 0;
  private mergeClock = 0;

  /**
   * Put `stack` on the ground with its middle at (x, y, z), moving at (vx, vy, vz), not to be
   * picked up for `delay` seconds. Past the cap, the oldest go.
   */
  drop(x: number, y: number, z: number, stack: Stack, vx = 0, vy = 0, vz = 0, delay = 0): GroundItem {
    const body = createBody(x, y - SIZE / 2, z, HALF, SIZE);
    body.vx = vx;
    body.vy = vy;
    body.vz = vz;
    const g: GroundItem = { id: this.nextId++, item: stack.item, count: stack.count, body, age: 0, delay, asleep: false };
    if (stack.wear !== undefined) g.wear = stack.wear;
    this.items.push(g);
    if (this.items.length > G.cap) {
      let oldest = 0;
      for (let i = 1; i < this.items.length; i++) if (this.items[i].age > this.items[oldest].age) oldest = i;
      this.items.splice(oldest, 1);
    }
    return g;
  }

  /**
   * `dt` seconds: physics, merging, aging, and picking up. `loaded` says if the land at (x, z) is
   * there (an item off it goes). `take` gives a stack to player `p` of `players` and says how many
   * of it didn't fit; it's called only for items within reach and past their delay.
   */
  update(dt: number, world: BlockSource, loaded: (x: number, z: number) => boolean, players: readonly Picker[], take: (g: GroundItem, p: number) => number): void {
    this.clock += dt;
    let steps = 0;
    while (this.clock >= G.step && steps < 4) {
      this.clock -= G.step;
      steps++;
      for (const g of this.items) this.stepItem(g, world, G.step);
    }
    if (steps === 4) this.clock = 0; // never more than 4 steps behind
    this.mergeClock += dt;
    if (this.mergeClock >= G.mergeEvery) {
      this.mergeClock = 0;
      this.mergeAll();
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const g = this.items[i];
      g.age += dt;
      g.delay = Math.max(0, g.delay - dt);
      if (g.age >= G.life || !loaded(g.body.x, g.body.z)) {
        this.items.splice(i, 1);
        continue;
      }
      if (g.delay > 0) continue;
      const b = g.body;
      for (let p = 0; p < players.length; p++) {
        const pl = players[p];
        // From the item's middle to the nearest of the player's box, so one at the bottom of a hole
        // just dug is in reach from its edge.
        const dx = Math.max(0, Math.abs(b.x - pl.x) - HALF_WIDTH);
        const dz = Math.max(0, Math.abs(b.z - pl.z) - HALF_WIDTH);
        const my = b.y + SIZE / 2;
        const dy = my < pl.y ? pl.y - my : Math.max(0, my - (pl.y + HEIGHT));
        if (Math.hypot(dx, dy, dz) > G.pickup) continue;
        g.count = take(g, p);
        if (g.count <= 0) {
          this.items.splice(i, 1);
          break;
        }
      }
    }
  }

  /** The item with this id, if it's still there. */
  byId(id: number): GroundItem | undefined {
    return this.items.find((g) => g.id === id);
  }

  /** Take it off the ground (picked up elsewhere). */
  remove(id: number): void {
    const i = this.items.findIndex((g) => g.id === id);
    if (i >= 0) this.items.splice(i, 1);
  }

  private stepItem(g: GroundItem, world: BlockSource, dt: number): void {
    const b = g.body;
    if (g.asleep) {
      // Every so often (spread out by id), look under it: gone, and it falls.
      if ((g.age + g.id * 0.037) % G.sleepCheck >= dt) return;
      if (!BLOCKS[world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.01), Math.floor(b.z))].passable) return;
      g.asleep = false;
      b.onGround = false;
    }
    b.inWater = touchesLiquid(b, world);
    let vy = b.vy;
    if (b.inWater) {
      const k = 1 - Math.exp(-G.waterDrag * dt);
      b.vx -= b.vx * k;
      b.vz -= b.vz * k;
      // Up while under, down a little above: it bobs at the top.
      const under = underLiquid(world, b.x, b.y + SIZE * 0.8, b.z);
      vy += ((under ? 1.2 : -0.4) - vy) * k;
    } else {
      const k = 1 - Math.exp(-(b.onGround ? G.friction : G.drag) * dt);
      b.vx -= b.vx * k;
      b.vz -= b.vz * k;
      vy = Math.max(vy - TUNING.player.gravity * dt, -TUNING.player.terminalVelocity);
    }
    const hits = moveBody(b, b.vx * dt, vy * dt, b.vz * dt, world);
    if (hits.x) b.vx = 0;
    if (hits.z) b.vz = 0;
    b.onGround = hits.y && vy < 0;
    b.vy = hits.y ? 0 : vy;
    if (b.onGround && !b.inWater && Math.abs(b.vx) + Math.abs(b.vz) < 0.02) {
      b.vx = b.vz = 0;
      g.asleep = true;
    }
  }

  /** Items of one kind lying within `TUNING.survival.ground.merge` of each other become one stack (up to its size). */
  private mergeAll(): void {
    const near = G.merge;
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      const most = itemInfo(a.item).stack;
      if (most <= 1 || a.count >= most) continue;
      for (let j = this.items.length - 1; j > i; j--) {
        const b = this.items[j];
        if (b.item !== a.item || b.count >= most) continue;
        if (Math.abs(a.body.x - b.body.x) > near || Math.abs(a.body.y - b.body.y) > near || Math.abs(a.body.z - b.body.z) > near) continue;
        const n = Math.min(b.count, most - a.count);
        a.count += n;
        b.count -= n;
        a.age = Math.min(a.age, b.age);
        a.delay = Math.max(a.delay, b.delay);
        if (!b.count) this.items.splice(j, 1);
        if (a.count >= most) break;
      }
    }
  }
}
