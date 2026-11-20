// What guests' survival asks of the host (`HostWorld`'s drop, take, container, containerPut and
// containerTake): the host's ground, furnaces and chests changed for them, each ask checked against
// where the guest was last heard. A take goes to the first who asks; what's left of a stack stays.
// A put never swaps: what's in the slot stays, and what doesn't go in comes back. A chest cart is a
// chest at the place (its id, `VEHICLE_Y`, 0) (Milestone 18). Pure: the game passes its ground,
// furnaces, chests, blocks, chest carts and the guests' states.

import { TUNING } from '../config';
import { CHEST_SLOTS, type Chests } from '../survival/chest';
import { Furnace, type Furnaces } from '../survival/furnace';
import { type GroundItems, inReach } from '../survival/ground';
import type { Inventory } from '../survival/inventory';
import { chestOf, furnaceOf, type Block } from '../world/blocks';
import type { HostWorld } from './session';
import { VEHICLE_Y } from './protocol';
import type { Vehicle } from '../vehicles/vehicle';

/** Where a guest was last heard: its feet. */
export interface Heard {
  x: number;
  y: number;
  z: number;
}

export type HostSurvival = Pick<HostWorld, 'drop' | 'take' | 'container' | 'containerPut' | 'containerTake'>;

export function hostSurvival(
  ground: GroundItems,
  furnaces: Furnaces,
  chests: Chests,
  blockAt: (x: number, y: number, z: number) => Block,
  heard: (player: number) => Heard | undefined,
  /** The vehicle numbered `id`, for chest carts (none: there are no chest carts). */
  vehicle: (id: number) => Vehicle | undefined = () => undefined,
): HostSurvival {
  // Where a guest was heard is a little behind where it is: a little further than its own reach.
  const slack = TUNING.net.reachSlack;
  const reach = TUNING.edit.reach + slack + 1;
  /** The furnace or chest at (x, y, z) if it's within reach of the player's eye; null if not (or there's none). */
  const near = (player: number, x: number, y: number, z: number): 'furnace' | 'chest' | 'cart' | null => {
    const who = heard(player);
    if (y === VEHICLE_Y) {
      const v = vehicle(x);
      if (!who || !v?.slots) return null;
      return Math.hypot(v.body.x - who.x, v.body.y + 0.5 - (who.y + TUNING.player.eyeHeight), v.body.z - who.z) <= reach ? 'cart' : null;
    }
    const b = blockAt(x, y, z);
    const kind = furnaceOf(b) ? 'furnace' : chestOf(b) ? 'chest' : null;
    if (!who || !kind) return null;
    return Math.hypot(x + 0.5 - who.x, y + 0.5 - (who.y + TUNING.player.eyeHeight), z + 0.5 - who.z) <= reach ? kind : null;
  };
  /** The slots of the container at (x, y, z), and whether a slot may take a stack. */
  const slotsOf = (kind: 'furnace' | 'chest' | 'cart', x: number, y: number, z: number): Inventory =>
    kind === 'furnace' ? furnaces.at(x, y, z).slots : kind === 'cart' ? vehicle(x)!.slots! : chests.at(x, y, z);
  return {
    drop: (player, stack, x, y, z, vx, vy, vz, delay) => {
      const who = heard(player);
      if (who && Math.hypot(x - who.x, y - who.y, z - who.z) <= reach + 1) ground.drop(x, y, z, stack, vx, vy, vz, delay);
    },
    take: (player, id, count) => {
      const g = ground.byId(id);
      const who = heard(player);
      if (!g || !who || g.delay > 0 || count < 1) return null;
      const b = g.body;
      if (!inReach(b.x, b.y, b.z, who) && Math.hypot(b.x - who.x, b.y - who.y, b.z - who.z) > TUNING.survival.ground.pickup + slack + 1) return null;
      const n = Math.min(count, g.count);
      g.count -= n;
      if (!g.count) ground.remove(g.id);
      return g.wear !== undefined ? { item: g.item, count: n, wear: g.wear } : { item: g.item, count: n };
    },
    // A furnace's state (`Furnace.toJSON`), or a chest's slots.
    container: (player, x, y, z) => {
      const kind = near(player, x, y, z);
      if (kind === 'furnace') return furnaces.at(x, y, z).toJSON();
      if (kind === 'chest' || kind === 'cart') return { slots: slotsOf(kind, x, y, z).toJSON() };
      return null;
    },
    containerPut: (player, x, y, z, slot, stack) => {
      const kind = near(player, x, y, z);
      if (!kind || (kind === 'furnace' ? !Furnace.accepts(slot, stack) : slot >= CHEST_SLOTS)) return stack;
      const slots = slotsOf(kind, x, y, z);
      const there = slots.slots[slot];
      if (there && there.item !== stack.item) return stack;
      return slots.put(slot, stack);
    },
    containerTake: (player, x, y, z, slot) => {
      const kind = near(player, x, y, z);
      if (!kind) return null;
      const slots = slotsOf(kind, x, y, z);
      if (slot >= slots.size) return null;
      const there = slots.slots[slot] ?? null;
      slots.slots[slot] = null;
      return there;
    },
  };
}
