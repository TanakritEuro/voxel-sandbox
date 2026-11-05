// Furnaces (survival): three slots, what goes in, its fuel and what comes out. While there's
// something to smelt and room for what it makes, a furnace lights a fuel and burns it down,
// smelting an item every `TUNING.survival.smeltSeconds`; once lit, a fuel burns to its end
// whatever happens. A furnace's contents are kept by its place (`Furnaces`), saved with the
// world's record; a furnace block with nothing kept is an empty one. Pure: the game steps the
// furnaces in loaded land and lights or puts out the block when `lit` changes.

import { TUNING } from '../config';
import { Block } from '../world/blocks';
import { Inventory, type Stack } from './inventory';
import { Item, itemInfo } from './items';

/** The slots: what goes in, the fuel, what comes out. */
export const INPUT = 0;
export const FUEL = 1;
export const OUTPUT = 2;

/** What smelts into what. */
export const SMELTS: ReadonlyMap<number, number> = new Map<number, number>([
  [Item.RawCopper, Item.Copper],
  [Item.RawIron, Item.Iron],
  [Block.Sand, Block.Glass],
  [Item.RawMeat, Item.CookedMeat],
]);

/** What burns, and for how many items smelted. */
export const FUELS: ReadonlyMap<number, number> = new Map<number, number>([
  [Item.Coal, 8],
  [Block.Wood, 1.5],
  [Block.SpruceWood, 1.5],
  [Block.Planks, 1.5],
  [Item.Stick, 0.5],
]);

export class Furnace {
  readonly slots = new Inventory(3);
  /** Seconds of fire left, and how long the fuel burning lasts in all (for the flame shown). */
  burn = 0;
  burnTotal = 0;
  /** Seconds into smelting the item in. */
  progress = 0;

  get lit(): boolean {
    return this.burn > 0;
  }

  /** Is there something in to smelt, and room for what it makes? */
  get canSmelt(): boolean {
    const input = this.slots.slots[INPUT];
    const makes = input && SMELTS.get(input.item);
    if (!makes) return false;
    const out = this.slots.slots[OUTPUT];
    return !out || (out.item === makes && out.count < itemInfo(makes).stack);
  }

  /** `dt` seconds of burning and smelting. Returns true if it was lit or put out. */
  step(dt: number): boolean {
    const was = this.lit;
    const T = TUNING.survival.smeltSeconds;
    let left = dt;
    for (let guard = 0; left > 0 && guard < 64; guard++) {
      const smelting = this.canSmelt;
      if (!smelting) this.progress = 0;
      if (this.burn <= 0) {
        // Out: a new fuel is lit only for something to smelt.
        const fuel = this.slots.slots[FUEL];
        const lasts = fuel ? FUELS.get(fuel.item) : undefined;
        if (!smelting || !lasts) break;
        this.slots.takeOne(FUEL);
        this.burn = this.burnTotal = lasts * T;
      }
      const t = smelting ? Math.min(left, this.burn, T - this.progress) : Math.min(left, this.burn);
      this.burn = Math.max(0, this.burn - t);
      left -= t;
      if (!smelting) continue;
      this.progress += t;
      if (this.progress >= T - 1e-9) {
        this.progress = 0;
        const makes = SMELTS.get(this.slots.slots[INPUT]!.item)!;
        this.slots.takeOne(INPUT);
        // Into the output slot itself (adding would fill the first empty slot: the fuel's, burnt).
        const out = this.slots.slots[OUTPUT];
        if (out) out.count++;
        else this.slots.slots[OUTPUT] = { item: makes, count: 1 };
      }
    }
    if (this.burn <= 0) this.burnTotal = 0;
    return this.lit !== was;
  }

  /** May `stack` be put in slot `slot`? Anything goes in, only fuel in the fuel, nothing in the output. */
  static accepts(slot: number, stack: Stack): boolean {
    return slot === INPUT || (slot === FUEL && FUELS.has(stack.item));
  }

  /** Everything in it, for dropping when it's broken. */
  contents(): Stack[] {
    return this.slots.slots.filter((s): s is Stack => s !== null);
  }

  toJSON(): { slots: (Stack | null)[]; burn: number; burnTotal: number; progress: number } {
    return { slots: this.slots.toJSON(), burn: this.burn, burnTotal: this.burnTotal, progress: this.progress };
  }

  /** A furnace from what was saved, cleaned as an inventory is; times out of range start from nothing. */
  static from(saved: unknown): Furnace {
    const f = new Furnace();
    if (typeof saved !== 'object' || saved === null) return f;
    const { slots, burn, burnTotal, progress } = saved as Record<string, unknown>;
    const inv = Inventory.from(slots, 3);
    inv.slots.forEach((s, i) => (f.slots.slots[i] = s));
    const T = TUNING.survival.smeltSeconds;
    const ok = (v: unknown, most: number): v is number => typeof v === 'number' && v >= 0 && v <= most;
    if (ok(burnTotal, Math.max(...FUELS.values()) * T) && ok(burn, burnTotal)) {
      f.burn = burn;
      f.burnTotal = burnTotal;
    }
    if (ok(progress, T)) f.progress = progress;
    return f;
  }
}

/** A world's furnaces, by place. */
export class Furnaces {
  private readonly byPlace = new Map<string, Furnace>();

  /** The furnace at (x, y, z); a new empty one if none is kept there. */
  at(x: number, y: number, z: number): Furnace {
    const key = `${x},${y},${z}`;
    let f = this.byPlace.get(key);
    if (!f) this.byPlace.set(key, (f = new Furnace()));
    return f;
  }

  /** The one kept at (x, y, z), if any. */
  get(x: number, y: number, z: number): Furnace | undefined {
    return this.byPlace.get(`${x},${y},${z}`);
  }

  /** Forget the furnace at (x, y, z) (broken); returns it, if there was one. */
  remove(x: number, y: number, z: number): Furnace | undefined {
    const key = `${x},${y},${z}`;
    const f = this.byPlace.get(key);
    this.byPlace.delete(key);
    return f;
  }

  /** Every furnace kept, with its place. */
  *entries(): IterableIterator<[number, number, number, Furnace]> {
    for (const [key, f] of this.byPlace) {
      const [x, y, z] = key.split(',').map(Number);
      yield [x, y, z, f];
    }
  }

  get size(): number {
    return this.byPlace.size;
  }

  /** As saved: by "x,y,z". Empty, out furnaces aren't kept. */
  toJSON(): Record<string, ReturnType<Furnace['toJSON']>> {
    const out: Record<string, ReturnType<Furnace['toJSON']>> = {};
    for (const [key, f] of this.byPlace) if (f.lit || f.contents().length) out[key] = f.toJSON();
    return out;
  }

  static from(saved: unknown): Furnaces {
    const fs = new Furnaces();
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return fs;
    for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
      const parts = key.split(',').map(Number);
      if (parts.length !== 3 || !parts.every(Number.isInteger)) continue;
      fs.byPlace.set(parts.join(','), Furnace.from(value));
    }
    return fs;
  }
}
