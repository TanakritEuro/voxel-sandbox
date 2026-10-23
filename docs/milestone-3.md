# Milestone 3 plan: richer world

## Status: planned, waiting for your OK

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
