import { describe, expect, it } from 'vitest';
import type { MeshData } from '../src/mesh/builder';
import { heldMesh } from '../src/render/heldBlock';
import { Block, BLOCKS, hotbarFrom, HOTBAR, isTorch, PLACEABLE, torchFor, torchSupport } from '../src/world/blocks';
import { torchesHeldBy } from '../src/world/torches';
import { World } from '../src/world/world';

const WALL_TORCHES = [Block.WallTorchNegX, Block.WallTorchPosX, Block.WallTorchNegZ, Block.WallTorchPosZ];

describe('torches on walls', () => {
  it('go on the face clicked: a floor torch on a top, a wall torch on a side, none under a ceiling', () => {
    expect(torchFor(0, 1, 0)).toBe(Block.Torch);
    expect(torchFor(0, -1, 0)).toBe(null);
    for (const n of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as [number, number, number][]) {
      const t = torchFor(n[0], n[1], n[2])!;
      expect(WALL_TORCHES).toContain(t);
      // It hangs on the block clicked: one step back along the face's normal.
      expect(torchSupport(t)).toEqual(n.map((v) => -v || 0));
    }
    expect(torchSupport(Block.Torch)).toEqual([0, -1, 0]);
    expect(torchSupport(Block.Stone)).toBe(null);
    for (const t of [Block.Torch, ...WALL_TORCHES]) {
      expect(isTorch(t)).toBe(true);
      expect(BLOCKS[t].light).toBe(14);
      expect(BLOCKS[t].passable).toBe(true);
    }
  });

  it('are the torch in the hotbar and the picker, never a block of their own', () => {
    for (const t of WALL_TORCHES) expect(PLACEABLE).not.toContain(t);
    expect(PLACEABLE).toContain(Block.Torch);
    // A saved hotbar can't hold one either.
    expect(hotbarFrom([Block.WallTorchPosZ, ...HOTBAR.slice(1)])).toEqual([...HOTBAR]);
  });

  it('lean out from their wall: six faces, foot by the wall, top away from it, inside the block', () => {
    const upright = heldMesh(Block.Torch, 0xf0).opaque;
    for (const t of WALL_TORCHES) {
      const m: MeshData = heldMesh(t, 0xf0).opaque;
      expect(m.indices.length / 6).toBe(6); // the bottom shows too, lifted off the floor
      const { x: wx, z: wz } = BLOCKS[t].wall!;
      // Distance from the wall's face, which is at 0 or 1 on the wall's axis.
      const axis = wx ? 0 : 2;
      const towardWall = wx || wz;
      const fromWall = (v: number) => (towardWall < 0 ? m.positions[v * 3 + axis] : 1 - m.positions[v * 3 + axis]);
      const n = m.positions.length / 3;
      const dists = Array.from({ length: n }, (_, v) => fromWall(v));
      expect(Math.min(...dists)).toBeGreaterThan(0); // not into the wall
      expect(Math.min(...dists)).toBeLessThan(2 / 16); // but touching it, nearly
      expect(Math.max(...dists)).toBeGreaterThan(0.3); // its top well out from it
      for (let i = 0; i < m.positions.length; i++) {
        expect(m.positions[i]).toBeGreaterThanOrEqual(0);
        expect(m.positions[i]).toBeLessThanOrEqual(1);
      }
      // Counter-clockwise from outside: every face's normal points away from the stick's middle.
      const mid = [0, 1, 2].map((a) => m.positions.filter((_, i) => i % 3 === a).reduce((s, v) => s + v, 0) / n);
      for (let q = 0; q < 6; q++) {
        const p = (k: number) => [0, 1, 2].map((a) => m.positions[(q * 4 + k) * 3 + a]);
        const [a, b, c] = [p(0), p(1), p(2)];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const centre = [0, 1, 2].map((ax) => (p(0)[ax] + p(2)[ax]) / 2 - mid[ax]);
        expect(normal[0] * centre[0] + normal[1] * centre[1] + normal[2] * centre[2]).toBeGreaterThan(0);
      }
      // The same stick as the floor torch: only its texture layers.
      const layers = (d: MeshData) => new Set(d.uvl.filter((_, i) => i % 4 === 2));
      for (const l of layers(m)) expect(layers(upright).has(l)).toBe(true);
    }
  });

  it('light their surroundings like a floor torch', () => {
    const world = new World(20261022);
    world.ensureColumn(0, 0);
    // In the air high above the ground, against a block of stone.
    world.setBlock(10, 200, 10, Block.Stone);
    world.setBlock(11, 200, 10, Block.WallTorchNegX);
    expect(world.getLight(11, 200, 10) & 15).toBe(14);
    expect(world.getLight(14, 200, 10) & 15).toBe(11);
  });

  it('go with the block they hang on or stand on, and only those', () => {
    const world = new World(20261022);
    world.ensureColumn(0, 0);
    const [x, y, z] = [10, 200, 10];
    world.setBlock(x, y, z, Block.Stone);
    world.setBlock(x, y + 1, z, Block.Torch); // on top
    world.setBlock(x + 1, y, z, Block.WallTorchNegX); // on its +x side, wall at -x: held
    world.setBlock(x, y, z - 1, Block.WallTorchPosZ); // on its -z side, wall at +z: held
    world.setBlock(x - 1, y, z, Block.WallTorchNegX); // on its -x side but hanging on a wall further at -x: not held
    world.setBlock(x, y - 1, z, Block.Torch); // under it, standing on whatever is below: not held
    const held = torchesHeldBy(world, x, y, z).map((p) => p.join());
    expect(held.sort()).toEqual([[x, y + 1, z], [x + 1, y, z], [x, y, z - 1]].map((p) => p.join()).sort());
  });
});
