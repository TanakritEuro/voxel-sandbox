# Milestone 4 plan: light and saving

## Status: in progress (steps 1–4 done; saving next)

Approved 2026-10-23 as proposed: caves fully dark without torches, crystal ore glows faintly
(light 6), torches on the floor only, a 20-minute day, automatic saving, `fake-indexeddb` for
the store tests.

Goal from the roadmap: sunlight and block light with BFS propagation (torches, a glowing
block), smooth lighting in the mesher, a day / night cycle; edited chunks saved to IndexedDB
(RLE), named worlds with a world-select menu. Playable after every step, and still inside
the budget (60 fps on your laptop at radius 8, no frame over 20 ms flying).

## Results so far

**Step 1 (light data).**
- **`world/light.ts`, in the worker:** `lightColumn` lights a generated column on its own.
  - It works on the column's 8 chunks laid end to end: one 256 KB array, since chunks are
    stored y-major.
  - The open sky is filled from the top down. A BFS then starts only where sun meets shade:
    sunlit blocks next to a column shaded at that height, and the lowest sunlit block of each
    column (into leaves or water). It doesn't start from all 180k sunlit blocks.
  - Block light comes from crystal ore, which now gives light 6, as approved.
- **On the main thread:** `lightBorders` runs when a column is added. It compares the facing
  layers across each border with a loaded neighbour. Pairs of chunks that are both all sun
  or both all dark are skipped. Light flows from the brighter side, and a BFS carries it on
  through loaded chunks.
- **Shared arrays:** a chunk wholly in sun shares `FULL_SUN`, and one wholly dark shares
  `DARK`. Either is copied on the first write.
- **Into the mesher:**
  - The generate result carries each chunk's light, as an array or as a fill value, and
    transfers the arrays.
  - The mesh job carries a padded copy of the light (34³).
  - The greedy mesher puts the light of the block in front of each face into the merge key,
    and into the vertex colour: sunlight in green, block light in blue. Shade × AO moves to
    red only.
  - Smoothing per corner is step 2. Until then the game looks as before.
- **`?light`:** draws the brighter of the two lights as grey instead of the textures.
  Checked in the pane at the cave mouth (`?at=-48,71`): bright at the opening, fading to
  black down the tunnel, face by face.
- **Tests (6 new, 122 in all):**
  - Full sun in the open and none in the ground; shared arrays.
  - Water losing 2 a block (13, 11, … 1, then 0 at 7 deep).
  - Light across column borders equals lighting a whole 3 × 2-column area at once, in three
    load orders, at a cave mouth and in a forest. The reference is written independently: a
    bucket per level, brightest first, instead of flood fills that raise blocks repeatedly.
  - Crystal glow across a border.
  - Copy on write of the shared arrays.
  - The greedy mesher's AO check now also checks each quad's light against the world.

| bench (radius 8, 253 columns, 724 meshed chunks) | before | after |
| --- | --- | --- |
| generate | 1014 ms (machine busy; 701 in the run after) | 701 ms |
| light, in the worker | | 225 ms (0.89 per column, p95 1.6, max 3.1) |
| light across borders, main thread | | 74 ms (0.29 per column, p95 0.6, max 2.3) |
| pad (now blocks and light) | 73 ms | 136 ms |
| greedy mesh | 855 ms, 2118k triangles, 92.9 MB | 915 ms, 2225k triangles (+5 %), 97.6 MB |
| seen from spawn | 1721k triangles | 1819k |
| light data | | 609 of 2024 chunks with their own array, 19.1 MB; 1063 all sun, 352 all dark |

`?autofly` at radius 8 (production build). The machine was slower than when the Milestone 3
numbers were taken, so the deployed Milestone 3 build was measured again alongside:

| | Milestone 3 (live site, today) | step 1 |
| --- | --- | --- |
| main thread p50 / p99 / max | 3.1 / 8.4 / 11.3 ms | 3.4 / 8.1 / 9.6 ms |
| frames over 20 ms, holes | 0, 0 | 0, 0 |
| first view, all | 4.13 s (over the network) | 2.79 s |
| triangles drawn / in the scene | 406k / 3030k | 429k / 3211k |
| memory after the flight | chunks 40.8, meshes 132.9 MB | chunks 40.8, light 25.5, meshes 140.9 MB |

Light costs about 0.9 ms of worker time per column (a quarter more than generating it), and
under 0.3 ms of main thread per column. Merging loses 5 % to faces whose light differs; per
corner smoothing in step 2 will lose more in shade and caves.

