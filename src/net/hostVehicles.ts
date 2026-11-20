// What guests ask of the host's vehicles (Milestone 18; `HostWorld`'s mount, dismount, rideMoved,
// placeVehicle and hitVehicle), each checked against where the guest was last heard. A guest rides
// what it got into: the host takes where the guest has it (unless it's a jump) and doesn't step it
// meanwhile (`VehicleManager.riddenElsewhere`). Pure: the game passes its vehicles, blocks, the guests'
// states and what to do with what a broken one gives.

import { TUNING } from '../config';
import type { Stack } from '../survival/inventory';
import { railOf } from '../world/blocks';
import type { BlockSource } from '../world/physics';
import { surfaceAt } from '../vehicles/boat';
import type { VehicleManager } from '../vehicles/manager';
import { VehicleKind } from '../vehicles/vehicle';
import type { Heard } from './hostSurvival';
import type { HostWorld } from './session';

export type HostVehicles = Pick<HostWorld, 'mount' | 'dismount' | 'rideMoved' | 'placeVehicle' | 'hitVehicle'>;

/** A rider's vehicle further than this from where it was (blocks) is a jump: not taken. */
const JUMP = 16;

export function hostVehicles(
  vehicles: VehicleManager,
  blocks: BlockSource,
  heard: (player: number) => Heard | undefined,
  /** Is the world creative (one hit breaks a vehicle, and gives nothing)? */
  creative: () => boolean,
  /** Put what a broken vehicle gives on the ground at (x, y, z). */
  give: (stack: Stack, x: number, y: number, z: number) => void,
  /** Player `player` is out of what it rode (it's gone): the game's own (0) or a guest's. */
  out: (player: number) => void,
): HostVehicles {
  const reach = TUNING.edit.reach + TUNING.net.reachSlack + 2;
  /** Is (x, y, z) within reach of the player's eye, as last heard? */
  const near = (player: number, x: number, y: number, z: number) => {
    const who = heard(player);
    return who !== undefined && Math.hypot(x - who.x, y - (who.y + TUNING.player.eyeHeight), z - who.z) <= reach;
  };
  return {
    mount: (player, id) => {
      const v = vehicles.byId(id);
      if (!v || !near(player, v.body.x, v.body.y + 0.5, v.body.z)) return false;
      return vehicles.ride(v, player);
    },
    dismount: (player) => vehicles.leave(player),
    rideMoved: (player, pose) => {
      const v = vehicles.byId(pose.id);
      if (!v || v.rider !== player) return;
      const b = v.body;
      if (Math.hypot(pose.x - b.x, pose.y - b.y, pose.z - b.z) > JUMP) return;
      b.x = pose.x;
      b.y = pose.y;
      b.z = pose.z;
      v.yaw = pose.yaw;
      v.pitch = pose.pitch;
      v.speed = pose.speed;
      v.rail = pose.rail ? { x: pose.rail[0], y: pose.rail[1], z: pose.rail[2], s: pose.rail[3] } : null;
    },
    placeVehicle: (player, kind, x, y, z, yaw) => {
      if (!near(player, x, y, z)) return false;
      if (kind === VehicleKind.Boat) {
        const s = surfaceAt(blocks, x, y + 0.1, z);
        if (s === null || Math.abs(s - TUNING.vehicles.boat.draft - y) > 0.5) return false;
        return vehicles.placeBoat(x, s - TUNING.vehicles.boat.draft, z, yaw) !== null;
      }
      const [bx, by, bz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
      if (!railOf(blocks.getBlock(bx, by, bz))) return false;
      return vehicles.placeCart(kind === VehicleKind.ChestCart ? VehicleKind.ChestCart : VehicleKind.Cart, bx, by, bz, yaw) !== null;
    },
    hitVehicle: (player, id) => {
      const v = vehicles.byId(id);
      if (!v || !near(player, v.body.x, v.body.y + 0.3, v.body.z)) return;
      const rider = v.rider;
      const gives = vehicles.hit(v, creative());
      if (!gives) return;
      if (rider >= 0) out(rider);
      if (!creative()) for (const st of gives) give(st, v.body.x, v.body.y + 0.5, v.body.z);
    },
  };
}
