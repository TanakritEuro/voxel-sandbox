import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChunkLoader, type ChunkSink } from '../src/chunkLoader';
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

/** Frames until nothing is left to do: update, then the workers finish `perFrame` jobs. */
function settle({ loader, runner }: ReturnType<typeof setup>, x: number, z: number, perFrame = Infinity): void {
  for (let frame = 0; frame < 10_000; frame++) {
    loader.update(x, z);
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
  it('meshes every chunk in view once, the same as meshing on the main thread', () => {
    const s = setup();
    settle(s, 16, 16);
    for (const [cx, cy, cz] of inView(0, 0)) {
      const chunk = s.world.getChunk(cx, cy, cz)!;
      expect(chunk).toBeDefined();
      const key = chunkKey(cx, cy, cz);
      if (chunk.empty) expect(s.sink.meshes.has(key)).toBe(false);
      else {
        expect(s.sink.meshes.get(key)).toEqual(fresh(s.world, cx, cy, cz));
        expect(s.sink.sets.get(key)).toBe(1);
      }
    }
    expect(s.loader.missing(RADIUS)).toBe(0);
    // All-air chunks never become jobs.
    for (const job of s.runner.jobs) if (job.kind === 'mesh') expect(s.world.getChunk(job.cx, job.cy, job.cz)!.empty).toBe(false);
  });

  it('starts work nearest first', () => {
    const s = setup(1);
    settle(s, 16, 16, 1);
    const d2 = (j: Job) => j.cx * j.cx + j.cz * j.cz;
    for (const kind of ['generate', 'mesh'] as const) {
      const order = s.runner.jobs.filter((j) => j.kind === kind).map(d2);
      expect(order.length).toBeGreaterThan(0);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
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
    s.loader.update(16, 16); // starts generating around the origin
    expect(s.runner.waiting).toBeGreaterThan(0);
    const far = 100 * CHUNK_SIZE;
    s.loader.update(far, far); // the player jumps away before any result is back
    s.runner.deliver();
    settle(s, far, far);
    for (const chunk of s.world.chunks.values()) expect(Math.abs(chunk.cx)).toBeGreaterThan(50);
    for (const key of s.sink.meshes.keys()) expect(Math.abs(Number(key.split(',')[0]))).toBeGreaterThan(50);
    expect(s.loader.missing(RADIUS)).toBe(0);
  });

  it('drops a mesh made before an edit and meshes the edited chunk', () => {
    const s = setup(64);
    s.loader.update(16, 16);
    s.runner.deliver(); // columns generated
    s.loader.update(16, 16); // mesh jobs start
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
    for (let i = 0; i < 5; i++) s.loader.update(16, 16);
    expect(s.runner.jobs.length).toBe(jobs);
    expect(s.loader.pending).toBe(0);
  });
});
