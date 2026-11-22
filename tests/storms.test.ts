import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rainHeard, shelter, thunderDelay, thunderHeard, type CoverLookup } from '../src/audio/weather';
import { TUNING } from '../src/config';
import { CoverMap } from '../src/render/coverMap';
import { BoltMesh, boltSegments, Flash, flashed, MAX_SEGMENTS, skyFlashed } from '../src/render/lightning';
import { skyAt } from '../src/render/sky';
import { WeatherView } from '../src/render/weatherView';
import { flashesOn } from '../src/settings';
import { Health } from '../src/survival/health';
import { canSleep, sleepable, sleepThrough } from '../src/survival/sleep';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, toChunk, toLocal } from '../src/world/coords';
import { COVER_BYTES, coverFall, coverHeight, Fall, rainsOn, updateCover } from '../src/world/cover';
import { type Bolt, Lightning } from '../src/world/lightning';
import { spellAt, Weather, type WeatherKind } from '../src/world/weather';
import { World } from '../src/world/world';

const SEED = 20261022;
const W = TUNING.weather;
const L = W.lightning;
const DAY = TUNING.day.length;

/** A world's weather `into` seconds into the first wet stretch of `kind`. */
function weatherIn(kind: WeatherKind, into: number): { weather: Weather; n: number; wet: number } {
  let at = 0;
  for (let n = 0; n < 1000; n++) {
    const s = spellAt(SEED, n);
    if (s.kind === kind) {
      const weather = new Weather(SEED);
      weather.step(at + s.dry + into);
      return { weather, n, wet: s.wet };
    }
    at += s.dry + s.wet;
  }
  throw new Error(`no ${kind}`);
}

/** Every bolt of `seconds` of storm round `players`, with when. */
function bolts(seconds: number, players: readonly (readonly [number, number])[] = [[100, -50]], start = 0): { t: number; bolt: Bolt }[] {
  const lightning = new Lightning(SEED, start);
  const out: { t: number; bolt: Bolt }[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    const bolt = lightning.step(0.05, true, players, () => 70);
    if (bolt) out.push({ t, bolt });
  }
  return out;
}

describe('lightning', () => {
  it('comes every 8–25 seconds of a storm, 40–240 blocks from a player', () => {
    const all = bolts(3000);
    expect(all.length).toBeGreaterThan(3000 / L.every.max - 1);
    all.forEach(({ t, bolt }, i) => {
      if (i) {
        expect(t - all[i - 1].t).toBeGreaterThanOrEqual(L.every.min - 0.06);
        expect(t - all[i - 1].t).toBeLessThanOrEqual(L.every.max + 0.06);
      }
      const away = Math.hypot(bolt.x - 100, bolt.z + 50);
      expect(away).toBeGreaterThanOrEqual(L.away.min - 1e-6);
      expect(away).toBeLessThanOrEqual(L.away.max + 1e-6);
      expect(bolt.y).toBe(70);
    });
  });

  it('is none out of a storm, or with nobody there', () => {
    const lightning = new Lightning(SEED);
    for (let t = 0; t < 500; t++) {
      expect(lightning.step(1, false, [[0, 0]], () => 70)).toBeNull();
      expect(lightning.step(1, true, [], () => 70)).toBeNull();
    }
  });

  it('picks among everyone, the same from the same start', () => {
    const players = [[0, 0], [10_000, 0], [0, 10_000]] as const;
    const near = new Set(bolts(1500, players).map(({ bolt }) => players.findIndex(([x, z]) => Math.hypot(bolt.x - x, bolt.z - z) <= L.away.max + 1)));
    expect([...near].sort()).toEqual([0, 1, 2]);
    expect(bolts(200)).toEqual(bolts(200));
    expect(bolts(200, [[100, -50]], 12.5)).not.toEqual(bolts(200));
  });

  it('is drawn forked from the clouds to exactly its place, above the ground all the way', () => {
    for (const { bolt } of bolts(1500)) {
      for (const b of [bolt, { ...bolt, y: 220 }]) {
        const segments = boltSegments(b);
        expect(boltSegments(b)).toEqual(segments);
        expect(segments.length).toBeLessThanOrEqual(MAX_SEGMENTS);
        expect(segments.length).toBeGreaterThan(14); // forked
        expect(Math.max(...segments.map((s) => s.from[1]))).toBe(Math.max(TUNING.sky.cloudHeight, b.y + L.shortest));
        expect(segments[13].to).toEqual([b.x, b.y, b.z]);
        for (let i = 1; i < 14; i++) expect(segments[i].from).toEqual(segments[i - 1].to);
        for (const s of segments) {
          expect(Math.min(s.from[1], s.to[1])).toBeGreaterThanOrEqual(b.y - 1e-9);
          expect(s.width).toBeGreaterThan(0);
        }
      }
    }
  });

  it('shows for a moment, every box finite', () => {
    const drawn = new BoltMesh();
    expect(drawn.mesh.visible).toBe(false);
    drawn.show({ x: 80, y: 64, z: -20, seed: 5 }, { x: 0, y: 70, z: 0 });
    drawn.step(0.01);
    expect(drawn.mesh.visible).toBe(true);
    expect([...drawn.mesh.instanceMatrix.array].every(Number.isFinite)).toBe(true);
    drawn.step(L.shown);
    expect(drawn.mesh.visible).toBe(false);
  });
});

