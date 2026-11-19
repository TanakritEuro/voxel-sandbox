# Milestone 16: world, part two

**Status:** plan approved (2026-11-19); step 1 in progress.

## Goal

More of a world to find: rivers cutting through the land down to the sea, two new biomes, and small
invented structures with loot in chests. All of it generated, a pure function of the seed, the same
in any load order and on any thread, and tested headless like the rest of generation.

**Worlds made before this milestone keep their land.** Changing generation changes every chunk
that was never edited. In an old world that would put new terrain next to its saved chunks, with
cliffs and cut-off rivers at the seams. So generation gets a version: old worlds keep version 1,
exactly as today, and new worlds get version 2.

**Targets:**
- Version 1 generates exactly what it does today. A test checks this against checksums taken before
  any change.
- Generating a column (version 2) at most a quarter slower than today: about 2 ms a column in the
  bench now.
- In a 4096 × 4096 area: every biome present, rivers on roughly a tenth of the land, about one
  structure every 200 × 200 blocks. These numbers are to tune, measured in the bench.
- No frame over 20 ms while flying (the same budget as always).

## Design

### Generation versions

- `WorldRecord.generation` (missing: 1); `newWorldRecord` gives 2.
- `Generator` takes `generation` in its options. Version 1 is today's code paths. Rivers, the new
  biomes and structures are only for version 2.
- The worker's generate job and the guest's welcome carry the version. `PROTOCOL` goes to 6
  (generation changed).
- Unsaved worlds (`?seed`, `?at`, `?autofly`) use the newest version.

### Rivers (`world/rivers.ts`)

- **Where:** a low-frequency river noise. A river runs along the noise's zero line, so it winds and
  never ends in the middle of the land, about 6–10 blocks wide.
- **The valley:**
  - near the line, the ground height is pulled down to a river bed 2–4 below sea level, with banks
    blending back to the land over about 20 blocks;
  - the water is sea-level water, as the sea is, so it never needs to flow;
  - the beds are sand and gravel, the banks sand.
- **Mountains:** rivers fade out where the land is too high to cut down to the sea within the bank
  width, so mountains keep their peaks. Where a river does cut through high land, it makes a gorge.
- Caves keep their rule of not carving under water: their limit comes from the height map, which
  now has the valleys.

### New biomes (`world/biomes.ts`)

Two more climate points: `Savanna` (hot, fairly dry) and `Swamp` (warm, wet). Version 1 keeps the
four biomes.

| | ground | trees | other |
| --- | --- | --- | --- |
| Savanna | dry grass, flat and gently rolling | parasol trees (a tall bare trunk and a wide flat crown), sparse | tufts of reeds near water |
| Swamp | mud and grass, low, with shallow pools at sea level | swamp oaks with leaves hanging down | reeds in and beside the water |

- **New blocks** (175–181), each with procedural textures, sounds, drops and the creative picker:
  - `DryGrass`, `Mud`;
  - `Reeds` (two crossed sheets, as wheat, cutout);
  - `ParasolWood`, `ParasolLeaves`;
  - `StoneBricks`, `MossyBricks` (for ruins; stone bricks crafted from 4 stone).
- **Fog and mobs:**
  - each new biome gets a fog tint (`render/fog.ts`);
  - the existing animals get one more biome each (the hopper in the savanna, the mossback in the
    swamp), so the new land isn't empty.

### Structures (`world/structures.ts`)

Two invented kinds, small (at most 11 × 11 × 8):
- **Ruins:**
  - stone and mossy brick walls, broken by a seeded pattern, a floor, maybe a doorway;
  - a chest inside;
  - in plains, forest and mountains below the snow line.
- **Camps:**
  - a canvas-coloured tent of planks and slabs (no new blocks needed), a furnace as a cold hearth;
  - a chest beside it;
  - in savanna, desert and plains.

**Placement** works like trees, scaled up:
- one chance per 160 × 160-block cell, with a seeded spot and facing, and a kind chosen by the biome
  there;
- kept only on dry land whose height varies at most 2 across the footprint, worked out from the
  generator's height function directly, so every chunk decides the same.

**Building it:**
- the base is level at the height of the middle;
- below the floor is filled down to the ground with stone (or sandstone in the desert), and the
  volume above it is cleared;
