// Vehicles on the wire, host → guests (Milestone 18): what a guest needs to draw one, get in it and
// ride it on from where it is: 13 float32s a vehicle (52 bytes). Pure.

import { VehicleKind } from '../vehicles/vehicle';
import type { Vehicle } from '../vehicles/vehicle';

/** A vehicle as a guest hears of it. */
export interface VehicleSnap {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Who rides it (a player number), or -1. */
  rider: number;
  speed: number;
  /** On a rail: its block and how far along; null off rails. */
  rail: [number, number, number, number] | null;
}

const FLOATS = 13;
const KINDS = [VehicleKind.Cart, VehicleKind.ChestCart, VehicleKind.Boat];
const FAR = 2 ** 21;

export function packVehicles(vehicles: readonly Vehicle[]): ArrayBuffer {
  const out = new Float32Array(vehicles.length * FLOATS);
  vehicles.forEach((v, i) => {
    const b = v.body;
    const r = v.rail;
    // On a rail: 1 + how far along it (a path is at most 1.5 long), then the rail's block; off rails 0.
    out.set([v.id, v.kind, b.x, b.y, b.z, v.yaw, v.pitch, v.rider, v.speed, r ? 1 + r.s : 0, r?.x ?? 0, r?.y ?? 0, r?.z ?? 0], i * FLOATS);
  });
  return out.buffer;
}

/** What `packVehicles` packed; null if any of it isn't a vehicle. */
export function unpackVehicles(data: ArrayBuffer): VehicleSnap[] | null {
  if (data.byteLength % (FLOATS * 4) !== 0) return null;
  const v = new Float32Array(data);
  const out: VehicleSnap[] = [];
  for (let i = 0; i < v.length; i += FLOATS) {
    const f = v.subarray(i, i + FLOATS);
    if (!f.every(Number.isFinite)) return null;
    const [id, kind, x, y, z, yaw, pitch, rider, speed, onRail, rx, ry, rz] = f;
    if (!Number.isInteger(id) || id < 0 || !KINDS.includes(kind) || !Number.isInteger(rider) || rider < -1 || rider > 63) return null;
    if (Math.abs(x) > FAR || Math.abs(z) > FAR || Math.abs(y) > 1024 || Math.abs(speed) > 64) return null;
    const rail: [number, number, number, number] | null = onRail >= 1 && [rx, ry, rz].every(Number.isInteger) ? [rx, ry, rz, onRail - 1] : null;
    out.push({ id, kind: kind as VehicleKind, x, y, z, yaw, pitch, rider, speed, rail });
  }
  return out;
}
