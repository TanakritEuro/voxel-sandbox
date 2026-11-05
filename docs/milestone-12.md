# Milestone 12: survival, part two

**Plan approved (2026-11-05)** as proposed: drops on the ground (not saved), dying keeping everything,
raw copper and iron to smelt and glass only from the furnace, hunger that can't kill, the gloamer as
described, tools hitting harder, furnaces and items on the ground the host's, and the names listed.
One change while building: a whole stack is thrown with **Shift + Q**, not Ctrl + Q, which quits
Chrome on Linux (and Cmd + Q on a Mac).

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
- **Thrown:** Q throws one of the selected item forward, Shift + Q the whole stack. A thrown item
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

## Step 1: items on the ground — built (2026-11-05)

**What changed:**
- **`survival/ground.ts`, `GroundItems`** (pure; numbers in `TUNING.survival.ground`):
  - **Physics:** an item is a box a quarter of a block, moved by the block physics (`moveBody`) at
    60 steps a second, at most 4 a frame. Gravity, sliding to a stop on the ground, slowing in the
    air, bobbing up to the top of water.
  - **Sleeping:** one at rest on the ground sleeps. It only looks at the block under it every
    quarter second (spread out by id), and falls when that goes.
  - **Merging:** every quarter second the same items within 0.75 of each other merge, up to a full
    stack (tools never).
  - **Picking up:** within 1.5 blocks of a player's box. The game takes as much as fits; with no
    room the item stays.
  - **Gone:** after 5 minutes, when its land unloads, or past the cap of 256 (the oldest first).
- **Breaking in survival** (`survival/play.ts`, `breakWith`, in place of `harvest`): what the block
  gives hops out of it in a random direction; the tool held wears as before.
- **Q** throws one of the selected item the way the player looks, **Shift + Q** the stack; a
  thrown item waits a second before it can be picked up. A stack held on the inventory screen with no
  room to go back drops at the feet (it was lost before).
- **Drawn** (`render/groundItems.ts`): an InstancedMesh for each kind lying about, so a draw call a
  kind.
  - A block is a little cube, its top, side and bottom textures side by side on one small texture,
    shaded by vertex colour. Anything else, and torches and the thin logic blocks, is its picture as
    a slab, as held.
  - Each turns slowly and bobs, as bright as the light where it lies.
