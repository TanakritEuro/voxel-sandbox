import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createRng } from '../src/math';
import { LOD_CELL, prepareLod } from '../src/mesh/lod';
import { type ChunkMesh, meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { COVER_COLUMNS, COVER_SIZE, CoverMap } from '../src/render/coverMap';
import { encodeRle } from '../src/save/rle';
import { handleJob } from '../src/workers/jobs';
import { Biome, BIOME_COUNT, Climate } from '../src/world/biomes';
import { Block, BLOCKS, door, slab, stairs, wheat } from '../src/world/blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toLocal, WORLD_HEIGHT } from '../src/world/coords';
import { COVER_BYTES, coverFall, coverHeight, coverTile, Fall, fallOf, RAIN_STOP, UNDER_COVER, UNDER_COVER_CELLS, updateCover } from '../src/world/cover';
import { type Generation, Generator } from '../src/world/generate';
import { Weather } from '../src/world/weather';
import { World } from '../src/world/world';

const SEED = 20261022;
const S = CHUNK_SIZE;
const NOTHING: null[] = new Array(MAX_CHUNK_Y - MIN_CHUNK_Y + 1).fill(null);
const at = (x: number, z: number) => toLocal(z) * S + toLocal(x);

/** Where rain gets down to, looked for from the sky one block at a time, in half blocks. */
function scanned(world: World, x: number, z: number): number {
  for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
    const info = BLOCKS[world.getBlock(x, y, z)];
    if (info.liquid) return y * 2 + (info.liquidHeight > 0.5 ? 2 : 1);
    if (info.passable || info.connects) continue;
    if (info.boxes && !info.boxes.some(([x0, , z0, x1, , z1]) => x0 === 0 && z0 === 0 && x1 === 1 && z1 === 1)) continue;
    const top = info.boxes ? Math.max(...info.boxes.map((box) => box[4])) : 1;
    return y * 2 + (top > 0.5 ? 2 : 1);
  }
  return 0;
}

function expectScanned(world: World, cx: number, cz: number): void {
  const tile = world.coverOf(cx, cz)!;
  const wrong: string[] = [];
  for (let z = 0; z < S; z++)
    for (let x = 0; x < S; x++) {
      const want = scanned(world, cx * S + x, cz * S + z);
      const got = coverHeight(tile, z * S + x);
      if (got !== want) wrong.push(`${x},${z}: ${got} for ${want}`);
    }
  expect(wrong).toEqual([]);
}

/** A world of one column, all air but a stone floor at y 10. */
function floored(): World {
  const world = new World(SEED);
  const floor = new Uint8Array(CHUNK_VOLUME);
  for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) floor[localIndex(x, 10, z)] = Block.Stone;
  world.addColumn(0, 0, [floor, ...NOTHING.slice(1)]);
  return world;
}

