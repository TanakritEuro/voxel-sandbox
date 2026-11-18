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
import { ALL_GROUPS, FACE_STARTS, GROUPS, type MeshData, PARTS } from '../mesh/builder';
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
  /** `MeshData.faceStarts`: where each group's face directions' quads start, from `start`. */
  readonly faces: Uint32Array;
  /** Reached by the visibility walk (`ChunkRenderer.show`). */
  visible: boolean;
  /** The groups of it to draw (bit g for group g). */
  groups: number;
  /**
   * Its draw ranges (`drawRanges`) for the groups and parts they were last worked out for (`rangesFor`:
   * parts | groups << PARTS), kept: they change only when the camera crosses one of the chunk's
   * planes or the walk changes what to draw.
   */
  rangesFor: number;
  ranges: Int32Array;
}
/** Every part (direction) of a group: for the blended pass, seen from both sides. */
export const ALL_PARTS = (1 << PARTS) - 1;

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
 * The parts (`MeshData.faceStarts`) of a chunk spanning `size` blocks from (minX, minY, minZ) a
 * camera at (ex, ey, ez) could see: bit k for part k.
 *
 * A +x face lies on a plane x = p with p > minX, and is seen only from x > p; so with the eye at
 * x <= minX no +x face of the chunk can be seen. The same goes for the other directions. The
 * last part (torches) faces every way and is always drawn. From outside the chunk on all
 * three axes that leaves three directions of six.
 */
export function facing(minX: number, minY: number, minZ: number, size: number, ex: number, ey: number, ez: number): number {
  // In FACE_ORDER: +x, +y, +z, -x, -y, -z, then every way.
  return (
    (ex > minX ? 1 : 0) |
    (ey > minY ? 2 : 0) |
    (ez > minZ ? 4 : 0) |
    (ex < minX + size ? 8 : 0) |
    (ey < minY + size ? 16 : 0) |
    (ez < minZ + size ? 32 : 0) |
    64
  );
}

/**
 * The quads of a chunk mesh in `groups` (bit g) and `parts` (bit k), into `out` as [first quad,
 * end quad) pairs, touching ones merged (empty parts don't part them); returns how many. `faces`
 * is `MeshData.faceStarts`. At most `MAX_RANGES`.
 */
export function drawRanges(faces: Uint32Array, groups: number, parts: number, out: Int32Array): number {
  let n = 0;
  let from = -1;
  for (let g = 0; g < GROUPS; g++) {
    const base = g * PARTS;
    if (faces[base] === faces[base + PARTS]) continue;
    const drawn = groups & (1 << g) ? parts : 0;
    for (let k = 0; k < PARTS; k++) {
      const lo = faces[base + k];
      if (faces[base + k + 1] === lo) continue;
      if (drawn & (1 << k)) {
        if (from < 0) from = lo;
      } else if (from >= 0) {
        out[n++] = from;
        out[n++] = lo;
        from = -1;
      }
    }
  }
  if (from >= 0) {
    out[n++] = from;
    out[n++] = faces[FACE_STARTS - 1];
  }
  return n / 2;
}

/** `drawRanges` of every group, the parts a camera at (ex, ey, ez) could see (`facing`). */
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
  return drawRanges(faces, ALL_GROUPS, facing(minX, minY, minZ, size, ex, ey, ez), out);
}

/** At most this many ranges come out of `drawRanges`: drawn and left out alternating, part by part. */
export const MAX_RANGES = Math.ceil((GROUPS * PARTS) / 2);

const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const eye = new THREE.Vector3();
/** Half a chunk: from its centre to its faces. */
const HALF = 16;
/** Radius of the sphere around a chunk cube. */
const CHUNK_RADIUS = HALF * Math.sqrt(3);
const sphere = new THREE.Sphere(new THREE.Vector3(), CHUNK_RADIUS);
const ranges = new Int32Array(2 * MAX_RANGES);
const NO_RANGES = new Int32Array(0);

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
    const entry: PageEntry = { page: this, start, quads, centre, faces: data.faceStarts, visible: true, groups: ALL_GROUPS, rangesFor: -1, ranges: NO_RANGES };
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
    let starts = b._multiDrawStarts;
    let counts = b._multiDrawCounts;
    let n = 0;
    for (const e of drawn) {
      // The blended pass is seen from both sides (the water's surface from below): every direction.
      const c = e.centre;
      const parts = this.blended ? ALL_PARTS : facing(c.x - HALF, c.y - HALF, c.z - HALF, 2 * HALF, eye.x, eye.y, eye.z);
      const key = parts | (e.groups << PARTS);
      if (e.rangesFor !== key) {
        const n = drawRanges(e.faces, e.groups, parts, ranges);
        e.ranges = ranges.slice(0, 2 * n);
        e.rangesFor = key;
      }
      const found = e.ranges.length / 2;
      const own = e.ranges;
      if (n + found > starts.length) {
        const size = Math.max(n + found, starts.length * 2);
        starts = grown(starts, size);
        counts = grown(counts, size);
        b._multiDrawStarts = starts;
        b._multiDrawCounts = counts;
      }
      for (let r = 0; r < found; r++) {
        starts[n] = (e.start + own[2 * r]) * 6 * bytes; // bytes into the index buffer
        counts[n++] = (own[2 * r + 1] - own[2 * r]) * 6;
      }
    }
    b._multiDrawCount = n;
  }
}

/** A longer copy of `a`. */
function grown(a: Int32Array, length: number): Int32Array {
  const out = new Int32Array(length);
  out.set(a);
  return out;
}

/** `src` into `attr` from element `at`, uploaded with the next draw (just that range). */
function write(attr: THREE.BufferAttribute, src: Float32Array | Uint8Array, at: number): void {
  (attr.array as Float32Array | Uint8Array).set(src, at);
  attr.addUpdateRange(at, src.length);
  attr.needsUpdate = true;
}
