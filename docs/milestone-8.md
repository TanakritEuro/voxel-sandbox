# Milestone 8: flowing water

**Plan approved (2026-11-01)** as proposed: new sources from two side by side, flowing towards
the nearest drop, flat steps in eighths, the push along the flow, torches washed away, 4 ticks a
second.

**Goal.** Water that moves:
- dig into the side of a lake and it pours into the hole;
- place water on a hill and it runs down the slope, spreading a few blocks from where it lands;
- block it off and the water left behind drains away.

The world as generated stays still. The sea and lakes are made of sources that don't move until
an edit disturbs them, and caves are already kept away from water by the generator. So water only
moves where you change something. The game stays inside its budget: no frame over 20 ms flying at
radius 8, and no frame over 20 ms while a cave floods.

## How water behaves (a cellular automaton)

- **Sources:** the water there is now, `Block.Water`. The sea, lakes, and water you place. A source
  never goes away by itself.
- **Flowing water:** levels 7 down to 1, a block lower each step from the source it comes from.
  At level 1 it stops spreading.
  - Level 7 is 7/8 of a block deep, level 1 is 1/8. The surface steps down in eighths.
- **Falling water:** water with water above it, a full block deep. Where it lands it spreads as
  if from a source, so water poured off a cliff runs on at the bottom.
- **Every tick** (4 a second, `TUNING.water.tick`), each active block works out what it should
  be from its neighbours as they were at the start of the tick:
  - **Downwards first:** water over air or flowing water falls into it.
  - **Sideways** only when it can't go down. A level is one less than the highest level beside
    it, from a source, a falling block, or flowing water.
  - **Towards the nearest drop:** water spreading on flat ground goes only towards the nearest
    way down within 4 blocks, when there is one. So it runs off ledges rather than spreading
    evenly.
  - **Drying up:** flowing water with nothing feeding it any more drops a level each tick and is
    gone at 0.
  - **New sources (to agree):** an empty or flowing block between two sources, standing on
    something solid or on a source, becomes a source. A channel dug from a pond then fills up
    rather than staying a trickle.
- **All at once:** every change in a tick is worked out from the start-of-tick state, then
  applied together. So the result doesn't depend on the order blocks are visited, and is the same
  every time.
- **What water can go into:** air and passable blocks that aren't liquid. Torches are washed away
  (to agree).
- **Only what changed is looked at.** An active set holds the blocks next to each change.
  - An edit adds the block and its six neighbours.
  - A change made by the water adds its own neighbours for the next tick.
  - A settled pool costs nothing.
  - Unloaded chunks count as walls; their edge blocks wake up again when the chunk loads.
- **Budget:** at most `TUNING.water.maxPerTick` blocks a tick (4096 to start with). The rest wait
  for the next tick, so a flooded cave fills over a few seconds rather than in one long frame.

## Design

### 1. Blocks (`world/blocks.ts`)
- **New ids 27–34:** `WaterFlow1` to `WaterFlow7`, and `WaterFalling`.
  - Liquid, passable, transparent, untargetable, light cost 1, water's texture and sound.
  - Not in the picker, and a saved hotbar can't hold them (`pickable`), like the wall torches.
- **`liquidHeight`** per block: 1 for sources and falling water, level/8 for flowing.
- Saving needs nothing new: the levels are block ids, run-length encoded as before. Old worlds
  load unchanged.

### 2. The automaton (new `world/water.ts`, pure)
- **`WaterFlow`:** the active set (number-keyed, as `BlockCache`), `wake(x, y, z)`, and
  `tick(world, budget)` returning the changes `[x, y, z, block][]` without applying them.
- **Reads through a block cache;** the per-tick working arrays are reused, with no allocation
  per block.
- The nearest-drop search: a small breadth-first search over flat ground, at most 4 blocks, as
  Minecraft-like engines do (only for water spreading sideways).

