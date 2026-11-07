// Chests' contents (Milestone 13): 27 slots each, by place, kept in the world record as furnaces
// are. Breaking a chest drops what's in it (the game's to do). Pure.

import { Inventory, type Stack } from './inventory';

/** Slots in a chest: three rows of nine. */
export const CHEST_SLOTS = 27;

/** A world's chests' contents, by place. */
export class Chests {
  private readonly byPlace = new Map<string, Inventory>();

  /** What's in the chest at (x, y, z); a new empty one if nothing is kept there. */
  at(x: number, y: number, z: number): Inventory {
    const key = `${x},${y},${z}`;
    let c = this.byPlace.get(key);
    if (!c) this.byPlace.set(key, (c = new Inventory(CHEST_SLOTS)));
    return c;
  }

  /** The one kept at (x, y, z), if any. */
  get(x: number, y: number, z: number): Inventory | undefined {
    return this.byPlace.get(`${x},${y},${z}`);
  }

  /** Forget the chest at (x, y, z) (broken); what was in it, to drop. */
  remove(x: number, y: number, z: number): Stack[] {
    const key = `${x},${y},${z}`;
    const c = this.byPlace.get(key);
    this.byPlace.delete(key);
    return c ? c.slots.filter((s): s is Stack => s !== null) : [];
  }

  get size(): number {
    return this.byPlace.size;
  }

  /** As saved: by "x,y,z", each its slots. Empty chests aren't kept. */
  toJSON(): Record<string, (Stack | null)[]> {
    const out: Record<string, (Stack | null)[]> = {};
    for (const [key, c] of this.byPlace) if (c.slots.some((s) => s !== null)) out[key] = c.toJSON();
    return out;
  }

  /** From what was saved, each chest cleaned as an inventory is; places that aren't three whole numbers are dropped. */
  static from(saved: unknown): Chests {
    const chests = new Chests();
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return chests;
    for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
      const parts = key.split(',').map(Number);
      if (parts.length !== 3 || !parts.every(Number.isInteger)) continue;
      chests.byPlace.set(parts.join(','), Inventory.from(value, CHEST_SLOTS));
    }
    return chests;
  }
}
