// The world's map (Milestone 18): what's been explored, drawn from above. Pure.
//
// Each explored column has a tile of 16 × 16 pixels, one for each 2 × 2 blocks: the block on top
// there and a shade, of land lighter or darker than the land a pixel north (so hills show), of water
// how deep it is. A tile is taken from the loaded column (`tileOf`) when it's first explored (within
// `radius` chunks of a player: `explore`) and again after it's edited (`touch`), a few a frame. The
// map is the world's: every map shows the same, saved in the record's `map` (each tile run-length
// encoded, as text). `paint` draws any window of it at any scale, unexplored land blank parchment.

import { Block, BLOCKS } from '../world/blocks';
import { CHUNK_SIZE, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../world/coords';
import { decodeRle, encodeRle } from '../save/rle';
import { EMPTY_BLOCKS, type World } from '../world/world';

/** Pixels a tile has a side, each 2 × 2 blocks. */
export const TILE = 16;
const AREA = TILE * TILE;
/** A tile's bytes: the top block of each pixel, then its shade. */
export const TILE_BYTES = AREA * 2;

/** Shades: land lower than the pixel north, level, higher; water deep, middling, shallow. */
const LAND = [0.8, 1, 1.12];
const WATER = [0.68, 0.84, 1];
/** Unexplored: parchment. */
export const PARCHMENT: readonly [number, number, number] = [216, 201, 163];

const key = (cx: number, cz: number) => `${cx},${cz}`;

/** The top block in column (x, z) and its height, or null if there's nothing (or it isn't loaded). */
function top(world: World, x: number, z: number): { y: number; block: Block } | null {
  const cx = toChunk(x);
  const cz = toChunk(z);
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  for (let cy = MAX_CHUNK_Y; cy >= MIN_CHUNK_Y; cy--) {
    const c = world.getChunk(cx, cy, cz);
    if (!c || c.blocks === EMPTY_BLOCKS) continue;
    const blocks = c.blocks;
    for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
      const b = blocks[localIndex(lx, ly, lz)];
      if (b !== Block.Air) return { y: cy * CHUNK_SIZE + ly, block: b };
    }
  }
  return null;
}

/** Column (cx, cz)'s tile, from the world as it is (its column must be loaded). */
export function tileOf(world: World, cx: number, cz: number): Uint8Array {
  const tile = new Uint8Array(TILE_BYTES);
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  // Heights a pixel north of each pixel: the row above, or for the top row the land 2 blocks north.
  const north = new Float64Array(TILE);
  for (let i = 0; i < TILE; i++) north[i] = top(world, x0 + i * 2, z0 - 2)?.y ?? Number.NaN;
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const x = x0 + i * 2;
      const z = z0 + j * 2;
      const t = top(world, x, z);
      const p = j * TILE + i;
      if (!t) {
        north[i] = Number.NaN;
        continue;
      }
      tile[p] = t.block;
      if (BLOCKS[t.block].liquid) {
        let depth = 1;
        while (depth < 8 && BLOCKS[world.getBlock(x, t.y - depth, z)].liquid) depth++;
        tile[AREA + p] = depth >= 6 ? 0 : depth >= 3 ? 1 : 2;
      } else {
        const n = north[i];
        tile[AREA + p] = Number.isNaN(n) || n === t.y ? 1 : t.y > n ? 2 : 0;
      }
      north[i] = t.y;
    }
  }
  return tile;
}

export class WorldMap {
  private readonly tiles = new Map<string, Uint8Array>();
  /** Explored columns changed since their tile was taken. */
  private readonly stale = new Set<string>();

  /** Columns explored. */
  get size(): number {
    return this.tiles.size;
  }

  /** Column (cx, cz)'s tile, if it's been explored. */
  tile(cx: number, cz: number): Uint8Array | undefined {
    return this.tiles.get(key(cx, cz));
  }

  /** Something changed in column (cx, cz): its tile is taken again when it's next near. */
  touch(cx: number, cz: number): void {
    const k = key(cx, cz);
    if (this.tiles.has(k)) this.stale.add(k);
  }

  /**
   * Explore round (x, z): the loaded columns within `radius` chunks not yet explored, or changed, nearest
   * first, at most `most` of them (their tiles taken now). Returns how many were.
   */
  explore(world: World, x: number, z: number, radius = 4, most = 2): number {
    const pcx = toChunk(Math.floor(x));
    const pcz = toChunk(Math.floor(z));
    let done = 0;
    for (let r = 0; r <= radius && done < most; r++)
      for (let dz = -r; dz <= r && done < most; dz++)
        for (let dx = -r; dx <= r && done < most; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          const k = key(cx, cz);
          if ((this.tiles.has(k) && !this.stale.has(k)) || !world.hasColumn(cx, cz)) continue;
          this.tiles.set(k, tileOf(world, cx, cz));
          this.stale.delete(k);
          done++;
        }
    return done;
  }

  /**
   * Paint a window `w` × `h` pixels of the map into `out` (RGBA): its middle at block (x, z), `scale`
   * blocks a pixel, north (-z) up. Unexplored land is parchment.
   */
  paint(out: Uint8ClampedArray, w: number, h: number, x: number, z: number, scale: number): void {
    let lastKey = '';
    let tile: Uint8Array | undefined;
    for (let py = 0; py < h; py++) {
      const bz = Math.floor(z + (py - h / 2 + 0.5) * scale);
      const cz = toChunk(bz);
      const j = (bz - cz * CHUNK_SIZE) >> 1;
      for (let px = 0; px < w; px++) {
        const bx = Math.floor(x + (px - w / 2 + 0.5) * scale);
        const cx = toChunk(bx);
        const k = `${cx},${cz}`;
        if (k !== lastKey) {
          lastKey = k;
          tile = this.tiles.get(k);
        }
        const o = (py * w + px) * 4;
        out[o + 3] = 255;
        const p = j * TILE + ((bx - cx * CHUNK_SIZE) >> 1);
        const b = tile ? tile[p] : 0;
        if (!tile || b === Block.Air) {
          out[o] = PARCHMENT[0];
          out[o + 1] = PARCHMENT[1];
          out[o + 2] = PARCHMENT[2];
          continue;
        }
        const info = BLOCKS[b];
        const k2 = (info.liquid ? WATER : LAND)[tile[AREA + p]] ?? 1;
        out[o] = Math.min(255, info.top[0] * 255 * k2);
        out[o + 1] = Math.min(255, info.top[1] * 255 * k2);
        out[o + 2] = Math.min(255, info.top[2] * 255 * k2);
      }
    }
  }

  /** As saved: each tile run-length encoded, as base 64, by "cx,cz". */
  toJSON(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, tile] of this.tiles) out[k] = toBase64(encodeRle(tile));
    return out;
  }

  /** What was saved, cleaned: tiles under whole-number keys that decode to a tile's bytes of blocks there are. */
  static from(saved: unknown): WorldMap {
    const map = new WorldMap();
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return map;
    for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
      const m = /^(-?\d+),(-?\d+)$/.exec(k);
      if (!m || typeof v !== 'string') continue;
      try {
        const tile = decodeRle(fromBase64(v), new Uint8Array(TILE_BYTES));
        if (tile.subarray(0, AREA).some((b) => BLOCKS[b] === undefined) || tile.subarray(AREA).some((s) => s > 2)) continue;
        map.tiles.set(key(Number(m[1]), Number(m[2])), tile);
      } catch {
        // Not a tile: left out.
      }
    }
    return map;
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
