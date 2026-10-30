# Milestone 7: mobs

**Plan approved (2026-10-29)** as proposed: the four animals, all passive, not saved, three hits and
they're gone with no drops, up to 24 around you.

**Goal.** Simple invented animals that make the world feel alive:
- they appear on the land around you, each kind in its own biome;
- they wander and graze, and find their way over the blocks with A*: around walls, up
  one-block steps, down small drops, not into the sea;
- they run from you when you hit them.

The game stays inside its budget: 120 fps at view distance 8 with antialiasing off (Milestone
6), and no frame over 20 ms flying at radius 8.

## The animals (invented; looks and names to agree)

All four are blocky box models built in code, with textures drawn in the style of the block
textures.

| Kind | Biome | Size (w × h) | Moves | Notes |
| --- | --- | --- | --- | --- |
| **Mossback** | forest, plains | 0.9 × 1.0 | walks, steps up 1 | slow grazer with a mossy back, four legs |
| **Hopper** | plains | 0.5 × 0.5 | hops, steps up 1 | small and quick, long ears, jumps everywhere |
| **Crag goat** | snowy mountains | 0.7 × 1.1 | walks, climbs 2 | sure-footed, drops further without minding |
| **Dune beetle** | desert | 0.8 × 0.4 | scuttles, steps up 1 | low and wide, six short legs |

All are passive: none attacks.

## Design

### 1. Physics for any size (`world/physics.ts`)
- `Body` gets its own `halfWidth` and `height` (the player's 0.3 and 1.8 by default). Collision,
  ground and water checks read them instead of the constants.
- `stepMob` reuses the same sweep and gravity: walking towards a target velocity, jumping when
  asked, falling, sinking slowly in water.
- **Mobs don't collide with each other or with you as solid boxes** (no physics engine).
  Overlapping mobs are nudged apart a little each step, and you push them aside as you walk
  through.

### 2. Paths: A* on the block grid (new `mobs/pathfind.ts`, pure)
- **Nodes** are block positions a mob can stand at: a solid block under it, and room above it
  for its height (one column wide; the wider ones still fit through one-block gaps, nudged
  back to the middle).
- **Moves:**
  - 8 directions, diagonals only with both sides open (no cutting corners);
  - up by the kind's step (1, or 2 for the crag goat);
  - down by up to its drop (3, or 5);
  - swimming across water only if no dry way is found (cost ×4), and never deep under.
- **Costs and limits:** cost = distance, plus a little for climbing. The heuristic is the
  octile distance. A search stops after a node limit (2,000) and a range (24 blocks), so a
  mob with no way somewhere gives up quickly.
- **Per-frame budget:** a mob asks for a path and waits its turn. At most a few searches run a
  frame, within `TUNING.mobs.pathBudgetMs`.
- Reads blocks through `World.getBlock`, so unloaded chunks count as air: no paths into them.

### 3. Behaviour (new `mobs/brain.ts`, pure)
- **A small state machine per mob:**
  - **idle**: stand, graze, look about;
  - **wander**: pick a random spot 4–12 blocks away that a path reaches, walk there;
  - **flee**: after a hit, a path away from you, at a run, for a few seconds;
  - **rest**: at night, lie down and stay put.
- **Following a path:** steer towards the next waypoint, and jump when the next one is higher.
  If it's stuck for half a second (a block placed in the way), it asks for a new path. If it
  falls somewhere unexpected, it starts again.
- **Randomness** from a seeded RNG per mob (`math.ts`), so tests replay exactly. Mobs aren't
  world data, so a run doesn't have to repeat in-game.

### 4. Where they come from (new `mobs/mobs.ts`, `MobManager`)
- **Spawning:**
  - a few times a second, try a random column 24–64 blocks from you, in loaded chunks;
  - on its top block, if the column's biome has a kind, the block suits it (grass, sand,
    snow) and it's open to the sky;
  - never in water or within 24 blocks of you.
  - A kind comes in small groups (2–4 mossbacks, 1–3 of the others).