describe('the flash', () => {
  it('is one soft rise and fall', () => {
    const flash = new Flash();
    expect(flash.strike(L.away.min, true)).toBe(true);
    const levels: number[] = [];
    for (let t = 0; t < 1.5; t += 1 / 240) {
      levels.push(flash.level);
      flash.step(1 / 240);
    }
    const top = levels.indexOf(Math.max(...levels));
    expect(Math.max(...levels)).toBeLessThanOrEqual(L.flash.peak);
    expect(levels[0]).toBe(0);
    expect(levels[levels.length - 1]).toBe(0);
    for (let i = 1; i < levels.length; i++) {
      if (i <= top) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1] - 1e-9);
      else expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1e-9);
      expect(Math.abs(levels[i] - levels[i - 1])).toBeLessThan(0.05); // no jump in a 240th of a second
    }
  });

  it('is never two within 3 seconds, however often bolts come', () => {
    expect(L.flash.gap).toBe(3);
    const flash = new Flash();
    let last = Number.NEGATIVE_INFINITY;
    let flashes = 0;
    for (let t = 0; t < 300; t += 0.1) {
      if (flash.strike(100, true)) {
        expect(t - last).toBeGreaterThanOrEqual(3 - 1e-6);
        last = t;
        flashes++;
      }
      flash.step(0.1);
    }
    expect(flashes).toBeGreaterThan(50);
  });

  it('is none with the setting off or less motion asked for, though the bolt and thunder still come', () => {
    expect(flashesOn({ flashes: true }, false)).toBe(true);
    expect(flashesOn({ flashes: false }, false)).toBe(false);
    expect(flashesOn({ flashes: true }, true)).toBe(false);

    const bolt = { x: 60, y: 70, z: 0, seed: 1 };
    const eye = { x: 0, y: 72, z: 0 };
    const view = new WeatherView(new CoverMap());
    view.strike(bolt, eye, false);
    let thunder = 0;
    for (let t = 0; t < 3; t += 0.05) {
      const now = view.step(0.05, 0.05, false);
      expect(now.flash).toBe(0);
      thunder += now.thunder.length;
    }
    expect(thunder).toBe(1);

    // Turned off in the middle of one: gone at once.
    const on = new WeatherView(new CoverMap());
    on.strike(bolt, eye, true);
    expect(on.step(0.1, 0.1, true).flash).toBeGreaterThan(0);
    expect(on.step(0.02, 0.02, false).flash).toBe(0);
  });

  it('fades behind a menu, while the thunder waits', () => {
    const view = new WeatherView(new CoverMap());
    view.strike({ x: 60, y: 70, z: 0, seed: 1 }, new THREE.Vector3(0, 72, 0), true);
    let last = { flash: 1, thunder: [] as Bolt[] };
    for (let t = 0; t < 4; t += 0.05) {
      last = view.step(0.05, 0, true);
      expect(last.thunder).toEqual([]);
    }
    expect(last.flash).toBe(0);
    expect(view.step(3, 3, true).thunder.length).toBe(1);
  });

  it('only brightens, and without one changes nothing', () => {
    const night = skyAt(0);
    expect(skyFlashed(night, 0)).toBe(night);
    expect(flashed(night.colour, 0)).toBe(night.colour);
    for (const time of [0, 0.25, 0.5]) {
      const sky = skyAt(time);
      const before = structuredClone(sky);
      const lit = skyFlashed(sky, L.flash.peak);
      expect(lit.daylight).toBeGreaterThanOrEqual(sky.daylight);
      for (const key of ['sunlight', 'colour', 'zenith', 'clouds'] as const) lit[key].forEach((c, i) => expect(c).toBeGreaterThanOrEqual(sky[key][i]));
      expect(sky).toEqual(before); // the rules' daylight untouched
    }
  });
});

