import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { Block, BLOCKS, slab, slabOf, stairs, stairsOf } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { createBody, moveBody, overlapsBlock } from '../src/world/physics';
import { raycast } from '../src/world/raycast';
import { Chunk, World } from '../src/world/world';
import { Grid } from './grid';
import { shapePlacement } from '../src/world/shapes';
import { dropsOf, pickTier, rightTool } from '../src/survival/drops';
import { RECIPES } from '../src/survival/crafting';
import { settable } from '../src/net/hostWorld';

/** A world with empty (all-air) chunks at the given chunk coordinates. */
function emptyWorld(...coords: [number, number, number][]): World {
  const world = new World(1);
  for (const [cx, cy, cz] of coords) {
    const c = new Chunk(cx, cy, cz, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
  }
  return world;
}

/** The lone block at (5, 40, 5) meshed. */
function meshOne(block: Block) {
  const world = emptyWorld([0, 1, 0]);
  world.setBlock(5, 40, 5, block);
  return meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0).opaque;
}

/** Each quad's corners: [x, y, z][4]. */
function quads(m: { positions: Float32Array }): number[][][] {
  const out: number[][][] = [];
  for (let q = 0; q < m.positions.length / 12; q++) out.push([0, 1, 2, 3].map((k) => [0, 1, 2].map((a) => m.positions[(q * 4 + k) * 3 + a])));
  return out;
}

describe('slabs and stairs', () => {
  it('have an id for each state that reads back, in three materials', () => {
    for (let m = 0; m < 3; m++) {
      for (const upper of [false, true]) expect(slabOf(slab(m, upper))).toEqual({ material: m, upper });
      for (let f = 0; f < 4; f++) for (const down of [false, true]) expect(stairsOf(stairs(m, f, down))).toEqual({ material: m, facing: f, down });
    }
    expect(slabOf(Block.Stone)).toBe(null);
    expect(stairsOf(slab(2, true))).toBe(null);
    expect(Block.Fence).toBe(Block.Stairs + 24);
    expect(BLOCKS[slab(1, false)].name).toBe('Plank slab');
    expect(BLOCKS[stairs(0, 0, false)].name).toBe('Stone stairs');
  });

  it("are made of boxes: a slab its half, stairs a slab and a quarter at the back (or under it, upside down)", () => {
    expect(BLOCKS[slab(0, false)].boxes).toEqual([[0, 0, 0, 1, 0.5, 1]]);
    expect(BLOCKS[slab(0, true)].boxes).toEqual([[0, 0.5, 0, 1, 1, 1]]);
    // Facing +x: the quarter on the +x half.
    expect(BLOCKS[stairs(0, 0, false)].boxes).toEqual([
      [0, 0, 0, 1, 0.5, 1],
      [0.5, 0.5, 0, 1, 1, 1],
    ]);
    // Facing -z, upside down: the slab on top, the quarter under it on the -z half.
    expect(BLOCKS[stairs(1, 3, true)].boxes).toEqual([
      [0, 0.5, 0, 1, 1, 1],
      [0, 0, 0, 1, 0.5, 0.5],
    ]);
  });
});

describe('collision with several boxes', () => {
  it('stands on a lower slab at its half, and a jump under an upper slab stops at its underside', () => {
    const g = new Grid().floor(-5, 5, -5, 5).set(0, 1, 0, slab(0, false)).set(2, 3, 0, slab(0, true));
    const body = createBody(0.5, 3, 0.5);
    moveBody(body, 0, -3, 0, g);
    expect(body.y).toBeCloseTo(1.5, 6);
    const under = createBody(2.5, 1, 0.5);
    moveBody(under, 0, 3, 0, g);
    expect(under.y).toBeCloseTo(3.5 - 1.8, 6);
  });

  it("stands on a stair's step at 1/2 and its back at 1, and is stopped by the back walking into it", () => {
    // Stairs facing +x at x = 0: the step at x 0..0.5, the back at 0.5..1.
    const g = new Grid().floor(-5, 5, -5, 5).set(0, 1, 0, stairs(1, 0, false));
    const step = createBody(0.25, 3, 0.5, 0.2, 1.8);
    moveBody(step, 0, -3, 0, g);
    expect(step.y).toBeCloseTo(1.5, 6);
    const back = createBody(0.75, 3, 0.5, 0.2, 1.8);
    moveBody(back, 0, -3, 0, g);
    expect(back.y).toBeCloseTo(2, 6);
    // On the step, walking +x into the back's side: stopped at x 0.5 less half its width.
    moveBody(step, 1, 0, 0, g);
    expect(step.x).toBeCloseTo(0.5 - 0.2, 6);
    // On the floor at the front, walking +x: stopped by the slab at the block's side.
    const front = createBody(-1.5, 1, 0.5);
    moveBody(front, 2, 0, 0, g);
    expect(front.x).toBeCloseTo(-0.3, 6);
  });

  it('overlaps a slab only where it is, for placing', () => {
    // A body standing on a lower slab: above it, not in it.
    expect(overlapsBlock(createBody(0.5, 1.5, 0.5), 0, 1, 0, slab(0, false))).toBe(false);
    expect(overlapsBlock(createBody(0.5, 1.5, 0.5), 0, 1, 0, slab(0, true))).toBe(true);
    expect(overlapsBlock(createBody(0.25, 1.5, 0.5, 0.2, 1.8), 0, 1, 0, stairs(0, 0, false))).toBe(false);
    expect(overlapsBlock(createBody(0.75, 1.5, 0.5, 0.2, 1.8), 0, 1, 0, stairs(0, 0, false))).toBe(true);
  });
});