### 3. Applying a tick (`world/world.ts`, `world/light.ts`)
- **`World.setBlocks(changes)`:** sets them all, then updates the light once for the whole batch.
  - `updateLight` today takes one block, and costs about 1 ms around a torch. A tick can change
    hundreds of blocks.
  - So the light update gets a batched form: the same BFS queues, seeded with every changed
    block at once.
  - It returns the stale chunks, each once.
- **Remeshing in the workers, not on the main thread.** An edit remeshes at once so it shows that
  frame. Water can wait a tick, so its chunks are remeshed the way a level-of-detail change is:
  a job each, the old mesh shown meanwhile, at most one in flight per chunk.

### 4. Meshing (`mesh/mesher.ts`, `mesh/lod.ts`)
- **The sea keeps its greedy mesh.** Sources and falling water against air and solids are as
  now.
- **Flowing water is meshed block by block,** the way torches are:
  - its top at its height, flat, with the water texture;
  - its sides wherever the neighbour isn't water;
  - against lower water, only the part above that water's surface.
- **Faces between two waters of different heights** are drawn only above the lower one, from
  either side. Sources next to flowing water do this too, so there's no hole and no doubled
  face.
- **Texture coordinates** follow the face's real height, so the texture doesn't stretch.
- **Far chunks** (`lod.ts`) keep water exact already. Flowing ids get the same treatment.
- The underwater view and the water's drift are unchanged.

### 5. Being in water (`world/physics.ts`, `player.ts`)
- **In water means below its surface:** a box is in water where it overlaps a liquid block below
  that block's `liquidHeight`. So a 1/8 puddle doesn't make you swim.
- **The underwater view** is shown when the eye is below the surface, not just inside the block.
- **The flow pushes (to agree):** flowing water pushes the player and mobs down its slope, from
  high levels to low, gently (`TUNING.water.push`).
- Mobs path and swim through flowing water as through the sea (they read `liquid`).

### 6. In the game (`game.ts`, `chunkLoader.ts`, `save/saver.ts`)
- **Edits wake the water:** every block broken or placed wakes it and its neighbours.
- **The water ticks** at its rate. Each tick's changes are applied with `setBlocks`, marked
  edited for saving, and remeshed in the workers.
- **Saved flowing water wakes on load:** a column read from the save is scanned for flowing ids,
  so water left mid-flow carries on.
- **`?stats`:** a water line with active blocks, changes in the last tick, and the tick's time
  (simulation, light).
- **Placing water:** the hotbar's water places a source, as now. Taking water away is as now:
  place a block in it and break the block.

## Files
- **Changed:**
  - `world/blocks.ts`: ids, `liquidHeight`;
  - `world/world.ts`: `setBlocks`;
  - `world/light.ts`: batched update;
  - `world/physics.ts`: in water by height, the push;
  - `mesh/mesher.ts`, `mesh/lod.ts`;
  - `chunkLoader.ts`: remesh in a worker;
  - `save/saver.ts`;
  - `game.ts`, `player.ts`;
  - `stats.ts`;
  - `config.ts`: `TUNING.water`;
  - CLAUDE.md.
- **New:**
  - `world/water.ts`;
  - tests;
  - bench cases.

## Tests (headless)
- **Flow:**
  - A source on a flat floor spreads to a diamond of levels 7 down to 1 and stops.
  - Over an edge it falls, and spreads again at the bottom.
  - Towards the nearest drop: on a floor with a hole 3 blocks to one side, it runs that way only.
  - Cut the source off and the flowing water drains away completely.
  - New sources between two sources (if agreed).
  - It doesn't go through solid blocks, and washes torches away.
  - The same result in any visiting order, and from any split of the work across ticks with a
    small budget.
- **Light:**
  - The batched update gives the same light as updating one block at a time.
  - It matches the whole-area reference, as the light tests do now.
- **Meshing:**
  - The top of flowing water is at its height.
  - No face between equal waters.
  - Against lower water only the part above it, from either side, with no hole (a sealed-volume
    check, as for glass).
  - Faces stay counter-clockwise.
  - Far chunks keep flowing water.
- **Physics:**
  - Not swimming in a 1/8 puddle, swimming in level 7.
  - The eye under water only below the surface.
  - The push goes downhill.
