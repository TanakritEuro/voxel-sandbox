import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChunkLoader, type ChunkSink, columnPriority } from '../src/chunkLoader';
import { TUNING } from '../src/config';
import { type ChunkMesh, meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { handleJob } from '../src/workers/jobs';
import type { Job, JobResult, JobRunner } from '../src/workers/protocol';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, chunkKey, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { World } from '../src/world/world';

/** Runs jobs at once on this thread but hands results back only when told, like workers finishing later. */
class FakeRunner implements JobRunner {
  onResult: (result: JobResult) => void = () => {};
  readonly jobs: Job[] = [];
  private readonly done: JobResult[] = [];

  constructor(
    readonly capacity: number,
    private readonly check: (job: Job) => void = () => {},
  ) {}

  run(job: Job): void {
    this.check(job);
    this.jobs.push(job);
    this.done.push(handleJob(job));
  }

  deliver(n = Infinity): void {
    for (const r of this.done.splice(0, n)) this.onResult(r);
  }

  get waiting(): number {
    return this.done.length;
  }
}

/** Records meshes by chunk key, and how often each was set. */
class FakeSink implements ChunkSink {
  readonly meshes = new Map<string, ChunkMesh>();
  readonly sets = new Map<string, number>();
  set(key: string, _cx: number, _cy: number, _cz: number, mesh: ChunkMesh): void {
    this.meshes.set(key, mesh);
    this.sets.set(key, (this.sets.get(key) ?? 0) + 1);
  }
  remove(key: string): void {
    this.meshes.delete(key);
    this.hidden.delete(key);
  }
  readonly hidden = new Set<string>();
  setVisible(key: string, visible: boolean): void {
    if (visible) this.hidden.delete(key);
    else this.hidden.add(key);
  }
}

const RADIUS = 2;
const saved = { ...TUNING.view };
beforeEach(() => {
  TUNING.view.radius = RADIUS;
  TUNING.view.unloadMargin = 2;
  TUNING.view.applyBudgetMs = 1e9; // no time limit: the tests are about order, not timing
});
afterEach(() => Object.assign(TUNING.view, saved));

function setup(capacity = 8, check?: (job: Job, world: World) => void) {
  const world = new World(20261022);
  const sink = new FakeSink();
  const runner = new FakeRunner(capacity, (job) => check?.(job, world));
  const loader = new ChunkLoader(world, sink, runner);
  return { world, sink, runner, loader };
}

/** The player's eye height in the tests: chunk layer 1. */
const EYE = 60;

/** Frames until nothing is left to do: update (looking along +x), then the workers finish `perFrame` jobs. */
function settle({ loader, runner }: ReturnType<typeof setup>, x: number, z: number, perFrame = Infinity): void {
  for (let frame = 0; frame < 10_000; frame++) {
    loader.update(x, EYE, z, 1, 0);
    if (loader.pending === 0 && runner.waiting === 0) return;
    runner.deliver(perFrame);
  }
  throw new Error('never settled');
}

/** Chunks of the columns within the view radius of column (cx, cz). */
function inView(cx: number, cz: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let dz = -RADIUS; dz <= RADIUS; dz++)
    for (let dx = -RADIUS; dx <= RADIUS; dx++)
      if (dx * dx + dz * dz <= RADIUS * RADIUS) for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) out.push([cx + dx, cy, cz + dz]);
  return out;
}

const fresh = (world: World, cx: number, cy: number, cz: number) => meshChunk(paddedBlocks(world, cx, cy, cz), cx, cy, cz);

