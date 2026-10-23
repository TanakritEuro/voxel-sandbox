/** A random number generator returning floats in [0, 1), like `Math.random`. */
export type Rng = () => number;

/** Seeded PRNG (mulberry32). World generation must be deterministic: never use `Math.random` in it. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic hash of integer coordinates and a seed to [0, 1). For per-column decisions (trees, ores). */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Turns frame times into whole fixed steps. The time left over says how far the drawing is
 * between the last step and the next (`alpha`), for interpolating.
 */
export class FixedStep {
  private accumulator = 0;

  constructor(
    readonly step: number,
    /** After a long stall (a hidden tab), drop the backlog rather than run hundreds of steps. */
    private readonly maxSteps = 8,
  ) {}

  /** Steps to run for a frame `dt` seconds long. */
  advance(dt: number): number {
    this.accumulator += dt;
    // The small slack keeps sums of frame times that land on a step boundary from rounding just short of it.
    let steps = Math.floor(this.accumulator / this.step + 1e-9);
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.accumulator = steps * this.step;
    }
    this.accumulator = Math.max(0, this.accumulator - steps * this.step);
    return steps;
  }

  /** 0..1: how far the present is from the last step towards the next. */
  get alpha(): number {
    return Math.min(1, this.accumulator / this.step);
  }
}
