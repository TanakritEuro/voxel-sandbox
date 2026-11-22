import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { CoverMap } from '../src/render/coverMap';
import { canShow, fallClock, inBox, instancesFor, Precipitation } from '../src/render/precipitation';
import { coverFrom, lookOf } from '../src/render/weatherLook';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal } from '../src/world/coords';
import { COVER_BYTES, coverFall, coverHeight, Fall, snowLies, UNDER_COVER, updateCover } from '../src/world/cover';
import { WEATHER_KINDS } from '../src/world/weather';
import { World } from '../src/world/world';

const SEED = 20261022;
const S = CHUNK_SIZE;
const W = TUNING.weather;
const P = W.precipitation;
const NOTHING: null[] = new Array(MAX_CHUNK_Y - MIN_CHUNK_Y + 1).fill(null);
const HORIZON: [number, number, number] = [0.4, 0.45, 0.5];

/** A world of 3 x 3 flat columns round (0, 0), stone at y 10, with `fall` over all of it. */
function flat(fall: Fall): World {
  const world = new World(SEED);
  const floor = new Uint8Array(CHUNK_VOLUME);
  for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) floor[localIndex(x, 10, z)] = Block.Stone;
  const tile = new Uint8Array(COVER_BYTES);
  for (let i = 0; i < S * S; i++) {
    tile[i * 2 + 1] = fall << 2;
    updateCover(tile, i, 10, Block.Stone, () => Block.Air);
  }
  for (let cz = -1; cz <= 1; cz++)
    for (let cx = -1; cx <= 1; cx++) world.addColumn(cx, cz, [floor.slice(), ...NOTHING.slice(1)], undefined, undefined, tile.slice());
  return world;
}

/** Precipitation over a world, brought up to a frame with the eye at `y`. */
function shown(world: World, y: number, fall: number, under = false): { visible: boolean; count: number } {
  const map = new CoverMap();
  map.update(world, 4, 4);
  const precipitation = new Precipitation(map);
  precipitation.update(new THREE.Vector3(4, y, 4), 1 / 60, fall, HORIZON, 0.6, under);
  return { visible: precipitation.mesh.visible, count: precipitation.mesh.geometry.instanceCount };
}

