// The messages between the host's browser and its guests'. The host owns the world: guests
// ask, the host answers and tells everyone. What arrives is only as good as the other
// browser's code, so every message is checked before it is used (after the racing game's).
//
// Bump PROTOCOL whenever a message changes, and whenever world generation does: a guest
// generates the land itself from the seed, so both must make exactly the same land.
// Mismatched versions are turned away.

import type { WorldMode } from '../save/store';
import { Inventory, type Stack } from '../survival/inventory';
import { unpackGround } from './itemState';
import { BLOCKS } from '../world/blocks';
import { CHUNK_VOLUME, MAX_CHUNK_Y, MIN_CHUNK_Y, WORLD_HEIGHT } from '../world/coords';
import { unpackMobs, unpackMobSounds } from './mobState';
import { unpackState } from './playerState';

export const PROTOCOL = 4;

/** The longest a guest's survival state may be, as JSON (36 slots and health fit in about 2,000). */
const KEPT_LENGTH = 8192;

/** Players in a game at most: the host and three guests. */
export const MAX_PLAYERS = 4;
/** Longest name, in characters. */
export const NAME_LENGTH = 16;

/** Someone in the game, as the others know them. Player 0 is the host. */
export interface PlayerInfo {
  id: number;
  name: string;
}

export type Message =
  /** Guest → host on connecting: its version and its player's name. */
  | { type: 'hello'; version: number; name: string }
  /**
   * Host → guest: you're in. Your player number, the world's seed and time of day, who's in
   * (you included), where the host is standing (you start near them), the columns with edited
   * chunks, as (cx, cz) pairs one after another, the world's mode, and your survival state as the
   * host kept it last time you played here under this name (null if none; cleaned when used).
   */
  | {
      type: 'welcome';
      you: number;
      seed: number;
      time: number;
      players: PlayerInfo[];
      at: [number, number, number];
      edited: number[];
      mode: WorldMode;
      kept: Record<string, unknown> | null;
    }
  /** Host → guests: the world's mode changed. */
  | { type: 'mode'; mode: WorldMode }
  /** Guest → host: this player's survival state (inventory and health), to keep for next time. */
  | { type: 'kept'; survival: Record<string, unknown> }
  /** Host → guest: not let in (full, or another version), and why. */
  | { type: 'reject'; reason: string }
  /** Host → guests: someone came in, or went. */
  | { type: 'joined'; player: PlayerInfo }
  | { type: 'left'; id: number; reason: string }
  /** Round trip: a ping with the sender's time, and the answer with the answerer's. */
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number; at: number }
  /** Leaving, and why (shown to the others). */
  | { type: 'bye'; reason: string }
  /** Guest → host: the edited chunks of column (cx, cz), please (its loader is about to make it). */
  | { type: 'ask'; cx: number; cz: number }
  /** Host → guest: column (cx, cz)'s edited chunks, run-length encoded as saved (`save/rle.ts`). */
  | { type: 'column'; cx: number; cz: number; chunks: { cy: number; data: ArrayBuffer }[] }
  /** Guest → host: please set this block (numbered by the guest, so the answer can be matched). */
  | { type: 'edit'; seq: number; x: number; y: number; z: number; block: number }
  /**
   * Guest → host: please use this block (flip a switch, press a button, set a delay on), as the host
   * has it; numbered as edits are, and answered the same way.
   */
  | { type: 'use'; seq: number; x: number; y: number; z: number }
  /**
   * Host → guests: blocks set, packed by `packEdits`. `from` is the player whose edit it was (0 the
   * host, also for flowing water) and `seq` their number for it (0 if none). `water`: a tick of
   * flowing water (remeshed in the workers, not at once).
   */
  | { type: 'edits'; from: number; seq: number; data: ArrayBuffer; water: boolean }
  /** Host → guest: your edit `seq` wasn't made; the block there is `block`. */
  | { type: 'refused'; seq: number; x: number; y: number; z: number; block: number }
  /**
   * A player's state (`playerState.ts`), on the unordered channel: a guest's own to the host (`id`
   * is ignored there: the link says who), and the host's and every guest's to the others.
   */
  | { type: 'state'; id: number; data: ArrayBuffer }
  /** Host → guest, unordered: every mob near the guest at `time` on the host's clock (`mobState.ts`). */
  | { type: 'mobs'; time: number; data: ArrayBuffer }
  /** Host → guest: sounds mobs near it made (a puff: one gone), packed by `packMobSounds`. */
  | { type: 'mobsounds'; data: ArrayBuffer }
  /** Guest → host: this player hit mob `id` for `points` (1 by hand, more with a tool). */
  | { type: 'hit'; id: number; points: number }
  /** Host → guests: the time of day now (0–1). */
  | { type: 'time'; time: number }
  /** Host → guest, unordered: the items lying on the ground round the guest (`itemState.ts`). */
  | { type: 'ground'; data: ArrayBuffer }
  /**
   * Guest → host: put `stack` on the ground with its middle at (x, y, z), moving at (vx, vy, vz),
   * not to be picked up for `delay` s: what this player broke, threw, or had no room for.
   */
  | { type: 'drop'; stack: Stack; x: number; y: number; z: number; vx: number; vy: number; vz: number; delay: number }
  /** Guest → host: this player picks up `count` of item `id` lying on the ground (as much as it has room for). */
  | { type: 'take'; id: number; count: number }
  /** Host → guest: this is yours now: picked up, taken from a furnace, or what didn't go into one. */
  | { type: 'given'; stack: Stack }
  /** Host → guest: a hostile mob hit you, for `damage` points and a `push` away from (fromX, fromZ). */
  | { type: 'hurt'; damage: number; push: number; fromX: number; fromZ: number }
  /** Guest → host: this player opened the furnace at (x, y, z) (see what's in it), or closed it. */
  | { type: 'fopen'; x: number; y: number; z: number }
  | { type: 'fclose' }
  /** Host → guest: what's in the furnace it has open (`Furnace.toJSON`; cleaned by `Furnace.from` where used). */
  | { type: 'furnace'; x: number; y: number; z: number; state: Record<string, unknown> }
  /** Guest → host: put `stack` into slot `slot` of the furnace at (x, y, z); or take what's in the slot. */
  | { type: 'fput'; x: number; y: number; z: number; slot: number; stack: Stack }
  | { type: 'ftake'; x: number; y: number; z: number; slot: number };

