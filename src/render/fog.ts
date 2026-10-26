// Fog by biome: the air looks different where you stand. Each biome has a tint, how much of it
// shows, and where the fog starts (a fraction of the view distance): a warm haze close in over
// the desert, clear cold air in the mountains, a touch of green in forests, plains as before.
// They're blended by the climate's biome weights at the player's position, eased over a few
// seconds so crossing a border doesn't flick, and mixed into the time of day's horizon colour:
// fully by day, hardly at all at night. The result is the horizon for the fog, the background
// and the sky dome alike, so the edge of the world still melts into the sky. Pure.

import { TUNING } from '../config';
import { BIOME_COUNT } from '../world/biomes';
import type { RGB } from './sky';

export interface BiomeFog {
  /** The tint (sRGB 0–1) and how much of it shows by day (0–1). */
  tint: RGB;
  amount: number;
  /** Where the fog starts, as a fraction of the view distance. */
  start: number;
}

const rgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Each biome's fog, in `Biome` order (plains, forest, desert, mountains). */
export function biomeFogs(): BiomeFog[] {
  const F = TUNING.fog;
  return [F.plains, F.forest, F.desert, F.mountains].map((f) => ({ tint: rgb(f.tint), amount: f.amount, start: f.start }));
}

/**
 * The fog for biome `weights` (in `Biome` order, summing to 1): tints are blended weighted by
 * how much each shows, so a biome without a tint doesn't wash out its neighbour's colour.
 */
export function blendFog(weights: ArrayLike<number>, fogs: readonly BiomeFog[] = biomeFogs()): BiomeFog {
  const tint: RGB = [0, 0, 0];
  let amount = 0;
  let start = 0;
  let sum = 0;
  for (let b = 0; b < BIOME_COUNT; b++) {
    const w = weights[b];
    sum += w;
    start += w * fogs[b].start;
    amount += w * fogs[b].amount;
    for (let c = 0; c < 3; c++) tint[c] += w * fogs[b].amount * fogs[b].tint[c];
  }
  if (sum > 0) start /= sum;
  if (amount > 0) for (let c = 0; c < 3; c++) tint[c] /= amount;
  else tint.fill(1);
  if (sum > 0) amount /= sum;
  return { tint, amount, start };
}

/** Move `current` towards `target` (in place): about 63 % of the way in `seconds`. */
export function easeFog(current: BiomeFog, target: BiomeFog, dt: number, seconds: number): BiomeFog {
  const k = 1 - Math.exp(-dt / seconds);
  current.amount += (target.amount - current.amount) * k;
  current.start += (target.start - current.start) * k;
  for (let c = 0; c < 3; c++) current.tint[c] += (target.tint[c] - current.tint[c]) * k;
  return current;
}

/**
 * The horizon colour for the time of day's `horizon` (sRGB), under `fog`, with `daylight`
 * from `TUNING.day.night` (no tint) to 1 (the full tint). The tint is darkened to the day's
 * light, so a sandy haze doesn't glow at dusk.
 */
export function fogColour(horizon: RGB, fog: BiomeFog, daylight: number): RGB {
  const night = TUNING.day.night;
  const day = Math.max(0, Math.min(1, (daylight - night) / (1 - night)));
  const k = fog.amount * day;
  return [0, 1, 2].map((c) => horizon[c] + (fog.tint[c] * daylight - horizon[c]) * k) as RGB;
}