- **Despawning:** beyond 96 blocks, or when its chunk unloads.
- **How many:** at most `TUNING.mobs.max` (24) around you; `?mobs=0` turns them off and
  `?mobs=40` sets a cap, for measuring.
- **Not saved** (decision below): they appear again around you when you come back.

### 5. Drawing (new `render/mobRenderer.ts`)
- **Models:** each kind is a few boxes (body, head, legs, ears or shell) with pivots.
- **Instancing:** one `InstancedMesh` per box of each kind, every mob of the kind an instance:
  about 20 draw calls at most, however many mobs. Matrices are written each frame from the
  mob's position, facing and pose.
- **Animation** (pure, tested): legs swing with distance walked, the head bobs and dips to
  graze, hoppers squash on landing, resting mobs lie down.
- **Light:** each mob is lit by the world's light at its position and the day's sunlight, as
  the particles are. Fogged like the world.
- **Textures:** a few new 16 × 16 layers in the block texture array (`world/textures.ts`), so
  the same shader draws them.

### 6. Hitting them, and their sounds
- **Hitting:** the left button hits the mob under the crosshair, when one is nearer than the
  block there. It's a ray against the mobs' boxes, within reach.
  - A hit: knockback, a red flash, a hurt sound, then it flees.
  - Three hits and it's gone in a puff of particles. Creative mode: no drops, no health bar.
- **Sounds,** synthesised as the others are (`audio/sound.ts`): an occasional call per kind
  (low for the mossback, chirps for the hopper and beetle, a bleat for the goat), a hurt sound,
  and hopper landings. Quieter with distance.

### 7. `?stats`
A line for the mobs: how many of each kind, paths asked and found a second, and their main
thread time (AI, paths, physics, drawing).

## Files
- **Changed:**
  - `world/physics.ts`: body size;
  - `config.ts`: `TUNING.mobs`;
  - `world/textures.ts`: mob layers;
  - `audio/sound.ts`, `audio/cues.ts`: mob sounds;
  - `game.ts`: manager, hits, frame loop;
  - `stats.ts`;
  - CLAUDE.md.
- **New:**
  - `mobs/kinds.ts`: the four kinds' sizes, speeds, steps, biomes and models;
  - `mobs/pathfind.ts`;
  - `mobs/brain.ts`;
  - `mobs/mobs.ts`: spawning and the per-frame budget;
  - `render/mobRenderer.ts`;
  - `mobs/pose.ts`: animation, pure.

## Tests (headless)
- **Physics:**
  - the player's tests unchanged;
  - a small box fits through a gap the player doesn't, and a wide one stops where the player
    would pass.
- **Paths:**
  - a straight line on flat ground;
  - round a wall;
  - up a one-block step but not two, except the goat;
  - down a drop within the limit but not a cliff;
  - no corner cutting;
  - round a lake rather than through it, and across it when there's no other way;
  - no path gives up within the node limit;
  - the same result every time.
- **Behaviour,** in a small test world, stepped like the game:
  - a wandering mob reaches its spot;
  - one blocked by a new wall finds another way;
  - a hit one ends up further from you;
  - resting mobs stay put at night.
- **Spawning:**
  - only on the kind's blocks in its biome, open to the sky;
  - never near you or in water;
  - the cap holds;
  - despawning beyond the distance and with the chunk.
- **Hitting:** the ray finds the nearest mob in front within reach, misses behind a block, and
  three hits remove it.
- **Poses:** legs swing with distance and are still when standing; resting lies down.

## Measuring
- `npm run bench`: path search time (median, worst) on a fixed set of searches over generated
  terrain: plains, forest, mountains.
- **The mountain probe** and `?autofly` at radius 8 and 16, with and without mobs
  (`?mobs=0`):
  - fps, main thread and GPU;
  - mob time per frame;
  - holes.
- **Target:** mobs cost under 1 ms of main thread a frame at the cap, and don't move the fps.

