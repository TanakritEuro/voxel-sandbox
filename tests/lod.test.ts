import { describe, expect, it } from 'vitest';
import { FACE_ORDER, type MeshData } from '../src/mesh/builder';
import { coarsen, type Lod, prepareLod, SEAM_POS_X } from '../src/mesh/lod';
import { meshChunk } from '../src/mesh/mesher';
import { PADDED, PADDED_VOLUME, paddedBlocks, paddedIndex, paddedLight } from '../src/mesh/padding';
import { handleJob } from '../src/workers/jobs';
import { Block, BLOCKS } from '../src/world/blocks';
import { CHUNK_SIZE } from '../src/world/coords';
import { SUNLIT } from '../src/world/light';
import { World } from '../src/world/world';

const S = CHUNK_SIZE;
/** Padded index of chunk-local (x, y, z). */
const local = (x: number, y: number, z: number) => paddedIndex(x + 1, y + 1, z + 1);
const solid = (b: number) => (BLOCKS[b].opaque || BLOCKS[b].cutout) && BLOCKS[b].shape === 'cube';

function empty(): { blocks: Uint8Array; light: Uint8Array } {
  return { blocks: new Uint8Array(PADDED_VOLUME), light: new Uint8Array(PADDED_VOLUME).fill(SUNLIT) };
}

describe('coarsening', () => {
  it('makes a cell solid at half, with its highest solid block, else takes the solid out', () => {
    const { blocks, light } = empty();
    // Cell (0, 0, 0): dirt below, one grass block above: 5 of 8, all grass.
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) blocks[local(x, 0, z)] = Block.Dirt;
    blocks[local(1, 1, 1)] = Block.Grass;
    // Cell (1, 0, 0) (x 2..3): 3 stone in air, the air's light dimmed in one spot.
    for (const [x, z] of [[2, 0], [3, 0], [2, 1]]) blocks[local(x, 0, z)] = Block.Stone;
    light[local(3, 1, 1)] = 0x9c; // sun 9, block light 12: the brightest of each is kept
    for (const [x, y, z] of [[2, 1, 0], [3, 1, 0], [2, 1, 1], [3, 0, 1]]) light[local(x, y, z)] = 0x30;
    // Cell (2, 0, 0) (x 4..5): 3 stone in water: the stone becomes water.
    for (let i = 0; i < 8; i++) blocks[local(4 + (i & 1), (i >> 2) & 1, (i >> 1) & 1)] = i < 3 ? Block.Stone : Block.Water;
    // Cell (3, 0, 0): 4 leaves count as solid; a torch doesn't.
    for (const [x, z] of [[6, 0], [7, 0], [6, 1], [7, 1]]) blocks[local(x, 0, z)] = Block.Leaves;
    blocks[local(6, 1, 0)] = Block.Torch;
    coarsen(blocks, light, 2);
    const cell = (x0: number) => [0, 1].flatMap((y) => [0, 1].flatMap((z) => [0, 1].map((x) => blocks[local(x0 + x, y, z)])));
    expect(cell(0)).toEqual(Array(8).fill(Block.Grass));
    expect(cell(2)).toEqual(Array(8).fill(Block.Air));
    expect(light[local(2, 0, 0)]).toBe(0x9c);
    expect(cell(4)).toEqual(Array(8).fill(Block.Water));
    expect(cell(6)).toEqual(Array(8).fill(Block.Leaves));
  });

  it('keeps a 4³ cell solid at 32 of 64, not at 31', () => {
    for (const n of [32, 31]) {
      const { blocks, light } = empty();
      for (let i = 0; i < n; i++) blocks[local(i & 3, i >> 4, (i >> 2) & 3)] = Block.Stone;
      coarsen(blocks, light, 4);
      expect(blocks[local(3, 3, 3)]).toBe(n === 32 ? Block.Stone : Block.Air);
    }
  });

  it('gives a solid cell the surface layer taken out of the cell above it; keeps a tree trunk as it is', () => {
    const { blocks, light } = empty();
    // 4³ cells: stone up to y 3; on top, a layer of snow over x 0..3 and a lone trunk over x 4..7.
    for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 8; x++) blocks[local(x, y, z)] = Block.Stone;
    for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) blocks[local(x, 4, z)] = Block.Snow;
    blocks[local(5, 4, 1)] = Block.Wood;
    coarsen(blocks, light, 4);
    expect(blocks[local(0, 4, 0)]).toBe(Block.Air); // the layer alone is a quarter of its cell
    expect(blocks[local(0, 3, 0)]).toBe(Block.Snow); // so the cell under it is snow
    expect(blocks[local(5, 4, 1)]).toBe(Block.Wood); // trunks are kept, so canopies don't float
    expect(blocks[local(5, 3, 1)]).toBe(Block.Stone); // and a trunk doesn't cover the ground
  });

  it('counts a patch of the border solid only when all of it is, and never for 4³ cells', () => {
    const { blocks, light } = empty();
    // On the -x border: a full 2 × 2 patch of stone, and a patch with 3 of 4.
    for (const [y, z] of [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3]]) blocks[paddedIndex(0, y + 1, z + 1)] = Block.Stone;
    coarsen(blocks, light, 2);
    expect(blocks[paddedIndex(0, 1, 1)]).toBe(Block.Stone);
    expect(blocks[paddedIndex(0, 2, 2)]).toBe(Block.Stone);
    expect(blocks[paddedIndex(0, 1, 3)]).toBe(Block.Air);
    expect(blocks[paddedIndex(0, 1, 4)]).toBe(Block.Air);
    // 4³ cells: a whole 4 × 4 patch of stone is taken out too, lit by full sun.
    const four = empty();
    for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) four.blocks[paddedIndex(0, y + 1, z + 1)] = Block.Stone;
    four.light.fill(0);
    coarsen(four.blocks, four.light, 4);
    expect(four.blocks[paddedIndex(0, 1, 1)]).toBe(Block.Air);
    expect(four.light[paddedIndex(0, 1, 1)]).toBe(SUNLIT);
  });
});

