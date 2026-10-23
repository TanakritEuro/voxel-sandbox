import { describe, expect, it } from 'vitest';
import { Block } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { raycast } from '../src/world/raycast';
import { Chunk, World } from '../src/world/world';

function worldWith(blocks: [number, number, number][]): World {
  const world = new World(1);
  for (const [cx, cz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const c = new Chunk(cx, 1, cz, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
  }
  for (const [x, y, z] of blocks) world.setBlock(x, y, z, Block.Stone);
  return world;
}

describe('raycast', () => {
  it('hits the first block along an axis and reports the face', () => {
    const world = worldWith([[5, 40, 10], [5, 40, 12]]);
    const hit = raycast(world, { x: 5.5, y: 40.5, z: 2.5 }, { x: 0, y: 0, z: 1 }, 20)!;
    expect([hit.x, hit.y, hit.z]).toEqual([5, 40, 10]);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 0, -1]);
    expect(hit.distance).toBeCloseTo(7.5);
  });

  it('does not skip blocks on a diagonal, including across negative coordinates', () => {
    const world = worldWith([[-3, 40, -3]]);
    const d = Math.SQRT1_2;
    const hit = raycast(world, { x: 0.5, y: 40.5, z: 0.5 }, { x: -d, y: 0, z: -d }, 10);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([-3, 40, -3]);
  });

  it('passes through water and air and gives up past the reach', () => {
    const world = worldWith([[5, 40, 10]]);
    world.setBlock(5, 40, 6, Block.Water);
    expect(raycast(world, { x: 5.5, y: 40.5, z: 2.5 }, { x: 0, y: 0, z: 1 }, 5)).toBeNull();
    expect(raycast(world, { x: 5.5, y: 40.5, z: 2.5 }, { x: 0, y: 0, z: 1 }, 8)!.z).toBe(10);
  });
});
