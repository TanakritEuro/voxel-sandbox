// A survival player's health and air, stepped once a frame with how the body is (`TUNING.survival`):
// - a fall: the highest the feet were since they last stood (on the ground, in water or flying),
//   against where they land; water breaks a fall, and flying is no fall;
// - drowning: the eyes under water use up air, then cost a point a second; above, air comes back;
// - cactus: a point every half second while touching one;
// - healing: from a while after the last hurt, a point every few seconds.
// Pure: the game says how the body is and what it touches.

import { TUNING } from '../config';

/** How the body is this frame. */
export interface Condition {
  /** Feet height. */
  y: number;
  onGround: boolean;
  inWater: boolean;
  flying: boolean;
  eyeInWater: boolean;
  touchingCactus: boolean;
}

const S = TUNING.survival;

export class Health {
  health = S.maxHealth;
  /** Seconds of air left. */
  air = S.air;
  /** What hurt last. */
  cause: 'fall' | 'drowning' | 'cactus' | null = null;
  /** The highest the feet were since they last stood; null while standing, in water or flying. */
  private top: number | null = null;
  /** Where the feet last stood (a fall starts there, not a frame below it). */
  private stood: number | null = null;
  private sinceHurt = Infinity;
  private healClock = 0;
  private drownClock = 0;
  private cactusClock = S.cactusEvery;

  get dead(): boolean {
    return this.health <= 0;
  }

  /** One frame of `dt` seconds; returns the points lost in it. */
  step(dt: number, c: Condition): number {
    let damage = 0;
    // Falling.
    if (c.inWater || c.flying) {
      this.top = null;
      this.stood = c.y;
    } else if (c.onGround) {
      const fall = this.top === null ? 0 : Math.max(0, Math.floor(this.top - c.y - S.safeFall + 1e-6));
      if (fall) this.cause = 'fall';
      damage += fall;
      this.top = null;
      this.stood = c.y;
    } else this.top = Math.max(this.top ?? this.stood ?? c.y, c.y);
    // Air.
    if (c.eyeInWater) {
      this.air = Math.max(0, this.air - dt);
      if (this.air === 0) {
        this.drownClock += dt;
        while (this.drownClock >= S.drownEvery) {
          this.drownClock -= S.drownEvery;
          damage++;
          this.cause = 'drowning';
        }
      }
    } else {
      this.air = Math.min(S.air, this.air + dt * S.airBack);
      this.drownClock = 0;
    }
    // Cactus: at once on touching, then every so often.
    if (c.touchingCactus) {
      this.cactusClock += dt;
      while (this.cactusClock >= S.cactusEvery) {
        this.cactusClock -= S.cactusEvery;
        damage++;
        this.cause = 'cactus';
      }
    } else this.cactusClock = S.cactusEvery;
    // Hurt, or healing.
    if (damage) {
      this.health = Math.max(0, this.health - damage);
      this.sinceHurt = 0;
      this.healClock = 0;
    } else {
      this.sinceHurt += dt;
      if (this.sinceHurt >= S.healDelay && this.health < S.maxHealth && !this.dead) {
        this.healClock += dt;
        while (this.healClock >= S.healEvery && this.health < S.maxHealth) {
          this.healClock -= S.healEvery;
          this.health++;
        }
      }
    }
    return damage;
  }

  /** Back to full, as after starting again. */
  reset(): void {
    this.health = S.maxHealth;
    this.air = S.air;
    this.top = null;
    this.stood = null;
    this.sinceHurt = Infinity;
    this.healClock = 0;
    this.drownClock = 0;
    this.cactusClock = S.cactusEvery;
    this.cause = null;
  }

  toJSON(): { health: number; air: number } {
    return { health: this.health, air: this.air };
  }

  /** Health from what was saved: whole points 1 to the most (dead or broken is full), air 0 to the most. */
  static from(saved: unknown): Health {
    const h = new Health();
    if (typeof saved !== 'object' || saved === null) return h;
    const { health, air } = saved as Record<string, unknown>;
    if (typeof health === 'number' && Number.isInteger(health) && health >= 1 && health <= S.maxHealth) h.health = health;
    if (typeof air === 'number' && air >= 0 && air <= S.air) h.air = air;
    return h;
  }
}