// Real chunks: mountains (seed 20261022 around chunk (-12, 12)) and the spawn.
const world = new World(20261022);
const columns: [number, number][] = [];
for (let cz = 11; cz <= 13; cz++) for (let cx = -13; cx <= -11; cx++) columns.push([cx, cz]);
for (const [cx, cz] of [[0, 0], [1, 0], [0, 1]] as const) columns.push([cx, cz]);
for (const [cx, cz] of columns) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.ensureColumn(cx + dx, cz + dz);

/** A chunk meshed at `lod`, and its coarsened padded blocks. */
function meshAt(cx: number, cy: number, cz: number, lod: Lod, seams = 0): { mesh: ReturnType<typeof meshChunk>; blocks: Uint8Array } {
  const blocks = paddedBlocks(world, cx, cy, cz);
  const light = paddedLight(world, cx, cy, cz);
  prepareLod(blocks, light, lod, seams);
  return { mesh: meshChunk(blocks, cx, cy, cz, light, lod > 0), blocks };
}

/** Which of the S × S squares of a chunk's face on `axis` (at local `plane`) quads of FACE_ORDER range `k` cover. */
function covered(m: MeshData, k: number, axis: number, origin: number[], plane: number): Uint8Array {
  const [ua, va] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
  const grid = new Uint8Array(S * S);
  for (let q = m.faceStarts[k]; q < m.faceStarts[k + 1]; q++) {
    const p = (i: number, a: number) => m.positions[(q * 4 + i) * 3 + a] - origin[a];
    if (p(0, axis) !== plane) continue;
    const us = [0, 1, 2, 3].map((i) => p(i, ua));
    const vs = [0, 1, 2, 3].map((i) => p(i, va));
    for (let v = Math.min(...vs); v < Math.max(...vs); v++) for (let u = Math.min(...us); u < Math.max(...us); u++) grid[v * S + u] = 1;
  }
  return grid;
}

