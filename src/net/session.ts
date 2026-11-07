// A game open to friends: the host's side (`HostSession`) and a guest's (`GuestSession`). Pure
// apart from the links they're given (the clock is passed in), so tests run a host and its guests
// over the test network (`loopback.ts`).
//
// The host owns the world. A guest generates the land itself from the seed and asks the host only
// for edited chunks, as its loader comes to them (`RemoteSaves`: the loader's `ChunkSaves`). A
// guest's edit shows on its screen at once and goes to the host as a request; the host checks it,
// makes it, and sends it to every guest (the one who asked included), or tells that guest it was
// refused and what the block is. Every guest makes the host's edits in the host's order, so all
// end the same as the host.
//
// An edit can arrive for a column a guest hasn't got: it then marks the column as edited (so the
// guest asks for it when it comes to load it) and keeps the block, the latest for each place, until
// the column is added. A column being made while the edit arrived (asked for, or generating)
// would miss it otherwise; for one the host's answer already had, making it again changes nothing.

import type { WorldMode } from '../save/store';
import type { ChunkSaves } from '../chunkLoader';
import { TUNING } from '../config';
import type { MobSound } from '../mobs/mobs';
import type { Mob } from '../mobs/brain';
import type { SavedChunk } from '../workers/protocol';
import { toChunk } from '../world/coords';
import type { Block } from '../world/blocks';
import { partnerOf } from '../world/parts';
import type { Link, Room } from './link';
import { MobMirror } from './mobMirror';
import { packMobs, packMobSounds, unpackMobs, unpackMobSounds } from './mobState';
import { type GroundSnap, packGround, unpackGround } from './itemState';
import type { Stack } from '../survival/inventory';
import { packState, type PlayerState, unpackState } from './playerState';
import { RemotePlayer } from './remotePlayer';
import { type BlockChange, checkChunk, MAX_PLAYERS, type Message, packEdits, parseMessage, type PlayerInfo, PROTOCOL, unpackEdits } from './protocol';

/** What the host's game gives its session. */
export interface HostWorld {
  seed: number;
  /** Time of day now, 0–1. */
  time(): number;
  /** Where the host stands. */
  position(): [number, number, number];
  /** Columns with edited chunks, as (cx, cz) pairs one after another. */
  editedColumns(): number[];
  /** Column (cx, cz)'s edited chunks, run-length encoded. */
  columnChunks(cx: number, cz: number): Promise<SavedChunk[]>;
  /** Player `player` asks for a block: make the edit if it's allowed, and say whether it was. */
  edit(player: number, x: number, y: number, z: number, block: number): boolean;
  /** Player `player` uses block (x, y, z) (`useAt`): make it if it's allowed; the places it set (a door's two halves), or null if it wasn't. */
  use(player: number, x: number, y: number, z: number): [number, number, number][] | null;
  blockAt(x: number, y: number, z: number): number;
  /** Player `player` hit mob `id` for `points`: the game checks it's in reach and makes the hit. */
  hitMob(player: number, id: number, points: number): void;
  /** The world's mode now. */
  mode(): WorldMode;
  /** The survival state kept for a guest called `name`, or null. */
  kept(name: string): Record<string, unknown> | null;
  /** Keep `survival` for a guest called `name` (cleaned by the game). */
  keep(name: string, survival: Record<string, unknown>): void;
  /** Player `player` drops `stack` on the ground at (x, y, z), moving at (vx, vy, vz), not to be picked up for `delay` s. */
  drop(player: number, stack: Stack, x: number, y: number, z: number, vx: number, vy: number, vz: number, delay: number): void;
  /** Player `player` picks up `count` of item `id` on the ground: what they get (taken off the ground), or null (gone, or out of reach). */
  take(player: number, id: number, count: number): Stack | null;
  /** What's in the furnace at (x, y, z) for player `player` (`Furnace.toJSON`), or null if there's none there or it's out of reach. */
  container(player: number, x: number, y: number, z: number): Record<string, unknown> | null;
  /** Player `player` puts `stack` into a slot of the furnace at (x, y, z): what didn't go in (back to them), or null. */
  containerPut(player: number, x: number, y: number, z: number, slot: number, stack: Stack): Stack | null;
  /** Player `player` takes what's in a slot of the furnace at (x, y, z): what they get, or null. */
  containerTake(player: number, x: number, y: number, z: number, slot: number): Stack | null;
}

