# Milestone 17: creatures, part two

**Status:** plan approved (2026-11-19); step 1 in progress.

## Goal

More life in the world, and a reason to keep animals:
1. **Animals of their own for the new biomes:** the savanna and the swamp borrow hoppers and mossbacks
   now.
2. **Keeping and breeding animals:** today every animal is wild, unsaved and gone when you walk away.
   Feeding one makes it yours. Kept animals are saved with the world, never wander off for good, and
   two of a kind fed together make a young one that grows up.
3. **A second hostile creature,** for deep caves, so going underground is worth some care at any hour.

Everything invented; behaviour, spawning and saving tested headless; feel left for playtests.

## Design

### Two new animals (`mobs/kinds.ts`, `models.ts`, `pose.ts`, `render/mobTextures.ts`, `audio/sound.ts`)

| | Ambler (savanna) | Wader (swamp) |
| --- | --- | --- |
| Look | tall, long legs, a long neck that bobs as it walks, spotted hide | squat and wide, short legs, a flat head, mottled green-brown skin |
| Size | 0.4 half-width, 1.8 tall | 0.4 half-width, 0.6 tall |
| Moves | walks slowly, runs fast (5.5 blocks a second) | waddles, swims well and likes the water: rests floating in pools |
| Groups | 2–5 on dry grass | 1–3 on mud and grass by the water |
| Voice | a low two-note hoot | a croaking burble |
| Gives | raw meat | raw meat |

- Hoppers keep the savanna as well; mossbacks leave the swamp to the waders.
- `?showcase` stands them with the rest.

### Keeping animals (`mobs/kept.ts`, new)

- **Each kind has a food:**
  - mossback, crag goat, ambler: wheat;
  - hopper: seeds;
  - dune beetle, wader: berries.
- **Feeding:**
  - right-clicking an animal with its food (survival) uses one, and the animal shows it's pleased
    (a few heart-ish particles, invented);
  - a wild animal fed becomes **kept**.
- **A kept animal:**
  - never despawns, and isn't counted against the wild cap;
  - is saved in the world record (`animals`: kind, place, age, when it may breed again);
  - is stored away when its column unloads, and comes back when the column loads;
  - is stepped like any animal.
- **At most 128 kept animals a world** (`TUNING.mobs.kept`), so saving and stepping stay bounded.
  Feeding past the cap still feeds; it doesn't keep.
- **Wild animals are as now:** unsaved, despawning far away.

### Breeding and the young (`mobs/brain.ts`, `kept.ts`)

- **In love:** a kept animal fed while it may breed is in love for 30 s.
- **Finding a mate:** two of a kind in love within 8 blocks path to each other (a new brain state,
  `court`).
- **A young one:** when they meet, a young one of the kind appears between them (kept). Each parent
  then can't breed for 5 minutes.
- **The young:**
  - starts half size (body box and model scaled), and grows to full size over 10 minutes of play;
  - its age is saved;
  - it stays near a parent while small, and runs faster.
- Every breeding knob in `TUNING.mobs.breeding`.

### The delver (a hostile kind for deep caves)

- **Look:** squat, broad, a back of stone-grey plates; slow and tough.
- **Where:** it appears where it's dark and **below y 40** only (`Hostile.below`), in survival, at
  most 2 for each player. It never comes to the surface: the hunt stops above its depth.
- **Fighting:**
  - slow (1.0 walking, 2.6 hunting), sight 16;
  - hits hard and rarely: 4 points every 2 s;
  - takes 12 points.
- **Gives:** raw iron 1–2 (ores without the digging, for the brave).
- It goes by the same machinery as the gloamer (`hostile` in its kind): spawning in the dark, hunting
  by A*, its hits kept for the game. It doesn't fade in the sun, since it never sees it.

### Playing together

- The host owns the animals: a guest's feeding goes to the host as a new message (`feed`: the mob
  and the slot used), checked against reach and the food held, the food spent by the host.
- `mobState` carries a young one's age, so guests draw it at its size. Kept animals look the same as
  wild ones.
- `PROTOCOL` 8.

### Testing helpers

- `?farmyard` (`?farmyard=32`): kept animals of every kind round you, half of them young, for
  looking at and measuring.

## Files

