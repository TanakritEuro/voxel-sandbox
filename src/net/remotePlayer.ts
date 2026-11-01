// Another player as this browser sees them: a stream of their states (20 a second, late by the
// network's delay and jitter) turned into where to draw them now. Drawn `TUNING.net.behind` late,
// so there's usually a state either side to draw between; past the newest they're guessed on at
// the speed they were going, for at most `TUNING.net.extrapolate`, then held. A jump of more than
// `TUNING.net.snap` blocks (a teleport) isn't counted as walking. After the racing game's
// `RemoteCar`, simpler: players move gently and are small on screen. Pure.

import { TUNING } from '../config';
import type { PlayerState } from './playerState';

/** Where to draw a player now, and what they're doing. */
export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
  crouching: boolean;
  swimming: boolean;
  onGround: boolean;
  held: number;
  digging: number;
  /** Ground walked so far (for the legs' swing), and the walking speed now (blocks / s). */
  walked: number;
  speed: number;
  /** Seconds since the arm last swung. */
  sinceSwing: number;
}

/** States kept. */
const KEEP = 16;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** From angle a towards b by t, the short way round. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  return a + d * t;
}

export class RemotePlayer {
  private readonly states: PlayerState[] = [];
  private last: PlayerPose | null = null;
  private lastTime = 0;
  private swings = 0;
  private swungAt = Number.NEGATIVE_INFINITY;

  /** The newest state heard, or null. */
  get latest(): PlayerState | null {
    return this.states[this.states.length - 1] ?? null;
  }

  /** A state heard: kept in time order; one older than the newest (late, out of order) is dropped. */
  push(state: PlayerState): void {
    const newest = this.latest;
    if (newest && state.time <= newest.time) return;
    this.states.push(state);
    if (this.states.length > KEEP) this.states.shift();
  }

  /** Where to draw them at `now` (s, on the host's clock); null before any state. */
  poseAt(now: number): PlayerPose | null {
    const n = this.states.length;
    if (!n) return null;
    const N = TUNING.net;
    const t = now - N.behind;
    let x: number;
    let y: number;
    let z: number;
    let yaw: number;
    let pitch: number;
    let from = this.states[n - 1];
    if (n === 1 || t >= from.time) {
      // Past the newest: on at the speed it was going, for a moment.
      const prev = n > 1 ? this.states[n - 2] : from;
      const span = from.time - prev.time;
      const ahead = Math.min(Math.max(t - from.time, 0), N.extrapolate);
      const k = span > 1e-6 ? ahead / span : 0;
      x = from.x + (from.x - prev.x) * k;
      y = from.y + (from.y - prev.y) * k;
      z = from.z + (from.z - prev.z) * k;
      yaw = from.yaw;
      pitch = from.pitch;
    } else if (t <= this.states[0].time) {
      from = this.states[0];
      ({ x, y, z, yaw, pitch } = from);
    } else {
      let i = n - 2;
      while (i > 0 && this.states[i].time > t) i--;
      const a = this.states[i];
      const b = this.states[i + 1];
      const k = (t - a.time) / (b.time - a.time);
      x = lerp(a.x, b.x, k);
      y = lerp(a.y, b.y, k);
      z = lerp(a.z, b.z, k);
      yaw = lerpAngle(a.yaw, b.yaw, k);
      pitch = lerp(a.pitch, b.pitch, k);
      from = k < 0.5 ? a : b;
    }
    // The legs: ground covered on the ground, and the speed now.
    const dt = Math.max(now - this.lastTime, 1e-6);
    let walked = this.last?.walked ?? 0;
    let speed = 0;
    if (this.last) {
      const moved = Math.hypot(x - this.last.x, z - this.last.z);
      if (moved > N.snap) {
        // A jump: no stride over it.
      } else {
        speed = moved / dt;
        if (from.onGround && !from.flying) walked += moved;
      }
    }
    if (from.swings > this.swings) {
      this.swings = from.swings;
      this.swungAt = now;
    }
    this.lastTime = now;
    this.last = {
      x,
      y,
      z,
      yaw,
      pitch,
      flying: from.flying,
      crouching: from.crouching,
      swimming: from.swimming,
      onGround: from.onGround,
      held: from.held,
      digging: from.digging,
      walked,
      speed,
      sinceSwing: now - this.swungAt,
    };
    return this.last;
  }
}
