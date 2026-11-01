// The messages between the host's browser and its guests'. The host owns the world: guests
// ask, the host answers and tells everyone. What arrives is only as good as the other
// browser's code, so every message is checked before it is used (after the racing game's).
//
// Bump PROTOCOL whenever a message changes, and whenever world generation does: a guest
// generates the land itself from the seed, so both must make exactly the same land.
// Mismatched versions are turned away.

export const PROTOCOL = 1;

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
   * (you included), where the host is standing (you start near them), and the columns with edited
   * chunks, as (cx, cz) pairs one after another.
   */
  | { type: 'welcome'; you: number; seed: number; time: number; players: PlayerInfo[]; at: [number, number, number]; edited: number[] }
  /** Host → guest: not let in (full, or another version), and why. */
  | { type: 'reject'; reason: string }
  /** Host → guests: someone came in, or went. */
  | { type: 'joined'; player: PlayerInfo }
  | { type: 'left'; id: number; reason: string }
  /** Round trip: a ping with the sender's time, and the answer with the answerer's. */
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number; at: number }
  /** Leaving, and why (shown to the others). */
  | { type: 'bye'; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
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
      return {
        type: 'welcome',
        you: raw.you,
        seed: raw.seed,
        time: raw.time,
        players: players as PlayerInfo[],
        at: raw.at as [number, number, number],
        edited: raw.edited as number[],
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
    default:
      return null;
  }
}
