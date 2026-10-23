// Chunk meshing: turns a chunk's blocks into vertex arrays. Pure (no Three.js) and works on
// a padded copy of the blocks, so it runs the same in a Web Worker.
//
// Greedy meshing with per-vertex ambient occlusion (0fps.net, "Meshing in a Minecraft game"
// and "Ambient occlusion for Minecraft-like worlds"). For each of the six face directions
// and each of the 32 slices across it, a 32 × 32 mask records the visible faces as
// block id + the AO level of their four corners. Runs of equal mask cells are merged into
// rectangles, widest first then tallest, so faces merge only when block and AO match.
// The key also holds the light of the block the face looks at (`light.ts`), so faces merge only
// where it is the same. The block's texture follows from the block and the face direction, so
// it needs no place in the key. Each vertex carries texture coordinates in blocks (the shader
// repeats the texture across a merged quad) and its layer. Its colour holds directional shade
// × AO in red, multiplied with the texture, and sunlight and block light in green and blue.

import { TUNING } from '../config';
import { Block, BLOCKS } from '../world/blocks';
import { CHUNK_SIZE } from '../world/coords';
import { textureLayer } from '../world/textures';
import { MeshBuilder, type MeshData } from './builder';
import { ALL_SUNLIT, PADDED } from './padding';

export interface ChunkMesh {
  opaque: MeshData;
  transparent: MeshData;
  /** Number of quads, for stats. */
  quads: number;
}

// Local copies: imported bindings can cost a lookup each time in the hot loop (they do under Vitest).
const S = CHUNK_SIZE;
const P = PADDED;
const AIR = Block.Air;
/** Padded-array stride along x, y and z. */
const STRIDE = [1, P * P, P];

/** Baked directional shading per direction (+x, -x, +y, -y, +z, -z): the classic voxel look, no lights needed. */
export const SHADE = [0.8, 0.8, 1.0, 0.55, 0.68, 0.68];

// Per block id: opaque (hides the faces next to it and darkens corners), drawn in the
// transparent pass, drawn with holes (faces against the same block shown too).
const OPAQUE = new Uint8Array(256);
const TRANSPARENT = new Uint8Array(256);
const CUTOUT = new Uint8Array(256);
/** Texture array layer by block and direction: LAYER[block * 6 + dir]. */
const LAYER = new Uint8Array(256 * 6);
BLOCKS.forEach((info, b) => {
  OPAQUE[b] = info.opaque ? 1 : 0;
  TRANSPARENT[b] = info.transparent ? 1 : 0;
  CUTOUT[b] = info.cutout ? 1 : 0;
  for (let dir = 0; dir < 6; dir++) LAYER[b * 6 + dir] = textureLayer(dir === 2 ? info.textures.top : dir === 3 ? info.textures.bottom : info.textures.side);
});
/** Vertex brightness 0–255 by direction and AO level: SHADED[dir * 4 + ao]. */
const SHADED = new Uint8Array(6 * 4);
for (let dir = 0; dir < 6; dir++) for (let ao = 0; ao < 4; ao++) SHADED[dir * 4 + ao] = Math.round(SHADE[dir] * TUNING.render.ao[ao] * 255);

/** AO level of a face corner from the two blocks beside it and the one diagonally between them (each 0 or 1). */
const vertexAO = (side1: number, side2: number, corner: number): number => (side1 && side2 ? 0 : 3 - side1 - side2 - corner);

/** Every corner unoccluded: transparent faces (water, glass) get no AO, so they stay flat and merge freely. */
const NO_AO = 0xff;

// Reused for every chunk (one set per thread).
const opaque = new MeshBuilder();
const transparent = new MeshBuilder();
const mask = new Int32Array(S * S);
const pos = new Float64Array(3);

/**
 * Mesh one chunk from its padded blocks and light. Positions are in world coordinates (chunk
 * origin added), so the mesh needs no transform. Each quad is four consecutive vertices,
 * counter-clockwise seen from outside. Without `light`, everything is in full sun.
 */