- **Saving:** a world saved mid-flow carries on flowing after loading.

## Measuring
- **`npm run bench`,** headless:
  - a source on open ground until it settles;
  - the sea let into a big cave, until it settles.
- **For each,** the ticks it takes, and per tick:
  - median and worst time for the simulation and for the light;
  - blocks changed;
  - chunks made stale.
- **In Chrome on your laptop,** radius 8:
  - flooding a cave from the sea, with `?stats` frame times and the water line;
  - the mountain probe and `?autofly` as before, to show water costs nothing when it's still.
- **Target:** a busy tick costs under 4 ms of main thread, spread over frames if needed; no frame
  over 20 ms while a cave floods.

## Steps (each built, tested, measured, committed and pushed)
1. **Blocks and physics:** the flowing ids, heights, in water by height, the underwater view.
2. **The automaton,** headless (`world/water.ts`), with tests and bench timings.
3. **Batched light** and `World.setBlocks`, tested against one-at-a-time and the reference.
4. **Meshing** flowing water, near and far, with tests.
5. **In the game:**
   - edits waking water;
   - ticks applied;
   - remeshing in workers;
   - saving and waking on load;
   - `?stats`;
   - measured flooding a cave.
6. **The push along the flow;** measurements, notes and playtest questions.

## Decisions to agree
- **New sources** from two sources side by side: yes (channels and pools fill), or no (only
  placed water is ever a source)?
- **Towards the nearest drop** (runs off ledges), or spreading evenly in all directions?
- **Flat steps** in eighths (blocky, as the rest of the world), or a sloped surface between
  levels? Slopes look smoother but can't merge and need corner heights; I'd keep steps.
- **The push** along the flow for the player and mobs: yes or no?
- **Torches washed away** by water: yes (gone, as there are no drops), or water stops at them?
- **Speed:** 4 ticks a second (a block of spread every quarter second)?

## Step 1: the blocks, and being in water by its depth — built (2026-11-01)

**What changed:**
- **Eight new block ids** (`world/blocks.ts`):
  - `WaterFlow1` to `WaterFlow7` (27–33) and `WaterFalling` (34), copies of water: liquid,
    passable, transparent, light cost 1, its texture and sound.
  - Not in the picker, and a saved hotbar can't hold them.
  - Nothing makes them yet; the flow (step 2) will.
- **`liquidHeight`:** how deep the water in a block is. 1 for sources and falling water, level/8
  for flowing water, 0 for everything else.
- **Being in water** (`world/physics.ts`):
  - A full block of water counts as soon as the box overlaps it, as before, so the sea and
    swimming are unchanged.
  - Shallower flowing water counts only when its surface is more than 0.3 of the body's height
    over the feet (`TUNING.player.swim.wade`).
  - So the player wades through levels 1–4 at walking speed and swims from level 5. A hopper (half
    a block tall) swims from level 2.
- **`underLiquid`:** a point is in water only below the surface. The player's eye uses it for the
  underwater view, and mobs use it for keeping their heads up.

Nothing shows in the game yet, so there was nothing to look at in a browser.

**Tests (2 new, 264 in all):**
- A body wades an eighth of water at the same speed as on dry ground, and swims in seven eighths.
- A hopper-sized body swims in three eighths where the player wades.
- A source is water at any depth.
- The eye is under a half-deep flowing block only below its surface, and under a source all the
  way up.
- The picker doesn't offer moving water.

## Step 2: the flow, headless — built (2026-11-01)

**What changed:**
- **`world/water.ts`, `WaterFlow`:** the rules as planned.
  - **Falling:** water above a block makes it falling water.
  - **New sources:** a block between two sources, on solid ground or a source, becomes a source.
  - **Spreading:** otherwise a block takes one less than the highest water spreading into it from
    the side. A source or falling water spreads at 7, flowing water at its own level less one.
    With nothing spreading into it, it is dry.
  - **Water spreads sideways only standing on something solid.** Over air or other water it falls,
    or rests on the water: a waterfall into the sea doesn't spread over the surface.
  - **Towards the nearest drop:** where water can go, a breadth-first search up to 4 blocks
    (`TUNING.water.dropSearch`) finds the nearest place to fall, and it goes only the ways that
    reach it soonest; with none, every way.
