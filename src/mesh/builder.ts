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
}

export class MeshBuilder {
  private positions = new Float32Array(4096 * 3);
  private colors = new Uint8Array(4096 * 4);
  private uvl = new Uint8Array(4096 * 4);
  private indices = new Uint32Array(4096 * 1.5);
  /** Vertices and indices written since `reset()`. */
  vertexCount = 0;
  indexCount = 0;

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
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
    const i = this.indexCount;
    const idx = this.indices;
    if (flip) {
      idx[i] = b + 1; idx[i + 1] = b + 2; idx[i + 2] = b + 3;
      idx[i + 3] = b + 1; idx[i + 4] = b + 3; idx[i + 5] = b;
    } else {
      idx[i] = b; idx[i + 1] = b + 1; idx[i + 2] = b + 2;
      idx[i + 3] = b; idx[i + 4] = b + 2; idx[i + 5] = b + 3;
    }
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
    return {
      positions: this.positions.slice(0, this.vertexCount * 3),
      colors: this.colors.slice(0, this.vertexCount * 4),
      uvl: this.uvl.slice(0, this.vertexCount * 4),
      indices: small ?? indices.slice(),
    };
  }
}

function grow<T extends Float32Array | Uint8Array | Uint32Array>(a: T, length: number): T {
  const out = new (a.constructor as new (length: number) => T)(length);
  out.set(a);
  return out;
}
