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
// a hopper lands with a soft thump, a hit one cries out, and the hit that takes the last of its
// health sends it off in a puff.
//
// Hostile kinds (the gloamer and the delver; only when asked, in survival) come apart from the animals: every
// couple of seconds one may appear 24–36 blocks from a player, standing where it's dark (sunlight by
// the daylight, or block light, at most its kind's `darkness`: the surface at night, caves at any
// hour, never by a torch; the delver only below its `below`, round a player who is too), at most `most` for each player; the kinds
// take turns at being tried first. Out on the surface by day it fades into
// a puff. It hunts the players given as prey (`brain.ts`), and its hits are kept for the game to
// take (`takeAttacks`).
//
// Kept animals breed (`TUNING.mobs.breeding`): one fed while grown and not waiting is in love for a
// while; two of a kind in love near each other are paired and court (`brain.ts`), and when they meet a
// young one is born beside them, kept, and each parent waits before it may breed again. Each young one
// stays near a grown one of its kind (its `lead`), the nearest, kept ones first.

import { TUNING } from '../config';
import { createRng, FixedStep, type Rng } from '../math';
import { BLOCKS, Block } from '../world/blocks';
import { toChunk, WORLD_HEIGHT } from '../world/coords';
import type { World } from '../world/world';
import { BlockCache } from './blockCache';
import { createMob, fitBody, hurt, type Mob, type MobContext, pathOptions, type Prey, stepBrain } from './brain';
import { type KeptRecord, KeptAnimals } from './kept';
import { headroom, KINDS, MobKind } from './kinds';
import { findPath } from './pathfind';

/** A mob as it was before this frame's steps, to draw it between steps. */
export interface Before {
  x: number;
  y: number;
  z: number;
  yaw: number;
  onGround: boolean;
}

/** A hostile mob's hit on a player: who (an index into the prey), how hard, and from where. */
export interface Attack {
  target: number;
  /** The kind that hit (for what got a player). */
  kind: MobKind;
  damage: number;
  push: number;
  fromX: number;
  fromZ: number;
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
  /** The hostile kinds, taking turns to appear. */
  private readonly hostileKinds = KINDS.map((_, k) => k as MobKind).filter((k) => KINDS[k].hostile);
  /** Is a dungeon within `TUNING.mobs.dungeonReach` of a player (version 3)? */
  private nearDungeon(p: Prey): boolean {
    return this.world.generator.dungeonNear(p.x, p.y, p.z, TUNING.mobs.dungeonReach);
  }
  /** Seconds since each mob in lava was last burnt. */
  private readonly burning = new Map<Mob, number>();
  private readonly sounds: MobSound[] = [];
  private readonly attacks: Attack[] = [];
  private nextId = 1;
  private untilSpawn = 0;
  private untilHostile = 0;
  /** Which hostile kind is tried first next. */
  private hostileTurn = 0;
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

