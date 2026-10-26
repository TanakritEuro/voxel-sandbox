// Day and night. The time of day (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset, then
// round again) sets how bright sunlight is and its colour (white by day, warm low in the sky,
// a cool dim moonlight at night), and the colour of the sky and the fog. Block light doesn't
// change, so torches matter at night. Only uniforms and colours change: nothing is remeshed.
// The sun and moon themselves come with the sky in Milestone 5.

import { TUNING } from '../config';

export type RGB = [number, number, number];

export interface SkyState {
  /** Height of the sun: 1 at noon, 0 at sunrise and sunset, -1 at midnight. */
  elevation: number;
  /** How bright sunlight is, from `TUNING.day.night` at night to 1 by day. */
  daylight: number;
  /** Sunlight's colour times its brightness, 0–1 per channel (display terms, like the vertex shade). */
  sunlight: RGB;
  /** The sky and the fog, sRGB 0–1. */
  colour: RGB;
}

const rgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Sunlight's colour by day, low in the sky, and by night (moonlight). */
const WHITE: RGB = [1, 1, 1];
const WARM: RGB = [1, 0.8, 0.62];
const MOON: RGB = [0.72, 0.82, 1];

/** Everything that depends on the time of day (0–1; any number, it wraps). */
export function skyAt(time: number): SkyState {
  const elevation = Math.sin(2 * Math.PI * (time - 0.25));
  // From night to the horizon (twilight), and from the horizon to full day.
  const toTwilight = smoothstep(-0.3, 0, elevation);
  const toDay = smoothstep(0, 0.35, elevation);
  const night = TUNING.day.night;
  // Light fades over the same span as the sky's colour, so land and sky darken together at dusk.
  const daylight = night + (1 - night) * smoothstep(-0.3, 0.3, elevation);
  const tint = mix(mix(MOON, WARM, toTwilight), WHITE, toDay);
  const colour = mix(mix(rgb(TUNING.sky.night), rgb(TUNING.sky.twilight), toTwilight), rgb(TUNING.sky.colour), toDay);
  return { elevation, daylight, sunlight: [tint[0] * daylight, tint[1] * daylight, tint[2] * daylight], colour };
}

/** The time of day as a 24-hour clock, "07:12". */
export function clock(time: number): string {
  const minutes = Math.floor((((time % 1) + 1) % 1) * 24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
