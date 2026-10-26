// Day and night. The time of day (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset, then
// round again) sets how bright sunlight is and its colour (white by day, warm low in the sky,
// a cool dim moonlight at night), the sky's colour at the horizon (also the fog's) and
// overhead, the glow round the sun at dawn and dusk, the stars and the clouds' colour, and
// where the sun and moon are. Block light doesn't change, so torches matter at night. Only
// uniforms and colours change: nothing is remeshed. Pure; `skyDome.ts` and `clouds.ts` draw it.

import { TUNING } from '../config';

export type RGB = [number, number, number];
export type Vec3 = [number, number, number];

export interface SkyState {
  /** Height of the sun: 1 at noon, 0 at sunrise and sunset, -1 at midnight. */
  elevation: number;
  /** How bright sunlight is, from `TUNING.day.night` at night to 1 by day. */
  daylight: number;
  /** Sunlight's colour times its brightness, 0–1 per channel (display terms, like the vertex shade). */
  sunlight: RGB;
  /** The sky at the horizon and the fog, sRGB 0–1. */
  colour: RGB;
  /** The sky overhead, sRGB 0–1. */
  zenith: RGB;
  /** How strongly the sky glows round the sun (dawn and dusk), 0–1. */
  glow: number;
  /** How bright the stars are, 0 by day to 1 at night. */
  stars: number;
  /** The clouds' colour, sRGB 0–1. */
  clouds: RGB;
  /** Unit vector towards the sun (the moon is opposite). It rises in the east (+x) and sets in the west, tilted towards +z. */
  sun: Vec3;
  /** The sun's angle round its circle (radians): the stars turn with it. */
  angle: number;
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
/** Clouds at dusk and at night (white by day). */
const CLOUD_TWILIGHT: RGB = [1, 0.82, 0.72];
const CLOUD_NIGHT: RGB = [0.13, 0.15, 0.22];

/** Everything that depends on the time of day (0–1; any number, it wraps). */
export function skyAt(time: number): SkyState {
  const angle = 2 * Math.PI * (time - 0.25);
  const elevation = Math.sin(angle);
  // From night to the horizon (twilight), and from the horizon to full day.
  const toTwilight = smoothstep(-0.3, 0, elevation);
  const toDay = smoothstep(0, 0.35, elevation);
  const night = TUNING.day.night;
  // Light fades over the same span as the sky's colour, so land and sky darken together at dusk.
  const daylight = night + (1 - night) * smoothstep(-0.3, 0.3, elevation);
  const tint = mix(mix(MOON, WARM, toTwilight), WHITE, toDay);
  const S = TUNING.sky;
  const colour = mix(mix(rgb(S.night), rgb(S.twilight), toTwilight), rgb(S.colour), toDay);
  const zenith = mix(mix(rgb(S.zenithNight), rgb(S.zenithTwilight), toTwilight), rgb(S.zenith), toDay);
  const tilt = S.sunTilt;
  return {
    elevation,
    daylight,
    sunlight: [tint[0] * daylight, tint[1] * daylight, tint[2] * daylight],
    colour,
    zenith,
    glow: toTwilight * (1 - toDay),
    stars: 1 - smoothstep(-0.25, 0.05, elevation),
    clouds: mix(mix(CLOUD_NIGHT, CLOUD_TWILIGHT, toTwilight), WHITE, toDay),
    sun: [Math.cos(angle), elevation * Math.cos(tilt), elevation * Math.sin(tilt)],
    angle,
  };
}

/** The time of day as a 24-hour clock, "07:12". */
export function clock(time: number): string {
  const minutes = Math.floor((((time % 1) + 1) % 1) * 24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
