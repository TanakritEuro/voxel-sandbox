# Milestone 6: 120 fps on a laptop GPU

**Plan approved (2026-10-27)** as proposed: this is Milestone 6 (the optional one moves to 7), LOD
from 7 and 11 chunks to tune in step 6, water and glass at full detail, LOD always on.

**Goal.** On your laptop (Intel UHD Graphics, 120 Hz screen, the game drawn at 2560 × 1201),
flying over mountains:
- at least 120 fps at view distance 8;
- view distance 16 as near 120 as it gets: 100 fps or more is the realistic target, 120 the
  stretch.

The Milestone 5 budget stays: no frame over 20 ms flying at radius 8.

**Starting point** (`docs/milestone-5.md`, "Can it reach 120 fps?"). Measured with the mountain
probe described under Measuring below:

| | fps | frame ms | main thread ms | GPU ms | draw calls | triangles drawn |
| --- | --- | --- | --- | --- | --- | --- |
| Radius 16 | 45 | 22.4 | 6.4 | 18.2 | 1221 | 5.7 M |
| Radius 12 | 65 | 15.4 | 4.0 | 11.7 | 628 | 3.1 M |
| Radius 8 | 88 | 11.4 | 2.5 | 7.5 | 253 | 1.3 M |

- The GPU's time follows the triangles: about 2.4 ms per million plus 4 ms. Pixels and
  antialiasing cost little.
- At radius 16 the main thread (6.4 ms) is also too slow for 120 fps. Most of it is Three.js
  handling about 1,200 meshes a frame, out of several thousand in the scene.
- A 120 Hz frame has 8.3 ms. The browser adds about 1.5 ms of its own, so GPU and main thread
  together need to stay under about 6.5 ms.

So the work is: fewer triangles reaching the GPU, cheaper vertices, and far fewer objects for
Three.js to handle.

## The three changes

### 1. Batched chunk drawing (fewer objects and draw calls)
- All chunk meshes of a pass (opaque, transparent) go into a few Three.js `BatchedMesh`es
  ("pages", e.g. 32 MB each), drawn with WebGL2 multi-draw: one draw call per page instead of
  one per chunk.
- Chunks are added to a page with free space and removed when unloaded. A page that gets
  fragmented is compacted in the background, within a per-frame budget, like the uploads now.
- The chunk renderer does its own culling, per chunk (frustum and the visibility walk), and
  only tells the batch what changed. Three.js's per-instance culling is off.
