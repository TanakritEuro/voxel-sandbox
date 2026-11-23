import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { cloudCells } from '../src/render/clouds';
import { fogColour, biomeFogs } from '../src/render/fog';
import { type RGB, skyAt } from '../src/render/sky';
import { dimming, fogStartUnder, lookOf, skyUnder, underWeather } from '../src/render/weatherLook';
import { MemoryStore, newWorldRecord } from '../src/save/store';
import { spellAt, Weather, WEATHER_KINDS, weatherKindOf, type WeatherKind } from '../src/world/weather';

const SEED = 20261022;
const W = TUNING.weather;
const GAME: Record<string, string> = import.meta.glob('../src/game.ts', { query: '?raw', import: 'default', eager: true });

/** The first spell of `kind`, and the seconds from a new world to its start. */
function firstOf(kind: WeatherKind): { n: number; at: number } {
  let at = 0;
  for (let n = 0; n < 1000; n++) {
    const s = spellAt(SEED, n);
    if (s.kind === kind) return { n, at };
    at += s.dry + s.wet;
  }
  throw new Error(`no ${kind}`);
}
const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('spells', () => {
  it('are the same for a seed and number, others for another seed, and inside their ranges', () => {
    for (const seed of [SEED, 0, -9, 0xffffffff]) {
      for (let n = 0; n < 500; n++) {
        const s = spellAt(seed, n);
        expect(spellAt(seed, n)).toEqual(s);
        expect(s.dry).toBeGreaterThanOrEqual(W.dry.min);
        expect(s.dry).toBeLessThanOrEqual(W.dry.max);
        expect(s.wet).toBeGreaterThanOrEqual(W.spell.min);
        expect(s.wet).toBeLessThanOrEqual(W.spell.max);
      }
    }
    expect(spellAt(7, 0)).not.toEqual(spellAt(SEED, 0));
  });

  it('come in about the planned shares: 17 % of the time rain, 7 % storms, 4 % only cloud', () => {
    const seconds = { rain: 0, storm: 0, overcast: 0 };
    let all = 0;
    for (let n = 0; n < 20_000; n++) {
      const s = spellAt(SEED, n);
      seconds[s.kind] += s.wet;
      all += s.dry + s.wet;
    }
    expect(seconds.rain / all).toBeCloseTo(0.171, 2);
    expect(seconds.storm / all).toBeCloseTo(0.071, 2);
    expect(seconds.overcast / all).toBeCloseTo(0.043, 2);
  });

  it('start dry in a new world, for at least the shortest dry stretch', () => {
    for (let seed = 0; seed < 200; seed++) {
      const weather = new Weather(seed);
      expect(weather.now()).toEqual({ kind: 'clear', amount: 0 });
      weather.step(W.dry.min - 0.01);
      expect(weather.now()).toEqual({ kind: 'clear', amount: 0 });
      expect([weather.settled, weather.wet]).toEqual([0, 0]);
    }
  });

  it('come on and clear without a jump', () => {
    for (const kind of ['rain', 'storm', 'overcast'] as const) {
      const { n, at } = firstOf(kind);
      const { dry, wet } = spellAt(SEED, n);
      const weather = new Weather(SEED);
      weather.step(at + dry - 1);
      let was = weather.now().amount;
      let most = 0;
      let jump = 0;
      for (let t = 0; t < wet + 2; t += 0.1) {
        weather.step(0.1);
        const { amount } = weather.now();
        jump = Math.max(jump, Math.abs(amount - was));
        most = Math.max(most, amount);
        was = amount;
      }
      expect(most).toBe(1);
      expect(jump).toBeLessThan(0.01);
      expect(weather.now().amount).toBe(0);
    }
  });

  it('end alike however time is divided into steps', () => {
    for (const total of [700, 2000, 5000]) {
      const whole = new Weather(SEED);
      whole.step(total);
      for (const dt of [1 / 60, 0.1, 13.7]) {
        const steps = new Weather(SEED);
        let left = total;
        for (; left > dt; left -= dt) steps.step(dt);
        steps.step(left);
        const a = whole.toJSON();
        const b = steps.toJSON();
        expect(b.spell).toBe(a.spell);
        expect(b.elapsed).toBeCloseTo(a.elapsed, 5);
        expect(b.settled).toBeCloseTo(a.settled, 5);
        expect(b.wet).toBeCloseTo(a.wet, 5);
      }
    }
  });

  it('settle snow and wet the ground while falling, melt and dry it after, and only cloud does neither', () => {
    const { n, at } = firstOf('rain');
    const weather = new Weather(SEED);
    weather.step(at + spellAt(SEED, n).dry);
    weather.settled = weather.wet = 0;
    weather.step(W.soak / 2);
    expect(weather.wet).toBeCloseTo(0.5, 6);
    weather.step(W.settle / 2 - W.soak / 2);
    expect(weather.wet).toBe(1);
    expect(weather.settled).toBeCloseTo(0.5, 6);

    weather.hold('clear');
    weather.settled = weather.wet = 1;
    weather.step(W.dryOut / 2);
    expect(weather.wet).toBeCloseTo(0.5, 6);
    weather.step(W.melt);
    expect([weather.settled, weather.wet]).toEqual([0, 0]);

    const cloud = new Weather(SEED);
    cloud.hold('overcast');
    cloud.step(500);
    expect([cloud.settled, cloud.wet]).toEqual([0, 0]);
  });

  it('wait while held', () => {
    for (const kind of WEATHER_KINDS) {
      const weather = new Weather(SEED);
      weather.step(100);
      weather.hold(kind);
      weather.step(5000);
      expect(weather.now()).toEqual({ kind, amount: kind === 'clear' ? 0 : 1 });
      expect(weather.toJSON()).toMatchObject({ spell: 0, elapsed: 100 });
      expect(weatherKindOf(kind)).toBe(kind);
    }
    for (const junk of [null, '', 'snow', 'Rain', 'toString']) expect(weatherKindOf(junk)).toBeNull();
  });
});