- each column job asks for the structures within reach of its chunks and writes the parts inside
  them, after the trees (so a structure's clearing wins, the same in every chunk).

**Loot (`survival/loot.ts`):**
- a structure's chest is filled the first time it's opened, or broken, from a loot table seeded by
  its place: coal, iron, copper, the odd crystal, bread, seeds, a tool;
- `Generator.lootAt(x, y, z)` says whether a place is a structure's chest;
- once filled, the chest is kept in the world record even when emptied (`Chests` remembers it was
  looted), so it never refills;
- playing together, the host fills it, through the container messages there are already.

### Finding things

`?find=river|savanna|swamp|ruin|camp` spawns at the nearest one to the origin (searched with the
generator, headless-fast), for checking in the browser and for playtesting.

## Files

| File | Change |
| --- | --- |
| `src/world/generate.ts` | the generation version; rivers in the height map; the new biomes' layers; structures after trees |
| `src/world/biomes.ts` | Savanna and Swamp (version 2), their heights |
| `src/world/rivers.ts` (new) | the river noise and the valley it cuts |
| `src/world/structures.ts` (new) | where structures stand, and their blocks |
| `src/world/features.ts` | parasol trees and swamp oaks; reeds |
| `src/world/blocks.ts`, `textures.ts` | the 7 new blocks |
| `src/survival/loot.ts` (new), `chest.ts`, `drops.ts`, `crafting.ts` | loot tables, looted chests, drops and the brick recipe |
| `src/save/store.ts`, `worlds.ts` | `generation` in the world record |
| `src/workers/protocol.ts`, `jobs.ts`; `src/net/protocol.ts`, `session.ts` | the version in jobs and the welcome; PROTOCOL 6 |
| `src/render/fog.ts`, `src/mobs/kinds.ts`, `src/audio/sound.ts` | fog, animals and sounds for the new biomes and blocks |
| `src/game.ts` | `?find`, loot on opening or breaking a chest |
| `bench/bench.ts` | generation time by version; biome, river and structure shares over a large area |

## Tests

- **Version 1:** checksums of a fixed set of columns, taken before the milestone, still match.
- **Rivers:**
  - every river column's water is at sea level, with no air under water and no water over air;
  - rivers run into each other or the sea, never ending in a dry hole (checked by flooding from the
    sea over a 1024 × 1024 area);
  - mountains keep their peaks.
- **Biomes:**
  - both new biomes appear, each on a fair share of a large area;
  - their layers, trees and reeds;
  - version 1 has none of them.
- **Structures:**
  - the same blocks whichever chunk of a structure is generated first, or alone;
  - only on level dry land;
  - not under water, not in the air;
  - their chests where `lootAt` says.
- **Loot:**
  - the same contents for the same place and seed;
  - filled once, never refilled after emptying, saved and loaded;
  - filled by the host for a guest.
- **Saving and joining:** a version 1 world stays version 1 through save and load and for a guest; new
  worlds are version 2.

## Steps

1. **Generation versions.** The record, the generator option, jobs, the welcome, PROTOCOL 6, the
   checksum test. Nothing generates differently yet. Done (2026-11-19).
2. **Rivers.** The noise, the valleys, beds and banks, caves under them; tests and the bench (river
   share, generation time); `?find=river`. Done (2026-11-19).
3. **Savanna and swamp.** Climate, heights, layers, the new blocks and textures, parasol trees, swamp
   oaks, reeds, fog, animals; tests; `?find=savanna|swamp`. Done (2026-11-19).
4. **Structures and loot.** Ruins, camps, placement across chunk borders, loot chests, bricks; tests;
   `?find=ruin|camp`.
5. **Measurements,** notes, playtest questions.

## Decisions to agree

1. **Generation versions:** old worlds keep today's land, and only new worlds get the new
   generation. The alternative, all worlds regenerating, means seams at old edits.
2. **Rivers at sea level only.** No rivers flowing down mountains: water there would need the flowing
   water simulation running all the time, a much bigger job. They cut valleys instead, and fade out
   in high mountains.
3. **Two biomes, savanna and swamp,** with 7 new blocks. No new animals, only the existing ones in
   more places.
4. **Two structure kinds, ruins and camps,** small, with loot. Nothing large like villages or dungeons
   underground; those could be a later milestone.
5. **Loot filled on first opening,** not at generation (generation writes only blocks), and never
   refilled.

## Step 1: generation versions (2026-11-19)

**What's in:**
- **`world/generate.ts`:**
  - `Generation` (1 or 2), `GENERATION` (2, what new worlds get), and `generationOf`, which makes
    anything but 2 into 1;
  - `GeneratorOptions.generation`. A `Generator` (or `World`) is version 1 unless told otherwise, so
    every existing test, the bench, and anything else that makes one for itself keeps today's land.
    The game always says which version it wants.
- **`WorldRecord.generation`:** `newWorldRecord` gives the newest. Worlds saved before have none,
  which reads as 1.
- **The game** makes its `World` with its record's version. Unsaved worlds (`?seed`, `?at`,
  `?autofly`) get the newest, and a guest's record takes the version from the welcome.
