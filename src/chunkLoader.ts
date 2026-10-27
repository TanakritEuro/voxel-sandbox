// Decides which chunks to generate, mesh and unload around the player, and runs that work
// as jobs (on the worker pool in the game; synchronously in tests). Stays on the main
// thread, which owns the block data: workers get a column to generate or a padded copy to
// mesh, and their results are stored here.
//
// Each frame, within a time budget: store finished results (dropping any that are out of
// range or older than the chunk), then walk the columns around the player in priority order
// (near first, in front of the camera before behind, see `columnPriority`) and start
// whatever is ready, up to the runner's capacity. Nothing is queued beyond that, so work for
// chunks that went out of range is never started: cancelling is free.
//
// Only chunks that could be seen are meshed and drawn: a walk from the player's chunk through
// open space (`world/visibility.ts`) decides which, so cave walls deep under the ground stay
// unmeshed until the player goes down there.
//
// Far columns are meshed at lower detail (`mesh/lod.ts`, `TUNING.view.lod`), walled on every
// side so the gaps between levels are covered. A chunk's mesh is known by its stamp: its
// version and the form it was meshed in (level and seams). When the player moves and a
// column's form changes, its chunks are stale like edited ones and are meshed again, the old
// mesh shown until the new one arrives.

import { TUNING } from './config';
import { type Lod, prepareLod, SEAM_NEG_X, SEAM_NEG_Z, SEAM_POS_X, SEAM_POS_Z } from './mesh/lod';
import { type ChunkMesh, meshChunk } from './mesh/mesher';
import { paddedBlocks, paddedLight, PADDED_VOLUME } from './mesh/padding';
import type { JobResult, JobRunner, SavedChunk } from './workers/protocol';
import { chunkKey, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from './world/coords';
import { ALL_CONNECTED, reachableChunks } from './world/visibility';
import type { Chunk, World } from './world/world';

/** Where meshes go (the chunk renderer). */
export interface ChunkSink {
  set(key: string, cx: number, cy: number, cz: number, mesh: ChunkMesh): void;
  remove(key: string): void;
  /** Show or hide a chunk's mesh (hidden: can't be seen from where the player is). */
  setVisible(key: string, visible: boolean): void;
}

/** Where edited chunks are kept (`save/saver.ts`). */
export interface ChunkSaves {
  /** Has the column saved chunks (known without reading them)? */
  has(cx: number, cz: number): boolean;
  /** Read the column's saved chunks. */
  load(cx: number, cz: number): Promise<SavedChunk[]>;
  /** These chunks are about to be unloaded: keep their edits. */
  unloading(chunks: readonly Chunk[]): void;
}

interface Column {
  cx: number;
  cz: number;
  key: string;
  /** Within the view radius, so its chunks are meshed; otherwise only generated, as a neighbour. */
  mesh: boolean;
  /** Level of detail its chunks are meshed at, and the sides it walls (`wallsFor`). */
  lod: Lod;
  seams: number;
  priority: number;
  /** Its chunks, from MIN_CHUNK_Y up, once all are loaded (they stay while it's in the order). */
  chunks: Chunk[] | null;
  /** Its 3 × 3 columns are loaded, so it can be meshed (stays so while it's in the order). */
  ready: boolean;
  /**
   * Nothing to do here, as of the last look: skipped until something could change that (a
   * walk, an edit in it, a result for it or a neighbour). Without this, every frame looked at
   * every chunk in range again, which at view distance 16 used up the frame's budget before
   * reaching the work still to do, and loading stopped.
   */
  settled: boolean;
}

/** Padded copies (blocks, light) kept for reuse when they come back from workers. */
const SPARE_PADDED = 32;

const columnKey = (cx: number, cz: number): string => `${cx},${cz}`;

/** What a chunk's mesh is made from: its version, its column's level and seams. */
const stamp = (version: number, lod: number, seams: number): number => version * 64 + (lod | (seams << 2));
const versionOf = (s: number): number => Math.floor(s / 64);

/**
 * The sides a column at `lod` walls (`mesh/lod.ts`): all four for a far one, none for a near one.
 * Levels only grow away from the player, so the gaps between levels that can be seen are on
 * the far side's edges, and the far side's walls cover them. Walling by its own level alone,
 * rather than by its neighbours', means a column is meshed again only when its own level
 * changes: walling only where the neighbour's level differs remeshed the neighbours of every
 * column that changed too, and flying at view distance 16 fell behind (1,330 chunks waiting,
 * holes in 19 of 20 seconds).
 */
export const wallsFor = (lod: Lod): number => (lod > 0 ? SEAM_NEG_X | SEAM_POS_X | SEAM_NEG_Z | SEAM_POS_Z : 0);

/**
 * The level of detail for a column `d` chunks from the player's, given the level it has now
 * (null for a column just come into range): it changes only once `d` is
 * `TUNING.view.lod.hysteresis` past a boundary.
 */
export function lodLevel(d: number, current: Lod | null): Lod {
  const { near, far, hysteresis } = TUNING.view.lod;
  if (current === null) return d < near ? 0 : d < far ? 1 : 2;
  const bounds = [near, far];
  let level: number = current;
  while (level > 0 && d < bounds[level - 1] - hysteresis) level--;
  while (level < 2 && d >= bounds[level] + hysteresis) level++;
  return level as Lod;
}

/** New chunks change what can be seen, but walking again for every one is wasteful: at most this often (ms). */
const WALK_INTERVAL = 100;

/** Turning further than this (30°) since the columns were last sorted sorts them again. */
const TURN_COS = Math.cos(Math.PI / 6);

/**
 * Loading priority of the column (dx, dz) from the player's, looking along (fx, fz)
 * (horizontal, unit length, or zero for no direction): lower goes first. Distance, made
 * longer away from the view: `TUNING.view.behindWeight` 1 counts a column straight behind
 * as twice as far as one straight ahead, so the view fills first but the world behind
 * isn't left for last. The columns within 2 of the player always come first, whatever the
 * direction: you're standing on them.
 */
export function columnPriority(dx: number, dz: number, fx: number, fz: number): number {
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 2) return d;
  const cos = (dx * fx + dz * fz) / d;
  return d * (1 + (TUNING.view.behindWeight * (1 - cos)) / 2);
}