## Steps (each built, tested, measured, committed and pushed)
1. Body sizes in the physics, and the A* pathfinder, with tests and bench timings.
2. The kinds and their behaviour: wandering, following paths, jumping, getting unstuck. Tested
   in a headless world.
3. Spawning and despawning in the game; drawing with instanced box models and light;
   `?mobs` and `?stats`.
4. The four models, their textures and animation.
5. Hitting, fleeing and the puff; mob sounds.
6. Measurements, notes and playtest questions.

## Decisions (approved)
- **The animals:** the four above, one or two per biome, all passive. Different ones, or
  hostile ones at night, can come later.
- **Not saved:** mobs live around you and appear again when you return. Saving them means
  storing them with their chunks; it's doable later.
- **Hitting:** three hits and they're gone, no drops (creative mode). Or should hitting only
  scare them away?
- **How many:** up to 24 around you.

## Step 1: bodies of any size, and the pathfinder — built (2026-10-29)

**What changed:**
- **`world/physics.ts`:** a `Body` has its own `halfWidth` and `height` (`createBody` defaults
  to the player's 0.3 and 1.8). Collision, ground, water and placing checks read them instead
  of the constants. The player is unchanged: all its tests pass as before.
- **`mobs/pathfind.ts`, `findPath`:** A* over standing places, as planned.
  - **Moves:** 8 directions with no corner cutting. A step lands on the highest place within
    the climb (`step`) and drop (`drop`), with head room to jump up or an open column to fall
    down. Swimming at the surface only when allowed, at 4× the cost.
  - **Limits:** the search stops at `maxNodes` places or `range` blocks (at most 24).
  - **"Near" goals** (arrive within so many blocks), for fleeing and wandering.
- **Speed:**
  - Costs, links and open/closed marks are typed arrays covering the whole range box,
    reused from search to search (a stamp per search). The open list is a binary heap of
    node indices. Block flags are local arrays.
  - **`mobs/blockCache.ts`:** blocks for a search through number-keyed chunks, remembering
    the last one. `World.getBlock` builds a string key per read, and a search reads
    thousands.
  - Together that halved the time of the longest searches.

**Bench** (`npm run bench`, `mob paths`): 300 searches each between dry places 4–16 blocks
apart, at the spawn (plains, forest, the shore) and over the mountains (seed 20261022 at
(-368, 400)). Under Vitest, which is slower in hot loops than the browser.

| | found | ms median | p95 | max | places looked at, median / max |
| --- | --- | --- | --- | --- | --- |
| Spawn, mossback (steps 1, drops 3) | 97 % | 0.07 | 0.51 | 13.9 | 22 / 2000 |
| Spawn, mossback, 500 places | 97 % | 0.06 | 0.30 | 3.3 | 20 / 500 |
| Spawn, crag goat (steps 2, drops 5) | 96 % | 0.08 | 0.78 | 12.2 | 20 / 2000 |
| Mountains, mossback | 83 % | 0.25 | 6.5 | 9.3 | 76 / 2000 |
| Mountains, mossback, 500 places | 68 % | 0.22 | 2.0 | 3.8 | 57 / 500 |
| Mountains, crag goat | 96 % | 0.23 | 4.1 | 15.3 | 43 / 2000 |

- **A found path is cheap** (tenths of a millisecond). **Failing ones cost the most:** they
  look at every place they may before giving up, about 5 µs each here.
- **For step 2:**
  - Each kind gets its own limit: 500 places for the lowland kinds (nothing lost at the spawn,
    the worst at 3.3 ms), more for the goat in its mountains.
  - Searches take turns, at most one long one a frame.
  - The first version, with Maps and `World.getBlock`, took up to 21 ms. A bench mistake was
    fixed on the way: "surface" went down through the sea, so most spawn searches began on the
    seabed.

**Tests (11 new, 232 in all):**
- **Physics:** a half-block mob goes into a one-block tunnel the player stops at, and one
  wider than the tunnel stops at its mouth. Short bodies stand, fall and land, and bump a low
  ceiling, by their own height.
- **Paths:**
  - straight and diagonal on flat ground;
  - round a wall, with no corner cut;
  - a two-block step only for the goat, a one-block one for anyone, and no step without head
    room;
  - a drop within the limit but not off a cliff;
  - round a pond rather than through it, and across a river only when allowed;
  - giving up within the node limit and the range, and arriving next to a goal when asked;
  - a tall mob kept out of a tunnel a short one takes;
  - the same path every time.

## Step 2: the kinds and their behaviour — built (2026-10-30)

Headless only for now: the mobs exist in code and tests, not yet in the game (step 3).

**What changed:**
- **`mobs/kinds.ts`:** the four kinds as planned.

  | Kind | Size (half-width × height) | Speed: walk / run | Climbs / drops |
  | --- | --- | --- | --- |
  | Mossback | 0.45 × 1.0 | 1.6 / 4.2 | 1 / 3, swims |
  | Hopper | 0.25 × 0.5 | 2.4 / 5.5, hopping | 1 / 3 |
  | Crag goat | 0.35 × 1.1 | 2.0 / 4.8 | 2 (jumps 2.25) / 5 |
  | Dune beetle | 0.4 × 0.4 | 1.8 / 4.0 | 1 / 3 |

  Each kind also has its biomes, the blocks it appears on and its group size. Path limits
  follow step 1's bench: 500 places for the lowland kinds, 1,200 for the goat.
- **`TUNING.mobs`:** step, cap, accelerations, water, turning, idle and wander ranges,
  fleeing, getting stuck, arriving, and when to rest and wake.
- **`stepMob` in `world/physics.ts`:** the player's collision and gravity with a mob's own
  acceleration. It jumps when asked, rises to the surface in water and bobs there with its head
  out, and climbs out of water against a bank.
- **`mobs/brain.ts`:** a mob is a small state machine, stepped with its body.
  - **idle**: grazes for 2–7 s, then picks a place 4–12 blocks off. It wanders there if a path
    reaches it, or tries another place soon.
  - **wander**: walks the path. It steers at each waypoint's middle, jumps when the next one is
    higher, and hoppers hop all the way.
  - **flee**: after a hit it's knocked back and up, then runs from where the hit came from for
    4 s. It runs straight if no path is found.
  - **rest**: when daylight drops below 0.3 it stays put until it's back above 0.4.
  - **Stuck** (no closer to its waypoint for 0.6 s): it asks for a new way to the same place,
    or gives up and idles.
- **Randomness and paths:** each mob has its own seeded RNG, and asks for paths through a
  `MobContext`, which may answer "not this frame". `directContext` searches at once, for tests.

**Bench** (`npm run bench`, `mobs`): 24 mobs (mossbacks and hoppers) on the land round the
spawn for 60 s.
- **Each frame** they think, find paths and move: two steps of 1/120 s, blocks read through a
  fresh `BlockCache`, as the game will.
- **Main thread for all 24:** median **0.026 ms** a frame, p95 0.067 ms, worst **1.15 ms**
  (a long path search in that frame).
- **Over the minute:** 168 path searches, and 1,320 blocks walked between them.
- Well inside the plan's 1 ms. The worst frames are searches, which step 3 spreads out with a
  per-frame budget.

**Tests (9 new, 241 in all):**
- A mob wanders to a place it found a way to and idles again, 3–13 blocks off, never in the
  floor.
- It jumps up a step on the way.
- When a wall too tall to climb goes up across its path, it finds another way and arrives.
- A hit sends it fleeing, over 5 blocks further from where it came from before it calms down.
- At night it rests and doesn't move, and wakes in the morning.
- A crag goat climbs two blocks and a mossback won't even find the way.
- Hoppers hop: more than three jumps on an 8-block walk.
- In a pool three deep, a mossback keeps its head above the water.
- The same seed gives the same walk, step by step, over 30 s.
