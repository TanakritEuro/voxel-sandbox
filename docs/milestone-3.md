# Milestone 3 plan: richer world

## Status: built; waiting for your playtest (and the laptop measurement)

Approved 2026-10-23 as proposed: 256-block world with sea level 62, 16 × 16 pixel-art
textures, no per-biome tint for now, ores coal / iron / copper / crystal. Visibility culling
was added as a step on 2026-10-23.

All steps are in: a 256-block world, procedural textures on greedy meshes, four blended
biomes, caves, ores, trees across chunk borders, and per-chunk visibility culling. 116 tests.
The world is much richer and costs much more to draw: the numbers below are the price.

### Before and after (radius 8, dev machine, 12 threads; the pane at 60 Hz)

| | end of Milestone 2 | end of Milestone 3 |
| --- | --- | --- |
| bench: generate (253 columns) | 174–222 ms (128 blocks tall) | 816 ms (256 tall, biomes, caves, ores, trees) |
| bench: greedy triangles, vertex data | 207k, 7.5 MB | 2118k, 92.9 MB |
| bench: triangles seen from spawn | 207k (no culling) | 1721k |
| `?autofly` (build) main thread p50 / p99 / max | 1.1–1.4 / 3.3–3.7 / 4.5–5.0 ms | 2.3 / 6.0–6.3 / 6.8–7.0 ms |
| `?autofly` frames over 20 ms, holes | 0, 0 | 0, 0 |
| `?autofly` first view (all) | 0.84–0.90 s | 1.72–2.15 s |
| `?autofly` triangles drawn, draw calls | 56k, 68 | 406k, 177 |
| meshes in memory after the flight | 9.6 MB | 133 MB (chunk data 40.8 MB) |
| `?autofly&workers=1`: first view (in front / all) | 3.56 / 5.61 s | 5.07 / 7.63 s |
| `?autofly&workers=1`: holes | none | up to 2 chunks, in 6 of 30 s |

