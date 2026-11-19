// Chests' contents (Milestone 13): 27 slots each, by place, kept in the world record as furnaces
// are. Breaking a chest drops what's in it (the game's to do). A structure's chest (Milestone 16)
// is filled from its loot (`loot.ts`) the first time it's opened or broken, and never again: the
// places filled are kept, saved even when empty. Pure.

import { Inventory, type Stack } from './inventory';

/** Slots in a chest: three rows of nine. */
export const CHEST_SLOTS = 27;

/** Where loot comes from: a structure's chest's slots at (x, y, z), or null where there's none. */
export type LootSource = (x: number, y: number, z: number) => (Stack | null)[] | null;

/** A world's chests' contents, by place. */
export class Chests {
  private readonly byPlace = new Map<string, Inventory>();
  /** Places whose loot has been given (filled, or kept from a save): never filled again. */
  private readonly looted = new Set<string>();

  constructor(private readonly loot: LootSource | null = null) {}

  /** What's in the chest at (x, y, z); a new one if nothing is kept there, with its loot if it's a structure's and not looted yet. */
  at(x: number, y: number, z: number): Inventory {
    const key = `${x},${y},${z}`;
    let c = this.byPlace.get(key);
    if (!c) {
      c = new Inventory(CHEST_SLOTS);
      const found = this.looted.has(key) ? null : (this.loot?.(x, y, z) ?? null);
      if (found) {
        found.forEach((st, i) => (c!.slots[i] = st ? { ...st } : null));
        this.looted.add(key);
      }
      this.byPlace.set(key, c);
    }
    return c;
  }

  /** The one kept at (x, y, z), if any. */
  get(x: number, y: number, z: number): Inventory | undefined {
    return this.byPlace.get(`${x},${y},${z}`);
  }

  /** Forget the chest at (x, y, z) (broken); what was in it, to drop (a structure's loot, if never opened). */
  remove(x: number, y: number, z: number): Stack[] {
    const key = `${x},${y},${z}`;
    const c = this.byPlace.get(key) ?? (this.loot && !this.looted.has(key) && this.loot(x, y, z) ? this.at(x, y, z) : undefined);
    this.byPlace.delete(key);
    return c ? c.slots.filter((s): s is Stack => s !== null) : [];
  }

  get size(): number {
    return this.byPlace.size;
  }

  /** As saved: by "x,y,z", each its slots. Empty chests aren't kept, but looted places are, empty or gone. */
  toJSON(): Record<string, (Stack | null)[]> {
    const out: Record<string, (Stack | null)[]> = {};
    for (const [key, c] of this.byPlace) if (c.slots.some((s) => s !== null)) out[key] = c.toJSON();
    for (const key of this.looted) out[key] ??= this.byPlace.get(key)?.toJSON() ?? [];
    return out;
  }

  /** From what was saved, each chest cleaned as an inventory is; places that aren't three whole numbers are dropped. */
  static from(saved: unknown, loot: LootSource | null = null): Chests {
    const chests = new Chests(loot);
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return chests;
    for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
      const parts = key.split(',').map(Number);
      if (parts.length !== 3 || !parts.every(Number.isInteger)) continue;
      chests.byPlace.set(parts.join(','), Inventory.from(value, CHEST_SLOTS));
      // Whatever was saved here, loot isn't given here again (a looted chest saved empty, or broken).
      chests.looted.add(parts.join(','));
    }
    return chests;
  }
}
