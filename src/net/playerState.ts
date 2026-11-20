// A player's state on the wire: what the others need to draw them, hear them, and check their
// edits. Packed in a Float64Array of 10 (80 bytes): the time is on the host's clock, which needs
// more than float32. Riding (Milestone 18), 11 more (168 bytes): the vehicle and where it is, which a
// guest's rider moves and the host takes. Pure.

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
  /** Riding: what, and where it is (its rider moves it). */
  riding?: RidePose;
}

/** A ridden vehicle where its rider has it: its id, body, facing, speed, and rail (block and how far along) if on one. */
export interface RidePose {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  rail: [number, number, number, number] | null;
}

const FLYING = 1;
const CROUCHING = 2;
const SWIMMING = 4;
const ON_GROUND = 8;
const SLEEPING = 16;
export const STATE_BYTES = 80;
/** A riding player's state. */
export const RIDING_BYTES = 168;

export function packState(s: PlayerState): ArrayBuffer {
  const flags = (s.flying ? FLYING : 0) | (s.crouching ? CROUCHING : 0) | (s.swimming ? SWIMMING : 0) | (s.onGround ? ON_GROUND : 0) | (s.sleeping ? SLEEPING : 0);
  const base = [s.time, s.x, s.y, s.z, s.yaw, s.pitch, flags, s.held, s.swings, s.digging];
  const r = s.riding;
  if (!r) return new Float64Array(base).buffer;
  return new Float64Array([...base, r.id, r.x, r.y, r.z, r.yaw, r.pitch, r.speed, r.rail ? 1 + r.rail[3] : 0, r.rail?.[0] ?? 0, r.rail?.[1] ?? 0, r.rail?.[2] ?? 0]).buffer;
}

/** What `packState` packed; null if it isn't a state (wrong size, or not numbers that make sense). */
export function unpackState(data: ArrayBuffer): PlayerState | null {
  if (data.byteLength !== STATE_BYTES && data.byteLength !== RIDING_BYTES) return null;
  const v = new Float64Array(data);
  if (!v.every(Number.isFinite)) return null;
  const [time, x, y, z, yaw, pitch, flags, held, swings, digging] = v;
  let riding: RidePose | undefined;
  if (v.length > 10) {
    const [id, rx, ry, rz, ryaw, rpitch, speed, onRail, bx, by, bz] = v.subarray(10);
    if (!Number.isInteger(id) || id < 0 || Math.abs(rx - x) > 4 || Math.abs(rz - z) > 4 || Math.abs(ry - y) > 4 || Math.abs(speed) > 64) return null;
    const rail: [number, number, number, number] | null = onRail >= 1 && [bx, by, bz].every(Number.isInteger) ? [bx, by, bz, onRail - 1] : null;
    riding = { id, x: rx, y: ry, z: rz, yaw: ryaw, pitch: rpitch, speed, rail };
  }
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
    ...(riding ? { riding } : {}),
  };
}
