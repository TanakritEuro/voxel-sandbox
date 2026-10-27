import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { FACE_ORDER, type MeshData } from '../src/mesh/builder';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { faceRanges } from '../src/render/chunkPage';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE } from '../src/world/coords';
import { World } from '../src/world/world';

const world = new World(20261022);
for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
// A torch on the ground in chunk (0, 1, 0), so the last range has something in it.
let y = 63;
while (world.getBlock(5, y, 5) !== Block.Air) y++;
world.setBlock(5, y, 5, Block.Torch);
const meshAt = (cx: number, cy: number, cz: number) => meshChunk(paddedBlocks(world, cx, cy, cz), cx, cy, cz, paddedLight(world, cx, cy, cz));
const meshes = [meshAt(0, 1, 0), meshAt(0, 0, 0), meshAt(-1, 2, 1)];

/** Normal of quad q (counter-clockwise from outside), not normalised, and a point on it. */
function quadPlane(m: MeshData, q: number): [number[], number[]] {
  const p = (i: number) => [0, 1, 2].map((k) => m.positions[(q * 4 + i) * 3 + k]);
  const [a, b, c] = [p(0), p(1), p(2)];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [[u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], a];
}

/** Direction 0..5 (+x, -x, +y, -y, +z, -z) a normal points along. */
function dirOf(n: number[]): number {
  const axis = [0, 1, 2].reduce((best, k) => (Math.abs(n[k]) > Math.abs(n[best]) ? k : best), 0);
  return axis * 2 + (n[axis] > 0 ? 0 : 1);
}

describe('face direction ranges', () => {
  it('hold each direction\'s quads in FACE_ORDER, then the torch, then nothing else', () => {
    const [ground] = meshes;
    const f = ground.opaque.faceStarts;
    expect(f[7]).toBe(ground.opaque.positions.length / 12);
    for (let k = 0; k < 6; k++) {
      expect(f[k + 1]).toBeGreaterThanOrEqual(f[k]);
      for (let q = f[k]; q < f[k + 1]; q++) expect(dirOf(quadPlane(ground.opaque, q)[0])).toBe(FACE_ORDER[k]);
    }
    expect(f[7] - f[6]).toBe(5); // the torch: its box but the bottom
    // Water and glass are ranged the same way, with no torches.
    const t = ground.transparent.faceStarts;
    expect(t[7]).toBe(ground.transparent.positions.length / 12);
    expect(t[7]).toBe(t[6]);
  });

  it('never leave out a face that could face the camera, and leave out half from outside', () => {
    const rand = createRng(11);
    const out = new Int32Array(8);
    let drawn = 0;
    let total = 0;
    for (const m of meshes) {
      const mesh = m.opaque;
      const quads = mesh.faceStarts[7];
      if (!quads) continue;
      // The chunk's corner, from its first vertex.
      const min = [0, 1, 2].map((k) => Math.floor(mesh.positions[k] / CHUNK_SIZE) * CHUNK_SIZE);
      for (let t = 0; t < 200; t++) {
        // Anywhere from inside the chunk to two chunks away, on each axis.
        const eye = min.map((m0) => m0 + (rand() * 5 - 2) * CHUNK_SIZE);
        const n = faceRanges(mesh.faceStarts, min[0], min[1], min[2], CHUNK_SIZE, eye[0], eye[1], eye[2], out);
        const included = new Uint8Array(quads);
        for (let r = 0; r < n; r++) included.fill(1, out[2 * r], out[2 * r + 1]);
        for (let q = 0; q < quads; q++) {
          if (included[q]) continue;
          const [normal, point] = quadPlane(mesh, q);
          const towards = normal[0] * (eye[0] - point[0]) + normal[1] * (eye[1] - point[1]) + normal[2] * (eye[2] - point[2]);
          expect(towards).toBeLessThanOrEqual(0);
        }
        // Ranges are in order and don't touch (touching ones are merged).
        for (let r = 1; r < n; r++) expect(out[2 * r]).toBeGreaterThan(out[2 * r - 1]);
        const outside = eye.every((e, k) => e < min[k] || e > min[k] + CHUNK_SIZE);
        if (outside) {
          total += quads;
          drawn += included.reduce((s, v) => s + v, 0);
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(drawn / total).toBeLessThan(0.7);
  });
});
