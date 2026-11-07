// A player's state on the wire: what the others need to draw them, hear them, and check their
// edits. Packed in a Float64Array of 10 (80 bytes): the time is on the host's clock, which needs
// more than float32. Pure.

export interface PlayerState {
  /** When (s, on the host's clock). */
  time: number;
  /** Feet, middle of the box. */
  x: number;
  y: number;
  z: number;
  /** Looking (radians, as `Input`). */
  yaw: number;
  pitch: number;
  flying: boolean;
  crouching: boolean;
  swimming: boolean;
  onGround: boolean;
  /** Asleep in a bed (playing together, the night goes when everyone is). */
  sleeping?: boolean;
  /** The block in hand. */
  held: number;
  /** Arm swings so far (digging hits, breaks, places): each new one swings the avatar's arm. */
  swings: number;
  /** The block being dug (0 none): its digging sound. */
  digging: number;
}

const FLYING = 1;
const CROUCHING = 2;
const SWIMMING = 4;
const ON_GROUND = 8;
const SLEEPING = 16;
export const STATE_BYTES = 80;

export function packState(s: PlayerState): ArrayBuffer {
  const flags = (s.flying ? FLYING : 0) | (s.crouching ? CROUCHING : 0) | (s.swimming ? SWIMMING : 0) | (s.onGround ? ON_GROUND : 0) | (s.sleeping ? SLEEPING : 0);
  return new Float64Array([s.time, s.x, s.y, s.z, s.yaw, s.pitch, flags, s.held, s.swings, s.digging]).buffer;
}

/** What `packState` packed; null if it isn't a state (wrong size, or not numbers that make sense). */
export function unpackState(data: ArrayBuffer): PlayerState | null {
  if (data.byteLength !== STATE_BYTES) return null;
  const v = new Float64Array(data);
  if (!v.every(Number.isFinite)) return null;
  const [time, x, y, z, yaw, pitch, flags, held, swings, digging] = v;
  if (Math.abs(x) > 2 ** 21 || Math.abs(z) > 2 ** 21 || Math.abs(y) > 1024) return null;
  if (!Number.isInteger(flags) || !Number.isInteger(held) || !Number.isInteger(swings) || !Number.isInteger(digging) || held < 0 || held > 255 || digging < 0 || digging > 255) return null;
  return {
    time,
    x,
    y,
    z,
    yaw,
    pitch,
    flying: (flags & FLYING) !== 0,
    crouching: (flags & CROUCHING) !== 0,
    swimming: (flags & SWIMMING) !== 0,
    onGround: (flags & ON_GROUND) !== 0,
    sleeping: (flags & SLEEPING) !== 0,
    held,
    swings,
    digging,
  };
}
