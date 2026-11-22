// The cover on the GPU (`world/cover.ts`): one 1024 x 1024 RG8 texture wrapped round the
// world, a chunk column's tile at (cx mod 32, cz mod 32), holding the 32 x 32 columns round the
// camera's (496 blocks each way at least). Only a tile that changed is written, and only it is
// uploaded: the texture stays where it is while the world slides through it.

import * as THREE from 'three';
import { COVER_BYTES, COVER_STRIDE } from '../world/cover';
import { CHUNK_SIZE, toChunk } from '../world/coords';
import type { World } from '../world/world';

/** Columns across the texture (a power of two). */
export const COVER_COLUMNS = 32;
/** Blocks, and texels, across it. */
export const COVER_SIZE = COVER_COLUMNS * CHUNK_SIZE;
/** More tiles changed in a frame than this and the whole texture goes up at once. */
const WHOLE_UPLOAD = 128;

const NOWHERE = -0x8000_0000;

/**
 * GLSL to read it, in a shader with `COVER_SIZE` defined and the uniforms `cover` and
 * `coverOrigin` set: coverAt(world x and z) is (height in blocks, what falls), zeros outside it.
 */
export const COVER_GLSL = /* glsl */ `
  uniform highp sampler2D cover;
  uniform ivec2 coverOrigin;

  vec2 coverAt(vec2 place) {
    ivec2 cell = ivec2(floor(place));
    ivec2 inside = cell - coverOrigin;
    if (inside.x < 0 || inside.y < 0 || inside.x >= COVER_SIZE || inside.y >= COVER_SIZE) return vec2(0.0);
    vec2 stored = floor(texelFetch(cover, cell & (COVER_SIZE - 1), 0).rg * 255.0 + 0.5);
    return vec2((stored.x + mod(stored.y, 4.0) * 256.0) * 0.5, floor(stored.y / 4.0));
  }
`;

export class CoverMap {
  /** The texture's bytes, kept here for uploading tiles from. */
  readonly data = new Uint8Array(COVER_SIZE * COVER_SIZE * COVER_STRIDE);
  readonly texture: THREE.DataTexture;
  /** The lowest block (x, z) it covers now. */
  readonly origin = new THREE.Vector2();
  /** Slots written since the last upload. */
  readonly changed = new Set<number>();
  /** The same bytes as a texture never bound, to copy tiles from. */
  private readonly source: THREE.DataTexture;
  /** The column each slot was written for. */
  private readonly owners = new Int32Array(COVER_COLUMNS * COVER_COLUMNS * 2).fill(NOWHERE);
  private readonly filled = new Uint8Array(COVER_COLUMNS * COVER_COLUMNS);
  private minX = NOWHERE;
  private minZ = NOWHERE;
  private uploaded = false;
  private readonly region = new THREE.Box2();
  private readonly at = new THREE.Vector2();

  constructor() {
    this.texture = new THREE.DataTexture(this.data, COVER_SIZE, COVER_SIZE, THREE.RGFormat, THREE.UnsignedByteType);
    this.texture.needsUpdate = true;
    this.source = new THREE.DataTexture(this.data, COVER_SIZE, COVER_SIZE, THREE.RGFormat, THREE.UnsignedByteType);
  }

  /** Once a frame: follow the camera at (x, z) and take up the world's changed tiles. */
  update(world: World, x: number, z: number): void {
    const n = COVER_COLUMNS;
    const minX = toChunk(Math.floor(x)) - n / 2;
    const minZ = toChunk(Math.floor(z)) - n / 2;
    if (minX !== this.minX || minZ !== this.minZ) {
      this.minX = minX;
      this.minZ = minZ;
      this.origin.set(minX * CHUNK_SIZE, minZ * CHUNK_SIZE);
      for (let cz = minZ; cz < minZ + n; cz++) {
        for (let cx = minX; cx < minX + n; cx++) {
          const slot = slotOf(cx, cz);
          if (this.owners[slot * 2] === cx && this.owners[slot * 2 + 1] === cz) continue;
          this.owners[slot * 2] = cx;
          this.owners[slot * 2 + 1] = cz;
          this.write(world, cx, cz, slot);
        }
      }
    }
    if (!world.coverChanged.size) return;
    for (const [cx, cz] of world.coverChanged.values())
      if (cx >= minX && cx < minX + n && cz >= minZ && cz < minZ + n) this.write(world, cx, cz, slotOf(cx, cz));
    world.coverChanged.clear();
  }

  /** Once a frame, before drawing: send up what changed. */
  upload(renderer: THREE.WebGLRenderer): void {
    if (!this.changed.size && this.uploaded) return;
    if (!this.uploaded || this.changed.size > WHOLE_UPLOAD) {
      this.texture.needsUpdate = true;
      renderer.initTexture(this.texture);
      this.uploaded = true;
    } else {
      for (const slot of this.changed) {
        this.at.set((slot % COVER_COLUMNS) * CHUNK_SIZE, Math.floor(slot / COVER_COLUMNS) * CHUNK_SIZE);
        this.region.min.copy(this.at);
        this.region.max.copy(this.at).addScalar(CHUNK_SIZE);
        // From bytes, not from a texture: the source is never itself uploaded.
        renderer.copyTextureToTexture(this.source, this.texture, this.region, this.at);
      }
    }
    this.changed.clear();
  }

  /**
   * The lowest height (blocks) anything falls to within `reach` blocks of (x, z) either way;
   * Infinity if nothing falls there (desert, or columns not loaded). `reach` well inside the texture.
   */
  lowestFalling(x: number, z: number, reach: number): number {
    const mask = COVER_SIZE - 1;
    const data = this.data;
    const size = COVER_SIZE;
    const stride = COVER_STRIDE;
    const x0 = Math.floor(x - reach);
    const x1 = Math.floor(x + reach);
    const z1 = Math.floor(z + reach);
    let lowest = Number.POSITIVE_INFINITY;
    for (let bz = Math.floor(z - reach); bz <= z1; bz++) {
      const row = (bz & mask) * size;
      for (let bx = x0; bx <= x1; bx++) {
        const at = (row + (bx & mask)) * stride;
        const high = data[at + 1];
        if (high < 4) continue; // nothing falls
        const half = data[at] | ((high & 3) << 8);
        if (half < lowest) lowest = half;
      }
    }
    return lowest / 2;
  }

  private write(world: World, cx: number, cz: number, slot: number): void {
    const tile = world.coverOf(cx, cz);
    // Nothing there and nothing was: nothing to send.
    if (!tile && !this.filled[slot]) return;
    const S = CHUNK_SIZE;
    const row = S * COVER_STRIDE;
    const stride = COVER_SIZE * COVER_STRIDE;
    let to = (Math.floor(slot / COVER_COLUMNS) * S * COVER_SIZE + (slot % COVER_COLUMNS) * S) * COVER_STRIDE;
    for (let from = 0; from < COVER_BYTES; from += row, to += stride) {
      // A column with no tile reads as nothing falling.
      if (!tile) this.data.fill(0, to, to + row);
      else for (let k = 0; k < row; k++) this.data[to + k] = tile[from + k];
    }
    this.filled[slot] = tile ? 1 : 0;
    this.changed.add(slot);
  }
}

/** A column's slot: its place in the texture, row by row. */
const slotOf = (cx: number, cz: number): number => (cz & (COVER_COLUMNS - 1)) * COVER_COLUMNS + (cx & (COVER_COLUMNS - 1));
