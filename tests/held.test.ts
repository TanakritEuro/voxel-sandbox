import { describe, expect, it } from 'vitest';
import type { MeshData } from '../src/mesh/builder';
import { heldMesh, HeldMotion } from '../src/render/heldBlock';
import { Block } from '../src/world/blocks';

const quads = (d: MeshData) => d.indices.length / 6;
const within = (d: MeshData, lo: number[], hi: number[]) => {
  for (let v = 0; v < d.positions.length / 3; v++)
    for (let a = 0; a < 3; a++) {
      expect(d.positions[v * 3 + a]).toBeGreaterThanOrEqual(lo[a] - 1e-6);
      expect(d.positions[v * 3 + a]).toBeLessThanOrEqual(hi[a] + 1e-6);
    }
};

describe('held block', () => {
  it('is the mesher’s lone block: six faces of a cube, a torch’s five, glass in the transparent pass', () => {
    const stone = heldMesh(Block.Stone, 0xf0);
    expect(quads(stone.opaque)).toBe(6);
    expect(quads(stone.transparent)).toBe(0);
    within(stone.opaque, [0, 0, 0], [1, 1, 1]);
    const torch = heldMesh(Block.Torch, 0xf0);
    expect(quads(torch.opaque)).toBe(5);
    within(torch.opaque, [7 / 16, 0, 7 / 16], [9 / 16, 10 / 16, 9 / 16]);
    expect(quads(heldMesh(Block.Leaves, 0xf0).opaque)).toBe(6);
    expect(quads(heldMesh(Block.Glass, 0xf0).transparent)).toBe(6);
    expect(heldMesh(Block.Air, 0xf0).quads).toBe(0);
  });

  it('is lit by the light it is given, and a lamp glows on its own', () => {
    const dim = heldMesh(Block.Stone, 0xa0); // sunlight 10, no block light
    for (let v = 0; v < dim.opaque.colors.length / 4; v++) {
      expect(dim.opaque.colors[v * 4 + 1]).toBe(10 * 17);
      expect(dim.opaque.colors[v * 4 + 2]).toBe(0);
    }
    const lamp = heldMesh(Block.Lamp, 0);
    for (let v = 0; v < lamp.opaque.colors.length / 4; v++) expect(lamp.opaque.colors[v * 4 + 2]).toBe(255);
  });

  it('rests when standing still, and bobs within its height when walking', () => {
    const m = new HeldMotion();
    for (let i = 0; i < 60; i++) m.update(1 / 60, 0);
    expect(m.pose).toEqual({ x: 0, y: -0, z: -0, pitch: -0 });
    let low = 0;
    let moved = false;
    for (let i = 0; i < 120; i++) {
      m.update(1 / 60, 4.3 / 60);
      low = Math.min(low, m.pose.y);
      if (Math.abs(m.pose.x) > 0.001) moved = true;
    }
    expect(low).toBeLessThan(-0.01);
    expect(low).toBeGreaterThanOrEqual(-0.035);
    expect(moved).toBe(true);
  });

  it('swings down and forward and back, and dips out and in when the block changes', () => {
    const m = new HeldMotion();
    m.swing();
    m.update(0.125, 0);
    expect(m.pose.pitch).toBeLessThan(-0.6);
    expect(m.pose.z).toBeLessThan(0);
    m.update(0.2, 0);
    expect(m.pose.pitch).toBe(-0);
    m.switched();
    m.update(0.01, 0);
    expect(m.pose.y).toBeLessThan(-0.3);
    m.update(0.25, 0);
    expect(m.pose.y).toBeCloseTo(0);
  });
});
