# Milestone 12: survival, part two

**Plan, to check.**

**Goal.** Survival with things to do and something to fear:
- what you break falls to the ground and is picked up, and you can throw things;
- a furnace smelts ores and sand and cooks meat;
- you get hungry, and hunt and cook to eat;
- at night and in deep caves something comes for you.

Creative is unchanged: no items on the ground, no hunger, no hostile creature. The budget holds:
60 fps at radius 8 with items lying about, a furnace burning and creatures chasing, no frame over 20 ms.

## Items on the ground

- **Breaking a block drops what it gives on the ground,** with a little hop (step 1 of Milestone 11
  put it straight into the inventory; that ends).
  - An item lying there is a small spinning thing: a block as a little cube, anything else its
    picture made a slab, as held.
  - It falls, lands and slides to a stop on the blocks (the mobs' box physics, a small box). It
    floats in water.
  - The same items close together merge into one stack.
- **Picked up** when the player comes within 1.5 blocks: pulled in, with the pickup blip. If there's
  no room it stays where it is.
- **Thrown:** Q throws one of the selected item forward, Ctrl + Q the whole stack. A thrown item
  can't be picked up again for a second.
- **Gone** after 5 minutes on the ground, or when its column unloads. Items on the ground aren't saved
  (to agree).
- **A cap** of 256 near each player; past it the oldest go.

## The furnace

- **A new block,** crafted from 8 stone. It faces the way it's placed, and glows (light 13) while it
  burns.
- **Right click opens it:** an input slot, a fuel slot and an output slot, beside the inventory, with
  a flame for the fuel left and an arrow for the item cooking. Moving things works as in the inventory
  screen.
- **Smelting:** 5 s an item, while it has fuel and the output has room.

| In | Out |
| --- | --- |
| Raw copper | Copper |
| Raw iron | Iron |
| Sand | Glass |
| Raw meat | Cooked meat |

- **Fuel,** in items smelted: coal 8, ember 12, wood or planks 1.5, a stick 0.5.
- **Ores change** (to agree): copper and iron ore now drop raw copper and raw iron, to smelt. Coal and
  crystal drop as before. The crafting recipe for glass goes; glass comes from the furnace.
- **A furnace keeps what's in it:**
  - a block's contents are kept by place, a *block entity*, in a store saved with the world's chunks
    (a new IndexedDB store, keyed by world and place);
  - it smelts only while its column is loaded;
  - breaking it drops what's in it, and the furnace.

## Food and hunger

- **Hunger:** 20 points, shown as 10 pips beside health.
  - It drains slowly: about a point a minute standing, more sprinting, swimming and digging.
  - **Healing needs food:** health comes back only while hunger is 15 or more, and costs hunger.
  - **Starving** (hunger 0) costs a point of health every 4 s, down to 1: it never kills (to agree).
- **Food:**
  - **raw meat** (1 or 2 from an animal when it goes in a puff): 3 points, cooked meat 8;
  - **berries** (one in twenty leaves): 2 points.
  - **Eating:** hold the right button with food selected for 1.5 s (a sound and a little motion).
    Full, you can't eat.
- Saved with health.

## The night creature

An invented creature, the **gloamer**: a thin, dark, long-armed thing with two pale eyes.

- **Only in survival worlds,** and only in the dark:
  - it appears on blocks where it's dark (sunlight and block light together at most 4): on the surface
    at night, in caves at any hour;
  - 24–48 blocks from a player, 4 at most for each player.
- **It hunts:** within 20 blocks of a player it comes for them by A* (the mobs' path search), faster
  than walking, slower than sprinting.
- **It hits** at arm's length: 3 points and a push, once a second.
- **It's hurt by:** 8 points to kill. A hand hits for 1, a pick or spade 2, an axe 3. It's knocked
  back a little.
- **Daylight:** on the surface by day it fades into smoke (a puff).
- **It drops** an **ember** (fuel, and 4 torches from an ember and a stick).
- **Light keeps it away:** it never appears near torches or lamps, as it needs the dark.
- **Sounds:** a low rasp now and then, louder as it comes, synthesised like the rest.

## Design

### 1. Items on the ground (new `survival/ground.ts`, pure; `survival/play.ts` drops to it)
- **`GroundItems`:** a list of `{ id, item, count, wear?, body, age, pickupDelay }`.
  - Stepped at the mobs' fixed rate with the box physics.
  - Merging by a coarse grid; pickup by distance to the player; aging.
  - `drop(x, y, z, stack, velocity)`, `step(dt, world, players)` returning pickups.
- **Drawn** with one `InstancedMesh` per item kind on screen (blocks as cubes from the block icons'
  textures, items as their slabs), spinning and bobbing; at most a few dozen draw calls.

### 2. The furnace (`world/blocks.ts`, new `survival/furnace.ts` pure, `save/`)
- Block ids for a furnace by facing, unlit and lit.
- **`Furnace`:** input, fuel and output stacks, fuel left, progress. `step(dt)` smelts.
- **`BlockEntities`:** furnaces by place. Saved in a new IndexedDB store, `entities`, beside `chunks`.
- **`ui/furnace.ts`:** the screen, built like the inventory screen and sharing its slot code.

### 3. Food and hunger (`survival/health.ts` grows hunger, `survival/items.ts` food)
- Hunger in `Health`, stepped with what the player did (walked, sprinted, swam, dug).
- `eat(item)`. Food items with their points.

### 4. The gloamer (`mobs/`)
- **A fifth kind:** size, speeds, and a new `hostile` part (sight range, hit, health, darkness to
  spawn in).
- **Its brain:** a new `hunt` state, paths to the nearest player, re-planned every second or when
  they've moved 3 blocks; `attack` when within reach.
- **Spawning by darkness** (the world's light) instead of biome and ground; fading by daylight.
- Mobs get **health in points** in place of a count of hits, so tools can hit harder; animals keep
  3 hits by hand.
- **Looks:** a model, textures, a pose (arms swinging, a lurch).

### 5. Together (`net/`)
- **Items on the ground are the host's,** like mobs:
  - guests see them mirrored (`itemState.ts`, a few bytes each);
  - a guest picking one up asks the host (`take`), which gives it to the first to ask;
  - a guest throwing one asks the host to drop it.
- **Furnaces are the host's:**
  - a guest opening one gets its contents and their changes;
  - its moves go to the host as messages, checked there.
- **The gloamer is the host's** like any mob; its hit on a guest goes to that guest (`hurt`: points
  and push).
- **Hunger is each player's own,** saved with the rest of their survival state (kept by the host for
  guests).
- `PROTOCOL` 4.

## Files
- **New:**
  - `survival/ground.ts`, `survival/furnace.ts`, `save/entities.ts`;
  - `render/groundItems.ts`, `ui/furnace.ts`, `net/itemState.ts`;
  - tests.
- **Changed:**
  - `survival/` (items, drops, crafting, health, play), `world/blocks.ts`, `world/textures.ts`;
  - `mobs/` (kinds, brain, mobs, models, pose), `render/mobRenderer.ts`, `render/mobTextures.ts`;
  - `game.ts`, `ui/backpack.ts`, `audio/sound.ts`;
  - `save/store.ts`, `save/saver.ts`;
  - `net/protocol.ts`, `net/session.ts`;
  - `config.ts`, `style.css`, CLAUDE.md.

## Tests (headless)
- **Items on the ground,** through the real physics:
  - a dropped item falls and lands on the floor, floats on water;
  - two of the same close together merge;
  - it's picked up within 1.5 blocks, not past it, nor while its delay lasts;
  - with no room it stays;
  - it's gone at 5 minutes;
  - the cap drops the oldest.
- **The furnace:**
  - each smelting recipe at 5 s an item;
  - each fuel lasts its items;
  - it stops with no fuel or a full output;
  - contents save and load; breaking drops them.
- **Hunger:**
  - it drains faster sprinting than standing;
  - healing waits for 15 and costs hunger;
  - starving stops at 1;
  - eating adds and is refused when full;
  - save round trip.
- **The gloamer:**
  - it spawns only where it's dark, never by a torch, only in survival;
  - it paths to a player and hits once a second at reach;
  - a hand, a pick and an axe take 8, 4 and 3 hits;
  - it fades in daylight on the surface, not in a cave;
  - it drops an ember.
- **Together:** a guest's take goes to the first who asks; a guest sees the host's items; a hit on a
  guest reaches it; a guest's furnace move is made by the host.

## Measuring
- **`npm run bench`:** 256 items on the ground stepping (ms a tick); a furnace field of 50 burning.
- **Chrome, radius 8:**
  - frame and main-thread time with 256 items lying round the player;
  - with four gloamers hunting at night;
  - against the same place without.
- **Together:** what items and gloamers add to a guest's KB/s.
- **Target:** no frame over 20 ms; under 1 ms of main thread for items and furnaces together.

## Steps (each built, tested, measured, committed and pushed)
1. **Items on the ground:** dropping, physics, merging, pickup, throwing, aging, drawing.
2. **The furnace:** the block, block entities saved, smelting, the screen, raw ores, glass by fire.
3. **Food and hunger:** meat and berries, eating, the hunger pips, healing by food.
4. **The gloamer:** the kind, darkness spawning, hunting and hitting, health in points and tools,
   fading by day, its looks and sounds.
5. **Together:** items, furnaces and the gloamer for guests.
6. **Measurements,** notes and playtest questions.

## Decisions to agree
- **Drops go on the ground now,** picked up within 1.5 blocks; with no room they stay. Gone after 5
  minutes; not saved.
- **Dying still keeps everything** (nothing is dropped where you fall).
- **Copper and iron ore drop raw ore to smelt;** glass comes only from the furnace.
- **Hunger can't kill:** starving stops at 1 point; healing needs hunger 15 or more.
- **The gloamer:** only in survival and the dark, 4 at most for each player, 3 points a hit, 8 to
  kill, fades by day, drops an ember. Its name and looks are invented.
- **Tools hit harder** (hand 1, pick or spade 2, axe 3), and animals keep 3 hits by hand.
- **Furnaces and items on the ground are the host's** when playing together.
- **Names:** furnace, raw copper, raw iron, raw meat, cooked meat, berries, ember, gloamer.