/** What a guest's game gives its session, once the world is made. */
export interface GuestWorld {
  /** Make blocks the host set (blocks, light, remeshing), in this order; `water` a tick of flowing water. */
  apply(changes: BlockChange[], water: boolean): void;
  hasColumn(cx: number, cz: number): boolean;
}

export type Welcome = Extract<Message, { type: 'welcome' }>;

/** How often a guest asks the host's time back (s), for the round trip. */
const PING_EVERY = 2;
/** Round trips a guest keeps: the host's clock is reckoned from the quickest of them. */
const PINGS = 16;
/** Blocks a guest keeps for columns it hasn't got, at most; past that the oldest columns' go. */
const MOST_KEPT = 200_000;

const columnKey = (cx: number, cz: number) => `${cx},${cz}`;
/** A whole ArrayBuffer holding just these bytes (a typed array may be a view into a bigger one). */
const bufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

// --- The host ------------------------------------------------------------------------------

export class HostSession {
  /** Everyone in, the host first. */
  readonly players: PlayerInfo[];
  /** Something to tell the host's player (someone joined, left). */
  onEvent: (text: string) => void = () => {};
  /** The guests as this browser sees them, by player number. */
  readonly remotes = new Map<number, RemotePlayer>();
  /** The host's own last state. */
  own: PlayerState | null = null;
  private readonly guests = new Map<number, Link>();
  /** The furnace each guest has open, by player. */
  private readonly watching = new Map<number, [number, number, number]>();
  /** What each guest was last sent of its furnace (JSON), so it's sent only when it changes. */
  private readonly watched = new Map<number, string>();
  /** What each guest was last sent of the ground, and when: items at rest aren't sent again and again. */
  private readonly groundSent = new Map<number, { bytes: Uint8Array; at: number }>();
  private closed = false;

  constructor(
    private readonly room: Room,
    private readonly world: HostWorld,
    name: string,
    private readonly now: () => number,
  ) {
    this.players = [{ id: 0, name }];
    room.onGuest = (link) => this.greet(link);
  }

  get code(): string {
    return this.room.code;
  }

  /** The host's clock (s): the one every state is timed on. */
  clock(): number {
    return this.now();
  }

  /** The host player's state now: to every guest. */
  sendState(state: Omit<PlayerState, 'time'>): void {
    this.own = { ...state, time: this.now() };
    if (!this.guests.size) return;
    const data = packState(this.own);
    for (const link of this.guests.values()) link.send({ type: 'state', id: 0, data }, 'frames');
  }

  /** Where everyone is, as last heard (the host's own included): for checking edits. */
  states(): Map<number, PlayerState> {
    const out = new Map<number, PlayerState>();
    if (this.own) out.set(0, this.own);
    for (const [id, r] of this.remotes) if (r.latest) out.set(id, r.latest);
    return out;
  }

  /** The world's mode changed: every guest plays it from now on. */
  shareMode(mode: WorldMode): void {
    for (const link of this.guests.values()) link.send({ type: 'mode', mode });
  }

  /** The host's own blocks set (its edits, `water`: a tick of flowing water): to every guest. */
  shareEdits(changes: readonly BlockChange[], from = 0, seq = 0, water = false): void {
    if (!changes.length || !this.guests.size) return;
    const data = packEdits(changes);
    for (const link of this.guests.values()) link.send({ type: 'edits', from, seq, data, water });
  }

  /**
   * The mobs (`TUNING.net.mobRate` times a second): to each guest, those within the despawning
   * distance of where it was last heard, and the sounds made within hearing of it since last time.
   */
  shareMobs(mobs: readonly Mob[], sounds: readonly MobSound[]): void {
    const far = TUNING.mobs.despawnDistance;
    const hearing = TUNING.mobs.hearing;
    const time = this.now();
    for (const [id, link] of this.guests) {
      const at = this.remotes.get(id)?.latest;
      if (!at) continue;
      const near = mobs.filter((m) => Math.hypot(m.body.x - at.x, m.body.z - at.z) <= far);
      link.send({ type: 'mobs', time, data: packMobs(near) }, 'frames');
      const heard = sounds.filter((s) => Math.hypot(s.x - at.x, s.y - at.y, s.z - at.z) <= hearing);
      if (heard.length) link.send({ type: 'mobsounds', data: packMobSounds(heard) });
    }
  }