**Step 2 (smooth lighting, torch and lamp).**
- **Smooth lighting in the mesher:**
  - Each corner of a face averages the light of the block in front of it and the three
    around that corner (the blocks AO looks at). Opaque ones are left out, and the diagonal
    one too when both sides are opaque. Sunlight and block light are averaged separately.
  - Two more 32 × 32 masks hold a face's four corner values, a byte each. Faces merge only
    where block, AO and all eight light bytes match.
  - Where AO doesn't decide which diagonal to split a quad along, light does.
  - Blocks that give light show at least that light on their own faces: lamps glow in the
    dark, and crystal ore glows faintly.
  - Water and glass keep flat light, as they keep no AO.
- **Shader:**
  - Each light level is 0.8× as bright as the one above, rescaled so level 0 is black (caves
    fully dark, as approved). This is worked out per pixel from the interpolated levels, so
    gradients are smooth.
  - Brightness is the larger of sunlight × `daylight` (a uniform, 1 until step 4) and block
    light tinted warm (`TUNING.render.blockLightColour`). The falloff is
    `TUNING.render.lightFalloff`.
- **New blocks:**
  - *Torch* (light 14): a 2 × 10 × 2-sixteenths box on the floor, five faces, never merged.
    Its side texture has one colour per row (flame, then stick), so stretching it across the
    narrow face loses nothing. The hotbar uses an icon texture of its own.
    - It can be walked through but is targetable: the raycast stops at `targetable` blocks
      now, not at non-passable ones.
    - It can only be placed in air on top of an opaque block, and goes when that block is
      broken.
  - *Lamp* (light 15): a full block of warm panes in a dark frame.
  - *Hotbar:* torch and lamp take the sand and leaves slots.
- **Placed lights don't light their surroundings yet.** A torch or lamp you place shows its
  own glow but lights nothing around it until edits update light in step 3. Torches and
  lamps in generated chunks (none so far) and crystal ore are lit at generation.
- **Checked in the pane:**
  - The cave at `?at=-48,71` fades smoothly from the opening into black.
  - A placed lamp glows warm in the dark tunnel, and a placed torch stands on the floor with
    its flame on top.
  - In the forest, shade falls under the canopy.
  - No console errors.
- **Tests (3 new, 125 in all):**
  - The greedy mesher's world check now works out each corner's smooth light on its own
    (samples, average, glow) for every quad on terrain and block soups. Quads must agree
    corner by corner, so differently lit faces never merge. The diagonal follows light when
    AO ties.
  - A torch's box, light and texture.
  - A lamp at full glow with no light around it.
  - The raycast stops at a torch.
  - The culled reference mesher leaves torches out, as they aren't grid faces.

| bench | step 1 | step 2 |
| --- | --- | --- |
| greedy mesh | 915 ms, 2225k triangles, 97.6 MB | 910 ms, 2321k triangles (+4 %), 101.8 MB |
| seen from spawn | 1819k | 1910k |

Against Milestone 3, smooth light costs 10 % more triangles (2118k → 2321k) and no mesh time
that the bench can tell apart.

`?autofly` at radius 8 (production build, the machine quieter than in step 1): first view in
front 1.45 s, all 2.07 s; main thread p50 2.0, p99 5.4, max 6.3 ms; no frame over 20 ms; no
holes; 468k triangles drawn of 3386k; meshes 148.5 MB, light 25.5 MB.

**Step 3 (light on edits).**
- **`updateLight` in `light.ts`,** run by `World.setBlock` after every edit, on both channels:
  1. *Removal BFS:* the block's old light is taken away, and so is every neighbour's that
     could have come from it (less than it, or sunlight straight down at 15).
  2. *Refill:* neighbours with light from elsewhere are queued, and light flows back in from
     them, from the block's open neighbours, from the sky above the top of the world, and from
     the block itself if it gives light. A light-giving block caught by a removal keeps its own
     light and spreads it again.
- **What gets remeshed:**
  - Every write records the block's light from before its first change in the edit. At the
    end, only blocks whose light really differs count: removals mostly put light back as it
    was.
  - Their chunks, and the neighbours whose padding holds them, get a new version.
    `setBlock` returns them with the chunks whose geometry is stale, and `main.ts` remeshes
    them all at once.