| File | Change |
| --- | --- |
| `src/mobs/kinds.ts` | Ambler, Wader, Delver; each kind's food; `Hostile.below` |
| `src/mobs/models.ts`, `pose.ts` | their models (the ambler's neck, the wader floating) |
| `src/mobs/brain.ts` | `court` (to a mate), young following a parent, a young one's speed; the delver's hunt kept below its depth |
| `src/mobs/mobs.ts` | spawning the new kinds and the delver; kept animals not despawned or counted; feeding, love, births |
| `src/mobs/kept.ts` (new) | kept animals by column: stored, given back, saved and cleaned on load; the cap |
| `src/world/physics.ts` | a body's box scaled by age (young) |
| `src/render/mobRenderer.ts`, `mobTextures.ts`, `particles.ts` | the new looks, young drawn smaller, the fed sign |
| `src/audio/sound.ts` | two voices and the delver's |
| `src/save/store.ts` | `animals` in the world record |
| `src/net/protocol.ts`, `session.ts`, `mobState.ts`, `mobMirror.ts` | `feed`, age in mob states, PROTOCOL 8 |
| `src/game.ts` | right-click feeding, saving and loading kept animals, the delver's drop, `?farmyard` |
| `src/config.ts` | `TUNING.mobs.kept`, `breeding`, the delver's numbers |
| `bench/bench.ts` | mobs with 128 kept animals and 24 wild about; saving and loading them |

## Tests

- **The new kinds:**
  - amblers on savanna dry grass, waders by swamp water, never elsewhere;
  - their models stand on their feet and fit their boxes;
  - a wader's paths swim and an ambler's don't.
- **Feeding:**
  - only its food feeds it, and spends one;
  - a fed wild animal is kept;
  - past the cap it isn't kept;
  - a guest's feeding is checked and made by the host.
- **Kept animals:**
  - never despawn;
  - stored when their column unloads and given back where they were when it loads;
  - saved and loaded with their ages and waits, junk cleaned.
- **Breeding:**
  - two in love meet and make one young, whose parents wait 5 minutes;
  - not with another kind, not while waiting, not wild;
  - the young grow to full size in 10 minutes, their box with them, and follow a parent.
- **The delver:**
  - appears only in the dark below y 40, and only in survival;
  - its hunt stops at its depth;
  - it hits and drops as set.
- **Network:** `feed` and young animals' ages through the loopback network.

## Steps

1. **Ambler and wader.** Kinds, models, textures, poses, voices, spawning; tests; `?showcase`. Done (2026-11-19).
2. **Kept animals.** Food, feeding (and the guest's `feed`), keeping, the cap, storing by column,
   saving; tests.
3. **Breeding and the young.** Love, `court`, births, waits, growing, following; tests; `?farmyard`.
4. **The delver.** Kind, model, voice, spawning below its depth, drops; tests.
5. **Measurements,** notes, playtest questions.

## Decisions to agree

1. **Feeding makes an animal yours,** and only kept animals are saved and breed. Wild ones stay as they
   are.
2. **At most 128 kept animals a world.**
3. **Each kind has one food,** from what there is already (wheat, seeds, berries). No new items.
4. **The young grow up in 10 minutes of play** and stay near a parent.
5. **The delver lives below y 40,** in survival only, and drops raw iron.
6. **The names:** ambler, wader, delver (invented; easy to change).

## Step 1: the ambler and the wader (2026-11-19)

**What's in:**
- **`MobKind.Ambler` (5) and `MobKind.Wader` (6)** in `kinds.ts`:
  - **ambler:** 0.4 half-width, 1.8 tall; walks 1.4, runs 5.5; groups of 2–5 on the savanna's dry
    grass; 4 points of hitting;
  - **wader:** 0.4 × 0.6; walks 1.2, runs 3.2, swims (its paths too); groups of 1–3 on the swamp's
    mud and grass; 3 points.
  - Both leave raw meat like every animal.
- **Mossbacks leave the swamp** to the waders. Hoppers keep the savanna alongside the amblers.
- **Models** (`models.ts`):
  - the ambler: a body on four long legs, a neck and head turning together about the base of the
    neck (so a grazing dip brings the whole neck down), small horns, a tail;
  - the wader: a wide low body, a flat head with two eyes bulging on top, four short legs.
- **Poses:** `KindInfo.headBob`, how far the head nods with each step: the ambler's 0.22, the wader's
  0.12, the rest the 0.06 they had.
- **Textures** (`mobTextures.ts`): the ambler's sandy hide with brown blotches, its face and pale
  legs darkening to the hoof; the wader's mottled green-brown skin and a face with yellow eyes.
- **Voices** (`sound.ts`): the ambler a low two-note hoot, the wader a croaking burble of short
  rasps.
- **`?showcase=ambler,wader`** stands just those kinds in front of you (names in lower case, spaces as
  dashes). The showcase also looks 12 blocks up and down for somewhere to stand (it was 3 up and 6
  down), so a row across a slope isn't missing its ends.
- **`?find=savanna|swamp`** now wants the biome 32 blocks out every way as well, and its own ground
  (the savanna 3 above the sea, off the beaches). The nearest savanna was a lakeshore, where almost
  every spawning try landed in water.
- **Tests (3 new, 2 updated):**
  - amblers appear round the savanna and waders round the swamp, every kind spawned there at home
    on its own ground, none but waders in the swamp;
  - where each lives and its ground; a wader's paths swim, an ambler's don't;
  - the model tests (feet on the ground, fitting the box, textures there are) take both;
  - step 3's test checks waders in the swamp and amblers in the savanna.

**Measured:** the `mobs` bench (24 animals for 60 s, version 1's land, so none of the new kinds):
0.079 ms a frame by the median, about as before. The new kinds cost what the others do: one
instanced mesh a part.

**In the browser:** `?find=savanna&showcase=ambler,wader`: both standing on the dry grass by a lake,
the ambler grazing with its neck down; no console errors. The full showcase has all seven.

**Changed from the plan:** waders swim and spawn by the water, but don't seek it out or float at rest.
That would be a new behaviour; their home ground is at the water anyway.

