// How the weather sounds where the ear is: pure, as `cues.ts`; `sound.ts` plays it.
//
// - Rain is a bed of noise: full and bright in the open; under cover, muffled and louder the
//   nearer the nearest open place (within `reach` blocks) or the roof it drums on is; silent deep
//   underground. Snow is nearly silent.
// - Thunder comes 0.3–2 s after its bolt by the distance, quieter and duller from far off, and
//   muffled like the rain under cover.

import { TUNING } from '../config';
import { Fall } from '../world/cover';
import type { Bolt } from '../world/lightning';

/** The rain's sound: how loud (0–1, before the master volume) and how open (0 muffled – 1 bright). */
export interface RainHeard {
  level: number;
  open: number;
}

/** Cover to ask: the height (blocks) rain gets down to at a column, and what falls there. */
export interface CoverLookup {
  heightAt(x: number, z: number): number;
  fallAt(x: number, z: number): Fall;
}

/**
 * How open the sky is to an ear at (x, y, z): 1 in the open, falling to 0 as the nearest open
 * place gets `reach` blocks off; and how near overhead the roof is (1 just over, 0 from `roof` up).
 */
export function shelter(cover: CoverLookup, x: number, y: number, z: number): { open: number; roof: number } {
  const H = TUNING.weather.hearing;
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const over = cover.heightAt(bx, bz) - y;
  if (over <= 0) return { open: 1, roof: 1 };
  let nearest = H.reach + 1;
  for (let dz = -H.reach; dz <= H.reach; dz++) {
    for (let dx = -H.reach; dx <= H.reach; dx++) {
      // (Not the ear's own: that's the roof over it.)
      if (!dx && !dz) continue;
      const d = Math.hypot(dx, dz);
      // Open a little over the ear is open enough: a window's sill, a step up.
      if (d < nearest && cover.heightAt(bx + dx, bz + dz) <= y + H.sill) nearest = d;
    }
  }
  return { open: Math.max(0, 1 - nearest / (H.reach + 1)), roof: Math.max(0, 1 - over / H.roof) };
}

/** The rain heard at (x, y, z) falling `fall` hard (0–1), with the ear under water or not. */
export function rainHeard(cover: CoverLookup, x: number, y: number, z: number, fall: number, underWater: boolean): RainHeard {
  if (fall <= 0 || y > TUNING.weather.precipitation.ceiling) return { level: 0, open: 0 };
  const H = TUNING.weather.hearing;
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  // What falls here, and (by a biome's edge) a little of what falls beside it.
  let kind = 0;
  for (const [dx, dz] of AROUND) {
    const falls = cover.fallAt(bx + dx, bz + dz);
    const share = dx || dz ? 0.5 : 1;
    if (falls === Fall.Rain) kind = Math.max(kind, share);
    else if (falls === Fall.Snow) kind = Math.max(kind, share * H.snow);
  }
  if (!kind) return { level: 0, open: 0 };
  const { open, roof } = shelter(cover, x, y, z);
  const sheltered = open >= 1 ? 1 : Math.max(open * H.nearOpen, roof * H.underRoof);
  // Rain is softer than a storm, but not by as much as it has fewer drops.
  const level = kind * Math.sqrt(fall) * sheltered * (underWater ? H.underWater : 1);
  return { level, open: underWater ? 0 : open };
}

const AROUND: readonly (readonly [number, number])[] = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]];

/** Seconds from a bolt `distance` blocks off to its thunder. */
export function thunderDelay(distance: number): number {
  const { away, delay } = TUNING.weather.lightning;
  const k = Math.max(0, Math.min(1, (distance - away.min) / (away.max - away.min)));
  return delay.min + (delay.max - delay.min) * k;
}

/** Thunder as heard: how loud, how bright (0 a dull rumble – 1 a crack over it), and from which side. */
export interface Thunder {
  gain: number;
  bright: number;
  pan: number;
}

/** A bolt's thunder at (x, y, z) looking along `yaw`, with the sky `open` to the ear by that much. */
export function thunderHeard(bolt: Bolt, x: number, z: number, yaw: number, open: number): Thunder {
  const { away } = TUNING.weather.lightning;
  const dx = bolt.x - x;
  const dz = bolt.z - z;
  const across = Math.hypot(dx, dz);
  const k = Math.max(0, Math.min(1, (across - away.min) / (away.max - away.min)));
  const pan = across > 1e-6 ? ((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / across) * 0.6 : 0;
  return { gain: (1 - 0.65 * k) * (0.35 + 0.65 * open), bright: (1 - k) * open, pan };
}
