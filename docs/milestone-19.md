# Milestone 19: underground

**Status:** plan approved (2026-11-21); step 1 built.

## Goal

Make going deep worth it, and give the delver somewhere to live:
1. **Lava:** a second liquid, glowing and dangerous, meeting water as stone.
2. **Deep cave biomes** below y 40: crystal caverns, mushroom grottoes, and lava lakes near the bottom.
3. **Dungeons:** buried brick rooms with better loot and delvers about.
4. **A lantern** to light the way, standing or hanging.

This is the underground part Milestone 16 left for later. It comes with **generation version 3**, for new
worlds only: older worlds keep their land, pinned by checksums as in Milestone 16. Generation, lava and loot
are tested headless; how lava and the caves feel is left for playtests.

## Design

### Lava (`world/water.ts` made general, `world/liquids.ts` new)

- **One automaton, two liquids.** `WaterFlow` becomes `LiquidFlow`, built from a `Liquid` description:
  - its blocks: a source, falling, and flowing levels;
  - how far it spreads (water 7, lava 3) and how far it looks for a drop (water 4, lava 2);
  - how often it's ticked (water every 0.25 s, lava every 0.5 s).
  - Its table of what each block is to it (solid, open, source, falling, flowing) comes from the description,
    so to lava, water is solid, and the other way round.
  - Water's behaviour is unchanged (its tests stay as they are).
