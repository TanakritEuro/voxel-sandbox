// Chunk meshing: turns a chunk's blocks into vertex arrays. Pure (no Three.js) and works on
// a padded copy of the blocks, so it can move into a Web Worker unchanged (Milestone 1).
//
// Scaffold mesher: "culled faces" — one quad per block face that touches air or a different
// see-through block. Simple and correct, but makes far more triangles than needed;
// Milestone 1 replaces it with greedy meshing plus ambient occlusion.

import { hash3 } from '../math';
import { Block, BLOCKS } from '../world/blocks';
import { CHUNK_SIZE } from '../world/coords';
import type { World } from '../world/world';

export interface MeshData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMesh {
  opaque: MeshData;
  transparent: MeshData;
  /** Number of quads, for stats. */
  quads: number;
}

const S = CHUNK_SIZE;
const P = S + 2; // padded size: one block of the neighbours on every side

/** Copy a chunk's blocks plus a one-block border from its neighbours (air where unloaded). */
export function paddedBlocks(world: World, cx: number, cy: number, cz: number): Uint8Array {
  const out = new Uint8Array(P * P * P);
  const chunk = world.getChunk(cx, cy, cz);
  const x0 = cx * S - 1;
  const y0 = cy * S - 1;
  const z0 = cz * S - 1;
  for (let y = 0; y < P; y++) {
    for (let z = 0; z < P; z++) {
      for (let x = 0; x < P; x++) {
        const inside = x > 0 && x <= S && y > 0 && y <= S && z > 0 && z <= S;
        out[(y * P + z) * P + x] =
          inside && chunk ? chunk.blocks[((y - 1) * S + (z - 1)) * S + (x - 1)] : world.getBlock(x0 + x, y0 + y, z0 + z);
      }
    }
  }
  return out;
}

interface Face {
  /** Neighbour offset (also the normal). */
  d: [number, number, number];
  /** Corners of the unit quad, counter-clockwise seen from outside. */
  corners: [number, number, number][];
  /** Which colour of the block to use. */
  colour: 'top' | 'side' | 'bottom';
  /** Baked directional shading (the classic voxel look, no lights needed). */
  shade: number;
}

const FACES: Face[] = [
  { d: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], colour: 'side', shade: 0.8 },
  { d: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], colour: 'side', shade: 0.8 },
  { d: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], colour: 'top', shade: 1.0 },
  { d: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], colour: 'bottom', shade: 0.55 },
  { d: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], colour: 'side', shade: 0.68 },
  { d: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], colour: 'side', shade: 0.68 },
];

/** Should the face of block `a` towards neighbour `b` be drawn? */
function faceVisible(a: Block, b: Block): boolean {
  if (b === Block.Air) return true;
  return !BLOCKS[b].opaque && b !== a;
}

class Builder {
  positions: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  quad(x: number, y: number, z: number, face: Face, rgb: [number, number, number]): void {
    const base = this.positions.length / 3;
    for (const [cx, cy, cz] of face.corners) {
      this.positions.push(x + cx, y + cy, z + cz);
      this.colors.push(rgb[0], rgb[1], rgb[2]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): MeshData {
    return { positions: new Float32Array(this.positions), colors: new Float32Array(this.colors), indices: new Uint32Array(this.indices) };
  }
}

/**
 * Mesh one chunk from its padded blocks. Positions are in world coordinates (chunk origin
 * added), so the mesh needs no transform.
 */
export function meshChunk(padded: Uint8Array, cx: number, cy: number, cz: number): ChunkMesh {
  const opaque = new Builder();
  const transparent = new Builder();
  const x0 = cx * S;
  const y0 = cy * S;
  const z0 = cz * S;
  let quads = 0;
  const at = (x: number, y: number, z: number) => padded[(y * P + z) * P + x] as Block;

  for (let y = 1; y <= S; y++) {
    for (let z = 1; z <= S; z++) {
      for (let x = 1; x <= S; x++) {
        const b = at(x, y, z);
        if (b === Block.Air) continue;
        const info = BLOCKS[b];
        const out = info.transparent ? transparent : opaque;
        const wx = x0 + x - 1;
        const wy = y0 + y - 1;
        const wz = z0 + z - 1;
        // A little per-block brightness noise, so flat areas don't look like plastic.
        const jitter = 0.94 + 0.06 * hash3(7, wx, wy, wz);
        for (const face of FACES) {
          if (!faceVisible(b, at(x + face.d[0], y + face.d[1], z + face.d[2]))) continue;
          const c = info[face.colour];
          const k = face.shade * jitter;
          out.quad(wx, wy, wz, face, [c[0] * k, c[1] * k, c[2] * k]);
          quads++;
        }
      }
    }
  }
  return { opaque: opaque.build(), transparent: transparent.build(), quads };
}