The engine didn't change in Milestone 2, so its first-view, memory and one-worker numbers are
Milestone 1's; its autofly ran with the pane at 120 Hz (the frame budget doesn't depend on it).
Where the cost comes from: mountains (rugged slopes, many faces) and above all caves, whose
walls are 3.6× the surface's triangles; visibility culling takes off only about 20 %, being
per chunk (step 4b explains why). On this machine nothing drops. The one-worker run is the
warning: a single worker no longer keeps up with sprint flying (Milestone 1's did), so a
laptop with 2 cores could see brief gaps in the fog. With 4 cores (3 workers) it should keep
up; your `?autofly&stats` will say. If it doesn't, in order of cost: finer culling sections,
narrower or rarer caves, a smaller view radius by default.

**On your laptop** (2026-10-23, live site, Chrome, `?autofly&stats`, 8 workers, a snapshot
partway through the flight): 60 fps, frame 16.7 ms avg and 16.9 max, main thread 3.7 avg and
8.1 max, 1 frame over 20 ms since load, a flat frame graph; 248 draw calls, 669k triangles
drawn of 3024k; meshes 132.7 MB, chunks 44.3 MB, JS heap 514 MB. Inside the budget, so
visibility culling stays as it is. (The flight's final report wasn't in the screenshot. The
HUD said "waiting for the ground to load" all through the flight; fixed, the autopilot never
waits.)

## Playtest questions

Open https://tanakriteuro.github.io/voxel-sandbox/ (or `npm run dev`). Places to start
(default seed): forest `?at=-121,-226`, desert `?at=384,0`, snowy mountains `?at=0,192`, a cave
mouth `?at=-48,71`.

1. **Laptop performance.** `?autofly&stats` on the laptop: frames over 20 ms, main thread
   p99, holes, meshes in memory. Then fly at sprint over mountains yourself: any stutter or
   gaps?
2. **Textures.** Do the 16 × 16 pixel-art textures read well up close and in the distance? Any
   that look wrong (grass side, sandstone layers, ores, cactus, spruce)? Is AO with textures
   too dark or too light (`TUNING.render.ao`)?
3. **Water.** It's a deeper blue now that the page no longer shows through it. Better or
   too dark?
4. **Biomes.** Size (one swing of climate per ~1400 blocks, `CLIMATE_SCALE`), mix (plains 36 %,
   forest 25 %, mountains 26 %, desert 13 %, 30 % under the sea), and the borders (ragged
   enough, or too ragged)?
5. **Mountains.** Height, steepness, snow line (sea level + 58 ± 8), bare stone on slopes of 3
   or more: too harsh?
6. **Caves.** How often you come across an entrance; tunnel width (`TUNNEL` 0.07, 5.4 % of
   the underground open); the deep caverns. They're as bright as daylight until lighting in
   Milestone 4: acceptable for now?
7. **Ores.** Coal everywhere, iron and copper less, crystal rare (about 20 blocks per 5 × 5
   columns, below y 24). Too rare, too common?
8. **Trees.** Density (forest 0.7, mountains 0.3, plains 0.1, desert 0.08 per 5 × 5 cell),
   oak and spruce shapes, cactus heights.

## Results by step

**Step 1 (shared empty chunks, 256-block world).** All-air chunks point at one shared
`EMPTY_BLOCKS` array; `setBlock` gives a chunk its own the first time it's edited. Then
`MAX_CHUNK_Y` 7 (y 0..255) and sea level 62 (everything above it moves up 22 blocks;
the mountains come with biomes in step 3). `?autofly` flies 22 blocks higher to match.

Block data for the radius 8 area (headless, the bench's 253 columns):

| | chunks (all air) | unshared | shared |
| --- | --- | --- | --- |
| 128 blocks | 1012 (506) | 31.6 MB | 15.8 MB |
| 256 blocks | 2024 (1286) | 63.3 MB | 23.1 MB |

So the taller world takes less memory than the old one did. In the pane after a flight:
chunks 30.7 MB for 2616 loaded (was 40.9 MB for 1308).

Bench (radius 8): generate 313 ms for the twice-as-tall columns (204–254 before); 574
chunks meshed instead of 394 (the terrain moved up across a chunk layer, and solid stone
chunks underground are meshed though they have no faces; caves in step 4 hollow them, so
no special case for now); greedy meshing 360 ms total, same 207k triangles. `?autofly`
radius 8: first view 0.91 s, main thread p50 1.6 / p99 4.4 / max 5.8 ms, nothing over 20 ms,
no holes, no console errors.

The loader's turning test was redone: with twice the chunks per column, the first job
after turning was still one under the player (those come first whatever the direction).
It now checks that the first column generated after a turn is on the new side, turning
from -x to +x so that the order columns happen to be listed in can't pass it: it fails
with `behindWeight` 0 and passes with 1.

**Step 2 (textures).** `world/textures.ts` paints 11 layers of 16 × 16 pixel art with seeded
noise, speckles, stripes and rings (stone, dirt, grass top and side, sand, water, bark and
rings, leaves with about a third of the pixels as holes, planks, glass with a frame), as
plain typed arrays; `BLOCKS` names a texture for each block's top, sides and bottom.
`render/blockMaterial.ts` uploads them as one `DataArrayTexture` (nearest up close,
mipmapped) and draws chunks with a small `ShaderMaterial`: texture × the mesher's grey
shade (directional × AO, taken towards linear so it darkens as much as it did the flat
colours), alpha test, Three.js fog. Each vertex gains 4 bytes: u and v in blocks within the
chunk (the shader repeats the texture every block across a merged quad, sampling with
`textureGrad` on the unwrapped UVs so the mip level doesn't jump at block seams) and the
layer. On walls v runs up the y axis, so textures stand upright. The hotbar shows the side
textures.

Leaves are a new kind of block, `cutout`: alpha-tested in the opaque pass, and their faces
against other leaves are drawn (the reference mesher too), so a canopy seen through its
holes shows leaves, not the sky. Glass and water still hide faces against themselves.

| radius 8 | step 1 | step 2 |
| --- | --- | --- |
| bench: greedy meshing | 360 ms | 369 ms |
| triangles | 207k | 207k |
| vertex data | 7.5 MB | 9.1 MB (+21 %, the texture coordinates) |
| `?autofly` main thread p50 / p99 / max, dev | 1.6 / 4.4 / 5.8 ms | 1.8 / 4.2 / 6.2 ms |
| `?autofly`, production build | | 1.9 / 4.5 / 6.4 ms |
| meshes in memory after a flight | 9.6 MB | 11.6 MB |

No frame over 20 ms, no holes, no console errors. Looked at in the pane: textures on grass,
sides, sand and water, no seam lines in the distance, AO still visible; placed leaves show
holes with leaves behind them, glass shows its frame and highlights.

Differs from the plan: the texture names and painters live in `world/textures.ts`, not
`render/` (blocks name their textures, and world code doesn't import from rendering);
the mask key didn't need the layer (a block's texture follows from the block and the face
direction, which the mesher already keys on); and leaves draw faces against each other
(the plan said "stay hidden"), which looked hollow through the holes.

Tests (6 more): textures are deterministic, distinct and cover every block face; opaque
blocks have no transparent pixels, leaves 20–50 %, glass mostly clear, water translucent;
a merged quad's UVs span its size in blocks with v up the wall; grass uses grass top, grass
side and dirt; leaves draw their shared faces and glass doesn't.

**Step 3 (biomes).** `world/biomes.ts`: temperature and humidity from two noises (about one
swing per 1400 blocks); each biome sits at a point in that climate and weighs in by a
Gaussian of the distance to it (width 0.09), so weights change over roughly a hundred blocks.
The height is a continent noise (seas and land masses, ±32) plus each biome's base and shape
blended by weight: rolling hills (plains, forest), rounded dune crests (desert), ridged noise
squared plus detail (mountains, up to ~160 above the sea). The biome whose blocks cover a
column is the strongest, with a seeded coin between the two strongest near a border so the
line frays. `generate.ts` computes heights one column beyond the job's 32 × 32 for slopes,
and `columnLayers` turns height, biome, slope and a noisy snow line (sea + 58 ± 8) into runs:
grass on dirt; sand on sandstone (desert); snow on stone above the snow line, snowy grass
below it (mountains); bare stone where a neighbour is 3 or more blocks up or down; sand on
beaches and shallow sea floors, gravel on deep ones. New blocks: snow, snowy grass,
sandstone, gravel, with textures. `?at=x,z` spawns near any column.

Measured over 4000 × 4000 blocks (seed 20261022), after moving the biome points from a first
try that gave 32 % mountains and 9 % desert and almost no sea: plains 36 %, forest 25 %,
mountains 26 %, desert 13 %; 30 % of the land under the sea; ground from 19 below to 158
above sea level; the steepest step between neighbouring columns 4.3 blocks. Nearest
interiors to the origin: plains `?at=36,53`, forest `?at=-121,-226`, desert `?at=384,0`,
mountains `?at=0,192` (182 high). Screenshots in the pane: a snowy ridged range with stone
faces, rounded dunes by the sea, grass hills with lakes; no console errors.

| radius 8 | step 2 | step 3 |
| --- | --- | --- |
| bench: generate (253 columns) | 277 ms | 721 ms (2.85 ms a column) |
| chunks meshed, triangles, vertex data | 574, 207k, 9.1 MB | 718, 520k, 22.8 MB |
| bench: greedy meshing | 369 ms | 655 ms |
| `?autofly` main thread p50 / p99 / max (dev; build the same) | 1.8 / 4.2 / 6.2 ms | 2.3 / 6.8 / 8.1 ms |
| `?autofly` first view (in front / all), most pending | 0.75 / 0.94 s, 0 | 1.17 / 1.82 s, 43 |
| meshes in memory after the flight | 11.6 MB | 32.0 MB |

The bench's area now holds mountains (one rises 192 blocks from the origin), whose rugged
slopes have far more faces than the old rolling land, so everything downstream of the
terrain grew. Still no frame over 20 ms and no holes (the pane is back at 60 Hz). Generation
runs in the workers; its cost is mostly noise: every biome's shape is evaluated wherever its
weight is above 1e-4, which with this blend is nearly everywhere. Worth trimming in step 4,
when caves add their own noise; the main thread's p99 (applying more and bigger meshes) is
the number to watch on the laptop.

**Step 4 (generation cost, caves, ores).**

*Generation cost first.* Profiling a column job (headless): the noise everyone suspected
was only 0.37 ms of 1.53; the rest was filling chunks, whose inner loop read imported
constants (`CHUNK_SIZE`, `CHUNK_BITS`: a property lookup per block under Vitest, the trap
from Milestone 1) and walked per-column run arrays through the iterator protocol. Local
constants plus `writeLayers` (runs straight into one typed array, nothing allocated per
column; `columnLayers` stays as the array form for tests) took the bench from 721 to 296 ms
at radius 8. Flooring biome weights so far-off biomes skip their noise measured no gain
(most columns blend two or more biomes) and changed the terrain, so it was reverted.

*Caves* (`world/caves.ts`): tunnels where two 3D noises (stretched sideways: 48 blocks across,
28 up) are both within 0.07 of zero, caverns where a third is above 0.55 below y 40; the bottom
4 layers never carved. Sampled every 4 blocks per chunk (9³ samples a field), interpolated
across x and z per column then along y per block. `carvedAt(x, y, z, limit)` answers for one
block with the same samples and float32 rounding, so it always agrees with the chunk carve
(tested block by block): trees will use it for their ground. `caveLimit` keeps caves out of
the 4 blocks below any water in a column or its 4 neighbours, and lets them open onto dry
land elsewhere. Measured: 5.4 % of the underground (from y 4 to 8 below the surface) is open.

*Ores* (`world/features.ts`): veins that start at seeded places in each chunk and wander up to
3 blocks, replacing only stone; each chunk replays its own and its 26 neighbours' veins and
keeps what lands inside, so a vein across a border is whole whichever chunk loads first.
Coal (y 5–200), iron (5–100), copper (5–70, bigger blobs), crystal (5–24, rare). Per 5 × 5 columns:
coal 3981, iron 1492, copper 1297, crystal 20 blocks. Textured as stone with mineral clusters.

| radius 8 | step 3 | step 4 |
| --- | --- | --- |
| bench: generate | 721 ms | 296 ms after the trim; 678 ms with caves and ores |
| bench: triangles, vertex data | 520k, 22.8 MB | 1857k, 81.5 MB |
| bench: greedy meshing | 655 ms | 979 ms |
| `?autofly` (build) main thread p50 / p99 / max | 2.3 / 6.9 / 8.1 ms | 2.9 / 7.8 / 9.0 ms |
| `?autofly` triangles drawn / in the scene, draw calls | 83k / 730k, 114 | 412k / 2744k, 204 |
| meshes in memory after the flight | 32 MB | 120 MB |

**Caves are expensive to draw.** Triangles by feature (headless, 9 × 9 columns): surface 178k,
ores 178k (they hardly break merging), caves 639k, 45 % of it in chunks wholly underground.
Cave walls are a lot of surface, and every one is meshed and drawn when it's in the view
frustum, though from the surface almost none can be seen. Frames held on the dev machine
(nothing over 20 ms, no holes), but five times the drawn triangles and 120 MB of meshes is
not something to send to a laptop. The fix that keeps the caves is visibility culling:
record per chunk which of its faces connect through open space (computed with the mesh),
and each time the player changes chunk, walk outwards from the player's chunk through
connected faces; chunks the walk never reaches aren't drawn (and needn't be meshed yet).
Not in the plan; proposed as the next step.

Screenshot in the pane: spawning at a cave mouth (`?at=-48,71`) drops you 10 blocks into a
narrow cut through the stone with grass and sky above; caves are lit like the surface until
Milestone 4. The greedy-merging regression guard now measures surface-only terrain (with
caves and ores, greedy quads are 0.61 of culled faces).

Tests (7 more): caves only turn solid blocks into air, exactly where `carvedAt` says, never in
the bottom layers; 2–15 % of the underground open; no air beside or under any water (fails
when the cave limit is removed); entrances on dry land; ores only replace stone, each in its
depth range, all four found, coal > iron > crystal; a vein across a chunk border with each
chunk placing its own part, independently; the same chunks whichever order columns load in.
`Generator` and `World` take options to switch caves and ores off, for the surface tests.

**Step 4b (visibility culling, added 2026-10-23).** `world/visibility.ts`: per chunk, a flood
fill through see-through blocks finds which of its 6 faces see each other (15 pairs, a bit
each), worked out in the worker that generates the chunk (sent back with it) and again
after an edit. The loader walks from the player's chunk through connected faces, never in
the direction opposite one already taken; only chunks the walk reaches are meshed, and
meshes of chunks it no longer reaches are hidden. It walks again at once after moving to
another chunk or an edit, at most every 100 ms while new chunks arrive, and at once when
they stop (otherwise a walk made before some neighbours were known can mesh chunks that
turn out unseen; a test caught it). `?stats` shows how many chunks could be seen.

Measured, and the gain is modest:

| radius 8 | no culling | culling |
| --- | --- | --- |
| bench: chunks / triangles seen from the spawn point | 718 / 1857k | 554 / 1478k (-20 %) |
| same, with caves never opening onto land (experiment) | | 462 / 1237k (-33 %) |
| same, with narrower tunnels (0.05, experiment) | 718 / 1566k | 503 / 1149k |
| `?autofly` after the flight: chunks meshed, triangles drawn | 1062, 412k | 968, 349k |
| meshes in memory after the flight | 120 MB | 112 MB |
| `?autofly` main thread p50 / p99 / max | 2.9 / 7.8 / 9.0 ms | 2.5–2.7 / 6.6–7.5 / 8.0–10.1 ms |
| at the spawn point: triangles in the scene, meshes | ~2.5M, ~120 MB | 1525k, 67 MB |

Why so little: a chunk is coarse. A surface chunk holds both open sky and tunnels, and both
touch its side faces (at different heights); connectivity is per face pair, not per region,
so the walk comes in through a side via the sky and leaves downwards via a tunnel. Cave
entrances add to it but aren't the main leak (keeping caves off the surface only gets to
-33 %). From the autofly's height over mountains, nearly everything is genuinely reachable
through the air. Finer sections (16 or 8 blocks tall) would tighten it; fewer or narrower
caves cut triangles roughly in proportion to the cave wall. In absolute terms ~350k
triangles drawn a frame and ~110 MB of meshes may well be fine for a laptop GPU: the laptop
measurement should decide before more work goes into this.

Also fixed on the way: autofly's "first view" counted unloaded chunks as not missing once
culling existed, and started the flight at 0.09 s; chunks not loaded yet now count as holes.

Tests (9 more): connectivity of open air, solid stone, a straight tunnel, a bend, two
separate tunnels, a sealed pocket, see-through blocks; the walk through open space, over a
solid surface (the top layer seen, nothing under it), down a shaft, and refusing a U-turn
back under the start (fails with that rule off); the loader meshing a deep chunk once the
player is down there and hiding it from above. The loader tests now check only chunks that
could be seen are drawn.

**Step 5 (trees).** `world/features.ts`: one possible tree per 5 × 5-block cell of the
world, decided from the seed and the cell alone (a chance by biome: plains 0.1, forest 0.7,
desert 0.08, mountains 0.3; a spot in the cell; a height), kept only if it stands on its
biome's ground (grass; desert sand; snowy grass or snow) on dry land, not on a steep slope
and not on ground a cave has taken (`carvedAt`). Oaks (trunk 4–6, two wide layers, a narrow
one and a cross, corners by a seeded coin), spruces (trunk 6–9, a cone of alternating
layers, the lowest two trunk blocks bare), cacti (2–4). New blocks: spruce wood and leaves
(cutout), cactus, with textures. A column job now computes its height map, biomes, top
blocks and cave limits 3 blocks beyond its edges, asks for every tree within 2 blocks of
it, and writes the parts that land in each of its chunks, in world order: trunks may
replace leaves, leaves only fill air, so overlapping canopies come out the same whatever
the load order. Chunks above the ground that a canopy reaches are no longer all air.
`Generator.ground()` answers the same questions column by column for tests and tools;
`findLand` won't put the spawn point in a tree.

Spruces were first allowed only on snowy grass: 9 in a 256 × 256 stretch of mountains
(most of it is steep stone or above the snow line). On snow as well: 443.

*Found on the way: light lines down the leaves, and pale distant canopies.* Diagnosed in the
pane step by step: not cracks (a magenta background didn't show through), not fog, not the
texture's layer (leaf fragments, coloured by layer), not the holes' colour or sRGB mipmaps;
gone without mipmaps, and gone when the opaque pass wrote alpha 1. Three.js (r186) always
gives the canvas an alpha channel (its `alpha` option only sets how the background clears),
and the browser shows the page's light-blue CSS background wherever a pixel's alpha is
below 1. Leaf faces seen edge-on, and distant leaves, sample coarse mipmaps whose alpha is
the holes averaged in (about 0.68): those pixels let the page through. The opaque pass now
writes alpha 1 (the alpha test has already cut the holes), and water and glass blend their
colour but leave the canvas's alpha alone; water looks a little deeper blue for it.

| radius 8 | visibility culling | step 5 |
| --- | --- | --- |
| bench: generate | 678 ms | 816 ms |
| bench: greedy triangles, vertex data | 1857k, 81.5 MB | 2118k, 92.9 MB |
| bench: seen from spawn | 554 chunks, 1478k triangles | 560 chunks, 1721k triangles |
| `?autofly` (build) main thread p50 / p99 / max | 2.5–2.7 / 6.6–7.5 / 8.0–10.1 ms | 2.4 / 6.3 / 6.8 ms |
| `?autofly` triangles drawn, draw calls | 349k, 176 | 406k, 177 |
| meshes in memory after the flight | 112 MB | 133 MB |

No frame over 20 ms, no holes, no console errors. Screenshots: a dense oak forest
(`?at=-121,-226`), cacti over the dunes (`?at=384,0`), snowy peaks with spruces (`?at=0,192`),
oaks on grassland by the sea.

Tests (8 more): every chosen tree stands whole in the world (wood trunk, dirt or sand under
it, leaves round its top, across chunk borders), and every trunk in the world is a chosen
tree (the column jobs and `ground()` agree); a chunk holding only a canopy is the same
generated alone; oaks only on plains and forest, cacti only in desert, spruces only in the
mountains, all on dry, uncarved ground; forests over 3× denser than plains; canopies make
the chunks above the ground non-empty; the spawn point avoids trunks. Cave and ore
comparisons switch trees off on both sides (a tree skipped over a cave would otherwise
count as a difference).

Differs from the plan: trees are per 5 × 5 cell rather than per column (spacing for free);
spruces grow on snow too; the column job's border is 3 blocks, not the 38 × 38 (3 each
side) planned — the same thing.

Differs from the plan: the biome weights are Gaussians of the distance in climate space
rather than smoothsteps of thresholds, which gave smoother borders and fewer tuning knobs;
the generation test now rebuilds each block from `columnLayers` instead of the old one-rule
reference. Tests (10 more): all four biomes over 5 %; same seed same biomes, another seed
different; no step over 6 blocks anywhere, across 50+ borders; mountains over 100 above the
sea, plains and desert interiors under 40; borders fray only where another biome has
weight; and the exact layers of every biome, steep slopes, beaches and sea floors.

Goal: a world worth exploring. Blocks get textures (generated at startup, no image files),
greedy meshes keep working with them, leaves get holes. Four biomes (plains, forest,
desert, snowy mountains) from temperature and humidity noise, blended so there are no
cliffs at their borders. Caves, ores, and trees that cross chunk borders without
depending on load order. The world doubles in height for the mountains. Milestone 1's
budget still holds: measured with the bench and `?autofly` before and after each step.

## Scope decisions

- **Texture array, not an atlas.** Each block face texture is one layer of a WebGL2
  `DataArrayTexture` (16 × 16 pixels per layer). A merged quad's UVs run in block units
  (0..w, 0..h) and the shader repeats the tile with `fract`, so greedy meshing needs no
  change beyond carrying the layer. No bleeding between tiles and mipmaps per layer, which
  an atlas would need padding and shader tricks for. Sampled with `textureGrad` on the
  unwrapped UVs, so mipmap selection doesn't break at every block seam (the classic 1-pixel
  lines in the distance).