- **Lava blocks (204–208):** a source, three flowing levels (deep, middling, thin) and falling lava.
  - Light 15.
  - Swum in slowly (half water's speed), like water otherwise.
  - Drawn as a liquid at its depth, in the opaque pass (it doesn't let you see through it), with its own
    slowly moving texture.
- **Lava and water meet:** a lava block with water beside or above it becomes **basalt** if it was a source
  (a new dark block, 209), **stone** if it was flowing. The lava automaton checks for water each time it looks
  at a block; an edit or either liquid's change wakes both.
- **Burning (`survival/health.ts`):**
  - in lava, 4 points every half second;
  - out of it, burning for 3 s more at 1 point every half second, unless you're in water;
  - a new cause, "You burned.";
  - a red-orange tint over the screen while burning.
- **Items on the ground** in lava burn up in a puff. **Mobs** never path into lava; one pushed in takes a hit
  every half second.
- **No buckets:** lava comes only from generation, and neither liquid can be carried.

### Deep caves (`world/caves.ts`, `world/deep.ts` new, generation version 3)

- **A deep biome per place below y 40,** from a 3D noise sampled as the cave noises are, on carved space only:
  - **Crystal caverns:** crystal clusters (210, crossed sheets, light 10) on floors and ceilings; crystal ore
    twice as common in the walls.
  - **Mushroom grottoes:** a soft grotto floor (211) and giant mushrooms 4–7 tall: a stem (212) and a wide
    cap (213, light 8) underneath which you can walk.
  - **Elsewhere:** caves as now.
- **Lava lakes:** carved space at y 10 and below fills with still lava (sources), as the sea fills
  low land. Above it, the caves are as they were.
- **Features cross chunk borders** as trees do: mushrooms from a seeded hash per 5 × 5 cell, each chunk writing
  its own part.

### Dungeons (`world/structures.ts`)

- **A new structure kind** underground: one chance per 96 × 96-block cell, a room 9 × 5 × 9 at y 12–35.
  - Mossy brick walls, floor and ceiling; carved out wherever caves meet it.
  - A chest of better loot (`survival/loot.ts`: iron, crystal, an iron pick now and then, lanterns).
  - Placed from the seed and cell alone, written after everything else, like ruins and camps.
- **Delvers** appear twice as often within 32 blocks of a dungeon (`MobManager`, with the generator's dungeon
  positions).

### The lantern (214–215)

- A small glass and iron box, light 15, standing on a block or hanging under one (two ids; held up as torches
  are, `torchSupport` looking up for the hanging one).
- Crafted from an iron and a torch.

### Finding things (`world/find.ts`)

- **`?find=crystal|grotto|lava|dungeon`:** the nearest of each, searched with the generator alone, the player
  put where they can stand in it (underground, not on the surface above it).

### Playing together

- The host ticks lava as it ticks water; its changes go to guests as edits, as water's do.
- Generation version 3 goes in the welcome as versions do; **`PROTOCOL` 12**.

## Files

| File | Change |
| --- | --- |
| `src/world/blocks.ts` | lava (source, 3 levels, falling), basalt, crystal cluster, grotto floor, mushroom stem and cap, lanterns (204–215) |
| `src/world/water.ts` → `liquids.ts` | `LiquidFlow` from a `Liquid` description; `WATER` and `LAVA`; lava meeting water |
| `src/world/caves.ts`, `deep.ts` (new) | deep biome noise, crystal clusters, grottoes and mushrooms, lava lakes |
| `src/world/generate.ts` | generation version 3 (`GENERATION` 3); deep caves and dungeons only from it |
| `src/world/structures.ts`, `survival/loot.ts` | dungeons, their loot |
| `src/world/find.ts` | the four new `?find` kinds, underground places to stand |
| `src/world/textures.ts`, `mesh/mesher.ts` | the new textures; lava drawn as a liquid in the opaque pass; clusters as crossed sheets |
| `src/world/physics.ts` | swimming in lava (slower) |
| `src/survival/health.ts`, `ground.ts` | burning; items burning up |
| `src/mobs/pathfind.ts`, `mobs.ts` | paths never into lava; delvers near dungeons |
| `src/survival/crafting.ts` | the lantern |
| `src/game.ts` | the lava automaton ticked, burning's tint, `?find` kinds |
| `src/net/protocol.ts` | `PROTOCOL` 12 |
| `bench/bench.ts` | generation by version (3 against 2); lava filling a cave |

## Tests

- **Generation:**
  - versions 1 and 2 unchanged (the checksums);
  - version 3: no deep biomes, lava or dungeons above y 40; lava lakes only at y 10 and below, in carved space;
  - crystal caverns and grottoes found with `?find` where the generator says;
  - mushrooms whole across chunk borders, whatever order chunks are made in.
- **Lava:**
  - spreads 3, slower than water;
  - water's behaviour unchanged (the existing water tests);
  - a source next to water becomes basalt, flowing lava stone;
  - light 15 from a lava block.
- **Burning:** damage in lava and after, put out by water, the cause.
- **Items** in lava burn up; **paths** never go into lava.
- **Dungeons:** placed as described, their chest's loot once, delvers more often near.
- **The lantern:** standing and hanging, held up, dropped when its block goes, light 15, the recipe.
- **Network:** lava's changes reach a guest; version 3 in the welcome.

## How to measure

- **Bench:**
  - generation by version (3 against 2, against 1);
  - lava filling a cave (ticks and changes, as the water bench does);
  - a column's deep features.
- **Browser:**
  - a sprint flight over version 3 land (it should match version 2's);
  - each `?find` kind looked at;
  - frame times standing by a lava lake (light and many lava blocks in view);
  - lava meeting water, by hand.

## Steps

1. **Version 3 and the deep caves:** blocks and textures, deep biomes, crystal clusters, grottoes and
   mushrooms; checksums for versions 1 and 2; tests. Done (2026-11-21).
2. **Lava:** `LiquidFlow`, lava's blocks, meshing, lakes in generation, lava meeting water, swimming in it,
   burning, items and mobs; tests.
3. **Dungeons:** the structure, loot, delvers near them; tests.
4. **The lantern and `?find`;** together (`PROTOCOL` 12); tests.
5. **Measurements,** notes, playtest questions.

## Decisions to agree

1. **New worlds only** (generation version 3). Old worlds have no deep biomes, lava or dungeons.
2. **No buckets:** lava comes only from generation; neither liquid can be picked up and carried.
3. **Lava:** spreads 3 blocks, ticked half as often as water, light 15, 4 points every half second in it and
   burning for 3 s after; basalt from a source meeting water.
4. **Three kinds of deep place,** all below y 40: crystal caverns, mushroom grottoes, lava lakes at y 10 and
   below.
5. **Dungeons** about one per 96 × 96 blocks, deep, with delvers twice as likely near them.
6. **The lantern** from an iron and a torch, standing or hanging.

## Step 1: version 3 and the deep caves (2026-11-21)

**What's in:**
- **Generation version 3** (`GENERATION` 3, `generationOf` takes 3; `PROTOCOL` 12, since a guest of an older
  build would read version 3 as 1). **Version 2 pinned:** checksums of the same 12 columns as version 1's,
  taken before anything changed (`generationV2.test.ts`).
- **Blocks 204–207:**
  - crystal cluster: crossed sheets, light 12, held up by the block under it, gives a crystal, a pick's;
  - grotto floor: a soft violet floor with pale spores, a spade's;
  - mushroom stem: pale, an axe's;
  - mushroom cap: teal with pale spots, gills underneath, light 12, an axe's.
- **`world/deep.ts`:**
  - a deep biome per 8 x 8 x 8 cell below y 40, from a 3D noise: crystal caverns, mushroom grottoes, or
    neither;
  - **wider caverns there:** in a deep cell the cavern noise opens at 0.35 rather than 0.55 (`Caves` takes
    the cells; `carvedAt` agrees, so everything that asks whether a block is cave still gets the truth);
  - **`decorate`** after caves and ores: in crystal caverns, a cluster on 1 in 8 stone floor blocks and crystal
    ore on 1 in 29 stone blocks beside the air; in grottoes, the floor under the air is grotto floor;
  - **giant mushrooms:** per 6 x 6 column cell, nine in ten get up to three tries at a column standing on a
    grotto floor with room for a stem of 3–7 and its cap (radius 2, or 3 for a stem of 6 or more, a rim a block
    lower), all below y 40; written into every chunk they reach, as trees are.
- **`Caves.carvedColumn`:** a column's run of cave at once, each noise level worked out once rather than per
  block, the same as `carvedAt` block for block (tested): the mushroom search reads columns through it.
- **`?find=crystal` and `?find=grotto`:** the nearest cave floor in that biome with room round it (cave 3 blocks
  out each way at head height), the player stood there underground.
- **Tests (6 new, 2 updated, 1 new file of checksums):**
  - version 3 opens wider caverns and grows clusters, ore, grotto floors and mushrooms, all below y 40, nothing
    else changed;
  - each in its own biome;
  - a mushroom's cap whole across a chunk border;
  - `carvedColumn` against `carvedAt`;
  - the blocks;
  - the two finds;
  - version 2's checksums; the version test takes 3.

**Measured** (bench `generation versions`): version 3 is 13% slower than version 2 a column (3.82 against 3.38 ms
that run; version 2 is 10% on version 1). The mushroom search was most of it at first (24%): biome looked up block
by block, then `carvedAt` block by block; now biome by cell, cave by `carvedColumn` over just the grotto cells'
range, 0.33 ms a column.

**In the browser** (`?seed=20261022`):
- `?find=grotto`: a giant mushroom, its pale stem rising into the cap, the gills underneath and the teal rim round
  it, on the spotted grotto floor;
- `?find=crystal`: clusters of pale cyan shards on the cavern floor, glowing, lighting the stone;
- a 30 s sprint flight over version 3 land: no missing chunks, 2 frames over 20 ms (max 25.2), main thread p50 3.7 ms;
- no console errors.
- **Found there:**
  - **crystal caverns and grottoes were just tunnels** passing through those biomes, narrow and nearly empty (39
    blocks of cave and one cluster in a 32-block cube). Deep cells now open into caverns.
  - **no mushrooms at all:** the search stopped at the first floor going down whether or not it had room. It looks on
    down now, fits the stem to the room, and tries three columns a cell.
  - **too dark to see:** light 8 from the caps had faded to 3 a few blocks off. Caps and clusters give 12 now.
  - **the finds stood you in a passing tunnel;** they want room round the spot now.

**Changed from the plan:**
- **Block ids:** the deep blocks took 204–207 (blocks are numbered in order); lava, basalt and the lanterns will
  follow from 208.
- **Light 12** for clusters and caps (the plan had 10 and 8).
- **Clusters only on floors:** one hanging from a ceiling would need a second id, held up from above.
- **Deep biomes widen their caverns,** which the plan didn't say: they'd be ordinary tunnels otherwise.
- **`PROTOCOL` 12 in this step,** not step 4: the welcome carries the version.

