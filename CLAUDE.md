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

Scaffold. A seeded heightmap world (`world/generate.ts`: fractal Perlin noise, grass, dirt,
stone, sand beaches, water to sea level) in 32³ chunks, 128 blocks tall. Chunks within
7 chunks of the camera are generated and meshed on the main thread within a time budget
per frame, nearest first, and unloaded when far away (`chunkLoader.ts`). The mesher
(`mesh/mesher.ts`) emits one quad per visible face with baked directional shading and
vertex colours; water and glass go in a separate transparent pass. A free-fly camera
with pointer lock (`player.ts`), a voxel raycast (`world/raycast.ts`) with a block
outline, left click to break, right click to place, 1–9 or the wheel for the hotbar.
`?seed=123` picks the world.

Known scaffold limits, each fixed by a milestone below: generation and meshing stall
the main thread (frame drops while flying), far more triangles than needed (~400k at
radius 7), no ambient occlusion or lighting, no textures, no gravity or collision,
no trees or caves, and edits are lost on reload.

## Architecture

- **World data** (`src/world/`): pure TypeScript, no `three`, DOM or `window`. Chunks are
  `Uint8Array`s of block ids (`coords.ts` defines the layout: x fastest, then z, then y).
  Generation is a pure function of seed and chunk coordinate, so chunks can be made in any
  order on any thread. All randomness comes from the seed (`math.ts`); never `Math.random`
  in world code.
- **Meshing** (`src/mesh/`): pure. Input is a chunk's blocks plus a one-block border from
  its neighbours (`paddedBlocks`, 34³), output is typed arrays. This is exactly the
  shape that can be posted to and from a Web Worker with transferable buffers.
- **Presentation** (`src/render/`, `main.ts`, `player.ts`): turns mesh data into Three.js
  meshes, one or two per chunk, frustum-culled by their bounding spheres.
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

- `src/config.ts` — `TUNING`: seed, view radius, frame budget, fly speed, reach, sky.
- `src/math.ts` — seeded PRNG and coordinate hash.
- `src/world/` — `blocks.ts` (block ids, properties, colours, hotbar), `coords.ts`
  (chunk size, index layout, world height), `noise.ts` (2D/3D Perlin, fBm), `generate.ts`
  (terrain by column with one heightmap, all-air chunks as null, sea level, spawn search),
  `world.ts` (`Chunk`, `World`: get/set across chunks, columns, stale neighbours on edit),
  `raycast.ts` (grid traversal).
- `src/mesh/` — `padding.ts` (the 34³ padded copy, whole rows at a time), `builder.ts` (growable
  typed-array output, `MeshData`: Float32 positions, RGBA8 colours, Uint16 indices),
  `mesher.ts` (culled-face mesher, opaque and transparent passes).
- `src/render/chunkRenderer.ts` — Three.js meshes per chunk.
- `src/chunkLoader.ts` — load / mesh / unload scheduling.
- `src/player.ts` — free-fly camera with pointer lock.
- `src/main.ts` — entry point, editing, HUD, frame loop.
- `src/stats.ts` — `?stats` overlay (F3). `src/autofly.ts` — `?autofly[=seconds]`, a scripted
  sprint flight that reports frame times and holes. `?radius=8` overrides the view radius.
- `bench/` — `npm run bench`.
- `tests/` — world, generation, padding, mesher and raycast tests (headless).

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
6. **Optional, pick one:** simple mobs with A* pathfinding on the voxel grid; flowing water
   (cellular automaton); redstone-like logic blocks; multiplayer (a Node WebSocket server
   that owns the world and streams chunks and edits, building on the online code in the
   earlier games).
