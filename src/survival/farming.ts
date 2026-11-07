// Farming (Milestone 13): tilling earth, sowing seeds, and wheat growing. Pure.
//
// - A spade's right click on grass or dirt with air above makes farmland (`tillable`).
// - Seeds' right click on the top of farmland with air above sows wheat at stage 0 (`sowable`).
// - Wheat grows a stage at a time to 7 (ripe), each stage `TUNING.survival.farming.stageSeconds`
//   (a little more or less for each plant and stage, from its place: a field doesn't grow in step),
//   only while the light on it is at least `farming.light` (the sun by the daylight, or block light),
//   and only in loaded land. `Crops` keeps each plant's seconds into its stage, saved in the world
//   record; the game steps it every frame (a slice of the plants each time) and makes the stages
//   it returns.

import { TUNING } from '../config';
import { hash3 } from '../math';
import { Block, wheat, wheatStage } from '../world/blocks';

interface Blocks {
  getBlock(x: number, y: number, z: number): Block;
}

/** Can a spade till the block at (x, y, z): grass or dirt, with air above? */
export function tillable(world: Blocks, x: number, y: number, z: number): boolean {
  const b = world.getBlock(x, y, z);
  return (b === Block.Grass || b === Block.Dirt) && world.getBlock(x, y + 1, z) === Block.Air;
}

/** Can seeds be sown on the block at (x, y, z): farmland, with air above? */
export function sowable(world: Blocks, x: number, y: number, z: number): boolean {
  return world.getBlock(x, y, z) === Block.Farmland && world.getBlock(x, y + 1, z) === Block.Air;
}

/** How long wheat at (x, y, z) takes over stage `stage` (seconds): the tuning's, give or take a fifth. */
export function stageTime(x: number, y: number, z: number, stage: number): number {
  const spread = hash3(stage, x, y, z);
  return TUNING.survival.farming.stageSeconds * (0.8 + 0.4 * spread);
}

/** Is light `light` (sun << 4 | block light), with the sky at `daylight` (0–1), enough to grow by? */
export function growingLight(light: number, daylight: number): boolean {
  return Math.max(Math.round((light >> 4) * daylight), light & 15) >= TUNING.survival.farming.light;
}

/** What the game asks of the world to step the crops. */
export interface CropWorld extends Blocks {
  /** Is the land at (x, z) loaded? */
  loaded(x: number, z: number): boolean;
  getLight(x: number, y: number, z: number): number;
}

/** A plant: where, seconds into its stage, and when (on the crops' clock) it was last looked at. */
interface Plant {
  x: number;
  y: number;
  z: number;
  grown: number;
  seen: number;
}

/**
 * A world's wheat, by place. Stepped every frame, it looks at a slice of the plants each time, so
 * that each is looked at about every `farming.tickSeconds` and a big field costs a little every frame
 * rather than all at once; each grows by the time since it was last looked at.
 */
export class Crops {
  private readonly byPlace = new Map<string, Plant>();
  /** The plants in the order they're looked at, the next at `cursor`. */
  private readonly plants: Plant[] = [];
  private cursor = 0;
  /** Seconds stepped so far. */
  private clock = 0;

  /** Wheat sown at (x, y, z): it starts at stage 0. */
  sow(x: number, y: number, z: number): void {
    this.add(x, y, z, 0);
  }

  /** Seconds the wheat at (x, y, z) has grown into its stage, if it's kept. */
  grown(x: number, y: number, z: number): number | undefined {
    return this.byPlace.get(`${x},${y},${z}`)?.grown;
  }

  get size(): number {
    return this.plants.length;
  }

  /**
   * `dt` seconds: a slice of the plants (all of them when `dt` is a whole `tickSeconds`) is looked at.
   * Each in loaded land with light enough grows by the time since it was last looked at, and one
   * reaching the end of its stage goes up one. Returns the stages to set. Plants no longer wheat are
   * forgotten; ripe ones stop counting; time in unloaded land or the dark doesn't count.
   */
  step(dt: number, world: CropWorld, daylight: number): [number, number, number, Block][] {
    const changes: [number, number, number, Block][] = [];
    this.clock += dt;
    const plants = this.plants;
    let count = Math.min(plants.length, Math.ceil((plants.length * dt) / TUNING.survival.farming.tickSeconds));
    while (count-- > 0 && plants.length) {
      if (this.cursor >= plants.length) this.cursor = 0;
      const plant = plants[this.cursor];
      const elapsed = this.clock - plant.seen;
      plant.seen = this.clock;
      const { x, y, z } = plant;
      if (!world.loaded(x, z)) {
        this.cursor++;
        continue;
      }
      const stage = wheatStage(world.getBlock(x, y, z));
      if (stage < 0) {
        // Gone: the last plant takes its place in the order.
        this.byPlace.delete(`${x},${y},${z}`);
        plants[this.cursor] = plants[plants.length - 1];
        plants.pop();
        continue;
      }
      this.cursor++;
      if (stage >= 7 || !growingLight(world.getLight(x, y, z), daylight)) continue;
      plant.grown += elapsed;
      if (plant.grown >= stageTime(x, y, z, stage)) {
        plant.grown = 0;
        changes.push([x, y, z, wheat(stage + 1)]);
      }
    }
    return changes;
  }

  /** As saved: seconds into the stage by "x,y,z". */
  toJSON(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, plant] of this.byPlace) out[key] = plant.grown;
    return out;
  }

  /** From what was saved: places that aren't three whole numbers, and times that aren't numbers from 0, dropped. */
  static from(saved: unknown): Crops {
    const crops = new Crops();
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return crops;
    for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
      const parts = key.split(',').map(Number);
      if (parts.length !== 3 || !parts.every(Number.isInteger)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
      crops.add(parts[0], parts[1], parts[2], value);
    }
    return crops;
  }

  private add(x: number, y: number, z: number, grown: number): void {
    const key = `${x},${y},${z}`;
    const was = this.byPlace.get(key);
    if (was) {
      was.grown = grown;
      was.seen = this.clock;
      return;
    }
    const plant = { x, y, z, grown, seen: this.clock };
    this.byPlace.set(key, plant);
    this.plants.push(plant);
  }
}
