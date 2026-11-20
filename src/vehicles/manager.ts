// The world's vehicles (Milestone 18): stepped at a fixed rate, drawn between steps, stored when
// their column unloads and given back when it loads (as kept animals are), saved in the world
// record's `vehicles`. At most `TUNING.vehicles.most`.
//
// A vehicle is placed on a rail (a cart); a player rides it (`ride`, `leave`); hits break it
// (`hit`). What a broken one gives (and a chest cart's slots) is the caller's to drop.

import { TUNING } from '../config';
import { FixedStep } from '../math';
import type { Stack } from '../survival/inventory';
import { Inventory } from '../survival/inventory';
import { Item } from '../survival/items';
import { toChunk } from '../world/coords';
import type { BlockSource } from '../world/physics';
import { putOnRail, type Push, stepCart } from './cart';
import { CART_SLOTS, createVehicle, rideable, type Vehicle, VehicleKind } from './vehicle';

/** The blocks, and which columns are loaded. */
export interface VehicleWorld extends BlockSource {
  hasColumn(cx: number, cz: number): boolean;
}

/** A vehicle as stored and saved. */
export interface VehicleRecord {
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** On a rail: its block and how far along. */
  rail: [number, number, number, number] | null;
  speed: number;
  /** A chest cart's slots. */
  slots?: (Stack | null)[];
}

/** Where a vehicle was before this frame's steps (drawn between that and now). */
export interface VehicleBefore {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

const columnKey = (cx: number, cz: number) => `${cx},${cz}`;

export class VehicleManager {
  readonly vehicles: Vehicle[] = [];
  readonly before = new Map<Vehicle, VehicleBefore>();
  private readonly clock = new FixedStep(TUNING.vehicles.step);
  /** Vehicles whose columns aren't loaded, by column. */
  private readonly stored = new Map<string, VehicleRecord[]>();
  private nextId = 1;
  /** For `?stats`: this frame's time (ms). */
  ms = 0;

  constructor(private readonly world: VehicleWorld) {}

  /** 0..1: how far between the last step and the next the present is, for drawing. */
  get alpha(): number {
    return this.clock.alpha;
  }

  /** Vehicles here and stored. */
  get count(): number {
    let n = this.vehicles.length;
    for (const list of this.stored.values()) n += list.length;
    return n;
  }

  /**
   * A cart of `kind` on the rail at (x, y, z), facing about along `yaw`; null if there's no rail there or
   * there are as many vehicles as there may be.
   */
  placeCart(kind: VehicleKind, x: number, y: number, z: number, yaw: number): Vehicle | null {
    if (this.count >= TUNING.vehicles.most) return null;
    const v = createVehicle(this.nextId++, kind, x + 0.5, y, z + 0.5, yaw);
    if (!putOnRail(v, this.world, x, y, z)) return null;
    this.vehicles.push(v);
    return v;
  }

  /**
   * Once a frame (dt 0 while paused): store those whose land unloaded, then the steps due, each ridden
   * cart pushed by its rider's `pushes` (by player number).
   */
  update(dt: number, pushes: ReadonlyMap<number, Push> = new Map()): void {
    const t0 = performance.now();
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const b = v.body;
      if (b.y < -16) this.remove(v);
      else if (!this.world.hasColumn(toChunk(Math.floor(b.x)), toChunk(Math.floor(b.z))) && v.rider < 0) {
        this.store(v);
        this.remove(v);
      }
    }
    const steps = this.clock.advance(dt);
    if (steps > 0) {
      for (const v of this.vehicles) this.before.set(v, { x: v.body.x, y: v.body.y, z: v.body.z, yaw: v.yaw, pitch: v.pitch });
      for (let s = 0; s < steps; s++) for (const v of this.vehicles) stepCart(v, this.world, TUNING.vehicles.step, v.rider >= 0 ? (pushes.get(v.rider) ?? null) : null);
    }
    for (const v of this.vehicles) v.sinceHit += dt;
    this.ms = performance.now() - t0;
  }

  /** Where `v` is drawn now: between its last two steps. */
  drawnAt(v: Vehicle): VehicleBefore {
    const p = this.before.get(v);
    const b = v.body;
    if (!p) return { x: b.x, y: b.y, z: b.z, yaw: v.yaw, pitch: v.pitch };
    const t = this.alpha;
    let turn = v.yaw - p.yaw;
    turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
    return { x: p.x + (b.x - p.x) * t, y: p.y + (b.y - p.y) * t, z: p.z + (b.z - p.z) * t, yaw: p.yaw + turn * t, pitch: p.pitch + (v.pitch - p.pitch) * t };
  }

  /** Player `player` gets in `v`; false if it can't be ridden or someone's in it. */
  ride(v: Vehicle, player: number): boolean {
    if (!rideable(v) || (v.rider >= 0 && v.rider !== player)) return false;
    for (const other of this.vehicles) if (other.rider === player) other.rider = -1;
    v.rider = player;
    return true;
  }