export class ChunkLoader {
  /** Chunk key → the stamp its current mesh was built from (all-air chunks too, which have none). */
  private readonly meshed = new Map<string, number>();
  /** Columns being generated. */
  private readonly generating = new Set<string>();
  /** Columns whose saved chunks are being read, and those read, waiting to be generated. */
  private readonly reading = new Set<string>();
  private readonly read = new Map<string, SavedChunk[]>();
  /** Chunk key → the stamp being meshed. */
  private readonly meshing = new Map<string, number>();
  private running = 0;
  private nextId = 1;
  private centre = { cx: Number.NaN, cy: Number.NaN, cz: Number.NaN };
  /** Horizontal look direction the columns were sorted for (unit length, or zero). */
  private look = { x: 0, z: 0 };
  /** Columns around the player, in the order to work on them, and by key. */
  private order: Column[] = [];
  private readonly columns = new Map<string, Column>();
  /** Within a column, chunk heights nearest the player's first. */
  private heights: number[] = [];
  private readonly results: JobResult[] = [];
  private readonly spare: Uint8Array[] = [];
  private readonly spareLight: Uint8Array[] = [];
  /** Padded copies for edits, meshed here. */
  private readonly padded = new Uint8Array(PADDED_VOLUME);
  private readonly paddedLight = new Uint8Array(PADDED_VOLUME);
  /** Work that was ready or waiting but not started on the last update. */
  queued = 0;
  /**
   * Something may have changed what to do: walk the columns again. Otherwise the walk is
   * skipped (idle frames, and frames waiting on workers).
   */
  private dirty = true;
  /** Chunks that could be seen from the player's chunk (keys), from the last walk. */
  private reachable = new Set<string>();
  /** The walk is out of date: right away after moving or an edit, at the next interval after new chunks. */
  private walkNow = true;
  private walkSoon = false;
  private lastWalk = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly world: World,
    private readonly renderer: ChunkSink,
    private readonly runner: JobRunner,
    /** Without it, edits are lost when their chunks are unloaded. */
    private readonly saves?: ChunkSaves,
  ) {
    runner.onResult = (result) => this.results.push(result);
  }

  /** Jobs running now. */
  get inFlight(): number {
    return this.running;
  }

  /** Chunks that could be seen from the player's chunk (meshed or to be meshed). */
  get visibleChunks(): number {
    return this.reachable.size;
  }

  /** Could chunk (cx, cy, cz) be seen from the player's chunk, as of the last walk? */
  canSee(cx: number, cy: number, cz: number): boolean {
    return this.reachable.has(chunkKey(cx, cy, cz));
  }

  /** Columns in view at full, half and quarter detail (for `?stats`). */
  get levels(): [number, number, number] {
    const n: [number, number, number] = [0, 0, 0];
    for (const col of this.order) if (col.mesh) n[col.lod]++;
    return n;
  }

  /** Work outstanding: not started, or running. */
  get pending(): number {
    return this.queued + this.running;
  }

  /**
   * Chunks within `radius` columns of the player's column that have no mesh yet and could be
   * seen (or aren't loaded, so nobody knows yet): holes, if they're inside the fog. With `minCos`, only columns within that angle
   * of the look direction (and the ones under the player) count. Measured by `?autofly`.
   */
  missing(radius: number, minCos = -1): number {
    const { cx, cz } = this.centre;
    let n = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
        if (d2 >= 4 && dx * this.look.x + dz * this.look.z < minCos * Math.sqrt(d2)) continue;
        for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
          const key = chunkKey(cx + dx, cy, cz + dz);
          if (this.meshed.has(key)) continue;
          if (this.reachable.has(key) || !this.world.getChunk(cx + dx, cy, cz + dz)) n++;
        }
      }
    }
    return n;
  }

  /** Once per frame, with the player's position and look direction (only its horizontal part counts). */
  update(x: number, y: number, z: number, lookX: number, lookZ: number): void {
    const cx = toChunk(Math.floor(x));
    const cy = toChunk(Math.floor(y));
    const cz = toChunk(Math.floor(z));
    const len = Math.hypot(lookX, lookZ);
    const fx = len > 1e-6 ? lookX / len : 0;
    const fz = len > 1e-6 ? lookZ / len : 0;
    const moved = cx !== this.centre.cx || cz !== this.centre.cz;
    const turned = (fx !== this.look.x || fz !== this.look.z) && fx * this.look.x + fz * this.look.z < TURN_COS;
    if (moved) {
      // Another column: other columns in range, other chunks to see.
      this.centre = { cx, cy, cz };
      this.look = { x: fx, z: fz };
      this.rebuildOrder();
      this.unloadFar();
      this.dirty = true;
      this.walkNow = true;
    } else {
      // Up or down: the walk starts elsewhere, and chunks nearer the player's height go first.
      if (cy !== this.centre.cy) {
        this.centre.cy = cy;
        this.sortHeights();
        this.dirty = true;
        this.walkNow = true;
      }
      // Turning only changes what to do first; what can be seen doesn't depend on the view.
      if (turned) {
        this.look = { x: fx, z: fz };
        this.resort();
        this.dirty = true;
      }
    }
    const deadline = performance.now() + TUNING.view.applyBudgetMs;
    // Results first: they unblock more work.
    while (this.results.length && performance.now() < deadline) {
      this.apply(this.results.shift()!);
      this.dirty = true;
    }
    const now = performance.now();
    // While results keep coming, walk at most every WALK_INTERVAL; once they stop, at once,
    // so no chunk is meshed on a walk that ran before its neighbours were known.
    const idle = this.results.length === 0 && this.running === 0;
    if (this.walkNow || (this.walkSoon && (idle || now - this.lastWalk >= WALK_INTERVAL))) {
      this.walk();
      this.lastWalk = now;
      this.walkNow = this.walkSoon = false;
      this.dirty = true;
    }
    if (this.dirty) this.dispatch(deadline);
  }

  /**
   * The view radius (`TUNING.view.radius`) has changed: on the next update, sort the columns
   * again, unload what is now out of range and walk again, as after moving.
   */
  radiusChanged(): void {
    this.centre = { cx: Number.NaN, cy: Number.NaN, cz: Number.NaN };
  }

  /** Remesh now, on this thread (after an edit), so the change shows this frame. */
  remesh(cx: number, cy: number, cz: number): void {
    // A chunk without a mesh yet is meshed by the next walk, from its new version. The edit may
    // have opened or closed a way through it, so walk again too.
    this.dirty = true;
    this.walkNow = true;
    this.unsettle(cx, cz);
    const key = chunkKey(cx, cy, cz);
    const chunk = this.world.getChunk(cx, cy, cz);
    if (!chunk || !this.meshed.has(key) || !this.neighboursLoaded(cx, cz)) return;
    const col = this.columns.get(columnKey(cx, cz));
    const lod = col?.lod ?? 0;
    const seams = col?.seams ?? 0;
    if (chunk.empty) this.renderer.remove(key);
    else {
      const padded = paddedBlocks(this.world, cx, cy, cz, this.padded);
      const light = paddedLight(this.world, cx, cy, cz, this.paddedLight);
      if (lod || seams) prepareLod(padded, light, lod, seams);
      this.renderer.set(key, cx, cy, cz, meshChunk(padded, cx, cy, cz, light, lod > 0));
    }
    this.meshed.set(key, stamp(chunk.version, lod, seams));
  }

  private apply(result: JobResult): void {
    this.running--;
    if (result.kind === 'generate') {
      this.generating.delete(columnKey(result.cx, result.cz));
      // It, and its neighbours (now perhaps ready), have work again.
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.unsettle(result.cx + dx, result.cz + dz);
      if (this.inKeepRange(result.cx, result.cz)) {
        this.world.addColumn(result.cx, result.cz, result.chunks, result.connectivity, result.light);
        this.walkSoon = true;
      }
      return;
    }
    const { cx, cy, cz, version: made } = result;
    const key = chunkKey(cx, cy, cz);
    this.unsettle(cx, cz);
    if (this.spare.length < SPARE_PADDED) this.spare.push(result.padded);
    if (this.spareLight.length < SPARE_PADDED) this.spareLight.push(result.paddedLight);
    if (this.meshing.get(key) === made) this.meshing.delete(key);
    // Gone, out of range, or edited since: drop it. If still wanted, `dispatch` meshes it again.
    const chunk = this.world.getChunk(cx, cy, cz);
    if (!chunk || chunk.version !== versionOf(made) || !this.inKeepRange(cx, cz)) return;
    // Made in a form the column has since left: better than no mesh or an older one, but never
    // in place of one in the form it has now (a newer job's result can arrive first).
    const col = this.columns.get(columnKey(cx, cz));
    const wanted = col ? stamp(chunk.version, col.lod, col.seams) : made;
    if (made !== wanted && this.meshed.get(key) === wanted) return;
    this.renderer.set(key, cx, cy, cz, result.mesh);
    this.renderer.setVisible(key, this.reachable.has(key));
    this.meshed.set(key, made);
  }

  /** Work out which chunks could be seen from the player's chunk; show those meshes, hide the rest. */
  private walk(): void {
    const { cx, cz } = this.centre;
    if (Number.isNaN(cx)) return;
    const r = TUNING.view.radius;
    // Above or below the world, start from its top or bottom chunk.
    const cy = Math.max(MIN_CHUNK_Y, Math.min(MAX_CHUNK_Y, this.centre.cy));
    this.reachable = reachableChunks(
      [cx, cy, cz],
      (x, y, z) => y >= MIN_CHUNK_Y && y <= MAX_CHUNK_Y && (x - cx) ** 2 + (z - cz) ** 2 <= r * r,
      // A chunk not loaded yet counts as open, so the walk carries on into it until it is.
      (x, y, z) => this.world.getChunk(x, y, z)?.connectivity ?? ALL_CONNECTED,
    );
    for (const key of this.meshed.keys()) this.renderer.setVisible(key, this.reachable.has(key));
    // What can be seen has changed: every column may have chunks to mesh, or none.
    for (const col of this.order) col.settled = false;
  }

  /** Column (cx, cz) may have work again. */
  private unsettle(cx: number, cz: number): void {
    const col = this.columns.get(columnKey(cx, cz));
    if (col) col.settled = false;
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
    // Two passes: first generation and chunks with no mesh at all (holes); then chunks meshed in
    // a form their column has since left (a level change), which show the old mesh meanwhile.
    // Flying at view distance 16, level changes otherwise took the workers from the holes.
    for (const remeshing of [false, true]) {
      for (const col of this.order) {
        if (col.settled) continue;
        if (remeshing && !col.chunks) continue;
        const { cx, cz, key } = col;
        if (!col.chunks) {
          if (world.hasColumn(cx, cz)) {
            col.chunks = [];
            for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) col.chunks.push(world.getChunk(cx, cy, cz)!);
          }
        }
        if (!col.chunks) {
          if (this.generating.has(key) || this.reading.has(key)) continue;
          // A column with saved chunks is read first (from IndexedDB: a few ms, off this thread).
          if (this.saves?.has(cx, cz) && !this.read.has(key)) {
            this.reading.add(key);
            queued++;
            this.saves.load(cx, cz).then(
              (saved) => this.readDone(key, saved),
              (e: unknown) => {
                console.error('reading saved chunks failed:', e);
                this.readDone(key, []);
              },
            );
            continue;
          }
          if (!canStart()) {
            queued++;
            continue;
          }
          const saved = this.read.get(key) ?? [];
          this.read.delete(key);
          this.generating.add(key);
          this.running++;
          this.runner.run({ kind: 'generate', id: this.nextId++, seed: world.generator.seed, cx, cz, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y, saved });
          continue;
        }
        if (!col.mesh) {
          col.settled = true;
          continue;
        }

        // Busy: something here is waiting or running, so look again next time.
        let busy = false;
        for (const cy of this.heights) {
          const chunk = col.chunks[cy - MIN_CHUNK_Y];
          const key = chunk.key;
          const want = stamp(chunk.version, col.lod, col.seams);
          const shown = this.meshed.get(key);
          if (shown === want) continue;
          if (this.meshing.get(key) === want) {
            busy = true;
            continue;
          }
          // A remesh waits for the second pass; a chunk with no mesh was the first pass's.
          if (shown === undefined ? remeshing : !remeshing) {
            if (shown !== undefined || this.reachable.has(key)) busy = true;
            continue;
          }
          // All air has no faces (the faces of blocks next to it belong to their own chunks).
          if (chunk.empty) {
            this.renderer.remove(key);
            this.meshed.set(key, want);
            continue;
          }
          // Can't be seen from here: leave it until it can.
          if (!this.reachable.has(key)) continue;
          // Border faces and AO need the neighbours, or they'd be drawn against "air".
          col.ready ||= this.neighboursLoaded(cx, cz);
          busy = true;
          if (!col.ready || !canStart()) {
            queued++;
            continue;
          }
          const padded = paddedBlocks(world, cx, cy, cz, this.spare.pop() ?? new Uint8Array(PADDED_VOLUME));
          const light = paddedLight(world, cx, cy, cz, this.spareLight.pop() ?? new Uint8Array(PADDED_VOLUME));
          this.meshing.set(key, want);
          this.running++;
          this.runner.run({ kind: 'mesh', id: this.nextId++, cx, cy, cz, version: want, padded, paddedLight: light, lod: col.lod, seams: col.seams });
        }
        if (!busy && remeshing) col.settled = true;
      }
    }
    this.queued = queued;
    this.dirty = outOfTime;
  }

  private readDone(key: string, saved: SavedChunk[]): void {
    this.reading.delete(key);
    this.read.set(key, saved);
    const col = this.columns.get(key);
    if (col) col.settled = false;
    this.dirty = true;
  }

  private neighboursLoaded(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.world.hasColumn(cx + dx, cz + dz)) return false;
    return true;
  }

  /**
   * Columns to mesh (within the view radius) and their neighbours (to generate), by
   * `columnPriority`; the level of detail of each to mesh, kept from before within the
   * hysteresis, and its seams.
   */
  private rebuildOrder(): void {
    const { cx, cz } = this.centre;
    const r = TUNING.view.radius;
    const inView = (dx: number, dz: number) => dx * dx + dz * dz <= r * r;
    const before = new Map(this.columns);
    this.order = [];
    this.columns.clear();
    for (let dz = -r - 1; dz <= r + 1; dz++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const mesh = inView(dx, dz);
        let neighbour = false;
        for (let ez = -1; ez <= 1 && !mesh && !neighbour; ez++) for (let ex = -1; ex <= 1; ex++) if (inView(dx + ex, dz + ez)) neighbour = true;
        if (!mesh && !neighbour) continue;
        const key = columnKey(cx + dx, cz + dz);
        // The level it has now counts only if it was drawn (columns only generated have none).
        const was = before.get(key);
        const lod = mesh ? lodLevel(Math.sqrt(dx * dx + dz * dz), was?.mesh ? was.lod : null) : 0;
        const col: Column = { cx: cx + dx, cz: cz + dz, key, mesh, lod, seams: wallsFor(lod), priority: 0, chunks: null, ready: false, settled: false };
        this.order.push(col);
        this.columns.set(col.key, col);
      }
    }
    this.resort();
    this.sortHeights();
  }

  /** The same columns, in order for the current look direction. */
  private resort(): void {
    const { cx, cz } = this.centre;
    for (const col of this.order) col.priority = columnPriority(col.cx - cx, col.cz - cz, this.look.x, this.look.z);
    this.order.sort((a, b) => a.priority - b.priority);
  }

  /** Within a column, chunks nearest the player's height first. */
  private sortHeights(): void {
    const cy = this.centre.cy;
    this.heights = [];
    for (let h = MIN_CHUNK_Y; h <= MAX_CHUNK_Y; h++) this.heights.push(h);
    this.heights.sort((a, b) => Math.abs(a - cy) - Math.abs(b - cy));
  }

  /** Columns this close (in chunks, either axis) stay loaded; beyond, they're unloaded. */
  private inKeepRange(cx: number, cz: number): boolean {
    const limit = TUNING.view.radius + TUNING.view.unloadMargin;
    return Math.max(Math.abs(cx - this.centre.cx), Math.abs(cz - this.centre.cz)) <= limit;
  }

  private unloadFar(): void {
    const leaving = [...this.world.chunks.values()].filter((c) => !this.inKeepRange(c.cx, c.cz));
    // Their edits are written first, while the blocks are still here.
    this.saves?.unloading(leaving);
    for (const chunk of leaving) {
      this.renderer.remove(chunk.key);
      this.meshed.delete(chunk.key);
      this.world.unload(chunk);
    }
    for (const key of this.read.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      if (!this.inKeepRange(cx, cz)) this.read.delete(key);
    }
  }
}
