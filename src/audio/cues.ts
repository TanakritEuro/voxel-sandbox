// Which sounds the player's movement and digging make, and when: pure, so the cadence and the
// choices are tested without a browser (as five-a-side's cues). `sound.ts` plays them.
//
// - A footstep for every `TUNING.sound.stride` blocks walked on the ground (so faster when
//   sprinting), in the material of the block underfoot; none in the air, flying or swimming.
// - Landing from a fall faster than a jump's: a thud, louder for a bigger fall, and a step.
// - Splashing into water, from how fast the player went in.
// - Digging: a hit in the block's material every `TUNING.sound.digInterval` while breaking.

import { TUNING } from '../config';
import { type Block, BLOCKS, type BlockSound } from '../world/blocks';
import { HALF_WIDTH } from '../world/physics';

export type SoundEvent =
  | { name: 'step' | 'dig' | 'break' | 'place' | 'land'; material: BlockSound; gain: number }
  | { name: 'splash'; gain: number };

/** What the cues need from the player each frame. */
export interface CueInput {
  /** Seconds since the last frame. */
  dt: number;
  /** Horizontal distance moved since the last frame (blocks). */
  moved: number;
  vy: number;
  onGround: boolean;
  flying: boolean;
  inWater: boolean;
  /** The material underfoot (`underfoot`), or null over nothing. */
  ground: BlockSound | null;
  /** The material of the block being broken, or null. */
  digging: BlockSound | null;
}

/** Something to ask for blocks: the world, or a stand-in. */
export interface BlockSource {
  getBlock(x: number, y: number, z: number): Block;
}

/**
 * The material the player stands on: the block under the middle of the feet, or (standing
 * over an edge) under one of the box's corners; null with nothing solid underneath.
 */
export function underfoot(world: BlockSource, x: number, y: number, z: number): BlockSound | null {
  const below = Math.floor(y - 0.05);
  const half = HALF_WIDTH - 0.01;
  for (const [dx, dz] of [[0, 0], [-half, -half], [half, -half], [-half, half], [half, half]]) {
    const info = BLOCKS[world.getBlock(Math.floor(x + dx), below, Math.floor(z + dz))];
    if (!info.passable) return info.sound;
  }
  return null;
}

/** How loud a landing is at `speed` (blocks a second downwards): 0 up to a jump's, rising to 1. */
export function landingGain(speed: number): number {
  const S = TUNING.sound;
  return Math.max(0, Math.min(1, (speed - S.landSpeed) / S.landFullSpeed));
}

export class SoundCues {
  /** Distance walked since the last step. */
  private walked = 0;
  /** Fastest downward speed since leaving the ground. */
  private falling = 0;
  private wasOnGround = true;
  private wasInWater = false;
  private lastVy = 0;
  /** Time until the next digging hit. */
  private digWait = 0;

  /** Once a frame: the sounds this frame makes. */
  frame(f: CueInput): SoundEvent[] {
    const S = TUNING.sound;
    const out: SoundEvent[] = [];
    // Footsteps. The distance counts in the air too (stepping down a slope is a short drop each
    // block), but a step sounds only on the ground: the one due in the air comes on touching down.
    if (!f.flying && !f.inWater) {
      this.walked = Math.min(this.walked + f.moved, S.stride);
      if (f.onGround && f.ground && this.walked >= S.stride) {
        this.walked -= S.stride;
        out.push({ name: 'step', material: f.ground, gain: S.step });
      }
    }
    // Landing: how fast it was falling just before (the body's speed is zeroed on landing).
    if (!f.onGround) this.falling = Math.max(this.falling, -f.vy);
    if (f.onGround && !this.wasOnGround && !f.flying) {
      const gain = landingGain(this.falling);
      if (gain > 0 && f.ground) {
        out.push({ name: 'land', material: f.ground, gain });
        // The landing has its own step; the next comes half a stride on.
        this.walked = S.stride / 2;
      }
    }
    if (f.onGround) this.falling = 0;
    // Into the water.
    if (f.inWater && !this.wasInWater) {
      const speed = Math.max(-this.lastVy, -f.vy);
      if (speed >= S.splashSpeed) out.push({ name: 'splash', gain: Math.min(1, speed / S.splashFullSpeed) });
    }
    // Digging: a hit at once, then every interval.
    if (f.digging) {
      this.digWait -= f.dt;
      if (this.digWait <= 0) {
        this.digWait += S.digInterval;
        if (this.digWait <= 0) this.digWait = S.digInterval;
        out.push({ name: 'dig', material: f.digging, gain: S.dig });
      }
    } else this.digWait = 0;
    this.wasOnGround = f.onGround;
    this.wasInWater = f.inWater;
    this.lastVy = f.vy;
    return out;
  }
}
