// The mobs as a guest sees them: the host runs them, and sends where they are 10 times a second
// (`mobState.ts`). Each is drawn `TUNING.net.mobBehind` late, between the snapshots either side, as
// other players are; past the newest it's held. Every snapshot lists every mob near this guest:
// one missing from it has gone (despawned, or gone in a puff, which comes as a sound).
//
// Its mobs are real `Mob`s, kept up to date, so the renderer, poses and the crosshair's ray take
// them as they take the host's (`MobView`). Pure.

import { TUNING } from '../config';
import { createMob, type Mob } from '../mobs/brain';
import type { Before } from '../mobs/mobs';
import type { MobView } from '../render/mobRenderer';
import type { MobSnap } from './mobState';

interface Known {
  mob: Mob;
  /** Snapshots of it, oldest first: (host time, state). */
  states: { time: number; snap: MobSnap }[];
}

/** Snapshots kept per mob. */
const KEEP = 6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  return a + d * t;
}

export class MobMirror implements MobView {
  readonly mobs: Mob[] = [];
  /** None: a guest's mobs are placed where they're drawn (`update`), not between physics steps. */
  readonly before = new Map<Mob, Before>();
  readonly alpha = 1;
  private readonly known = new Map<number, Known>();
  private newest = Number.NEGATIVE_INFINITY;

  /** A snapshot from the host, at `time` on its clock. An older one than the newest (out of order) is dropped. */
  push(time: number, snaps: readonly MobSnap[]): void {
    if (time <= this.newest) return;
    this.newest = time;
    const seen = new Set<number>();
    for (const s of snaps) {
      seen.add(s.id);
      let k = this.known.get(s.id);
      if (!k || k.mob.kind !== s.kind) {
        if (k) this.drop(s.id);
        const mob = createMob(s.id, s.kind, s.x, s.y, s.z, 1);
        k = { mob, states: [] };
        this.known.set(s.id, k);
        this.mobs.push(mob);
      }
      k.states.push({ time, snap: s });
      if (k.states.length > KEEP) k.states.shift();
    }
    for (const id of [...this.known.keys()]) if (!seen.has(id)) this.drop(id);
  }

  /** The mob numbered `id`, if it's here. */
  byId(id: number): Mob | undefined {
    return this.known.get(id)?.mob;
  }

  /** Once a frame: every mob where it was `TUNING.net.mobBehind` ago, at `now` on the host's clock. */
  update(now: number): void {
    const t = now - TUNING.net.mobBehind;
    for (const { mob, states } of this.known.values()) {
      let a = states[0];
      let b = a;
      for (let i = 0; i < states.length; i++) {
        if (states[i].time <= t) a = states[i];
        if (states[i].time >= t) {
          b = states[i];
          break;
        }
        b = states[i];
      }
      const k = b.time > a.time ? Math.min(1, Math.max(0, (t - a.time) / (b.time - a.time))) : 0;
      const sa = a.snap;
      const sb = b.snap;
      const body = mob.body;
      body.x = lerp(sa.x, sb.x, k);
      body.y = lerp(sa.y, sb.y, k);
      body.z = lerp(sa.z, sb.z, k);
      body.vx = lerp(sa.vx, sb.vx, k);
      body.vz = lerp(sa.vz, sb.vz, k);
      body.vy = lerp(sa.vy, sb.vy, k);
      const near = k < 0.5 ? sa : sb;
      body.onGround = near.onGround;
      mob.yaw = lerpAngle(sa.yaw, sb.yaw, k);
      mob.state = near.state;
      mob.walked = lerp(sa.walked, sb.walked, k);
      // Its red flash fades on its own clock between snapshots.
      mob.sinceHurt = near.sinceHurt + Math.max(0, t - (k < 0.5 ? a.time : b.time));
    }
  }

  private drop(id: number): void {
    const k = this.known.get(id);
    if (!k) return;
    this.known.delete(id);
    const i = this.mobs.indexOf(k.mob);
    if (i >= 0) this.mobs.splice(i, 1);
  }
}