  /**
   * The items lying on the ground (with the mobs): to each guest, those within the despawning distance
   * of it. Only when that has changed, or a second on (`frames` may lose one), as most lie still.
   */
  shareGround(items: readonly { id: number; item: number; count: number; body: { x: number; y: number; z: number } }[]): void {
    const far = TUNING.mobs.despawnDistance;
    for (const [id, link] of this.guests) {
      const at = this.remotes.get(id)?.latest;
      if (!at) continue;
      const near = items.filter((g) => Math.hypot(g.body.x - at.x, g.body.z - at.z) <= far).slice(0, 512);
      const data = packGround(near);
      const bytes = new Uint8Array(data).slice();
      const last = this.groundSent.get(id);
      const now = this.now();
      if (last && now - last.at < 1 && last.bytes.length === bytes.length && last.bytes.every((b, i) => b === bytes[i])) continue;
      this.groundSent.set(id, { bytes, at: now });
      link.send({ type: 'ground', data }, 'frames');
    }
  }

  /** What's in the furnaces guests have open, to each of them, when it has changed. */
  shareContainers(): void {
    for (const [id, [x, y, z]] of this.watching) this.sendContainer(id, x, y, z);
  }

  /** A hostile mob hit guest `player` for `damage` and a push away from (fromX, fromZ). */
  hurt(player: number, damage: number, push: number, fromX: number, fromZ: number): void {
    this.guests.get(player)?.send({ type: 'hurt', damage, push, fromX, fromZ });
  }

  private sendContainer(id: number, x: number, y: number, z: number, always = false): void {
    const link = this.guests.get(id);
    const state = this.world.container(id, x, y, z);
    if (!link) return;
    if (!state) {
      // Gone (broken) or out of reach: it's closed for them.
      this.watching.delete(id);
      this.watched.delete(id);
      return;
    }
    const json = JSON.stringify(state);
    if (!always && this.watched.get(id) === json) return;
    this.watched.set(id, json);
    link.send({ type: 'contents', x, y, z, state });
  }

  /** The time of day now (every `TUNING.net.timeEvery` seconds): to every guest. */
  shareTime(time: number): void {
    for (const link of this.guests.values()) link.send({ type: 'time', time });
  }

  /** Close the world to friends: tell them why, and hang up. */
  close(reason = 'The host closed the world.'): void {
    if (this.closed) return;
    this.closed = true;
    for (const link of this.guests.values()) link.send({ type: 'bye', reason });
    this.guests.clear();
    this.players.splice(1);
    this.room.close();
  }

  /** A guest's link: nothing but a hello until it's in. */
  private greet(link: Link): void {
    link.onClose = () => {};
    link.onMessage = (raw) => {
      const m = parseMessage(raw);
      if (m?.type !== 'hello') return;
      if (m.version !== PROTOCOL) return this.turnAway(link, 'This world is on another version of the game. Reload the page and try again.');
      let id = 1;
      while (id < MAX_PLAYERS && this.guests.has(id)) id++;
      if (id >= MAX_PLAYERS) return this.turnAway(link, `This world is full (${MAX_PLAYERS} players).`);
      const player = { id, name: m.name };
      this.guests.set(id, link);
      this.players.push(player);
      this.players.sort((a, b) => a.id - b.id);
      link.onMessage = (raw2) => this.heard(id, raw2);
      link.onClose = (reason) => this.leave(id, reason);
      link.send({
        type: 'welcome',
        you: id,
        seed: this.world.seed,
        time: this.world.time(),
        players: this.players,
        at: this.world.position(),
        edited: this.world.editedColumns(),
        mode: this.world.mode(),
        kept: this.world.kept(m.name),
      });
      for (const [other, l] of this.guests) if (other !== id) l.send({ type: 'joined', player });
      this.onEvent(`${m.name} joined.`);
    };
  }

  private turnAway(link: Link, reason: string): void {
    link.send({ type: 'reject', reason });
    link.close();
  }

