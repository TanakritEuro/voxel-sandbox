# Milestone 15: cave culling

**Status:** built (2026-11-18), waiting for playtests.

## Goal

The known limit since Milestone 3: visibility culling is per chunk, so most cave walls are still
meshed and drawn. Milestone 3 measured it: from the spawn point the walk takes off only about 20 % of
the triangles, and caves hold over 3× the surface's triangles. The reason is that a chunk is coarse:
a surface chunk holds both open sky and tunnels, both touch its side faces, and connectivity is kept
per *pair of faces*, not per open region. So the walk comes in through a side via the sky and leaves
downwards via a tunnel, and once a chunk is reached, every wall in it is drawn.

This milestone makes visibility **per open region** instead of per chunk:
1. the walk goes from region to region (it can't come in by the sky and leave by a tunnel that isn't
   joined to it);
2. each quad belongs to the region it is seen from, and only the regions the walk reached are drawn;
3. pockets sealed inside a chunk aren't meshed at all.

**Targets** (measured before and after, the same places, radius 8):
- triangles drawn standing on the surface well down from today (a guess: by a third or more; step 1
  measures what's possible before the renderer is touched, and we decide there whether to go on);
- fewer chunks meshed, so less worker time and less mesh memory;
- the walk no slower than today (it's 10–17 ms at radius 16 headless now: made numeric, it should get
  faster, not slower);
- no holes: flying fast, digging into caves and pockets, building, water flowing, playing together.

## Design

### Regions (`world/visibility.ts`)

`chunkRegions(blocks)`: the flood fill that `chunkConnectivity` already does, but keeping what it finds:
- each open region (a connected set of see-through blocks, as now) gets a number in scan order, so
  the same blocks always give the same numbers, in a worker or on the main thread;
- regions touching no face of the chunk are **pockets**: they get no number (they can only be seen
  from inside, and getting inside means digging, which is an edit that works them out again);
- at most 12 numbered regions; beyond that the smallest are merged into the last (merging only ever
  draws more, never less);
- kept per chunk: the face mask of each region, and the region of every block on the chunk's six
  faces (6 × 1024 bytes, 255 for solid). The full 32³ map isn't kept (it would be 32 KB a chunk); the
  mesher works it out again from its own copy of the blocks.
- shared constants for an all-air chunk (one region, every face) and an all-solid one (none).

Worked out where connectivity is today: in the worker that generates a column (sent back with it) and
after an edit, but only if some edited block changed between see-through and not (water flowing, a
lamp switching, a door opening, wheat growing don't).

### The walk

Nodes are (chunk, region) instead of chunks:
- it starts in the region the eye is in (all the chunk's regions if the eye is in a solid block or the
  chunk isn't loaded);
- from a region it goes out through any face the region touches, never in the direction opposite one
  already taken (the rule kept from today);
- across a face it goes into the neighbour's regions that share open blocks with it on that face. These
  links are worked out once per pair of chunks (1024 cells) and kept until either chunk changes;
- a chunk not loaded yet counts as open, as now;
- it gives, per chunk, which regions were reached, and which of its faces the walk reached from the
  other side (for the walls on the border, below).

Rewritten on numbers: chunks by index in a grid round the player, typed arrays for the queue and what's
been seen, no string keys.

### Meshing by region (`mesh/mesher.ts`)

Every quad is seen from one block: the one its normal points into (for a box piece, a torch, wheat or a
pane, the block itself). That block is see-through, so it's in a region. Its **group** is:
- that region's number, if the block is in the chunk;
- if the block is across one of the chunk's faces (a wall on the chunk's border, facing into the
  neighbour), a "border" group for that face: one of 6;
- a pocket: the quad isn't made.

Quads are sorted by group, then by direction as now, and `faceStarts` becomes a table of (group ×
7) ranges. Greedy merging only merges quads of the same group (rarely a loss: coplanar faces seen from
two different regions are seldom side by side). Far chunks (`lod.ts`, coarsened) stay one group,
drawn whole when any of the chunk is reached.

### Drawing (`render/chunkPage.ts`, `chunkRenderer.ts`, `chunkLoader.ts`)

The walk gives each chunk a mask of groups to draw: its reached regions, and a border group when the
neighbour across that face has a reached region touching it. The draw list takes, per chunk, the
ranges of the groups in the mask and the directions that can face the camera, merging touching ones.

A mesh made from an older version of the chunk than the regions the walk used is drawn whole until its
new mesh arrives (its group numbers may not mean the same thing any more). This keeps edits and water
from flashing holes.

### Stats and bench

- `?stats`: regions reached and chunks with any reached, alongside triangles drawn (which counts what's
  actually drawn).
- `npm run bench`: from fixed points (the spawn point, a cave mouth, inside a cave, a mountain top) at
  radius 8: chunks reached and triangles that would be drawn, three ways: today's walk, the region walk
  drawing whole chunks, the region walk drawing only reached groups. Also the walk's time (8 and 16),
  `chunkRegions`' time per chunk, meshing time with groups, and the size of the region data.

## Files

| File | Change |
| --- | --- |
| `src/world/visibility.ts` | `chunkRegions`, the region data, links between neighbours, the walk on regions (numeric) |
| `src/world/world.ts` | `Chunk.regions` in place of `connectivity`, worked out again only when see-through-ness changed |
| `src/workers/jobs.ts`, `protocol.ts` | regions sent back with a generated column (transferable) |
| `src/mesh/mesher.ts`, `builder.ts` | the group of every quad, pockets left out, ranges by group and direction |
| `src/mesh/lod.ts` | far meshes one group |
| `src/render/chunkPage.ts`, `chunkRenderer.ts` | the group mask per chunk, ranges by group and direction |
| `src/chunkLoader.ts` | the region walk; masks to the renderer; old meshes drawn whole |
| `src/stats.ts` | regions reached |
| `bench/bench.ts` | the measurements above |
| `tests/visibility.test.ts` and others | below |

## Tests

- `chunkRegions`: open air one region on every face; solid none; two separate tunnels two regions; a
  sealed pocket none; more than 12 regions merged; the same numbers for the same blocks; see-through
  blocks (leaves, water, glass, a slab) inside regions.
- The walk: up a shaft, along a tunnel, not from the sky into a tunnel that only touches the same side
  of the chunk (the leak today: fails with per-chunk connectivity); no U-turns; unloaded chunks open;
  regions reached the same as a brute-force flood of open blocks on small worlds, or more, never fewer
  in places a straight line of sight reaches.
- The mesher: every quad's group is the region of the block it's seen from (checked against a
  whole-chunk flood); the border groups for walls on the chunk's faces; pocket walls gone; all groups
  together give the same faces as before (against the culled oracle, pockets aside); greedy merging
  within groups.
- The loader: a tunnel's walls not drawn from the surface, drawn from inside; digging into a pocket
  shows it; an old mesh drawn whole until its new one arrives.

## Steps

1. **Regions and the region walk, measured first.** `chunkRegions`, region data from the workers and
   after edits, the numeric region walk used by the loader (still drawing whole chunks). In the bench,
   the three ways above from fixed points, with a headless count of triangles by group (from a whole-chunk
   flood), so we know what step 3 can win before building it. If it's small, we stop here or change
   course (I'll check with you). Done (2026-11-18).
2. **Meshing by region.** Groups in the mesher, pockets left out, ranges by group; far meshes one group.
   Mesher tests and bench. Done (2026-11-18).
3. **Drawing by region.** Masks from the walk to the renderer, the draw list by group, old meshes whole.
   Looked at in the browser: flying, caves, digging, a pocket, flowing water, a guest. Done (2026-11-18).
4. **Measurements,** notes and CLAUDE.md (the known limit gone, or what's left of it). Done (2026-11-18).

## Decisions to agree

1. **Pockets aren't meshed.** A cave sealed inside one chunk is invisible until you dig into it, and
   digging remeshes it. (Players can't get into one without digging; fly mode collides.)
2. **Far chunks drawn whole** (they're coarsened, cheap, and their regions would need coarsening too).
3. **At most 12 regions a chunk** (+ 6 border groups), extra small ones merged.
4. **The walk stays view-independent** (as now, walked when you change chunk, not when you turn).
   Narrowing it by the view direction is a further step for later if needed.
5. **Measure after step 1 before going on:** if region drawing wouldn't win much, we stop with the
   faster walk.

## Step 1: regions and the region walk (2026-11-18)

**What's in:**
- `world/visibility.ts`:
  - `regionMap` / `chunkRegions`: the flood fill keeping its regions, pockets left out, at most 12 (the
    11 largest keep their numbers);
  - `Regions`: faces per region and the region of every block on the six faces (6 KB a chunk; all-open
    and all-solid chunks share one each);
  - `linkMask`: which of the neighbour's regions a region shares open blocks with across a face, worked
    out four cells at a time and kept on the chunk's regions until either side is replaced;
  - `walkRegions`: the walk on (chunk, region), numeric (a grid round the start, typed arrays), giving
    per chunk the regions reached and the faces seen from across (`Reach`).
  - The chunk walk is kept as `reachableChunks` for the bench and tests.
- `Chunk.regions` in place of `connectivity`, sent from the workers (the arrays transferred), and worked
  out again after an edit only if a block changed between see-through and not.
- **The loader** walks from the region the eye is in. It keeps a region map of the eye's chunk, made
  when the eye comes into a chunk or its regions change, and walks again when the eye goes into
  another region. It still draws whole chunks: any region reached, or a face seen from across.
- `?stats`: the regions reached, the walk's time and the longest in the last second.
- **Tests (15):**
  - regions: shared, numbering, pockets, the cap, the same numbers twice, see-through blocks;
  - links;
  - the walk: open space, the ground's top, walls seen from across, the sky not leaking into a tunnel
    that only touches the same side (the chunk walk does), the start's region, no U-turns;
  - **lines of sight on generated land:** 3,000 straight lines from the surface and from inside a cave,
    traversed block by block. Every open block passed is in a region the walk reached, and every wall
    hit is in a chunk it reached.

**Measured** (`npm run bench`, the `visibility` section, new): radius 8, the bench's seed. Each cell is
chunks to mesh and triangles drawn. "By region" gives each greedy quad of today's meshes to the region
it's seen from (its middle, half a block out), which is what steps 2 and 3 would draw.

| from | chunk walk (before) | region walk, whole chunks | region walk, by region |
| --- | --- | --- | --- |
| the spawn point | 570, 2019k | 538, 2003k | 538, **1422k (-30 %)** |
| a cave mouth (-48, 71) | 585, 2291k | 638, 2550k | 638, **1834k (-20 %)** |
| in a cave | 549, 1966k | 97, 277k | 97, **130k (-93 %)** |
| a mountain top (-128, 116) | 679, 2968k | 711, 3035k | 711, **2612k (-12 %)** |
| flying, 40 over the spawn point | 588, 2059k | 545, 2014k | 545, **1432k (-30 %)** |

- **Whole chunks barely change from the surface.** Most tunnels really do open onto the sky
  somewhere within 8 chunks, so the regions reach them. The region walk can even reach a few more
  chunks than the chunk walk: a chunk can be entered once per region, and walls seen from across
  count.
- **Drawing by region is the win:** a third off from the surface and the air, nearly everything
  underground in a cave (where the chunk walk leaked out through the surface chunks).
- Pockets hold 1–6k triangles in these views (not drawn after step 2).
- **The walk:**

  | | chunk walk | region walk, first | region walk, after |
  | --- | --- | --- | --- |
  | radius 8 | 1.0–1.4 ms | 3.8–5.5 ms | 0.5–1.0 ms |
  | radius 16 | 2.4–5.9 ms | 6.6–23 ms | 1.1–2.7 ms |

  - "First" means every link worked out at once, which the game never does: links are worked out as
    chunks arrive, a walk every 100 ms while loading.
  - A link takes about 1 µs (four cells at a time; 2 µs a byte at a time).
  - This machine was noisy today: the same timings varied 2–3× from run to run.
- **Regions** take 0.22–0.30 ms a chunk in the worker, against 0.19 for the old connectivity (a
  column takes about 1.5 ms to generate).
  - 721 of the 724 chunks with blocks within 8 of the origin have their own: 4.2 MB.
  - At most 10 regions in a chunk; none at the cap.
- **In the browser** (radius 8, a 20 s sprint flight, `?autofly=20`, the same run before and after):

  | | frames p99, max | over 20 ms | main thread p50 / p99 / max | holes |
  | --- | --- | --- | --- | --- |
  | before | 8.5, 16.8 ms | 0 | 2.9 / 7.3 / 11.0 ms | none |
  | after | 8.6, 16.9 ms | 0 | 3.1 / 8.4 / 12.8 ms | none |

  - The first run after, with links worked out a byte at a time and the eye's chunk losing its links
    each time it was entered, had 3 frames over 20 ms. Both were fixed.
  - A walk standing still takes about 1 ms.
  - No console errors.

**For step 2 (your call):** drawing by region would take a third of the triangles off from the surface
and nearly all of them in caves, so I'd go on.

## Step 2: meshing by region (2026-11-18)

**What's in:**
- **`mesh/builder.ts`:** every quad has a group. `build` sorts the quads by group and then by part
  (a counting sort, skipped when they're in order already) and makes the indices.
  - `faceStarts` holds 18 × 7 ranges plus the count: 12 region groups, then 6 border groups (one per
    face of the chunk), each split into 6 directions and the rest.
- **`mesh/mesher.ts`:**
  - It works out the chunk's region map from the middle of the padded copy, which is the chunk's
    own blocks, so the numbers are the chunk's regions' numbers.
  - A greedy face goes in the region of the block it looks at, or in the border group of the face
    of the chunk that block is across. The group is part of the merge key, so a quad never spans
    two groups.
  - Shapes go in their own block's region, and so does flowing water's top. Flowing water's sides
    and the steps between waters look out, like greedy faces.
  - Faces seen only from a pocket aren't made.
  - Far chunks are all in one group, with no region map.
- **`render/chunkPage.ts`:**
  - `facing` gives the parts a camera could see; `drawRanges` gives the ranges of the groups
    asked for.
  - Each entry has a group mask, all groups for now, so this step draws what step 1 drew, less
    the pockets.
  - The multi-draw arrays grow as needed.
- **The region flood** (`visibility.ts`) knows from a table which faces of the chunk each block is
  on, instead of working out its coordinates. It's about a third faster: 0.12–0.13 ms a chunk.
- **Tests (6 new, 3 updated):**
  - every face on generated land and in a soup of blocks, block by block across each merged quad,
    is in the group it's seen from (5,000+ quads);
  - walls on a chunk's face in its border group;
  - a sealed pocket has no faces, and once a tunnel opens it onto a face, all its walls are in
    region 0, with the neighbour's closing wall in that neighbour's border group;
  - shapes in their block's region, and none in a pocket;
  - far chunks in one group;
  - draw ranges take just the groups asked for;
  - the greedy-against-culled test now leaves out the oracle's faces that look into pockets;
  - the range and far-chunk tests read every group.

**Measured:**
- **The cost: meshing about 18% slower, in the workers.** These are A/B runs, three rounds alternating,
  with the dev server stopped:

  | | before | after |
  | --- | --- | --- |
  | full detail | 1.15 ms a chunk | 1.33–1.44 ms |
  | far chunks | 1.0 ms | 1.0–1.17 ms (within noise) |

  - The region map is about 0.12 ms of that, and sorting about 0.02.
  - The bench agrees: greedy against the culled mesher in the same run is 1932k → 1924k triangles
    (pockets left out) and 18% more time.
- **The bench's "by region" column** now counts the meshes' own groups. It gives exactly what step 1
  estimated: from the spawn point 1422k triangles, in a cave 130k, and the rest the same.
- **A 20 s sprint flight in the browser:**
  - none over 20 ms; frames p99 9.5 ms, max 16.9;
  - main thread p50 3.1, p99 8.3, max 16.5 ms;
  - no holes;
  - 270k triangles drawn at the end, as in step 1;
  - no console errors.
  - The cave mouth (`?at=-48,71`) looks as before.
- **A trap while measuring:** the game running in the browser pane competes with the bench for the
  CPU. Swapping files back to measure the old code made the dev server reload the page, which then
  crashed (the old builder lacks what the new page imports), freeing the CPU. That made the old code
  look twice as fast. Measure with the dev server stopped.

## Step 3: drawing by region (2026-11-18)

**What's in:**
- **The loader** gives each meshed chunk the groups to draw after every walk and every new mesh
  (`ChunkSink.show`, in place of `setVisible`). The groups are its regions the walk reached, plus a
  border group for each face whose neighbour's reached region looks onto it. It draws the whole mesh
  instead when:
  - it's a far mesh, which has one group;
  - the mesh was made before its regions last changed (`Chunk.regionsVersion`: the version at which
    a block last changed between see-through and not);
  - its regions changed since the walk (`Reach.used` keeps the regions the walk saw). It then walks
    again soon.
- **The renderer and pages** draw an entry's groups (`show`, `drawRanges`). Water and glass get the
  groups too, in every direction.
- **Tests (3 new, 1 updated):**
  - after loading, chunks are drawn exactly when the walk reached them, more than 10 of them only
    in part, and fewer quads drawn than meshed;
  - after a solid block is dug out and the chunk remeshed in the workers, its new mesh is drawn
    whole, then narrowed again by the walk that follows;
  - far meshes are drawn whole;
  - the renderer draws just the groups shown.

**Measured in the browser** (radius 8, standing still, `?nolock&stats&time=0.5&mobs=0`; before is
step 2, which drew every group, measured right after on the same views):

| view | triangles drawn | GPU, ms | main thread, ms | draw calls |
| --- | --- | --- | --- | --- |
| the spawn point | 145k → **99k (-32 %)** | 2.5–2.6 → 2.7–2.8 | 2.3 → 2.0 | 30 → 30 |
| a cave mouth (`?at=-48,71`) | 195k → **144k (-26 %)** | 2.8–2.9 → 2.6–2.7 | 2.3–2.4 → 2.3–2.4 | 45 → 40 |
| a mountain top (`?at=-128,116`) | 438k → **377k (-14 %)** | 3.4 → 3.2–3.4 | 2.7 → 2.6–2.8 | 54 → 56 |

- **Triangles fall as the bench said** (spawn -30 %, cave mouth -20 %, mountain -12 % headless).
- **This GPU barely notices.** At 2.5–3.5 ms a frame it isn't held up by triangles. The laptop's
  integrated GPU is where the vertex work should count; not measured.
- **Inside a cave**, the bench's case with the largest gain (1961k → 130k), can't be stood in from a
  URL. The headless numbers stand for it.
- **A 20 s sprint flight** (`?autofly=20`), twice:
  - frames p99 8.5 ms, the longest 24.9 and 16.9: one frame over 20 ms in the first run, none in the
    second;
  - main thread p50 3.0–3.2, p99 8.2–8.5, max 12.9 and 11.8 ms;
  - no holes;
  - at the end, 205k triangles drawn against 270k in step 2, GPU 3.0 against 3.5 ms.
- **`?flood`:** a 32 × 32 room carved under the sea, then its ceiling opened at once (7,204 blocks)
  and flooded. 10 s with 0 frames over 20 ms, no errors.
- **Digging down 33 blocks** from the spawn (holding the button by script), from the grass into the
  chunk below: the shaft's walls drawn on both sides of the chunk border, nothing missing.
- **Not looked at:** a pocket dug into (the mesher tests cover it), and a guest. A guest's chunks come
  through the same generate jobs and its edits through the same loader.

## Step 4: measurements, and the end of the milestone (2026-11-18)

**Also in this step:** each page entry keeps its draw ranges (`PageEntry.ranges`) until the camera
crosses one of the chunk's planes or the walk changes its groups. This does less work each frame;
the measurements didn't separate it from noise.

**In the browser**, the end of Milestone 14 (its source checked out) against now, on the same views
(`?seed=20261022&nolock&stats&time=0.5&mobs=0`, standing still, three or four readings a second
apart):

| view | triangles drawn | GPU, ms | main thread, ms | draw calls |
| --- | --- | --- | --- | --- |
| the spawn point | 201k → **99k (-51 %)** | 2.9–3.0 → 2.7–3.0 | 2.1–2.2 → 2.1–2.2 | 35 → 30 |
| a cave mouth (`?at=-48,71`) | 227k → **144k (-37 %)** | 2.7 → 2.5–2.7 | 2.2–2.3 → 2.3–2.4 | 40 → 42 |
| a mountain top (`?at=-128,116`) | 447k → **377k (-16 %)** | 3.3–3.5 → 3.3–3.5 | 2.6–2.7 → 2.7–2.9 | 56 → 56 |
| the spawn point, radius 16 | 687k → **570k (-17 %)** | 4.6–4.9 → 3.9–4.2 | 3.0–3.3 → 3.3–3.6 | 105–107 → 101–102 |

- **Triangles drawn fall by a sixth to a half.** Inside a cave, which a URL can't put you in, the
  bench has 1961k → 130k (-93 %).
- **GPU time follows only at radius 16** (about -0.5 ms). At radius 8 this GPU isn't held up by
  triangles. A laptop's integrated GPU is where it should count; not measured.
- **Main thread:** at radius 16 it reads 0.1–0.4 ms more than Milestone 14, about this machine's noise
  between runs (a first reading of 3.5 against 3.0 shrank to 3.3–3.4 against 3.2–3.3 when both were
  measured again).
- **Memory at radius 16:** meshes 172 → 178.5 MB (the group table of every pass). The JS heap read
  441 → 485 MB. The chunks' region data takes 6 KB each for those not all open or all solid; that's
  4.2 MB within radius 8 in the bench.
- **Sprint flights** (`?autofly=20`, radius 8, four after step 3, against Milestone 14's run in step 1):
  - no holes in any;
  - frames p99 8.5–8.6 ms. One frame over 20 ms in two of the runs (24.9 and 25.1 ms), none in the
    other two; Milestone 14's run had none;
  - main thread p50 2.8–3.2 (Milestone 14 2.9), p99 8.2–8.6 (7.3), max 11.8–15.5 ms (11.0).
  - A walk takes about 3 ms in the browser at radius 8 (0.5–1 ms in the bench). Walks of 3–5 ms come
    while the land is loading, and once one of 22 ms, outside the timed frames. During the flights
    they stayed at 3.6 ms at most.
  - The long frames weren't the main thread's (its longest was 15.5 ms). Whether a walk adds to them
    isn't settled.

**Bench** (`npm run bench`, the dev server stopped):
- **The visibility table** (radius 8: chunks to mesh, and triangles drawn):

  | from | before (the chunk walk) | after (regions, by region) |
  | --- | --- | --- |
  | the spawn point | 570, 2014k | 538, 1422k |
  | a cave mouth | 585, 2285k | 638, 1834k |
  | in a cave | 549, 1961k | 97, 130k |
  | a mountain top | 679, 2962k | 711, 2612k |
  | flying, 40 over the spawn | 588, 2053k | 545, 1432k |

  The browser's drop from the spawn point is larger than the bench's: it counts only what's in the
  frustum, and directions facing away. Pockets left out take 8k of the 1932k greedy triangles in the
  bench area.
- **Meshing:** about 18% more time in the workers (A/B, step 2): 1.15 → 1.33–1.44 ms a chunk. A chunk
  crowded with shapes takes 11.5 ms against 8.2–9.5 run on its own; in the full run, 27 against 13.5–14.5,
  the end of a long run being noisier.
- **Regions:** 0.13 ms a chunk in the generating worker, against about 0.19 ms for Milestone 14's
  connectivity (measured in step 1).
- **The walk:** 0.6 ms at radius 8 and 1.2 at 16 once links are known. Working out every link at once
  takes 4.3 ms and 11.8 ms; the game never does that, since links come as chunks arrive.
- The rest of the bench (generation, light, physics, mobs, water, logic, survival) is unchanged by
  this milestone.

**Changed from the plan:**
- **The region flood** looks up which faces of the chunk each block lies on in a table instead of
  working out coordinates: a third faster.
- **Links** are worked out four cells at a time and kept on the chunk's regions.
- **The walk's regions are kept** with what it reached (`Reach.used`): a chunk whose regions changed
  since is drawn whole, and the loader walks again soon. Together with `Chunk.regionsVersion` for
  meshes older than the regions, this is the "old meshes drawn whole" of the plan.
- **The loader walks again** when the eye goes into another region of the same chunk (a fall, a
  respawn), from a region map of the eye's chunk.
- **Page entries keep their draw ranges** (this step).
- **Not looked at in the browser:** a guest, and a pocket dug into (the mesher tests cover it).

## Playtest questions

1. **Holes:**
   - do you ever see a wall, a floor or the sky missing for a moment? Look out while digging into a
     cave, breaking through into a cave from another, opening a sealed hollow, falling or respawning
     into a cave, and as water floods in.
   - The same as a guest in a friend's world.
2. **Caves:**
   - from inside a cave, does everything you should see show up, round corners and down shafts?
   - when you come out of a cave mouth, does the land appear at once?
3. **The laptop:** with `?stats`, at the spawn point and flying (`?autofly=20`), what are the GPU time,
   the triangles drawn and the frames over 20 ms? This milestone was for laptop GPUs; this machine's
   GPU barely notices.
4. **Loading:** does a new world, or a big view distance, take longer to fill in than before? Each
   chunk now meshes about a fifth slower in the workers.