- **A tick reads the world as it was at the start and returns its changes,** so the order doesn't
  matter. Blocks read, columns loaded and each spreading block's ways are cached for the tick. The
  drop search uses a reused grid and queue, so it allocates nothing.
- **Only woken blocks are looked at,** oldest first, at most 4,096 a tick
  (`TUNING.water.maxPerTick`). A change wakes its six neighbours for the next tick.
- **Unloaded land is a wall.**
- **What water can go into:** air and torches; torches are washed away. Nothing else passable and
  dry exists yet.
- `TUNING.water.tickSeconds` (0.25) is for step 5, when the game ticks it.

**Bench** (`npm run bench`, the `water` case, Node under Vitest), ticked until settled:

| | ticks | changes | most a tick | simulation ms a tick, median / max | one `setBlock` at a time, median / max |
| --- | --- | --- | --- | --- | --- |
| A source on grass near the spawn (it runs downhill a long way) | 134 | 506 | 14 | 0.032 / 0.39 | 0.01 / 0.65 |
| The sea into a small cave down a shaft | 53 | 237 | 11 | 0.075 / 0.34 | 0.03 / 0.33 |
| A 32 × 32 room under the sea, its ceiling opened at once | 23 | 13,601 | 1,037 | 1.6 / 3.2 | 9.3 / 16.4 |

- The last is the worst case: a thousand columns pouring in together. The simulation stays inside
  the plan's 4 ms a tick.
- Making its changes one block at a time, each with its own light update, costs up to 16 ms. Step 3
  batches them.

**Tests (8 new, 272 in all), in a small grid world:**
- **On flat ground:** a source makes a diamond of levels 7 down to 1, exactly, and nothing above or
  below.
- **On a ledge:** water goes towards the edge only, falls in a column at level 5 over the edge, and
  spreads again at 7 at the bottom, away from the cliff.
- **Draining:** taking the source away dries everything.
- **New sources:** a gap between two sources in a trench becomes a source; over a hole it doesn't,
  and falls instead.
- Water stops at a wall, and washes a torch away.
- Unloaded land stops it.
- A pool of sources, woken, makes no change.
- **Splitting the work:** a flow down steps and round pillars ends the same with 5 blocks a tick as
  with no limit.

## Step 3: setting many blocks with one light update — built (2026-11-01)

**What changed:**
- **`updateLightAt(world, at)`** (`world/light.ts`) takes any number of changed blocks.
  - For each kind of light, it takes the light away from all of them in one pass of the removal
    queue, then lets it back in from all of them in one pass of the spreading queue.
  - It uses the same queues and rules as before. `updateLight` for one block is now
    `updateLightAt` with one.
- **`World.setBlocks(changes)`:** sets them all, then one light update. Returns the chunks to
  remesh, each once, and the light's time in `lightMs` as `setBlock` does.

**Bench** (`npm run bench`, `water`), each case on a fresh world both ways (ms a tick, Node under
Vitest):

| | most changes a tick | one `setBlock` each: median / max (light max) | `setBlocks`: median / max (light max) |
| --- | --- | --- | --- |
| A source on grass | 14 | 0.02 / 0.61 (0.60) | 0.01 / 0.20 (0.20) |
| The sea into a small cave | 11 | 0.04 / 0.22 (0.20) | 0.02 / 0.07 (0.07) |
| A 32 × 32 room opened under the sea | 1,037 | 9.5 / 16.3 (16.0) | 2.5 / 6.8 (6.0) |

- **The worst tick drops from 16.3 to 6.8 ms.** Together with its simulation (up to 2.9 ms), that
  is still about 10 ms for a thousand blocks changing at once, before remeshing.
- **That's over the plan's 4 ms a tick.** It needs measuring in Chrome (usually faster than Node
  under Vitest) in step 5. If it's still over, a tick's changes can be made over several frames,
  or the per-tick limit lowered. Ordinary flows are far inside it: under 0.5 ms a tick for
  everything.

