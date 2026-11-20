// A guest's vehicles (Milestone 18): the host runs them and sends where they are with the mobs
// (`vehicleState.ts`). Each is drawn `TUNING.net.mobBehind` late, between the snapshots either side,
// as mobs are; one missing from a snapshot has gone. Its vehicles are real `Vehicle`s kept up to date,
// so the renderer and the crosshair take them as they take the host's. Pure.

import { TUNING } from '../config';
import { createVehicle, type Vehicle } from '../vehicles/vehicle';
import type { VehicleBefore } from '../vehicles/manager';
import type { VehicleSnap } from './vehicleState';

const KEEP = 6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  return a + d * t;
}

interface Known {
  vehicle: Vehicle;
  states: { time: number; snap: VehicleSnap }[];
}

export class VehicleMirror {
  readonly vehicles: Vehicle[] = [];
  private readonly known = new Map<number, Known>();
  private newest = Number.NEGATIVE_INFINITY;

  /** A snapshot from the host, at `time` on its clock (an older one than the newest is dropped). */
  push(time: number, snaps: readonly VehicleSnap[]): void {
    if (time <= this.newest) return;
    this.newest = time;
    const seen = new Set<number>();
    for (const s of snaps) {
      seen.add(s.id);
      let k = this.known.get(s.id);
      if (!k || k.vehicle.kind !== s.kind) {
        if (k) this.drop(s.id);
        k = { vehicle: createVehicle(s.id, s.kind, s.x, s.y, s.z, s.yaw), states: [] };
        this.known.set(s.id, k);
        this.vehicles.push(k.vehicle);
      }
      k.states.push({ time, snap: s });
      if (k.states.length > KEEP) k.states.shift();
    }
    for (const id of [...this.known.keys()]) if (!seen.has(id)) this.drop(id);
  }

  /** The vehicle numbered `id`, if it's here. */
  byId(id: number): Vehicle | undefined {
    return this.known.get(id)?.vehicle;
  }

  /** The newest snapshot of vehicle `id` (to ride it on from), if it's here. */
  latest(id: number): VehicleSnap | undefined {
    return this.known.get(id)?.states.at(-1)?.snap;
  }

  /** Once a frame: every vehicle where it was `TUNING.net.mobBehind` ago, at `now` on the host's clock. */
  update(now: number): void {
    const t = now - TUNING.net.mobBehind;
    for (const { vehicle: v, states } of this.known.values()) {
      let a = states[0];
      let b = a;
      for (const s of states) {
        if (s.time <= t) a = s;
        b = s;
        if (s.time >= t) break;
      }
      const k = b.time > a.time ? Math.min(1, Math.max(0, (t - a.time) / (b.time - a.time))) : 0;
      const sa = a.snap;
      const sb = b.snap;
      v.body.x = lerp(sa.x, sb.x, k);
      v.body.y = lerp(sa.y, sb.y, k);
      v.body.z = lerp(sa.z, sb.z, k);
      v.yaw = lerpAngle(sa.yaw, sb.yaw, k);
      v.pitch = lerp(sa.pitch, sb.pitch, k);
      const near = k < 0.5 ? sa : sb;
      v.rider = near.rider;
      v.speed = near.speed;
    }
  }

  /** Where `v` is drawn now (it's placed there by `update`). */
  drawnAt(v: Vehicle): VehicleBefore {
    return { x: v.body.x, y: v.body.y, z: v.body.z, yaw: v.yaw, pitch: v.pitch };
  }

  private drop(id: number): void {
    const k = this.known.get(id);
    if (!k) return;
    this.known.delete(id);
    const i = this.vehicles.indexOf(k.vehicle);
    if (i >= 0) this.vehicles.splice(i, 1);
  }
}
