# Milestone 4 plan: light and saving

## Status: plan, waiting for your OK

Goal from the roadmap: sunlight and block light with BFS propagation (torches, a glowing
block), smooth lighting in the mesher, a day / night cycle; edited chunks saved to IndexedDB
(RLE), named worlds with a world-select menu. Playable after every step, and still inside
the budget (60 fps on your laptop at radius 8, no frame over 20 ms flying).

## Scope decisions

- **Two light values per block, 4 bits each:** sunlight (high nibble) and block light (low),
  in a `Uint8Array` of 32³ per chunk next to the blocks. Most chunks don't need one: chunks
  that are all sky light 15 (the air above the terrain) share one read-only `FULL_SUN` array,
  and chunks with no light at all (solid rock, unlit caves) share `DARK`. Copied on the first
  change, like `EMPTY_BLOCKS`. Light isn't saved: it follows from the blocks.
- **How light moves:** sunlight is 15 straight down through air and glass, without loss.
  Every other step (sideways, up, down through anything else) costs 1. Leaves and water cost
  1 more, so forests are shaded and deep water darkens. Opaque blocks stop light. Block light
  spreads the same way from blocks that give light, costing 1 per step. The result is the
  largest light any source can reach a block with. Increase-only flood fills give that
  result whatever order chunks arrive in, so the world stays deterministic.
- **Where light is worked out:**
  - *In the worker, with generation.* The generate job lights its own column: sky columns
    filled straight down, then a BFS spreading sideways and down into overhangs, caves under
    openings, under trees and into water. Outside the column counts as dark.
  - *On the main thread, at column borders.* When a column arrives, light flows across its
    borders with each loaded neighbour, from the brighter side, as an increase-only BFS that
    may continue into further loaded chunks. On open ground both sides are 15, so little
    flows. Cave mouths and shade next to a border do flow.
  - *Why light is final when the mesher needs it.* Light reaches at most 14 blocks, and a
    column is 32 wide. So once a chunk's 3 × 3 columns are loaded and lit, the light within
    one block of it is final. That is already the rule for meshing.
- **Edits update light on the main thread** with the usual add and remove BFS ("fast flood
  fill lighting", Ben Arnold): placing a torch, breaking the block that roofed a shaft, closing
  a cave mouth. Every chunk whose light changed, and every neighbour that pads it, is
  remeshed. They're remeshed synchronously, like edits now. The worst case (a torch at a
  chunk corner, up to 8 chunks) is measured; if it breaks 20 ms, chunks whose light alone
  changed go to the workers first in the queue instead.
- **Smooth lighting in the mesher.** Each corner averages the light of the block in front of
  the face and the three around that corner (the same blocks AO looks at), leaving out opaque
  ones, separately for sun and block light. Faces merge only when all four corners match, as
  with AO. Open sunlit ground is all 15, so it merges as before; shade and caves merge less.
  The mesh job gets a padded copy of the light (34³, 39 KB, transferred) beside the padded
  blocks.
- **No bigger vertices.** The RGBA8 colour, now grey shade × AO in all three channels, becomes:
  - r: directional shade × AO;
  - g: sunlight;
  - b: block light.

  The shader turns light levels into brightness (each level 0.8× the one above, as is usual),
  using the larger of sunlight × daylight and block light. Block light gets a slight warm
  tint. Day and night therefore need no remeshing: daylight is a uniform.
- **Day / night:** one day lasts `TUNING.day.length` (20 minutes proposed). Daylight runs from
  1 at noon to 0.2 at night, through dawn and dusk. The sky and fog colours follow it (blue,
  orange at dawn and dusk, dark blue at night). The sun and moon themselves are Milestone 5
  (sky). `?time=0.5` picks the time of day, for screenshots and measuring.
- **New blocks:**
  - *Torch:* a small stick on the block below (2 × 10 × 2 pixels), light 14, not merged,
    passable but targetable. The raycast gains a `targetable` property for it.
  - *Lamp:* a full block of invented glowing glass-and-metal, light 15.
  - *Hotbar:* torch and lamp take the sand and leaves slots until the block picker in
    Milestone 5.
