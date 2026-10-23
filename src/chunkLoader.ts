// Decides which chunks to generate, mesh and unload around the player, within a time budget
// per frame. Scaffold: all on the main thread. Milestone 1 moves generation and meshing into
// a pool of Web Workers and keeps only this scheduling here.

import { TUNING } from './config';
import { meshChunk, paddedBlocks } from './mesh/mesher';
import type { ChunkRenderer } from './render/chunkRenderer';
import { chunkKey, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from './world/coords';
import type { World } from './world/world';

export class ChunkLoader {
  /** Chunk key → the chunk version its current mesh was built from. */
  private readonly meshed = new Map<string, number>();
  private centre = { cx: Number.NaN, cz: Number.NaN };
  private queue: [number, number, number][] = [];

  constructor(
    private readonly world: World,
    private readonly renderer: ChunkRenderer,
  ) {}

  /** Chunks waiting to be meshed. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Chunks within `radius` columns of the player's column that have no mesh yet: holes,
   * if they're inside the fog. Measured by `?autofly`.
   */
  missing(radius: number): number {
    const { cx, cz } = this.centre;
    let n = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) if (!this.meshed.has(chunkKey(cx + dx, cy, cz + dz))) n++;
      }
    }
    return n;
  }

  update(x: number, z: number): void {
    const cx = toChunk(Math.floor(x));
    const cz = toChunk(Math.floor(z));
    if (cx !== this.centre.cx || cz !== this.centre.cz) {
      this.centre = { cx, cz };
      this.rebuildQueue();
      this.unloadFar();
    }

    const deadline = performance.now() + TUNING.view.meshBudgetMs;
    while (this.queue.length && performance.now() < deadline) {
      const [qx, qy, qz] = this.queue.shift()!;
      this.mesh(qx, qy, qz);
    }
  }

  /** Remesh now (after an edit), so the change shows this frame. */
  remesh(cx: number, cy: number, cz: number): void {
    if (this.meshed.has(chunkKey(cx, cy, cz))) this.mesh(cx, cy, cz);
  }

  private mesh(cx: number, cy: number, cz: number): void {
    // Neighbours must exist before meshing, or border faces would be drawn against "air".
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.world.ensureChunk(cx + dx, cy + dy, cz + dz);
    const chunk = this.world.getChunk(cx, cy, cz)!;
    this.renderer.set(chunk.key, meshChunk(paddedBlocks(this.world, cx, cy, cz), cx, cy, cz));
    this.meshed.set(chunk.key, chunk.version);
  }

  /** Every chunk within the view radius that has no mesh yet, nearest first. */
  private rebuildQueue(): void {
    const { cx, cz } = this.centre;
    const r = TUNING.view.radius;
    const list: [number, number, number, number][] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
          if (!this.meshed.has(chunkKey(cx + dx, cy, cz + dz))) list.push([cx + dx, cy, cz + dz, d2]);
        }
      }
    }
    list.sort((a, b) => a[3] - b[3]);
    this.queue = list.map(([x, y, z]) => [x, y, z]);
  }

  private unloadFar(): void {
    const limit = TUNING.view.radius + TUNING.view.unloadMargin;
    const { cx, cz } = this.centre;
    for (const chunk of [...this.world.chunks.values()]) {
      if (Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz)) <= limit) continue;
      this.renderer.remove(chunk.key);
      this.meshed.delete(chunk.key);
      // Edited chunks stay in memory until saving exists (Milestone 4).
      if (!chunk.modified) this.world.unload(chunk);
    }
  }
}
