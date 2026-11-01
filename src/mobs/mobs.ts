// The mobs around the player: where they appear, when they go, and stepping them all.
//
// A few times a second (`TUNING.mobs.spawnInterval`) it tries one random column 24–64 blocks
// from the player, in a loaded chunk: if its topmost block is the ground of a kind at home in
// the column's biome (grass for mossbacks, sand for beetles...), and so open to the sky and not
// water, a small group of that kind appears there. Up to `max` at once. A mob goes when it's
// further than `despawnDistance` across, or its column unloads. They aren't saved.
//
// Playing together, the host's manager does this round every player: each try is round one of
// them (in turn, at random), never within the spawning distance of any, a mob goes only when it's
// far from all of them, and the cap is `max` for each player, twice `max` at most.
//
// Each frame they're stepped at the fixed rate, reading blocks through one `BlockCache`, with
// path searches stopping for the frame once `pathBudgetMs` is used (a mob whose search must wait
// tries again a moment later).
//
// It also says what the mobs sound like (`takeSounds`): each calls now and then unless resting,
// a hopper lands with a soft thump, a hit one cries out, and the third hit sends it off in a puff.

import { TUNING } from '../config';
import { createRng, FixedStep, type Rng } from '../math';
import { BLOCKS, Block } from '../world/blocks';
import { toChunk, WORLD_HEIGHT } from '../world/coords';
import type { World } from '../world/world';
import { BlockCache } from './blockCache';
import { createMob, hurt, type Mob, type MobContext, pathOptions, stepBrain } from './brain';
import { headroom, KINDS, type MobKind } from './kinds';
import { findPath } from './pathfind';

/** A mob as it was before this frame's steps, to draw it between steps. */
export interface Before {
  x: number;
  y: number;
  z: number;
  yaw: number;
  onGround: boolean;
}

/** What a mob sounds: its call, a cry when hit, a hopper landing, the puff it goes in. */
export type MobVoice = 'call' | 'hurt' | 'land' | 'puff';

/** A sound a mob made, where it was. */
export interface MobSound {
  voice: MobVoice;
  kind: MobKind;
  x: number;
  y: number;
  z: number;
}

export class MobManager {
  readonly mobs: Mob[] = [];
  /** Where each mob was before the last steps (drawn between that and now by `alpha`). */
  readonly before = new Map<Mob, Before>();
  private readonly clock = new FixedStep(TUNING.mobs.step);
  private readonly rng: Rng;
  /** For when mobs call: its own, so sounds don't change where mobs spawn. */
  private readonly voices: Rng;
  /** Seconds until each mob calls next. */
  private readonly calls = new Map<Mob, number>();
  private readonly sounds: MobSound[] = [];
  private nextId = 1;
  private untilSpawn = 0;
  /** For `?stats`: path searches done and put off since the last read, and this frame's time (ms). */
  searches = 0;
  deferred = 0;
  ms = 0;

  constructor(
    private readonly world: World,
    seed: number,
    /** Most at once (`TUNING.mobs.max`, or `?mobs=`). */
    readonly max = TUNING.mobs.max,
  ) {
    this.rng = createRng(seed);
    this.cap = max;
    this.voices = createRng(seed ^ 0x5eed);
  }

  /** 0..1: how far between the last step and the next the present is, for drawing. */
  get alpha(): number {
    return this.clock.alpha;
  }

  /** How many of each kind there are. */
  counts(): number[] {
    const n = KINDS.map(() => 0);
    for (const m of this.mobs) n[m.kind]++;
    return n;
  }

  /** Mobs at once now: `max` for each player, twice `max` at most. */
  private cap: number;

  /** The cap now, by how many players there are (for `?stats`). */
  get limit(): number {
    return this.cap;
  }

  /** Once a frame (dt 0 while paused), with where the players are (x, z): spawn, despawn, think and move. */
  update(dt: number, players: readonly (readonly [number, number])[], daylight: number): void {
    const t0 = performance.now();
    this.cap = Math.min(this.max * Math.max(players.length, 1), this.max * 2);
    this.despawn(players);
    this.untilSpawn -= dt;
    if (this.untilSpawn <= 0 && players.length) {
      this.untilSpawn = TUNING.mobs.spawnInterval;
      // Round one player, chosen at random when there are several (so one alone spawns as it always did).
      const [px, pz] = players.length > 1 ? players[Math.floor(this.rng() * players.length)] : players[0];
      if (this.mobs.length < this.cap) this.trySpawn(px, pz, players);
    }
    const steps = this.clock.advance(dt);
    if (steps > 0) {
      for (const m of this.mobs) this.before.set(m, { x: m.body.x, y: m.body.y, z: m.body.z, yaw: m.yaw, onGround: m.body.onGround });
      const blocks = new BlockCache(this.world);
      const deadline = t0 + TUNING.mobs.pathBudgetMs;
      const ctx: MobContext = {
        blocks,
        daylight,
        findPath: (mob, start, goal, near) => {
          if (performance.now() > deadline) {
            this.deferred++;
            return undefined;
          }
          this.searches++;
          return findPath(blocks, start, goal, pathOptions(mob.kind, near)).path;
        },
      };
      for (let s = 0; s < steps; s++) for (const m of this.mobs) stepBrain(m, ctx);
      for (const m of this.mobs) if (KINDS[m.kind].hops && m.body.onGround && !this.before.get(m)?.onGround) this.sound(m, 'land');
    }
    // Calls, now and then; none at rest.
    if (dt > 0) {
      for (const m of this.mobs) {
        let wait = (this.calls.get(m) ?? this.callWait()) - (m.state === 'rest' ? 0 : dt);
        if (wait <= 0) {
          this.sound(m, 'call');
          wait = this.callWait();
        }
        this.calls.set(m, wait);
      }
    }
    this.ms = performance.now() - t0;
  }

