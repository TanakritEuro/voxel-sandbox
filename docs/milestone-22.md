# Milestone 22: settlements

**Status:** plan approved (2026-11-23), all six decisions as written; steps 1–2 built.

## Goal

Give the world people, and survival something to go out for:
1. **Settlements:** small hamlets of an invented folk, generated with the land, a few huts round a well, fields, paths
   and lanterns, found every so often on the plains, the savanna and the forest's edge.
2. **Folk:** who wander about their settlement by day, go home at night, and look up when you come near.
3. **Trading:** some folk trade, goods for goods, including a few things that can't be crafted, so iron, crystal and
   food have somewhere to go.
4. **Together:** the host's folk and trades shared with guests, as its mobs and chests are.

## What the code says (looked at and measured, 2026-11-23)

- **Structures already work the right way** (`world/structures.ts`): placed per cell from the seed and the
  generator's height function alone, every chunk writing the parts that fall inside it, so the result doesn't depend
  on load order. A settlement is the same, only bigger: up to about 30 blocks from its middle where a ruin reaches 4.
- **Laying one out is cheap:** a probe placing up to 7 huts of 7 x 7 on level, dry ground within 26 blocks of a cell's
  middle took **0.01–0.02 ms a cell**, heights included (a height is 1.7 us, a biome 0.3 us; headless, seed 20261022).
- **How often:** with the middle on the plains or the savanna, cells of 320 blocks gave a settlement in 11 % of cells,
  about **one every 950 blocks**, with 6 huts on average. With the forest's edge too it would be nearer 800.
- **New land needs a new generation version:** structures change chunks, and older worlds' land is pinned by checksum
  tests. So settlements come with **generation version 4**, in worlds made from now on.
- **Mobs have what folk need:** paths through open doors (not closed ones), resting at night, a kind's own size and
  looks, snapshots to guests. Kept animals already come back when their column loads (`columnLoaded`); folk can come
  the same way from their settlement.
- **Survival has nowhere to spend crystal:** it makes lamps and charged blocks, nothing else.

## Design

### Settlements (`world/settlements.ts` new, pure)

- **One chance per 320 x 320-block cell,** the middle on plains, savanna or forest (not deep in it), above the sea, not
  where a river runs. 3–7 huts on level, dry ground within 26 blocks, none overlapping; a well in the middle (stone
  bricks round water); 1–2 fields of farmland and wheat; paths of gravel from each hut's door to the well, along the
  ground as it is; lanterns on fence posts by the paths and doors.
- **Huts by biome:** plank walls and a **thatch** roof on the plains and in the forest; **mud brick** walls and a flat
  thatch roof on the savanna. A doorway with an open door (folk can't open doors), a bed for each who lives there, a
  window or two, a chest. One hut in each settlement is a trader's, with a counter (slabs) out front.
- **Written like structures:** the land levelled under each hut, the parts falling in each chunk written last. Ruins
  and camps aren't placed within a settlement's reach. Layouts are kept per cell in the worker (each is asked for by
  many columns). `?find=settlement`.
- **New blocks:** thatch (4 wheat), mud bricks (mud and sand, in the furnace), each with its texture.

### Folk (`mobs/kinds.ts`, `brain.ts`, `models.ts`, `mobs.ts`)

- **A new kind, the hearthfolk** (the name is for agreeing): about the player's size, blocky, invented look (a hood,
  a satchel), two or three colourings. A settlement has one or two for each hut.
- **Where they come from:** when a settlement's middle column loads, its folk appear (each in its home), and they go
  when it unloads. They aren't saved, so they come back as they were; they don't count against the animals' cap.
- **What they do:** by day wander about their settlement (never beyond 32 blocks of the well), stand at the counter
  (the trader), stop and turn to a player who comes close; at dusk walk home and rest in bed; scatter from a gloamer.
- **They can't be hurt:** a hit makes them step back with a cry, nothing else. Not fed, kept or bred.
- **Voices:** a low hum, a short call when greeted; synthesised like the animals'.

### Trading (`survival/trade.ts` new, pure; `ui/trader.ts` new)

- **Right click a trader** (in survival) to open a trade screen beside the inventory: a list of offers, what you give
  and what you get, greyed out when you haven't enough or it's sold out. Each settlement's trader has 5–7 offers drawn
  from the seed: some buying (wheat, raw meat, wood, raw iron for a little crystal or copper), some selling.
- **Barter, no money.** Each offer can be made a few times, then is sold out, and comes back one at a time every few
  minutes of play. Stock is saved in the world's record (`settlements`), cleaned on load.
