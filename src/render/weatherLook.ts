// How the weather changes the look of the time of day's sky: more cloud, greyer and darker
// sky, clouds and sunlight, the sun, moon, stars and glow hidden, fog closer. It's all laid
// over what `sky.ts` and `fog.ts` give, and clear weather gives those back untouched. Only
// for drawing: the rules (creatures, crops, sleep) read `skyAt`'s daylight. Pure.

import { TUNING } from '../config';
import type { WeatherNow } from '../world/weather';
import type { RGB, SkyState } from './sky';

export interface WeatherLook {
  /** How far the weather has come on, 0 (clear) to 1. */
  amount: number;
  /** Share of the sky under cloud. */
  cover: number;
  /** Sunlight's brightness at noon, as a share of a clear noon's. */
  light: number;
  /** How far colours go towards grey, 0–1. */
  grey: number;
  /** How much the sun, moon, stars and glow show, 0–1. */
  shown: number;
  /** Where its fog starts at full strength, as a fraction of the view distance. */
  fogStart: number;
}

/** Overcast greys lean a little towards blue. */
const SLATE: RGB = [0.95, 1, 1.08];

/** The look of the weather `now`. */
export function lookOf({ kind, amount }: WeatherNow): WeatherLook {
  const cover = TUNING.sky.cloudCover;
  if (kind === 'clear' || amount === 0) return { amount: 0, cover, light: 1, grey: 0, shown: 1, fogStart: 1 };
  const to = TUNING.weather.look[kind];
  return {
    amount,
    cover: cover + (to.cover - cover) * amount,
    light: 1 + (to.light - 1) * amount,
    grey: to.grey * amount,
    // Gone by the time the weather is two thirds come on, ahead of the rain.
    shown: Math.max(0, 1 - amount * 1.5),
    fogStart: to.fogStart,
  };
}

/**
 * What the weather leaves of the light at `daylight`: all of its dimming by day, only
 * `nightDim` of it by night, when there's little light to lose (so a storm at night can
 * still be walked in).
 */
export function dimming(look: WeatherLook, daylight: number): number {
  const night = TUNING.day.night;
  const day = Math.max(0, Math.min(1, (daylight - night) / (1 - night)));
  const nightDim = TUNING.weather.nightDim;
  return 1 - (1 - look.light) * (nightDim + (1 - nightDim) * day);
}

/** A colour of the sky (sRGB 0–1) under the weather, at `daylight`. */
export function underWeather(colour: RGB, look: WeatherLook, daylight: number): RGB {
  if (look.amount === 0) return colour;
  const luma = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
  const dim = dimming(look, daylight);
  return colour.map((c, i) => Math.min(1, (c + (luma * SLATE[i] - c) * look.grey) * dim)) as RGB;
}

/** The sky to draw: `sky` under the weather, its `daylight` the dimmed one. `sky` itself when it's clear. */
export function skyUnder(sky: SkyState, look: WeatherLook): SkyState {
  if (look.amount === 0) return sky;
  const under = (colour: RGB) => underWeather(colour, look, sky.daylight);
  const clouds = under(sky.clouds);
  // Thick cloud is darker underneath than the light coming through it.
  const thick = 1 - TUNING.weather.thickCloud * look.amount;
  return {
    ...sky,
    daylight: sky.daylight * dimming(look, sky.daylight),
    sunlight: under(sky.sunlight),
    colour: under(sky.colour),
    zenith: under(sky.zenith),
    clouds: [clouds[0] * thick, clouds[1] * thick, clouds[2] * thick],
    glow: sky.glow * look.shown,
    stars: sky.stars * look.shown,
  };
}

/** Where the fog starts under the weather: never farther off than the biome's `start`. */
export const fogStartUnder = (start: number, look: WeatherLook): number => start + (Math.min(start, look.fogStart) - start) * look.amount;