describe('what falls', () => {
  it('repeats exactly every box of seconds, so the clock can be wrapped', () => {
    for (const v of [...P.rain.speed, ...P.rain.wind, ...P.snow.speed, ...P.snow.wind, P.box, P.splash.cycles]) expect(Number.isInteger(v)).toBe(true);
    for (const speed of [P.rain.speed[0], P.snow.speed[1], P.rain.wind[0]]) {
      for (const t of [0, 0.37, 12.5, 47.9]) {
        const a = inBox(speed * t);
        const b = inBox(speed * (t + P.box * 1000));
        expect(Math.min(Math.abs(a - b), P.box - Math.abs(a - b))).toBeLessThan(1e-6);
      }
    }
    let clock = 0;
    for (let t = 0; t < 10_000; t++) {
      clock = fallClock(clock, 0.37);
      expect(clock >= 0 && clock < P.box).toBe(true);
    }
    expect(Math.abs(clock - ((10_000 * 0.37) % P.box))).toBeLessThan(1e-6);
    for (const v of [-100_000.25, -1, 0, 47.999, 99_999.5]) expect(inBox(v) >= 0 && inBox(v) < P.box).toBe(true);
  });

  it('is nothing clear or overcast, part of the drops in rain and all of them in a storm', () => {
    const count = Object.fromEntries(WEATHER_KINDS.map((kind) => [kind, instancesFor(lookOf({ kind, amount: 1 }).fall)]));
    expect(count.clear).toBe(0);
    expect(count.overcast).toBe(0);
    expect(count.storm).toBe(P.splashes + P.drops);
    expect(count.rain).toBe(P.splashes + Math.ceil(P.drops * W.look.rain.fall));
    expect([P.drops, P.drops / 2]).toEqual([3000, 1500]);
    let was = 0;
    for (let amount = 0.01; amount <= 1; amount += 0.01) {
      const n = instancesFor(lookOf({ kind: 'storm', amount }).fall);
      expect(n).toBeGreaterThanOrEqual(was);
      was = n;
    }
  });

  it('is one draw, only while it falls and there is some to see', () => {
    for (const fall of [Fall.Rain, Fall.Snow]) {
      const world = flat(fall);
      expect(shown(world, 14, 1)).toEqual({ visible: true, count: P.splashes + P.drops });
      expect(shown(world, 14, 0).visible).toBe(false);
      expect(shown(world, 14, 1, true).visible).toBe(false); // under water
    }
    expect(shown(flat(Fall.None), 14, 1).visible).toBe(false); // a desert
    expect(shown(new World(SEED), 14, 1).visible).toBe(false); // nothing loaded
  });

  it('is not drawn under cover with no sky near, nor over the ceiling', () => {
    const world = flat(Fall.Rain);
    const roof: [number, number, number, Block][] = [];
    for (let z = -S; z < 2 * S; z++) for (let x = -S; x < 2 * S; x++) roof.push([x, 60, z, Block.Stone]);
    world.setBlocks(roof);
    expect(shown(world, 14, 1).visible).toBe(false);
    expect(shown(world, 55, 1).visible).toBe(true);
    // One hole in it within reach is sky near enough, seen from high enough.
    world.setBlock(10, 60, 10, Block.Air);
    expect(shown(world, 14, 1).visible).toBe(true);

    expect(canShow(60, P.ceiling + P.box / 2)).toBe(false);
    expect(canShow(60, P.ceiling)).toBe(true);
    expect(canShow(P.ceiling, 220)).toBe(false);
    expect(canShow(Number.POSITIVE_INFINITY, 70)).toBe(false);
  });

  it('keeps its clock while the world stands still', () => {
    const map = new CoverMap();
    map.update(flat(Fall.Rain), 0, 0);
    const precipitation = new Precipitation(map);
    const eye = new THREE.Vector3(0, 14, 0);
    const clock = () => precipitation.mesh.material.uniforms.clock.value as number;
    precipitation.update(eye, 2, 1, HORIZON, 1, false);
    precipitation.update(eye, 0, 1, HORIZON, 1, false);
    expect(clock()).toBe(2);
  });

  it('finds the lowest place anything falls to, as a look at every place does', () => {
    const world = new World(SEED, { generation: 3 });
    for (let cz = -1; cz <= 0; cz++) for (let cx = -1; cx <= 0; cx++) world.ensureColumn(cx, cz);
    const map = new CoverMap();
    map.update(world, 0, 0);
    for (const [x, z, reach] of [[0, 0, 24], [-10.5, -20.2, 11], [-31.9, 31.9, 24], [-70, -70, 24]]) {
      let lowest = Number.POSITIVE_INFINITY;
      for (let bz = Math.floor(z - reach); bz <= Math.floor(z + reach); bz++)
        for (let bx = Math.floor(x - reach); bx <= Math.floor(x + reach); bx++) {
          const tile = world.coverOf(toChunk(bx), toChunk(bz));
          if (!tile) continue;
          const i = toLocal(bz) * S + toLocal(bx);
          if (coverFall(tile, i) !== Fall.None) lowest = Math.min(lowest, coverHeight(tile, i) / 2);
        }
      expect(map.lowestFalling(x, z, reach)).toBe(lowest);
    }
  });
});

describe('settled snow underfoot', () => {
  const tile = (fall: Fall) => {
    const t = new Uint8Array(COVER_BYTES);
    t[1] = fall << 2;
    updateCover(t, 0, 10, Block.Stone, () => Block.Air);
    return t;
  };

  it('lies only where it snows, open to the sky, and enough has settled', () => {
    const snowy = tile(Fall.Snow);
    expect(snowLies(snowy, 0, 11, 0, 1)).toBe(true);
    expect(snowLies(snowy, 0, 11 - UNDER_COVER, 0, 1)).toBe(true); // a stair's lower step
    expect(snowLies(snowy, 0, 10, 0, 1)).toBe(false); // under it
    expect(snowLies(snowy, 0, 11, 0, W.snowSteps - 0.01)).toBe(false);
    for (const fall of [Fall.None, Fall.Rain]) expect(snowLies(tile(fall), 0, 11, 0, 1)).toBe(false);
  });

  it('is melted by block light of 11 or more', () => {
    const snowy = tile(Fall.Snow);
    for (let light = 0; light < 16; light++) expect(snowLies(snowy, 0, 11, light, 1)).toBe(light < 11);
  });
});

describe('clouds from above', () => {
  it('thin from the weather’s cover to a clear day’s just over the layer', () => {
    const storm = lookOf({ kind: 'storm', amount: 1 });
    const clear = lookOf({ kind: 'clear', amount: 0 });
    const layer = TUNING.sky.cloudHeight;
    for (const y of [0, 70, layer - 1, layer]) expect(coverFrom(storm, y)).toBe(storm.cover);
    for (const y of [layer + W.overClouds, 207, 400]) expect(coverFrom(storm, y)).toBeCloseTo(TUNING.sky.cloudCover, 12);
    let was = storm.cover;
    for (let y = layer; y < layer + 12; y += 0.5) {
      expect(coverFrom(storm, y)).toBeLessThanOrEqual(was + 1e-12);
      was = coverFrom(storm, y);
    }
    for (const y of [0, layer, layer + 3, 300]) expect(coverFrom(clear, y)).toBe(clear.cover);
  });
});