- **The loader** puts the version in every generate job. The worker keeps a generator per seed and
  version.
- **The welcome** carries the version, and a welcome without a valid one is refused. `HostWorld.generation`
  comes from the host's generator. `PROTOCOL` is now 6.
- **Tests (4 new, a few updated):**
  - **version 1's checksums** (FNV-1a) over 12 columns of three seeds, taken from the generator at the
    end of Milestone 15, before anything changed;
  - new records are version 2, and records without a version read as 1, kept through the store;
  - the loader's jobs carry the world's version, and the worker makes what that version's generator
    makes;
  - a guest gets the host's version and makes its world with it;
  - welcomes with either version pass the message check.

Nothing generates differently yet: version 2 is version 1 until step 2.

## Step 2: rivers (2026-11-19)

**What's in:**
- **`world/rivers.ts`:**
  - the river noise: 3 octaves, about 900 blocks a swing;
  - `carve` brings a column's height down into a valley. Within the core (|noise| < 0.008, about
    5 blocks either side of the line) it goes to a bed 1–4 below sea level, deepest in the middle;
    out to the bank (0.035, about 21 blocks) it eases from sea level back up to the land. The land
    is never raised.
- **`Generator.height`** (version 2 only) carves after the biomes' heights. The strength is
  `riverStrength`: all of it until the mountains weigh more than 0.1, none from 0.5. A river
  narrows and ends before the peaks, and mountains keep their heights exactly.
- **Everything else follows from the height map:**
  - beds and banks are sand (gravel below 4 under);
  - the water is the sea's, up to sea level, so nothing flows;
  - caves keep 4 blocks under water, as they do by the sea;
  - no trees grow in a river.
- `SEA_LEVEL` moved to `coords.ts` (`generate.ts` re-exports it), so `rivers.ts` can use it
  without an import loop.
- **`?find=river`** (`world/find.ts`): the nearest column of river water where the land would be
  dry without it, searched every 8 blocks in square rings. The player then stands on the nearest dry
  land (`findLand`). It plays an unsaved world, as `?at` does.
- **Tests (6):**
  - `?find` finds river water where version 1 is dry, and finds none in version 1;
  - rivers only lower the land, never below their bed;
  - where mountains weigh half or more, heights are exactly version 1's;
  - in the blocks of 3 × 3 columns round a river: water only up to sea level, never over air, the
    surface water all along it;
  - every body of water rivers make or join, in a 768 × 768 area, has 60 columns or more, or runs
    out of the area: no puddles of their own;
  - version 1 has no rivers.

**Measured** (`npm run bench`, the `generation versions` section, new):
- **Generating a column:** version 1 2.18 ms, version 2 2.23 ms (+2 %), 253 columns, median of 5.
- **The river share of the land** in 4096 × 4096 blocks:

  | seed | river water | lowered by valleys |
  | --- | --- | --- |
  | 20261022 | 1.9 % | 7.0 % |
  | 7 | 2.3 % | 8.9 % |
  | 123 | 1.9 % | 7.1 % |

  The plan's "rivers on about a tenth of the land" counts the valleys. The water itself is about 2 %.
- **Maps** (made headless while tuning, a pixel every 4 or 8 blocks):
  - rivers wind between lakes and the sea, a few hundred blocks apart;
  - they narrow and stop at the edges of mountains;
  - deserts get rivers too.
- **In the browser:**
  - `?seed=7&find=river` from above: a river cutting through a hill into the sea, steep stone
    sides where the land is high, sand banks;
  - a 20 s sprint flight over version 2 land (`?autofly=20`): no frames over 20 ms (the longest
    16.9), main thread p50 3.4, p99 9.5, max 13.3 ms; no holes; no console errors.

## Step 3: savanna and swamp (2026-11-19)

**What's in:**
- **`world/biomes.ts`:** `Biome.Savanna` and `Biome.Swamp`, `BIOME_COUNT` 6.
  - A `Climate` of version 1 weighs only the first four, so version 1's land is exactly as before
    (the checksums still match).
  - **Savanna:** climate (0.22, -0.1), base 3, amplitude 5 over long low swells (160 blocks).
  - **Swamp:** climate (0.15, 0.27), base 3, amplitude 2.5 over hummocks and hollows (24 blocks). The
    continent's rise and fall is cut by 90 % of the swamp's weight, so a swamp lies just above the
    sea, with pools wherever the hollows dip under it.
- **Layers** (`writeLayers`):
  - savanna: dry grass on dirt (beaches and steep slopes as anywhere);
  - swamp: mud at the water's level and under it (pool beds too, never sand or gravel), grass from a
    block above it.