**Tests (1 new, 273 in all):**
- Six batches of 40–200 changes in a clump (stone, air, torches, lamps, glass, sources, flowing and
  falling water) across chunk borders, on the cave-mouth region of the light tests.
- After each batch, the blocks and light are the same as setting them one at a time, and as
  lighting the whole area at once.
- The chunks reported stale are exactly those with a changed block or light within their padded
  area, each once.
- The existing light tests pass unchanged through the new path.

## Step 4: meshing flowing water — built (2026-11-01)

**What changed** (`mesh/mesher.ts`):
- **Depth:** water is a full block when there is water above it, otherwise its own depth
  (`liquidHeight`).
- **Full water** (sources, falling water, anything with water above) is meshed by the greedy
  mesher as before, but never against other water. Before, a source and falling water side by
  side would have drawn a face between them, being different ids.
- **Flowing water short of a full block** is meshed block by block, after the greedy pass, in the
  transparent pass:
  - **its top** at its depth, always: it's below the block's top, so it shows from the side even
    under a solid block;
  - **its bottom** over anything but solid blocks and water;
  - **each side** from the neighbour's water surface (0 if the neighbour isn't water) up to its
    own, where the neighbour isn't solid and is shallower.
- **Where full water meets shallower water,** its side shows just above the other's surface.
  - Each face between two waters is drawn once, from the deeper side, and only above the
    shallower. So there's no hole and no doubled face.
- **Texture coordinates follow the real height.** `uvl`'s spare fourth byte now carries eighths
  of a block added to v, read by the chunk shader. A side 3/8 deep shows 3/8 of the texture,
  not a squashed whole.
  - The builder writes that byte for every vertex (0 for everything else), since its arrays are
    reused.
- **Far chunks** (`mesh/lod.ts`) keep flowing water as it is, like other blocks that aren't solid.
  A cell whose solid blocks are taken out is filled with water if it has a source or falling water
  in it. Flowing water doesn't fill, so a stream doesn't turn the ground under it into a ditch of
  water far off.
- **The greedy-against-culled test's random soup** leaves out moving water: the culled oracle draws
  one whole quad per face and can't draw a side ending part way up. Moving water has its own tests.

**Looked at in Chrome:** the world draws as before (grass, sand, sea, trees, the shader's new v
term), with no console errors. There's no flowing water in the game to see until step 5.

**Bench:** greedy meshing of the 724 spawn chunks, the new mesher against the old, alternating:
1.91 and 1.44 ms a chunk against 1.69 and 1.81. No difference beyond noise, and the same 1,932k
triangles. Generated land has no flowing water, so only the extra liquid checks cost anything.
(The machine was slower than this morning for everything, generation included: 3.2–3.4 ms a
column against 2.1.)

**Tests (7 new, 280 in all):**
- Flowing water at half depth on stone: a top at half a block, four sides half a block tall
  showing half the texture, nothing towards the stone.
- Six eighths beside three: one strip on the deeper side from 3/8 to 6/8, nothing from the
  shallower side, 9 faces in all.
- A source beside two eighths: a strip from 2/8 to the top, from the source only.
- Flowing water under falling water is a full block: full-height sides, no face between them.
- Nothing between a source and falling water side by side.
- **A stream of every depth** from a source:
  - every face points out of the water it belongs to;
  - an eighth-high step between each pair of flowing blocks.
- **Far chunks** keep flowing and falling water through coarsening, and mesh the flowing top at its
  depth.

## Step 5: water in the game — built (2026-11-01)

