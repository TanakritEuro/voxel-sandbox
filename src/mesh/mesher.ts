// Chunk meshing: turns a chunk's blocks into vertex arrays. Pure (no Three.js) and works on
// padded copies of the blocks and their light, so it runs the same in a Web Worker.
//
// Greedy meshing with per-vertex ambient occlusion (0fps.net, "Meshing in a Minecraft game"
// and "Ambient occlusion for Minecraft-like worlds"). For each of the six face directions
// and each of the 32 slices across it, masks record the visible faces: block id + the AO
// level of their four corners, and the light of their four corners. Runs of equal mask cells
// are merged into rectangles, widest first then tallest, so faces merge only when block, AO
// and light all match.
//
// Smooth lighting: a corner's light is the average over the block the face looks at and the
// three around that corner (the ones AO looks at), leaving out opaque ones, and the diagonal
// one when both sides are opaque; for sunlight and block light separately (`light.ts`).
// Blocks that give light show at least that much of it on their own faces. Water and glass
// take the light in front of them, flat, as they take no AO.
//
// The block's texture follows from the block and the face direction, so it needs no place in
// the key. Each vertex carries texture coordinates in blocks (the shader repeats the texture
// across a merged quad) and its layer. Its colour holds directional shade × AO in red,
// sunlight in green and block light in blue (0–15 as 0–255); the shader turns them into
// brightness.
//
// Torches aren't cubes: each is a small box of its own, never merged.

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

// Per block id: opaque (hides the faces next to it, darkens corners, stops light), drawn in
// the transparent pass, drawn with holes (faces against the same block shown too), a shape
// of its own (torch), the light it gives (as 0–255).
const OPAQUE = new Uint8Array(256);
const TRANSPARENT = new Uint8Array(256);
const CUTOUT = new Uint8Array(256);
const SHAPED = new Uint8Array(256);
const GLOW = new Uint8Array(256);
/** Texture array layer by block and direction: LAYER[block * 6 + dir]. */
const LAYER = new Uint8Array(256 * 6);
BLOCKS.forEach((info, b) => {
  OPAQUE[b] = info.opaque ? 1 : 0;
  TRANSPARENT[b] = info.transparent ? 1 : 0;
  CUTOUT[b] = info.cutout ? 1 : 0;
  SHAPED[b] = info.shape !== 'cube' ? 1 : 0;
  GLOW[b] = info.light * 17;
  for (let dir = 0; dir < 6; dir++) LAYER[b * 6 + dir] = textureLayer(dir === 2 ? info.textures.top : dir === 3 ? info.textures.bottom : info.textures.side);
});
/** Vertex brightness 0–255 by direction and AO level: SHADED[dir * 4 + ao]. */
const SHADED = new Uint8Array(6 * 4);
for (let dir = 0; dir < 6; dir++) for (let ao = 0; ao < 4; ao++) SHADED[dir * 4 + ao] = Math.round(SHADE[dir] * TUNING.render.ao[ao] * 255);

/** The average of `n` light levels summing to `sum`, as 0–255: AVERAGE[sum * 4 + n - 1]. */
const AVERAGE = new Uint8Array(61 * 4);
for (let sum = 0; sum <= 60; sum++) for (let n = 1; n <= 4; n++) AVERAGE[sum * 4 + n - 1] = Math.min(255, Math.round((sum * 17) / n));

/** AO level of a face corner from the two blocks beside it and the one diagonally between them (each 0 or 1). */
const vertexAO = (side1: number, side2: number, corner: number): number => (side1 && side2 ? 0 : 3 - side1 - side2 - corner);

/**
 * Smooth light of a face corner: `front` is the light the face looks at, then each of the
 * side, side and diagonal blocks' opaqueness and light. Returns sun | block light << 8, 0–255 each.
 */
function cornerLight(front: number, o1: number, l1: number, o2: number, l2: number, oc: number, lc: number): number {
  let sun = front >> 4;
  let glow = front & 15;
  let n = 1;
  if (!o1) {
    sun += l1 >> 4;
    glow += l1 & 15;
    n++;
  }
  if (!o2) {
    sun += l2 >> 4;
    glow += l2 & 15;
    n++;
  }
  if (!oc && !(o1 && o2)) {
    sun += lc >> 4;
    glow += lc & 15;
    n++;
  }
  return AVERAGE[sun * 4 + n - 1] | (AVERAGE[glow * 4 + n - 1] << 8);
}

/** Every corner unoccluded: transparent faces (water, glass) get no AO, so they stay flat and merge freely. */
const NO_AO = 0xff;