describe('cover', () => {
  it('is stopped by what fills a block from above and by liquids, not by thin things or plants', () => {
    for (const b of [Block.Stone, Block.Glass, Block.Leaves, Block.Water, Block.Lava, slab(0, true), stairs(0, 1, false), stairs(0, 2, true)]) expect(RAIN_STOP[b]).toBe(2);
    for (const b of [Block.Fence, Block.Pane, Block.Lantern, Block.LanternHanging, door(0, false, true), door(1, true, false)]) expect(RAIN_STOP[b]).toBe(0);
    expect(RAIN_STOP[slab(0, false)]).toBe(1);
    for (const b of [Block.Air, Block.Torch, Block.Reeds, Block.CrystalCluster, wheat(7)]) expect(RAIN_STOP[b]).toBe(0);
    BLOCKS.forEach((info, b) => {
      if (info.shape === 'rail' || info.shape === 'wire' || info.shape === 'torch') expect(RAIN_STOP[b], info.name).toBe(0);
    });
  });

  it('is what a scan from the sky finds, on generated columns of each version', () => {
    for (const [generation, columns] of [
      [1, [[0, 0], [-11, 12]]],
      [2, [[3, -2]]],
      [3, [[0, 0], [-11, 12], [-1, -1], [5, 1]]],
    ] as const) {
      const world = new World(SEED, { generation });
      for (const [cx, cz] of columns) {
        world.ensureColumn(cx, cz);
        expectScanned(world, cx, cz);
      }
    }
  });

  it('follows placing and breaking', () => {
    const world = floored();
    const cover = () => coverHeight(world.coverOf(0, 0)!, at(5, 7));
    expect(cover()).toBe(22);
    world.setBlock(5, 11, 7, Block.Torch);
    expect(cover()).toBe(22);
    world.setBlock(5, 40, 7, Block.Glass);
    expect(cover()).toBe(82);
    world.setBlock(5, 20, 7, Block.Stone); // under the roof
    expect(cover()).toBe(82);
    world.setBlock(5, 40, 7, slab(0, false));
    expect(cover()).toBe(81);
    world.setBlock(5, 40, 7, Block.Air);
    expect(cover()).toBe(42);
    world.setBlock(5, 20, 7, Block.Water);
    expect(cover()).toBe(42);
    world.setBlock(5, 20, 7, Block.Air);
    expect(cover()).toBe(22);
    world.setBlock(5, 10, 7, Block.Air);
    expect(cover()).toBe(0);
    world.setBlock(5, WORLD_HEIGHT - 1, 7, Block.Leaves);
    expect(cover()).toBe(WORLD_HEIGHT * 2);
  });

  it('keeps what falls when the height takes its ninth and tenth bits', () => {
    for (const fall of [Fall.None, Fall.Rain, Fall.Snow]) {
      const tile = new Uint8Array(COVER_BYTES);
      tile[1] = fall << 2;
      for (const [y, height] of [[10, 22], [127, 256], [200, 402], [255, 512]] as const) {
        expect(updateCover(tile, 0, y, Block.Stone, () => Block.Air)).toBe(true);
        expect([coverHeight(tile, 0), coverFall(tile, 0)]).toEqual([height, fall]);
      }
      expect(updateCover(tile, 0, 255, Block.Air, () => Block.Air)).toBe(true);
      expect([coverHeight(tile, 0), coverFall(tile, 0)]).toEqual([0, fall]);
    }
  });

  it('stays what a scan finds through many edits, one at a time and many at once', () => {
    const world = new World(SEED, { generation: 3 });
    world.ensureColumn(-1, 0);
    const tile = world.coverOf(-1, 0)!;
    const fall = Array.from({ length: S * S }, (_, i) => coverFall(tile, i));
    const rng = createRng(21);
    const kinds = [Block.Air, Block.Air, Block.Air, Block.Stone, Block.Glass, Block.Torch, Block.Water, Block.Leaves, slab(1, false), slab(1, true)];
    const random = (): [number, number, number, Block] => {
      const x = -S + Math.floor(rng() * 6);
      const z = Math.floor(rng() * 6);
      // Mostly at the top of the place, where edits move the cover.
      const top = Math.ceil(coverHeight(world.coverOf(-1, 0)!, at(x, z)) / 2) - 1;
      const y = Math.min(WORLD_HEIGHT - 1, Math.max(1, top + Math.floor(rng() * 7) - 3));
      return [x, y, z, kinds[Math.floor(rng() * kinds.length)]];
    };
    for (let i = 0; i < 400; i++) world.setBlock(...random());
    expectScanned(world, -1, 0);
    for (let i = 0; i < 20; i++) world.setBlocks(Array.from({ length: 25 }, random));
    expectScanned(world, -1, 0);
    expect(Array.from({ length: S * S }, (_, i) => coverFall(tile, i))).toEqual(fall);
  });

  it('comes from the worker the same as from the main thread, saved chunks included', () => {
    const roof = new Uint8Array(CHUNK_VOLUME);
    for (let z = 4; z < 9; z++) for (let x = 4; x < 9; x++) roof[localIndex(x, 20, z)] = Block.Glass;
    const saved = [{ cy: MAX_CHUNK_Y, data: encodeRle(roof) }];
    const result = handleJob({ kind: 'generate', id: 1, seed: SEED, generation: 3, cx: -11, cz: 12, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y, saved });
    if (result.kind !== 'generate') throw new Error('wrong kind');
    const here = new World(SEED, { generation: 3 });
    here.addColumn(-11, 12, result.chunks);
    expect(result.cover).toEqual(here.coverOf(-11, 12));
    expect(coverHeight(result.cover, at(6, 6))).toBe((MAX_CHUNK_Y * S + 21) * 2);
  });

  it('given with a column is kept, unless some of that column was loaded already', () => {
    const chunks = new Generator(SEED).generateColumn(0, 0, MIN_CHUNK_Y, MAX_CHUNK_Y);
    const given = new Uint8Array(COVER_BYTES);
    const world = new World(SEED);
    world.addColumn(0, 0, chunks, undefined, undefined, given);
    expect(world.coverOf(0, 0)).toBe(given);
    world.addColumn(0, 0, chunks, undefined, undefined, given);
    expect(world.coverOf(0, 0)).not.toBe(given);
    expectScanned(world, 0, 0);
  });

  it('says which columns changed, and goes with them', () => {
    const world = floored();
    expect([...world.coverChanged.values()]).toEqual([[0, 0]]);
    world.coverOf(0, 0);
    world.coverChanged.clear();
    world.setBlock(3, 11, 3, Block.Torch);
    world.setBlock(3, 5, 3, Block.Stone);
    expect(world.coverChanged.size).toBe(0);
    world.setBlock(3, 12, 3, Block.Planks);
    expect([...world.coverChanged.values()]).toEqual([[0, 0]]);
    world.coverChanged.clear();
    for (const chunk of [...world.chunks.values()]) world.unload(chunk);
    expect(world.coverOf(0, 0)).toBeUndefined();
    expect([...world.coverChanged.values()]).toEqual([[0, 0]]);
  });
});

