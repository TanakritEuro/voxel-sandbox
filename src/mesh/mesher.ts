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
// Torches aren't cubes: each is a small box of its own, never merged. Nor are the thin logic
// blocks (`box`): wire a 1/16 sheet, a switch a base and a handle to one side or the other, a
// button a small square (flatter pressed), a gate a 1/8 plate whose top turns with its facing.
//
// Water: a full block of it (a source, falling water, anything with water above) is meshed like
// glass, merged, but never against other water. Flowing water short of a full block is meshed on
// its own (`water`): its top at its depth, its sides where the neighbour isn't solid and isn't
// water as deep. Where a full block of water meets shallower water, its side shows above the
// other's surface (`steps`). So water of different depths meets with no hole and no doubled face.

import { TUNING } from '../config';
import { Block, BLOCKS, FACINGS, gateOf } from '../world/blocks';
import { CHUNK_SIZE } from '../world/coords';
import { textureLayer } from '../world/textures';
import { FACE_ORDER, MeshBuilder, type MeshData } from './builder';
import { ALL_SUNLIT, PADDED } from './padding';

export interface ChunkMesh {
  /** Solid blocks (and torches): drawn by a shader that never discards, so hidden pixels are skipped early. */
  opaque: MeshData;
  /** Blocks with holes (leaves): drawn after, alpha-tested. */
  cutout: MeshData;
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
/** A wall torch's wall, the step from it to the block it hangs on (0, 0 for everything else). */
const WALL_X = new Int8Array(256);
const WALL_Z = new Int8Array(256);
/** Which shape (0 cube, 1 torch, 2 wire, 3 switch, 4 button, 5 plate); a switch or button on; a gate's facing. */
const SHAPE = new Uint8Array(256);
const ON = new Uint8Array(256);
const FACE_X = new Int8Array(256);
const FACE_Z = new Int8Array(256);
const GLOW = new Uint8Array(256);
/** Liquids, and how deep each is when nothing liquid is above it (`liquidHeight`). */
const LIQUID = new Uint8Array(256);
const DEPTH = new Float64Array(256);
/** Texture array layer by block and direction: LAYER[block * 6 + dir]. */
const LAYER = new Uint8Array(256 * 6);
BLOCKS.forEach((info, b) => {
  OPAQUE[b] = info.opaque ? 1 : 0;
  TRANSPARENT[b] = info.transparent ? 1 : 0;
  CUTOUT[b] = info.cutout ? 1 : 0;
  SHAPED[b] = info.shape !== 'cube' ? 1 : 0;
  SHAPE[b] = ['cube', 'torch', 'wire', 'switch', 'button', 'plate'].indexOf(info.shape);
  ON[b] = b === Block.SwitchOn || b === Block.ButtonOn ? 1 : 0;
  const gate = gateOf(b);
  if (gate) [FACE_X[b], FACE_Z[b]] = FACINGS[gate.facing];
  if (info.wall) {
    WALL_X[b] = info.wall.x;
    WALL_Z[b] = info.wall.z;
  }
  GLOW[b] = info.light * 17;
  LIQUID[b] = info.liquid ? 1 : 0;
  DEPTH[b] = info.liquidHeight;
  for (let dir = 0; dir < 6; dir++) LAYER[b * 6 + dir] = textureLayer(dir === 2 ? info.textures.top : dir === 3 ? info.textures.bottom : info.textures.side);
  // A front (a furnace's) on the side it faces.
  if (info.front) LAYER[b * 6 + [0, 1, 4, 5][info.front.facing]] = textureLayer(info.front.texture);
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
const cutout = new MeshBuilder();
const transparent = new MeshBuilder();
/** Per face: block | AO << 8; and its corners' sunlight and block light, a byte per corner. */
const mask = new Int32Array(S * S);
const sunMask = new Int32Array(S * S);
const glowMask = new Int32Array(S * S);
const pos = new Float64Array(3);
/** Padded indices of the chunk's torches (and any other shaped blocks). */
const shaped: number[] = [];
/** Padded indices of the chunk's flowing water short of a full block. */
const liquids: number[] = [];
/** Full water against shallower water: padded index and face direction, after one another. */
const steps: number[] = [];
/** Padded-index step to the neighbour each face direction looks at (+x, -x, +y, -y, +z, -z). */
const TOWARDS = [1, -1, P * P, -P * P, P, -P];

/** How deep the water at padded index `i` is: a full block with water above it, else its own depth. */
const depthAt = (padded: Uint8Array, i: number): number => (LIQUID[padded[i + P * P]] ? 1 : DEPTH[padded[i]]);

/** Four equal bytes in an int, as the masks hold a face's light when all its corners match. */
const flat = (l: number): number => (l * 0x01010101) | 0;

/**
 * Mesh one chunk from its padded blocks and light. Positions are in world coordinates (chunk
 * origin added), so the mesh needs no transform. Each quad is four consecutive vertices,
 * counter-clockwise seen from outside. Without `light`, everything is in full sun.
 * `flatFaces` (for far chunks, `lod.ts`) leaves out AO and smooth light: every face lit evenly
 * by the block it looks at, so a coarse cell's faces merge whole (40 % of the quads they make
 * with AO, measured on mountain chunks).
 */
export function meshChunk(padded: Uint8Array, cx: number, cy: number, cz: number, light: Uint8Array = ALL_SUNLIT, flatFaces = false): ChunkMesh {
  opaque.reset();
  cutout.reset();
  transparent.reset();
  shaped.length = 0;
  liquids.length = 0;
  steps.length = 0;
  const origin = [cx * S, cy * S, cz * S];
  let quads = 0;

  for (const dir of FACE_ORDER) {
    opaque.mark();
    cutout.mark();
    transparent.mark();
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
            } else if (LIQUID[b] && depthAt(padded, i) < 1) {
              // Flowing water short of a full block: meshed on its own, after.
              if (dir === 0) liquids.push(i);
            } else {
              const f = i + towards;
              const nb = padded[f];
              if (LIQUID[b] && LIQUID[nb]) {
                // Water against water: no face, but a side against shallower water shows above it.
                if (d !== 1 && depthAt(padded, f) < 1) steps.push(i, dir);
              } else if (nb === AIR || (!OPAQUE[nb] && (nb !== b || CUTOUT[b]))) {
                const lf = light[f];
                if (TRANSPARENT[b] || flatFaces) {
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
          const out = TRANSPARENT[b] ? transparent : CUTOUT[b] ? cutout : opaque;
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

  opaque.mark();
  cutout.mark();
  transparent.mark();
  for (const i of shaped) quads += SHAPE[padded[i]] === 1 ? torch(padded, light, i, origin) : logicShape(padded, light, i, origin);
  for (const i of liquids) quads += water(padded, light, i, origin);
  for (let n = 0; n < steps.length; n += 2) {
    const i = steps[n];
    const f = i + TOWARDS[steps[n + 1]];
    liquidFace(i, steps[n + 1], depthAt(padded, f), 1, light[f], padded[i], origin);
    quads++;
  }
  return { opaque: opaque.build(), cutout: cutout.build(), transparent: transparent.build(), quads };
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

/**
 * Flowing water at padded index i, short of a full block (nothing liquid above it): its top at its
 * depth, always (it's below the block's top, so seen from the side even under a solid block); its
 * bottom over anything but solid blocks and water; each side from the neighbour's water surface
 * (0 if it isn't water) up to its own, where the neighbour isn't solid and is lower. Returns the
 * quads made.
 */
function water(padded: Uint8Array, light: Uint8Array, i: number, origin: number[]): number {
  const b = padded[i];
  const h = DEPTH[b];
  let quads = 0;
  for (let dir = 0; dir < 6; dir++) {
    const f = i + TOWARDS[dir];
    const nb = padded[f];
    if (dir !== 2 && OPAQUE[nb]) continue;
    let from = 0;
    if (dir === 3) {
      if (LIQUID[nb]) continue;
    } else if (dir !== 2 && LIQUID[nb]) {
      from = depthAt(padded, f);
      if (from >= h) continue;
    }
    liquidFace(i, dir, from, h, light[f], b, origin);
    quads++;
  }
  return quads;
}

/**
 * One face of the water block at padded index i, in the transparent pass: a side spanning the
 * block across and from `y0` to `y1` up it, or the top at `y1`, or the bottom; lit flat by `lf`,
 * the light of the block it looks at. Texture coordinates in blocks, as the greedy faces have them,
 * so the texture lines up with theirs and doesn't stretch.
 */
function liquidFace(i: number, dir: number, y0: number, y1: number, lf: number, b: number, origin: number[]): void {
  const base = [origin[0] + (i % P) - 1, origin[1] + Math.floor(i / (P * P)) - 1, origin[2] + (Math.floor(i / P) % P) - 1];
  const d = dir >> 1;
  const s = dir & 1 ? -1 : 1;
  const ua = s > 0 ? (d + 1) % 3 : (d + 2) % 3;
  const va = s > 0 ? (d + 2) % 3 : (d + 1) % 3;
  const tu = d === 0 ? 2 : 0;
  const tv = d === 1 ? 2 : 1;
  const lo = (a: number) => base[a] + (a === 1 ? y0 : 0);
  const hi = (a: number) => base[a] + (a === 1 ? y1 : 1);
  const p = pos;
  p[d] = d === 1 ? base[1] + (s > 0 ? y1 : 0) : base[d] + (s > 0 ? 1 : 0);
  const layer = LAYER[b * 6 + dir];
  const shade = SHADED[dir * 4 + 3];
  const sun = (lf >> 4) * 17;
  const glow = Math.max((lf & 15) * 17, GLOW[b]);
  transparent.reserve(1);
  for (let k = 0; k < 4; k++) {
    // Corners (lo, lo), (hi, lo), (hi, hi), (lo, hi) on (u, v): counter-clockwise from outside.
    p[ua] = k === 1 || k === 2 ? hi(ua) : lo(ua);
    p[va] = k >= 2 ? hi(va) : lo(va);
    // On a side v runs up, and may end part way up a block: whole blocks, then eighths.
    const tex = p[tv] - origin[tv];
    const whole = Math.floor(tex);
    transparent.vertex(p[0], p[1], p[2], shade, sun, glow, p[tu] - origin[tu], whole, layer, Math.round((tex - whole) * 8));
  }
  transparent.quad();
}

/** Sixteenths of a block. */
const px = (n: number) => n / 16;

/**
 * A thin logic block at padded index i: its boxes (see the top of the file), lit flat by its own
 * block's light as torches are. Returns the quads made.
 */
function logicShape(padded: Uint8Array, light: Uint8Array, i: number, origin: number[]): number {
  const b = padded[i];
  const base = [origin[0] + (i % P) - 1, origin[1] + Math.floor(i / (P * P)) - 1, origin[2] + (Math.floor(i / P) % P) - 1];
  const l = light[i];
  const sun = (l >> 4) * 17;
  const glow = Math.max((l & 15) * 17, GLOW[b]);
  const top = LAYER[b * 6 + 2];
  const side = LAYER[b * 6];
  switch (SHAPE[b]) {
    case 2: // wire
      return box(base, [0, 0, 0], [1, px(1), 1], top, top, sun, glow, null);
    case 3: {
      // switch: the base, and the handle to one side (on) or the other (off)
      const h = ON[b] ? 9 : 5;
      return (
        box(base, [px(4), 0, px(5)], [px(12), px(2), px(11)], top, top, sun, glow, null) +
        box(base, [px(h), px(2), px(7)], [px(h + 2), px(9), px(9)], side, side, sun, glow, null)
      );
    }
    case 4: // button: flatter while pressed
      return box(base, [px(5), 0, px(5)], [px(11), px(ON[b] ? 1 : 2), px(11)], top, top, sun, glow, null);
    default: // a gate's plate, its top turned to its facing
      return box(base, [0, 0, 0], [1, px(2), 1], top, side, sun, glow, [FACE_X[b], FACE_Z[b]]);
  }
}

/**
 * A box from `lo` to `hi` within the block at `base` (no bottom: it stands on a block), in the
 * opaque pass: its top with layer `topLayer`, its sides `sideLayer`, each with the whole texture
 * across it (the textures are made for that), lit flat. With `turn` (a facing), the top's
 * texture is turned so its up (row 0) points that way. Returns the quads made.
 */
function box(base: number[], lo: number[], hi: number[], topLayer: number, sideLayer: number, sun: number, glow: number, turn: readonly [number, number] | null): number {
  let quads = 0;
  for (let dir = 0; dir < 6; dir++) {
    if (dir === 3) continue;
    const d = dir >> 1;
    const s = dir & 1 ? -1 : 1;
    const ua = s > 0 ? (d + 1) % 3 : (d + 2) % 3;
    const va = s > 0 ? (d + 2) % 3 : (d + 1) % 3;
    const tu = d === 0 ? 2 : 0;
    const tv = d === 1 ? 2 : 1;
    const layer = dir === 2 ? topLayer : sideLayer;
    const shade = SHADED[dir * 4 + 3];
    opaque.reserve(1);
    for (let k = 0; k < 4; k++) {
      const cu = k === 1 || k === 2;
      const cv = k >= 2;
      const p = pos;
      p[d] = base[d] + (s > 0 ? hi[d] : lo[d]);
      p[ua] = base[ua] + (cu ? hi[ua] : lo[ua]);
      p[va] = base[va] + (cv ? hi[va] : lo[va]);
      let tx = p[tu] === base[tu] + hi[tu] ? 1 : 0;
      let ty = p[tv] === base[tv] + hi[tv] ? 1 : 0;
      if (turn && dir === 2) {
        // The corner from the middle (±½ on x and z), onto the texture's right and up: up (v,
        // row 0 of the painted image) along the facing, right a quarter turn from it.
        const cx = tx - 0.5;
        const cz = ty - 0.5;
        const [fx, fz] = turn;
        tx = Math.round(0.5 + cx * fz - cz * fx);
        ty = Math.round(0.5 + cx * fx + cz * fz);
      }
      opaque.vertex(p[0], p[1], p[2], shade, sun, glow, tx, ty, layer);
    }
    opaque.quad();
    quads++;
  }
  return quads;
}

/** A torch's box within its block: 2 × 10 × 2 sixteenths, standing in the middle of the floor. */
const TORCH_LO = [7 / 16, 0, 7 / 16];
/** A wall torch: the same stick, its foot this far up and this far from its wall, leaning away from it by this much. */
const WALL_FOOT_Y = 3.5 / 16;
const WALL_FOOT_OUT = 2 / 16;
const WALL_LEAN = Math.PI / 8;
const LEAN_COS = Math.cos(WALL_LEAN);
const LEAN_SIN = Math.sin(WALL_LEAN);
const TORCH_HI = [9 / 16, 10 / 16, 9 / 16];

/**
 * The torch at padded index i: its box's faces but the bottom (it stands on a block), or all
 * six leaning out from its wall for a wall torch (`lean`), each
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
  // On a wall: leaning out, away from it (lx, lz), about its foot, which is near the wall.
  const lx = -WALL_X[b];
  const lz = -WALL_Z[b];
  const onWall = lx !== 0 || lz !== 0;
  let quads = 0;
  for (let dir = 0; dir < 6; dir++) {
    // The bottom stands on the block below; a wall torch's is lifted off it and shows.
    if (dir === 3 && !onWall) continue;
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
      if (onWall) lean(p, base, lx, lz);
      opaque.vertex(p[0], p[1], p[2], shade, sun, glow, tx, ty, layer);
    }
    opaque.quad();
    quads++;
  }
  return quads;
}

/**
 * A point of an upright torch in block `base` moved to the wall torch: tilted by WALL_LEAN
 * towards (lx, lz) about the stick's foot, the foot then put WALL_FOOT_OUT from the wall and
 * WALL_FOOT_Y up. A rotation, so faces stay counter-clockwise from outside.
 */
function lean(p: Float64Array, base: number[], lx: number, lz: number): void {
  // Relative to the upright stick's foot, the middle of its bottom.
  const rx = p[0] - base[0] - 0.5;
  const ry = p[1] - base[1];
  const rz = p[2] - base[2] - 0.5;
  const along = rx * lx + rz * lz;
  const leaned = along * LEAN_COS + ry * LEAN_SIN;
  const up = ry * LEAN_COS - along * LEAN_SIN;
  // The foot: WALL_FOOT_OUT from the wall, which is half a block back from the middle.
  const fx = 0.5 - lx * (0.5 - WALL_FOOT_OUT);
  const fz = 0.5 - lz * (0.5 - WALL_FOOT_OUT);
  p[0] = base[0] + fx + rx + (leaned - along) * lx;
  p[1] = base[1] + WALL_FOOT_Y + up;
  p[2] = base[2] + fz + rz + (leaned - along) * lz;
}
