import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { clock, type RGB, skyAt } from '../src/render/sky';

const rgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const close = (a: RGB, b: RGB) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('day and night', () => {
  it('is full white sunlight under the day sky at noon', () => {
    const noon = skyAt(0.5);
    expect(noon.elevation).toBeCloseTo(1);
    expect(noon.daylight).toBe(1);
    close(noon.sunlight, [1, 1, 1]);
    close(noon.colour, rgb(TUNING.sky.colour));
  });

  it('is dim cool moonlight under the night sky at midnight', () => {
    const midnight = skyAt(0);
    expect(midnight.daylight).toBeCloseTo(TUNING.day.night);
    close(midnight.colour, rgb(TUNING.sky.night));
    // Bluer than it is red, and much dimmer than day.
    expect(midnight.sunlight[2]).toBeGreaterThan(midnight.sunlight[0]);
    expect(Math.max(...midnight.sunlight)).toBeLessThan(0.25);
  });

  it('is the twilight sky with warm, half-strength sunlight at sunset, and the same at sunrise', () => {
    const sunset = skyAt(0.75);
    close(sunset.colour, rgb(TUNING.sky.twilight));
    expect(sunset.daylight).toBeGreaterThan(TUNING.day.night);
    expect(sunset.daylight).toBeLessThan(1);
    expect(sunset.sunlight[0]).toBeGreaterThan(sunset.sunlight[2]);
    const sunrise = skyAt(0.25);
    close(sunrise.colour, sunset.colour);
    close(sunrise.sunlight, sunset.sunlight);
  });

  it('gets steadily brighter from midnight to noon, and wraps round', () => {
    let last = -1;
    for (let t = 0; t <= 0.5; t += 0.01) {
      const d = skyAt(t).daylight;
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    for (const t of [0, 0.2, 0.37, 0.8]) {
      close(skyAt(t + 1).colour, skyAt(t).colour);
      expect(skyAt(t - 1).daylight).toBeCloseTo(skyAt(t).daylight);
      // Mornings mirror evenings.
      close(skyAt(t).sunlight, skyAt(1 - t).sunlight);
    }
  });

  it('reads as a 24-hour clock', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(0.5)).toBe('12:00');
    expect(clock(0.3)).toBe('07:12');
    expect(clock(1.75)).toBe('18:00');
  });
});