describe('what falls where', () => {
  for (const generation of [1, 3] as Generation[]) {
    it(`goes by the biomes' weights, in generation version ${generation}'s ${generation === 1 ? 'four' : 'six'}`, () => {
      const climate = new Climate(SEED, generation);
      const { snowAt, dryAt, dither } = TUNING.weather;
      const w = new Float64Array(BIOME_COUNT);
      const seen = new Set<Fall>();
      const wrong: string[] = [];
      for (let cz = -120; cz <= 120; cz += 6) {
        for (let cx = -120; cx <= 120; cx += 6) {
          const tile = coverTile(NOTHING, cx, cz, SEED, climate);
          // At the sampled corners the weights are the climate's own.
          for (let z = 0; z < S; z += 8)
            for (let x = 0; x < S; x += 8) {
              climate.weights(cx * S + x, cz * S + z, w);
              const snowy = w[Biome.Mountains];
              const dry = w[Biome.Desert] + w[Biome.Savanna];
              if (generation === 1 && w[Biome.Savanna] !== 0) wrong.push('savanna in version 1');
              const fall = coverFall(tile, z * S + x);
              seen.add(fall);
              let want: Fall | null = null;
              if (snowy >= snowAt + dither) want = Fall.Snow;
              else if (snowy < snowAt - dither) {
                if (dry >= dryAt + dither) want = Fall.None;
                else if (dry < dryAt - dither) want = Fall.Rain;
              }
              if (want !== null && fall !== want) wrong.push(`${cx * S + x},${cz * S + z}: ${fall} for ${want}`);
            }
        }
      }
      expect(wrong).toEqual([]);
      expect([...seen].sort()).toEqual([Fall.None, Fall.Rain, Fall.Snow]);
    });
  }

  it('is dithered only at the edges', () => {
    const { snowAt, dryAt, dither } = TUNING.weather;
    expect([fallOf(snowAt, 0, -0.4), fallOf(snowAt, 0, 0.4)]).toEqual([Fall.Rain, Fall.Snow]);
    expect([fallOf(0, dryAt, -0.4), fallOf(0, dryAt, 0.4)]).toEqual([Fall.Rain, Fall.None]);
    for (const nudge of [-0.5, 0, 0.499]) {
      expect(fallOf(snowAt + dither, 0, nudge)).toBe(Fall.Snow);
      expect(fallOf(snowAt - dither, 0, nudge)).toBe(Fall.Rain);
      expect(fallOf(0, dryAt + dither, nudge)).toBe(Fall.None);
    }
  });
});

