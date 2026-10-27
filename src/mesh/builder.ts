// Growable typed arrays for mesh output. One builder is reused for every chunk a mesher
// makes (no per-vertex allocation, no `number[]` to copy at the end); `build()` copies
// out exactly the used part, which is what gets transferred from a worker.

/** One pass of a chunk mesh. Positions in world space (no transform). */
export interface MeshData {
  /** xyz per vertex. */
  positions: Float32Array;
  /**
   * rgba per vertex, 0–255 (normalised in the shader): face shade and AO baked in. Four
   * bytes rather than three because ANGLE on Direct3D has no 3-byte vertex format and
   * would convert every buffer on the CPU.
   */
  colors: Uint8Array;
  /**
   * Texture coordinates per vertex, 4 bytes: u and v in blocks (0..32, the corner's place on
   * the face within the chunk: the shader repeats the texture every block), the texture
   * array layer, and a spare byte for alignment.
   */
  uvl: Uint8Array;
  /** Uint16 when the mesh has at most 65 536 vertices (almost always). */
  indices: Uint16Array | Uint32Array;
  /**
   * Where each face direction's quads start, in `FACE_ORDER` (+x, +y, +z, -x, -y, -z), then
   * where the quads that face every way start (torches), then the quad count: 8 numbers. A
   * camera can only see the faces of the directions that point towards it, so the renderer
   * draws just those ranges. A mesh made without marking has everything in the last range.
   */
  faceStarts: Uint32Array;
}

/** The order the chunk mesher writes face directions in (direction: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z). The three a camera can see are one range in half the cases. */
export const FACE_ORDER = [0, 2, 4, 1, 3, 5] as const;

export class MeshBuilder {
  private positions = new Float32Array(4096 * 3);
  private colors = new Uint8Array(4096 * 4);
  private uvl = new Uint8Array(4096 * 4);
  private indices = new Uint32Array(4096 * 1.5);
  /** Vertices and indices written since `reset()`. */
  vertexCount = 0;
  indexCount = 0;
  /** Quad counts at each `mark()` since `reset()`. */
  private readonly marks: number[] = [];

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
    this.marks.length = 0;
  }

  /** The next range of `MeshData.faceStarts` starts here (call 7 times: 6 directions, then the rest). */
  mark(): void {
    this.marks.push(this.vertexCount / 4);
  }

  /** Make room for `quads` more quads (4 vertices, 6 indices each). Call before writing them. */
  reserve(quads: number): void {
    const vertices = this.vertexCount + quads * 4;
    if (vertices * 3 > this.positions.length) {
      const capacity = Math.max(vertices, this.positions.length / 3) * 2;
      this.positions = grow(this.positions, capacity * 3);
      this.colors = grow(this.colors, capacity * 4);
      this.uvl = grow(this.uvl, capacity * 4);
      this.indices = grow(this.indices, capacity * 1.5);
    }
  }

  vertex(x: number, y: number, z: number, r: number, g: number, b: number, u = 0, tv = 0, layer = 0): void {
    const v = this.vertexCount++;
    this.uvl[v * 4] = u;
    this.uvl[v * 4 + 1] = tv;
    this.uvl[v * 4 + 2] = layer;
    this.positions[v * 3] = x;
    this.positions[v * 3 + 1] = y;
    this.positions[v * 3 + 2] = z;
    this.colors[v * 4] = r;
    this.colors[v * 4 + 1] = g;
    this.colors[v * 4 + 2] = b;
    this.colors[v * 4 + 3] = 255;
  }

  /**
   * Two triangles over the last four vertices (written counter-clockwise from outside).
   * `flip` splits the quad along 1–3 instead of 0–2.
   */
  quad(flip = false): void {
    const b = this.vertexCount - 4;
    // Flipped, the corners are turned one place (1, 2, 3, 0: still counter-clockwise) so the
    // split is always 0–2. Every quad then has the same indices, 4q + (0, 1, 2, 0, 2, 3), which
    // is what lets chunk pages share one index buffer (`render/chunkPage.ts`).
    if (flip) {
      rotate(this.positions, b, 3);
      rotate(this.colors, b, 4);
      rotate(this.uvl, b, 4);
    }
    const i = this.indexCount;
    const idx = this.indices;
    idx[i] = b; idx[i + 1] = b + 1; idx[i + 2] = b + 2;
    idx[i + 3] = b; idx[i + 4] = b + 2; idx[i + 5] = b + 3;
    this.indexCount += 6;
  }

  /** Copies of the used part, safe to keep or transfer while the builder is reused. */
  build(): MeshData {
    const indices = this.indices.subarray(0, this.indexCount);
    let small: Uint16Array | undefined;
    if (this.vertexCount <= 65536) {
      small = new Uint16Array(indices.length);
      small.set(indices);
    }
    const quads = this.vertexCount / 4;
    const faceStarts = new Uint32Array(8);
    if (this.marks.length === 7) faceStarts.set(this.marks);
    faceStarts[7] = quads;
    return {
      faceStarts,
      positions: this.positions.slice(0, this.vertexCount * 3),
      colors: this.colors.slice(0, this.vertexCount * 4),
      uvl: this.uvl.slice(0, this.vertexCount * 4),
      indices: small ?? indices.slice(),
    };
  }
}

/** Vertices b..b+3 of `a` (`size` values each) moved one place down: b+1, b+2, b+3, b. */
function rotate(a: Float32Array | Uint8Array, b: number, size: number): void {
  const at = b * size;
  for (let c = 0; c < size; c++) {
    const first = a[at + c];
    a[at + c] = a[at + size + c];
    a[at + size + c] = a[at + 2 * size + c];
    a[at + 2 * size + c] = a[at + 3 * size + c];
    a[at + 3 * size + c] = first;
  }
}

function grow<T extends Float32Array | Uint8Array | Uint32Array>(a: T, length: number): T {
  const out = new (a.constructor as new (length: number) => T)(length);
  out.set(a);
  return out;
}