describe('the raycast and several boxes', () => {
  it("passes over a lower slab, hits a stair's back, and says where it hit", () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, slab(0, false));
    world.setBlock(8, 40, 5, stairs(0, 0, false));
    // Along +x at y 40.75: over the slab, onto the stair's back at x 8.5 (its -x face).
    const hit = raycast(world, { x: 3.5, y: 40.75, z: 5.5 }, { x: 1, y: 0, z: 0 }, 8)!;
    expect(hit).toMatchObject({ x: 8, y: 40, z: 5, nx: -1, ny: 0, nz: 0 });
    expect(hit.distance).toBeCloseTo(5, 6);
    expect(hit.px).toBeCloseTo(8.5, 6);
    expect(hit.py).toBeCloseTo(40.75, 6);
    // Lower, at y 40.25: the slab's side.
    const low = raycast(world, { x: 3.5, y: 40.25, z: 5.5 }, { x: 1, y: 0, z: 0 }, 8)!;
    expect(low).toMatchObject({ x: 5, nx: -1 });
    expect(low.px).toBeCloseTo(5, 6);
    // Down onto the stair's step: its top at 40.5.
    const down = raycast(world, { x: 8.25, y: 43, z: 5.5 }, { x: 0, y: -1, z: 0 }, 5)!;
    expect(down).toMatchObject({ x: 8, y: 40, ny: 1 });
    expect(down.py).toBeCloseTo(40.5, 6);
  });
});

describe('meshing several boxes', () => {
  it('draws a slab as 6 quads at its half, its sides showing that half of the texture', () => {
    for (const [upper, y0, y1] of [
      [false, 40, 40.5],
      [true, 40.5, 41],
    ] as const) {
      const m = meshOne(slab(0, upper));
      const qs = quads(m);
      expect(qs.length).toBe(6);
      const ys = qs.flat().map((p) => p[1]);
      expect(Math.min(...ys)).toBeCloseTo(y0, 5);
      expect(Math.max(...ys)).toBeCloseTo(y1, 5);
      // On the sides, v (with its eighths, the byte's low 3 bits) is the height in the block.
      qs.forEach((q, n) => {
        if (q.every((p) => p[1] === q[0][1])) return;
        for (let k = 0; k < 4; k++) {
          const v = n * 4 + k;
          expect(m.uvl[v * 4 + 1] + (m.uvl[v * 4 + 3] & 7) / 8).toBeCloseTo(q[k][1] - 40, 5);
        }
      });
    }
  });

  it("draws stairs as their two boxes, the quarter's face on the slab left out, every face outwards", () => {
    for (let f = 0; f < 4; f++)
      for (const down of [false, true]) {
        const m = meshOne(stairs(0, f, down));
        const qs = quads(m);
        expect(qs.length).toBe(11);
        // Each quad faces away from the middle of the box it belongs to: its normal points out of
        // the block's middle, or (the slab's face under the quarter's overhang) up or down.
        for (const q of qs) {
          const e1 = q[1].map((v, a) => v - q[0][a]);
          const e2 = q[2].map((v, a) => v - q[0][a]);
          const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const mid = [0, 1, 2].map((a) => (q[0][a] + q[2][a]) / 2);
          const out = [mid[0] - 5.5, mid[1] - 40.5, mid[2] - 5.5];
          expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThanOrEqual(0);
        }
      }
  });

  it("gives a half-width face u in eighths too (the byte's upper bits)", () => {
    // Facing +x: the quarter's top from x 0.5 to 1; its corner at x 5.5 has u 0 and 4 eighths.
    const m = meshOne(stairs(0, 0, false));
    const qs = quads(m);
    const top = qs.findIndex((q) => q.every((p) => p[1] === 41));
    expect(top).toBeGreaterThanOrEqual(0);
    const us = [0, 1, 2, 3].map((k) => {
      const v = top * 4 + k;
      return m.uvl[v * 4] + (m.uvl[v * 4 + 3] >> 3) / 8;
    });
    expect(us.map((u) => u).sort()).toEqual([0.5, 0.5, 1, 1]);
  });
});

