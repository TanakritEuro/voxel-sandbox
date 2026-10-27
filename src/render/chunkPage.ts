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

const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const eye = new THREE.Vector3();
/** Radius of the sphere around a chunk cube. */
const CHUNK_RADIUS = (32 * Math.sqrt(3)) / 2;
const sphere = new THREE.Sphere(new THREE.Vector3(), CHUNK_RADIUS);

export class ChunkPage extends THREE.BatchedMesh {
  readonly space: PageAllocator;
  private readonly entries = new Set<PageEntry>();
  private readonly positions: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly uvl: THREE.BufferAttribute;
  /** Reused for sorting back to front. */
  private readonly drawn: PageEntry[] = [];
  private readonly distance = new Map<PageEntry, number>();

  /** `backToFront` for blended passes (water, glass): drawn farthest first. */
  constructor(
    readonly quads: number,
    material: THREE.Material,
    private readonly backToFront: boolean,
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
    const entry: PageEntry = { page: this, start, quads, centre, visible: true };
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
    if (this.backToFront) {
      eye.setFromMatrixPosition(camera.matrixWorld);
      const distance = this.distance;
      distance.clear();
      for (const e of drawn) distance.set(e, e.centre.distanceToSquared(eye));
      drawn.sort((a, b) => distance.get(b)! - distance.get(a)!);
    }
    const b = this.internals;
    const bytes = this.geometry.index!.array.BYTES_PER_ELEMENT;
    if (b._multiDrawStarts.length < drawn.length) {
      const n = Math.max(drawn.length, b._multiDrawStarts.length * 2);
      b._multiDrawStarts = new Int32Array(n);
      b._multiDrawCounts = new Int32Array(n);
    }
    for (let i = 0; i < drawn.length; i++) {
      b._multiDrawStarts[i] = drawn[i].start * 6 * bytes; // bytes into the index buffer
      b._multiDrawCounts[i] = drawn[i].quads * 6;
    }
    b._multiDrawCount = drawn.length;
  }
}

/** `src` into `attr` from element `at`, uploaded with the next draw (just that range). */
function write(attr: THREE.BufferAttribute, src: Float32Array | Uint8Array, at: number): void {
  (attr.array as Float32Array | Uint8Array).set(src, at);
  attr.addUpdateRange(at, src.length);
  attr.needsUpdate = true;
}