  /**
   * Once a frame (dt 0 while paused), with where the players are (x, z): spawn, despawn, think and
   * move. `prey`: the players hostile mobs may hunt, and appear round (none: no hostile mobs appear).
   */
  update(dt: number, players: readonly (readonly [number, number])[], daylight: number, prey: readonly Prey[] = []): void {
    const t0 = performance.now();
    this.cap = Math.min(this.max * Math.max(players.length, 1), this.max * 2);
    this.despawn(players);
    this.untilSpawn -= dt;
    if (this.untilSpawn <= 0 && players.length) {
      this.untilSpawn = TUNING.mobs.spawnInterval;
      // Round one player, chosen at random when there are several (so one alone spawns as it always did).
      const [px, pz] = players.length > 1 ? players[Math.floor(this.rng() * players.length)] : players[0];
      if (this.animals() < this.cap) this.trySpawn(px, pz, players);
    }
    this.untilHostile -= dt;
    if (this.untilHostile <= 0 && prey.length) {
      this.untilHostile = TUNING.mobs.hostileInterval;
      const near = prey[Math.floor(this.rng() * prey.length)];
      const delverTurn = this.hostileKinds[this.hostileTurn % this.hostileKinds.length] === MobKind.Delver;
      this.trySpawnHostile(near, prey, daylight);
      // Near a dungeon, delvers come twice as often: a try of their own on the turns that weren't theirs, and twice as many.
      if (!delverTurn && this.nearDungeon(near)) this.trySpawnHostile(near, prey, daylight, MobKind.Delver);
    }
    if (dt > 0) {
      this.fade(daylight);
      this.breed();
    }
    const steps = this.clock.advance(dt);
    if (steps > 0) {
      for (const m of this.mobs) this.before.set(m, { x: m.body.x, y: m.body.y, z: m.body.z, yaw: m.yaw, onGround: m.body.onGround });
      const blocks = new BlockCache(this.world);
      const deadline = t0 + TUNING.mobs.pathBudgetMs;
      const ctx: MobContext = {
        blocks,
        daylight,
        prey,
        attack: (mob, target) => {
          const h = KINDS[mob.kind].hostile!;
          this.attacks.push({ target, kind: mob.kind, damage: h.damage, push: h.push, fromX: mob.body.x, fromZ: mob.body.z });
        },
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
      this.burn(steps * TUNING.mobs.step);
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
   * One of each kind (or of `only`) in a row four blocks in front of (x, y, z), looking along `yaw`,
   * standing where they can and grazing there for good, turned three-quarters to the viewer
   * (`?showcase`, `?showcase=ambler,wader`, for looking at the models).
   */
  showcase(x: number, y: number, z: number, yaw: number, only: readonly MobKind[] = KINDS.map((_, k) => k as MobKind)): void {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    only.forEach((kind, n) => {
      const info = KINDS[kind];
      const side = (n - (only.length - 1) / 2) * 1.8;
      const bx = Math.floor(x + fx * 4 + fz * side);
      const bz = Math.floor(z + fz * 4 - fx * side);
      for (let ny = Math.floor(y) + 12; ny >= Math.floor(y) - 12; ny--) {
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
   * `?farmyard` (`?farmyard=32`): `count` kept animals of every kind in turn, 3–12 blocks round (x, z)
   * on open ground (any animal's), every other one young at an age between born and nearly grown.
   * Up to the kept cap; how many were made.
   */
  farmyard(x: number, z: number, count = 32): number {
    const B = TUNING.mobs.breeding;
    const animals = KINDS.map((_, k) => k as MobKind).filter((k) => !KINDS[k].hostile);
    const grounds = new Set(animals.flatMap((k) => KINDS[k].ground));
    let made = 0;
    for (let i = 0; i < count * 8 && made < count && this.keptCount < TUNING.mobs.kept; i++) {
      const kind = animals[made % animals.length];
      const angle = this.rng() * 2 * Math.PI;
      const r = 3 + 9 * this.rng();
      const gx = Math.floor(x + Math.sin(angle) * r);
      const gz = Math.floor(z + Math.cos(angle) * r);
      if (!this.world.hasColumn(toChunk(gx), toChunk(gz))) continue;
      let y = WORLD_HEIGHT - 1;
      while (y > 0 && this.world.getBlock(gx, y, gz) === Block.Air) y--;
      if (!grounds.has(this.world.getBlock(gx, y, gz)) || y + 1 + headroom(KINDS[kind]) > WORLD_HEIGHT) continue;
      const mob = createMob(this.nextId++, kind, gx + 0.5, y + 1, gz + 0.5, Math.floor(this.rng() * 0x7fffffff));
      mob.kept = true;
      if (made % 2 === 1) mob.grow = B.grow * (0.1 + 0.9 * this.rng());
      fitBody(mob);
      this.mobs.push(mob);
      made++;
    }
    return made;
  }

  /**
   * The player at (fromX, fromZ) hits `mob` for `points` (a hand 1, tools more): knocked back, it
   * cries out and flees (a hostile one comes on); the hit that takes the last of its kind's `health`
   * sends it off in a puff instead. True if it's gone.
   */
  hit(mob: Mob, fromX: number, fromZ: number, points = 1): boolean {
    hurt(mob, fromX, fromZ, points);
    this.sound(mob, 'hurt');
    if (mob.hits < KINDS[mob.kind].health) return false;
    this.sound(mob, 'puff');
    this.remove(mob);
    return true;
  }

  /**
   * Mobs in lava take a hit every `TUNING.lava.mobEvery` seconds, the first at once, knocked up and on
   * the way they face (so one may get out).
   */
  private burn(dt: number): void {
    const every = TUNING.lava.mobEvery;
    const hot: Mob[] = [];
    for (const m of this.mobs) {
      if (!m.body.inLava) {
        this.burning.delete(m);
        continue;
      }
      const t = (this.burning.get(m) ?? every) + dt;
      this.burning.set(m, t >= every ? t - every : t);
      if (t >= every) hot.push(m);
    }
    for (const m of hot) {
      this.hit(m, m.body.x + Math.sin(m.yaw), m.body.z + Math.cos(m.yaw));
      if (!this.mobs.includes(m)) this.burning.delete(m);
    }
  }

  /** The hostile mobs' hits on players since the last time this was asked, oldest first. */
  takeAttacks(): Attack[] {
    return this.attacks.splice(0);
  }

  /** Wild animals around (hostile mobs have a cap of their own; kept animals aren't counted). */
  private animals(): number {
    let n = 0;
    for (const m of this.mobs) if (!KINDS[m.kind].hostile && !m.kept) n++;
    return n;
  }

  /**
   * A try at a hostile mob round `near` (one of `prey`): a random column at its kind's distance
   * from it, the first place from 12 blocks above its feet to 24 below where one could stand in the
   * dark, and not nearer than that to any of `prey`. At most `most` for each of them.
   */
  trySpawnHostile(near: Prey, prey: readonly Prey[], daylight: number, only: MobKind | null = null): boolean {
    const hostile = only === null ? this.hostileKinds : [only];
    const first = only === null ? this.hostileTurn++ % hostile.length : 0;
    for (let n = 0; n < hostile.length; n++) {
      const kind = hostile[(first + n) % hostile.length];
      const info = KINDS[kind];
      const h = info.hostile!;
      // A deep kind comes only for a player down at its depth (it would leave the rest alone).
      if (h.below !== undefined && near.y >= h.below) continue;
      const most = h.most * prey.length * (kind === MobKind.Delver && this.nearDungeon(near) ? 2 : 1);
      if (this.mobs.filter((m) => m.kind === kind).length >= most) continue;
      const angle = this.rng() * 2 * Math.PI;
      const r = h.distance[0] + (h.distance[1] - h.distance[0]) * this.rng();
      const x = Math.floor(near.x + Math.sin(angle) * r);
      const z = Math.floor(near.z + Math.cos(angle) * r);
      if (!this.world.hasColumn(toChunk(x), toChunk(z))) continue;
      if (prey.some((p) => Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) < h.distance[0])) continue;
      const room = headroom(info);
      for (let y = Math.floor(near.y) + 12; y >= Math.floor(near.y) - 24; y--) {
        if (y < 1 || y + room >= WORLD_HEIGHT || (h.below !== undefined && y >= h.below)) continue;
        if (BLOCKS[this.world.getBlock(x, y - 1, z)].passable) continue;
        let fits = true;
        for (let i = 0; i < room && fits; i++) {
          const b = BLOCKS[this.world.getBlock(x, y + i, z)];
          fits = b.passable && !b.liquid;
        }
        if (!fits || this.lightAt(x, y, z, daylight) > h.darkness) continue;
        this.mobs.push(createMob(this.nextId++, kind, x + 0.5, y, z + 0.5, Math.floor(this.rng() * 0x7fffffff)));
        return true;
      }
    }
    return false;
  }

  /** How light it is at a block: its sunlight by the daylight, or its block light, the brighter. */
  private lightAt(x: number, y: number, z: number, daylight: number): number {
    const l = this.world.getLight(x, y, z);
    return Math.max(Math.round((l >> 4) * daylight), l & 15);
  }

  /** Hostile mobs out in the day fade into a puff: daylight on them, the sun reaching them strongly. */
  private fade(daylight: number): void {
    if (daylight < 0.5) return;
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const h = KINDS[m.kind].hostile;
      if (!h) continue;
      const b = m.body;
      const sun = this.world.getLight(Math.floor(b.x), Math.floor(b.y + b.height - 0.1), Math.floor(b.z)) >> 4;
      if (sun < h.fadeSun) continue;
      this.sound(m, 'puff');
      this.faded.push(m);
      this.remove(m);
    }
  }

  /** Hostile mobs gone in daylight since the last time this was asked (for their puffs of smoke). */
  takeFaded(): Mob[] {
    return this.faded.splice(0);
  }

  private readonly faded: Mob[] = [];

  /** The sounds made since the last time this was asked, oldest first. */
  takeSounds(): MobSound[] {
    return this.sounds.splice(0);
  }

  /** Kept animals whose columns aren't loaded (the game gives it the saved ones). */
  kept = new KeptAnimals();

  /** Kept animals, here and stored. */
  get keptCount(): number {
    let n = this.kept.stored;
    for (const m of this.mobs) if (m.kept) n++;
    return n;
  }

  /**
   * Feed `mob` `item`: false unless it's the mob's food. A wild animal fed is kept, while there are
   * fewer than `TUNING.mobs.kept`.
   */
  feed(mob: Mob, item: number): boolean {
    const B = TUNING.mobs.breeding;
    if (KINDS[mob.kind].food === undefined || KINDS[mob.kind].food !== item) return false;
    if (!mob.kept) {
      if (this.keptCount < TUNING.mobs.kept) mob.kept = true;
    } else if (mob.grow > 0) mob.grow = Math.max(0, mob.grow - B.grow * B.feedGrow);
    else if (mob.love > 0 || mob.wait > 0) return false;
    else mob.love = B.love;
    this.sound(mob, 'call');
    return true;
  }

  /** Young ones born since the last time this was asked (for the game's burst of pink). */
  takeBorn(): Mob[] {
    return this.born.splice(0);
  }

  private readonly born: Mob[] = [];

  /**
   * Once a frame: pairs out of love, or one no longer courting, are let go; animals in love and not
   * paired are paired with the nearest of their kind in love within `near`; a pair whose boxes
   * meet make a young one; young ones without a grown one to follow are given the nearest.
   */
  private breed(): void {
    const B = TUNING.mobs.breeding;
    for (const m of this.mobs) {
      const mate = m.mate;
      if (!mate) continue;
      if (m.love > 0 && mate.love > 0 && m.state === 'court' && mate.state === 'court' && mate.mate === m && this.mobs.includes(mate)) continue;
      m.mate = null;
      if (m.state === 'court') m.state = 'idle';
    }
    for (const m of this.mobs) {
      if (m.love <= 0 || m.mate || !m.kept || m.state === 'flee') continue;
      let best: Mob | null = null;
      let bestD = B.near;
      for (const o of this.mobs) {
        if (o === m || o.kind !== m.kind || o.love <= 0 || o.mate || !o.kept || o.state === 'flee') continue;
        const d = Math.hypot(o.body.x - m.body.x, o.body.y - m.body.y, o.body.z - m.body.z);
        if (d <= bestD) [best, bestD] = [o, d];
      }
      if (!best) continue;
      for (const [a, b] of [[m, best], [best, m]] as const) {
        a.mate = b;
        a.state = 'court';
        a.timer = 0;
        a.path = null;
      }
    }
    for (const m of [...this.mobs]) {
      const o = m.mate;
      if (!o || m.id > o.id) continue;
      const a = m.body;
      const b = o.body;
      const gap = Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) - a.halfWidth - b.halfWidth;
      if (gap > B.meet || Math.abs(a.y - b.y) > 1) continue;
      for (const p of [m, o]) {
        p.love = 0;
        p.mate = null;
        p.wait = B.wait;
        p.state = 'idle';
        p.timer = 1;
        p.path = null;
      }
      // At the cap, no young one (the parents wait all the same).
      if (this.keptCount >= TUNING.mobs.kept) continue;
      const young = createMob(this.nextId++, m.kind, (a.x + b.x) / 2, Math.max(a.y, b.y), (a.z + b.z) / 2, Math.floor(this.rng() * 0x7fffffff));
      young.kept = true;
      young.grow = B.grow;
      young.lead = m;
      fitBody(young);
      this.mobs.push(young);
      this.born.push(young);
      this.sound(young, 'call');
    }
    for (const m of this.mobs) {
      if (m.grow <= 0) {
        m.lead = null;
        continue;
      }
      if (m.lead && m.lead.grow <= 0 && this.mobs.includes(m.lead)) continue;
      m.lead = null;
      let bestD = B.lead;
      let bestKept = false;
      for (const o of this.mobs) {
        if (o === m || o.kind !== m.kind || o.grow > 0) continue;
        const d = Math.hypot(o.body.x - m.body.x, o.body.y - m.body.y, o.body.z - m.body.z);
        if (d > B.lead || (bestKept && !o.kept) || (d > bestD && o.kept === bestKept)) continue;
        m.lead = o;
        bestD = d;
        bestKept = o.kept;
      }
    }
  }

  /** Column (cx, cz) has loaded: its kept animals come back where they were. */
  columnLoaded(cx: number, cz: number): void {
    for (const r of this.kept.take(cx, cz)) this.mobs.push(this.fromRecord(r));
  }

  /** Every kept animal, here and stored, as saved. */
  keptRecords(): KeptRecord[] {
    const out = this.kept.all();
    for (const m of this.mobs) if (m.kept) out.push(recordOf(m));
    return out;
  }

  private fromRecord(r: KeptRecord): Mob {
    const mob = createMob(this.nextId++, r.kind, r.x, r.y, r.z, Math.floor(this.rng() * 0x7fffffff));
    mob.kept = true;
    mob.grow = r.grow;
    mob.wait = r.wait;
    fitBody(mob);
    return mob;
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
      const mob = this.mobs[i];
      const b = mob.body;
      const loaded = this.world.hasColumn(toChunk(Math.floor(b.x)), toChunk(Math.floor(b.z)));
      if (mob.kept) {
        // Kept: stored when its land unloads, never let go for being far (fallen out of the world, gone).
        if (!loaded) this.kept.store(recordOf(mob));
        if (!loaded || b.y < -16) this.remove(mob);
        continue;
      }
      const near = players.some(([px, pz]) => Math.hypot(b.x - px, b.z - pz) <= far);
      if (!near || b.y < -16 || !loaded) this.remove(mob);
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
    // Wild ones up to the cap (kept animals and hostile ones aren't counted).
    let wild = this.animals();
    for (let i = 0; i < size * 3 && made < size && wild < this.cap; i++) {
      // The first where the try was, the rest a few blocks round it.
      const gx = i === 0 ? x : x + Math.floor((this.rng() - 0.5) * 7);
      const gz = i === 0 ? z : z + Math.floor((this.rng() - 0.5) * 7);
      if (players.some(([ox, oz]) => Math.hypot(gx + 0.5 - ox, gz + 0.5 - oz) < near)) continue;
      const y = this.groundAt(gx, gz, kind);
      if (y === null) continue;
      this.mobs.push(createMob(this.nextId++, kind, gx + 0.5, y, gz + 0.5, Math.floor(this.rng() * 0x7fffffff)));
      made++;
      wild++;
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

/** A kept mob as stored and saved. */
function recordOf(mob: Mob): KeptRecord {
  return { kind: mob.kind, x: mob.body.x, y: mob.body.y, z: mob.body.z, grow: mob.grow, wait: mob.wait };
}