describe('far chunk meshes', () => {
  it('have far fewer quads than full detail', () => {
    const quads = [0, 0, 0];
    for (const lod of [0, 1, 2] as Lod[]) for (const [cx, cz] of columns) for (let cy = 0; cy <= 7; cy++) quads[lod] += meshAt(cx, cy, cz, lod).mesh.opaque.faceStarts[7];
    expect(quads[1]).toBeLessThan(quads[0] * 0.4);
    // Under two thirds: the trunks kept at full detail (mountain spruces are dense) cost a little.
    expect(quads[2]).toBeLessThan(quads[1] * 0.67);
  });

  it('leave no face out where two chunks of the same level meet', () => {
    // Every square of the plane between two neighbours where one side's cell is solid and the
    // other's isn't must be covered by a face of the solid side.
    const pairs: [number, number[], number[]][] = [];
    for (let cy = 0; cy <= 7; cy++) {
      pairs.push([0, [-12, cy, 12], [-11, cy, 12]], [2, [-12, cy, 12], [-12, cy, 13]]);
      if (cy < 7) pairs.push([1, [-12, cy, 12], [-12, cy + 1, 12]]);
    }
    let required = 0;
    for (const lod of [1, 2] as Lod[]) {
      for (const [axis, a, b] of pairs) {
        const A = meshAt(a[0], a[1], a[2], lod);
        const B = meshAt(b[0], b[1], b[2], lod);
        const originA = a.map((c) => c * S);
        const originB = b.map((c) => c * S);
        // FACE_ORDER: +x, +y, +z, -x, -y, -z.
        const plus = FACE_ORDER.indexOf((axis * 2) as never);
        const minus = FACE_ORDER.indexOf((axis * 2 + 1) as never);
        // Solid blocks and leaves are in two passes; either covers.
        const fromA = covered(A.mesh.opaque, plus, axis, originA, S).map((c, i) => c | covered(A.mesh.cutout, plus, axis, originA, S)[i]);
        const fromB = covered(B.mesh.opaque, minus, axis, originB, 0).map((c, i) => c | covered(B.mesh.cutout, minus, axis, originB, 0)[i]);
        const [ua, va] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
        for (let v = 0; v < S; v++) {
          for (let u = 0; u < S; u++) {
            const pa = [0, 0, 0];
            const pb = [0, 0, 0];
            pa[axis] = S - 1;
            pb[axis] = 0;
            pa[ua] = pb[ua] = u;
            pa[va] = pb[va] = v;
            const sa = solid(A.blocks[local(pa[0], pa[1], pa[2])]);
            const sb = solid(B.blocks[local(pb[0], pb[1], pb[2])]);
            if (sa && !sb) {
              required++;
              expect(fromA[v * S + u], `lod ${lod}, axis ${axis}, ${a} → ${b} at ${u},${v}`).toBe(1);
            }
            if (sb && !sa) {
              required++;
              expect(fromB[v * S + u], `lod ${lod}, axis ${axis}, ${b} → ${a} at ${u},${v}`).toBe(1);
            }
          }
        }
      }
    }
    expect(required).toBeGreaterThan(100);
  });

  it('wall only the sides bordering another level (LOD 2: every side)', () => {
    // A chunk of stone inside stone: no faces at all, until its +x side borders another level.
    const blocks = new Uint8Array(PADDED_VOLUME).fill(Block.Stone);
    const light = new Uint8Array(PADDED_VOLUME);
    for (const lod of [0, 1] as Lod[]) {
      const b = blocks.slice();
      const l = light.slice();
      prepareLod(b, l, lod, 0);
      expect(meshChunk(b, 0, 1, 0, l, lod > 0).opaque.faceStarts[7]).toBe(0);
      prepareLod(b, l, lod, SEAM_POS_X);
      const m = meshChunk(b, 0, 1, 0, l, lod > 0).opaque;
      // Only +x faces, all on the chunk's +x side, lit by full sun.
      expect(m.faceStarts[1]).toBeGreaterThan(0);
      expect(m.faceStarts[7]).toBe(m.faceStarts[1]);
      for (let i = 0; i < m.positions.length / 3; i++) expect(m.positions[i * 3]).toBe(S);
      expect(l[paddedIndex(PADDED - 1, 5, 5)]).toBe(SUNLIT);
    }
    // LOD 2 walls every edge anyway (its border never counts as solid): one face a side.
    const b = blocks.slice();
    const l = light.slice();
    prepareLod(b, l, 2, 0);
    const m = meshChunk(b, 0, 1, 0, l, true).opaque;
    expect(m.faceStarts[7]).toBe(6);
    for (let k = 0; k < 6; k++) expect(m.faceStarts[k + 1] - m.faceStarts[k]).toBe(1);
  });

  it('keep the water at full detail', () => {
    // The sea at the spawn: the same water surface (+y faces, their height and area) at every level.
    const surface = (m: MeshData) => {
      let area = 0;
      const heights = new Set<number>();
      for (let q = m.faceStarts[1]; q < m.faceStarts[2]; q++) {
        const p = (i: number, a: number) => m.positions[(q * 4 + i) * 3 + a];
        heights.add(p(0, 1));
        area += (Math.max(p(0, 0), p(2, 0)) - Math.min(p(0, 0), p(2, 0))) * (Math.max(p(0, 2), p(2, 2)) - Math.min(p(0, 2), p(2, 2)));
      }
      return { area, heights: [...heights].sort() };
    };
    let compared = 0;
    for (const [cx, cz] of [[0, 0], [1, 0], [0, 1]]) {
      const full = surface(meshAt(cx, 1, cz, 0).mesh.transparent);
      if (!full.area) continue;
      compared++;
      for (const lod of [1, 2] as Lod[]) {
        const far = surface(meshAt(cx, 1, cz, lod).mesh.transparent);
        expect(far.heights).toEqual(full.heights);
        // A little lost where shore cells turn solid, a little gained where stone in the sea
        // turns to water; the same within a fifth.
        expect(far.area).toBeGreaterThan(full.area * 0.8);
        expect(far.area).toBeLessThan(full.area * 1.2);
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('are what a mesh job with a level makes, in the worker', () => {
    const [cx, cy, cz] = [-12, 3, 12];
    for (const [lod, seams] of [[1, 0], [2, SEAM_POS_X]] as [Lod, number][]) {
      const result = handleJob({ kind: 'mesh', id: 1, cx, cy, cz, version: 0, padded: paddedBlocks(world, cx, cy, cz), paddedLight: paddedLight(world, cx, cy, cz), lod, seams });
      if (result.kind !== 'mesh') throw new Error('not a mesh result');
      expect(result.mesh).toEqual(meshAt(cx, cy, cz, lod, seams).mesh);
    }
  });
});