describe('thunder', () => {
  it('comes 0.3–2 seconds after by the distance', () => {
    expect(thunderDelay(L.away.min)).toBeCloseTo(0.3, 9);
    expect(thunderDelay(L.away.max)).toBeCloseTo(2, 9);
    expect(thunderDelay(140)).toBeCloseTo(1.15, 9);
  });

  it('is quieter and duller from far off and under cover, from the side it came from', () => {
    const heard = (x: number, open: number) => thunderHeard({ x, y: 70, z: 0, seed: 0 }, 0, 0, 0, open);
    expect(heard(240, 1).gain).toBeLessThan(heard(40, 1).gain);
    expect(heard(240, 1).bright).toBeLessThan(heard(40, 1).bright);
    expect(heard(60, 0).gain).toBeLessThan(heard(60, 1).gain);
    expect(heard(60, 0).bright).toBe(0);
    expect(heard(60, 1).pan).toBeGreaterThan(0);
    expect(heard(-60, 1).pan).toBeLessThan(0);
  });
});

describe('the rain’s sound', () => {
  /** Ground at 64 with `fall` on it, roofed to `roof` out to `half` blocks round (0, 0), but for `hole`. */
  const land = (fall: Fall, half = -1, roof = 70, hole?: [number, number]): CoverLookup => ({
    heightAt: (x, z) => (Math.abs(x) <= half && Math.abs(z) <= half && !(hole && x === hole[0] && z === hole[1]) ? roof : 64),
    fallAt: () => fall,
  });
  const at = (cover: CoverLookup, y = 65.6, fall = 1, under = false) => rainHeard(cover, 0.5, y, 0.5, fall, under);

  it('is full and bright in the open, nothing with none falling or over a desert', () => {
    expect(at(land(Fall.Rain))).toEqual({ level: 1, open: 1 });
    expect(at(land(Fall.Rain), 65.6, 0).level).toBe(0);
    expect(at(land(Fall.None)).level).toBe(0);
    expect(at(land(Fall.Rain), W.precipitation.ceiling + 1).level).toBe(0);
  });

  it('is muffled under cover, louder the nearer the open', () => {
    let was = { level: 1, open: 1 };
    for (let half = 0; half <= 7; half++) {
      const now = at(land(Fall.Rain, half));
      expect(now.level).toBeLessThan(1);
      expect(now.level).toBeLessThanOrEqual(was.level + 1e-9);
      expect(now.open).toBeLessThanOrEqual(was.open + 1e-9);
      was = now;
    }
    expect(was.open).toBe(0);
    expect(was.level).toBeGreaterThan(0); // the roof drumming
    // A hole in a wide roof: the nearest open place within 6 blocks is heard, one further off isn't.
    expect(shelter(land(Fall.Rain, 30, 70, [2, 0]), 0.5, 65.6, 0.5).open).toBeGreaterThan(0.5);
    expect(shelter(land(Fall.Rain, 30, 70, [7, 0]), 0.5, 65.6, 0.5).open).toBe(0);
  });

  it('is silent deep underground', () => {
    expect(at(land(Fall.Rain, 100, 90), 50).level).toBe(0);
    expect(at(land(Fall.Rain), 30).level).toBe(0);
  });

  it('is nearly silent as snow, quieter under water, softer as rain than in a storm', () => {
    const rain = at(land(Fall.Rain)).level;
    expect(at(land(Fall.Snow)).level).toBeLessThanOrEqual(rain * 0.1);
    expect(at(land(Fall.Rain), 65.6, 1, true).level).toBeLessThan(rain * 0.3);
    expect(at(land(Fall.Rain), 65.6, 0.6).level).toBeLessThan(rain);
  });

  it('reads the cover texture as the tiles are', () => {
    const world = new World(SEED, { generation: 3 });
    for (let cz = -1; cz <= 0; cz++) for (let cx = -1; cx <= 0; cx++) world.ensureColumn(cx, cz);
    const map = new CoverMap();
    map.update(world, 0, 0);
    const wrong: string[] = [];
    for (let z = -CHUNK_SIZE; z < CHUNK_SIZE; z += 3)
      for (let x = -CHUNK_SIZE; x < CHUNK_SIZE; x += 3) {
        const tile = world.coverOf(toChunk(x), toChunk(z))!;
        const i = toLocal(z) * CHUNK_SIZE + toLocal(x);
        if (map.heightAt(x, z) !== coverHeight(tile, i) / 2 || map.fallAt(x, z) !== coverFall(tile, i)) wrong.push(`${x},${z}`);
      }
    expect(wrong).toEqual([]);
    expect([map.heightAt(300, 300), map.fallAt(300, 300)]).toEqual([0, Fall.None]);
  });
});