// Reused for every chunk (one set per thread).
const opaque = new MeshBuilder();
const transparent = new MeshBuilder();
/** Per face: block | AO << 8; and its corners' sunlight and block light, a byte per corner. */
const mask = new Int32Array(S * S);
const sunMask = new Int32Array(S * S);
const glowMask = new Int32Array(S * S);
const pos = new Float64Array(3);
/** Padded indices of the chunk's torches (and any other shaped blocks). */
const shaped: number[] = [];

/** Four equal bytes in an int, as the masks hold a face's light when all its corners match. */
const flat = (l: number): number => (l * 0x01010101) | 0;

/**
 * Mesh one chunk from its padded blocks and light. Positions are in world coordinates (chunk
 * origin added), so the mesh needs no transform. Each quad is four consecutive vertices,
 * counter-clockwise seen from outside. Without `light`, everything is in full sun.
 */
export function meshChunk(padded: Uint8Array, cx: number, cy: number, cz: number, light: Uint8Array = ALL_SUNLIT): ChunkMesh {
  opaque.reset();
  transparent.reset();
  shaped.length = 0;
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
      // The masks; mask 0 is no face.
      let any = false;
      for (let v = 0; v < S; v++) {
        let i = (c + 1) * sd + (v + 1) * sv + su; // padded index at u = 0
        for (let u = 0; u < S; u++, i += su) {
          const b = padded[i];
          const at = v * S + u;
          let key = 0;
          if (b !== AIR) {
            if (SHAPED[b]) {
              if (dir === 0) shaped.push(i);
            } else {
              const f = i + towards;
              const nb = padded[f];
              if (nb === AIR || (!OPAQUE[nb] && (nb !== b || CUTOUT[b]))) {
                const lf = light[f];
                if (TRANSPARENT[b]) {
                  key = b | (NO_AO << 8);
                  sunMask[at] = flat((lf >> 4) * 17);
                  glowMask[at] = flat(Math.max((lf & 15) * 17, GLOW[b]));
                } else {
                  // Corners 0–3 are at (-u, -v), (+u, -v), (+u, +v), (-u, +v), in the layer the face looks at.
                  const oL = OPAQUE[padded[f - su]];
                  const oR = OPAQUE[padded[f + su]];
                  const oD = OPAQUE[padded[f - sv]];
                  const oU = OPAQUE[padded[f + sv]];
                  const oLD = OPAQUE[padded[f - su - sv]];
                  const oRD = OPAQUE[padded[f + su - sv]];
                  const oRU = OPAQUE[padded[f + su + sv]];
                  const oLU = OPAQUE[padded[f - su + sv]];
                  const ao = vertexAO(oL, oD, oLD) | (vertexAO(oR, oD, oRD) << 2) | (vertexAO(oR, oU, oRU) << 4) | (vertexAO(oL, oU, oLU) << 6);
                  key = b | (ao << 8);
                  const lL = light[f - su];
                  const lR = light[f + su];
                  const lD = light[f - sv];
                  const lU = light[f + sv];
                  const c0 = cornerLight(lf, oL, lL, oD, lD, oLD, light[f - su - sv]);
                  const c1 = cornerLight(lf, oR, lR, oD, lD, oRD, light[f + su - sv]);
                  const c2 = cornerLight(lf, oR, lR, oU, lU, oRU, light[f + su + sv]);
                  const c3 = cornerLight(lf, oL, lL, oU, lU, oLU, light[f - su + sv]);
                  sunMask[at] = (c0 & 255) | ((c1 & 255) << 8) | ((c2 & 255) << 16) | ((c3 & 255) << 24);
                  const g = GLOW[b];
                  glowMask[at] =
                    Math.max(c0 >> 8, g) | (Math.max(c1 >> 8, g) << 8) | (Math.max(c2 >> 8, g) << 16) | (Math.max(c3 >> 8, g) << 24);
                }
                any = true;
              }
            }
          }
          mask[at] = key;
        }
      }
      if (!any) continue;

      // Greedy: take each unvisited face, extend it along u, then along v while whole rows match.
      const plane = origin[d] + c + (s > 0 ? 1 : 0);
      for (let v = 0; v < S; v++) {
        for (let u = 0; u < S; ) {
          const at = v * S + u;
          const key = mask[at];
          if (key === 0) {
            u++;
            continue;
          }
          const sk = sunMask[at];
          const gk = glowMask[at];
          let w = 1;
          while (u + w < S && mask[at + w] === key && sunMask[at + w] === sk && glowMask[at + w] === gk) w++;
          let h = 1;
          grow: while (v + h < S) {
            for (let k = 0; k < w; k++) {
              const j = (v + h) * S + u + k;
              if (mask[j] !== key || sunMask[j] !== sk || glowMask[j] !== gk) break grow;
            }
            h++;
          }
          for (let dv = 0; dv < h; dv++) mask.fill(0, (v + dv) * S + u, (v + dv) * S + u + w);

          const b = key & 0xff;
          const ao = key >> 8;
          const a0 = ao & 3;
          const a1 = (ao >> 2) & 3;
          const a2 = (ao >> 4) & 3;
          const a3 = (ao >> 6) & 3;
          const s0 = sk & 255;
          const s1 = (sk >> 8) & 255;
          const s2 = (sk >> 16) & 255;
          const s3 = (sk >>> 24) & 255;
          const g0 = gk & 255;
          const g1 = (gk >> 8) & 255;
          const g2 = (gk >> 16) & 255;
          const g3 = (gk >>> 24) & 255;
          const out = TRANSPARENT[b] ? transparent : opaque;
          const shade = dir * 4;
          const layer = LAYER[b * 6 + dir];
          const u0 = origin[ua] + u;
          const v0 = origin[va] + v;
          out.reserve(1);
          pos[d] = plane;
          corner(out, origin, tu, tv, layer, ua, va, u0, v0, SHADED[shade + a0], s0, g0);
          corner(out, origin, tu, tv, layer, ua, va, u0 + w, v0, SHADED[shade + a1], s1, g1);
          corner(out, origin, tu, tv, layer, ua, va, u0 + w, v0 + h, SHADED[shade + a2], s2, g2);
          corner(out, origin, tu, tv, layer, ua, va, u0, v0 + h, SHADED[shade + a3], s3, g3);
          // Split along the darker diagonal, so a lone dark corner shades both triangles
          // symmetrically instead of creasing (0fps): by AO, or where AO doesn't decide, by light.
          const byAO = a0 + a2 - (a1 + a3);
          out.quad(byAO > 0 || (byAO === 0 && Math.max(s0, g0) + Math.max(s2, g2) > Math.max(s1, g1) + Math.max(s3, g3)));
          quads++;
          u += w;
        }
      }
    }
  }

  for (const i of shaped) quads += torch(padded, light, i, origin);
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

