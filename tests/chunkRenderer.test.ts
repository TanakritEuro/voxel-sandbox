import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import type { ChunkPage } from '../src/render/chunkPage';
import { ChunkRenderer } from '../src/render/chunkRenderer';
import { World } from '../src/world/world';

const world = new World(20261022);
for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
const meshAt = (cx: number, cy: number, cz: number) => meshChunk(paddedBlocks(world, cx, cy, cz), cx, cy, cz, paddedLight(world, cx, cy, cz));
/** A chunk with ground and water (seed 20261022 has the sea at the origin's south). */
const ground = meshAt(0, 1, 0);
const quadsOf = (m: { positions: Float32Array }) => m.positions.length / 12;

const pagesOf = (r: ChunkRenderer) => r.group.children as ChunkPage[];
type Internals = { _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number };
/** The draw list a page makes for this camera: [first quad, quads] per range. */
function drawList(page: ChunkPage, camera: THREE.PerspectiveCamera): [number, number][] {
  camera.updateMatrixWorld();
  page.onBeforeRender(undefined as never, undefined as never, camera);
  const b = page as unknown as Internals;
  const out: [number, number][] = [];
  for (let i = 0; i < b._multiDrawCount; i++) out.push([b._multiDrawStarts[i] / (6 * page.geometry.index!.array.BYTES_PER_ELEMENT), b._multiDrawCounts[i] / 6]);
  return out;
}

describe('chunk meshes', () => {
  it('give every quad the same indices, so pages can share one index buffer', () => {
    for (const m of [ground.opaque, ground.transparent, meshAt(1, 2, -1).opaque]) {
      for (let q = 0; q < m.indices.length / 6; q++) {
        const b = q * 4;
        expect([...m.indices.subarray(q * 6, q * 6 + 6)]).toEqual([b, b + 1, b + 2, b, b + 2, b + 3]);
      }
    }
  });
});

describe('chunk renderer pages', () => {
  it('copies passes into pages, counts them, and frees their space on remove and remesh', () => {
    const r = new ChunkRenderer(false, 100_000);
    r.set('a', 0, 1, 0, ground);
    const quads = quadsOf(ground.opaque) + quadsOf(ground.transparent);
    expect(r.triangles).toBe(quads * 2);
    expect(r.count).toBe(1);
    // Remeshing replaces: the space is the same as for one copy.
    r.set('a', 0, 1, 0, ground);
    expect(pagesOf(r).reduce((s, p) => s + p.space.used, 0)).toBe(quads);
    expect(r.triangles).toBe(quads * 2);
    r.remove('a');
    expect(r.triangles).toBe(0);
    expect(r.bytes).toBe(0);
    expect(pagesOf(r).every((p) => p.space.used === 0 && p.size === 0)).toBe(true);
  });

  it('opens a new page when one is full, and fills freed space again', () => {
    const q = quadsOf(ground.opaque);
    const solid = { ...ground, transparent: { ...ground.transparent, positions: new Float32Array(0), indices: new Uint16Array(0) } };
    const r = new ChunkRenderer(false, Math.ceil(q * 2.5));
    for (const k of ['a', 'b', 'c']) r.set(k, 0, 1, 0, solid);
    expect(pagesOf(r)).toHaveLength(2); // two fit in the first page
    r.remove('a');
    r.set('d', 0, 1, 0, solid);
    expect(pagesOf(r)).toHaveLength(2); // into a's old place
  });

  it('uses 16-bit indices in small pages, and gives a mesh too big for one a page of its own', () => {
    const q = quadsOf(ground.opaque);
    const r = new ChunkRenderer(false, Math.floor(q / 2));
    r.set('small', 0, 1, 0, { ...ground, opaque: { positions: ground.opaque.positions.subarray(0, 12), colors: ground.opaque.colors.subarray(0, 16), uvl: ground.opaque.uvl.subarray(0, 16), indices: ground.opaque.indices.subarray(0, 6), faceStarts: Uint32Array.of(0, 0, 0, 0, 0, 0, 0, 1) } });
    r.set('big', 0, 1, 0, ground);
    const [small] = pagesOf(r);
    expect(small.geometry.index!.array).toBeInstanceOf(Uint16Array);
    const big = pagesOf(r).find((p) => p.quads === q);
    expect(big?.space.used).toBe(q);
  });

  it('draws the visible chunks in the frustum, and the blended ones farthest first', () => {
    const r = new ChunkRenderer(false, 1_000_000);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
    camera.position.set(16, 120, 16);
    camera.lookAt(16, 0, 16); // straight down on chunk (0, *, 0)
    r.set('here', 0, 1, 0, ground);
    r.set('below', 0, 0, 0, meshAt(0, 0, 0));
    r.set('behind', 0, 1, 40, ground); // far outside the view
    const [opaque, blended] = pagesOf(r);
    const quadsDrawn = () => drawList(opaque, camera).reduce((sum, [, n]) => sum + n, 0);
    // From above, over the chunk: every direction but the undersides (-y), which face away.
    const f = ground.opaque.faceStarts;
    const undersides = f[5] - f[4]; // FACE_ORDER: +x, +y, +z, -x, -y, -z
    const below = meshAt(0, 0, 0).opaque.faceStarts;
    const all = quadsDrawn();
    expect(all).toBe(f[7] - undersides + below[7] - (below[5] - below[4]));
    expect(drawList(opaque, camera).every(([, n]) => n > 0)).toBe(true);
    r.setVisible('below', false);
    expect(quadsDrawn()).toBe(f[7] - undersides);

    // Water in two chunks, both in view: the farther one first.
    r.set('near water', 0, 2, 0, ground);
    const order = drawList(blended, camera);
    expect(order).toHaveLength(2);
    expect(order[0][0]).toBe(0); // 'here' (cy 1) went in first and is farther from the camera above
  });
});