- **Trade-only goods** (none of them craftable):
  - **a finder's map:** a map that marks the nearest dungeon, crystal cavern or other settlement, shown on the held map
    and the full-screen one, with an arrow when it's off the edge;
  - **a crystal pick:** digs faster than iron and lasts much longer.
- **Also sold:** bread, cooked meat and lanterns, for a start in a new world.
- **Creative:** folk are there and say hello; there's nothing to trade for.

### Together (`net/protocol.ts`, `session.ts`, `hostSurvival.ts`)

- Folk are the host's mobs, sent to guests as mobs are. A guest's trade is asked of the host, made against the host's
  stock and the guest's state as the host last heard it, and the result sent back, as a chest's put and take are.
  **`PROTOCOL` 14.**

### For trying it

- `?find=settlement`, `?showcase=hearthfolk`, `?kit` with things to trade.

## Files

| File | Change |
| --- | --- |
| `src/world/settlements.ts` (new) | layout per cell, blocks, `settlementsIn`, `settlementNear` |
| `src/world/generate.ts`, `structures.ts`, `find.ts` | version 4; ruins and camps kept clear; `?find=settlement` |
| `src/world/blocks.ts`, `textures.ts`, `src/ui/categories.ts`, `src/survival/crafting.ts`, `furnace.ts` | thatch, mud bricks |
| `src/mobs/kinds.ts`, `brain.ts`, `models.ts`, `mobs.ts`, `src/render/mobTextures.ts`, `src/audio/sound.ts` | the hearthfolk |
| `src/survival/trade.ts`, `src/ui/trader.ts` (new); `src/survival/items.ts`, `drops.ts`, `src/ui/backpack.ts` | offers, stock, the screen; the finder's map and the crystal pick |
| `src/render/mapView.ts`, `src/survival/map.ts` | the finder's map's mark |
| `src/net/protocol.ts`, `session.ts`, `hostSurvival.ts` | trading as a guest; `PROTOCOL` 14 |
| `src/save/store.ts`, `src/game.ts`, `src/config.ts` | the record's `settlements`; wiring; `TUNING.settlements`, `TUNING.trade` |
| `bench/bench.ts` | a cell's layout, a column job with a settlement |

## Tests

- **Settlements:** the same blocks whichever column is generated first (across chunk borders); huts on level dry ground,
  none overlapping, no ruin or camp inside one; only in version 4 (versions 1–3 still match their checksums); found by
  `?find`.
- **Folk:** come with their settlement's column and go with it; stay within reach of the well; go home and lie down at
  night; can't be hurt; not counted in the cap; paths through the open doors.
- **Trading:** an offer made gives and takes exactly; refused without enough, with no room, or sold out; restocking in
  time; saved and back; junk cleaned; the finder's map points at the nearest of its kind.
- **Together:** a guest's trade made by the host, refused when the host's stock is out, junk turned away.

## How to measure

Against this commit, in the same sitting, as in Milestone 21 (production builds interleaved, the bench with the server
stopped).

| What | Limit |
| --- | --- |
| Generate job, a column (bench, and interleaved headless) | +0.15 ms |
| Main thread, standing in a settlement with its folk | +0.3 ms a frame |
| GPU, looking over a settlement | +0.3 ms |
| Sprint flight over settled land | no more frames over 20 ms |

## Risks

- **Huts on slopes:** levelling can leave walls of dirt or huts on stilts. The level test is strict, and screenshots
  of a dozen settlements will be looked at.
- **Folk stuck:** paths through doorways and round fields. Getting unstuck exists; a stuck one is put back home.
- **Too few or too many:** one every 800–1000 blocks is a guess; `TUNING` holds it.

## Steps

1. **Settlements in the land:** the layout, blocks, version 4, thatch and mud bricks, `?find=settlement`; tests; bench.
   Done (2026-11-23).
2. **The hearthfolk:** kind, looks, brain, coming and going with the settlement, voices; tests.
   Done (2026-11-23).
3. **Trading:** offers, stock, the screen, the finder's map and the crystal pick; tests.
4. **Together:** guests trading through the host; tests.
5. **Measurements,** screenshots of settlements, notes, playtest questions.

## Decisions to agree