- **Saving:**
  - *Storage:* IndexedDB database `voxel-sandbox` with two stores:
    - `worlds`: id, name, seed, created, last played, player position, look, flying and
      time of day;
    - `chunks`: key [world, cx, cy, cz], value the RLE blocks.
  - *What is stored:* only modified chunks.
  - *When:* within 2 s of the last edit, when an edited chunk is unloaded (it is no longer
    kept in memory forever), and on `pagehide` (best effort).
  - *Loading:* opening a world reads which chunk keys it has saved (keys only, small).
    Before a column with saved chunks is generated, they're read and sent with the generate
    job. The worker puts them in place of the generated chunks, then lights the column. So
    light and connectivity come out right for edited chunks too.
- **RLE:** (run length, block) pairs, with a varint length. Pure, in `save/rle.ts`. Runs go
  along x, so a chunk with long flat layers should shrink to a few KB from 32 KB. Measured
  in step 5.
- **Named worlds and a world-select screen:** plain DOM over the canvas, in the style of the
  racing game's menu.
  - *The list:* name, seed, last played. Play, New (name, optional seed, else random),
    Rename, Delete (with a confirmation).
  - *Opening a world:* Play loads `?world=<id>`. Quitting goes back to the list. Each world
    starts in a fresh page, so workers and GPU memory start clean.
  - *Pause menu (Esc):* resume, quit to the world list. Saving is automatic.
  - *Measuring:* `?seed=`, `?autofly` and `?at=` still skip the menu and play an unsaved
    world.
