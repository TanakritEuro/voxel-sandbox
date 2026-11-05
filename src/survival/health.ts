// A survival player's health, air and hunger, stepped once a frame with how the body is
// (`TUNING.survival`):
// - a fall: the highest the feet were since they last stood (on the ground, in water or flying),
//   against where they land; water breaks a fall, and flying is no fall;
// - drowning: the eyes under water use up air, then cost a point a second; above, air comes back;
// - cactus: a point every half second while touching one;
// - hunger: lost slowly, faster sprinting, swimming and digging; eating gives it back;
// - healing: from a while after the last hurt, a point every few seconds, only well fed, costing
//   hunger; starving costs health down to 1 point, never the last.
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
  /** Working hard: each makes it hungrier. */
  sprinting?: boolean;
  swimming?: boolean;
  digging?: boolean;
}

const S = TUNING.survival;

export class Health {
  health = S.maxHealth;
  /** Seconds of air left. */
  air = S.air;
  /** Hunger points: full at `TUNING.survival.maxHunger`. */
  hunger = S.maxHunger;
  /** What hurt last. */
  cause: 'fall' | 'drowning' | 'cactus' | 'starving' | null = null;
  /** The highest the feet were since they last stood; null while standing, in water or flying. */
  private top: number | null = null;
  /** Where the feet last stood (a fall starts there, not a frame below it). */
  private stood: number | null = null;
  private sinceHurt = Infinity;
  private healClock = 0;
  private drownClock = 0;
  private cactusClock = S.cactusEvery;
  private starveClock = 0;
  /** Hunger used and not yet taken off a whole point. */
  private used = 0;

  get dead(): boolean {
    return this.health <= 0;
  }

  /** One frame of `dt` seconds; returns the points of health lost in it. */
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
    // Hunger: a point a minute, more working hard.
    const perMinute = S.hungerBase + (c.sprinting ? S.hungerSprint : 0) + (c.swimming ? S.hungerSwim : 0) + (c.digging ? S.hungerDig : 0);
    this.useHunger((perMinute / 60) * dt);
    // Starving: a point every so often, never the last.
    if (this.hunger === 0 && this.health > 1) {
      this.starveClock += dt;
      while (this.starveClock >= S.starveEvery && this.health - damage > 1) {
        this.starveClock -= S.starveEvery;
        damage++;
        this.cause = 'starving';
      }
    } else this.starveClock = 0;
    // Hurt, or healing (well fed, at a cost).
    if (damage) {
      this.health = Math.max(0, this.health - damage);
      this.sinceHurt = 0;
      this.healClock = 0;
    } else {
      this.sinceHurt += dt;
      if (this.sinceHurt >= S.healDelay && this.health < S.maxHealth && !this.dead && this.hunger >= S.healHunger) {
        this.healClock += dt;
        while (this.healClock >= S.healEvery && this.health < S.maxHealth && this.hunger >= S.healHunger) {
          this.healClock -= S.healEvery;
          this.health++;
          this.useHunger(S.healCost);
        }
      } else this.healClock = 0;
    }
    return damage;
  }

  /** Eat food worth `points`: refused (false) when full. */
  eat(points: number): boolean {
    if (this.hunger >= S.maxHunger) return false;
    this.hunger = Math.min(S.maxHunger, this.hunger + points);
    this.used = 0;
    return true;
  }

  /** Back to full, as after starting again. */
  reset(): void {
    this.health = S.maxHealth;
    this.air = S.air;
    this.hunger = S.maxHunger;
    this.used = 0;
    this.top = null;
    this.stood = null;
    this.sinceHurt = Infinity;
    this.healClock = 0;
    this.drownClock = 0;
    this.cactusClock = S.cactusEvery;
    this.starveClock = 0;
    this.cause = null;
  }

  toJSON(): { health: number; air: number; hunger: number } {
    return { health: this.health, air: this.air, hunger: this.hunger };
  }

  /**
   * Health from what was saved: whole points 1 to the most (dead or broken is full), air 0 to the
   * most, hunger 0 to the most (missing, from before hunger: full).
   */
  static from(saved: unknown): Health {
    const h = new Health();
    if (typeof saved !== 'object' || saved === null) return h;
    const { health, air, hunger } = saved as Record<string, unknown>;
    if (typeof health === 'number' && Number.isInteger(health) && health >= 1 && health <= S.maxHealth) h.health = health;
    if (typeof air === 'number' && air >= 0 && air <= S.air) h.air = air;
    if (typeof hunger === 'number' && Number.isInteger(hunger) && hunger >= 0 && hunger <= S.maxHunger) h.hunger = hunger;
    return h;
  }

  /** Hunger used: whole points come off as they add up. */
  private useHunger(points: number): void {
    this.used += points;
    // Within a hair of 1 counts: sixty frames' sixtieths don't quite add up to one.
    while (this.used >= 1 - 1e-9 && this.hunger > 0) {
      this.used = Math.max(0, this.used - 1);
      this.hunger--;
    }
    if (this.hunger === 0) this.used = 0;
  }
}