1. **New worlds only:** settlements come with generation version 4; older worlds keep their land, with none.
2. **Folk can't be hurt,** aren't saved, and come back as they were when their land loads.
3. **Barter, no money:** offers sell out and come back slowly.
4. **Trade-only goods:** the finder's map and the crystal pick (the crystal pick is a tool, not armour or a weapon).
5. **Where:** plains, savanna and the forest's edge, about one settlement every 800–1000 blocks.
6. **The folk's name:** hearthfolk, or another you'd like.

## Step 1: settlements in the land (2026-11-23)

**Built:**
- **`world/settlements.ts`:** one chance per 320 x 320-block cell, two places tried for the middle (on the plains, the
  savanna, or the forest within 48 blocks of open land; 3 above the sea; the well's square level within 1, no cave under
  it). 3–7 huts tried 80 times at 10–26 blocks out, each on dry ground within 2 of its floor at nine points, within 6 of
  the well's height, no cave under its middle or corners, a block clear of anything else; facing the well. 1–2 fields
  (7 x 5 of farmland either side of a row of water, wheat at stages 3–7). No settlement without 3 huts and a field.
- **What's written:** gravel paths from each doorstep to the well's square, a block at a time along the ground as it
  is (not over water or a cave's mouth); the well (stone bricks round water three deep, fence posts, a plank-slab roof,
  a square of gravel, two lanterns on posts); fields and the ground round them levelled; huts. Plank huts (plains, forest):
  plank walls, log corners, a gabled thatch roof stepping up to a ridge, plank gable ends. Mud huts (savanna): mud brick
  walls, parasol-wood corners, a flat thatch roof with a hump. Each: a plank floor, the doorway with its door open (as
  if placed from outside), glass-pane windows in the sides and back, 1–2 beds along the back wall, a chest, a lantern
  inside, a lantern on a post by the door. The trader's hut (the first placed) has a counter of plank slabs out front.
- **Generation version 4:** `GENERATION` is 4; versions 1–3 unchanged. In version 4 no ruin or camp stands within 24
  blocks of a settlement's reach (`Generator.structureInCell`, `structuresIn`), and no tree where its leaves would touch
  a hut, the well, a field or a path (`crowds`). Settlements are written after everything else, each column job taking
  only its own column's part (`Settlement.columns`).
- **Kept per cell:** `Settlements` keeps the 32 cells last asked for; a layout asks each column's height once (`Memo`).
  `caveLimit` moved to `caves.ts` (settlements use it; `generate.ts` still exports it).
- **Thatch** (216: 4 wheat, broken by hand) and **mud bricks** (217: mud smelted, a pick of any tier), each with a texture.
  Hut chests hold a household's things (`StructureKind.Hut`'s loot: bread, wheat, seeds, berries, torches, planks).
- **`?find=settlement`:** the nearest, by cell; you stand on the gravel by the well. **`PROTOCOL` 14** (generation changed).

**Tests:** `tests/settlements.test.ts` (13): how often and how big; level, dry, apart, within reach; the same whichever
column is generated first, and a fresh layout equal to a kept one; the blocks written (well, doors open, beds, chest and
its loot, lantern, roof, wheat, gravel paths with air over them); no leaves in huts, nothing on paths, no ruin or camp
near; only in version 4, found by `?find`; kept and laid out again the same; thatch, mud bricks and their making.
`tests/generationV4.test.ts` pins version 4 (the old columns, where it makes what version 3 makes, and five settled
columns); `generationV3.test.ts` also pins version 3 at those five, the checksums from 19ac841's generator. The
protocol test takes generation 4 and refuses 5. 757 in all pass; the build passes.

**How often** (probed, 100 cells each): seeds 20261022, 7, 123, 99 and 5 gave a settlement every 888, 965, 776, 855 and
826 blocks, with 4.2–5.3 huts on average.

**Looked at:** ten settlements from above over five seeds (plank and mud), close up: a hut inside (open door, two beds,
the lantern, windows), the well, paths, fields of wheat, lantern posts. Levelled rings stand a block above or below the
land round them now and then; no hut on stilts or walled in dirt was seen. No console errors.

**Measured** (headless bench, the server stopped):

| | Version 3 | Version 4 | |
| --- | --- | --- | --- |
| Generate job, the bench's 253 columns (no settlement among them) | 3.905, 3.864 ms | 3.814, 3.884 | -2 %, +1 % |
| The 9 columns over a settlement (median of 15, alternating) | 4.215, 4.215 | 4.314, 4.783 | +0.10, +0.57 ms |
| Laying out a settled cell, warm | | 2.6–4.6 ms | once per worker per settlement |