- **Out of scope:** coloured light, wall torches (placed on the floor only; walls could come
  in Milestone 5), light from lava (there is none), shadows from the sun, saving the
  inventory (there isn't one yet), exporting worlds to a file.

## Files

| File | Contents |
| --- | --- |
| `src/world/light.ts` | Light arrays (`FULL_SUN`, `DARK`, copy on write), `lightColumn` (worker), `spreadBorders` (column arrives), `updateLight` (edit: add and remove BFS, returns the chunks changed) |
| `src/world/blocks.ts` | `light` (emitted), `lightCost` (1, 2 for leaves and water, opaque stops), `targetable`; Torch, Lamp; hotbar |
| `src/world/textures.ts` | Torch and lamp textures |
| `src/world/world.ts` | `Chunk.light`; `addColumn` takes light; edits update light |
| `src/world/raycast.ts` | Stops at targetable blocks (torches) as well as solid ones |
| `src/workers/protocol.ts`, `jobs.ts` | Generate: saved chunks in, light out. Mesh: padded light in |
| `src/mesh/padding.ts` | `paddedLight` beside `paddedBlocks` |
| `src/mesh/mesher.ts` | Corner light (sun, block) in the merge key and the vertex colour; torch geometry |
| `src/render/blockMaterial.ts` | Light curve, daylight uniform, warm block light |
| `src/render/sky.ts` | Time of day → daylight, sky colour, fog colour |
| `src/save/rle.ts` | Encode / decode chunk blocks |
| `src/save/store.ts` | IndexedDB: worlds and chunks (`WorldStore`), plus an in-memory store for tests |
| `src/ui/menu.ts`, `style.css`, `index.html` | World list, new world, rename, delete, pause menu |
| `src/chunkLoader.ts` | Saved chunks into generate jobs; light across borders when columns arrive; save before unloading edited chunks |
| `src/main.ts` | Start from the menu or the URL; autosave; time of day |
| `src/stats.ts`, `bench/bench.ts` | Light time per column, edit light time, light memory |

## Key data structures

```ts
// Per chunk, beside `blocks`: sun << 4 | block light, same index layout.
class Chunk {
  light: Uint8Array;            // FULL_SUN / DARK (shared, read-only) until changed
}

// Vertex colour (RGBA8): r = directional shade × AO, g = sunlight, b = block light
// (corner averages, 0–15 scaled to 0–255), a = 255.

interface BlockInfo {
  // … as now, plus:
  light: number;                // emitted, 0–15 (torch 14, lamp 15)
  lightCost: number;            // extra cost to pass: 0 air / glass, 1 leaves / water; opaque stops it
  targetable: boolean;          // the raycast stops here even if passable (torch)
}

type Job =
  | { kind: 'generate'; …; saved: { cy: number; blocks: Uint8Array }[] }   // edited chunks of the column
  | { kind: 'mesh'; …; padded: Uint8Array; paddedLight: Uint8Array };
// The generate result gains `light: (Uint8Array | null)[]` (null: FULL_SUN or DARK, with a flag).

interface WorldRecord {
  id: string; name: string; seed: number; created: number; played: number;
  player: { x: number; y: number; z: number; yaw: number; pitch: number; flying: boolean };
  time: number;                 // time of day, 0–1
}
// chunks store: key [worldId, cx, cy, cz] → Uint8Array (RLE)
```

## Tests

- **Sunlight:**
  - 15 in open air down to the ground, and 0 inside solid rock;
  - a cave under an opening is lit with the right falloff;
  - leaves and water darken by the extra cost;
  - shared arrays are copied on the first change.
- **Across borders:** light near a column border is the same whichever column loads first,
  and equals lighting the whole area at once (a slow reference BFS in the test).
- **Edits:**
  - placing a torch gives 14 at the torch, 13 next to it, … 0 at 15 steps;
  - removing it brings back exactly the light before;
  - roofing a sunlit shaft darkens below, and breaking the roof restores it;
  - random edits near chunk borders always equal a full recompute;
  - the chunks reported changed are exactly those whose light or padding changed.
- **Mesher:**
  - each corner's light is the average of its four samples, without opaque ones;
  - faces with different light don't merge;
  - a flat sunlit test area gives the same triangle count as now;
  - the torch is its small box, and the faces next to it aren't hidden by it.
- **Saving:**
  - RLE round trips: random and generated chunks, all air, all one block, runs over 255;
  - store round trips: worlds created, listed, renamed and deleted (with their chunks);
  - a world reopened has its edited blocks back, lit correctly.

  The store is tested against an in-memory implementation of the same interface, and the
  IndexedDB store against `fake-indexeddb` (a dev dependency, MIT, tests only).
- **Day / night:** daylight and the sky colour at noon, dusk and midnight; the cycle wraps.

## How it's measured

- `npm run bench`:
  - generation with light per column, and the light pass alone;
  - meshing with smooth light: time, triangles (less merging in shade), vertex data;
  - the worst edit: a torch at a chunk corner, the light BFS plus remeshing, in ms;
  - RLE: bytes per edited chunk, encode and decode time.
- `?autofly` at radius 8, before and after: main thread, frames over 20 ms, first view,
  memory (chunk data grows by the light arrays that aren't shared).
- `?stats` gains light memory, the last edit's light time, and the time of day.
- Screenshots: a cave lit by torches, a forest's shade, dusk, night. Your laptop's
  `?autofly&stats` again at the end.

## Order of work (one commit each, playable after each)

1. Light data, sunlight in the generate job, light across borders on the main thread, and
   `?light` drawing raw light as grey for checking. Measure generation and memory.
2. Smooth lighting in the mesher and the shader. Caves go dark here, so torch and lamp
   blocks come in this step too, as light sources lit at generation, without edit updates
   yet. Measure meshing and triangles.
3. Light on edits: add and remove BFS, remeshing what changed. Measure the worst edit.
4. Day / night cycle: daylight, sky and fog colours, `?time`.
5. Saving: RLE, the IndexedDB store, saved chunks into generate jobs, autosave, player
   state. Measure.
6. Named worlds: world list, new, rename, delete, pause menu.
7. Notes, measurements, deploy, playtest questions.

## Questions for you

1. Caves fully dark without torches, as is usual (proposed), or a faint minimum so you can
   always make out walls?
2. Should crystal ore glow faintly (light 6)? It would make caves less black and the rare ore
   easier to spot.
3. Torches on the floor only for now (proposed), or on walls too? Wall torches need a second
   shape and placement rules.
4. A 20-minute day (proposed)? A longer or shorter cycle?
5. Saving is automatic, with no save button (proposed): fine?
6. `fake-indexeddb` as a test-only dev dependency: OK?