/** A block set: where, and what. */
export type BlockChange = [number, number, number, number];

/** Blocks set, packed for the wire: x, y, z, block as 32-bit integers, 16 bytes a block. */
export function packEdits(changes: readonly (readonly [number, number, number, number])[]): ArrayBuffer {
  const out = new Int32Array(changes.length * 4);
  changes.forEach((c, i) => out.set(c, i * 4));
  return out.buffer;
}

/** What `packEdits` packed; null if it isn't blocks in the world. */
export function unpackEdits(data: ArrayBuffer): BlockChange[] | null {
  if (data.byteLength % 16 !== 0) return null;
  const v = new Int32Array(data);
  const out: BlockChange[] = [];
  for (let i = 0; i < v.length; i += 4) {
    if (!isBlockPlace(v[i], v[i + 1], v[i + 2]) || !isBlockId(v[i + 3])) return null;
    out.push([v[i], v[i + 1], v[i + 2], v[i + 3]]);
  }
  return out;
}

/** A block's place: within ±2^20 blocks across, inside the world's height. */
const isBlockPlace = (x: unknown, y: unknown, z: unknown) => isCount(x, -0x100000, 0x100000) && isCount(y, 0, WORLD_HEIGHT - 1) && isCount(z, -0x100000, 0x100000);
const isBlockId = (b: unknown): b is number => isCount(b, 0, BLOCKS.length - 1);

/**
 * A chunk's run-length encoding, checked before it goes near a worker: it must decode to exactly a
 * chunk of block ids that exist. Returns the decoded blocks, or null.
 */
