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
   share, generation time); `?find=river`.
3. **Savanna and swamp.** Climate, heights, layers, the new blocks and textures, parasol trees, swamp
   oaks, reeds, fog, animals; tests; `?find=savanna|swamp`.
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