describe('placing slabs and stairs', () => {
  /** A floor of stone under y 1, and a click on its top at (0, 0, 0). */
  const floor = () => new Grid().floor(-5, 5, -5, 5);
  const top = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, py: 1 };
  const LOOK_X = -Math.PI / 2; // looking along +x
  /** One stone block at (0, 0, 0), for clicks on its sides. */
  const lone = () => new Grid().set(0, 0, 0, Block.Stone);

  it('puts a slab low on a top, high on a ceiling, and on a side in the half clicked', () => {
    const g = floor();
    expect(shapePlacement(g, slab(0, false), top, 0)).toEqual([0, 1, 0, slab(0, false)]);
    expect(shapePlacement(g, slab(0, false), { x: 0, y: 3, z: 0, nx: 0, ny: -1, nz: 0, py: 3 }, 0)).toEqual([0, 2, 0, slab(0, true)]);
    expect(shapePlacement(lone(), slab(2, false), { x: 0, y: 0, z: 0, nx: 1, ny: 0, nz: 0, py: 0.7 }, 0)).toEqual([1, 0, 0, slab(2, true)]);
    expect(shapePlacement(lone(), slab(2, false), { x: 0, y: 0, z: 0, nx: 1, ny: 0, nz: 0, py: 0.3 }, 0)).toEqual([1, 0, 0, slab(2, false)]);
  });

  it("makes the whole block from a slab clicked onto its own kind's open half, or put where one is in the other half", () => {
    const g = floor().set(0, 1, 0, slab(1, false)).set(3, 2, 0, slab(1, true));
    // On the lower plank slab's top: planks, there.
    expect(shapePlacement(g, slab(1, false), { x: 0, y: 1, z: 0, nx: 0, ny: 1, nz: 0, py: 1.5 }, 0)).toEqual([0, 1, 0, Block.Planks]);
    // Under the upper one: planks.
    expect(shapePlacement(g, slab(1, false), { x: 3, y: 2, z: 0, nx: 0, ny: -1, nz: 0, py: 2.5 }, 0)).toEqual([3, 2, 0, Block.Planks]);
    // A stone slab on the plank slab: a slab above it, not a block.
    expect(shapePlacement(g, slab(0, false), { x: 0, y: 1, z: 0, nx: 0, ny: 1, nz: 0, py: 1.5 }, 0)).toEqual([0, 2, 0, slab(0, false)]);
    // From the side, into the plank slab's empty upper half (the ray went through it): planks.
    expect(shapePlacement(g, slab(1, false), { x: -1, y: 1, z: 0, nx: 1, ny: 0, nz: 0, py: 1.8 }, 0)).toEqual([0, 1, 0, Block.Planks]);
    // Into its lower half, where it is already: nothing.
    expect(shapePlacement(g, slab(1, false), { x: -1, y: 1, z: 0, nx: 1, ny: 0, nz: 0, py: 1.2 }, 0)).toBe(null);
  });

  it('turns stairs the way the player looks, upside down on a ceiling or the upper half of a side', () => {
    const g = floor();
    expect(shapePlacement(g, stairs(0, 0, false), top, LOOK_X)).toEqual([0, 1, 0, stairs(0, 0, false)]);
    expect(shapePlacement(g, stairs(0, 0, false), top, 0)).toEqual([0, 1, 0, stairs(0, 3, false)]);
    expect(shapePlacement(g, stairs(2, 0, false), { x: 0, y: 3, z: 0, nx: 0, ny: -1, nz: 0, py: 3 }, LOOK_X)).toEqual([0, 2, 0, stairs(2, 0, true)]);
    expect(shapePlacement(lone(), stairs(2, 0, false), { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, py: 0.9 }, LOOK_X)).toEqual([0, 0, 1, stairs(2, 0, true)]);
    // Into something: nothing.
    expect(shapePlacement(g.set(0, 1, 0, Block.Stone), stairs(0, 0, false), top, 0)).toBe(null);
  });
});

describe('slabs and stairs in survival and together', () => {
  it('give themselves (as the picker has them), dug with their material\'s tool and pick', () => {
    expect(dropsOf(slab(0, true), { kind: 'pick', tier: 1, speed: 2, wear: 60 }, 0)).toEqual([[slab(0, false), 1]]);
    expect(dropsOf(stairs(1, 3, true), undefined, 0)).toEqual([[stairs(1, 0, false), 1]]);
    // Stone stairs by hand: nothing, as stone gives nothing by hand.
    expect(dropsOf(stairs(0, 2, false), undefined, 0)).toEqual([]);
    expect(rightTool(slab(1, false))).toBe('axe');
    expect(rightTool(stairs(2, 1, true))).toBe('pick');
    expect(pickTier(slab(0, true))).toBe(1);
  });

  it('are made 6 slabs from 3 blocks and 4 stairs from 6', () => {
    const slabs = RECIPES.find((r) => r.makes === slab(2, false))!;
    expect(slabs.count).toBe(6);
    expect(slabs.cost).toEqual([[Block.Sandstone, 3]]);
    const steps = RECIPES.find((r) => r.makes === stairs(0, 0, false))!;
    expect(steps.count).toBe(4);
    expect(steps.cost).toEqual([[Block.Stone, 6]]);
  });

  it('may be set by a guest in any half, facing or way up', () => {
    for (let b = Block.Slab; b < Block.Stairs + 24; b++) expect(settable(b)).toBe(true);
  });
});