describe('rain puts out burning', () => {
  const tile = (fall: Fall) => {
    const t = new Uint8Array(COVER_BYTES);
    t[1] = fall << 2;
    updateCover(t, 0, 63, Block.Grass, () => Block.Air);
    return t;
  };

  it('only in the open, only rain, only while it falls', () => {
    expect(rainsOn(tile(Fall.Rain), 0, 65.8, 1)).toBe(true);
    expect(rainsOn(tile(Fall.Rain), 0, 65.8, 0)).toBe(false);
    expect(rainsOn(tile(Fall.Rain), 0, 65.8, W.douses / 2)).toBe(false);
    expect(rainsOn(tile(Fall.Snow), 0, 65.8, 1)).toBe(false);
    expect(rainsOn(tile(Fall.None), 0, 65.8, 1)).toBe(false);
    const roofed = tile(Fall.Rain);
    updateCover(roofed, 0, 67, Block.Glass, () => Block.Air);
    expect(rainsOn(roofed, 0, 65.8, 1)).toBe(false);
  });

  it('as water does: the burning stops, lava itself still hurts', () => {
    const body = { y: 64, onGround: true, inWater: false, flying: false, eyeInWater: false, touchingCactus: false };
    const burn = () => {
      const h = new Health();
      h.step(0.01, { ...body, inWater: true, inLava: true });
      expect(h.burning).toBe(TUNING.lava.after);
      return h;
    };
    const dry = burn();
    const rained = burn();
    let dryLost = 0;
    let rainedLost = 0;
    for (let t = 0; t < 3.2; t += 0.1) {
      dryLost += dry.step(0.1, body);
      rainedLost += rained.step(0.1, { ...body, inRain: true });
    }
    expect(dryLost).toBeGreaterThan(0);
    expect(rainedLost).toBe(0);
    expect(rained.burning).toBe(0);

    const inLava = new Health();
    expect(inLava.step(0.01, { ...body, inWater: true, inLava: true, inRain: true })).toBe(TUNING.lava.damage);
  });
});

describe('sleeping through storms', () => {
  it('is allowed by night, and by day only in a storm', () => {
    expect(canSleep(1, Infinity, true)).toBe('ok');
    expect(canSleep(1, Infinity, false)).toBe('day');
    expect(canSleep(0.1, Infinity, true)).toBe('ok');
    expect(canSleep(1, 2, true)).toBe('near');
    expect(sleepable(1, false)).toBe(false);
    expect(new Weather(SEED).storming).toBe(false);
    expect(weatherIn('storm', 30).weather.storming).toBe(true);
    for (const kind of ['rain', 'overcast'] as const) expect(weatherIn(kind, 30).weather.storming).toBe(false);
  });

  it('by day ends the storm, the clock moved on by what was left of it', () => {
    const { weather, n, wet } = weatherIn('storm', 30);
    const left = wet - 30;
    expect(weather.left).toBeCloseTo(left, 5);
    const settled = weather.settled;
    expect(sleepThrough(0.5, 1, weather, DAY)).toBeCloseTo(0.5 + left / DAY, 8);
    expect(weather.storming).toBe(false);
    expect(weather.now()).toEqual({ kind: 'clear', amount: 0 });
    expect(weather.toJSON()).toMatchObject({ spell: n + 1, elapsed: 0 });
    expect(weather.settled).toBeCloseTo(Math.min(1, settled + left / W.settle), 5);
    // Round midnight.
    const late = weatherIn('storm', 30);
    const woken = sleepThrough(0.99, 1, late.weather, DAY);
    expect(woken).toBeCloseTo((0.99 + left / DAY) % 1, 8);
    expect(woken).toBeLessThan(1);
  });

  it('at night it is morning and the weather has cleared', () => {
    for (const kind of ['storm', 'rain', 'overcast'] as const) {
      const { weather, n } = weatherIn(kind, 30);
      const { settled, wet } = weather;
      expect(sleepThrough(0.95, 0.2, weather, DAY)).toBe(TUNING.sleep.morning);
      expect(weather.now()).toEqual({ kind: 'clear', amount: 0 });
      expect(weather.toJSON()).toEqual({ spell: n + 1, elapsed: 0, settled, wet });
    }
    const dry = new Weather(SEED);
    dry.step(100);
    expect(sleepThrough(0.95, 0.2, dry, DAY)).toBe(TUNING.sleep.morning);
    expect(dry.toJSON()).toMatchObject({ spell: 0, elapsed: 100 });
  });

  it('leaves held weather, and rain by day, as they are', () => {
    const held = new Weather(SEED);
    held.hold('storm');
    expect(sleepThrough(0.5, 1, held, DAY)).toBe(0.5);
    expect(held.storming).toBe(true);
    const { weather } = weatherIn('rain', 30);
    expect(sleepThrough(0.5, 1, weather, DAY)).toBe(0.5);
    expect(weather.now().kind).toBe('rain');
  });
});
