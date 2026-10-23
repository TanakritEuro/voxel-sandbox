// Caves: winding tunnels everywhere underground, and wide caverns deep down, carved out of the
// generated chunk. Tunnels are where two 3D noises are both near zero (long "spaghetti"
// passages that wander in every direction); caverns are where a third noise is high.
//
// Noise is sampled only every 4 blocks and interpolated in between: 55 ns a sample would be
// ~15 ms a column at every block. Per chunk that's 9 × 9 × 9 samples a field; each column
// interpolates them across x and z once per sample level, then along y block by block.

import { Block } from './blocks';
import { CHUNK_SIZE, toChunk, toLocal } from './coords';
import { Noise } from './noise';

// Local copies: imported bindings can cost a lookup each time in the hot loops (they do under Vitest).
const S = CHUNK_SIZE;
const AIR = Block.Air;
const WATER = Block.Water;
/** Blocks between noise samples, and samples along each side of a chunk. */
const STEP = 4;
const N = S / STEP + 1;

/** Tunnels: where both tunnel noises are within this of zero. Larger means more, wider tunnels. */
const TUNNEL = 0.07;
/** Caverns: where the cavern noise is above this, and only below CAVERN_TOP. */
const CAVERN = 0.55;
const CAVERN_TOP = 40;
/** The lowest layers are never carved, so the world has a floor. */
const FLOOR = 4;

export class Caves {
  private readonly tunnelA: Noise;
  private readonly tunnelB: Noise;
  private readonly cavern: Noise;
  // Samples for one chunk, [(i * N + k) * N + j] for x step i, z step k, y step j.
  private readonly a = new Float32Array(N * N * N);
  private readonly b = new Float32Array(N * N * N);
  private readonly c = new Float32Array(N * N * N);
  // One column's samples along y, after interpolating across x and z.
  private readonly colA = new Float32Array(N);
  private readonly colB = new Float32Array(N);
  private readonly colC = new Float32Array(N);

  constructor(seed: number) {
    this.tunnelA = new Noise(seed ^ 0x7c4e1);
    this.tunnelB = new Noise(seed ^ 0x2b8f3);
    this.cavern = new Noise(seed ^ 0x6ad05);
  }

  /**
   * Is the solid block at world (x, y, z) carved, if its column may be carved up to `limit`?
   * The same samples and arithmetic as `carve` (stored as float32 there, rounded the same
   * here), so the answer always matches: for features that must know whether their ground
   * is still there, in whichever chunk they're being placed.
   */
  carvedAt(x: number, y: number, z: number, limit: number): boolean {
    if (y > limit || y < FLOOR) return false;
    const y0 = toChunk(y) * S;
    const lx = toLocal(x);
    const ly = y - y0;
    const lz = toLocal(z);
    // The two sample levels around y, each interpolated across x and z as `carve` does.
    const xs = toChunk(x) * S + (lx >> 2) * STEP;
    const zs = toChunk(z) * S + (lz >> 2) * STEP;
    const ys = y0 + (ly >> 2) * STEP;
    const fx = (lx & 3) / STEP;
    const fz = (lz & 3) / STEP;
    const fy = (ly & 3) / STEP;
    const level = (noise: Noise, sx: number, sy: number, sz: number, yy: number) => {
      const v = (dx: number, dz: number) => Math.fround(noise.noise3((xs + dx) / sx, yy / sy, (zs + dz) / sz));
      const a = v(0, 0) + (v(STEP, 0) - v(0, 0)) * fx;
      const b = v(0, STEP) + (v(STEP, STEP) - v(0, STEP)) * fx;
      return Math.fround(a + (b - a) * fz);
    };
    const along = (noise: Noise, sx: number, sy: number, sz: number) => {
      const lo = level(noise, sx, sy, sz, ys);
      return lo + (level(noise, sx, sy, sz, ys + STEP) - lo) * fy;
    };
    const a = along(this.tunnelA, 48, 28, 48);
    if (a < TUNNEL && a > -TUNNEL) {
      const b = along(this.tunnelB, 48, 28, 48);
      if (b < TUNNEL && b > -TUNNEL) return true;
    }
    return y0 < CAVERN_TOP && y < CAVERN_TOP && along(this.cavern, 70, 36, 70) > CAVERN;
  }