  private heard(id: number, raw: unknown): void {
    const m = parseMessage(raw);
    const link = this.guests.get(id);
    if (!m || !link) return;
    switch (m.type) {
      case 'ask':
        void this.world.columnChunks(m.cx, m.cz).then(
          (chunks) => link.send({ type: 'column', cx: m.cx, cz: m.cz, chunks: chunks.map((c) => ({ cy: c.cy, data: bufferOf(c.data) })) }),
          // Couldn't be read: an answer all the same, so the guest's loader isn't left waiting.
          () => link.send({ type: 'column', cx: m.cx, cz: m.cz, chunks: [] }),
        );
        break;
      case 'edit':
        if (this.world.edit(id, m.x, m.y, m.z, m.block)) this.shareEdits([[m.x, m.y, m.z, m.block]], id, m.seq);
        else link.send({ type: 'refused', seq: m.seq, x: m.x, y: m.y, z: m.z, block: this.world.blockAt(m.x, m.y, m.z) });
        break;
      case 'use': {
        // What the click made of the block as the host has it (a switch the host or someone else has
        // just flipped flips back, say), for everyone: a door's two halves.
        const set = this.world.use(id, m.x, m.y, m.z);
        if (set) this.shareEdits(set.map(([x, y, z]) => [x, y, z, this.world.blockAt(x, y, z)]), id, m.seq);
        else {
          // Refused: the block put back as it is, and a door's other half too (the guest flipped both).
          const blocks = { getBlock: (x: number, y: number, z: number) => this.world.blockAt(x, y, z) as Block };
          const partner = partnerOf(blocks, m.x, m.y, m.z);
          const places: [number, number, number][] = partner ? [[m.x, m.y, m.z], partner] : [[m.x, m.y, m.z]];
          for (const [x, y, z] of places) link.send({ type: 'refused', seq: m.seq, x, y, z, block: this.world.blockAt(x, y, z) });
        }
        break;
      }
      case 'ping':
        link.send({ type: 'pong', t: m.t, at: this.now() });
        break;
      case 'hit':
        this.world.hitMob(id, m.id, m.points);
        break;
      case 'drop':
        this.world.drop(id, m.stack, m.x, m.y, m.z, m.vx, m.vy, m.vz, m.delay);
        break;
      case 'take': {
        const got = this.world.take(id, m.id, m.count);
        if (got) link.send({ type: 'given', stack: got });
        break;
      }
      case 'copen':
        this.watching.set(id, [m.x, m.y, m.z]);
        this.sendContainer(id, m.x, m.y, m.z, true);
        break;
      case 'cclose':
        this.watching.delete(id);
        this.watched.delete(id);
        break;
      case 'cput': {
        const back = this.world.containerPut(id, m.x, m.y, m.z, m.slot, m.stack);
        if (back) link.send({ type: 'given', stack: back });
        this.sendContainer(id, m.x, m.y, m.z, true);
        break;
      }
      case 'ctake': {
        const got = this.world.containerTake(id, m.x, m.y, m.z, m.slot);
        if (got) link.send({ type: 'given', stack: got });
        this.sendContainer(id, m.x, m.y, m.z, true);
        break;
      }
      case 'kept': {
        const who = this.players.find((p) => p.id === id);
        if (who) this.world.keep(who.name, m.survival);
        break;
      }
      case 'state': {
        // Theirs, whatever number they put on it; on to the others as theirs.
        let remote = this.remotes.get(id);
        if (!remote) this.remotes.set(id, (remote = new RemotePlayer()));
        remote.push(unpackState(m.data)!);
        for (const [other, l] of this.guests) if (other !== id) l.send({ type: 'state', id, data: m.data }, 'frames');
        break;
      }
      case 'bye':
        link.close();
        this.leave(id, m.reason);
        break;
    }
  }

  private leave(id: number, reason: string): void {
    if (!this.guests.delete(id)) return;
    this.remotes.delete(id);
    this.watching.delete(id);
    this.watched.delete(id);
    this.groundSent.delete(id);
    const i = this.players.findIndex((p) => p.id === id);
    const name = i >= 0 ? this.players[i].name : 'Someone';
    if (i >= 0) this.players.splice(i, 1);
    for (const l of this.guests.values()) l.send({ type: 'left', id, reason });
    this.onEvent(`${name} left.`);
  }
}

// --- A guest -------------------------------------------------------------------------------