  /**
   * One of each kind in a row four blocks in front of (x, y, z), looking along `yaw`, standing
   * where they can and grazing there for good, turned three-quarters to the viewer (`?showcase`,
   * for looking at the models).
   */
  showcase(x: number, y: number, z: number, yaw: number): void {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    KINDS.forEach((info, kind) => {
      const side = (kind - (KINDS.length - 1) / 2) * 1.8;
      const bx = Math.floor(x + fx * 4 + fz * side);
      const bz = Math.floor(z + fz * 4 - fx * side);
      for (let ny = Math.floor(y) + 3; ny >= Math.floor(y) - 6; ny--) {
        const ground = !BLOCKS[this.world.getBlock(bx, ny - 1, bz)].passable;
        let room = true;
        for (let i = 0; i < headroom(info); i++) room &&= BLOCKS[this.world.getBlock(bx, ny + i, bz)].passable;
        if (!ground || !room) continue;
        const mob = createMob(this.nextId++, kind as MobKind, bx + 0.5, ny, bz + 0.5, kind + 1);
        mob.timer = Number.POSITIVE_INFINITY;
        mob.yaw = yaw + Math.PI * 0.75;
        this.mobs.push(mob);
        return;
      }
    });
  }

  /**
   * The player at (fromX, fromZ) hits `mob`: knocked back, it cries out and flees; the last of
   * `TUNING.mobs.hits` sends it off in a puff instead. True if it's gone.
   */
  hit(mob: Mob, fromX: number, fromZ: number): boolean {
    hurt(mob, fromX, fromZ);
    this.sound(mob, 'hurt');
    if (mob.hits < TUNING.mobs.hits) return false;
    this.sound(mob, 'puff');
    this.remove(mob);
    return true;
  }

  /** The sounds made since the last time this was asked, oldest first. */
  takeSounds(): MobSound[] {
    return this.sounds.splice(0);
  }

  /** Remove a mob (despawned, or gone in a puff). */
  remove(mob: Mob): void {
    const i = this.mobs.indexOf(mob);
    if (i >= 0) this.mobs.splice(i, 1);
    this.before.delete(mob);
    this.calls.delete(mob);
  }

  private sound(mob: Mob, voice: MobVoice): void {
    this.sounds.push({ voice, kind: mob.kind, x: mob.body.x, y: mob.body.y, z: mob.body.z });
  }

  private callWait(): number {
    const [lo, hi] = TUNING.mobs.calls;
    return lo + (hi - lo) * this.voices();
  }

  private despawn(players: readonly (readonly [number, number])[]): void {
    const far = TUNING.mobs.despawnDistance;
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const b = this.mobs[i].body;
      const near = players.some(([px, pz]) => Math.hypot(b.x - px, b.z - pz) <= far);
      const gone = !near || b.y < -16 || !this.world.hasColumn(toChunk(Math.floor(b.x)), toChunk(Math.floor(b.z)));
      if (gone) this.remove(this.mobs[i]);
    }
  }

  /** The mob numbered `id`, if it's here. */
  byId(id: number): Mob | undefined {
    return this.mobs.find((m) => m.id === id);
  }

  /** A try at a group: one random column at spawning distance from (px, pz), and from every one of `players`, as described at the top. */
  trySpawn(px: number, pz: number, players: readonly (readonly [number, number])[] = [[px, pz]]): boolean {
    const [near, far] = TUNING.mobs.spawnDistance;
    const angle = this.rng() * 2 * Math.PI;
    const r = near + (far - near) * this.rng();
    const x = Math.floor(px + Math.sin(angle) * r);
    const z = Math.floor(pz + Math.cos(angle) * r);
    const biome = this.world.generator.climate.dominant(x, z);
    const homed = KINDS.map((_, k) => k as MobKind).filter((k) => KINDS[k].biomes.includes(biome));
    if (!homed.length) return false;
    const kind = homed[Math.floor(this.rng() * homed.length)];
    const info = KINDS[kind];
    if (this.groundAt(x, z, kind) === null) return false;
    const [lo, hi] = info.group;
    const size = lo + Math.floor(this.rng() * (hi - lo + 1));
    let made = 0;
    for (let i = 0; i < size * 3 && made < size && this.mobs.length < this.cap; i++) {
      // The first where the try was, the rest a few blocks round it.
      const gx = i === 0 ? x : x + Math.floor((this.rng() - 0.5) * 7);
      const gz = i === 0 ? z : z + Math.floor((this.rng() - 0.5) * 7);
      if (players.some(([ox, oz]) => Math.hypot(gx + 0.5 - ox, gz + 0.5 - oz) < near)) continue;
      const y = this.groundAt(gx, gz, kind);
      if (y === null) continue;
      this.mobs.push(createMob(this.nextId++, kind, gx + 0.5, y, gz + 0.5, Math.floor(this.rng() * 0x7fffffff)));
      made++;
    }
    return made > 0;
  }

  /**
   * Where a mob of `kind` could appear in column (x, z): on the column's topmost block if that's
   * its kind of ground (so open to the sky, and not water), with room above; the feet's y, or null.
   * Only in loaded columns.
   */
  groundAt(x: number, z: number, kind: MobKind): number | null {
    if (!this.world.hasColumn(toChunk(x), toChunk(z))) return null;
    let y = WORLD_HEIGHT - 1;
    while (y > 0 && this.world.getBlock(x, y, z) === Block.Air) y--;
    const top = this.world.getBlock(x, y, z);
    if (!KINDS[kind].ground.includes(top) || BLOCKS[top].liquid) return null;
    if (y + 1 + headroom(KINDS[kind]) > WORLD_HEIGHT) return null;
    return y + 1;
  }
}
