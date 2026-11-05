// A survival player's inventory: 36 slots, the first 9 the hotbar (or any number of slots: a
// furnace has 3). A slot holds a stack of one
// item, up to its stack size (a tool alone, with how worn it is). Adding fills stacks already
// there first, then empty slots, the hotbar first; spending takes from the end, so the hotbar
// keeps what's in it longest. Picking up and putting down are what the inventory screen does with
// the stack held on the pointer. Pure.

import { isItem, itemInfo } from './items';

export interface Stack {
  item: number;
  count: number;
  /** A tool's blocks broken so far. */
  wear?: number;
}

/** Items and how many of each, as recipes cost them. */
export type Cost = readonly (readonly [number, number])[];

export const SLOTS = 36;
export const HOTBAR_SLOTS = 9;

const stackOf = (item: number): number => itemInfo(item).stack;

export class Inventory {
  readonly slots: (Stack | null)[];

  constructor(readonly size = SLOTS) {
    this.slots = new Array<Stack | null>(size).fill(null);
  }

  /** Put in `count` of `item` (a tool `wear` worn); returns how many didn't fit. */
  add(item: number, count = 1, wear?: number): number {
    const most = stackOf(item);
    let left = count;
    if (most > 1) {
      for (const s of this.slots) {
        if (!left) break;
        if (!s || s.item !== item || s.count >= most) continue;
        const n = Math.min(left, most - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < this.size && left; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(left, most);
      this.slots[i] = most === 1 && wear !== undefined ? { item, count: n, wear } : { item, count: n };
      left -= n;
    }
    return left;
  }

  /** How many of `item` there are in all. */
  count(item: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.item === item) n += s.count;
    return n;
  }

  /** Is there at least `cost` of everything in it? */
  has(cost: Cost): boolean {
    return cost.every(([item, n]) => this.count(item) >= n);
  }

  /** Take `cost` away, from the last slots first. Only call when `has(cost)`. */
  spend(cost: Cost): void {
    for (const [item, n] of cost) {
      let left = n;
      for (let i = this.size - 1; i >= 0 && left; i--) {
        const s = this.slots[i];
        if (!s || s.item !== item) continue;
        const k = Math.min(left, s.count);
        s.count -= k;
        left -= k;
        if (!s.count) this.slots[i] = null;
      }
    }
  }

  /** Would all of these fit (without changing anything)? */
  fits(adds: Cost): boolean {
    const copy = this.clone();
    return adds.every(([item, n]) => copy.add(item, n) === 0);
  }

  /** One of slot `slot`'s items used up (a block placed); returns the item, or null if it was empty. */
  takeOne(slot: number): number | null {
    const s = this.slots[slot];
    if (!s) return null;
    s.count--;
    if (!s.count) this.slots[slot] = null;
    return s.item;
  }

  /** The tool in slot `slot` broke a block: one more wear. Returns true if that wore it out (it's gone). */
  wearTool(slot: number): boolean {
    const s = this.slots[slot];
    const tool = s && itemInfo(s.item).tool;
    if (!s || !tool) return false;
    s.wear = (s.wear ?? 0) + 1;
    if (s.wear < tool.wear) return false;
    this.slots[slot] = null;
    return true;
  }

  /** Pick up slot `slot`'s stack, or half of it (rounded up); null if it's empty. */
  pick(slot: number, half = false): Stack | null {
    const s = this.slots[slot];
    if (!s) return null;
    if (!half || s.count === 1) {
      this.slots[slot] = null;
      return s;
    }
    const n = Math.ceil(s.count / 2);
    s.count -= n;
    return { ...s, count: n };
  }

  /**
   * Put `held` down in slot `slot` (only one of it, with `one`): into an empty slot, onto a stack of
   * the same item up to its size, or swapped with a different one. Returns what's still held.
   */
  put(slot: number, held: Stack, one = false): Stack | null {
    const s = this.slots[slot];
    const n = one ? 1 : held.count;
    const rest = (k: number): Stack | null => (held.count - k > 0 ? { ...held, count: held.count - k } : null);
    if (!s) {
      this.slots[slot] = { ...held, count: n };
      return rest(n);
    }
    if (s.item === held.item && s.count < stackOf(s.item)) {
      const k = Math.min(n, stackOf(s.item) - s.count);
      s.count += k;
      return rest(k);
    }
    // Different (or a full stack of the same): swapped, unless putting down one, which can't go there.
    if (one) return held;
    this.slots[slot] = held;
    return s;
  }

  /** Move slot `slot`'s stack between the hotbar and the rest (as much of it as fits there). */
  shiftMove(slot: number): void {
    const s = this.slots[slot];
    if (!s) return;
    const [from, to] = slot < HOTBAR_SLOTS ? [HOTBAR_SLOTS, SLOTS] : [0, HOTBAR_SLOTS];
    const most = stackOf(s.item);
    for (let i = from; i < to && s.count; i++) {
      const t = this.slots[i];
      if (!t || t.item !== s.item || t.count >= most) continue;
      const k = Math.min(s.count, most - t.count);
      t.count += k;
      s.count -= k;
    }
    for (let i = from; i < to && s.count; i++) {
      if (this.slots[i]) continue;
      this.slots[i] = s;
      this.slots[slot] = null;
      return;
    }
    if (!s.count) this.slots[slot] = null;
  }

  clone(): Inventory {
    const copy = new Inventory(this.size);
    this.slots.forEach((s, i) => (copy.slots[i] = s && { ...s }));
    return copy;
  }

  /** As saved: the slots, empty ones null. */
  toJSON(): (Stack | null)[] {
    return this.slots.map((s) => s && { ...s });
  }

  /**
   * An inventory from what was saved (or sent): anything that isn't an item, a count that isn't a
   * whole number from 1 to the item's stack size, or a wear that isn't a whole number below the
   * tool's, is left out.
   */
  static from(saved: unknown, size = SLOTS): Inventory {
    const inv = new Inventory(size);
    if (!Array.isArray(saved)) return inv;
    for (let i = 0; i < size && i < saved.length; i++) {
      const s: unknown = saved[i];
      if (typeof s !== 'object' || s === null) continue;
      const { item, count, wear } = s as Record<string, unknown>;
      if (typeof item !== 'number' || !isItem(item)) continue;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > stackOf(item)) continue;
      const tool = itemInfo(item).tool;
      if (tool && wear !== undefined && (typeof wear !== 'number' || !Number.isInteger(wear) || wear < 0 || wear >= tool.wear)) continue;
      inv.slots[i] = tool && typeof wear === 'number' ? { item, count, wear } : { item, count };
    }
    return inv;
  }
}