describe('weather saved', () => {
  it('comes back as it was and goes on the same', async () => {
    const weather = new Weather(SEED);
    weather.step(firstOf('storm').at + spellAt(SEED, firstOf('storm').n).dry + 50);
    const store = new MemoryStore();
    await store.putWorld({ ...newWorldRecord('w', 'W', SEED, 0.3), weather: weather.toJSON() });
    const back = Weather.from(SEED, (await store.getWorld('w'))!.weather);
    expect(back.toJSON()).toEqual(weather.toJSON());
    expect(back.now()).toEqual(weather.now());
    weather.step(900);
    back.step(900);
    expect(back.toJSON()).toEqual(weather.toJSON());
  });

  it('starts clear from junk and from older worlds', () => {
    const fresh = new Weather(SEED).toJSON();
    const good = { spell: 3, elapsed: 10, settled: 0.4, wet: 0.2 };
    const junk = [
      undefined,
      null,
      5,
      'storm',
      [],
      {},
      ...[-1, 1.5, Number.NaN, Infinity, '3', 2 ** 40].map((spell) => ({ ...good, spell })),
      ...[-1, 1e6, Number.NaN, Infinity, '10'].map((elapsed) => ({ ...good, elapsed })),
    ];
    for (const saved of junk) expect(Weather.from(SEED, saved).toJSON()).toEqual(fresh);
    expect(Weather.from(SEED, good).toJSON()).toEqual(good);
    expect(Weather.from(SEED, { ...good, settled: 7, wet: 'x' }).toJSON()).toEqual({ ...good, settled: 1, wet: 0 });
  });

  it('is taken as the host has it, and junk from it is left out', () => {
    const host = new Weather(SEED);
    host.step(2000);
    const guest = new Weather(SEED);
    guest.adopt(host.share());
    expect(guest.toJSON()).toEqual(host.toJSON());
    expect(guest.held).toBe(false);
    // A state another world's spells don't have: the guest keeps its own, but takes the ground's.
    const before = guest.toJSON();
    guest.adopt({ state: { spell: 0, elapsed: 5000, settled: 0.5, wet: 0.25 }, held: null });
    expect(guest.toJSON()).toEqual({ ...before, settled: 0.5, wet: 0.25 });
    guest.adopt({ state: before, held: 'rain' });
    expect(guest.now()).toEqual({ kind: 'rain', amount: 1 });
    expect(guest.wet).toBe(before.wet);
  });

  it('takes no time from a bad step', () => {
    const weather = new Weather(SEED);
    for (const dt of [0, -5, Number.NaN, Infinity]) weather.step(dt);
    expect(weather.toJSON()).toEqual(new Weather(SEED).toJSON());
  });
});

