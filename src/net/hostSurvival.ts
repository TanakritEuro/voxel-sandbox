// What guests' survival asks of the host (`HostWorld`'s drop, take, furnace, furnacePut and
// furnaceTake): the host's ground and furnaces changed for them, each ask checked against where the
// guest was last heard. A take goes to the first who asks; what's left of a stack stays. Pure: the
// game passes its ground, furnaces, blocks and the guests' states.

import { TUNING } from '../config';
import { Furnace, type Furnaces } from '../survival/furnace';
import { type GroundItems, inReach } from '../survival/ground';
import { furnaceOf, type Block } from '../world/blocks';
import type { HostWorld } from './session';

/** Where a guest was last heard: its feet. */
export interface Heard {
  x: number;
  y: number;
  z: number;
}

export type HostSurvival = Pick<HostWorld, 'drop' | 'take' | 'furnace' | 'furnacePut' | 'furnaceTake'>;

export function hostSurvival(ground: GroundItems, furnaces: Furnaces, blockAt: (x: number, y: number, z: number) => Block, heard: (player: number) => Heard | undefined): HostSurvival {
  // Where a guest was heard is a little behind where it is: a little further than its own reach.
  const slack = TUNING.net.reachSlack;
  const reach = TUNING.edit.reach + slack + 1;
  /** Is there a furnace at (x, y, z) within reach of the player's eye? */
  const furnaceNear = (player: number, x: number, y: number, z: number): boolean => {
    const who = heard(player);
    if (!who || !furnaceOf(blockAt(x, y, z))) return false;
    return Math.hypot(x + 0.5 - who.x, y + 0.5 - (who.y + TUNING.player.eyeHeight), z + 0.5 - who.z) <= reach;
  };
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
    furnace: (player, x, y, z) => (furnaceNear(player, x, y, z) ? furnaces.at(x, y, z).toJSON() : null),
    furnacePut: (player, x, y, z, slot, stack) => {
      if (!furnaceNear(player, x, y, z) || !Furnace.accepts(slot, stack)) return stack;
      const slots = furnaces.at(x, y, z).slots;
      const there = slots.slots[slot];
      // Never swapped: what's there stays, and the stack goes back.
      if (there && there.item !== stack.item) return stack;
      return slots.put(slot, stack);
    },
    furnaceTake: (player, x, y, z, slot) => {
      if (!furnaceNear(player, x, y, z)) return null;
      const slots = furnaces.at(x, y, z).slots;
      const there = slots.slots[slot] ?? null;
      slots.slots[slot] = null;
      return there;
    },
  };
}