/** A torch's box within its block: 2 × 10 × 2 sixteenths, standing in the middle of the floor. */
const TORCH_LO = [7 / 16, 0, 7 / 16];
const TORCH_HI = [9 / 16, 10 / 16, 9 / 16];

/**
 * The torch at padded index i: its box's faces but the bottom (it stands on a block), each
 * with the whole texture across it (the textures are made for that), lit flat by the torch's
 * own block. Returns the quads made.
 */
function torch(padded: Uint8Array, light: Uint8Array, i: number, origin: number[]): number {
  const b = padded[i];
  const x = (i % P) - 1;
  const z = (Math.floor(i / P) % P) - 1;
  const y = Math.floor(i / (P * P)) - 1;
  const base = [origin[0] + x, origin[1] + y, origin[2] + z];
  const l = light[i];
  const sun = (l >> 4) * 17;
  const glow = Math.max((l & 15) * 17, GLOW[b]);
  let quads = 0;
  for (let dir = 0; dir < 6; dir++) {
    if (dir === 3) continue;
    const d = dir >> 1;
    const s = dir & 1 ? -1 : 1;
    const ua = s > 0 ? (d + 1) % 3 : (d + 2) % 3;
    const va = s > 0 ? (d + 2) % 3 : (d + 1) % 3;
    const tu = d === 0 ? 2 : 0;
    const tv = d === 1 ? 2 : 1;
    const layer = LAYER[b * 6 + dir];
    const shade = SHADED[dir * 4 + 3];
    opaque.reserve(1);
    for (const [cu, cv] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const p = pos;
      p[d] = base[d] + (s > 0 ? TORCH_HI[d] : TORCH_LO[d]);
      p[ua] = base[ua] + (cu ? TORCH_HI[ua] : TORCH_LO[ua]);
      p[va] = base[va] + (cv ? TORCH_HI[va] : TORCH_LO[va]);
      // The texture spans the face: 0 at its low edge, 1 at its high one, on each texture axis.
      const tx = p[tu] === base[tu] + TORCH_HI[tu] ? 1 : 0;
      const ty = p[tv] === base[tv] + TORCH_HI[tv] ? 1 : 0;
      opaque.vertex(p[0], p[1], p[2], shade, sun, glow, tx, ty, layer);
    }
    opaque.quad();
    quads++;
  }
  return quads;
}
