// The scaffold's mesher, kept as a reference: "culled faces", one quad per block face that
// touches air or a different see-through block. Tests check the greedy mesher draws exactly
// these faces, and the bench compares the two. Not used by the game.

import { hash3 } from '../math';
import { Block, BLOCKS } from '../world/blocks';
import { CHUNK_SIZE } from '../world/coords';
import { MeshBuilder } from './builder';
import type { ChunkMesh } from './mesher';
import { PADDED } from './padding';

// Local copies: imported bindings can cost a lookup each time in the hot loop (they do under Vitest).
const S = CHUNK_SIZE;
const P = PADDED;

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

/** Should the face of block `a` towards neighbour `b` be drawn? (Leaves and other cutouts show against themselves.) */
function faceVisible(a: Block, b: Block): boolean {
  if (b === Block.Air) return true;
  return !BLOCKS[b].opaque && (b !== a || BLOCKS[a].cutout);
}

const opaque = new MeshBuilder();
const transparent = new MeshBuilder();

function quad(out: MeshBuilder, x: number, y: number, z: number, face: Face, r: number, g: number, b: number): void {
  out.reserve(1);
  for (const [cx, cy, cz] of face.corners) out.vertex(x + cx, y + cy, z + cz, r, g, b);
  out.quad();
}

/** Mesh one chunk from its padded blocks, one quad per visible face. */
export function meshCulled(padded: Uint8Array, cx: number, cy: number, cz: number): ChunkMesh {
  opaque.reset();
  transparent.reset();
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
          const k = face.shade * jitter * 255;
          quad(out, wx, wy, wz, face, Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k));
          quads++;
        }
      }
    }
  }
  return { opaque: opaque.build(), transparent: transparent.build(), quads };
}
