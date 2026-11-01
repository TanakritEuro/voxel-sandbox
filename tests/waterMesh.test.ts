import { describe, expect, it } from 'vitest';
import type { MeshData } from '../src/mesh/builder';
import { prepareLod } from '../src/mesh/lod';
import { meshChunk } from '../src/mesh/mesher';
import { PADDED, paddedBlocks, paddedLight } from '../src/mesh/padding';
import { Block } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { Chunk, World } from '../src/world/world';

/** A world of one empty chunk at (0, 1, 0): blocks 0..31 across, 32..63 up. */
function emptyWorld(): World {
  const world = new World(1);
  const c = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
  world.chunks.set(c.key, c);
  return world;
}
const mesh = (world: World) => meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0, paddedLight(world, 0, 1, 0));

interface Quad {
  lo: number[];
  hi: number[];
  /** The outward normal (from the corners' counter-clockwise order). */
  normal: number[];
  /** Texture v from the first corner to the third (bottom to top on a side). */
  vSpan: number;
}

function quadsOf(m: MeshData): Quad[] {
  const out: Quad[] = [];
  const p = m.positions;
  const v = (k: number) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]];
  const tv = (k: number) => m.uvl[k * 4 + 1] + m.uvl[k * 4 + 3] / 8;
  for (let q = 0; q < p.length / 12; q++) {
    const c = [0, 1, 2, 3].map((k) => v(q * 4 + k));
    const a = c[1].map((x, i) => x - c[0][i]);
    const b = c[3].map((x, i) => x - c[0][i]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map(Math.sign);
    out.push({
      lo: [0, 1, 2].map((i) => Math.min(...c.map((x) => x[i]))),
      hi: [0, 1, 2].map((i) => Math.max(...c.map((x) => x[i]))),
      normal: n,
      vSpan: Math.abs(tv(q * 4 + 2) - tv(q * 4)),
    });
  }
  return out;
}

/** The quad facing along `normal` whose plane is at `at` on that axis, if there's one. */
const facing = (qs: Quad[], normal: number[], at: number) => qs.filter((q) => q.normal.every((n, i) => n === normal[i]) && q.lo[normal.findIndex((n) => n !== 0)] === at);