/** The loader's `ChunkSaves` on a guest: edited chunks come from the host. */
export class RemoteSaves implements ChunkSaves {
  /** Columns with edited chunks (from the welcome, and from edits since). */
  readonly edited = new Set<string>();
  private readonly waiting = new Map<string, ((chunks: SavedChunk[]) => void)[]>();

  constructor(private readonly ask: (cx: number, cz: number) => void) {}

  has(cx: number, cz: number): boolean {
    return this.edited.has(columnKey(cx, cz));
  }

  load(cx: number, cz: number): Promise<SavedChunk[]> {
    const key = columnKey(cx, cz);
    return new Promise((resolve) => {
      const list = this.waiting.get(key);
      if (list) list.push(resolve);
      else {
        this.waiting.set(key, [resolve]);
        this.ask(cx, cz);
      }
    });
  }

  /** A guest saves nothing: its edits are the host's to keep. */
  unloading(): void {}

  /** The host's answer for a column: each chunk checked, any that isn't a chunk left out. */
  answered(cx: number, cz: number, chunks: { cy: number; data: ArrayBuffer }[]): void {
    const key = columnKey(cx, cz);
    const list = this.waiting.get(key);
    if (!list) return;
    this.waiting.delete(key);
    const saved = chunks.flatMap((c) => {
      const data = new Uint8Array(c.data);
      return checkChunk(data) ? [{ cy: c.cy, data }] : [];
    });
    for (const resolve of list) resolve(saved);
  }

  /** The host is gone: nothing more is coming, so let the loader generate what it was waiting for. */
  giveUp(): void {
    for (const list of this.waiting.values()) for (const resolve of list) resolve([]);
    this.waiting.clear();
  }
}

export class GuestSession {
  readonly saves: RemoteSaves;
  /** The host's answer: in, with the world's seed and the rest, or why not. */
  readonly welcome: Promise<Welcome>;
  /** Everyone in, the host first (from the welcome on). */
  players: PlayerInfo[] = [];
  you = -1;
  /** The last round trip to the host (s), and the host's clock less this one's (s), from the quickest recent one. */
  rtt = 0;
  offset = 0;
  /** The others (the host and the other guests) as this browser sees them, by player number. */
  readonly remotes = new Map<number, RemotePlayer>();
  /** The mobs near this player, as the host runs them. */
  readonly mobs = new MobMirror();
  /** Sounds mobs near this player made (calls, cries, landings, puffs). */
  onMobSounds: (sounds: MobSound[]) => void = () => {};
  /** The host's time of day, as last heard (from the welcome on). */
  time = 0;
  /** The time of day was heard (every few seconds). */
  onTime: (time: number) => void = () => {};
  /** The host switched the world's mode. */
  onMode: (mode: WorldMode) => void = () => {};
  /** The items lying round this player, as the host last said. */
  ground: GroundSnap[] = [];
  /** Something the host gave this player (picked up, from a furnace). */
  onGiven: (stack: Stack) => void = () => {};
  /** A hostile mob hit this player. */
  onHurt: (damage: number, push: number, fromX: number, fromZ: number) => void = () => {};
  /** What's in the furnace this player has open, as the host has it. */
  onContainer: (x: number, y: number, z: number, state: Record<string, unknown>) => void = () => {};
  /** Recent round trips and the offsets they gave. */
  private readonly samples: { rtt: number; offset: number }[] = [];
  /** Something to tell the player (someone joined, left). */
  onEvent: (text: string) => void = () => {};
  /** The game is over for this guest: the host left, refused, or the link was lost. */
  onClose: (reason: string) => void = () => {};
  private world: GuestWorld | null = null;
  private seq = 0;
  /** Edits sent and not yet answered: number → where. */
  private readonly pending = new Map<number, [number, number, number]>();
  /** Blocks for columns not here yet, the latest for each place: column → place → block. */
  private readonly kept = new Map<string, Map<string, BlockChange>>();
  private keptCount = 0;
  private lastPing = Number.NEGATIVE_INFINITY;
  private closed = false;

