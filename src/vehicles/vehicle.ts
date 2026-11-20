// Vehicles (Milestone 18): what a cart (or, later, a boat) is. Its body is a box like a mob's;
// a cart on a rail is kept on it by where along the rail's path it is, not by its body. Pure.

import { TUNING } from '../config';
import { Inventory } from '../survival/inventory';
import { type Body, createBody } from '../world/physics';

export enum VehicleKind {
  Cart = 0,
  ChestCart = 1,
  Boat = 2,
}

/** Slots a chest cart carries. */
export const CART_SLOTS = 27;

/** Where a cart is on a rail: the rail's block, and how far along its path (blocks, from its first end). */
export interface OnRail {
  x: number;
  y: number;
  z: number;
  s: number;
}

export interface Vehicle {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly body: Body;
  /** Facing (0 looks along -z, as the camera does), and nose up (radians), for drawing. */
  yaw: number;
  pitch: number;
  /** On a rail, or null (off rails: its body falls and slides). */
  rail: OnRail | null;
  /** Along the rail's path, blocks a second (positive towards its second end). */
  speed: number;
  /** The player riding it (a player number, 0 this one's host), or -1. */
  rider: number;
  /** Hits taken lately, and seconds since the last. */
  hits: number;
  sinceHit: number;
  /** A chest cart's slots; null for the rest. */
  readonly slots: Inventory | null;
}

export function createVehicle(id: number, kind: VehicleKind, x: number, y: number, z: number, yaw = 0): Vehicle {
  const C = kind === VehicleKind.Boat ? TUNING.vehicles.boat : TUNING.vehicles.cart;
  return {
    id,
    kind,
    body: createBody(x, y, z, C.halfWidth, C.height),
    yaw,
    pitch: 0,
    rail: null,
    speed: 0,
    rider: -1,
    hits: 0,
    sinceHit: Number.POSITIVE_INFINITY,
    slots: kind === VehicleKind.ChestCart ? new Inventory(CART_SLOTS) : null,
  };
}

/** The rider's feet above the vehicle's. */
export const seatHeight = (v: Vehicle): number => (v.kind === VehicleKind.Boat ? TUNING.vehicles.boat.seat : TUNING.vehicles.seat);

/** Can it be ridden (a chest cart can't: it's full of chest)? */
export const rideable = (v: Vehicle): boolean => v.kind !== VehicleKind.ChestCart;
