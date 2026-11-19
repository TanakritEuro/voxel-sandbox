import { describe, expect, it } from 'vitest';
import { Biome } from '../src/world/biomes';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y, SEA_LEVEL, toChunk } from '../src/world/coords';
import { findNearest } from '../src/world/find';
import { Generator } from '../src/world/generate';
import { World } from '../src/world/world';

const SEED = 20261022;
const v1 = new Generator(SEED, { generation: 1 });
const v2 = new Generator(SEED, { generation: 2 });
/** Version 2's land without its rivers. */
const dry = new Generator(SEED, { generation: 2, rivers: false });

describe('rivers (generation 2)', () => {
  it('are found where the land would be dry, as water', () => {
    const at = findNearest(v2, 'river', 0, 0)!;
    expect(at).not.toBeNull();
    expect(v2.height(at.x, at.z)).toBeLessThan(SEA_LEVEL);
    expect(dry.height(at.x, at.z)).toBeGreaterThan(SEA_LEVEL);
    expect(findNearest(v1, 'river', 0, 0, 1024)).toBeNull();
  });

  it('only lower the land, and never below their bed', () => {
    let carved = 0;
    for (let z = -1024; z < 1024; z += 4)
      for (let x = -1024; x < 1024; x += 4) {
        const h1 = dry.height(x, z);
        const h2 = v2.height(x, z);
        expect(h2).toBeLessThanOrEqual(h1);
        if (h2 < h1) {
          carved++;
          expect(h2).toBeGreaterThanOrEqual(Math.min(h1, SEA_LEVEL - 4));
        }
      }
    expect(carved).toBeGreaterThan(1000);
  });

  it('leave the mountains alone', () => {
    let mountain = 0;
    for (let z = -2048; z < 2048; z += 16)
      for (let x = -2048; x < 2048; x += 16) {
        if (v2.climate.weights(x, z)[Biome.Mountains] < 0.5) continue;
        mountain++;
        expect(v2.height(x, z)).toBe(dry.height(x, z));
      }
    expect(mountain).toBeGreaterThan(100);
  });

  it('are still water at sea level in the blocks, with no air under it, caves and all', () => {
    const at = findNearest(v2, 'river', 0, 0)!;
    const world = new World(SEED, { generation: 2 });
    const [cx0, cz0] = [toChunk(at.x), toChunk(at.z)];
    let water = 0;
    for (let cz = cz0 - 1; cz <= cz0 + 1; cz++)
      for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
        world.ensureColumn(cx, cz);
        for (let z = cz * CHUNK_SIZE; z < (cz + 1) * CHUNK_SIZE; z++)
          for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
            const river = v2.height(x, z) < SEA_LEVEL && dry.height(x, z) >= SEA_LEVEL;
            for (let y = MIN_CHUNK_Y * CHUNK_SIZE + 1; y < (MAX_CHUNK_Y + 1) * CHUNK_SIZE; y++) {
              if (world.getBlock(x, y, z) !== Block.Water) continue;
              expect(y, `water at ${x},${y},${z}`).toBeLessThanOrEqual(SEA_LEVEL);
              expect(world.getBlock(x, y - 1, z), `under water at ${x},${y},${z}`).not.toBe(Block.Air);
              if (river) water++;
            }
            if (river) expect(world.getBlock(x, SEA_LEVEL, z), `river surface at ${x},${z}`).toBe(Block.Water);
          }
      }
    expect(water).toBeGreaterThan(100);
  });

  it('run into each other, lakes or the sea, never a puddle of their own', () => {
    // Every body of water (columns below sea level, joined side by side) in a 768 × 768 area that
    // rivers made or added to is big, or runs out of the area.
    const R = 384;
    const N = 2 * R;
    const wet = new Uint8Array(N * N);
    const made = new Uint8Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const h2 = v2.height(i - R, j - R);
        wet[j * N + i] = h2 < SEA_LEVEL ? 1 : 0;
        made[j * N + i] = h2 < SEA_LEVEL && dry.height(i - R, j - R) >= SEA_LEVEL ? 1 : 0;
      }
    const seen = new Uint8Array(N * N);
    let bodies = 0;
    for (let start = 0; start < N * N; start++) {
      if (!wet[start] || seen[start]) continue;
      let size = 0;
      let byRiver = false;
      let edge = false;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        byRiver ||= made[c] === 1;
        const i = c % N;
        const j = (c - i) / N;
        if (i === 0 || j === 0 || i === N - 1 || j === N - 1) edge = true;
        for (const n of [i > 0 ? c - 1 : -1, i < N - 1 ? c + 1 : -1, j > 0 ? c - N : -1, j < N - 1 ? c + N : -1])
          if (n >= 0 && wet[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
      }
      if (!byRiver) continue;
      bodies++;
      expect(edge || size >= 60, `a body of ${size} columns at ${(start % N) - R}, ${Math.floor(start / N) - R}`).toBe(true);
    }
    expect(bodies).toBeGreaterThan(0);
  });

  it('are none in version 1', () => {
    const g = new Generator(SEED);
    for (let z = -512; z < 512; z += 8) for (let x = -512; x < 512; x += 8) expect(g.height(x, z)).toBe(v1.height(x, z));
  });
});
