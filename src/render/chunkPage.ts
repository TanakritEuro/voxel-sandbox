// A page of chunk meshes: one big vertex buffer that many chunks' meshes share, drawn with
// one multi-draw call (WEBGL_multi_draw) instead of one draw call per chunk. Three.js handling
// a thousand meshes a frame cost most of the main thread at view distance 16.
//
// It is a `THREE.BatchedMesh` only for the renderer's multi-draw path: the batch's own geometry
// bookkeeping (which never reuses freed space without moving everything) is replaced by a
// `PageAllocator` in quads, and the draw list is built here each frame from the chunks that
// are visible and in the frustum. Every quad has the same indices (`MeshBuilder.quad`), so all
// pages share one index buffer and nothing but vertices is ever uploaded.

import * as THREE from 'three';
import type { MeshData } from '../mesh/builder';
import { PageAllocator } from './pageAllocator';

/** BatchedMesh's own fields this class takes over (they aren't in its typings). */
interface BatchInternals {
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _geometryInitialized: boolean;
}

/** One chunk pass's place in a page. */
export interface PageEntry {
  readonly page: ChunkPage;
  readonly start: number;
  readonly quads: number;
  /** Centre of the chunk, for frustum culling and sorting. */
  readonly centre: THREE.Vector3;
  /** `MeshData.faceStarts`: where each face direction's quads start, from `start`. */
  readonly faces: Uint32Array;
  /** Reached by the visibility walk (`ChunkRenderer.setVisible`). */
  visible: boolean;
}

/** Bytes of vertex data per quad: 4 vertices of position (12), colour (4) and uvl (4). */
export const BYTES_PER_QUAD = 4 * (12 + 4 + 4);

/**
 * Shared index buffers by page size: 4q + (0, 1, 2, 0, 2, 3) for every quad q. 16-bit when the
 * page has at most 65 536 vertices, which halves what the GPU reads for indices.
 */
const indexBuffers = new Map<number, THREE.BufferAttribute>();

function pageIndex(quads: number): THREE.BufferAttribute {
  let index = indexBuffers.get(quads);
  if (!index) {
    const a = quads * 4 <= 65536 ? new Uint16Array(quads * 6) : new Uint32Array(quads * 6);
    for (let q = 0, i = 0; q < quads; q++, i += 6) {
      const b = q * 4;
      a[i] = b;
      a[i + 1] = b + 1;
      a[i + 2] = b + 2;
      a[i + 3] = b;
      a[i + 4] = b + 2;
      a[i + 5] = b + 3;
    }
    index = new THREE.BufferAttribute(a, 1);
    indexBuffers.set(quads, index);
  }
  return index;
}

/**
 * The parts of a chunk mesh a camera at (ex, ey, ez) could see, into `out` as [first quad,
 * end quad) pairs, touching ones merged; returns how many. `faces` is `MeshData.faceStarts`
 * and the chunk spans `size` blocks from (minX, minY, minZ).
 *
 * A +x face lies on a plane x = p with p > minX, and is seen only from x > p; so with the eye at
 * x <= minX no +x face of the chunk can be seen. The same goes for the other directions. The
 * last range (torches) faces every way and is always drawn. From outside the chunk on all
 * three axes that leaves three directions of six.
 */
export function faceRanges(
  faces: Uint32Array,
  minX: number,
  minY: number,
  minZ: number,
  size: number,
  ex: number,
  ey: number,
  ez: number,
  out: Int32Array,
): number {
  // In FACE_ORDER: +x, +y, +z, -x, -y, -z, then every way.
  let n = 0;
  let from = -1;
  for (let k = 0; k < 7; k++) {
    const lo = faces[k];
    const hi = faces[k + 1];
    // An empty range doesn't break a run.
    const seen =
      k === 0 ? ex > minX : k === 1 ? ey > minY : k === 2 ? ez > minZ : k === 3 ? ex < minX + size : k === 4 ? ey < minY + size : k === 5 ? ez < minZ + size : true;
    if (seen || hi === lo) {
      if (from < 0) from = lo;
    } else {
      if (from >= 0 && lo > from) {
        out[n++] = from;
        out[n++] = lo;
      }
      from = -1;
    }
  }
  if (from >= 0 && faces[7] > from) {
    out[n++] = from;
    out[n++] = faces[7];
  }
  return n / 2;
}

const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const eye = new THREE.Vector3();
/** Half a chunk: from its centre to its faces. */
const HALF = 16;
/** Radius of the sphere around a chunk cube. */
const CHUNK_RADIUS = HALF * Math.sqrt(3);
const sphere = new THREE.Sphere(new THREE.Vector3(), CHUNK_RADIUS);
/** At most 4 ranges come out of `faceRanges` (7 parts, alternating). */
const ranges = new Int32Array(8);