- **Trees** (`features.ts`):
  - **parasol trees** in the savanna (a 5% chance a cell, on dry grass): a trunk of 5–7 parasol wood
    with a flat crown, a disc 3 out level with its top (its rim thinned by a coin) and a disc 2 out
    above;
  - **swamp oaks** in the swamp (35%, on grass): oaks with leaves hanging 1–3 blocks from the edge of
    the lowest layer, about a third of the edge.
  - `TREE_REACH` went from 2 to 3 for the parasols' crowns, so column jobs look a block further for
    trees and their height maps are a block wider. Version 1's blocks don't change.
- **Reeds** (version 2, `Generator.reedsIn`):
  - by the water in the savanna (35%) and the swamp (60%), on ground at sea level or a block above
    with water beside it;
  - in the swamp, 4% anywhere;
  - never where a cave has taken the ground;
  - they stand on the block below, as wheat does.
- **Blocks 175–179:** dry grass, mud, reeds, parasol wood, parasol leaves, with procedural textures,
  sounds (grass, dirt, leaves, wood) and a place in the picker.
  - Dry grass gives dirt; mud, reeds and parasol wood give themselves.
  - Parasol leaves give sticks and berries as leaves do.
  - The spade digs dry grass and mud, the axe parasol wood.
  - 4 planks from parasol wood.
- **Fog** `TUNING.fog.savanna` (a golden haze) and `swamp` (a close green murk). `blendFog` blends
  over the weights it's given (version 1's worlds have four).
- **Animals:** the hopper in the savanna (on dry grass too), the mossback in the swamp (on mud too).
- **`?find=savanna|swamp`:** dry land where the biome weighs over 0.7. Every `?find` now stands the
  player on the nearest dry block to what it found (`dryNear`), not `findLand`'s land well above the
  sea, which a swamp hasn't got.
- **`GeneratorOptions.rivers`** (on unless switched off), so river tests and the bench compare
  version 2 with and without its rivers: version 1 differs from it by the new biomes too.
- **Tests (5 new, 3 updated):**
  - over 4096 × 4096 blocks, savanna more than 3% of the dry land and swamp more than 2%; none in
    version 1;
  - the layers;
  - parasol trees on dry grass and swamp oaks on grass in their biomes, in the blocks: the parasol's
    trunk, its crown 2 out always and 3 out at least one way, a disc above; swamp oaks' hanging leaves;
  - reeds stand on mud, grass, sand or dry grass; all the savanna's by water and at least a quarter
    of the swamp's; none in version 1;
  - fogs, animals and finds.
  - Updated: the biome test (version 1's four, and no others), and the river tests and bench, now
    against version 2 without rivers.

**Tuning, from maps** (made headless, a pixel every 8 blocks):
- The swamp was first at (0.17, 0.33) with base 0.5, and covered 1–6% of the dry land. In the
  browser it was mostly open water with mud islands, and all mud, since nearly all of it was within
  a block of the sea.
- Moving it to (0.15, 0.27), cutting the continent by 90% rather than 80%, base 3, and mud only at
  the water made it what it is now: mud flats at the pools, grass hummocks, swamp oaks.
- The savanna moved from (0.24, -0.08) to (0.22, -0.1), to cover a little more.

**Measured** (`npm run bench`, `generation versions`):
- **Generating a column:** version 1 2.13 ms, version 2 2.31 ms (+8%: rivers, the wider tree border
  and reeds).
- **The dry land by biome** (4096 × 4096 blocks):

  | seed | plains | forest | desert | mountains | savanna | swamp |
  | --- | --- | --- | --- | --- | --- | --- |
  | 20261022 | 19.7 % | 19.4 % | 8.3 % | 42.7 % | 5.9 % | 4.1 % |
  | 7 | 24.4 % | 13.7 % | 10.9 % | 35.7 % | 5.0 % | 10.4 % |
  | 123 | 29.6 % | 25.0 % | 7.3 % | 30.0 % | 5.7 % | 2.4 % |

- **Rivers:** about the same as in step 2 (1.8–2.3% water, 7–9% valleys).

**In the browser:**
- `?find=swamp`: mud flats round pools, reeds thick at the water, grass hummocks, trees on the
  higher ground.
- `?find=savanna`: dry grass terraces down to the water, parasol trees, reeds on the shore.
- All five new blocks are in the creative picker with their icons.
- **A sprint flight from the savanna** (`?find=savanna&autofly=20`): no frames over 20 ms (the
  longest 16.9), main thread p50 2.2, p99 7.3, max 13.2 ms; no holes; no console errors. A first run
  with the pane briefly hidden was thrown away; the flight marks such runs itself.