  /**
   * Carve one chunk's blocks in place. `limits[lz * 32 + lx]` is the highest y each column may
   * be carved to (below it the generator has made sure no water is near). Water and air are
   * left alone; returns how many blocks became air.
   */
  carve(blocks: Uint8Array, cx: number, cy: number, cz: number, limits: Int16Array): number {
    const y0 = cy * S;
    let highest = -1;
    for (let i = 0; i < limits.length; i++) if (limits[i] > highest) highest = limits[i];
    if (highest < Math.max(y0, FLOOR) || y0 + S <= FLOOR) return 0;

    const x0 = cx * S;
    const z0 = cz * S;
    const caverns = y0 < CAVERN_TOP;
    for (let i = 0; i < N; i++)
      for (let k = 0; k < N; k++)
        for (let j = 0; j < N; j++) {
          const x = x0 + i * STEP;
          const y = y0 + j * STEP;
          const z = z0 + k * STEP;
          const at = (i * N + k) * N + j;
          // Stretched sideways: tunnels run more along the ground than up and down it.
          this.a[at] = this.tunnelA.noise3(x / 48, y / 28, z / 48);
          this.b[at] = this.tunnelB.noise3(x / 48, y / 28, z / 48);
          if (caverns) this.c[at] = this.cavern.noise3(x / 70, y / 36, z / 70);
        }

    let carved = 0;
    for (let lz = 0; lz < S; lz++) {
      const k = lz >> 2;
      const fz = (lz & 3) / STEP;
      for (let lx = 0; lx < S; lx++) {
        const top = Math.min(limits[lz * S + lx], y0 + S - 1) - y0;
        const bottom = Math.max(FLOOR - y0, 0);
        if (top < bottom) continue;
        const i = lx >> 2;
        const fx = (lx & 3) / STEP;
        // This column's samples along y, interpolated across x and z.
        for (let j = 0; j < N; j++) {
          const p00 = (i * N + k) * N + j;
          const p10 = p00 + N * N;
          const p01 = p00 + N;
          const p11 = p10 + N;
          this.colA[j] = bilerp(this.a, p00, p10, p01, p11, fx, fz);
          this.colB[j] = bilerp(this.b, p00, p10, p01, p11, fx, fz);
          if (caverns) this.colC[j] = bilerp(this.c, p00, p10, p01, p11, fx, fz);
        }
        for (let ly = bottom; ly <= top; ly++) {
          const index = (ly * S + lz) * S + lx;
          const block = blocks[index];
          if (block === AIR || block === WATER) continue;
          const j = ly >> 2;
          const fy = (ly & 3) / STEP;
          let open = false;
          const a = this.colA[j] + (this.colA[j + 1] - this.colA[j]) * fy;
          if (a < TUNNEL && a > -TUNNEL) {
            const b = this.colB[j] + (this.colB[j + 1] - this.colB[j]) * fy;
            open = b < TUNNEL && b > -TUNNEL;
          }
          if (!open && caverns && y0 + ly < CAVERN_TOP) open = this.colC[j] + (this.colC[j + 1] - this.colC[j]) * fy > CAVERN;
          if (open) {
            blocks[index] = AIR;
            carved++;
          }
        }
      }
    }
    return carved;
  }
}

function bilerp(v: Float32Array, p00: number, p10: number, p01: number, p11: number, fx: number, fz: number): number {
  const a = v[p00] + (v[p10] - v[p00]) * fx;
  const b = v[p01] + (v[p11] - v[p01]) * fx;
  return a + (b - a) * fz;
}