export class ChunkPage extends THREE.BatchedMesh {
  readonly space: PageAllocator;
  private readonly entries = new Set<PageEntry>();
  private readonly positions: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly uvl: THREE.BufferAttribute;
  /** Reused for sorting back to front. */
  private readonly drawn: PageEntry[] = [];
  private readonly distance = new Map<PageEntry, number>();

  /**
   * `blended` for the pass of water and glass: drawn farthest first, and every direction of
   * it, since it is seen from both sides (the water's surface from below).
   */
  constructor(
    readonly quads: number,
    material: THREE.Material,
    private readonly blended: boolean,
  ) {
    super(1, quads * 4, quads * 6, material);
    this.space = new PageAllocator(quads);
    this.positions = new THREE.BufferAttribute(new Float32Array(quads * 4 * 3), 3);
    this.colors = new THREE.BufferAttribute(new Uint8Array(quads * 4 * 4), 4, true);
    this.uvl = new THREE.BufferAttribute(new Uint8Array(quads * 4 * 4), 4);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('color', this.colors);
    this.geometry.setAttribute('uvl', this.uvl);
    this.geometry.setIndex(pageIndex(quads));
    this.internals._geometryInitialized = true;
    // Culled per chunk here; the page as a whole spans the world.
    this.frustumCulled = false;
    this.perObjectFrustumCulled = false;
    this.sortObjects = false;
    this.matrixAutoUpdate = false; // positions are in world space
  }

  private get internals(): BatchInternals {
    return this as unknown as BatchInternals;
  }

  /** Chunk passes in the page. */
  get size(): number {
    return this.entries.size;
  }

  /** Copy a mesher pass in; null if the page has no free range long enough. */
  addMesh(data: MeshData, centre: THREE.Vector3): PageEntry | null {
    const quads = data.positions.length / 12;
    const start = this.space.alloc(quads);
    if (start < 0) return null;
    const v = start * 4;
    write(this.positions, data.positions, v * 3);
    write(this.colors, data.colors, v * 4);
    write(this.uvl, data.uvl, v * 4);
    const entry: PageEntry = { page: this, start, quads, centre, faces: data.faceStarts, visible: true };
    this.entries.add(entry);
    return entry;
  }

  removeMesh(entry: PageEntry): void {
    if (!this.entries.delete(entry)) return;
    this.space.release(entry.start, entry.quads);
  }

  /** Before Three.js draws the page: the visible chunks in the frustum, as multi-draw ranges. */
  override onBeforeRender(_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, camera: THREE.Camera): void {
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    const drawn = this.drawn;
    drawn.length = 0;
    for (const e of this.entries) {
      if (!e.visible) continue;
      sphere.center.copy(e.centre);
      if (frustum.intersectsSphere(sphere)) drawn.push(e);
    }
    eye.setFromMatrixPosition(camera.matrixWorld);
    if (this.blended) {
      const distance = this.distance;
      distance.clear();
      for (const e of drawn) distance.set(e, e.centre.distanceToSquared(eye));
      drawn.sort((a, b) => distance.get(b)! - distance.get(a)!);
    }
    const b = this.internals;
    const bytes = this.geometry.index!.array.BYTES_PER_ELEMENT;
    if (b._multiDrawStarts.length < drawn.length * 4) {
      const n = Math.max(drawn.length * 4, b._multiDrawStarts.length * 2);
      b._multiDrawStarts = new Int32Array(n);
      b._multiDrawCounts = new Int32Array(n);
    }
    const starts = b._multiDrawStarts;
    const counts = b._multiDrawCounts;
    let n = 0;
    for (const e of drawn) {
      if (this.blended) {
        starts[n] = e.start * 6 * bytes; // bytes into the index buffer
        counts[n++] = e.quads * 6;
        continue;
      }
      const c = e.centre;
      const parts = faceRanges(e.faces, c.x - HALF, c.y - HALF, c.z - HALF, 2 * HALF, eye.x, eye.y, eye.z, ranges);
      for (let r = 0; r < parts; r++) {
        starts[n] = (e.start + ranges[2 * r]) * 6 * bytes;
        counts[n++] = (ranges[2 * r + 1] - ranges[2 * r]) * 6;
      }
    }
    b._multiDrawCount = n;
  }
}

/** `src` into `attr` from element `at`, uploaded with the next draw (just that range). */
function write(attr: THREE.BufferAttribute, src: Float32Array | Uint8Array, at: number): void {
  (attr.array as Float32Array | Uint8Array).set(src, at);
  attr.addUpdateRange(at, src.length);
  attr.needsUpdate = true;
}