**What changed:**
- **Edits wake the water** round them (`game.ts`, `edit`): breaking or placing next to water lets it
  flow, and placing water (the hotbar's 9) puts down a source that spreads.
- **A tick every 0.25 s,** reading blocks through a `BlockCache`:
  - Its changes are made with `World.setBlocks` on the next frame, so a busy tick's two halves,
    working out the changes and then the blocks and light, fall on different frames. They're made
    long before the next tick, as the flow needs. Nothing flows while paused.
  - Each changed chunk is marked edited for saving.
  - The stale chunks' columns are remeshed in the workers like any other changed chunk
    (`ChunkLoader.remeshSoon`), the old meshes shown meanwhile. Edits still remesh at once on the
    main thread.
- **Waking on load** (`wakeColumn`, called from `ChunkLoader.onColumnAdded`):
  - A column read from the save wakes its moving water, so water saved mid-flow carries on.
  - Every column that loads wakes the moving water on the faces of the loaded columns beside it,
    which it held back while unloaded.
  - On generated land there is none, and the look costs 0.1 ms a column (bench).
- **`?stats`** has a water line: blocks woken, the last tick's changes and the time of each half,
  and the slowest half since the last read.
- **`?flood`** (`src/flood.ts`), the worst case for measuring:
  - a room 32 × 32 and 6 high is carved under the nearest open sea;
  - two seconds later its ceiling (about 7,000 blocks) is taken away at once;
  - 10 s of frames and ticks are reported.
  - Taking the ceiling away costs 46–53 ms in one frame (no player can do that), timed on its own
    and not counted.
- **The per-tick limit is down from 4,096 woken blocks to 1,024** (`TUNING.water.maxPerTick`).
  - At 4,096 the worst tick in Chrome took 5.9 ms to work out and 7.7 ms to make, and the flood
    had a 33 ms frame.
  - Splitting the work across ticks ends the same (step 2's test). A flood that big now takes about
    40 ticks (10 s) rather than 23. Ordinary flows never reach the limit.

**Looked at in Chrome:**
- Water placed on the grass by the spawn (the hotbar's 9, right click): a full-height source, with
  falling water under it where it stood over a dip.
- Streams step down in eighths towards the nearest drops, each step with its strip of side.
- 101 fps while it flowed. No console errors.

**Measured** in Chrome on your laptop, radius 8, 2560 × 1201. `?flood`, 10 s from the opening,
mobs off:

| | frames | over 20 ms | over 33 ms | slowest frame | slowest tick: working out / making changes |
| --- | --- | --- | --- | --- | --- |
| 4,096 a tick, both halves in one frame | 1,197 | 1 | 0 | 33.2 ms | 5.9 / 7.7 ms |
| 1,024 a tick, both halves in one frame (2 runs) | 1,084, 1,089 | 1, 1 | 0, 0 | 25.0, 24.8 ms | 4.9 / 6.0, 3.4 / 3.8 ms |
| 1,024 a tick, halves on separate frames (4 runs) | 1,097, 1,194, 1,190, 1,192 | 1, 0, 0, 0 | 0 | 24.8, 9.7, 16.9, 16.7 ms | 3.0–3.5 / 4.3–6.7 ms |

- **The flood:** 38 ticks, 10,212 changes in the 10 s.
- **Against the plan's 4 ms a tick:** working the changes out is under it (3.0–3.5 ms). Making
  them, mostly light, is over it at 4.3–6.7 ms, but on a frame of its own. Frames stayed under
  20 ms in three of four runs, and the fourth had one at 24.8 ms.
- **`?autofly=20` at radius 8 with mobs and still water:** 1,844 frames, 5 over 20 ms, none over 33,
  no holes. That's the laptop back at its Milestone 6 speed: the slow flights in Milestone 7 step
  6 were the machine.

**Tests (2 new, 282 in all):**
- Water saved after three ticks and loaded into a fresh world, its columns woken, ends exactly as
  the uninterrupted flow does.
- Water held back by an unloaded column flows on into it once it loads and wakes.

## Step 6: the current, and the end of the milestone (2026-11-01)

**What changed:**
- **`currentAt`** (`world/physics.ts`): which way the water a body is in flows, as a horizontal
  unit vector.
  - Each water block the body reaches below the surface of pushes towards each neighbour by how
    much shallower that is: other water by the difference in depth, an open block over a drop by
    its whole depth.
  - The sum is made unit length, so a stream pushes the same whatever its slope.
  - Sources among sources (the sea, lakes) don't push.
- **The current** (`TUNING.water.push`, 1.4 blocks a second) is added to the velocity the player
  heads for, walking, wading or swimming, and to a mob's. Not when flying.
  - Standing in a stream, you're carried along. Walking against it, you're slower.
- **Cost:** 2.24–2.28 µs a physics step against 1.27–1.44 before (bench, alternating). The
  overlapped blocks are read again, and their neighbours where there's water. 0.009 ms a frame for
  the player.

**Felt in Chrome:**
- Water placed on the grass by the spawn, then walked into for a second.
- With nothing held, the player kept moving down the stream, about 2.5 blocks across x and 3.6
  across z in 3 s: roughly the 1.4 blocks a second of the push.

**Tests (3 new, 285 in all):**
- In a stream of levels 7 to 1 the current points downstream; in still water and on dry land
  there's none.
- A player standing in it is carried at least 0.3 blocks in half a second, and not sideways.
- Walking up it is slower than on dry ground. In still water nothing moves.
- A mob is carried too.

## The milestone, measured

- **The worst case,** `?flood` (a 32 × 32 room opened under the sea at once), in Chrome on your
  laptop at radius 8: 1, 0, 0 and 0 frames over 20 ms in four 10 s runs, none over 33. Each half
  of the slowest tick: 3.0–3.5 ms working the changes out, 4.3–6.7 ms making them, on separate
  frames (step 5).
- **Ordinary flows** cost under 0.5 ms a tick (bench, step 3).
- **Still water costs nothing:** with nothing woken there is no tick. Each column that loads costs
  0.1 ms to look for held-back water.
  - `?autofly=20` at radius 8 with mobs: 1,844 frames, 5 over 20 ms, none over 33, no holes, as at
    the end of Milestone 6 (step 5).
  - The mountain probe wasn't run again. Nothing in this milestone draws anything new where there's
    no moving water (the shader's one new term only reads a byte), and the Chrome window was a
    different size today, so its numbers wouldn't compare.
- **Against the plan's targets:**
  - **No frame over 20 ms while a cave floods:** met in three runs of four, with a 24.8 ms frame in
    the other.
  - **A busy tick under 4 ms:** working it out is; making the changes (mostly light) is 4.3–6.7 ms,
    on a frame of its own.

**Known limits:**
- **A thousand blocks set in one frame** (only `?flood` does it, by opening its whole ceiling at
  once) takes about 50 ms, mostly light.
- **Mesh results can be dropped:** a chunk whose water changes every tick gets a new version each
  quarter second. A worker's mesh made from an older version is dropped when it arrives, so in a
  long busy flow a chunk's picture can lag until the flow there settles. Not seen in the flood
  runs.
- **Waking is local:** a change wakes only its six neighbours. Water already settled several
  blocks away doesn't change course when a new drop opens near it, until something next to it
  changes.
- **No buckets:** taking water away is placing a block in it and breaking the block. A source
  can't be picked up.

## Playtest questions

1. **Placing water** (the hotbar's 9) on flat ground, on a slope and at a cliff edge: does it
   spread, run off edges and fall the way you'd expect? Is a quarter second a step the right
   speed?
2. **Digging into a lake or the sea** from the side, and from below:
   - Does it pour in?
   - Do channels dug from a pond fill up (the new-source rule)?
   - Does a hole dug down through the seabed fill?
3. **Blocking and draining:** put a block on a source. Does the stream drain away tidily, a level
   at a time?
4. **Looks:** do the steps of eighths look right next to each other, and next to the sea and
   falling water? Any holes, flickering or doubled faces where depths meet, near or far?
5. **Being in it:**
   - Wading through shallow water and swimming from five eighths: does that feel right?
   - Is the current (1.4 blocks a second) too strong or too weak?
   - Does the underwater view come on at the right moment?
6. **Torches:** water washes them away. Is that what you want?
7. **Saving:** leave a world while water is still flowing and come back. Does it carry on?
8. **Mobs:** do they cope with streams (swimming, being carried, getting out)?