- **`?stats`** shows the last edit: total ms, ms of light, chunks remeshed.
- **Tests (3 new, 128 in all), each against the independent whole-area reference:**
  - *A torch in a dark cave:* 14 at it, 13 next to it. Removing it brings back exactly the
    light before.
  - *A sunlit shaft:* 15 all the way down. Roofed, no block in it keeps sun 15. Unroofed, the
    light is exactly as before.
  - *60 random edits near chunk borders:* stone, air, torches, lamps, leaves, glass, water,
    planks and crystal, from the caves to the sky. After every 20, the whole 3 × 2-column area
    equals the reference. After every edit, the chunks returned are exactly those with a
    changed block or light in their padded area.

  The world test for stale neighbours now uses solid rock, where swapping two opaque blocks
  changes no light. The torch mesh test checks the floor's area, since the lit floor no
  longer merges into one quad.
- **Checked in the pane (production build):**
  - Torches placed in the cave at `?at=-48,71` light the floor and walls warmly.
  - A lamp lights a wider area, and breaking it takes its light away.
  - Coal in the cave floor shows up where it's lit.
  - No console errors.

| worst edits (bench, main thread, median of 5) | place | remove | chunks remeshed |
| --- | --- | --- | --- |
| torch at a chunk corner, on the surface | 8.3 ms (light 1.2) | 7.9 ms (light 1.4) | 8 |
| torch near a chunk corner, in a cave | 10.1 ms (light 0.8) | 9.8 ms (light 0.7) | 8 |
| lamp near a chunk corner, in a cave | 10.3 ms (light 1.1) | 10.3 ms (light 0.8) | 8 |

The light itself takes about 1 ms. Remeshing up to 8 chunks on the main thread is the rest.
In the browser:
- Edits away from corners (one chunk) took 4–8 ms.
- The first edit after loading took 11–14 ms, while the mesher's code on the main thread is
  still cold.
- No edit made a frame go over 20 ms.

The worst case stays inside the budget, so remeshing stays synchronous, as decided in
Milestone 1. If your laptop shows long frames when placing torches near chunk corners, the
plan's fallback is ready: chunks whose light alone changed go to the workers, first in the
queue.

**Step 4 (day and night).**
- **`render/sky.ts`:** `skyAt(time)` maps the time of day (0 midnight, 0.25 sunrise, 0.5 noon,
  0.75 sunset) to three things, all from the sun's height (a sine of the time):
  - *Daylight:* from `TUNING.day.night` (0.2) to 1.
  - *Sunlight's colour:* white by day, warm near the horizon, a cool moonlight at night.
  - *The sky and fog colour:* day blue, a peach twilight, dark navy at night.
- **Nothing is remeshed.** The chunk shader's `daylight` uniform became `sunlight`, a colour
  (sunlight level × that colour, block light unchanged), so torches stand out at night.
- **Fog:** `WaterView` now sets the fog and background every frame: the sky's colour above
  water, and below it the water blue, dimmer at night.
- **Clock:** a day lasts `TUNING.day.length` (1200 s), and a world starts at 07:12.
- **New URL options:**
  - `?time=0.5` holds the time where it is, for screenshots and measuring;
  - `?daylength=60` makes a day last 60 seconds, to watch it go round.
- **`?stats`** shows the clock and daylight.
- **One change after looking:** daylight first faded over a shorter span than the sky's colour.
  Just after sunset (18:21) the sky was still bright peach over land almost as dark as night.
  Light now fades over the same span (sun height −0.3 to 0.3), so land and sky darken
  together.
- **Checked in the pane** from the same vista (`?autofly=1&time=…`):
  - noon looks as before;
  - 06:21 has a peach sky with warm, lower light;
  - 18:21 is dusk, darker, with daylight at 0.42;
  - midnight has a navy sky and very dark land.
  - No console errors.
- **Cost:** a uniform and two colours a frame; the main thread shows no difference.
- **Tests (5 new, 133 in all):**
  - noon is full white light under the day sky;
  - midnight is dim, blue-leaning moonlight under the night sky;
  - sunset is the twilight sky with warm, partial light, the same as at sunrise;
  - daylight only rises from midnight to noon, the cycle wraps, and mornings mirror evenings;
  - the clock reads as expected.

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

## Questions asked (answered above)

1. Caves fully dark without torches, as is usual (proposed), or a faint minimum so you can
   always make out walls?
2. Should crystal ore glow faintly (light 6)? It would make caves less black and the rare ore
   easier to spot.
3. Torches on the floor only for now (proposed), or on walls too? Wall torches need a second
   shape and placement rules.
4. A 20-minute day (proposed)? A longer or shorter cycle?
5. Saving is automatic, with no save button (proposed): fine?
6. `fake-indexeddb` as a test-only dev dependency: OK?
