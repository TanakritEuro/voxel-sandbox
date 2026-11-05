// Mobs on the wire, host → guests: what a guest needs to draw a mob (and its pose) and hit it,
// 13 float32s a mob (52 bytes); and the sounds they made, 5 float32s each. Pure.

import type { Mob, MobState } from '../mobs/brain';
import { KINDS, type MobKind } from '../mobs/kinds';
import type { MobSound, MobVoice } from '../mobs/mobs';

/** A mob as a guest hears of it. */
export interface MobSnap {
  id: number;
  kind: MobKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: MobState;
  vx: number;
  vz: number;
  vy: number;
  onGround: boolean;
  /** Ground walked (its legs) and seconds since it was hit (its red flash; 99 if long ago). */
  walked: number;
  sinceHurt: number;
}

const STATES: readonly MobState[] = ['idle', 'wander', 'flee', 'rest', 'hunt'];
const VOICES: readonly MobVoice[] = ['call', 'hurt', 'land', 'puff'];
const MOB_FLOATS = 13;
const SOUND_FLOATS = 5;
/** Far beyond the world: a number like this is junk. */
const FAR = 2 ** 21;

export function packMobs(mobs: readonly Mob[]): ArrayBuffer {
  const out = new Float32Array(mobs.length * MOB_FLOATS);
  mobs.forEach((m, i) => {
    const b = m.body;
    out.set(
      [m.id, m.kind, b.x, b.y, b.z, m.yaw, STATES.indexOf(m.state), b.vx, b.vz, b.vy, b.onGround ? 1 : 0, m.walked, Math.min(m.sinceHurt, 99)],
      i * MOB_FLOATS,
    );
  });
  return out.buffer;
}

/** What `packMobs` packed; null if any of it isn't a mob. */
export function unpackMobs(data: ArrayBuffer): MobSnap[] | null {
  if (data.byteLength % (MOB_FLOATS * 4) !== 0) return null;
  const v = new Float32Array(data);
  const out: MobSnap[] = [];
  for (let i = 0; i < v.length; i += MOB_FLOATS) {
    const [id, kind, x, y, z, yaw, state, vx, vz, vy, onGround, walked, sinceHurt] = v.subarray(i, i + MOB_FLOATS);
    if (!v.subarray(i, i + MOB_FLOATS).every(Number.isFinite)) return null;
    if (!Number.isInteger(id) || id < 0 || !Number.isInteger(kind) || kind < 0 || kind >= KINDS.length || !Number.isInteger(state) || !STATES[state]) return null;
    if (Math.abs(x) > FAR || Math.abs(z) > FAR || Math.abs(y) > 1024) return null;
    out.push({ id, kind: kind as MobKind, x, y, z, yaw, state: STATES[state], vx, vz, vy, onGround: onGround !== 0, walked, sinceHurt });
  }
  return out;
}

export function packMobSounds(sounds: readonly MobSound[]): ArrayBuffer {
  const out = new Float32Array(sounds.length * SOUND_FLOATS);
  sounds.forEach((s, i) => out.set([VOICES.indexOf(s.voice), s.kind, s.x, s.y, s.z], i * SOUND_FLOATS));
  return out.buffer;
}

export function unpackMobSounds(data: ArrayBuffer): MobSound[] | null {
  if (data.byteLength % (SOUND_FLOATS * 4) !== 0) return null;
  const v = new Float32Array(data);
  const out: MobSound[] = [];
  for (let i = 0; i < v.length; i += SOUND_FLOATS) {
    const [voice, kind, x, y, z] = v.subarray(i, i + SOUND_FLOATS);
    if (!Number.isInteger(voice) || !VOICES[voice] || !Number.isInteger(kind) || kind < 0 || kind >= KINDS.length) return null;
    if (![x, y, z].every(Number.isFinite) || Math.abs(x) > FAR || Math.abs(z) > FAR || Math.abs(y) > 1024) return null;
    out.push({ voice: VOICES[voice], kind: kind as MobKind, x, y, z });
  }
  return out;
}