export function checkChunk(data: Uint8Array): Uint8Array | null {
  const blocks = new Uint8Array(CHUNK_VOLUME);
  let i = 0;
  let at = 0;
  while (at < data.length) {
    let run = 0;
    let shift = 0;
    let byte: number;
    do {
      if (at >= data.length || shift > 28) return null;
      byte = data[at++];
      run |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    if (at >= data.length || run === 0 || i + run > CHUNK_VOLUME) return null;
    const b = data[at++];
    if (b >= BLOCKS.length) return null;
    blocks.fill(b, i, i + run);
    i += run;
  }
  return i === CHUNK_VOLUME ? blocks : null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isMode = (v: unknown): v is WorldMode => v === 'creative' || v === 'survival';
/** A survival state small enough to keep (what's in it is cleaned where it's used). */
const isKept = (v: unknown): v is Record<string, unknown> => isObject(v) && !Array.isArray(v) && JSON.stringify(v).length <= KEPT_LENGTH;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A stack of an item, as an inventory would take it (a real item, a count it can stack to, a tool's wear), or null. */
const stackOf = (v: unknown): Stack | null => Inventory.from([v], 1).slots[0];
const isString = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isCount = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
/** Chunk coordinates: within ±2^20 blocks, so ±2^15 chunks. */
const isChunkCoord = (v: unknown): v is number => isCount(v, -0x8000, 0x8000);

/** A player's name as typed, tidied: printable, single spaces, at most NAME_LENGTH; null if nothing's left. */
export function cleanName(typed: unknown): string | null {
  if (typeof typed !== 'string') return null;
  // Runs of white space (tabs and new lines too) to one space, then other control and invisible characters (\p{C}) out.
  const name = typed.replace(/\s+/g, ' ').replace(/\p{C}/gu, '').trim();
  const cut = [...name].slice(0, NAME_LENGTH).join('').trim();
  return cut.length ? cut : null;
}

function parsePlayer(raw: unknown): PlayerInfo | null {
  if (!isObject(raw) || !isCount(raw.id, 0, MAX_PLAYERS - 1)) return null;
  const name = cleanName(raw.name);
  return name !== null && name === raw.name ? { id: raw.id, name } : null;
}

/** A message from the network, or null if it isn't one this version understands. */
export function parseMessage(raw: unknown): Message | null {
  if (!isObject(raw) || !isString(raw.type, 20)) return null;
  switch (raw.type) {
    case 'hello': {
      const name = cleanName(raw.name);
      return isNumber(raw.version) && isString(raw.name, NAME_LENGTH * 4) && name !== null ? { type: 'hello', version: raw.version, name } : null;
    }
    case 'welcome': {
      if (!isCount(raw.you, 1, MAX_PLAYERS - 1) || !isCount(raw.seed, -0x80000000, 0xffffffff) || !isNumber(raw.time) || raw.time < 0 || raw.time >= 1) return null;
      if (!Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > MAX_PLAYERS) return null;
      const players = raw.players.map(parsePlayer);
      if (players.some((p) => p === null) || new Set(players.map((p) => p!.id)).size !== players.length || !players.some((p) => p!.id === raw.you)) return null;
      if (!Array.isArray(raw.at) || raw.at.length !== 3 || !raw.at.every(isNumber)) return null;
      if (!Array.isArray(raw.edited) || raw.edited.length % 2 !== 0 || raw.edited.length > 2 * 65536 || !raw.edited.every(isChunkCoord)) return null;
      if (!isMode(raw.mode) || (raw.kept !== null && !isKept(raw.kept))) return null;
      return {
        type: 'welcome',
        you: raw.you,
        seed: raw.seed,
        time: raw.time,
        players: players as PlayerInfo[],
        at: raw.at as [number, number, number],
        edited: raw.edited as number[],
        mode: raw.mode,
        kept: raw.kept,
      };
    }
    case 'reject':
      return isString(raw.reason) ? { type: 'reject', reason: raw.reason } : null;
    case 'joined': {
      const player = parsePlayer(raw.player);
      return player ? { type: 'joined', player } : null;
    }
    case 'left':
      return isCount(raw.id, 0, MAX_PLAYERS - 1) && isString(raw.reason) ? { type: 'left', id: raw.id, reason: raw.reason } : null;
    case 'ping':
      return isNumber(raw.t) ? { type: 'ping', t: raw.t } : null;
    case 'pong':
      return isNumber(raw.t) && isNumber(raw.at) ? { type: 'pong', t: raw.t, at: raw.at } : null;
    case 'bye':
      return isString(raw.reason) ? { type: 'bye', reason: raw.reason } : null;
    case 'ask':
      return isChunkCoord(raw.cx) && isChunkCoord(raw.cz) ? { type: 'ask', cx: raw.cx, cz: raw.cz } : null;
    case 'column': {
      if (!isChunkCoord(raw.cx) || !isChunkCoord(raw.cz) || !Array.isArray(raw.chunks) || raw.chunks.length > MAX_CHUNK_Y - MIN_CHUNK_Y + 1) return null;
      const chunks: { cy: number; data: ArrayBuffer }[] = [];
      for (const c of raw.chunks as unknown[]) {
        // At worst a block a run, 2 bytes each (a few more for long runs' lengths).
        if (!isObject(c) || !isCount(c.cy, MIN_CHUNK_Y, MAX_CHUNK_Y) || !(c.data instanceof ArrayBuffer) || c.data.byteLength > CHUNK_VOLUME * 2 + 16) return null;
        if (chunks.some((d) => d.cy === c.cy)) return null;
        chunks.push({ cy: c.cy, data: c.data });
      }
      return { type: 'column', cx: raw.cx, cz: raw.cz, chunks };
    }
    case 'edit':
      return isCount(raw.seq, 1, 0x7fffffff) && isBlockPlace(raw.x, raw.y, raw.z) && isBlockId(raw.block)
        ? { type: 'edit', seq: raw.seq, x: raw.x as number, y: raw.y as number, z: raw.z as number, block: raw.block }
        : null;
    case 'mode':
      return isMode(raw.mode) ? { type: 'mode', mode: raw.mode } : null;
    case 'kept':
      return isKept(raw.survival) ? { type: 'kept', survival: raw.survival } : null;
    case 'use':
      return isCount(raw.seq, 1, 0x7fffffff) && isBlockPlace(raw.x, raw.y, raw.z) ? { type: 'use', seq: raw.seq, x: raw.x as number, y: raw.y as number, z: raw.z as number } : null;
    case 'edits':
      return isCount(raw.from, 0, MAX_PLAYERS - 1) &&
        isCount(raw.seq, 0, 0x7fffffff) &&
        raw.data instanceof ArrayBuffer &&
        raw.data.byteLength <= 16 * 65536 &&
        typeof raw.water === 'boolean' &&
        unpackEdits(raw.data) !== null
        ? { type: 'edits', from: raw.from, seq: raw.seq, data: raw.data, water: raw.water }
        : null;
    case 'mobs':
      return isNumber(raw.time) && raw.data instanceof ArrayBuffer && raw.data.byteLength <= 52 * 256 && unpackMobs(raw.data) !== null ? { type: 'mobs', time: raw.time, data: raw.data } : null;
    case 'mobsounds':
      return raw.data instanceof ArrayBuffer && raw.data.byteLength <= 20 * 1024 && unpackMobSounds(raw.data) !== null ? { type: 'mobsounds', data: raw.data } : null;
    case 'hit':
      return isCount(raw.id, 0, 0x7fffffff) && isCount(raw.points, 1, 3) ? { type: 'hit', id: raw.id, points: raw.points } : null;
    case 'ground':
      return raw.data instanceof ArrayBuffer && raw.data.byteLength <= 24 * 512 && unpackGround(raw.data) !== null ? { type: 'ground', data: raw.data } : null;
    case 'drop': {
      const stack = stackOf(raw.stack);
      const v = [raw.x, raw.y, raw.z, raw.vx, raw.vy, raw.vz, raw.delay];
      if (!stack || !v.every(isNumber)) return null;
      const [x, y, z, vx, vy, vz, delay] = v as number[];
      if (Math.abs(x) > 0x100000 || Math.abs(z) > 0x100000 || y < -64 || y > WORLD_HEIGHT + 64) return null;
      if ([vx, vy, vz].some((s) => Math.abs(s) > 30) || delay < 0 || delay > 10) return null;
      return { type: 'drop', stack, x, y, z, vx, vy, vz, delay };
    }
    case 'take':
      return isCount(raw.id, 0, 0x7fffffff) && isCount(raw.count, 1, 64) ? { type: 'take', id: raw.id, count: raw.count } : null;
    case 'given': {
      const stack = stackOf(raw.stack);
      return stack ? { type: 'given', stack } : null;
    }
    case 'hurt':
      return isCount(raw.damage, 1, 20) && isNumber(raw.push) && Math.abs(raw.push) <= 30 && isNumber(raw.fromX) && isNumber(raw.fromZ)
        ? { type: 'hurt', damage: raw.damage, push: raw.push, fromX: raw.fromX, fromZ: raw.fromZ }
        : null;
    case 'fopen':
      return isBlockPlace(raw.x, raw.y, raw.z) ? { type: 'fopen', x: raw.x as number, y: raw.y as number, z: raw.z as number } : null;
    case 'fclose':
      return { type: 'fclose' };
    case 'furnace':
      return isBlockPlace(raw.x, raw.y, raw.z) && isKept(raw.state) ? { type: 'furnace', x: raw.x as number, y: raw.y as number, z: raw.z as number, state: raw.state } : null;
    case 'fput': {
      const stack = stackOf(raw.stack);
      return stack && isBlockPlace(raw.x, raw.y, raw.z) && isCount(raw.slot, 0, 2)
        ? { type: 'fput', x: raw.x as number, y: raw.y as number, z: raw.z as number, slot: raw.slot, stack }
        : null;
    }
    case 'ftake':
      return isBlockPlace(raw.x, raw.y, raw.z) && isCount(raw.slot, 0, 2) ? { type: 'ftake', x: raw.x as number, y: raw.y as number, z: raw.z as number, slot: raw.slot } : null;
    case 'time':
      return isNumber(raw.time) && raw.time >= 0 && raw.time < 1 ? { type: 'time', time: raw.time } : null;
    case 'state':
      return isCount(raw.id, 0, MAX_PLAYERS - 1) && raw.data instanceof ArrayBuffer && unpackState(raw.data) !== null ? { type: 'state', id: raw.id, data: raw.data } : null;
    case 'refused':
      return isCount(raw.seq, 1, 0x7fffffff) && isBlockPlace(raw.x, raw.y, raw.z) && isBlockId(raw.block)
        ? { type: 'refused', seq: raw.seq, x: raw.x as number, y: raw.y as number, z: raw.z as number, block: raw.block }
        : null;
    default:
      return null;
  }
}
