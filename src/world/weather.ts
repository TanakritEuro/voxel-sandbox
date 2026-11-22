// The weather: one for the whole world, in spells. Spell n is a pure function of the world's
// seed and n: a dry stretch, then a wet one (rain, a storm, or only cloud), so a world's first
// stretch is always dry. All that's kept is which spell it is, how far into it, and how much
// snow has settled and how wet the ground is, stepped only while the world runs (there's no
// day count to work it out from) and saved in the world's record. The weather is for looks:
// daylight, which the rules read, knows nothing of it. Pure.

import { TUNING } from '../config';
import { clamp, hash3 } from '../math';

export const WEATHER_KINDS = ['clear', 'overcast', 'rain', 'storm'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export interface Spell {
  /** Seconds dry, then seconds of `kind`. */
  dry: number;
  wet: number;
  kind: Exclude<WeatherKind, 'clear'>;
}

/** The weather now: its kind and how far it has come on, 0 (as clear) to 1. */
export interface WeatherNow {
  kind: WeatherKind;
  amount: number;
}

/** What's saved in a world's record. */
export interface WeatherRecord {
  spell: number;
  elapsed: number;
  settled: number;
  wet: number;
}

/** Keeps the spells' hashes apart from the land's. */
const SALT = 0x5eed_c10d;
/** The highest spell number a record may say (centuries of play). */
const LAST_SPELL = 0x3fff_ffff;

/** Spell `n` of the world with `seed`. */
export function spellAt(seed: number, n: number): Spell {
  const W = TUNING.weather;
  const at = (salt: number) => hash3(seed ^ SALT, n, salt, 0);
  const pick = at(3);
  return {
    dry: W.dry.min + (W.dry.max - W.dry.min) * at(1),
    wet: W.spell.min + (W.spell.max - W.spell.min) * at(2),
    kind: pick < W.shares.rain ? 'rain' : pick < W.shares.rain + W.shares.storm ? 'storm' : 'overcast',
  };
}

/** A `?weather=` value, or null if it isn't one. */
export const weatherKindOf = (text: string | null): WeatherKind | null => WEATHER_KINDS.find((k) => k === text) ?? null;

const falls = (kind: WeatherKind): boolean => kind === 'rain' || kind === 'storm';
const minutes = (seconds: number): string => {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Weather {
  /** How much snow lies where it snows, and how wet the ground is, each 0–1. */
  settled = 0;
  wet = 0;
  private spell = 0;
  private elapsed = 0;
  private current: Spell;
  private heldKind: WeatherKind | null = null;

  constructor(private readonly seed: number) {
    this.current = spellAt(seed, 0);
  }

  /** A world's saved weather, cleaned; junk, or none (older worlds), starts clear at the first spell. */
  static from(seed: number, saved: unknown): Weather {
    const weather = new Weather(seed);
    if (typeof saved !== 'object' || saved === null) return weather;
    const { spell, elapsed, settled, wet } = saved as Record<string, unknown>;
    if (typeof spell !== 'number' || !Number.isInteger(spell) || spell < 0 || spell > LAST_SPELL) return weather;
    const current = spellAt(seed, spell);
    if (typeof elapsed !== 'number' || !(elapsed >= 0 && elapsed < current.dry + current.wet)) return weather;
    weather.spell = spell;
    weather.elapsed = elapsed;
    weather.current = current;
    const share = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : 0);
    weather.settled = share(settled);
    weather.wet = share(wet);
    return weather;
  }

  get held(): boolean {
    return this.heldKind !== null;
  }

  /** Keep the weather at `kind`, fully come on, for trying it (`?weather`): the spells wait. */
  hold(kind: WeatherKind): void {
    this.heldKind = kind;
    this.wet = falls(kind) ? 1 : 0;
  }

  /** On by `dt` seconds. However they're divided into steps, it ends up the same. */
  step(dt: number): void {
    if (!(dt > 0 && Number.isFinite(dt))) return;
    if (this.heldKind) {
      this.soak(dt, falls(this.heldKind));
      return;
    }
    let left = dt;
    while (left > 0) {
      const { dry, wet, kind } = this.current;
      const inDry = this.elapsed < dry;
      const end = inDry ? dry : dry + wet;
      const falling = !inDry && falls(kind);
      const until = end - this.elapsed;
      if (left < until) {
        this.elapsed += left;
        this.soak(left, falling);
        return;
      }
      this.soak(until, falling);
      left -= until;
      this.elapsed = end;
      if (inDry) continue;
      this.current = spellAt(this.seed, ++this.spell);
      this.elapsed = 0;
    }
  }

  now(): WeatherNow {
    if (this.heldKind) return { kind: this.heldKind, amount: this.heldKind === 'clear' ? 0 : 1 };
    const { dry, wet, kind } = this.current;
    const into = this.elapsed - dry;
    if (into < 0) return { kind: 'clear', amount: 0 };
    // Coming on over the first seconds of the wet stretch and clearing over its last.
    const t = clamp(Math.min(into, wet - into) / TUNING.weather.ease, 0, 1);
    return { kind, amount: t * t * (3 - 2 * t) };
  }

  /** Whether it's a storm: what a bed can be used in by day. */
  get storming(): boolean {
    return this.now().kind === 'storm';
  }

  /** Seconds of the wet stretch left; 0 in a dry one, or held. */
  get left(): number {
    const { dry, wet } = this.current;
    return this.heldKind || this.elapsed < dry ? 0 : dry + wet - this.elapsed;
  }

  /** Slept through what's left of the wet stretch, as if it had run out; the seconds that passed. */
  sitOut(): number {
    const left = this.left;
    this.step(left);
    return left;
  }

  /** Cleared up (a night slept): on to the next spell's dry stretch, the ground as wet and white as it was. */
  clearUp(): void {
    if (!this.left) return;
    this.current = spellAt(this.seed, ++this.spell);
    this.elapsed = 0;
  }

  toJSON(): WeatherRecord {
    return { spell: this.spell, elapsed: this.elapsed, settled: this.settled, wet: this.wet };
  }

  /** For `?stats`. */
  describe(): string {
    const { kind, amount } = this.now();
    const { dry, wet, kind: coming } = this.current;
    let when: string;
    if (this.held) when = `${kind} (held)`;
    else if (this.elapsed < dry) when = `clear, ${coming} in ${minutes(dry - this.elapsed)}`;
    else when = `${kind} ${Math.round(amount * 100)} %, ${minutes(dry + wet - this.elapsed)} left`;
    return `${when}; ground wet ${Math.round(this.wet * 100)} %, snow settled ${Math.round(this.settled * 100)} %`;
  }

  private soak(dt: number, falling: boolean): void {
    const W = TUNING.weather;
    this.settled = clamp(this.settled + (falling ? dt / W.settle : -dt / W.melt), 0, 1);
    this.wet = clamp(this.wet + (falling ? dt / W.soak : -dt / W.dryOut), 0, 1);
  }
}