describe('tops marked for the shader', () => {
  /** Quads whose mark isn't what its shape says, and how many tops there were. */
  function check(mesh: ChunkMesh, cell: number): { wrong: number; tops: number } {
    let wrong = 0;
    let tops = 0;
    for (const { positions: p, colors } of [mesh.opaque, mesh.cutout]) {
      for (let q = 0; q < p.length / 12; q++) {
        const a = q * 12;
        const level = p[a + 1] === p[a + 4] && p[a + 1] === p[a + 7] && p[a + 1] === p[a + 10];
        const ny = (p[a + 5] - p[a + 2]) * (p[a + 6] - p[a]) - (p[a + 3] - p[a]) * (p[a + 8] - p[a + 2]);
        const top = level && ny > 0;
        if (top) tops++;
        for (let k = 3; k < 16; k += 4) if (colors[q * 16 + k] !== (top ? cell : 255)) wrong++;
      }
    }
    return { wrong, tops };
  }

  it('are level faces seen from above and no others, with the size of a cell of their detail', () => {
    const world = new World(SEED);
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
    for (const lod of [0, 1, 2] as const) {
      const blocks = paddedBlocks(world, 0, 2, 0);
      const light = paddedLight(world, 0, 2, 0);
      if (lod) prepareLod(blocks, light, lod, 0);
      const { wrong, tops } = check(meshChunk(blocks, 0, 2, 0, light, lod > 0, LOD_CELL[lod]), LOD_CELL[lod]);
      expect(wrong).toBe(0);
      expect(tops).toBeGreaterThan(0);
    }
  });

  it('seen from above are open to the sky: every one at full detail, nearly every one far off', () => {
    const world = new World(SEED, { generation: 3 });
    for (let cz = 10; cz <= 14; cz++) for (let cx = -13; cx <= -9; cx++) world.ensureColumn(cx, cz);
    for (const lod of [0, 1, 2] as const) {
      const cell = LOD_CELL[lod];
      const under = lod ? cell * UNDER_COVER_CELLS : UNDER_COVER;
      let seen = 0;
      let missed = 0;
      for (let cz = 11; cz <= 13; cz++) {
        for (let cx = -12; cx <= -10; cx++) {
          const highest = new Float32Array(S * S);
          for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
            if (world.getChunk(cx, cy, cz)!.empty) continue;
            const blocks = paddedBlocks(world, cx, cy, cz);
            const light = paddedLight(world, cx, cy, cz);
            if (lod) prepareLod(blocks, light, lod, 0);
            const mesh = meshChunk(blocks, cx, cy, cz, light, lod > 0, cell);
            for (const { positions: p, colors } of [mesh.opaque, mesh.cutout]) {
              for (let a = 0; a < p.length; a += 12) {
                if (colors[(a / 12) * 16 + 3] === 255) continue;
                const xs = [p[a], p[a + 3], p[a + 6], p[a + 9]].map((x) => x - cx * S);
                const zs = [p[a + 2], p[a + 5], p[a + 8], p[a + 11]].map((z) => z - cz * S);
                for (let z = Math.max(0, Math.min(...zs)); z < Math.min(S, Math.max(...zs)); z++)
                  for (let x = Math.max(0, Math.min(...xs)); x < Math.min(S, Math.max(...xs)); x++) highest[z * S + x] = Math.max(highest[z * S + x], p[a + 1]);
              }
            }
          }
          const tile = world.coverOf(cx, cz)!;
          highest.forEach((y, i) => {
            if (!y) return;
            const height = coverHeight(tile, i) / 2;
            // Water's surface is in the transparent pass: the ground under it is under cover.
            if (BLOCKS[world.getBlock(cx * S + (i % S), Math.ceil(height) - 1, cz * S + Math.floor(i / S))].liquid) return;
            seen++;
            if (y < height - under - 0.01) missed++;
          });
        }
      }
      expect(seen).toBeGreaterThan(5000);
      expect(missed / seen, `level ${lod}`).toBeLessThanOrEqual(lod ? 0.06 : 0);
    }
  });

  it('take in a slab at its half, and a torch', () => {
    const world = floored();
    world.setBlock(4, 11, 4, slab(0, false));
    world.setBlock(8, 11, 8, Block.Torch);
    const mesh = meshChunk(paddedBlocks(world, 0, 0, 0), 0, 0, 0, paddedLight(world, 0, 0, 0));
    expect(check(mesh, 1).wrong).toBe(0);
    const tops = new Set<number>();
    const { positions, colors } = mesh.opaque;
    for (let v = 0; v < colors.length / 4; v++) if (colors[v * 4 + 3] === 1) tops.add(positions[v * 3 + 1]);
    expect(tops.has(11.5)).toBe(true);
    // The floor, the slab's top and the torch's.
    expect(tops.size).toBe(3);
  });
});

