import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { packState, type PlayerState, RIDING_BYTES, STATE_BYTES, unpackState } from '../src/net/playerState';
import { parseMessage, PROTOCOL, VEHICLE_Y } from '../src/net/protocol';
import { RemotePlayer } from '../src/net/remotePlayer';
import { VehicleMirror } from '../src/net/vehicleMirror';
import { packVehicles, unpackVehicles } from '../src/net/vehicleState';
import { Block } from '../src/world/blocks';
import { createVehicle, VehicleKind } from '../src/vehicles/vehicle';

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  time: 5,
  x: 10.5,
  y: 70.35,
  z: -3.5,
  yaw: 1,
  pitch: 0,
  flying: false,
  crouching: false,
  swimming: false,
  onGround: true,
  held: Block.Air,
  swings: 0,
  digging: Block.Air,
  ...over,
});

describe('vehicles on the wire', () => {
  it('pack 52 bytes a vehicle, with its rider and where it is on a rail, and come back as they were', () => {
    expect(PROTOCOL).toBe(11);
    const cart = createVehicle(4, VehicleKind.Cart, 10.5, 70, -3.25, 1);
    cart.rail = { x: 10, y: 70, z: -4, s: 0.75 };
    cart.speed = -3.5;
    cart.rider = 2;
    const boat = createVehicle(5, VehicleKind.Boat, 0.25, 62.94, 8, 2);
    const data = packVehicles([cart, boat]);
    expect(data.byteLength).toBe(104);
    const [a, b] = unpackVehicles(data)!;
    expect(a).toMatchObject({ id: 4, kind: VehicleKind.Cart, x: 10.5, y: 70, z: -3.25, rider: 2, speed: -3.5, rail: [10, 70, -4, 0.75] });
    expect(b).toMatchObject({ id: 5, kind: VehicleKind.Boat, rider: -1, rail: null });
    const bad = (i: number, v: number) => {
      const f = new Float32Array(packVehicles([cart]));
      f[i] = v;
      return unpackVehicles(f.buffer);
    };
    expect(bad(1, 7)).toBe(null); // no such kind
    expect(bad(7, 99)).toBe(null); // no such player
    expect(bad(2, Number.NaN)).toBe(null);
    expect(unpackVehicles(new ArrayBuffer(51))).toBe(null);
  });

  it("carry a rider's vehicle in their state (168 bytes), and draw them sitting", () => {
    const riding = { id: 4, x: 10.5, y: 70, z: -3.5, yaw: 1, pitch: 0.2, speed: 6, rail: [10, 70, -4, 0.5] as [number, number, number, number] };
    const data = packState(state({ riding }));
    expect(data.byteLength).toBe(RIDING_BYTES);
    expect(unpackState(data)!.riding).toEqual(riding);
    expect(packState(state()).byteLength).toBe(STATE_BYTES);
    expect(unpackState(packState(state()))!.riding).toBeUndefined();
    // Its vehicle far from the rider: not a state.
    expect(unpackState(packState(state({ riding: { ...riding, x: 40 } })))).toBe(null);
    const r = new RemotePlayer();
    r.push(state({ time: 1, riding }));
    expect(r.poseAt(1 + TUNING.net.behind)!.sitting).toBe(true);
  });

  it('are asked for and answered in messages checked on arrival; a chest cart is a container at (its id, -1, 0)', () => {
    expect(parseMessage({ type: 'mount', id: 3 })).toEqual({ type: 'mount', id: 3 });
    expect(parseMessage({ type: 'mount', id: -3 })).toBe(null);
    expect(parseMessage({ type: 'dismount' })).toEqual({ type: 'dismount' });
    expect(parseMessage({ type: 'vplace', kind: 2, x: 1.5, y: 62.9, z: 3.5, yaw: 0 })).toMatchObject({ kind: 2 });
    expect(parseMessage({ type: 'vplace', kind: 3, x: 1.5, y: 62.9, z: 3.5, yaw: 0 })).toBe(null);
    expect(parseMessage({ type: 'vhit', id: 9 })).toEqual({ type: 'vhit', id: 9 });
    expect(parseMessage({ type: 'copen', x: 9, y: VEHICLE_Y, z: 0 })).toEqual({ type: 'copen', x: 9, y: VEHICLE_Y, z: 0 });
    expect(parseMessage({ type: 'copen', x: 9, y: VEHICLE_Y, z: 1 })).toBe(null);
    expect(parseMessage({ type: 'copen', x: 9, y: -2, z: 0 })).toBe(null);
    const data = packVehicles([createVehicle(1, VehicleKind.Cart, 0, 64, 0)]);
    expect(parseMessage({ type: 'vehicles', time: 3, data })).toEqual({ type: 'vehicles', time: 3, data });
  });

  it("are drawn by a guest between the host's snapshots, and go when they're left out", () => {
    const mirror = new VehicleMirror();
    const at = (x: number, rider = -1) => ({ id: 7, kind: VehicleKind.Cart, x, y: 70, z: 0, yaw: 0, pitch: 0, rider, speed: 1, rail: null });
    mirror.push(1, [at(0)]);
    mirror.push(1.1, [at(1, 3)]);
    mirror.update(1.05 + TUNING.net.mobBehind);
    const v = mirror.byId(7)!;
    expect(v.body.x).toBeCloseTo(0.5);
    expect(v.rider).toBe(3);
    mirror.push(1.2, []);
    expect(mirror.vehicles).toEqual([]);
  });
});