- **This is the risky part,** so step 1 tries it first. If `BatchedMesh` costs too much per
  frame in JavaScript, or can't take the packed vertices of change 3, the fallback is a small
  multi-draw renderer of our own on the WebGL2 context (Three.js's state reset around it).

### 2. Skip faces that point away from the camera
- The mesher already writes faces one direction at a time. It will record where each of the 6
  directions starts in the index list: `MeshData.faceStarts`, 7 numbers per pass.
- A face pointing +x can only be seen from a camera with x greater than the chunk's lowest x;
  the same goes for the other five directions. So a chunk the camera isn't inside, on any axis,
  needs only 3 of its 6 directions.
- Each direction is its own range in the batch: one instance per chunk per direction. Which
  ones are drawn changes only when the camera crosses a chunk border, not every frame.
- Expected: about 40 % fewer triangles from far away (more seen from above, where the
  undersides are rare anyway).
- Torches stay in their own range, always drawn.

### 3. Smaller vertices: 20 bytes down to 12
- **Today:** position as 3 floats in world space (12 bytes), colour (4) and uvl (4).
- **New:** position relative to the chunk in one `uint`: x, y and z in 1/16 blocks, 10 bits
  each, so torches keep their fractions. The shader unpacks it and adds the chunk's origin,
  which comes from the batch's per-instance matrix. Colour and uvl stay as they are.
- **Convention change** (CLAUDE.md, "Mesh positions are in world space"): positions become
  relative to the chunk, and the chunk's origin moves to the instance. The held block uses
  the same packing with its own transform.
- Expected: some of the GPU time that goes on fetching vertices. Measured before and after,
  and dropped if it's worth nothing.

### 4. Lower detail for far chunks (LOD)
- **Levels by column distance,** `TUNING.view.lod`:
  - **LOD 0,** full detail, within 7 chunks;
  - **LOD 1,** cells of 2 × 2 × 2 blocks, from 7 chunks;
  - **LOD 2,** 4 × 4 × 4, from 11 chunks.

  For a level, a column's distance must pass the boundary by half a chunk before it switches,
  so moving along a boundary doesn't flip columns back and forth.
- **Downsampling, in the mesh job (worker),** from the padded 34³ blocks it already gets:
  - A cell is solid if at least half its blocks are solid.
  - Its block is the highest solid block's in the cell's top half, so grass tops stay green
    and snow stays white.
  - Leaves are kept as leaves.
  - The coarse padded border comes from the one-block border there is, approximately: it only
    decides culling and AO at chunk faces.
- **Meshing:** the same greedy mesher on the coarse grid, with positions scaled up, and texture
  coordinates scaled so the textures keep their size in blocks. AO and smooth light work per
  cell; the light is the brightest air block in the cell.
- **Water and glass stay at full detail.** Coarse water would move the sea level by a block at
  distance, leaving a step at the boundary. Water merges into huge quads anyway, so it costs
  little.
- **Seams:** where a column borders a column of another level, faces on that side are made as
  if the neighbour were air. These walls cover the gaps between surfaces of different heights.
  The mesh job takes a 4-bit mask of such sides; levels only differ between columns, so up and
  down never need it.
- **Loader:**
  - A column's level or seam mask changing makes its chunks stale. They are remeshed nearest
    first, and the old mesh stays on screen until the new one arrives, so there are no holes.
  - Edits happen near the player, at LOD 0, so they're unchanged.
- **Expected at radius 16:**
  - Triangles drawn: today's 5.7 M becomes about 35 %, and about 20 % with change 2, so
    roughly 1.2 M (radius 8's count today).
  - Mesh memory drops a lot (705 MB at radius 16 now).
- `?lod=0` switches LOD off, for comparing.

## Files
- **`mesh/builder.ts`:** packed positions and `faceStarts`.
- **`mesh/mesher.ts`:** `faceStarts`, a scale for coarse meshes, a seam mask.
- **New `mesh/lod.ts`:** downsampling the padded blocks and light to a coarse padded grid (pure).
- **`workers/protocol.ts`, `jobs.ts`:** the mesh job takes `lod` and `seams`.
- **`render/chunkRenderer.ts`:** pages of `BatchedMesh`, instances per chunk direction, culling,
  compaction, the upload budget kept.
- **New `render/pageAllocator.ts`:** free ranges in a page (pure).
- **`render/blockMaterial.ts`:** unpacking positions, the batch's per-instance origin.
- **`render/heldBlock.ts`:** the packed format.
- **`chunkLoader.ts`:** a level and seam mask per column, with hysteresis, remeshing on change.
- **`config.ts`:** `view.lod`.
- **`stats.ts`:** triangles by level, pages and how full they are.
- **CLAUDE.md:** the convention change, layout, current state.

## Tests
- **Mesher:** every quad in direction d's range has normal d; the six ranges together make the
  same mesh as today; packed positions unpack to today's exactly (torches included).
- **Direction culling:** for random cameras and chunks, every face of a skipped direction faces
  away from the camera (none that could be seen is ever skipped).
- **LOD:** downsampling rules (solid by majority, the top block kept, leaves); a coarse mesh of a
  flat plain is one big quad per side; seam walls appear on masked sides only; water at full
  detail.
- **Loader:** levels by distance with hysteresis (walking back and forth over a boundary
  doesn't remesh every time); a level change remeshes and keeps the old mesh until the new
  one arrives.
- **Page allocator:** add, remove, reuse, fragmentation, compaction moves.
- **Existing tests** (mesher against the culled oracle, AO, light) keep passing at LOD 0.

## Measuring
- **The mountain probe,** as before:
  - seed 20261022, `?at=-368,400`, production build in Chrome on your machine;
  - fully loaded, then a slow spin at the horizon for 8 s;
  - fps, frame, main thread, GPU, draw calls and triangles;
  - at radius 8, 12 and 16, after every step.
- **`?autofly`** at radius 8 and 16: frame times while flying (LOD changes while flying are the
  new cost), and holes.
- **Quick turns** at 16, as in the turning fix.
- **`npm run bench`:** meshing time and triangles per level, and vertex bytes.
- **Memory:** meshes and JS heap at radius 16.

## Steps (each one built, tested, measured, committed and pushed)
1. **Spike:**
   - chunks drawn through `BatchedMesh` pages, everything else as it is;
   - the mountain probe at 8 and 16;
   - go or fall back (see change 1).
2. Direction ranges in the mesher, and culling by direction in the renderer.
3. Packed vertices and the chunk origin per instance; the held block.
4. LOD meshing in the worker: downsampling, the coarse mesh, seams. Headless tests and bench.
5. LOD in the loader: levels with hysteresis, remeshing, `?lod=0`; autofly at 16.
6. Tuning: the LOD distances against what you can see (popping, seams), and the page size.
7. **Notes,** final numbers and playtest questions:
   - can you see where detail drops, or the seams;
   - does anything pop in or out while flying;
   - the frame rate at 8, 12 and 16.

## Decisions (approved)
- **Numbering:** this becomes Milestone 6, and the optional one (mobs, flowing water, logic
  blocks, multiplayer) moves to 7.
- **LOD distances:** full detail within 7 chunks (224 blocks), half from there, a quarter from 11
  chunks. Nearer means faster but more visible; the fog starts at 55 % of the view distance
  (282 blocks at 16). To be tuned in step 6 with you.
- **Water and glass at full detail** everywhere, as above.
- **No settings changes:** LOD is always on. `?lod=0` is only for measuring.

## Step 1: batched chunk drawing — built (2026-10-27)

**What changed:**
- Chunk meshes are copied into **pages** (`render/chunkPage.ts`), each a Three.js `BatchedMesh`
  used for its multi-draw path. The batch's own geometry bookkeeping is replaced:
  - space is handed out by `render/pageAllocator.ts`, in quads, first fit, freed ranges merged;
  - each frame, a page builds its draw list from the chunks that are visible (the visibility
    walk) and in the frustum, with blended ones (water, glass) farthest first;
  - Three.js's per-instance culling and sorting are off.
- **One index buffer for every page.** `MeshBuilder.quad` now turns a flipped quad's corners
  (1, 2, 3, 0, still counter-clockwise) instead of using other indices, so every quad has the
  indices 4q + (0, 1, 2, 0, 2, 3). Only vertices are ever uploaded, just the range written.
- **Pages of 16,384 quads** (65,536 vertices, 16-bit indices, 1.3 MB). A mesh bigger than that
  gets a page of its own size.
  - The first try used pages of 262,144 quads (26 MB). Each new page is uploaded whole when
    first drawn, and pages added while flying made 40–50 ms frames (main thread max 46 ms).
    Small pages took the main thread's max to 11–12 ms.
- **The background upload of unseen meshes is gone** (`uploadSome`, `TUNING.view.upload*`). A
  chunk's vertices now go to the GPU when its mesh arrives, into a buffer that already exists,
  so a quick turn has nothing to upload.
- `?stats` shows the pages and how full they are.

**Measured** in Chrome on your laptop, production build, 2560 × 1201:

- **Mountain probe** (seed 20261022, `?at=-368,400`, fully loaded, a slow spin at the horizon
  for 8 s). Before is the end of Milestone 5; each cell is before → after.

  | | fps | frame ms | main thread ms | GPU ms | draw calls | triangles drawn |
  | --- | --- | --- | --- | --- | --- | --- |
  | Radius 16 | 45 → 45 | 22.4 → 22.4 | 6.4 → 4.0 | 18.2 → 18.6 | 1221 → 387 | 5.7 M |
  | Radius 12 | 65 → 64 | 15.4 → 15.5 | 4.0 → 2.5 | 11.7 → 11.7 | 628 → 207 | 3.1 M |
  | Radius 8 | 88 → 86 | 11.4 → 11.7 | 2.5 → 1.9 | 7.5 → 7.8 | 253 → 91 | 1.3 M |

- **`?autofly=20` at radius 8,** alternating builds:

  | | frames over 20 ms | over 33 ms | main thread p50 / p99 / max |
  | --- | --- | --- | --- |
  | Before (3 runs) | 27, 23, 39 | 0, 0, 1 | 5.9–6.0 / 11.3–11.7 / 14–20 ms |
  | After (4 runs) | 48, 28, 26, 29 | 3, 1, 0, 0 | 1.6–1.8 / 9.0–9.6 / 11–12 ms |

  The first run after looks like noise: the three after it match the build before. The frames
  over 20 ms are 25 ms frames (three refreshes at 120 Hz), with the main thread far below
  that: the GPU, not our code.

**What it says:**
- The batching works: the main thread is down by a third to a half, and draw calls by
  two thirds.
- The frame rate didn't move, because the GPU limits it, as expected; steps 2–4 are for that.
- 16-bit indices made no difference to the GPU (the big pages had 32-bit ones). So fetching
  indices isn't what costs: the work per triangle is. That favours step 2 (fewer triangles)
  and is a warning for step 3 (fewer bytes per vertex may not help much).
- **New: about 4 ms of every frame is GPU work outside our draws.** The frame is the GPU time
  plus about 4 ms, whatever the main thread does. That is most likely the browser compositing
  and resolving the antialiased 2560 × 1201 canvas. It grows with pixels: half the resolution
  saved 4.3 ms of frame against 2.6 ms of GPU, and antialiasing off saved 1.9 against 0.7.
  - So for 120 fps (8.3 ms) our own GPU work has about **4.3 ms**, not the 6.5 the plan
    assumed. Antialiasing or the render resolution may have to be part of step 6.

**Decision: go.** The batching stays; its page size (main thread 2.5 ms with big pages, 4.0 with
small ones at radius 16) can be tuned in step 6.

**Tests (8 new in place of the 2 upload tests, 201 in all):**
- Every quad's indices are 4q + (0, 1, 2, 0, 2, 3).
- Pages count and free their space on remove and remesh, open a new page when full, fill freed
  space again, use 16-bit indices when small, and give an oversized mesh a page of its own.
- The draw list holds the visible chunks in the frustum, blended ones farthest first.
- The allocator: first fit, merging, and never the same quad twice through 5,000 random steps.

## Step 2: faces pointing away skipped — built (2026-10-27)

**What changed:**
- The mesher writes faces in `FACE_ORDER` (+x, +y, +z, -x, -y, -z), then torches, and records
  where each starts: `MeshData.faceStarts`, 8 numbers. The order puts the three directions a
  camera can see into one range in half the cases, two ranges otherwise.
- Opaque pages draw, per chunk, only the directions that could face the camera
  (`faceRanges` in `render/chunkPage.ts`). A +x face lies on a plane above the chunk's lowest
  x, so a camera at or below that x can't see any; the same for the other five directions.
  Torches are always drawn, and neighbouring ranges are merged.
- Water and glass are drawn whole: they are double-sided, so the water's surface shows from
  below.

**Measured** in Chrome on your laptop, 2560 × 1201, mountain probe.
- The laptop was clearly slower in this session than in step 1: step 1's build measured
  main thread 8.5 ms and GPU 22.2 ms at radius 16 here, against 4.0 and 18.6 before. Perhaps
  battery or heat.
- So step 1 and step 2 were built side by side and measured alternately in the same session.

| | fps | frame ms | main thread ms | GPU ms | multi-draw calls | triangles drawn |
| --- | --- | --- | --- | --- | --- | --- |
| Radius 16, step 1 | 37 | 26.8 | 8.5 | 22.2 | 378 | 5.77 M |
| Radius 16, step 2 | **49** | 20.4 | 9.0 | **15.5** | 371 | **3.30 M** |
| Radius 8, step 1 | 76 | 13.1 | 3.7 | 8.6 | 90 | 1.33 M |
| Radius 8, step 2 | **82** | 12.2 | 4.0 | **7.8** | 91 | **0.81 M** |

- **`?autofly=20` at radius 8:** step 1 had 41 frames over 20 ms, step 2 had 25; none over
  33 ms; no holes.
- **Looking at mountains, cliffs and trees from inside a canyon:** no missing faces.

**What it says:**
- **40 % fewer triangles at every distance.** At radius 16 that is 30 % less GPU time and
  32 % more fps.
- **At radius 8 the GPU barely followed the triangles** (−9 %): most of its time there is
  something else.
- **Looking straight up at the sky** (radius 8, nothing but sky and clouds drawn): **GPU 2.9 ms**,
  120 fps.
  - The sky dome is drawn first (`renderOrder` −3), so it shades every pixel of the screen
    before the terrain covers most of them.
  - Drawn after the terrain, at the far plane with the depth test on, the GPU would skip every
    covered pixel. That is a small change outside the four of the plan, proposed as a step
    before step 3.
- **The extra ranges cost something too.** ANGLE on Direct3D 11 draws a multi-draw as one draw
  per range: two to three per chunk now instead of one.
- **Step 3 (smaller vertices) looks less promising than planned.** Neither 16-bit indices
  (step 1) nor 40 % fewer vertices at radius 8 changed the GPU time much. It is still to be
  measured before being kept.

**Tests (2 new, 203 in all):**
- Each direction's range holds only quads of that direction, then the torch (5 quads), and water
  has no torch range.
- For 600 random camera positions around three chunks, inside and up to two chunks away, every
  face left out faces away from the camera. Ranges come out in order and merged.
- From outside a chunk, under 70 % of its quads are drawn.
- The renderer's draw list over a chunk from above leaves out exactly the -y faces, of each
  visible chunk.

## Step 2b: the sky drawn after the terrain — tried, not kept (2026-10-27)

You asked for this between steps 2 and 3, after step 2 found the sky alone costing about 2.9 ms
of GPU.

**Tried:**
- The sky dome was drawn after the opaque world instead of first (`renderOrder` −3 → 10).
- It was put on the far plane (`gl_Position.z = gl_Position.w`, which keeps it behind anything
  in view even at small view distances, where mountains can reach past its radius).
- The idea: the depth test would skip the pixels the terrain already covers.
- Day, dusk and stars looked the same.

**Measured** side by side with step 2, alternating builds in the same session, radius 8,
mountain spawn, GPU ms:

| View | Step 2 (sky first) | Sky after the terrain |
| --- | --- | --- |
| Slow spin at the horizon | 5.9 | 6.3 |
| Straight down (terrain fills the screen) | 5.9, 6.5 | 7.8, 7.2, 7.3 |
| Straight up (only sky and clouds) | 2.5 | 2.6 |

- **Looking down,** where it should have helped most, it was about 1 ms *slower*, every time.
  - The dome's own shading is cheap: drawn first, it costs less than what this GPU (Intel UHD,
    through ANGLE and Direct3D 11) loses on the order change.
  - Why it loses is not known; one possibility is its depth hierarchy handling the far-plane
    depth badly.
- **Looking up,** nothing changed, so the 2.5 ms there isn't the dome's draw order.
  - At half resolution (`?scale=0.5`) the same view takes 1.3 ms. So about 1.6 ms of it
    follows the pixels (dome, clouds, clear) and about 0.9 ms is fixed.

**Decision:** reverted; the sky is drawn first as before. It's recorded here so the idea isn't
tried again blind. Cheaper sky and clouds per pixel (rather than their order) could still be
looked at in step 6, with the render resolution.

## Step 3: packed vertices — tried, dropped (2026-10-27)

**Tried:**
- Vertices of 12 bytes instead of 20: position and texture coordinates in two 32-bit words, the
  colour as before.
- Positions were relative to a region of 8 × 8 columns, in sixteenths of a block, so torches
  kept their fractions. Each page held one region and sat at its origin, so the region's offset
  came through the page's own matrix, with no per-draw data. Emptied pages were reused for the
  next region.
- Every vertex of 32 real chunk meshes (torches included, on both sides of region borders)
  unpacked to exactly the mesher's numbers, and it looked the same.

**Measured** side by side with step 2, alternating builds, mountain probe, GPU ms:

| | Step 2 (20 bytes) | Packed (12 bytes) |
| --- | --- | --- |
| Radius 8 | 5.9, 5.9 | 5.9, 5.9 |
| Radius 16 | 12.3, 12.2 | 12.8, 12.7 |
| Radius 16 fps | 62.0, 62.4 | 60.8, 60.4 |

- At radius 8 no difference; at radius 16, 0.5 ms *slower* every time.
- It also needed fewer multi-draw calls (221 against about 380 at radius 16), which didn't help
  either.
- The size of a vertex doesn't limit this GPU, and unpacking costs a little in the shader. That
  agrees with step 1, where 16-bit indices made no difference.

**Decision: dropped,** as agreed beforehand. The code was reverted, so vertices stay 20 bytes
and world-space; the convention in CLAUDE.md stands.

**Something to look at instead (for step 6):**
- The opaque pass's fragment shader can `discard` (for the holes in leaves), and it's the same
  shader for every solid block. On many GPUs a shader that can discard turns off early depth
  rejection for everything it draws. That would make every hidden terrain pixel cost a full
  shade.
- Splitting leaves (and other cut-out blocks) into their own pass, with solid blocks in a
  shader without `discard`, could save a good part of the per-pixel time.
- The probe looking straight down at terrain (GPU 5.9–6.5 ms for 0.29 M triangles at radius 8)
  suggests pixels, not triangles, are most of what is left at radius 8.

## Step 4: lower detail meshing for far chunks — built (2026-10-27)

Headless only for now: the mesh job can make far chunks, and step 5 has the loader ask for
them. The game is unchanged until then (every job is level 0, with no seams).

**How (`mesh/lod.ts`):** not a second mesher. The padded blocks are **coarsened in place**,
and the ordinary greedy mesher does the rest.
- **Cells:** 2 × 2 × 2 blocks (LOD 1) or 4 × 4 × 4 (LOD 2), each made all one block.
- **The rule:**
  - A cell is solid when at least half its blocks are: opaque cubes and leaves count; air,
    water, glass and torches don't.
  - A solid cell takes its highest solid block, so grass tops stay green and snow white.
  - Otherwise its solid blocks are taken out: they become water where the cell has water, else
    air, lit by the brightest of the cell's own air.
  - Everything else is kept as it was. That keeps **water at the exact sea level**: its
    surface was the same height at every level on the spawn's sea chunks, and its area within
    a fifth (a little lost at shores, a little gained where stone stuck out of the sea).
    - The plan said water and glass at full detail. This is that, except in cells that turn
      solid, and it needs one mesher run instead of two.
- **Far faces are flat** (`meshChunk(..., flatFaces)`): no AO and no smooth light, each face lit
  by the block it looks at.
  - With AO, a coarse cell's faces split wherever AO changed block by block. LOD 1 then kept
    79 % of the full-detail quads on mountain chunks, and LOD 2 46 %.
  - Flat: 31 % and 16 %. At 224 blocks and more, in the fog, flat faces should hardly show
    (a playtest question for step 6).
- **The border from the neighbours** is only one block deep, so a neighbour's cell can't be
  coarsened from it.
  - **LOD 1:** a 2 × 2 patch of the border counts as solid only when all of it is. The
    neighbour's cell then has half of it solid, so it is solid too, and no face is ever left
    out at a chunk border (a few hidden ones are made).
  - **LOD 2:** a layer is only a quarter of a cell. The test found real holes with the same
    rule, so the border never counts as solid there: far chunks wall their edges, and the
    hidden walls cost some quads.
- **Seams** between columns of different levels: on the sides of a 4-bit mask, the border's
  solid blocks become air in full sun, so the chunk makes walls that cover the gaps. Both
  chunks of such a pair get them; step 5 works out the masks.
- **The mesh job** takes `lod` and `seams`, and the worker coarsens its padded copies in
  place: they are the main thread's scratch buffers anyway.

**Bench** (`npm run bench`, the 724 non-empty chunks within radius 8 of the spawn, median of
5 runs):

| | mean ms per chunk | p95 | triangles | vertex data |
| --- | --- | --- | --- | --- |
| Full detail (greedy) | 1.03 | 1.65 | 2,321 k | 101.8 MB |
| LOD 1 | 0.95 | 1.31 | 695 k (30 %) | 30.5 MB |
| LOD 2 | 0.85 | 1.25 | 415 k (18 %) | 18.2 MB |

- On the mountain chunks LOD 2 alone made 16 % before its border walls and makes a little more
  with them: the walls cost about 5 % of full detail. They are mostly underground, where the
  visibility walk or terrain hides them and direction culling halves them.
- A far chunk meshes slightly faster than a full one, so loading isn't slower.
- **Expected at radius 16** with the plan's distances:
  - the area within 7 chunks (19 %) at full detail, 7–11 (28 %) at LOD 1, 11–16 (53 %) at
    LOD 2: 0.19 + 0.28 × 0.30 + 0.53 × 0.18 ≈ 0.37 of the triangles;
  - so about 1.2 M drawn instead of 3.3 M over the mountains.

**Tests (8 new, 211 in all):**
- **Rules:** a cell solid at half, taking its highest block; 3 of 8 taken out, lit by its
  brightest air; stone in water turned to water; leaves count as solid and torches don't; 4³
  cells solid at 32 of 64 and not at 31; border patches solid only when whole, never for 4³.
- **Fewer quads** on real chunks (mountains and the spawn): LOD 1 under 40 % of full detail,
  LOD 2 under 60 % of LOD 1.
- **No hole** where two chunks of the same level meet: on real mountain chunks, along x, y and
  z, at both levels, every square of the shared plane with a solid cell on one side and none
  on the other is covered by a face of the solid side.
- **Seams:** a chunk of stone inside stone has no faces, and with its +x side bordering another
  level only +x faces on that side, lit by full sun; at LOD 2, one face a side.
- **Water** at the same height and within a fifth of the area at every level.
- **The mesh job** with a level and seams makes exactly what the functions make.

## Step 5: lower detail in the loader — built (2026-10-27)

**What changed:**
- **Levels by distance** (`lodLevel`, `TUNING.view.lod`): full detail within 7 chunks of the
  player's column, half from 7, a quarter from 11. A column changes level only once it is half
  a chunk past a boundary (hysteresis), so moving along a boundary doesn't remesh it back and
  forth.
  - Only a column that was drawn keeps its level. Columns only generated as neighbours had
    level 0, and the first version took that as their level when they came into view (found by
    the test).
- **A mesh is known by its stamp:** the chunk's version × 64 + its form (level | walls << 2).
  - A changed level makes a chunk stale the way an edit does, and the job carries its level
    and walls to the worker.
  - The old mesh stays on screen until the new one arrives. A result in a form the column has
    since left still shows if nothing newer is there, but never replaces a mesh in the
    current form.
  - Edits remesh on the main thread at the column's level.
- **Walls: every side of a far chunk** (`wallsFor`), whatever its neighbours.
  - The first version walled only the sides bordering another level, as planned. Then a level
    change also remeshed the neighbours, whose walls changed. Flying at view distance 16 the
    loader fell behind: 1,330 chunks waiting at worst, holes in 19 of 20 seconds (415 chunks at
    worst), main thread 10.1 ms a frame (median).
  - Levels only grow away from the player, so the gaps between levels that can be seen are
    covered by the far side's walls. Walling by its own level alone, a column is remeshed only
    when its own level changes: 349 waiting at worst, holes in 11 s.
  - The walls cost 5 % more triangles at half detail (bench: 733 k against 695 k) and none at a
    quarter, which walled its edges already.
- **Holes first:** `dispatch` makes two passes, first generation and chunks with no mesh, then
  chunks to mesh again in a new form. That took the holes down to full detail's (below).
- **A thin surface layer is carried down** (`coarsen`). Snow (one block thick) on a slope often
  sits in a cell that isn't solid, so it was taken out, and the cell under it showed its stone.
  Far snowy mountains looked grey and patchy.
  - Now a solid cell takes the block of a layer covering at least half the floor of the cell
    above, made of opaque blocks. A tree trunk or leaves don't count, so the ground under trees
    stays as it was.
  - Side by side from above at radius 16, the far mountains now look much like full detail's.
- **`?lod=0`** keeps every column at full detail, for comparing. `?stats` shows the columns at
  each level.

**Measured** in Chrome on your laptop, 2560 × 1201, the same build with and without `?lod=0`,
alternating:

- **Mountain probe** (seed 20261022, `?at=-368,400`, fully loaded, a slow spin at the horizon):

  | | fps | frame ms | main thread ms | GPU ms | triangles drawn | load |
  | --- | --- | --- | --- | --- | --- | --- |
  | Radius 16, full detail | 61, 61 | 16.4, 16.2 | 6.7, 6.4 | 12.5, 12.3 | 3.26 M | 17–18 s |
  | Radius 16, LOD | **82, 84** | 12.2, 11.9 | 5.1, 5.3 | **8.1, 7.8** | **1.38 M** | 12 s |
  | Radius 8, full detail | 96 | 10.4 | 3.4 | 6.1 | 0.80 M | 5 s |
  | Radius 8, LOD | **102** | 9.8 | 2.9 | 5.8 | 0.69 M | 5 s |

  - Mesh memory at radius 16: 245 MB against about 700 MB.
  - Radius 8 gains a little too: its outer ring (7–8) is at half detail.

- **`?autofly=20`:**

  | | frames over 20 ms | over 33 ms | main thread p50 / p99 | holes | waiting at most |
  | --- | --- | --- | --- | --- | --- |
  | Radius 8, full detail | 12 | 0 | 3.6 / 8.8 ms | none | 21 |
  | Radius 8, LOD | 12 | 0 | 3.5 / 9.0 ms | none | 76 |
  | Radius 16, full detail (2 runs) | 134, 173 | 1, 9 | 6.3–6.7 / 15–19 ms | at most 8–9, in 3–4 s | 78–84 |
  | Radius 16, LOD (2 runs) | 201, 98 | 14, 1 | 6.5–6.8 / 19–20 ms | at most 5, in 2–3 s | 350–379 |

  - Flying is on par: the frame-time differences are within the noise between runs, and holes
    are as few or fewer.
  - More chunks wait, but they are meshes to redo in a new form, with the old ones still
    showing. Flying at radius 16 is about 60 fps either way: the GPU, the main thread's loading
    work and the browser's 4 ms don't fit two frames' worth into one.

**Where it stands against the goal (120 fps, a frame of 8.3 ms):**
- **Radius 16 standing:** 83 fps (was 45 at the start of the milestone). The frame is 12 ms:
  GPU 8, the browser's 4 ms.
- **Radius 8:** 102 fps. GPU 5.8 ms.
- Both are still the GPU plus the browser's fixed cost. What's left for step 6:
  - **The opaque shader's `discard`,** which may switch off early depth rejection for all
    terrain (step 3's notes). Leaves in their own pass would avoid that.
  - **Tuning the LOD distances:** nearer is faster.
  - **Page size:** main thread 5 ms at radius 16.
  - **Antialiasing or render resolution:** your call, since it changes how it looks.

**Tests (4 new, 215 in all):**
- **Levels:** by distance, changing only past the hysteresis, and a jump past both boundaries
  at once.
- **The loader:** each column's chunks meshed exactly as at its level with its walls, in a
  radius with all three levels.
- **Moving one column** remeshes exactly the columns whose level changed (hysteresis applied),
  keeps every old mesh on screen until results arrive, and ends with every mesh in its new
  form.
- **Coarsening:** a cell under a removed snow layer becomes snow; under a lone trunk it stays
  stone.
