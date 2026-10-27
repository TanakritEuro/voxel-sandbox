import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChunkLoader, type ChunkSink, columnPriority, lodLevel } from '../src/chunkLoader';
import { TUNING } from '../src/config';
import { type Lod, prepareLod, SEAM_NEG_X, SEAM_NEG_Z, SEAM_POS_X, SEAM_POS_Z } from '../src/mesh/lod';
import { type ChunkMesh, meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { WorldSaver } from '../src/save/saver';
import { MemoryStore, newWorldRecord } from '../src/save/store';
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
  /** setVisible calls: a walk makes one per meshed chunk. */
  shows = 0;
  setVisible(key: string, visible: boolean): void {
    this.shows++;
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

function setup(capacity = 8, check?: (job: Job, world: World) => void, saver?: WorldSaver) {
  const world = new World(20261022);
  const sink = new FakeSink();
  const runner = new FakeRunner(capacity, (job) => check?.(job, world));
  const loader = new ChunkLoader(world, sink, runner, saver);
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

const fresh = (world: World, cx: number, cy: number, cz: number) => meshChunk(paddedBlocks(world, cx, cy, cz), cx, cy, cz, paddedLight(world, cx, cy, cz));

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

  it('turns without walking again or starting work once loaded (turning used to cost a frame)', () => {
    const s = setup();
    settle(s, 16, 16);
    const jobs = s.runner.jobs.length;
    const shows = s.sink.shows;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 4 * Math.PI;
      s.loader.update(16, EYE, 16, Math.cos(a), Math.sin(a));
    }
    expect(s.sink.shows).toBe(shows);
    expect(s.runner.jobs.length).toBe(jobs);
    expect(s.loader.pending).toBe(0);
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

  it('writes an edited chunk as it is unloaded, and reads it back into its column on return', async () => {
    const saver = await WorldSaver.open(new MemoryStore(), newWorldRecord('w', 'Test', 20261022, 0));
    const s = setup(8, undefined, saver);
    /** As \`settle\`, but letting reads of saved chunks finish between frames. */
    const settleAsync = async (x: number, z: number) => {
      for (let frame = 0; frame < 10_000; frame++) {
        s.loader.update(x, EYE, z, 1, 0);
        if (s.loader.pending === 0 && s.runner.waiting === 0) return;
        s.runner.deliver();
        await new Promise((r) => setTimeout(r, 0));
      }
      throw new Error('never settled');
    };
    await settleAsync(16, 16);
    expect(s.world.setBlock(5, 60, 5, Block.Glass).length).toBeGreaterThan(0);
    const chunk = s.world.getChunk(0, 1, 0)!;
    saver.edited(chunk);

    // Far away: the chunk is gone from memory, and written.
    await settleAsync(16 + CHUNK_SIZE * 12, 16);
    expect(s.world.getChunk(0, 1, 0)).toBeUndefined();
    expect(saver.isSaved(chunk)).toBe(true);
    expect(saver.unsaved).toBe(0);

    // Back again: the column is generated with the saved chunk in it, and meshed with the glass.
    const jobs = s.runner.jobs.length;
    await settleAsync(16, 16);
    expect(s.world.getBlock(5, 60, 5)).toBe(Block.Glass);
    const generated = s.runner.jobs.slice(jobs).find((j) => j.kind === 'generate' && j.cx === 0 && j.cz === 0);
    expect(generated?.kind === 'generate' && generated.saved.map((c) => c.cy)).toEqual([1]);
    expect(s.sink.meshes.get(chunkKey(0, 1, 0))).toEqual(fresh(s.world, 0, 1, 0));
  });

  it('follows a new view distance: unloads beyond it when smaller, fills it when larger', () => {
    const s = setup();
    settle(s, 16, 16);
    const shown = () => [...s.sink.meshes.keys()].filter((k) => !s.sink.hidden.has(k)).map((k) => k.split(',').map(Number));

    TUNING.view.radius = 1;
    s.loader.radiusChanged();
    settle(s, 16, 16);
    const keep = 1 + TUNING.view.unloadMargin;
    for (const c of s.world.chunks.values()) expect(Math.max(Math.abs(c.cx), Math.abs(c.cz))).toBeLessThanOrEqual(keep);
    for (const [cx, , cz] of shown()) expect(cx * cx + cz * cz).toBeLessThanOrEqual(1);
    expect(s.loader.missing(1)).toBe(0);

    TUNING.view.radius = 3;
    s.loader.radiusChanged();
    settle(s, 16, 16);
    expect(s.loader.missing(3)).toBe(0);
    expect(shown().some(([cx, , cz]) => cx * cx + cz * cz > 4)).toBe(true);
  });
});

describe('levels of detail', () => {
  it('pick a level by distance, and change it only past the hysteresis', () => {
    TUNING.view.lod = { near: 7, far: 11, hysteresis: 0.5 };
    expect([0, 6.9, 7, 10.9, 11, 16].map((d) => lodLevel(d, null))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(lodLevel(7.4, 0)).toBe(0); // inside the band: stays
    expect(lodLevel(7.5, 0)).toBe(1);
    expect(lodLevel(6.6, 1)).toBe(1);
    expect(lodLevel(6.4, 1)).toBe(0);
    expect(lodLevel(11.4, 1)).toBe(1);
    expect(lodLevel(12, 0)).toBe(2); // a jump straight past both
    expect(lodLevel(3, 2)).toBe(0);
  });

  /** What a chunk meshed at `lod` with `seams` looks like. */
  const lodMesh = (world: World, cx: number, cy: number, cz: number, lod: Lod, seams: number) => {
    const b = paddedBlocks(world, cx, cy, cz);
    const l = paddedLight(world, cx, cy, cz);
    prepareLod(b, l, lod, seams);
    return meshChunk(b, cx, cy, cz, l, lod > 0);
  };
  /**
   * The level and seams column (cx, cz) should have with the player in column (pcx, pcz), the
   * player having been in column (from) before (hysteresis), or nowhere.
   */
  const formOf = (cx: number, cz: number, pcx: number, pcz: number, from: [number, number] | null = null): [Lod, number] => {
    const r = TUNING.view.radius;
    const level = (x: number, z: number): Lod => {
      const was = from && (x - from[0]) ** 2 + (z - from[1]) ** 2 <= r * r ? lodLevel(Math.hypot(x - from[0], z - from[1]), null) : null;
      return lodLevel(Math.hypot(x - pcx, z - pcz), was);
    };
    const lod = level(cx, cz);
    return [lod, lod > 0 ? SEAM_NEG_X | SEAM_POS_X | SEAM_NEG_Z | SEAM_POS_Z : 0];
  };

  it('mesh each column at its level, far ones walled on every side', () => {
    TUNING.view.lod = { near: 1, far: 2, hysteresis: 0.5 };
    const s = setup();
    settle(s, 16, 16);
    const levels = new Set<number>();
    let compared = 0;
    for (const [cx, cy, cz] of inView(0, 0)) {
      const key = chunkKey(cx, cy, cz);
      if (!s.sink.meshes.has(key) || s.sink.hidden.has(key)) continue;
      const [lod, seams] = formOf(cx, cz, 0, 0);
      levels.add(lod);
      expect(s.sink.meshes.get(key), `${key} at level ${lod}, seams ${seams}`).toEqual(lodMesh(s.world, cx, cy, cz, lod, seams));
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
    expect([...levels].sort()).toEqual([0, 1, 2]);
    expect(s.loader.levels).toEqual([1, 8, 4]); // the radius-2 circle: the centre, the 8 round it, 4 at distance 2
  });

  it('remesh only the columns whose level changes when the player moves, keeping the old mesh meanwhile', () => {
    TUNING.view.radius = 4;
    TUNING.view.lod = { near: 2, far: 3, hysteresis: 0.5 };
    const s = setup(64);
    settle(s, 16, 16);
    const before = new Map(s.sink.sets);
    const shown = new Map(s.sink.meshes);
    // One column along +x: the jobs start, but no result is in yet; every mesh is still there.
    s.loader.update(48, EYE, 16, 1, 0);
    for (const [key, mesh] of shown) expect(s.sink.meshes.get(key), key).toBe(mesh);
    s.runner.deliver();
    settle(s, 48, 16);
    let remeshed = 0;
    let kept = 0;
    const around = (pcx: number) => {
      const out: [number, number, number][] = [];
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dz * dz <= 16) for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) out.push([pcx + dx, cy, dz]);
      return out;
    };
    const after = new Set(around(1).map((c) => c.join()));
    for (const [cx, cy, cz] of around(0)) {
      if (!after.has([cx, cy, cz].join())) continue; // gone out of view
      const key = chunkKey(cx, cy, cz);
      if (!before.has(key) || !s.sink.meshes.has(key) || s.sink.hidden.has(key)) continue;
      const [oldLod, oldSeams] = formOf(cx, cz, 0, 0);
      const [lod, seams] = formOf(cx, cz, 1, 0, [0, 0]);
      const changed = oldLod !== lod || oldSeams !== seams;
      expect(s.sink.sets.get(key)! - before.get(key)!, key).toBe(changed ? 1 : 0);
      if (changed) remeshed++;
      else kept++;
      expect(s.sink.meshes.get(key), `${key} at level ${lod}, seams ${seams} (was ${oldLod}, ${oldSeams})`).toEqual(lodMesh(s.world, cx, cy, cz, lod, seams));
    }
    expect(remeshed).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });
});