- **Pixel-art textures made by code**, seeded, at startup: 16 × 16, nearest-neighbour up
  close, mipmapped in the distance. Generated as typed arrays in a pure function (tested),
  uploaded once. Invented looks; nothing copied.
- **Vertex colours stay** (directional shade × AO), now multiplied with the texture
  instead of being the block colour. Block colours in `BLOCKS` remain only for the hotbar,
  which shows the textures instead.
- **No per-biome tint.** Grass colour varying smoothly by biome would break merging
  (every column a different tint). Biomes change blocks instead (grass, snowy grass, sand,
  snow); tints can come later as a per-chunk uniform if wanted.
- **Leaves alpha-tested** in the opaque pass (`discard` below alpha 0.5), drawn from both
  sides; faces between two leaf blocks stay hidden ("fast leaves"). Glass and water keep
  the transparent pass, now textured.
- **Taller world: 256 blocks** (8 chunks a column), sea level 62, mountains up to ~210.
  Most of the extra height is air, which brings up Milestone 1's open point: all-air
  chunks still take 32 KB each. They will share one empty array and copy it on the
  first edit, before the height doubles.
- **Biomes** from two low-frequency noises (temperature, humidity, ~1 cycle per 1500
  blocks). Each biome has height parameters (base, amplitude, roughness); a column's height
  blends them by smooth weights, so mountains rise out of the plains instead of starting
  at a wall. The surface blocks come from the strongest biome, with a seeded dither in the
  blend zone so borders aren't straight lines.
  - plains: grass on dirt, gentle hills, few trees;
  - forest: grass, rolling, many trees;
  - desert: sand on sandstone, dunes, cacti, no water plants;
  - snowy mountains: stone with snow above a snow line, snowy grass lower down, spruces.