- **`?nolock`** (`input.ts` free mode): the mouse counts as captured without the browser's pointer
  lock, and Esc lets it go. The game's own lets-go go through `input.unlock()`. Chrome kept refusing
  the pointer lock to a page driven from outside ("The root document of this element is not valid
  for pointer lock"), most likely because its window loses focus whenever you answer me here.

**A fix after trying:** reach was first measured from the player's middle. In Chrome, a block dug
at the player's feet left its dirt at the bottom of the hole, 1.8 blocks below the middle, out of
reach from the edge: you'd have had to jump into every hole. Reach is now 1.5 blocks from the nearest
point of the player's box.

**Bench** (`npm run bench`, `ground items`: the cap of 256 dropped over 32 × 32 blocks, a player
among them with no room, 10 s at 60 frames):

| | lying after 10 s | ms a frame, falling (the first second): median / max | after: median / p95 / max |
| --- | --- | --- | --- |
| On land round the spawn | 246, all asleep | 0.378 / 2.04 | 0.120 / 0.191 / 0.346 |
| Over the sea at the origin | 247, 186 floating | 0.343 / 4.65 | 0.193 / 0.317 / 0.564 |

- At first the land case was at the origin, which is sea at this seed: only 61 of 247 slept, and
  every one awake was floating. That's right (they bob), but it wasn't measuring land; there are now
  both.
- Well under the plan's 1 ms.

**Tests (8 new, 392 in all,** `tests/ground.test.ts`, through the real block physics):
- an item falls and rests on the floor, slides a little and stops, sleeps, and falls into the hole
  when the block under it goes;
- one in water floats at the top;
- the same items close together merge up to 64; other items, tools and one too far away don't;
- picked up within reach, not 4 blocks off, not while a thrown one waits;
- one at the bottom of a hole is in reach from its edge;
- with no room it stays, and loses only what was taken;
- gone at 5 minutes, or when its land unloads;
- the cap drops the oldest.
- The survival tests for breaking now check `breakWith`: what it gives, and wear.

**Looked at in Chrome** (`?seed=7&survival&kit&nolock`):
- three planks thrown with Q lay a couple of blocks ahead as one small spinning cube (they merged),
  the hotbar 16 to 13;
- walking onto them picked them up (13 to 16);
- a grass block dug at the feet left its dirt at the bottom of the hole; after the fix, it was
  picked up from the edge.
- No console errors.

## Step 2: the furnace — built (2026-11-05)

**What changed:**
- **Blocks** 98–105: a furnace by facing, out and burning (`furnace`, `furnaceOf`).
  - A burning one gives light 13. Only the first, out, is offered or dropped.
  - Placed with its front to the player (`logicPlacement`: the opposite of the way they look).
  - It needs a pick (wood or better) to come back.
  - **Looks:** stone brick sides, a top with a vent, and a front with an arched opening, dark or on
    fire (four new textures).
  - `BlockInfo.front` gives the side a block faces its own texture: the mesher's face table and the
    icon use it.
  - Guests may place one facing any way, out.
- **Items:** raw copper and raw iron (ids 270, 271), pictures as lumps with stone in them. Copper
  and iron ore now give them.
- **Crafting:** a furnace from 8 stone. Glass leaves the list (the furnace makes it).
- **`survival/furnace.ts`:**
  - **`Furnace`:** an input, a fuel and an output slot (an `Inventory` of 3: inventories now take a
    size).
  - **Burning:** while something can be smelted and its result has room, it lights a fuel and
    smelts an item every 5 s (`TUNING.survival.smeltSeconds`). Once lit, a fuel burns to its end.
  - **Recipes:** raw copper to copper, raw iron to iron, sand to glass. Fuel in items: coal 8, wood
    and planks 1.5, a stick 0.5.
  - The output only gives; the fuel slot takes only fuel.
  - **`Furnaces`:** by place, saved in the world record (`record.furnaces`). Empty, out ones aren't
    kept, and what's saved is cleaned on load.
  - **A change from the plan:** contents are kept in the record rather than a new IndexedDB store.
    Furnaces are few, and the record is saved every few seconds and on leaving. A furnace block with
    nothing kept is an empty one; one kept where the block has gone is forgotten.
- **In the game:**
  - furnaces in loaded land tick every frame;
  - those that light or go out change their block all at once, as a water tick does (light in one
    update, remeshed in the workers, sent to guests);
  - a right click on one in survival opens it (Shift and right click places against it);
  - breaking one drops what's in it with it.
  - A guest can't open one yet (step 5).
- **The inventory screen** shows a furnace in place of crafting when opened from one:
  - its input over a flame (the fuel left) over its fuel, an arrow (the item smelting) and its
    output;
  - Shift and a click puts fuel in the fuel and smeltables in the input, and takes things out.
- **The world now runs while an inventory screen is open,** playing alone: only the pause menu
  stops it. Opening a furnace paused it before, so nothing burned while you watched. The player stands
  still as before.
- `?kit` adds a furnace, raw copper and raw iron.

**Fixes on the way:**
- **Smelting made nothing at first** (the tests caught it): the result went in with `add`, which
  fills the first empty slot, the fuel slot once its last coal was lit. It now goes in the output
  slot itself.
- **Lighting a furnace was first an edit,** remeshed on the main thread at once like a block broken.
  It's now batched as water and logic are, after the bench showed the cost of lighting 50 at once.

**Bench** (`npm run bench`, `furnaces`: 50 burning for 10 s, the block looked up and lit as the
game does): 0.038 ms a frame median, 0.100 p95. The first frame, lighting all 50 (50 light
updates), 5.4 ms.

**Tests (10 new, 402 in all,** `tests/furnace.test.ts`):
- **Smelting:** each recipe, an item every 5 s.
- **Fuel:** coal smelts 8; planks 1 (and 3 from two); a stick none, two a stick 1.
- **Lighting:** only with something to smelt and fuel; a coal lit for one raw iron burns on to its
  end, and the furnace says once when it lights and once when it goes out.
- **Stopping:** when the output is full or holds something else.
- **Slots:** what each takes.
- **Saving:** by place, a lit one comes back lit; empty ones aren't kept; junk is cleaned.
- **Blocks:** four facings, out and burning, burning ones giving light, one offered; placed with the
  front to the player; the mesher puts the front texture on the side faced and bricks on the others,
  for every facing; a pick needed for one to come back.
- The step-1 tests that knew the old drops, recipes and ids were brought up to date (raw ores, no
  glass recipe, the furnaces after the logic ids).

**Looked at in Chrome** (`?seed=7&survival&kit&nolock`):
- the kit's furnace placed and opened by a right click: the furnace part in place of crafting;
- Shift and a click put raw iron and coal in; 6 s later one iron was out, the flame at 85 %, the next
  item a fifth done;
- closed, the furnace burned in the world, its front to the player, fire in its arch;
- broken with the stone pick: it and its contents dropped and were picked up walking over (iron 8
  to 12);
- after the batching, a furnace smelting sand with planks lit the same way.
- No console errors.