export function meshChunk(padded: Uint8Array, cx: number, cy: number, cz: number, light: Uint8Array = ALL_SUNLIT): ChunkMesh {
  opaque.reset();
  transparent.reset();
  const origin = [cx * S, cy * S, cz * S];
  let quads = 0;

  for (let dir = 0; dir < 6; dir++) {
    const d = dir >> 1; // the axis the faces point along
    const s = dir & 1 ? -1 : 1;
    // In-plane axes, ordered so that u × v points along the face normal: corners in the order
    // (u0, v0), (u1, v0), (u1, v1), (u0, v1) are then counter-clockwise seen from outside.
    const ua = s > 0 ? (d + 1) % 3 : (d + 2) % 3;
    const va = s > 0 ? (d + 2) % 3 : (d + 1) % 3;
    const sd = STRIDE[d];
    const su = STRIDE[ua];
    const sv = STRIDE[va];
    const towards = s * sd; // the neighbour the face looks at
    // Texture axes: on the sides u runs along the other horizontal axis and v up, on top
    // and bottom u along x and v along z, so textures stand upright on walls.
    const tu = d === 0 ? 2 : 0;
    const tv = d === 1 ? 2 : 1;

    for (let c = 0; c < S; c++) {
      // The mask: block id | AO of corners 0–3 (2 bits each) << 8 | light in front << 16, or 0 for no face.
      let any = false;
      for (let v = 0; v < S; v++) {
        let i = (c + 1) * sd + (v + 1) * sv + su; // padded index at u = 0
        for (let u = 0; u < S; u++, i += su) {
          const b = padded[i];
          let key = 0;
          if (b !== AIR) {
            const f = i + towards;
            const nb = padded[f];
            if (nb === AIR || (!OPAQUE[nb] && (nb !== b || CUTOUT[b]))) {
              if (TRANSPARENT[b]) key = b | (NO_AO << 8) | (light[f] << 16);
              else {
                // Corners 0–3 are at (-u, -v), (+u, -v), (+u, +v), (-u, +v), in the layer the face looks at.
                const l = OPAQUE[padded[f - su]];
                const r = OPAQUE[padded[f + su]];
                const dn = OPAQUE[padded[f - sv]];
                const up = OPAQUE[padded[f + sv]];
                const ao =
                  vertexAO(l, dn, OPAQUE[padded[f - su - sv]]) |
                  (vertexAO(r, dn, OPAQUE[padded[f + su - sv]]) << 2) |
                  (vertexAO(r, up, OPAQUE[padded[f + su + sv]]) << 4) |
                  (vertexAO(l, up, OPAQUE[padded[f - su + sv]]) << 6);
                key = b | (ao << 8) | (light[f] << 16);
              }
              any = true;
            }
          }
          mask[v * S + u] = key;
        }
      }
      if (!any) continue;

      // Greedy: take each unvisited face, extend it along u, then along v while whole rows match.
      const plane = origin[d] + c + (s > 0 ? 1 : 0);
      for (let v = 0; v < S; v++) {
        for (let u = 0; u < S; ) {
          const key = mask[v * S + u];
          if (key === 0) {
            u++;
            continue;
          }
          let w = 1;
          while (u + w < S && mask[v * S + u + w] === key) w++;
          let h = 1;
          grow: while (v + h < S) {
            for (let k = 0; k < w; k++) if (mask[(v + h) * S + u + k] !== key) break grow;
            h++;
          }
          for (let dv = 0; dv < h; dv++) mask.fill(0, (v + dv) * S + u, (v + dv) * S + u + w);

          const b = key & 0xff;
          const ao = (key >> 8) & 0xff;
          const lit = key >> 16;
          const sun = (lit >> 4) * 17;
          const glow = (lit & 15) * 17;
          const a0 = ao & 3;
          const a1 = (ao >> 2) & 3;
          const a2 = (ao >> 4) & 3;
          const a3 = (ao >> 6) & 3;
          const out = TRANSPARENT[b] ? transparent : opaque;
          const shade = dir * 4;
          const layer = LAYER[b * 6 + dir];
          const u0 = origin[ua] + u;
          const v0 = origin[va] + v;
          out.reserve(1);
          pos[d] = plane;
          corner(out, origin, tu, tv, layer, ua, va, u0, v0, SHADED[shade + a0], sun, glow);
          corner(out, origin, tu, tv, layer, ua, va, u0 + w, v0, SHADED[shade + a1], sun, glow);
          corner(out, origin, tu, tv, layer, ua, va, u0 + w, v0 + h, SHADED[shade + a2], sun, glow);
          corner(out, origin, tu, tv, layer, ua, va, u0, v0 + h, SHADED[shade + a3], sun, glow);
          // Split along the darker diagonal, so a lone dark corner shades both triangles
          // symmetrically instead of creasing (0fps).
          out.quad(a0 + a2 > a1 + a3);
          quads++;
          u += w;
        }
      }
    }
  }
  return { opaque: opaque.build(), transparent: transparent.build(), quads };
}

function corner(
  out: MeshBuilder,
  origin: number[],
  tu: number,
  tv: number,
  layer: number,
  ua: number,
  va: number,
  u: number,
  v: number,
  shade: number,
  sun: number,
  glow: number,
): void {
  const p = pos;
  p[ua] = u;
  p[va] = v;
  out.vertex(p[0], p[1], p[2], shade, sun, glow, p[tu] - origin[tu], p[tv] - origin[tv], layer);
}
