// Decides which chunks to generate, mesh and unload around the player, and runs that work
// as jobs (on the worker pool in the game; synchronously in tests). Stays on the main
// thread, which owns the block data: workers get a column to generate or a padded copy to
// mesh, and their results are stored here.
//
// Each frame, within a time budget: store finished results (dropping any that are out of
// range or older than the chunk), then walk the columns around the player nearest first
// and start whatever is ready, up to the runner's capacity. Nothing is queued beyond that,
// so work for chunks that went out of range is never started: cancelling is free.

import { TUNING } from './config';
import { type ChunkMesh, meshChunk } from './mesh/mesher';
import { paddedBlocks, PADDED_VOLUME } from './mesh/padding';
import type { JobResult, JobRunner } from './workers/protocol';
import { chunkKey, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from './world/coords';
import type { World } from './world/world';

/** Where meshes go (the chunk renderer). */
export interface ChunkSink {
  set(key: string, cx: number, cy: number, cz: number, mesh: ChunkMesh): void;
  remove(key: string): void;
}

interface Column {
  cx: number;
  cz: number;
  /** Within the view radius, so its chunks are meshed; otherwise only generated, as a neighbour. */
  mesh: boolean;
}

/** Padded copies kept for reuse when they come back from workers. */
const SPARE_PADDED = 32;

const columnKey = (cx: number, cz: number): string => `${cx},${cz}`;

export class ChunkLoader {
  /** Chunk key → the chunk version its current mesh was built from (all-air chunks too, which have none). */
  private readonly meshed = new Map<string, number>();
  /** Columns being generated. */
  private readonly generating = new Set<string>();
  /** Chunk key → the version being meshed. */
  private readonly meshing = new Map<string, number>();
  private running = 0;
  private nextId = 1;
  private centre = { cx: Number.NaN, cz: Number.NaN };
  /** Columns around the player, in the order to work on them. */
  private order: Column[] = [];
  private readonly results: JobResult[] = [];
  private readonly spare: Uint8Array[] = [];
  /** Padded copy for edits, meshed here. */
  private readonly padded = new Uint8Array(PADDED_VOLUME);
  /** Work that was ready or waiting but not started on the last update. */
  queued = 0;
  /**
   * Something may have changed what to do: walk the columns again. Otherwise the walk is
   * skipped (idle frames, and frames waiting on workers).
   */
  private dirty = true;

  constructor(
    private readonly world: World,
    private readonly renderer: ChunkSink,
    private readonly runner: JobRunner,
  ) {
    runner.onResult = (result) => this.results.push(result);
  }

  /** Jobs running now. */
  get inFlight(): number {
    return this.running;
  }

  /** Work outstanding: not started, or running. */
  get pending(): number {
    return this.queued + this.running;
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
      this.rebuildOrder();
      this.unloadFar();
      this.dirty = true;
    }
    const deadline = performance.now() + TUNING.view.applyBudgetMs;
    // Results first: they unblock more work.
    while (this.results.length && performance.now() < deadline) {
      this.apply(this.results.shift()!);
      this.dirty = true;
    }
    if (this.dirty) this.dispatch(deadline);
  }

  /** Remesh now, on this thread (after an edit), so the change shows this frame. */
  remesh(cx: number, cy: number, cz: number): void {
    // A chunk without a mesh yet is meshed by the next walk, from its new version.
    this.dirty = true;
    const key = chunkKey(cx, cy, cz);
    const chunk = this.world.getChunk(cx, cy, cz);
    if (!chunk || !this.meshed.has(key) || !this.neighboursLoaded(cx, cz)) return;
    if (chunk.empty) this.renderer.remove(key);
    else this.renderer.set(key, cx, cy, cz, meshChunk(paddedBlocks(this.world, cx, cy, cz, this.padded), cx, cy, cz));
    this.meshed.set(key, chunk.version);
  }

  private apply(result: JobResult): void {
    this.running--;
    if (result.kind === 'generate') {
      this.generating.delete(columnKey(result.cx, result.cz));
      if (this.inKeepRange(result.cx, result.cz)) this.world.addColumn(result.cx, result.cz, result.cyMin, result.chunks);
      return;
    }
    const { cx, cy, cz, version } = result;
    const key = chunkKey(cx, cy, cz);
    if (this.spare.length < SPARE_PADDED) this.spare.push(result.padded);
    if (this.meshing.get(key) === version) this.meshing.delete(key);
    // Gone, out of range, or edited since: drop it. If still wanted, `dispatch` meshes it again.
    const chunk = this.world.getChunk(cx, cy, cz);
    if (!chunk || chunk.version !== version || !this.inKeepRange(cx, cz)) return;
    this.renderer.set(key, cx, cy, cz, result.mesh);
    this.meshed.set(key, version);
  }

  /** Start ready work in priority order while there's capacity and time; count the rest. */
  private dispatch(deadline: number): void {
    const world = this.world;
    // Capacity frees up only when a result arrives, which marks the loader dirty; running out
    // of time this frame is what needs another walk next frame.
    let outOfTime = false;
    const canStart = () => {
      if (this.running >= this.runner.capacity) return false;
      outOfTime ||= performance.now() >= deadline;
      return !outOfTime;
    };
    let queued = 0;
    for (const { cx, cz, mesh } of this.order) {
      if (!world.hasColumn(cx, cz)) {
        const key = columnKey(cx, cz);
        if (this.generating.has(key)) continue;
        if (!canStart()) {
          queued++;
          continue;
        }
        this.generating.add(key);
        this.running++;
        this.runner.run({ kind: 'generate', id: this.nextId++, seed: world.generator.seed, cx, cz, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y });
        continue;
      }
      if (!mesh) continue;

      let neighbours: boolean | undefined;
      for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
        const chunk = world.getChunk(cx, cy, cz)!;
        const key = chunk.key;
        if (this.meshed.get(key) === chunk.version || this.meshing.get(key) === chunk.version) continue;
        // All air has no faces (the faces of blocks next to it belong to their own chunks).
        if (chunk.empty) {
          this.renderer.remove(key);
          this.meshed.set(key, chunk.version);
          continue;
        }
        // Border faces and AO need the neighbours, or they'd be drawn against "air".
        neighbours ??= this.neighboursLoaded(cx, cz);
        if (!neighbours || !canStart()) {
          queued++;
          continue;
        }
        const padded = paddedBlocks(world, cx, cy, cz, this.spare.pop() ?? new Uint8Array(PADDED_VOLUME));
        this.meshing.set(key, chunk.version);
        this.running++;
        this.runner.run({ kind: 'mesh', id: this.nextId++, cx, cy, cz, version: chunk.version, padded });
      }
    }
    this.queued = queued;
    this.dirty = outOfTime;
  }

  private neighboursLoaded(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.world.hasColumn(cx + dx, cz + dz)) return false;
    return true;
  }

  /** Columns to mesh (within the view radius) and their neighbours (to generate), nearest first. */
  private rebuildOrder(): void {
    const { cx, cz } = this.centre;
    const r = TUNING.view.radius;
    const inView = (dx: number, dz: number) => dx * dx + dz * dz <= r * r;
    const list: (Column & { d2: number })[] = [];
    for (let dz = -r - 1; dz <= r + 1; dz++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const mesh = inView(dx, dz);
        let neighbour = false;
        for (let ez = -1; ez <= 1 && !mesh && !neighbour; ez++) for (let ex = -1; ex <= 1; ex++) if (inView(dx + ex, dz + ez)) neighbour = true;
        if (mesh || neighbour) list.push({ cx: cx + dx, cz: cz + dz, mesh, d2: dx * dx + dz * dz });
      }
    }
    list.sort((a, b) => a.d2 - b.d2);
    this.order = list;
  }

  /** Columns this close (in chunks, either axis) stay loaded; beyond, they're unloaded. */
  private inKeepRange(cx: number, cz: number): boolean {
    const limit = TUNING.view.radius + TUNING.view.unloadMargin;
    return Math.max(Math.abs(cx - this.centre.cx), Math.abs(cz - this.centre.cz)) <= limit;
  }

  private unloadFar(): void {
    for (const chunk of [...this.world.chunks.values()]) {
      if (this.inKeepRange(chunk.cx, chunk.cz)) continue;
      this.renderer.remove(chunk.key);
      this.meshed.delete(chunk.key);
      // Edited chunks stay in memory until saving exists (Milestone 4).
      if (!chunk.modified) this.world.unload(chunk);
    }
  }
}
