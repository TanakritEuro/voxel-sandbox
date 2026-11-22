// Growable typed arrays for mesh output. One builder is reused for every chunk a mesher
// makes (no per-vertex allocation, no `number[]` to copy at the end); `build()` copies
// out exactly the used part, which is what gets transferred from a worker.
//
// Quads come out sorted by group (the open region of the chunk each is seen from, or the face of
// the chunk its open side is across: `world/visibility.ts`), then by part (face direction), so
// the renderer can draw just the groups the visibility walk reached, and of them just the
// directions that can face the camera.

const MAX_REGIONS = 12;

/** Groups a chunk mesh's quads are sorted by: its regions, then a border group per face of the chunk (-x, +x, -y, +y, -z, +z). */
export const GROUPS = MAX_REGIONS + 6;
/** Every group of a mesh (bit g for group g). */
export const ALL_GROUPS = (1 << GROUPS) - 1;
/** The first border group: face f's is BORDER_GROUP + f (`visibility.ts` order). */
export const BORDER_GROUP = MAX_REGIONS;
/** Parts within a group: the 6 face directions in `FACE_ORDER`, then quads that face every way. */
export const PARTS = 7;
/** Length of `MeshData.faceStarts`. */
export const FACE_STARTS = GROUPS * PARTS + 1;

/** One pass of a chunk mesh. Positions in world space (no transform). */
export interface MeshData {
  /** xyz per vertex. */
  positions: Float32Array;
  /**
   * rgba per vertex, 0–255 (normalised in the shader): face shade and AO baked in. Four
   * bytes rather than three because ANGLE on Direct3D has no 3-byte vertex format and
   * would convert every buffer on the CPU. The fourth says whether the quad is a level top
   * facing up, for weather on the ground: then the blocks across a cell of the mesh's detail
   * (`topCell`: 1, 2 or 4); else 255.
   */
  colors: Uint8Array;
  /**
   * Texture coordinates per vertex, 4 bytes: u and v in blocks (0..32, the corner's place on
   * the face within the chunk: the shader repeats the texture every block), the texture
   * array layer, and eighths of a block added: to v in the low 3 bits (water sides end at a depth
   * in eighths), to u in the 3 above (a stair's half-width faces).
   */
  uvl: Uint8Array;
  /** Uint16 when the mesh has at most 65 536 vertices (almost always). */
  indices: Uint16Array | Uint32Array;
  /**
   * Where each group's parts start: group g's part k at g * PARTS + k, then the quad count
   * (`FACE_STARTS` numbers). Parts are the face directions in `FACE_ORDER` (+x, +y, +z, -x, -y,
   * -z), then the quads that face every way (torches and other shapes, flowing water). A camera can
   * only see the faces of the directions that point towards it, so the renderer draws just those
   * ranges, of the groups that could be seen. A mesh made without marking has everything in group
   * 0's last part.
   */
  faceStarts: Uint32Array;
}

/** The order the chunk mesher writes face directions in (direction: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z). The three a camera can see are one range in half the cases. */
export const FACE_ORDER = [0, 2, 4, 1, 3, 5] as const;

export class MeshBuilder {
  private positions = new Float32Array(4096 * 3);
  private colors = new Uint8Array(4096 * 4);
  private uvl = new Uint8Array(4096 * 4);
  /** Each quad's group. */
  private groups = new Uint8Array(1024);
  /** Each quad's place in the sorted order (group * PARTS + part), worked out in `build`. */
  private keys = new Uint16Array(1024);
  private readonly counts = new Uint32Array(FACE_STARTS);
  /** Vertices written since `reset()`. */
  vertexCount = 0;
  /** The group the next quads go in. */
  group = 0;
  /** The cell the mesh's detail works in, in blocks: what the next level tops are marked with. */
  topCell = 1;
  /** Quad counts at each `mark()` since `reset()`. */
  private readonly marks: number[] = [];