  constructor(
    private readonly link: Link,
    name: string,
    private readonly now: () => number,
  ) {
    this.saves = new RemoteSaves((cx, cz) => link.send({ type: 'ask', cx, cz }));
    let answer: { resolve: (w: Welcome) => void; reject: (e: Error) => void } | null = null;
    this.welcome = new Promise<Welcome>((resolve, reject) => (answer = { resolve, reject }));
    link.onMessage = (raw) => {
      const m = parseMessage(raw);
      if (!m) return;
      if (m.type === 'welcome' && this.you < 0) {
        this.you = m.you;
        this.players = m.players;
        this.time = m.time;
        for (let i = 0; i < m.edited.length; i += 2) this.saves.edited.add(columnKey(m.edited[i], m.edited[i + 1]));
        answer?.resolve(m);
      } else if (m.type === 'reject') {
        this.end(m.reason);
        answer?.reject(new Error(m.reason));
      } else this.heard(m);
    };
    link.onClose = (reason) => {
      answer?.reject(new Error(reason));
      this.end(reason);
    };
    link.send({ type: 'hello', version: PROTOCOL, name });
  }

  /** The world is made (from the welcome's seed): host edits are made in it from now on. */
  attach(world: GuestWorld): void {
    this.world = world;
  }

  /** Once a frame: the round trip now and then. */
  update(): void {
    const t = this.now();
    if (this.closed || t - this.lastPing < PING_EVERY) return;
    this.lastPing = t;
    this.link.send({ type: 'ping', t });
  }

  /** The host's clock (s), as best this guest knows it. */
  clock(): number {
    return this.now() + this.offset;
  }

  /** Has the host's clock been heard yet (a round trip done)? States aren't sent before. */
  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** This player's state now: to the host, which passes it on. */
  sendState(state: Omit<PlayerState, 'time'>): void {
    if (this.closed || !this.synced) return;
    this.link.send({ type: 'state', id: this.you, data: packState({ ...state, time: this.clock() }) }, 'frames');
  }

  /** This player's survival state, for the host to keep (and give back next time it joins under this name). */
  keep(survival: Record<string, unknown>): void {
    if (!this.closed) this.link.send({ type: 'kept', survival });
  }

  /** This player hit mob `id`: the host makes the hit (the knockback, the flash and any puff come back with the mobs). */
  hit(id: number, points = 1): void {
    if (!this.closed) this.link.send({ type: 'hit', id, points });
  }

  /** Ask the host to put `stack` on the ground (broken, thrown, no room), at (x, y, z) moving at (vx, vy, vz). */
  drop(stack: Stack, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, delay = 0): void {
    if (!this.closed) this.link.send({ type: 'drop', stack, x, y, z, vx, vy, vz, delay });
  }

  /** Ask the host for `count` of item `id` on the ground (`onGiven` brings it, if it's still there). */
  take(id: number, count: number): void {
    if (!this.closed) this.link.send({ type: 'take', id, count });
  }

  /** Open the furnace at (x, y, z): `onContainer` brings what's in it, and its changes, until it's closed. */
  openContainer(x: number, y: number, z: number): void {
    if (!this.closed) this.link.send({ type: 'copen', x, y, z });
  }

  closeContainer(): void {
    if (!this.closed) this.link.send({ type: 'cclose' });
  }

  /** Put `stack` into slot `slot` of the furnace at (x, y, z) (what doesn't go in comes back through `onGiven`). */
  containerPut(x: number, y: number, z: number, slot: number, stack: Stack): void {
    if (!this.closed) this.link.send({ type: 'cput', x, y, z, slot, stack });
  }

  /** Take what's in slot `slot` of the furnace at (x, y, z) (it comes through `onGiven`). */
  containerTake(x: number, y: number, z: number, slot: number): void {
    if (!this.closed) this.link.send({ type: 'ctake', x, y, z, slot });
  }

  /** This player set a block (it shows already): ask the host to make it. */
  edit(x: number, y: number, z: number, block: number): void {
    if (this.closed) return;
    const seq = ++this.seq;
    this.pending.set(seq, [x, y, z]);
    this.link.send({ type: 'edit', seq, x, y, z, block });
  }

  /**
   * This player used a block (what it makes of it shows already): ask the host to use it. The host
   * answers with the block as it made it, which this player then has.
   */
  use(x: number, y: number, z: number): void {
    if (this.closed) return;
    const seq = ++this.seq;
    this.pending.set(seq, [x, y, z]);
    this.link.send({ type: 'use', seq, x, y, z });
  }

