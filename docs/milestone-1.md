# Milestone 1 plan: fast engine

## Status: in progress (steps 1–4 of 5 done)

Approved 2026-10-23: drop the brightness jitter, edits remesh synchronously on the main
thread, radius 8 at the end if the numbers allow.

## Results so far

**Step 1 (measuring tools).** `npm run bench` on the scaffold (seed 20261022,
radius 8: 1012 chunks generated, 788 meshed; median of 5 runs, ms per chunk):

| | mean | p95 | max | |
| --- | --- | --- | --- | --- |
| generate | 0.98 | 1.56 | 3.62 | 506 of 1012 chunks are all air |
| pad | 0.90 | 1.32 | 2.59 | |
| mesh (culled) | 1.70 | 4.43 | 5.74 | 568k triangles, 32.5 MB vertex data |

`?autofly` in the desktop app's browser pane (dev server, dev machine with 12 threads):

| | radius 7 | radius 8 |
| --- | --- | --- |
| First view | 1.9 s | 2.3 s |
| Frame p50 / p99 / max | 16.7 / 16.9 / 17.0 ms | 16.7 / 17.0 / 17.1 ms |
| Frames over 20 ms | 0 | 0 |
| Main thread p50 / p99 / max | | 1.5 / 11.1 / 14.9 ms |
| Holes, most pending | 0, 39 | 0, 56 |

A fast desktop already holds radius 8 with the scaffold, so frame drops don't separate
before from after here. Main-thread time per frame does: its p99 is the 8 ms loading
budget plus rendering, and on a laptop two or three times slower that is a dropped frame.
Autofly reports it for that reason. Runs taken while the pane or the Chrome window was
hidden or covered froze or ran at 1 fps (the page still says "visible"); autofly flags any
gap over 500 ms as a stall, and those runs are discarded.

To do: yours on the laptop.