describe('chunk loader', () => {
  it('meshes every chunk in view that could be seen, once, the same as meshing on the main thread', () => {
    const s = setup();
    settle(s, 16, 16);
    let seen = 0;
    for (const [cx, cy, cz] of inView(0, 0)) {
      const chunk = s.world.getChunk(cx, cy, cz)!;
      expect(chunk).toBeDefined();
      const key = chunkKey(cx, cy, cz);
      if (chunk.empty) expect(s.sink.meshes.has(key)).toBe(false);
      // Out of sight: not drawn (a walk during loading may have meshed it before its neighbours
      // were known; it stays hidden).
      else if (!s.loader.canSee(cx, cy, cz)) expect(!s.sink.meshes.has(key) || s.sink.hidden.has(key)).toBe(true);
      else {
        expect(s.sink.meshes.get(key)).toEqual(fresh(s.world, cx, cy, cz));
        expect(s.sink.sets.get(key)).toBe(1);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(s.loader.missing(RADIUS)).toBe(0);
    // All-air chunks never become jobs.
    for (const job of s.runner.jobs) if (job.kind === 'mesh') expect(s.world.getChunk(job.cx, job.cy, job.cz)!.empty).toBe(false);
  });

  it('ranks columns near first and in front before behind', () => {
    // Looking along +x.
    expect(columnPriority(0, 0, 1, 0)).toBe(0);
    expect(columnPriority(-1, 0, 1, 0)).toBeLessThan(columnPriority(2, 0, 1, 0)); // the ones underfoot first, whatever the direction
    expect(columnPriority(5, 0, 1, 0)).toBeLessThan(columnPriority(0, 4, 1, 0)); // ahead at 5 before beside at 4
    expect(columnPriority(0, 4, 1, 0)).toBeLessThan(columnPriority(-4, 0, 1, 0)); // beside before behind
    expect(columnPriority(-3, 0, 1, 0)).toBeCloseTo(columnPriority(6, 0, 1, 0)); // behind counts double
    expect(columnPriority(3, 4, 0, 0)).toBeLessThan(columnPriority(6, 0, 0, 0)); // no direction: plain distance
  });

  it('starts work in priority order, and the player\'s height first within a column', () => {
    TUNING.view.radius = 5;
    const r = TUNING.view.radius;
    const priority = (cx: number, cz: number) => columnPriority(cx, cz, 1, 0);
    // A chunk's mesh can wait for a neighbouring column further down the order, so meshes
    // aren't strictly in order: but none starts while a higher-priority chunk is ready.
    const started = new Set<string>();
    let meshes = 0;
    const s = setup(1, (job, world) => {
      if (job.kind !== 'mesh') return;
      meshes++;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r || priority(dx, dz) >= priority(job.cx, job.cz)) continue;
          let ready = true;
          for (let ez = -1; ez <= 1; ez++) for (let ex = -1; ex <= 1; ex++) ready &&= world.hasColumn(dx + ex, dz + ez);
          if (!ready) continue;
          for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
            if (!world.getChunk(dx, cy, dz)!.empty && s.loader.canSee(dx, cy, dz)) expect(started.has(chunkKey(dx, cy, dz))).toBe(true);
          }
        }
      started.add(chunkKey(job.cx, job.cy, job.cz));
    });
    settle(s, 16, 16, 1);
    expect(meshes).toBeGreaterThan(10);
    const generated = s.runner.jobs.filter((j) => j.kind === 'generate').map((j) => priority(j.cx, j.cz));
    expect(generated.length).toBeGreaterThan(10);
    expect(generated).toEqual([...generated].sort((a, b) => a - b));
    const heights = s.runner.jobs.flatMap((j) => (j.kind === 'mesh' && j.cx === 0 && j.cz === 0 ? [Math.abs(j.cy - 1)] : []));
    expect(heights.length).toBeGreaterThan(1);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });

  it('sorts again after turning round', () => {
    TUNING.view.radius = 5;
    const s = setup(1);
    const frames = (lookX: number, n: number) => {
      for (let frame = 0; frame < n; frame++) {
        s.loader.update(16, EYE, 16, lookX, 0);
        s.runner.deliver();
      }
    };
    // Facing -x first: the order columns are listed in starts at -x too, so the turn to +x is
    // what must change the order (a loader ignoring the look would keep going at -x).
    frames(-1, 60);
    const before = s.runner.jobs.length;
    // Facing -x, the loader got past the columns underfoot to ones ahead.
    expect(s.runner.jobs.some((j) => j.kind === 'generate' && j.cx <= -2)).toBe(true);
    frames(1, 20); // turn to face +x
    // The columns underfoot come first whatever the direction, so the turn shows in the
    // next column generated: on the new side.
    const generated = s.runner.jobs.slice(before).filter((j) => j.kind === 'generate');
    expect(generated.length).toBeGreaterThan(0);
    expect(generated[0].cx).toBeGreaterThan(0);
  });

  it('meshes a deep chunk only once it can be seen, and hides it again from above', () => {
    const s = setup();
    const at = (y: number) => {
      for (let frame = 0; frame < 10_000; frame++) {
        s.loader.update(16, y, 16, 1, 0);
        if (s.loader.pending === 0 && s.runner.waiting === 0) return;
        s.runner.deliver();
      }
    };
    const deep = chunkKey(0, 0, 0);
    at(150); // up in the sky
    expect(s.loader.canSee(0, 0, 0)).toBe(false);
    expect(s.sink.meshes.has(deep)).toBe(false);
    at(10); // down in it
    expect(s.loader.canSee(0, 0, 0)).toBe(true);
    expect(s.sink.meshes.get(deep)).toEqual(fresh(s.world, 0, 0, 0));
    expect(s.sink.hidden.has(deep)).toBe(false);
    at(150); // back up: kept, but not drawn
    expect(s.sink.meshes.has(deep)).toBe(true);
    expect(s.sink.hidden.has(deep)).toBe(true);
  });

  it('meshes a chunk only once the columns around it are loaded', () => {
    let checked = 0;
    const s = setup(3, (job, world) => {
      if (job.kind !== 'mesh') return;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) expect(world.hasColumn(job.cx + dx, job.cz + dz)).toBe(true);
      checked++;
    });
    settle(s, 16, 16, 2);
    expect(checked).toBeGreaterThan(0);
  });

  it('drops results for chunks that went out of range, and loads the new view', () => {
    const s = setup(64);
    s.loader.update(16, EYE, 16, 1, 0); // starts generating around the origin
    expect(s.runner.waiting).toBeGreaterThan(0);
    const far = 100 * CHUNK_SIZE;
    s.loader.update(far, EYE, far, 1, 0); // the player jumps away before any result is back
    s.runner.deliver();
    settle(s, far, far);
    for (const chunk of s.world.chunks.values()) expect(Math.abs(chunk.cx)).toBeGreaterThan(50);
    for (const key of s.sink.meshes.keys()) expect(Math.abs(Number(key.split(',')[0]))).toBeGreaterThan(50);
    expect(s.loader.missing(RADIUS)).toBe(0);
  });

  it('drops a mesh made before an edit and meshes the edited chunk', () => {
    const s = setup(64);
    s.loader.update(16, EYE, 16, 1, 0);
    s.runner.deliver(); // columns generated
    s.loader.update(16, EYE, 16, 1, 0); // mesh jobs start
    const job = s.runner.jobs.find((j): j is Extract<Job, { kind: 'mesh' }> => j.kind === 'mesh' && j.cx === 0 && j.cz === 0)!;
    const x = job.cx * CHUNK_SIZE + 5;
    const y = job.cy * CHUNK_SIZE + 5;
    const z = job.cz * CHUNK_SIZE + 5;
    const block = s.world.getBlock(x, y, z) === Block.Air ? Block.Glass : Block.Air;
    for (const c of s.world.setBlock(x, y, z, block)) s.loader.remesh(c.cx, c.cy, c.cz);
    settle(s, 16, 16);
    const key = chunkKey(job.cx, job.cy, job.cz);
    expect(s.sink.meshes.get(key)).toEqual(fresh(s.world, job.cx, job.cy, job.cz));
    expect(s.sink.sets.get(key)).toBe(1); // the stale result was never shown
  });

  it('remeshes an edited chunk at once, on this thread', () => {
    const s = setup();
    settle(s, 16, 16);
    const jobs = s.runner.jobs.length;
    for (const c of s.world.setBlock(31, 60, 31, Block.Planks)) s.loader.remesh(c.cx, c.cy, c.cz);
    expect(s.runner.jobs.length).toBe(jobs);
    for (const [cx, cy, cz] of [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]] as const) {
      expect(s.sink.meshes.get(chunkKey(cx, cy, cz))).toEqual(fresh(s.world, cx, cy, cz));
    }
  });

  it('starts nothing on idle frames', () => {
    const s = setup();
    settle(s, 16, 16);
    const jobs = s.runner.jobs.length;
    for (let i = 0; i < 5; i++) s.loader.update(16, EYE, 16, 1, 0);
    expect(s.runner.jobs.length).toBe(jobs);
    expect(s.loader.pending).toBe(0);
  });
});
