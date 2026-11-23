// Kept animals (Milestone 17): an animal fed its food becomes the player's, and isn't a wild one
// any more. A kept animal never despawns; when its column unloads it's stored here (its kind, where
// it was, how long it has left to grow and to wait before breeding), and it comes back when the
// column loads again. The world record keeps them all. Pure.

import { TUNING } from '../config';
import { toChunk } from '../world/coords';
import { KINDS, type MobKind } from './kinds';

/** A kept animal as stored and saved. */
export interface KeptRecord {
  kind: MobKind;
  x: number;
  y: number;
  z: number;
  /** Seconds left growing up (0: grown). */
  grow: number;
  /** Seconds left before it may breed again (0: it may). */
  wait: number;
}

const columnKey = (x: number, z: number): string => `${toChunk(Math.floor(x))},${toChunk(Math.floor(z))}`;

/** Kept animals whose columns aren't loaded, by column. */
export class KeptAnimals {
  private readonly byColumn = new Map<string, KeptRecord[]>();
  private count = 0;

  /** How many are stored. */
  get stored(): number {
    return this.count;
  }

  /** Put one away (its column unloaded). */
  store(r: KeptRecord): void {
    const key = columnKey(r.x, r.z);
    let list = this.byColumn.get(key);
    if (!list) this.byColumn.set(key, (list = []));
    list.push(r);
    this.count++;
  }

  /** The ones stored in column (cx, cz), taken out (its column loaded). */
  take(cx: number, cz: number): KeptRecord[] {
    const key = `${cx},${cz}`;
    const list = this.byColumn.get(key) ?? [];
    this.byColumn.delete(key);
    this.count -= list.length;
    return list;
  }

  /** Every one stored. */
  all(): KeptRecord[] {
    return [...this.byColumn.values()].flat();
  }

  /**
   * From what was saved: records of an animal kind (not a hostile one), at finite places, with
   * times not below 0; at most `TUNING.mobs.kept`. Anything else is dropped.
   */
  static from(saved: unknown): KeptAnimals {
    const kept = new KeptAnimals();
    if (!Array.isArray(saved)) return kept;
    for (const r of saved) {
      if (kept.count >= TUNING.mobs.kept) break;
      if (typeof r !== 'object' || r === null) continue;
      const { kind, x, y, z, grow, wait } = r as Record<string, unknown>;
      if (!Number.isInteger(kind) || (kind as number) < 0 || (kind as number) >= KINDS.length || KINDS[kind as number].hostile || KINDS[kind as number].folk) continue;
      if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
      kept.store({ kind: kind as MobKind, x: x as number, y: y as number, z: z as number, grow: time(grow), wait: time(wait) });
    }
    return kept;
  }
}