describe('the cover texture', () => {
  const texel = (map: CoverMap, x: number, z: number) => {
    const i = ((z & (COVER_SIZE - 1)) * COVER_SIZE + (x & (COVER_SIZE - 1))) * 2;
    return [map.data[i], map.data[i + 1]];
  };
  function expectTile(map: CoverMap, world: World, cx: number, cz: number): void {
    const tile = world.coverOf(cx, cz);
    const want: number[][] = [];
    const got: number[][] = [];
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++) {
        const i = (z * S + x) * 2;
        want.push(tile ? [tile[i], tile[i + 1]] : [0, 0]);
        got.push(texel(map, cx * S + x, cz * S + z));
      }
    expect(got).toEqual(want);
  }

  it('holds each column where the shader looks for it, following edits, moves and unloading', () => {
    const world = new World(SEED);
    const map = new CoverMap();
    map.update(world, 0, 0);
    for (const [cx, cz] of [[0, 0], [-1, -1], [2, -3]]) world.ensureColumn(cx, cz);
    map.update(world, 0, 0);
    expect([map.origin.x, map.origin.y]).toEqual([-COVER_SIZE / 2, -COVER_SIZE / 2]);
    for (const [cx, cz] of [[0, 0], [-1, -1], [2, -3], [5, 5]]) expectTile(map, world, cx, cz);
    expect(map.changed.size).toBe(3);

    map.changed.clear();
    world.setBlock(-3, 200, -4, Block.Glass);
    map.update(world, 3, 3);
    expect(map.changed.size).toBe(1);
    expect(texel(map, -3, -4)[0] | ((texel(map, -3, -4)[1] & 3) << 8)).toBe(402);

    // A column a texture's width along takes column 0's slot.
    const far = COVER_COLUMNS;
    world.ensureColumn(far, 0);
    map.update(world, far * S, 0);
    expectTile(map, world, far, 0);
    expect(map.origin.x).toBe(COVER_SIZE / 2);
    map.update(world, 0, 0);
    expectTile(map, world, 0, 0);
    expectTile(map, world, -1, -1);

    for (const chunk of [...world.chunks.values()]) if (chunk.cx === 0 && chunk.cz === 0) world.unload(chunk);
    map.update(world, 0, 0);
    expectTile(map, world, 0, 0);
    expect(texel(map, 5, 5)).toEqual([0, 0]);
  });

  it('sends up the whole texture once, then only the tiles that changed', () => {
    const copies: number[][] = [];
    let whole = 0;
    const renderer = {
      initTexture: () => whole++,
      copyTextureToTexture: (_from: THREE.Texture, _to: THREE.Texture, region: THREE.Box2, to: THREE.Vector2) => copies.push([region.min.x, region.min.y, region.max.x, region.max.y, to.x, to.y]),
    } as unknown as THREE.WebGLRenderer;
    const world = new World(SEED);
    const map = new CoverMap();
    map.update(world, 0, 0);
    map.upload(renderer);
    expect([whole, copies.length]).toEqual([1, 0]);
    map.upload(renderer);
    expect([whole, copies.length]).toEqual([1, 0]);
    world.ensureColumn(-1, 2);
    map.update(world, 0, 0);
    map.upload(renderer);
    const x = (COVER_COLUMNS - 1) * S;
    expect(copies).toEqual([[x, 2 * S, x + S, 3 * S, x, 2 * S]]);
    expect(whole).toBe(1);
  });

  it('and a storm edit no chunk and make none stale', () => {
    const world = new World(SEED);
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
    const map = new CoverMap();
    const weather = new Weather(SEED);
    weather.hold('storm');
    for (let t = 0; t < 600; t += 10) {
      weather.step(10);
      map.update(world, t % 64, 0);
    }
    for (const chunk of world.chunks.values()) expect([chunk.modified, chunk.version]).toEqual([false, 0]);
  });
});
