# Milestone 22: settlements

**Status:** plan, to check (2026-11-23).

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
2. **The hearthfolk:** kind, looks, brain, coming and going with the settlement, voices; tests.
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