- **Over the limit inside a settlement:** a column job over one costs +0.1 to +0.6 ms (noisy), most of it the layout
  (about 0.9 ms of heights and caves; the rest building ~5000 blocks), paid by the first column job in each worker that
  reaches the settlement, then kept. Over land at large it's within (+0.15 ms). Step 5 measures it again interleaved;
  if it matters, the blocks can be built lazily per column.
- **Sprint flights over settled land** (dev server, seed 123, 15 s through a settlement, twice): no frame over 20 ms, no
  holes, main thread p99 7.6 and 8.1 ms. The GPU and the main thread standing in one are for step 5, as planned.

**Changed from the plan:**
- **`PROTOCOL` 14 now,** since generation changed (the rule); step 4's messages will make it 15.
- **Mud bricks are mud alone** in the furnace (a furnace takes one thing in), not mud and sand.
- **Hut chests have loot,** a household's, from a table of their own.
- **A settlement needs a field;** two places are tried for its middle, so they come about one every 780–970 blocks.
- **Ruins and camps are kept 24 blocks further off** than the settlement's reach, so none stands just outside.

## Step 2: the hearthfolk (2026-11-23)

**Built:**
- **The kind** (`MobKind.Hearthfolk`, `KindInfo.folk`): 0.6 x 1.8, a walk of 1.3 blocks a second, swims; no biome,
  ground, food or health that matters.
- **Looks:** a long belted tunic with sleeves, brown trousers, a weathered face, a hood (top, back and sides, moving with
  the head), a leather satchel at the hip. Robe and hood are undyed cloth tinted by one of three colourings (rust, moss,
  slate) by id (`ModelPart.tint`, `COLOURINGS`), so guests see the same. In bed they lie on their backs along it, head
  on the pillow (`Pose.lie`). They don't graze; greeting, they look up a little.
- **Their brain** (`mobs/folk.ts`, from `stepBrain`): by day idle 3–9 s, then a walk to somewhere 3–22 blocks from
  the well (the trader to its place beside the counter three times in four, looking out from it); a player within 3.5
  blocks: stop and turn to them for up to 6 s, once a visit, a greeting at most every 20 s; a hostile mob within 10
  blocks: run; past 32 from the well: the next walk is back. Below daylight 0.38 they walk home (a path to the floor
  beside their bed, through their open doors) and lie down; with no way after 3 tries or after 90 s they're put there.
  Above 0.45 they get up beside the bed.
- **Coming and going** (`MobManager`): when a column loads, each settlement reaching into it whose well's column and
  every home's are loaded gets its folk, one for each bed, beside it (in it at night). When the well's column or the
  column any of them stands in unloads, all of that settlement's go. Not despawned for being far, not in the cap, not
  in `?farmyard`, never kept or saved.
- **Can't be hurt:** a hit is a step back (2.5 blocks a second, none in bed) and a cry; no flash of health lost, no
  fleeing.
- **Voices:** humming to themselves (three soft gliding notes) now and then, never asleep; a greeting of two warm
  notes rising; a short falling "oof" when hit.
- **`PROTOCOL` 15:** the mob snapshots carry the new states (sleep, home, greet) and the greeting's sound, and kind 8.

**Tests:** `tests/hearthfolk.test.ts` (13): the kind; coming with the settlement, not before its homes' land, once,
beside the beds, one trader; in bed at night; not in the cap; going with the well's column and back when it loads, not
for being far; not hurt; wandering for 90 s never past the reach, the trader mostly at its counter; walking home at dusk
(none put there) and lying in their own beds the right way, still until morning, up beside them; put to bed when there's
no way; turning to and greeting a player once a visit; running from a gloamer; their snapshots and greeting to guests;
a showcased one standing. The animal-only tests leave them out. 770 in all pass; the build passes.

**Looked at** (seed 123's settlement): 8 folk by day, wandering, two turning to the camera as it came near, the three
colourings; at night one lying in its bed (lowered after the first look: it floated above the blanket). The first tint
was too pale (tinted after the light was made linear); it's tinted in sRGB now. No console errors.

**Measured:** in the settlement by day with `?stats`, 8 folk and 24 animals: the mobs took 0.1–0.5 ms a frame,
0–8 path searches a second, none put off. The full measurements are step 5's.

**Changed from the plan:**
- **`PROTOCOL` 15 now** (mob snapshots changed); step 4 makes it 16.
- **Folk appear beside their beds,** not "each in its home" at a random spot; at night, in them.
- **A stuck one is put to bed** (after 3 failed searches or 90 s on the way), rather than back home by day.