**Step 2 (main-thread wins).** Bench now generates by column, skips all-air chunks as the
loader does, and reports totals (per-item means aren't comparable across the change):

| total ms, radius 8 bench | scaffold | step 2 |
| --- | --- | --- |
| generate | 992 (1012 chunks) | 210 (253 columns) |
| pad | 709 (788 chunks) | 32 (394 chunks) |
| mesh (culled) | 1561 for the 394 non-empty chunks | 1586; worst chunk 13.0 → 10.7 ms |
| vertex data | 32.5 MB | 20.6 MB |

Meshing speed is unchanged: its cost is the per-block loop, which step 3 replaces. The
typed-array builder stops it allocating `number[]`s (the worst chunk dropped).
`?autofly&radius=8` in the pane: first view 2.3 → 1.1 s, most chunks pending 56 → 7,
main thread p99 11.1 → 10.5 ms and max 14.9 → 13.7 ms (still the 8 ms loading budget
plus rendering, until workers), meshes in memory 40.1 → 25.4 MB.

Found on the way: under Vitest an imported constant costs a property lookup on every use
(imports become getters on a module object), so the first builder version benched 50 %
slower until the mesher copied `PADDED` into a local constant, as the scaffold did with
its own sizes. Hot loops keep local copies of imported constants.

**Step 3 (greedy meshing with AO).** Bench, radius 8, the 394 non-empty chunks:

| | culled (scaffold) | greedy with AO |
| --- | --- | --- |
| mesh total | 1694 ms | 280 ms (6×) |
| per chunk mean / p95 / max | 4.30 / 6.93 / 16.2 ms | 0.71 / 1.12 / 2.14 ms |
| triangles | 568k | 207k |
| vertex data | 20.6 MB | 7.5 MB |

`?autofly&radius=8`: first view 1.1 → 0.8 s, most chunks pending 7 → 0, main thread p99
10.5 → 9.5 ms and max 13.7 → 11.0 ms, meshes in memory 25 → 9.6 MB, no frame over 20 ms.
No cracks or holes seen, and no console errors.

Where it differs from the plan:

- **Files:** `meshChunk` in `mesher.ts` is now the greedy mesher (no `greedy.ts`), so no
  caller changed; the scaffold mesher lives on as `meshCulled` in `culled.ts`.
- **AO halves the merging.** On a 17 × 17 column square at radius 8, opaque quads go from
  370k culled faces to 77k greedy without AO (4.8×) but 151k with it (2.45×): AO bands
  along every one-block terrace step split the floors (top faces 32k → 93k). That is the
  known cost of baking AO into vertices; the triangle count is far from being the limit,
  so it stays. The regression guard is "under half the culled faces", not a quarter.
  Lighting in Milestone 4 is the place to revisit it (AO as part of the light values, or
  computed in the shader, would let faces merge again).
- **Diagonal:** split along the pair of opposite corners with the lower AO sum, i.e. a
  lone dark corner sits on the diagonal.
- **The tests** check the greedy mesher against the world rather than against hand
  counts: every quad is rasterised back to unit faces, which must equal the culled
  mesher's set (terrain, block soups of every kind, empty and full chunks) with none twice;
  every unit face inside a quad must have, computed independently from `World.getBlock`,
  exactly the AO its corner colours show; triangles face away from their block; quads
  split along the darker diagonal. Plus hand-checked cases: a slab is 6 quads, a block on a
  floor darkens the right corners, an inside corner is level 0, AO across a diagonal chunk
  corner, and an edit at a chunk corner marks all 7 neighbours stale.

**Step 4 (worker pool and scheduler).** `?autofly`, dev machine (8 workers):

| | main thread, step 3 | workers, dev server | workers, production build |
| --- | --- | --- | --- |
| radius 8: main thread p50 / p99 / max | 0.9 / 9.5 / 11.0 ms | 0.9 / 3.7 / 5.3 ms | 1.1 / 3.7 / 4.2 ms |
| radius 8: first view | 0.8 s | 1.0 s | 0.9 s |
| radius 12: main thread p50 / p99 / max | | | 1.7 / 4.4 / 5.3 ms |
| radius 12: first view, most pending | | | 1.7 s, 27 |

No frame over 20 ms, no holes, no console errors in any run. The first view is a little
slower than step 3 (workers take a moment to start); the main thread's worst frame is
half what it was, and the p99 is now rendering and applying results, not the 8 ms meshing
budget. At radius 12 chunk data is 80 MB, half of it all-air chunks still stored as 32 KB
of zeros: worth sharing one empty array before saving arrives (Milestone 4).

Where it differs from the plan:

- **No queue to cancel.** Each frame the loader walks the columns nearest first and
  starts what's ready up to the pool's capacity (workers × 2), so nothing is queued
  ahead; work for chunks that left the view is simply never started. Results are dropped
  if their column is out of range, or (meshes) if the chunk's version changed since.
- **The walk is skipped** unless a result arrived, the player changed chunk, a block was
  edited, or the last walk ran out of time. Walking every frame cost 0.5 ms at p50.
- **`applyBudgetMs` (3 ms)** covers storing results, padded copies for new mesh jobs and
  creating meshes; it replaces the 8 ms meshing budget.
- **The job handler** is `workers/jobs.ts` (pure, tested directly); `chunkWorker.ts` is
  only the message glue. Padded copies come back with each result and are reused.
- **Tests** drive the loader with a fake runner that runs jobs at once but returns results
  when told: everything in view meshed once and identical to main-thread meshing, nearest
  first, meshing only with neighbours loaded, results dropped after the player jumps
  away, a mesh made before an edit dropped and the edit meshed, edits remeshed at once
  on the main thread, idle frames start nothing. Job results go through
  `structuredClone` with their transfer lists, which detaches every listed buffer.

Goal: fly at sprint speed (36 blocks/s) with no frame over 20 ms, at view radius 8.
Generation and meshing leave the main thread for a worker pool; the mesher becomes
greedy with per-vertex ambient occlusion; chunks load in rings that fill the view
first. Everything is measured before and after: a `?stats` overlay, a scripted flight
(`?autofly`) and a headless `npm run bench`.

## Baseline (scaffold, measured 2026-10-23)

Headless, Node 22, seed 20261022, radius 7 around chunk (0, 0), median of 3 runs:

| | |
| --- | --- |
| Generate | 1.0 ms per chunk (1156 chunks, 1.2 s) |
| Mesh (culled faces) | 2.7 ms per chunk, of which 0.9 ms is `paddedBlocks`; worst 6–15 ms (GC) |
| Triangles in view | 436k (596 chunks) |

Where the time goes: `height()` runs fractal noise 4 times per column (once per chunk
of the column); `paddedBlocks` calls `world.getBlock` (a string-keyed `Map` lookup) for
every border cell; the mesher pushes into `number[]` and then copies to typed arrays;
the per-block brightness jitter stops any two faces from ever being identical.
The in-browser baseline (`?autofly` frame times) is the first thing recorded once the
overlay exists, before any engine change.

## Scope decisions

- **The world stays the single owner of block data, on the main thread.** Workers are
  stateless apart from a `Generator` per seed: a generate job returns blocks
  (transferred to the main thread), a mesh job receives a padded copy (transferred to
  the worker) and returns vertex buffers (transferred back). Edits stay synchronous on
  the main thread and need no syncing with workers.
- **Generation is per column** (cx, cz → all four chunks), sharing one 32 × 32
  heightmap, so noise runs once per column instead of four times. The job takes a
  cy range, so a taller world (Milestone 3) only changes the range. Output is still
  cubic chunks; nothing else changes shape.
- **All-air chunks** come back as `null` (no transfer), are stored as zeros on the
  main thread and are never meshed until edited. The bench counts half of all
  chunks as all air.
- **The brightness jitter goes.** It makes every face unique, so nothing could merge.
  AO gives the ground its variation now; textures arrive in Milestone 3.
- **Edits remesh synchronously on the main thread** (greedy is fast enough), so the
  change shows the same frame with no hole at chunk borders. With AO an edit within
  one block of a chunk edge or corner affects up to 7 neighbours (diagonals too, not
  just the 3 face neighbours as now); `setBlock` returns all of them. If the stats show
  an edit taking over 4 ms, neighbours move to urgent worker jobs swapped in together.
- **Worker count:** `hardwareConcurrency - 1`, capped by `TUNING.workers.max` (8),
  at least 1.
- **Default view radius becomes 8** at the end, if the flight measurements allow it.
- **Out of scope:** textures, lighting, LOD, occlusion culling, compressing chunk data in
  memory. The stats will say whether memory needs attention before Milestone 4.

## Files

| File | Contents |
| --- | --- |
| `src/stats.ts` | `?stats` overlay (F3 toggles): fps, frame time avg / max over 1 s, a 5 s frame-time graph with the 16.7 and 20 ms lines, draw calls and triangles (`renderer.info`), chunks loaded / meshed / empty, jobs queued / in flight, worker busy %, memory (JS heap where the browser has it, plus our own chunk and geometry byte counts), frames over 20 ms since load |
| `src/autofly.ts` | `?autofly[=seconds]`: from spawn, flies a fixed straight heading at sprint speed for 30 s, then prints a report (console and overlay): frame time p50 / p95 / p99 / max, frames over 20 and 33 ms, time until the first full view is meshed, and holes (chunks within the radius without a mesh) sampled each second |
| `bench/bench.ts`, `bench/vitest.config.ts` | `npm run bench`: a fixed set (seed 20261022, columns within radius 8 of the origin), 5 runs, median. Prints generate, pad, mesh (ms per chunk mean / p95 / max), triangles, vertex bytes. Runs the culled mesher and the greedy mesher side by side |
| `src/world/generate.ts` | `generateColumn(cx, cz, cyMin, cyMax)`: one heightmap, chunks of a column, `null` for all-air |
| `src/world/world.ts` | `addColumn()` for worker results; `Chunk.empty` hint; `setBlock` returns diagonal neighbours too |
| `src/mesh/padding.ts` | `paddedBlocks` rewritten: row copies with `subarray`/`set` from the chunk and its 26 neighbours, no per-cell `getBlock` |
| `src/mesh/greedy.ts` | Greedy mesher with AO: the new `meshChunk` |
| `src/mesh/culled.ts` | The scaffold mesher, kept as the test oracle and the bench comparison |
| `src/mesh/builder.ts` | Growable typed-array vertex builder, reused between jobs; slices to exact length at the end |
| `src/workers/protocol.ts` | Job and result message types |
| `src/workers/chunkWorker.ts` | Worker entry: `handleJob(job)` (a pure function, tested directly) plus the `onmessage` glue |
| `src/workers/pool.ts` | `WorkerPool`: spawns workers (`new Worker(new URL(...), { type: 'module' })`), hands a job to an idle worker, routes results, tracks busy time |
| `src/chunkLoader.ts` | Becomes the job scheduler: wanted set, priority queue, dispatch, cancellation, stale-result checks, per-frame budget for applying results. Takes a `JobRunner` interface, so tests drive it with a synchronous fake runner |
| `src/render/chunkRenderer.ts` | New vertex format; bounding spheres from chunk bounds instead of `computeBoundingSphere()` |
| `src/config.ts` | `TUNING.workers` (max, jobs in flight per worker), `TUNING.view.applyBudgetMs` (replaces `meshBudgetMs`), `TUNING.render.ao` (the four AO brightness levels) |

## Key data structures

```ts
/** One pass of a chunk mesh. Positions in world space (no transform), as now. */
interface MeshData {
  positions: Float32Array;              // xyz per vertex
  colors: Uint8Array;                   // rgba per vertex, normalised; face shade × AO baked in
  indices: Uint16Array | Uint32Array;   // Uint16 when under 65 536 vertices (almost always)
}

type Job =
  | { kind: 'generate'; id: number; seed: number; cx: number; cz: number; cyMin: number; cyMax: number }
  | { kind: 'mesh'; id: number; cx: number; cy: number; cz: number; version: number; padded: Uint8Array };

type JobResult =
  | { kind: 'generate'; id: number; cx: number; cz: number; chunks: (Uint8Array | null)[]; ms: number }
  | { kind: 'mesh'; id: number; cx: number; cy: number; cz: number; version: number; mesh: ChunkMesh; ms: number };
```

Greedy mask: per axis, per direction, per slice, a reused `Int32Array(32 × 32)`; each
cell packs block id (8 bits), the face's four AO levels (2 bits each) and the pass, so
two faces merge only when block, AO and pass all match. Width then height extension as
in 0fps; the quad's diagonal is picked by comparing the AO sums of its two pairs of
opposite corners (0fps's rule), so the gradient doesn't crease. AO counts opaque
blocks only; transparent faces (water, glass) get no AO so water stays flat.

## Scheduling

- **Wanted set:** columns within radius + 1 generated, chunks within radius meshed. A
  chunk can be meshed once its 3 × 3 columns are generated.
- **Priority:** ring (whole-chunk distance from the player's column) first; within a
  ring, chunks in front of the camera before those behind (dot product with the look
  direction); within a column, the chunk at the player's height first. Rings 0–1 always
  go first regardless of direction. Recomputed when the player changes chunk or turns
  more than 30°.
- **Dispatch:** at most `workers × 2` jobs in flight, so each worker has its next job
  waiting but the queue stays short enough that cancellation means something.
- **Cancellation:** queued jobs for chunks that left the wanted set are dropped. Results
  of in-flight jobs are dropped if the chunk is no longer wanted, or (mesh) if
  `chunk.version` changed since dispatch, in which case it is queued again.
- **Applying results:** within `applyBudgetMs` (3 ms) per frame: store generated chunks,
  build padded copies, create geometries. Anything left waits for the next frame.

## Tests

- **Greedy covers exactly what culled covers:** rasterise both meshes to unit faces
  (position, normal, pass) and compare the sets: generated terrain chunks, random
  seeded block soups (all block types, chunk borders included), and empty / full chunks.
  Also no unit face covered twice.
- **Merging:** a 32 × 32 × 1 slab in an empty chunk is 6 quads; a checkerboard of two
  blocks doesn't merge; faces with different AO don't merge.
- **AO values:** exact levels at known corners (inside an L, under an overhang), across a
  chunk border and across a diagonal chunk corner; the diagonal flips in a known case.
- **Winding:** the existing counter-clockwise test, run on greedy quads.
- **Padding:** the fast `paddedBlocks` equals the old per-cell version on a world with
  edits near every edge and corner, and with unloaded neighbours.
- **Generation:** `generateColumn` equals four per-chunk generations (determinism kept);
  all-air chunks come back `null`.
- **Edits:** a block on a chunk corner marks all 7 neighbours stale.
- **Worker handler:** `handleJob` round trip for both job kinds; the result buffers are
  the ones listed as transferables.
- **Scheduler** (fake runner): ring order and view-first within a ring; meshing waits for
  neighbours; out-of-range queued jobs are cancelled; stale-version results are dropped
  and requeued; out-of-range results are dropped; nothing is meshed twice.
- **Regression guard:** greedy triangles on the bench set stay under a quarter of culled.

## How it's measured

1. `npm run bench` before and after each engine change; numbers go in this file.
2. `?stats&autofly` on the dev build before and after, same seed. I'll run it in the
   built-in browser; the result that counts is yours on the laptop.
3. Done when: on your laptop, `?autofly` at radius 8 reports no frame over 20 ms after
   the first full view, no holes after the first second, and 60 fps average.

## Order of work (one commit each, playable after each)

1. `npm run bench`, `?stats`, `?autofly`. Record the in-browser baseline.
2. Cheap wins on the main thread: fast padding, typed-array builder, compact vertex
   format, chunk-bounds spheres, column generation, skipping all-air chunks. Measure.
3. Greedy mesher with AO, diagonal stale neighbours, culled mesher kept as oracle.
   Measure triangles and mesh time.
4. Worker pool and protocol; `ChunkLoader` as a job scheduler with cancellation.
5. Ring / view-first priority, apply budget, radius 8 if the numbers allow. Final
   measurements and notes in this file.

## Questions for you

1. OK to drop the per-block brightness jitter (it blocks merging)?
2. Edits remeshed synchronously on the main thread: fine, or would you rather they
   went through the workers from the start?
3. Raise the default view radius to 8 at the end of the milestone?
4. Which laptop (CPU cores, browser) should the 60 fps / 20 ms budget be judged on?