describe('water meshing', () => {
  it('meshes flowing water at its depth: its top, and sides up to it, with the texture not stretched', () => {
    const world = emptyWorld();
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(5, 41, 5, Block.WaterFlow4);
    const qs = quadsOf(mesh(world).transparent);
    expect(qs.length).toBe(5); // top and four sides; none on the stone
    const top = facing(qs, [0, 1, 0], 41.5);
    expect(top.length).toBe(1);
    for (const n of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const side = qs.find((q) => q.normal.every((x, i) => x === n[i]))!;
      expect([side.lo[1], side.hi[1]]).toEqual([41, 41.5]);
      expect(side.vSpan).toBe(0.5);
    }
  });

  it("shows the deeper water's side above the shallower, from it only, and nothing below", () => {
    const world = emptyWorld();
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(6, 40, 5, Block.Stone);
    world.setBlock(5, 41, 5, Block.WaterFlow6);
    world.setBlock(6, 41, 5, Block.WaterFlow3);
    const qs = quadsOf(mesh(world).transparent);
    const step = facing(qs, [1, 0, 0], 6);
    expect(step.length).toBe(1);
    expect([step[0].lo[1], step[0].hi[1]]).toEqual([41.375, 41.75]);
    expect(step[0].vSpan).toBe(0.375);
    expect(facing(qs, [-1, 0, 0], 6).length).toBe(0);
    expect(qs.length).toBe(9); // 5 for the deeper, 4 for the shallower
  });

  it('shows a source above shallow water beside it', () => {
    const world = emptyWorld();
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(6, 40, 5, Block.Stone);
    world.setBlock(5, 41, 5, Block.Water);
    world.setBlock(6, 41, 5, Block.WaterFlow2);
    const qs = quadsOf(mesh(world).transparent);
    const step = facing(qs, [1, 0, 0], 6);
    expect(step.length).toBe(1);
    expect([step[0].lo[1], step[0].hi[1]]).toEqual([41.25, 42]);
    expect(facing(qs, [-1, 0, 0], 6).length).toBe(0);
    expect(qs.length).toBe(9);
  });

  it('makes water with water above it a full block, with no face between them', () => {
    const world = emptyWorld();
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(5, 41, 5, Block.WaterFlow3);
    world.setBlock(5, 42, 5, Block.WaterFalling);
    const qs = quadsOf(mesh(world).transparent);
    expect(qs.filter((q) => q.lo[1] === 42 && q.hi[1] === 42).length).toBe(0);
    expect(qs.filter((q) => q.normal[1] === 0).every((q) => q.hi[1] - q.lo[1] === 1)).toBe(true);
    expect(qs.length).toBe(9); // four sides each, and the top
  });

  it('draws nothing between sources and falling water side by side', () => {
    const world = emptyWorld();
    world.setBlock(5, 41, 5, Block.Water);
    world.setBlock(6, 41, 5, Block.WaterFalling);
    const qs = quadsOf(mesh(world).transparent);
    expect(facing(qs, [1, 0, 0], 6).length + facing(qs, [-1, 0, 0], 6).length).toBe(0);
  });

  it('faces every way outwards in a stream of every depth', () => {
    const world = emptyWorld();
    for (let x = 2; x <= 12; x++) world.setBlock(x, 40, 5, Block.Stone);
    world.setBlock(2, 41, 5, Block.Water);
    for (let l = 7; l >= 1; l--) world.setBlock(10 - l, 41, 5, [0, Block.WaterFlow1, Block.WaterFlow2, Block.WaterFlow3, Block.WaterFlow4, Block.WaterFlow5, Block.WaterFlow6, Block.WaterFlow7][l]);
    world.setBlock(10, 42, 5, Block.WaterFalling); // a drop of water above the end of the stream
    const qs = quadsOf(mesh(world).transparent);
    // Each quad's normal points away from the middle of the water block it belongs to.
    for (const q of qs) {
      const axis = q.normal.findIndex((n) => n !== 0);
      const plane = q.lo[axis];
      const inside = [0, 1, 2].map((i) => (i === axis ? plane - q.normal[axis] * 0.01 : (q.lo[i] + q.hi[i]) / 2));
      const b = world.getBlock(Math.floor(inside[0]), Math.floor(inside[1]), Math.floor(inside[2]));
      expect(b === Block.Water || b === Block.WaterFalling || (b >= Block.WaterFlow1 && b <= Block.WaterFlow7), `quad at ${q.lo} to ${q.hi}`).toBe(true);
    }
    // Down the stream, a step of an eighth between each pair of flowing blocks.
    for (let x = 4; x <= 9; x++) {
      const step = facing(qs, [1, 0, 0], x);
      expect(step.length, `at x ${x}`).toBe(1);
      expect(step[0].hi[1] - step[0].lo[1]).toBeCloseTo(1 / 8);
    }
  });

  it('keeps flowing water as it is in far chunks', () => {
    const world = emptyWorld();
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) world.setBlock(x, 39, z, Block.Stone);
    world.setBlock(3, 40, 3, Block.WaterFlow5);
    world.setBlock(4, 40, 3, Block.WaterFalling);
    const blocks = paddedBlocks(world, 0, 1, 0);
    const light = paddedLight(world, 0, 1, 0);
    prepareLod(blocks, light, 1, 0);
    const at = (x: number, y: number, z: number) => blocks[((y - 32 + 1) * PADDED + z + 1) * PADDED + x + 1];
    expect(at(3, 40, 3)).toBe(Block.WaterFlow5);
    expect(at(4, 40, 3)).toBe(Block.WaterFalling);
    expect(quadsOf(meshChunk(blocks, 0, 1, 0, light, true).transparent).some((q) => q.normal[1] === 1 && q.lo[1] === 40 + 5 / 8)).toBe(true);
  });
});