  reset(): void {
    this.vertexCount = 0;
    this.group = 0;
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
    }
    if (vertices / 4 > this.groups.length) {
      this.groups = grow(this.groups, (vertices / 4) * 2);
      this.keys = new Uint16Array(this.groups.length);
    }
  }

  vertex(x: number, y: number, z: number, r: number, g: number, b: number, u = 0, tv = 0, layer = 0, eighths = 0): void {
    const v = this.vertexCount++;
    this.uvl[v * 4] = u;
    this.uvl[v * 4 + 1] = tv;
    this.uvl[v * 4 + 2] = layer;
    this.uvl[v * 4 + 3] = eighths;
    this.positions[v * 3] = x;
    this.positions[v * 3 + 1] = y;
    this.positions[v * 3 + 2] = z;
    this.colors[v * 4] = r;
    this.colors[v * 4 + 1] = g;
    this.colors[v * 4 + 2] = b;
    this.colors[v * 4 + 3] = 255;
  }

  /**
   * Two triangles over the last four vertices (written counter-clockwise from outside), in group
   * `this.group`. `flip` splits the quad along 1–3 instead of 0–2.
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
    this.groups[b >> 2] = this.group;
    // Level, and wound to be seen from above: a top, which weather can fall on.
    const p = this.positions;
    const a = b * 3;
    const y = p[a + 1];
    if (p[a + 4] !== y || p[a + 7] !== y || p[a + 10] !== y) return;
    if ((p[a + 5] - p[a + 2]) * (p[a + 6] - p[a]) <= (p[a + 3] - p[a]) * (p[a + 8] - p[a + 2])) return;
    for (let k = b * 4 + 3; k < b * 4 + 16; k += 4) this.colors[k] = this.topCell;
  }

  /** Copies of the used part, sorted by group then part, safe to keep or transfer while the builder is reused. */
  build(): MeshData {
    const quads = this.vertexCount / 4;
    const marks = this.marks;
    const marked = marks.length === PARTS;
    const groups = this.groups;
    const keys = this.keys;
    const counts = this.counts;
    counts.fill(0);
    // Each quad's part from the marks (all in the last part without them), and whether the
    // quads are in order already (all in one group: far chunks, held blocks).
    let part = marked ? 0 : PARTS - 1;
    let sorted = true;
    let last = 0;
    for (let q = 0; q < quads; q++) {
      while (part < PARTS - 1 && q >= marks[part + 1]) part++;
      const key = groups[q] * PARTS + part;
      keys[q] = key;
      counts[key]++;
      if (key < last) sorted = false;
      last = key;
    }
    const faceStarts = new Uint32Array(FACE_STARTS);
    for (let k = 0; k < FACE_STARTS - 1; k++) faceStarts[k + 1] = faceStarts[k] + counts[k];

    let positions: Float32Array;
    let colors: Uint8Array;
    let uvl: Uint8Array;
    if (sorted) {
      positions = this.positions.slice(0, quads * 12);
      colors = this.colors.slice(0, quads * 16);
      uvl = this.uvl.slice(0, quads * 16);
    } else {
      positions = new Float32Array(quads * 12);
      colors = new Uint8Array(quads * 16);
      uvl = new Uint8Array(quads * 16);
      const next = counts; // reused: where the next quad of each key goes
      next.set(faceStarts.subarray(0, FACE_STARTS - 1));
      const sp = this.positions;
      const sc = this.colors;
      const su = this.uvl;
      for (let q = 0; q < quads; q++) {
        const to = next[keys[q]]++;
        for (let k = 0; k < 12; k++) positions[to * 12 + k] = sp[q * 12 + k];
        for (let k = 0; k < 16; k++) {
          colors[to * 16 + k] = sc[q * 16 + k];
          uvl[to * 16 + k] = su[q * 16 + k];
        }
      }
    }
    const indices = this.vertexCount <= 65536 ? new Uint16Array(quads * 6) : new Uint32Array(quads * 6);
    for (let q = 0, i = 0; q < quads; q++, i += 6) {
      const b = q * 4;
      indices[i] = b;
      indices[i + 1] = b + 1;
      indices[i + 2] = b + 2;
      indices[i + 3] = b;
      indices[i + 4] = b + 2;
      indices[i + 5] = b + 3;
    }
    return { faceStarts, positions, colors, uvl, indices };
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

function grow<T extends Float32Array | Uint8Array | Uint16Array | Uint32Array>(a: T, length: number): T {
  const out = new (a.constructor as new (length: number) => T)(length);
  out.set(a);
  return out;
}