  /** Edits sent that the host hasn't answered yet. */
  get unanswered(): number {
    return this.pending.size;
  }

  /** Column (cx, cz) has been added to the world: make the host's edits that came for it meanwhile. */
  columnAdded(cx: number, cz: number): void {
    const key = columnKey(cx, cz);
    const kept = this.kept.get(key);
    if (!kept) return;
    this.kept.delete(key);
    this.keptCount -= kept.size;
    this.world?.apply([...kept.values()], true);
  }

  /** Leave the game. */
  leave(reason = 'Left the game.'): void {
    if (this.closed) return;
    this.link.send({ type: 'bye', reason });
    this.closed = true;
    this.link.close();
    this.saves.giveUp();
  }

  private heard(m: Message): void {
    switch (m.type) {
      case 'column':
        this.saves.answered(m.cx, m.cz, m.chunks);
        break;
      case 'edits':
        if (m.from === this.you && m.seq) this.pending.delete(m.seq);
        this.made(unpackEdits(m.data) ?? [], m.water);
        break;
      case 'refused':
        this.pending.delete(m.seq);
        this.made([[m.x, m.y, m.z, m.block]], false);
        break;
      case 'mobs':
        this.mobs.push(m.time, unpackMobs(m.data) ?? []);
        break;
      case 'mobsounds':
        this.onMobSounds(unpackMobSounds(m.data) ?? []);
        break;
      case 'time':
        this.time = m.time;
        this.onTime(m.time);
        break;
      case 'mode':
        this.onMode(m.mode);
        break;
      case 'ground':
        this.ground = unpackGround(m.data) ?? [];
        break;
      case 'given':
        this.onGiven(m.stack);
        break;
      case 'hurt':
        this.onHurt(m.damage, m.push, m.fromX, m.fromZ);
        break;
      case 'contents':
        this.onContainer(m.x, m.y, m.z, m.state);
        break;
      case 'joined':
        this.players = [...this.players.filter((p) => p.id !== m.player.id), m.player].sort((a, b) => a.id - b.id);
        this.onEvent(`${m.player.name} joined.`);
        break;
      case 'state': {
        if (m.id === this.you) break;
        let remote = this.remotes.get(m.id);
        if (!remote) this.remotes.set(m.id, (remote = new RemotePlayer()));
        remote.push(unpackState(m.data)!);
        break;
      }
      case 'left': {
        this.remotes.delete(m.id);
        const who = this.players.find((p) => p.id === m.id);
        this.players = this.players.filter((p) => p.id !== m.id);
        this.onEvent(`${who?.name ?? 'Someone'} left.`);
        break;
      }
      case 'pong': {
        // NTP-style: if the trip was even, the host's clock read `at` halfway through it. The
        // quickest trips are the most even, so the offset is the quickest recent one's.
        const t = this.now();
        this.rtt = t - m.t;
        this.samples.push({ rtt: this.rtt, offset: m.at - (m.t + t) / 2 });
        if (this.samples.length > PINGS) this.samples.shift();
        this.offset = this.samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
        break;
      }
      case 'bye':
        this.end(m.reason);
        break;
    }
  }

  /** Blocks the host set: made now where the column is here, kept for later where it isn't. */
  private made(changes: BlockChange[], water: boolean): void {
    const now: BlockChange[] = [];
    for (const c of changes) {
      const cx = toChunk(c[0]);
      const cz = toChunk(c[2]);
      const key = columnKey(cx, cz);
      this.saves.edited.add(key);
      if (this.world?.hasColumn(cx, cz)) {
        now.push(c);
        continue;
      }
      let kept = this.kept.get(key);
      if (!kept) this.kept.set(key, (kept = new Map()));
      const place = `${c[0]},${c[1]},${c[2]}`;
      if (!kept.has(place)) this.keptCount++;
      kept.delete(place); // to the end, as the newest
      kept.set(place, c);
    }
    // Too many kept: the oldest columns' go (the host has them, should they be loaded later).
    while (this.keptCount > MOST_KEPT) {
      const [oldest, blocks] = this.kept.entries().next().value!;
      this.kept.delete(oldest);
      this.keptCount -= blocks.size;
    }
    if (now.length) this.world?.apply(now, water);
  }

  private end(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.link.close();
    this.saves.giveUp();
    this.onClose(reason);
  }
}
