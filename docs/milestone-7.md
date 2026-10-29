`# Milestone 7: mobs — plan (for your approval)
`
`**Goal.** Simple invented animals that make the world feel alive:
`- they appear on the land around you, each kind in its own biome;
`- they wander and graze, and find their way over the blocks with A*: around walls, up
`  one-block steps, down small drops, not into the sea;
`- they run from you when you hit them.
`
`The game stays inside its budget: 120 fps at view distance 8 with antialiasing off (Milestone
`6), and no frame over 20 ms flying at radius 8.
`
`## The animals (invented; looks and names to agree)
`
`All four are blocky box models built in code, with textures drawn in the style of the block
`textures.
`
`| Kind | Biome | Size (w × h) | Moves | Notes |
`| --- | --- | --- | --- | --- |
`| **Mossback** | forest, plains | 0.9 × 1.0 | walks, steps up 1 | slow grazer with a mossy back, four legs |
`| **Hopper** | plains | 0.5 × 0.5 | hops, steps up 1 | small and quick, long ears, jumps everywhere |
`| **Crag goat** | snowy mountains | 0.7 × 1.1 | walks, climbs 2 | sure-footed, drops further without minding |
`| **Dune beetle** | desert | 0.8 × 0.4 | scuttles, steps up 1 | low and wide, six short legs |
`
`All are passive: none attacks.
`
`## Design
`
`### 1. Physics for any size (`world/physics.ts`)
`- \`Body\` gets its own \`halfWidth\` and \`height\` (the player's 0.3 and 1.8 by default). Collision,
`  ground and water checks read them instead of the constants.
`- \`stepMob\` reuses the same sweep and gravity: walking towards a target velocity, jumping when
`  asked, falling, sinking slowly in water.
`- **Mobs don't collide with each other or with you as solid boxes** (no physics engine).
`  Overlapping mobs are nudged apart a little each step, and you push them aside as you walk
`  through.
`
`### 2. Paths: A* on the block grid (new \`mobs/pathfind.ts\`, pure)
`- **Nodes** are block positions a mob can stand at: a solid block under it, and room above it
`  for its height (one column wide; the wider ones still fit through one-block gaps, nudged
`  back to the middle).
`- **Moves:**
`  - 8 directions, diagonals only with both sides open (no cutting corners);
`  - up by the kind's step (1, or 2 for the crag goat);
`  - down by up to its drop (3, or 5);
`  - swimming across water only if no dry way is found (cost ×4), and never deep under.
`- **Costs and limits:** cost = distance, plus a little for climbing. The heuristic is the
`  octile distance. A search stops after a node limit (2,000) and a range (24 blocks), so a
`  mob with no way somewhere gives up quickly.
`- **Per-frame budget:** a mob asks for a path and waits its turn. At most a few searches run a
`  frame, within \`TUNING.mobs.pathBudgetMs\`.
`- Reads blocks through \`World.getBlock\`, so unloaded chunks count as air: no paths into them.
`
`### 3. Behaviour (new \`mobs/brain.ts\`, pure)
`- **A small state machine per mob:**
`  - **idle**: stand, graze, look about;
`  - **wander**: pick a random spot 4–12 blocks away that a path reaches, walk there;
`  - **flee**: after a hit, a path away from you, at a run, for a few seconds;
`  - **rest**: at night, lie down and stay put.
`- **Following a path:** steer towards the next waypoint, and jump when the next one is higher.
`  If it's stuck for half a second (a block placed in the way), it asks for a new path. If it
`  falls somewhere unexpected, it starts again.
`- **Randomness** from a seeded RNG per mob (\`math.ts\`), so tests replay exactly. Mobs aren't
`  world data, so a run doesn't have to repeat in-game.
`
`### 4. Where they come from (new \`mobs/mobs.ts\`, \`MobManager\`)
`- **Spawning:**
`  - a few times a second, try a random column 24–64 blocks from you, in loaded chunks;
`  - on its top block, if the column's biome has a kind, the block suits it (grass, sand,
`    snow) and it's open to the sky;
`  - never in water or within 24 blocks of you.
`  - A kind comes in small groups (2–4 mossbacks, 1–3 of the others).
`- **Despawning:** beyond 96 blocks, or when its chunk unloads.
`- **How many:** at most \`TUNING.mobs.max\` (24) around you; \`?mobs=0\` turns them off and
`  \`?mobs=40\` sets a cap, for measuring.
`- **Not saved** (decision below): they appear again around you when you come back.
`
`### 5. Drawing (new \`render/mobRenderer.ts\`)
`- **Models:** each kind is a few boxes (body, head, legs, ears or shell) with pivots.
`- **Instancing:** one \`InstancedMesh\` per box of each kind, every mob of the kind an instance:
`  about 20 draw calls at most, however many mobs. Matrices are written each frame from the
`  mob's position, facing and pose.
`- **Animation** (pure, tested): legs swing with distance walked, the head bobs and dips to
`  graze, hoppers squash on landing, resting mobs lie down.
`- **Light:** each mob is lit by the world's light at its position and the day's sunlight, as
`  the particles are. Fogged like the world.
`- **Textures:** a few new 16 × 16 layers in the block texture array (\`world/textures.ts\`), so
`  the same shader draws them.
`
`### 6. Hitting them, and their sounds
`- **Hitting:** the left button hits the mob under the crosshair, when one is nearer than the
`  block there. It's a ray against the mobs' boxes, within reach.
`  - A hit: knockback, a red flash, a hurt sound, then it flees.
`  - Three hits and it's gone in a puff of particles. Creative mode: no drops, no health bar.
`- **Sounds,** synthesised as the others are (\`audio/sound.ts\`): an occasional call per kind
`  (low for the mossback, chirps for the hopper and beetle, a bleat for the goat), a hurt sound,
`  and hopper landings. Quieter with distance.
`
`### 7. \`?stats\`
`A line for the mobs: how many of each kind, paths asked and found a second, and their main
`thread time (AI, paths, physics, drawing).
`
`## Files
`- **Changed:**
`  - \`world/physics.ts\`: body size;
`  - \`config.ts\`: \`TUNING.mobs\`;
`  - \`world/textures.ts\`: mob layers;
`  - \`audio/sound.ts\`, \`audio/cues.ts\`: mob sounds;
`  - \`game.ts\`: manager, hits, frame loop;
`  - \`stats.ts\`;
`  - CLAUDE.md.
`- **New:**
`  - \`mobs/kinds.ts\`: the four kinds' sizes, speeds, steps, biomes and models;
`  - \`mobs/pathfind.ts\`;
`  - \`mobs/brain.ts\`;
`  - \`mobs/mobs.ts\`: spawning and the per-frame budget;
`  - \`render/mobRenderer.ts\`;
`  - \`mobs/pose.ts\`: animation, pure.
`
`## Tests (headless)
`- **Physics:**
`  - the player's tests unchanged;
`  - a small box fits through a gap the player doesn't, and a wide one stops where the player
`    would pass.
`- **Paths:**
`  - a straight line on flat ground;
`  - round a wall;
`  - up a one-block step but not two, except the goat;
`  - down a drop within the limit but not a cliff;
`  - no corner cutting;
`  - round a lake rather than through it, and across it when there's no other way;
`  - no path gives up within the node limit;
`  - the same result every time.
`- **Behaviour,** in a small test world, stepped like the game:
`  - a wandering mob reaches its spot;
`  - one blocked by a new wall finds another way;
`  - a hit one ends up further from you;
`  - resting mobs stay put at night.
`- **Spawning:**
`  - only on the kind's blocks in its biome, open to the sky;
`  - never near you or in water;
`  - the cap holds;
`  - despawning beyond the distance and with the chunk.
`- **Hitting:** the ray finds the nearest mob in front within reach, misses behind a block, and
`  three hits remove it.
`- **Poses:** legs swing with distance and are still when standing; resting lies down.
`
`## Measuring
`- \`npm run bench\`: path search time (median, worst) on a fixed set of searches over generated
`  terrain: plains, forest, mountains.
`- **The mountain probe** and \`?autofly\` at radius 8 and 16, with and without mobs
`  (\`?mobs=0\`):
`  - fps, main thread and GPU;
`  - mob time per frame;
`  - holes.
`- **Target:** mobs cost under 1 ms of main thread a frame at the cap, and don't move the fps.
`
`## Steps (each built, tested, measured, committed and pushed)
`1. Body sizes in the physics, and the A* pathfinder, with tests and bench timings.
`2. The kinds and their behaviour: wandering, following paths, jumping, getting unstuck. Tested
`   in a headless world.
`3. Spawning and despawning in the game; drawing with instanced box models and light;
`   \`?mobs\` and \`?stats\`.
`4. The four models, their textures and animation.
`5. Hitting, fleeing and the puff; mob sounds.
`6. Measurements, notes and playtest questions.
`
`## Decisions for you
`- **The animals:** the four above, one or two per biome, all passive. Different ones, or
`  hostile ones at night, can come later.
`- **Not saved:** mobs live around you and appear again when you return. Saving them means
`  storing them with their chunks; it's doable later.
`- **Hitting:** three hits and they're gone, no drops (creative mode). Or should hitting only
`  scare them away?
`- **How many:** up to 24 around you.
