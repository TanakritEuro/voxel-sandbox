# Milestone 6: 120 fps on a laptop GPU — plan (for your approval)

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

## Decisions for you
- **Numbering:** this becomes Milestone 6, and the optional one (mobs, flowing water, logic
  blocks, multiplayer) moves to 7.
- **LOD distances:** full detail within 7 chunks (224 blocks), half from there, a quarter from 11
  chunks. Nearer means faster but more visible; the fog starts at 55 % of the view distance
  (282 blocks at 16). To be tuned in step 6 with you.
- **Water and glass at full detail** everywhere, as above.
- **No settings changes:** LOD is always on. `?lod=0` is only for measuring.
