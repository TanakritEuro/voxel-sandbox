// How a mob holds itself this frame, from what it's doing: legs swinging with the ground it
// covers, its head dipping to graze when it idles, lying down at rest, a hopper leaning with its
// hops. Pure (angles and offsets only); `render/mobRenderer.ts` turns them into matrices.

import type { Mob } from './brain';
import { KINDS } from './kinds';

export interface Pose {
  /** How far the whole model sinks (blocks): lying down. */
  drop: number;
  /** Legs: swing forward and back (radians, for the legs in step; the others swing opposite). */
  swing: number;
  /** Legs folded under it, 0 standing to 1 lying. */
  fold: number;
  /** The head's tilt (radians, down positive). */
  head: number;
  /** The body's tilt, nose up positive (radians): a hopper rising and landing. */
  lean: number;
  /** Ears laid back (radians). */
  ears: number;
}

/** Radians of leg swing per block walked, and the most it swings (at full walking speed). */
const STRIDE = 3.2;
const SWING = 0.6;
/** Grazing: a dip every so often while idle (seconds a cycle, and of it head down). */
const GRAZE_CYCLE = 4;
const GRAZE_DOWN = 1.6;
const GRAZE_DEPTH = 0.75;

/** The pose of `mob` at time `t` (seconds; any steady clock). */
export function poseOf(mob: Mob, t: number): Pose {
  const k = KINDS[mob.kind];
  const b = mob.body;
  const speed = Math.hypot(b.vx, b.vz);
  const pace = Math.min(1, speed / k.walkSpeed);
  const resting = mob.state === 'rest';
  // Legs swing with the ground covered, harder the faster it goes; still when it stands.
  const swing = resting ? 0 : Math.sin(mob.walked * STRIDE) * SWING * pace;
  let head = 0;
  if (resting) head = 0.35;
  else if (mob.state === 'idle' && speed < 0.2) {
    // Grazing: now and then the head goes down for a while and comes back up, smoothly. Each
    // mob in its own time.
    const phase = (t + mob.id * 1.7) % GRAZE_CYCLE;
    if (phase < GRAZE_DOWN) head = GRAZE_DEPTH * Math.sin((phase / GRAZE_DOWN) * Math.PI);
  } else head = Math.sin(mob.walked * STRIDE * 2) * 0.06 * pace;
  // A hopper leans nose up as it rises and down as it falls, and lays its ears back.
  const lean = k.hops && !b.onGround ? Math.max(-0.4, Math.min(0.4, b.vy * 0.08)) : 0;
  const ears = k.hops ? Math.min(0.9, Math.abs(b.vy) * 0.15 + pace * 0.3) : 0;
  return { drop: resting ? k.height * 0.3 : 0, swing, fold: resting ? 1 : 0, head, lean, ears };
}
