# Voxel Sandbox

A Minecraft-like voxel sandbox for the browser: an endless generated world of blocks to
explore, dig into and build in. The interesting part is the engine: chunk storage,
meshing, generation in Web Workers, lighting, collision and saving, all fast enough to
hold 60 fps while the world streams in around you.

Built with Three.js (rendering only), TypeScript, Vite and Vitest. **No physics engine:**
voxel games collide a box against the block grid directly, which is simpler and faster
than general physics. No backend.

Same author as `../penalty-shootout`, `../five-a-side` and `../racing-game` (all finished,
same stack). Their synthesised audio, menus and online code can be ported; read the
relevant files there before writing something that already exists.

## Commands

- `npm install` — first-time setup
- `npm run dev` — dev server at http://localhost:5173 (hot reload)
- `npm run build` — typecheck + production build into `dist/`
- `npm run typecheck` — types only
- `npm test` — Vitest
- `npm run bench` — headless generate / pad / mesh timings on a fixed chunk set

Requires Node 20.19+ or 22.12+ (Vite 8).

## Current state

Milestone 7 (mobs) in progress, plan approved (`docs/milestone-7.md`).
Milestones 1–6 built (`docs/milestone-1.md` to `docs/milestone-6.md`), waiting for playtests
(Milestone 6, 120 fps on a laptop GPU: chunks drawn in batched pages with multi-draw, faces
pointing away skipped, far columns at lower detail, leaves in their own pass so solid blocks
never discard; antialiasing and render resolution in the settings)
(Milestone 3's laptop measurement is in: inside the budget). Milestone 5 added settings, a sky with sun, moon, stars and clouds,
fog by biome, moving water, synthesised sounds (footsteps, digging, breaking, placing,
landing, splashing), block particles, the held block, and a creative block picker (E) with the
hotbar saved per world. Milestone 4 added light (sunlight and block light, smooth, following edits; torches, on floors and walls, and lamps), day and night,
saving
(edited chunks in IndexedDB, RLE; the player and time of day), named worlds with a world list and a pause menu.
A seeded world of four biomes
(`world/biomes.ts`: plains, forest, desert, snowy mountains from temperature and humidity
noise, heights blended across borders; `world/generate.ts`: surface layers by biome and
slope, beaches, sea floors, water to sea level 62; `world/caves.ts`: tunnels and caverns from
coarse-sampled 3D noise; `world/features.ts`: ore veins, and oaks, spruces and cacti placed
per 5 × 5 cell and written across chunk borders) in 32³ chunks, 256 blocks tall, generated a column at a time; all-air chunks
share one empty array until edited. Chunks within
8 chunks of the camera are generated and meshed in a pool of Web Workers, near and in
front of the camera first, scheduled from the main thread, and unloaded when far away
(`chunkLoader.ts`); columns from 8 chunks away are meshed at half detail and from 13 at a
quarter (`mesh/lod.ts`). The mesher
(`mesh/mesher.ts`) is greedy with per-vertex ambient occlusion and directional shading in
the vertex colours, multiplied in the shader with 16 × 16 textures made at startup
(`world/textures.ts`, one texture array); leaves are alpha-tested, water and glass go in a
separate transparent pass. A walking
player with an AABB that collides with the blocks, jumping, sprinting, crouching at edges,
swimming with an underwater view, and fly mode (`player.ts`, `world/physics.ts`, 120 Hz
fixed step), a voxel raycast (`world/raycast.ts`) with a block
outline, hold the left button to break (time by block `hardness`, with cracks), right click to
place, 1–9 or the wheel for the hotbar.
`?seed=123` picks the world.

Known limits, each fixed by a milestone below: visibility culling is per chunk and coarse, so many cave walls are still meshed and drawn.

## Architecture

- **World data** (`src/world/`): pure TypeScript, no `three`, DOM or `window`. Chunks are
  `Uint8Array`s of block ids (`coords.ts` defines the layout: x fastest, then z, then y).
  Generation is a pure function of seed and chunk coordinate, so chunks can be made in any
  order on any thread. All randomness comes from the seed (`math.ts`); never `Math.random`
  in world code.
- **Meshing** (`src/mesh/`): pure. Input is a chunk's blocks plus a one-block border from
  its neighbours (`paddedBlocks`, 34³), output is typed arrays. This is exactly the
  shape that can be posted to and from a Web Worker with transferable buffers.
- **Presentation** (`src/render/`, `main.ts`, `player.ts`): copies chunk mesh data into
  shared pages, each drawn with one multi-draw call; chunks are frustum-culled one by one there.
- **Scheduling** (`chunkLoader.ts`): decides what to generate, mesh and unload, nearest
  first, within a per-frame budget. When workers arrive it stays on the main thread and
  becomes a job queue with priorities and cancellation.

### Key techniques (the roadmap uses these names)

- **Greedy meshing:** merge runs of identical coplanar faces into big rectangles, per slice
  per axis. Typically cuts triangles 5–10×. With textures it needs texture coordinates that
  repeat across a merged quad (a texture array, or an atlas with a shader that wraps tiles).
- **Ambient occlusion per vertex:** darken each quad corner by its 3 neighbours (side, side,
  corner), from the padded volume. Merge only faces with matching AO, and flip the quad's
  diagonal when needed so the gradient doesn't crease (0fps.net, "Ambient occlusion for
  Minecraft-like worlds").
- **Workers:** a pool of `navigator.hardwareConcurrency - 1` workers. Generation and meshing
  run there; block arrays and vertex buffers move as transferables, not copies.
- **Lighting:** sunlight (full in columns open to the sky, spreading sideways and down with
  falloff) and block light (torches), each 4 bits per block, propagated with BFS queues,
  including removal when a block is placed. Stored per chunk, read by the mesher as vertex
  light.
- **Collision:** the player is an AABB (0.6 × 1.8 × 0.6). Move one axis at a time against
  the solid blocks it overlaps; snap to the face it hits. Gravity, jumping, step-up onto
  slabs later, swimming in water.
- **Features across chunk borders:** trees and structures that cross into a neighbour
  chunk. Generate them per column from a seeded hash (`hash3`) and let each chunk place the
  parts of nearby features that fall inside it, so the result doesn't depend on load order.
- **Saving:** store only modified chunks, compressed (run-length encoding works well on
  voxel data), in IndexedDB keyed by world seed and chunk coordinate.

References: Mikola Lysenko's 0fps.net articles on meshing and AO; Amanatides & Woo, "A
Fast Voxel Traversal Algorithm" (the raycast); the "Minecraft-like lighting" write-ups for
BFS light propagation; Sebastian Lague and "Let's Make a Voxel Engine" for overviews.

## Layout

- `src/settings.ts` — player settings (view distance, FOV, resolution, antialiasing, mouse, volume) in localStorage,
  cleaned on load.
- `src/config.ts` — `TUNING`: seed, view radius, levels of detail, frame budget, player movement, fly speed,
  reach, light, day length, sky, mobs.
- `src/math.ts` — seeded PRNG and coordinate hash.
- `src/world/` — `blocks.ts` (block ids, properties, textures and sound per face, the default
  hotbar, `PLACEABLE`, `hotbarFrom`; `torchFor` the torch for a face clicked, `torchSupport`),
  `torches.ts` (`torchesHeldBy`: the torches a block holds up), `textures.ts`
  (the procedural block textures and their layer order), `coords.ts`
  (chunk size, index layout, world height), `noise.ts` (2D/3D Perlin, fBm), `biomes.ts`
  (climate, biome weights, blended heights), `generate.ts` (column jobs: height map with a
  border for slopes, `writeLayers` per column, caves, ores, all-air chunks as null, spawn
  search; options to switch caves and ores off), `caves.ts` (carving, `carvedAt`),
  `features.ts` (ore veins and trees across chunk borders; `Ground`, what tree placement asks), `light.ts` (sunlight and block
  light per block: `lightColumn` in the worker, `lightBorders` when a column arrives,
  `updateLight` after an edit, shared `FULL_SUN` / `DARK` arrays), `visibility.ts` (chunk face connectivity
  and the walk from the player's chunk that decides what to mesh and draw),
  `world.ts` (`Chunk`, `World`: get/set across chunks, columns, light and stale chunks on edit,
  `EMPTY_BLOCKS` shared by all-air chunks and copied on the first edit),
  `raycast.ts` (grid traversal), `physics.ts` (a box of any size, the player's by default: swept collision, walking, jumping,
  crouching at edges, swimming, flying; `overlapsBlock` for placing; `stepMob` for mobs), `mining.ts` (break
  timing and crack stage).
- `src/mobs/` — `kinds.ts` (the four kinds: size, speeds, climb and drop, biomes, ground,
  groups), `brain.ts` (a mob: idle, wander, flee, rest; following paths, jumping, getting
  unstuck; pure, a seeded RNG each, paths through a `MobContext`), `pathfind.ts` (A* over the places a mob can stand: steps, drops, no corner
  cutting, swimming at the surface, node and range limits; typed arrays reused between
  searches), `blockCache.ts` (blocks for a search by number-keyed chunk, much faster than
  `World.getBlock`).
- `src/mesh/` — `padding.ts` (the 34³ padded copies of blocks and light, whole rows at a time), `builder.ts` (growable
  typed-array output, `MeshData`: Float32 positions, RGBA8 colour (shade × AO, sunlight, block light), uvl (u, v in blocks, layer),
  Uint16 indices, every quad 4q + (0, 1, 2, 0, 2, 3): a flipped quad turns its corners instead;
  `faceStarts`: quads by face direction in `FACE_ORDER` +x, +y, +z, -x, -y, -z, then torches),
  `mesher.ts` (greedy mesher with AO, smooth light per corner, texture coordinates, torches as small boxes; opaque, cutout (leaves) and transparent passes;
  `flatFaces` for far chunks), `lod.ts` (far chunks: the padded input coarsened in place into
  cells of 2³ or 4³ blocks, water kept exact, trunks kept, walls on seams between levels), `culled.ts` (the
  scaffold's one-quad-per-face mesher, kept as the test oracle and bench comparison).
- `src/render/chunkRenderer.ts` — chunk meshes into pages, opaque, cutout and transparent apart:
  solid blocks drawn by a shader with no `discard` (keeps early depth rejection), leaves after.
  `chunkPage.ts` — a page: a `BatchedMesh` used for its multi-draw path, with its own space
  (`pageAllocator.ts`, in quads, first fit), one shared index buffer, and a draw list built each
  frame from the visible chunks in the frustum (blended ones farthest first); opaque chunks draw
  only the face directions that can point at the camera (`faceRanges`). `blockMaterial.ts` — the texture
  array, the chunk shader (light, water drift). `icons.ts` — isometric block icons from the
  textures. `sky.ts` — time of day to daylight, sunlight colour, sky
  and fog colour, the sun's path, stars (pure). `skyDome.ts` — the dome, sun, moon and stars.
  `clouds.ts` — the blocky cloud layer and its tiling pattern. `fog.ts` — fog colour and
  start by biome, eased (pure). `water.ts` — the fog and background, above and under water,
  and the water texture's drift.
  `crack.ts` — the crack pattern and overlay. `particles.ts` — breaking and digging particles
  (simulation, pure; one InstancedMesh). `heldBlock.ts` — the held block (a lone block meshed,
  drawn in its own pass; bob, swing and switch motion, pure).
- `src/chunkLoader.ts` — load / mesh / unload scheduling: starts jobs by `columnPriority`
  (near first, in front before behind) up to the pool's capacity, meshes only chunks the
  visibility walk reaches and hides the rest, drops stale or out-of-range results, remeshes
  edits on the main thread; reads a column's saved chunks before generating it. Columns with
  nothing left to do are skipped until a walk, an edit or a result changes that, and turning
  only re-sorts them (no walk), so view distance 16 loads and turns cheaply. Each column has a
  level of detail by distance (`lodLevel`, with hysteresis; far ones walled on every side,
  `wallsFor`); a mesh is known by its stamp (version and form), so a level change remeshes like
  an edit, after the chunks with no mesh at all, the old mesh shown meanwhile.
- `src/audio/` — `cues.ts` (which sounds movement and digging make, when: pure), `sound.ts`
  (Web Audio: a recipe per block material, volume, mute).
- `src/save/` — `rle.ts` (chunk blocks run-length encoded), `store.ts` (`WorldStore`: world
  records and chunks, in IndexedDB or memory), `saver.ts` (`WorldSaver`: which chunks a world
  has, writing edited ones soon after an edit and before unloading, the player and time),
  `worlds.ts` (unsaved URLs, seeds from text, new ids and names).
- `src/workers/` — `protocol.ts` (job and result messages, transfer lists, `JobRunner`; mesh jobs
  take a level of detail and seam sides),
  `jobs.ts` (what a worker does with a job; pure), `chunkWorker.ts` (worker entry),
  `pool.ts` (`WorkerPool`).
- `src/input.ts` — keys and mouse buttons held (only with the mouse captured), presses kept
  until taken, mouse look and pointer lock (raw input where the browser has it, else `SpikeFilter`
  drops Chrome's occasional huge moves).
- `src/player.ts` — the player: physics at a fixed step, interpolated camera, fly toggle,
  waiting for the ground to load; `autopilot` for `?autofly`.
- `src/main.ts` — entry point: the world list, or the game for `?world=<id>` (or an unsaved
  world). `src/game.ts` — the game: opening the world, editing, HUD, frame loop, pause,
  autosave.
- `src/ui/` — `worldList.ts` (play, new, rename, delete, settings), `pauseMenu.ts` (play,
  settings, save and quit, keys), `inventory.ts` (the block picker), `settingsPanel.ts` (sliders and toggles), `dom.ts` (small DOM
  helpers). Plain DOM, styled in `style.css`.
- `src/stats.ts` — `?stats` overlay (F3), with GPU time per frame (`render/gpuTimer.ts`). `src/autofly.ts` — `?autofly[=seconds]`, a scripted
  sprint flight that reports frame times and holes. `?radius=12` overrides the view radius,
  `?workers=1` the worker count, `?at=x,z` where you spawn (`?seed`, `?at` and `?autofly` play
  an unsaved world), `?light` shows light as grey,
  `?time=0.5` holds the time of day, `?daylength=60` shortens the day, `?lod=0` keeps every
  column at full detail (`?lod=8,13` moves the half- and quarter-detail rings), `?aa=0` turns antialiasing
  off and `?scale=0.5` draws at half resolution (for measuring the GPU).
- `bench/` — `npm run bench`.
- `tests/` — world, generation, padding, mesher (greedy against culled, AO and light against
  the world), light (against a whole-area reference), raycast, physics, player, sky, RLE, store
  saving and world-list rule tests (headless; IndexedDB through `fake-indexeddb`).

## Conventions

- Block (x, y, z) fills the unit cube from (x, y, z) to (x+1, y+1, z+1). +Y is up.
  Chunk coordinates round **down** (`toChunk(-1) === -1`); always use `toChunk` /
  `toLocal`, never `Math.floor(x / 32)` scattered around.
- Mesh positions are in world space; chunk meshes have no transform.
- Quads are counter-clockwise seen from outside (there's a test for it).
- World code is deterministic: same seed, same world, regardless of load order or thread.
- Gameplay knobs go in `TUNING`. Block properties go in `BLOCKS`.
- Strict TypeScript. No `any` unless there is a comment explaining why.
- Hot loops (generation, meshing, lighting) work on typed arrays with integer
  indices, and don't allocate per block. Copy imported constants into local `const`s used
  in them (under Vitest each use of an import is a property lookup). Measure before and
  after optimising.
- Invented content only: no Minecraft textures, sounds, names or logos. Generate textures
  procedurally or use CC0 packs (recorded in `ASSETS.md`).

## Verifying changes

- Run `npm run build` and `npm test` after every change; both must pass.
- World and mesher tests are headless and exact: face counts, culling across chunk
  borders, determinism of generation, raycast hits, collision results, light values
  after placing and removing a torch, save → load round trips. Add a test with each
  feature.
- **Performance is a feature here.** Add a `?stats` overlay (fps, frame time,
  draw calls, triangles, chunks loaded, jobs queued, worker busy time, memory) early in
  Milestone 1, and a benchmark script (`npm run bench`) that times generating and meshing
  a fixed set of chunks headless, so optimisations are measured, not guessed. Record
  before and after numbers in the milestone notes.
- For visual changes, run the dev server and look at it in a browser (screenshot if
  possible). Check the console for errors. Fly fast in a straight line and watch for
  stutter and holes at chunk borders.
- Feel (movement, jumping, digging speed) can't be judged by reading code. Ask me to
  playtest with specific questions.
- Budget: 60 fps on a laptop at view radius 8, no frame over 20 ms while flying.

## Roadmap

Work one milestone at a time and keep the game playable at the end of each. Before
starting a milestone, write a short plan in `docs/milestone-N.md` (files, data
structures, tests, how you'll measure) and check it with me.

1. **Fast engine.** `?stats` overlay and `npm run bench` first. Move generation and meshing
   into a worker pool (transferables, job priorities by distance, cancel jobs for chunks
   that went out of range). Greedy meshing with per-vertex ambient occlusion. Load in a
   ring order that fills the view first. Target: no frame drops flying at sprint speed.
2. **Walking player.** Gravity, AABB collision against blocks, jumping, sprinting,
   crouching (no walking off edges), swimming and the underwater view, fly mode as a
   toggle. Block breaking takes time per block type with a crack overlay; placing can't
   put a block inside the player.
3. **Richer world.** Procedural texture atlas (or texture array) generated at startup,
   textured greedy meshes, alpha-tested leaves. Biomes (temperature and humidity noise:
   plains, forest, desert, snowy mountains), caves from 3D noise, ores, trees across chunk
   borders, taller world if wanted.
4. **Light and saving.** Sunlight and block light with BFS propagation (torches,
   glowstone-like blocks), smooth lighting in the mesher, day / night cycle. Save edited
   chunks to IndexedDB (RLE), named worlds with a world-select menu.
5. **Polish.** Sky with sun, moon and clouds, fog by biome, water that animates, footstep
   and digging sounds (synthesised, as in the earlier games), block particles when
   breaking, a hand or held block, an inventory with creative-mode block picker, settings
   (view distance, mouse sensitivity, FOV).
6. **120 fps on a laptop GPU** (`docs/milestone-6.md`). Batched chunk drawing (multi-draw),
   faces pointing away from the camera skipped, packed vertices, lower detail for far chunks.
   Target: 120 fps at view radius 8 over mountains on an Intel UHD laptop, radius 16 near it.
7. **Optional, pick one:** simple mobs with A* pathfinding on the voxel grid; flowing water
   (cellular automaton); redstone-like logic blocks; multiplayer (a Node WebSocket server
   that owns the world and streams chunks and edits, building on the online code in the
   earlier games).
