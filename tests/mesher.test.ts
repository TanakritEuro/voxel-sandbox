import { describe, expect, it } from 'vitest';
import { meshChunk, paddedBlocks } from '../src/mesh/mesher';
import { Block } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { Chunk, World } from '../src/world/world';

/** A world with empty (all-air) chunks at the given chunk coordinates. */
function emptyWorld(...coords: [number, number, number][]): World {
  const world = new World(1);
  for (const [cx, cy, cz] of coords) {
    const c = new Chunk(cx, cy, cz, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
  }
  return world;
}

const mesh = (world: World, cx: number, cy: number, cz: number) => meshChunk(paddedBlocks(world, cx, cy, cz), cx, cy, cz);

describe('mesher', () => {
  it('draws all six faces of a lone block, as two triangles each', () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, Block.Stone);
    const m = mesh(world, 0, 1, 0);
    expect(m.quads).toBe(6);
    expect(m.opaque.indices.length).toBe(36);
    expect(m.transparent.indices.length).toBe(0);
  });

  it('hides the faces between two touching blocks', () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(6, 40, 5, Block.Dirt);
    expect(mesh(world, 0, 1, 0).quads).toBe(10);
  });

  it('culls faces against blocks in the neighbouring chunk', () => {
    const world = emptyWorld([0, 1, 0], [1, 1, 0]);
    world.setBlock(31, 40, 5, Block.Stone);
    world.setBlock(32, 40, 5, Block.Stone);
    expect(mesh(world, 0, 1, 0).quads).toBe(5);
    expect(mesh(world, 1, 1, 0).quads).toBe(5);
  });

  it('puts water in the transparent pass and draws the ground under it', () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, Block.Sand);
    world.setBlock(5, 41, 5, Block.Water);
    const m = mesh(world, 0, 1, 0);
    // Sand: all 6 faces (water is see-through). Water: 5, none towards the opaque sand.
    expect(m.opaque.indices.length / 6).toBe(6);
    expect(m.transparent.indices.length / 6).toBe(5);
  });

  it('faces point outwards (counter-clockwise from outside)', () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, Block.Stone);
    const { positions, indices } = mesh(world, 0, 1, 0).opaque;
    const centre = [5.5, 40.5, 5.5];
    for (let i = 0; i < indices.length; i += 3) {
      const p = [0, 1, 2].map((k) => [0, 1, 2].map((a) => positions[indices[i + k] * 3 + a]));
      const e1 = p[1].map((v, a) => v - p[0][a]);
      const e2 = p[2].map((v, a) => v - p[0][a]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const out = p[0].map((v, a) => v - centre[a]);
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
    }
  });
});