- **Caves** from two 3D noises: tunnels where both are near zero (long winding
  "spaghetti"), and occasional caverns where a third is high, deep down. Sampled every 4
  blocks and interpolated (55 ns a sample: per block it would be ~15 ms a column, sampled
  it's ~0.2 ms). They never cut within 3 blocks of the sea floor or a lake bed, so water
  never hangs over air (water doesn't flow yet); they can open on dry land.
- **Ores** replace stone only: coal (common, any depth), iron (below 100), copper (below
  70, in blobs), crystal (rare, below 24). Placed by a seeded hash per block with clustering
  from a small 3D noise; deterministic like everything else.
- **Trees across chunk borders** (the technique in CLAUDE.md): a tree's place is decided per
  column from `hash3(seed, x, 0, z)` and the biome's density, and only on grass (or sand
  for cacti) that's above water and not cut by a cave. Each chunk asks every column within
  3 blocks of it whether it has a tree and writes the parts that fall inside. The column
  job computes the heightmap for a 38 × 38 area (its 32 × 32 plus 3 each side) to know where
  neighbouring trees stand. Oak (plains, forest), spruce (mountains), cactus (desert).
- **New blocks:** snow, snowy grass, sandstone, gravel, spruce wood and leaves, cactus,
  coal / iron / copper / crystal ore. The hotbar gets a few of them; the full block picker
  is Milestone 5.
- **Out of scope:** flowing water, lighting (Milestone 4: caves will be as bright as the
  surface until then), animated water, structures other than trees.

## Files

| File | Contents |
| --- | --- |
| `src/world/coords.ts` | `MAX_CHUNK_Y` 7 (256 blocks) |
| `src/world/world.ts` | `EMPTY_BLOCKS` shared by all-air chunks; `setBlock` copies on first write |
| `src/world/blocks.ts` | New blocks; `textures: { top, side, bottom }` (texture names) per block |
| `src/world/biomes.ts` | Temperature / humidity, biome weights, blended height parameters, surface blocks |
| `src/world/caves.ts` | Coarse 3D noise grid per chunk, trilinear lookup, carving rules |
| `src/world/features.ts` | Ores; tree placement per column and tree shapes (oak, spruce, cactus) |
| `src/world/generate.ts` | Column generation in passes: heightmap (38 × 38) → terrain by biome → caves → ores → trees |
| `src/render/textures.ts` | Procedural textures: `makeTextures()` → named layers of 16 × 16 RGBA (pure); upload to a `DataArrayTexture` |
| `src/render/blockMaterial.ts` | `ShaderMaterial` sampling the array: vertex colour × texture, alpha test for leaves, Three.js fog |
| `src/mesh/builder.ts`, `mesher.ts` | Vertex gains `uvl` (Uint8 × 4: u, v in block units, layer); the mask key gains the layer |
| `src/render/chunkRenderer.ts` | The new materials; opaque pass double-sided only where needed (leaves) |
| `src/main.ts` | Hotbar shows the block textures |

## Key data structures

```ts
// One vertex: position (Float32 × 3), colour (RGBA8: shade × AO), uvl (Uint8 × 4):
// u, v = the corner's position on the face in block units within the chunk (0..32),
// layer = texture array layer for this block and face. 20 bytes a vertex (was 16).

interface BlockInfo {
  // … as now, plus:
  textures: { top: string; side: string; bottom: string };   // names from textures.ts
}

interface Biome {
  name: 'plains' | 'forest' | 'desert' | 'snowy mountains';
  height: { base: number; amplitude: number; roughness: number };  // blended between biomes
  surface: Block; under: Block;            // grass / dirt, sand / sandstone, …
  trees: { kind: 'oak' | 'spruce' | 'cactus'; perColumn: number }; // chance per column
}
```

## Tests

- **Textures:** deterministic; every block face names an existing layer; layers differ;
  opaque blocks are fully opaque, leaves have 20–50 % transparent pixels.
- **Mesher:** the existing exactness tests (same faces as culled, AO against the world,
  winding) still pass; UVs span exactly the quad's size in blocks; each quad's layer is its
  block's texture for that face; grass top and grass side don't merge into each other.
- **Empty chunks:** all-air chunks share one array; the first edit gives that chunk its own
  and leaves the others empty.
- **Biomes:** over a 4000 × 4000 area all four biomes occur, each over at least 5 %;
  neighbouring columns never differ in height by more than the steepest biome allows
  (no seams at borders); same seed, same biomes.
- **Caves:** deterministic; a few percent of the underground is open; no air directly below
  water or within 3 blocks under a sea floor; some caves reach the surface on dry land.
- **Ores:** only where stone would be; each ore only within its depth range; frequencies
  within a range.
- **Trees:** a tree straddling a chunk border is complete across the two chunks, and the
  same whichever chunk is generated first or alone; trees stand on their ground block (none
  floating, none in water); cactus only in desert, spruce only in mountains.
- **Taller world:** the loader, padding and physics tests still pass with 8 chunks a column.

## How it's measured

- `npm run bench` before and after each step: generation per column (now with biomes,
  caves, ores, trees, twice the height), meshing (UVs add 4 bytes a vertex), triangles
  (texture layers could reduce merging slightly), vertex data.
- `?autofly` at radius 8: main thread, frames over 20 ms, first view, memory (chunks and
  meshes, which the taller world and the shared empty chunks pull in opposite directions).
- Screenshots of each biome and a cave for you; textures and biomes are visual, so their
  final judgement is a playtest.

## Order of work (one commit each, playable after each)

1. Shared empty chunks, then the taller world and sea level 62. Measure memory.
2. Texture array, procedural textures, the block shader, textured greedy meshes, alpha-tested
   leaves, hotbar icons. Measure meshing and vertex data.
3. Biomes: blended heights, surface blocks, snowy mountains. Measure generation.
4. Caves and ores. Measure generation.
5. Trees across chunk borders. Measure generation.
6. Notes, measurements, screenshots, deploy, playtest questions.

## Questions for you

1. Taller world (256 blocks, sea level 62), or keep 128?
2. 16 × 16 pixel-art textures with hard pixels up close (proposed), or smoother, softer ones?
3. No per-biome grass tint for now (biomes change blocks instead): fine?
4. Ore set: coal, iron, copper, crystal (an invented rare one). Any you'd rather have?