  /** Player `player` gets out of whatever they're riding. */
  leave(player: number): void {
    for (const v of this.vehicles) if (v.rider === player) v.rider = -1;
  }

  /** What player `player` is riding, if anything. */
  ridden(player: number): Vehicle | undefined {
    return this.vehicles.find((v) => v.rider === player);
  }

  /**
   * A hit on `v` (every hit at once in creative): broken at `TUNING.vehicles.hits` close together.
   * Returns what it gives (its item, a chest cart's chest and contents), or null if it's still there.
   */
  hit(v: Vehicle, creative = false): Stack[] | null {
    const V = TUNING.vehicles;
    v.hits = v.sinceHit > V.hitMemory ? 1 : v.hits + 1;
    v.sinceHit = 0;
    if (!creative && v.hits < V.hits) return null;
    this.remove(v);
    const gives: Stack[] = [{ item: v.kind === VehicleKind.ChestCart ? Item.ChestCart : Item.Cart, count: 1 }];
    if (v.slots) for (const s of v.slots.slots) if (s) gives.push(s);
    return gives;
  }

  /** The vehicle numbered `id`, if it's here. */
  byId(id: number): Vehicle | undefined {
    return this.vehicles.find((v) => v.id === id);
  }

  remove(v: Vehicle): void {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    this.before.delete(v);
  }

  /** Column (cx, cz) has loaded: its stored vehicles come back where they were. */
  columnLoaded(cx: number, cz: number): void {
    const key = columnKey(cx, cz);
    const list = this.stored.get(key);
    if (!list) return;
    this.stored.delete(key);
    for (const r of list) this.vehicles.push(this.fromRecord(r));
  }

  /** Every vehicle, here and stored, as saved. */
  records(): VehicleRecord[] {
    const out: VehicleRecord[] = [];
    for (const list of this.stored.values()) out.push(...list);
    for (const v of this.vehicles) out.push(recordOf(v));
    return out;
  }

  /** What was saved, cleaned (kinds there are, finite numbers, at most the cap), stored by column until it loads. */
  load(saved: unknown): void {
    this.stored.clear();
    if (!Array.isArray(saved)) return;
    let n = 0;
    for (const raw of saved) {
      if (n >= TUNING.vehicles.most) break;
      const r = cleanRecord(raw);
      if (!r) continue;
      const key = columnKey(toChunk(Math.floor(r.x)), toChunk(Math.floor(r.z)));
      const list = this.stored.get(key);
      if (list) list.push(r);
      else this.stored.set(key, [r]);
      n++;
    }
  }

  private store(v: Vehicle): void {
    const r = recordOf(v);
    const key = columnKey(toChunk(Math.floor(r.x)), toChunk(Math.floor(r.z)));
    const list = this.stored.get(key);
    if (list) list.push(r);
    else this.stored.set(key, [r]);
  }

  private fromRecord(r: VehicleRecord): Vehicle {
    const v = createVehicle(this.nextId++, r.kind, r.x, r.y, r.z, r.yaw);
    v.speed = r.speed;
    if (r.rail) v.rail = { x: r.rail[0], y: r.rail[1], z: r.rail[2], s: r.rail[3] };
    if (v.slots && r.slots) {
      const back = Inventory.from(r.slots, CART_SLOTS);
      back.slots.forEach((s, i) => (v.slots!.slots[i] = s));
    }
    return v;
  }
}

function recordOf(v: Vehicle): VehicleRecord {
  const b = v.body;
  const r: VehicleRecord = { kind: v.kind, x: b.x, y: b.y, z: b.z, yaw: v.yaw, rail: v.rail ? [v.rail.x, v.rail.y, v.rail.z, v.rail.s] : null, speed: v.speed };
  if (v.slots) r.slots = v.slots.toJSON();
  return r;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function cleanRecord(raw: unknown): VehicleRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== VehicleKind.Cart && o.kind !== VehicleKind.ChestCart) return null;
  if (![o.x, o.y, o.z].every(finite) || Math.abs(o.x as number) > 2 ** 21 || Math.abs(o.z as number) > 2 ** 21 || Math.abs(o.y as number) > 1024) return null;
  const rail = Array.isArray(o.rail) && o.rail.length === 4 && o.rail.every(finite) && (o.rail as number[]).slice(0, 3).every(Number.isInteger) ? (o.rail as [number, number, number, number]) : null;
  const C = TUNING.vehicles.cart;
  const r: VehicleRecord = {
    kind: o.kind,
    x: o.x as number,
    y: o.y as number,
    z: o.z as number,
    yaw: finite(o.yaw) ? o.yaw : 0,
    rail,
    speed: finite(o.speed) ? Math.max(-C.max, Math.min(C.max, o.speed)) : 0,
  };
  if (o.kind === VehicleKind.ChestCart) r.slots = Inventory.from(o.slots, CART_SLOTS).toJSON();
  return r;
}