describe('the look of the weather', () => {
  it('leaves clear weather exactly as it is', () => {
    const looks = [lookOf({ kind: 'clear', amount: 0 }), lookOf({ kind: 'storm', amount: 0 })];
    for (const look of looks) {
      expect(look.cover).toBe(TUNING.sky.cloudCover);
      expect(look.shown).toBe(1);
      for (let time = 0; time < 1; time += 0.01) {
        const sky = skyAt(time);
        expect(skyUnder(sky, look)).toBe(sky);
        for (const fog of biomeFogs()) {
          const horizon = fogColour(sky.colour, fog, sky.daylight);
          expect(underWeather(horizon, look, sky.daylight)).toBe(horizon);
          expect(fogStartUnder(fog.start, look)).toBe(fog.start);
        }
      }
    }
  });

  it('draws the clouds of clear weather as they were before there was weather', () => {
    let h = 0x811c9dc5;
    for (const v of cloudCells(SEED, TUNING.sky.cloudCover)) h = Math.imul(h ^ v, 16777619) >>> 0;
    expect(h).toBe(2679667903);
  });

  it('only ever adds cloud as the weather comes on', () => {
    let was = cloudCells(SEED, TUNING.sky.cloudCover);
    for (let amount = 0.1; amount <= 1; amount += 0.1) {
      const cells = cloudCells(SEED, lookOf({ kind: 'storm', amount }).cover);
      expect(cells.every((v, i) => v >= was[i])).toBe(true);
      was = cells;
    }
    expect(lookOf({ kind: 'storm', amount: 1 }).cover).toBeCloseTo(0.95, 9);
  });

  it('keeps rain and storms within their limits', () => {
    for (const [kind, light, fogStart] of [['rain', 0.75, 0.35], ['storm', 0.55, 0.25]] as const) {
      const look = lookOf({ kind, amount: 1 });
      const noon = skyAt(0.5);
      const sky = skyUnder(noon, look);
      expect(sky.daylight).toBeCloseTo(light, 6);
      expect(luma(sky.sunlight)).toBeCloseTo(light, 1);
      expect(look.shown).toBe(0);
      expect([sky.stars, sky.glow]).toEqual([0, 0]);
      for (const fog of biomeFogs()) expect(fogStartUnder(fog.start, look)).toBeCloseTo(Math.min(fog.start, fogStart), 9);
      for (let time = 0; time < 1; time += 0.01) {
        const clear = skyAt(time);
        const drawn = skyUnder(clear, look);
        for (const key of ['sunlight', 'colour', 'zenith', 'clouds'] as const) {
          expect(luma(drawn[key])).toBeLessThanOrEqual(luma(clear[key]) + 1e-9);
          for (const c of drawn[key]) expect(c >= 0 && c <= 1).toBe(true);
        }
      }
      // At night there's little light to lose, so little of it goes.
      expect(dimming(look, TUNING.day.night)).toBeGreaterThan(0.8);
    }
  });

  it('never makes the fog start farther off', () => {
    for (const kind of WEATHER_KINDS)
      for (let amount = 0; amount <= 1; amount += 0.25)
        for (const start of [0.2, 0.35, 0.55, 0.65]) expect(fogStartUnder(start, lookOf({ kind, amount }))).toBeLessThanOrEqual(start);
  });
});

describe('gloom and the rules', () => {
  it('leaves the time of day as it was', () => {
    const sky = skyAt(0.5);
    const before = structuredClone(sky);
    expect(skyUnder(sky, lookOf({ kind: 'storm', amount: 1 })).daylight).toBeLessThan(sky.daylight);
    expect(sky).toEqual(before);
  });

  it('gives creatures, crops and sleep the plain daylight', () => {
    const game = Object.values(GAME)[0];
    expect(game).toContain('daylightNow = clearSky.daylight;');
    for (const call of [/crops\.step\([^\n]*/, /canSleep\(daylight[^\n]*/, /sleepable\(daylight[^\n]*/, /sleepThrough\(time,[^\n]*/, /mobs\.update\([^\n]*/]) {
      const line = game.match(call)?.[0];
      expect(line).toContain('daylightNow');
      expect(line).not.toContain('drawnDaylight');
    }
  });
});
