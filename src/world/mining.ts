// Breaking a block takes time: hold the button on it for its `hardness` in seconds. Looking
// at another block or letting go starts again from nothing. After a block breaks there's a
// short pause before the next one starts, so holding the button doesn't dig two at once.

import { TUNING } from '../config';
import { type Block, BLOCKS } from './blocks';

export interface MiningTarget {
  x: number;
  y: number;
  z: number;
  block: Block;
}

/** Crack stages drawn over a block being broken. */
export const CRACK_STAGES = 10;

export class Mining {
  /** The block being broken, or null. */
  target: MiningTarget | null = null;
  /** Seconds it has been held on the target. */
  held = 0;
  private pause = 0;

  /**
   * Once per frame, with the block looked at and whether the button is down. Returns the
   * block that broke this frame, if one did.
   */
  update(looking: MiningTarget | null, down: boolean, dt: number): MiningTarget | null {
    this.pause = Math.max(0, this.pause - dt);
    if (!down || !looking || this.pause > 0) {
      this.target = null;
      this.held = 0;
      return null;
    }
    const t = this.target;
    if (!t || t.x !== looking.x || t.y !== looking.y || t.z !== looking.z || t.block !== looking.block) {
      this.target = { ...looking };
      this.held = 0;
    }
    this.held += dt;
    if (this.held < BLOCKS[looking.block].hardness) return null;
    const broken = this.target;
    this.target = null;
    this.held = 0;
    this.pause = TUNING.edit.breakPause;
    return broken;
  }

  /** 0 .. CRACK_STAGES - 1 while breaking, by how far along it is; -1 when not. */
  get stage(): number {
    if (!this.target) return -1;
    const fraction = this.held / BLOCKS[this.target.block].hardness;
    return Math.min(CRACK_STAGES - 1, Math.floor(fraction * CRACK_STAGES));
  }
}
