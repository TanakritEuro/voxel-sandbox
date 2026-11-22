// Lightning: in a storm, every 8–25 s a bolt 40–240 blocks from one of the players, chosen
// here on the machine that runs the world. It's only somewhere to draw and hear one: no damage,
// no block changed, no block light. Pure.

import { TUNING } from '../config';
import { createRng, type Rng } from '../math';

export interface Bolt {
  /** Where it meets the ground. */
  x: number;
  y: number;
  z: number;
  /** Its shape's. */
  seed: number;
}

/** Keeps its numbers apart from the land's and the spells'. */
const SALT = 0x0b01_7f1a;

export class Lightning {
  private readonly rng: Rng;
  private wait: number;

  /** `start` is how far the weather had got when the world was opened, so each visit's bolts differ. */
  constructor(seed: number, start = 0) {
    this.rng = createRng(seed ^ SALT ^ Math.floor(start * 100));
    this.wait = this.gap();
  }

  /**
   * `dt` on, with a storm on or not, round `players` ((x, z) each): a bolt when one is due.
   * `ground` is asked how high the land is where it lands.
   */
  step(dt: number, storming: boolean, players: readonly (readonly [number, number])[], ground: (x: number, z: number) => number): Bolt | null {
    if (!storming || !players.length) return null;
    this.wait -= dt;
    if (this.wait > 0) return null;
    this.wait = this.gap();
    const L = TUNING.weather.lightning;
    const [px, pz] = players[Math.floor(this.rng() * players.length)];
    const away = L.away.min + this.rng() * (L.away.max - L.away.min);
    const angle = this.rng() * 2 * Math.PI;
    const x = px + away * Math.cos(angle);
    const z = pz + away * Math.sin(angle);
    return { x, y: ground(x, z), z, seed: Math.floor(this.rng() * 0x1_0000_0000) };
  }

  private gap(): number {
    const { min, max } = TUNING.weather.lightning.every;
    return min + this.rng() * (max - min);
  }
}
