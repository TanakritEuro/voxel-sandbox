# Milestone 21: weather

**Status:** plan approved (2026-11-22), all six decisions as written; steps 1–3 built.

## Goal

Give the sky something to do (weather was left out of Milestone 5):
1. **Spells of weather:** clear, overcast, rain and storms, coming and going by themselves, saved, the same for everyone
   playing together.
2. **By biome:** snow in the snowy mountains, only cloud over desert and savanna, rain elsewhere.
3. **Seen and heard:** darker sky, more cloud, closer fog, falling drops and flakes, wet ground, snow settling, lightning
   and thunder.
4. **Cheap:** no block changed, nothing remeshed, nothing more saved per chunk, and the budget kept at view distance 8.

Every world gets it, whatever its generation version: the land isn't touched.

## What the code says (looked at and measured, 2026-11-22)

- **There's no day count.** A world keeps only the time of day, 0–1, so weather can't be worked out from the clock: it
  needs a small state of its own in the world's record.
- **Sunlight can't say what's under cover.** It goes through glass at full strength, so rain would fall through glass
  roofs. A height of cover per (x, z) is needed. Finding it is cheap: **0.04–0.07 ms a column** (a scratch probe, headless,
  225 columns round two places).
- **Snow as blocks would be dear.** An edited chunk is saved, and sent to guests. The same probe put one snow block on the
  top of every dry place within about radius 8 (seed 20261022, generation 3):

  | Round | Snow blocks | Chunks made edited | Saved, run-length encoded |
  | --- | --- | --- | --- |
  | the spawn | 114,278 | 323 | 846 KB |
  | the mountains (chunk -11, 12) | 230,400 | 520 | 1,553 KB |

  That's for one view, growing with every place visited while it snows, with remeshing on top. (An estimate: the
  probe used the whole snow block, and snowed everywhere regardless of biome, which is the most it could be.)
- **Daylight is both looks and rules.** `daylightNow` lights mobs and items for drawing, and also decides gloamers,
  crops and sleep. Storm gloom must dim only the first.
- **What weather costs the GPU isn't known yet:** nothing of it was tried in the shader for this plan.
- **The solid pass is touchy.** Milestone 6 found its shader matters a lot on a laptop's GPU (`discard` alone doubled
  it), so what weather adds there is measured before anything is built on it.

## Design

### The weather (`world/weather.ts` new, pure)

- **Spells:** spell n is a pure function of the seed and n: a dry stretch of 6–14 minutes, then a wet one of 2–6 minutes
  (60 % rain, 25 % storm, 15 % only overcast). A new world's first stretch is dry.
- **State:** `{ spell, elapsed, settled, wet }`, stepped only while the world runs, saved as the record's `weather` and
  cleaned on load; missing (older worlds) starts clear.
- **What's drawn from it:** cloud cover, gloom and fall strength, each easing over 20 s. Snow settles over 2 minutes of
  falling and melts over 5 after; the ground is wet within 20 s and dry 60 s after.
- **By place,** from the climate's biome weights, sampled every 8 blocks and dithered at the edges: snow where mountains
  weigh half or more, nothing falling where desert and savanna weigh 0.6 or more, rain elsewhere.

### Cover (`world/cover.ts` new, pure; `render/coverMap.ts` new)

- **A tile a column,** 32 x 32, two bytes a place: the top of the highest block that stops rain (anything solid, glass
  and leaves too, or a liquid) in half blocks, and what falls there. The generate worker makes it after saved chunks are
  put in; an edit looks again at its own (x, z).
- **On the GPU:** one 1024 x 1024 RG8 texture (2 MB) wrapped round the world and following the camera (496 blocks each
  way), changed a tile at a time. The drops and the ground's shader both read it.

### Rain and snow (`render/precipitation.ts` new)

- **One instanced mesh,** one draw call: 3,000 short streaks or 1,500 square flakes in a 48-block box round the eye,
  moved by the vertex shader alone (no work a drop on the main thread), none under cover, under water or above y 240.
- A few splashes where drops land. Not drawn far under cover with no sky near.

### Wet and snowy ground (`render/blockMaterial.ts`)

- **Drawn, not placed:** in the solid and cutout passes, a fragment at exactly its place's cover height is a top open to
  the sky. Wet, it's darkened; settled, it turns white in a blocky patchy pattern that fills in. Side faces and anything
  under cover stay as they are.
- **Melted by light:** no snow where block light is 11 or more, so torches and lanterns clear a ring.
- **Footsteps** on settled snow sound of snow.
- **Nothing in clear, dry weather:** a uniform switches the lookup off.
- **Far chunks** (levels of detail) have coarser tops, so there the height test allows a cell's size.

### Sky, fog and light (`render/weatherLook.ts` new, pure; `sky`, `skyDome`, `clouds`, `fog`)

- The time of day's sky, changed by the weather: greyer horizon and zenith; sun, moon, stars and glow hidden; sunlight
  for drawing down to 0.75 in rain and 0.55 in a storm; fog from 0.35 and 0.25 of the view distance.
- The clouds keep their noise rather than a yes or no, so cover can grow from 40 % to 95 % by a threshold.
- The rules go on reading the plain daylight.

### Lightning and thunder (`render/lightning.ts` new)

- **In storms,** every 8–25 s a forked bolt of boxes 40–240 blocks from a player, chosen by the host. Harmless: no
  damage, no block changed, no block light.
- **The flash** is one soft brightening of the sky and sunlight, at most one in 3 s, never a flicker. A setting turns it
  off, and it's off when the system asks for less motion.
- **Thunder** 0.3–2 s later by the distance, quieter and duller from far off.

### Sound (`audio/sound.ts`)

- A looped noise bed for rain, louder near open sky, muffled under cover (the nearest open place within 6 blocks, from
  the cover tiles), silent deep underground. Snow is nearly silent. All at the game's volume and mute.

### The few rules that change

- **Rain puts out burning,** as water does.
- **A bed can be used in a storm by day:** the storm ends and the clock moves on by what was left of it. Sleeping a
  night clears the weather.

### Playing together

- The host steps the weather. It's in the welcome, sent every 2 s with the time and at once when sleep changes it; a
  bolt is a message. Guests step it between, and draw and hear their own. **`PROTOCOL` 13.**

### For trying it

- `?weather=clear|overcast|rain|storm` holds it, `?settled=1` starts with snow lying, a `?stats` line says the weather.
- `?autofly` and `?backdrop` stay clear unless told, so flights compare with earlier milestones'.

## Files

| File | Change |
| --- | --- |
| `src/world/weather.ts`, `src/world/cover.ts` (new) | spells and state; what falls where; cover tiles |
| `src/workers/protocol.ts`, `jobs.ts`, `src/chunkLoader.ts` | a column's cover with the generate result |
| `src/render/coverMap.ts`, `precipitation.ts`, `lightning.ts`, `weatherLook.ts` (new) | the texture; drops, flakes, splashes; bolts; sky, fog and light by weather |
| `src/render/weatherView.ts` (new) | all of those behind one `update`, so `game.ts` (2,448 lines) grows little |
| `src/render/blockMaterial.ts`, `skyDome.ts`, `clouds.ts`, `water.ts` | wet and snowy tops; hidden sun; cover; fog |
| `src/audio/sound.ts`, `cues.ts` | rain, thunder, snowy steps |
| `src/survival/health.ts`, `sleep.ts` | rain puts out burning; sleep through a storm |
| `src/save/store.ts`, `src/settings.ts`, `src/ui/settingsPanel.ts` | the record's `weather`; lightning flashes |
| `src/net/protocol.ts`, `session.ts`, `hostWorld.ts` | weather in the welcome and after, bolts; `PROTOCOL` 13 |
| `src/config.ts`, `src/game.ts` | `TUNING.weather`; wiring, the gloom split from the rules' daylight |
| `bench/bench.ts` | cover a column, after an edit, a weather step |

## Tests

- **Spells:** the same for a seed and number, inside their ranges, the first dry, about the planned share wet; stepping
  in small or big steps ends alike; saved and back; junk cleaned; an old record clear.
- **By place:** snow, rain or nothing by the weights, with four biomes (generation 1) and six.
- **Cover:** against a brute-force scan on generated columns; glass, leaves, slabs and water cover, torches and rails
  don't; placing and breaking; the worker's tile the same as the main thread's, saved chunks included.
- **Looks:** clear weather leaves sky, fog and sunlight exactly as they are; a storm within its limits.
- **Rules:** gloamers, crops and night unchanged by gloom; burning put out only in the open and only by rain; sleep in a
  storm, alone and together.
- **Lightning:** never two flashes within 3 s; none with the setting off.
- **Together:** the welcome, a change, a bolt, sleep clearing it, junk turned away.
- **Nothing edited:** a whole storm and snowfall leave no chunk modified or stale.

## How to measure

Against `9bddd4c` in the same sitting, a warm dev server (the first flight thrown away), the bench with the server stopped.

| What | Limit |
| --- | --- |
| GPU at radius 8 in clear weather, the spawn and the mountain probe (`?at=-368,400`) | +0.3 ms |
| GPU at radius 8 in a storm, and with snow settled | +1.5 ms |
| Main thread, any weather | +0.3 ms a frame |
| Generate job | +0.15 ms a column |
| Sprint flight in a storm | no more frames over 20 ms than clear, within the noise of two runs |
| Chunks modified or remeshed by weather | none |

Also the same storm at radius 16, recorded. This machine isn't the Intel laptop the budget is for, so the laptop's
numbers are a playtest question.

## Risks

- **The ground's texture lookup on a weak GPU.** Step 2 measures it before step 3 builds on it. Over the limit: snow and
  wet only within the full-detail ring, then no wetness.
- **Snow on far chunks** may band on slopes or miss tops. Looked at from above at radius 16; if bad, far land is whitened
  by the fog alone.
- **Overdraw from drops** close to the eye: fewer and thinner before anything else.

## Steps

1. **The weather and the sky:** spells, saving, `?weather`, gloom, clouds, fog, sun; tests.
   Done (2026-11-22).
2. **Cover, and the shader's cost:** tiles in the worker and after edits, the texture, wet tops; tests; the GPU
   measured against the limits.
   Done (2026-11-22).
3. **What falls and lies:** rain, splashes, flakes, settled snow and melting; the far chunks looked at.
   Done (2026-11-22).
4. **Storms and sound:** lightning, thunder, rain's sound, the setting, the two rules; tests.
5. **Together:** the messages, guests, sleep; tests.
6. **Measurements,** notes, playtest questions.

## Decisions (agreed 2026-11-22)

1. **Snow is drawn, not blocks:** no saving, remeshing or light work, but it can't be dug, picked up or built with.
2. **Gloom is only looks:** gloamers don't come out in a storm by day and crops don't slow.
3. **Lightning is harmless,** with a soft flash that can be turned off.
4. **Two rules change:** rain puts out burning; a bed skips a storm.
5. **Weather is on in every world,** with no switch per world: by the spells' averages about 17 % of the time rain,
   7 % storms, 4 % overcast, the rest clear.
6. **One weather for the whole world:** what falls differs by biome, when it falls doesn't (no fronts moving across).

## Step 1: the weather and the sky (2026-11-22)

**Built:**
- `world/weather.ts`: spells from the seed and their number, the state stepped while the world runs (the same however
  time is divided), eased 20 s in and out inside the wet stretch, settled snow and wet ground counted, cleaned on load.
- `render/weatherLook.ts`: the sky, clouds, fog and sunlight under the weather, clear weather giving back the very
  values it was given.
- The clouds' texture keeps the noise (32-bit floats, 64 KB), cut by a threshold. At the clear cover the cells are the
  same as before (20 checksums over 4 seeds and 5 covers compared, one pinned in the tests).
- The sun, moon, stars and glow fade, gone when the weather is two thirds come on.
- `game.ts`: `daylightNow` stays the rules' (crops, sleep, creatures), `drawnDaylight` is what drawing takes. The
  record's `weather`, `?weather`, `?settled=1`, a `?stats` line.

**Chosen while building, where the plan didn't say:**
- **At night only 0.3 of the dimming is kept** (a storm leaves 0.865 of moonlight, not 0.55), or a night storm is too
  dark to walk in. At noon the plan's 0.75 and 0.55 hold.
- **Overcast:** cloud 80 %, sunlight 0.88, fog from 0.5.
- **Weather held by `?weather` isn't saved:** the world keeps its own.

**Not yet:** nothing falls, and wet ground and settled snow aren't drawn (steps 2 and 3). A guest's weather is held
clear until step 5, so a host in rain and its guests see different skies until then. Which biome gets snow, rain or
nothing comes with the cover tiles in step 2, and so does its test.

**Tests:** 17 in `tests/weather.test.ts`. 681 tests in all pass; the build passes.

**Looked at** (`docs/milestone-21/1-…`): the four kinds by morning at the spawn, storms at dusk, by night and in the
mountains, the sun gone in a storm, the backdrop still clear. In a real saved world (made for it, deleted after): the
weather waited while paused, came back after save and quit, and went from clear to rain over 20 s
(its saved state moved to 2 s before the first rain, to see it); `?weather=storm`
left its saved weather as it was. No console errors. Joining as a guest wasn't tried in the browser.

**Found, not changed:** the clouds lie at y 192 and mountains rise past them. From a summit at y 207 a storm's 95 %
cover is a flat pale sheet that hides the valley, and the plan's snow falls up to y 240, so above that sheet too.
To settle before step 3: thin the weather's extra cover as the eye rises over the layer (recommended), or lift the layer.

**Measured** (752 x 457 at 1.5x, `?seed=20261022&time=0.5&mobs=0`, standing, medians of 10 s, twice each; "before" is
`551bcb3`, whose code is `9bddd4c`'s, the same sitting):

| | Before | Clear | Storm | Limit |
| --- | --- | --- | --- | --- |
| GPU, the spawn | 3.9, 3.9 ms | 3.6, 3.6 | 3.5, 3.5 | +0.3 clear, +1.5 storm |
| GPU, the mountains | 7.8, 7.7 ms | 7.6, 7.3 | 8.4, 8.4 | the same |
| Main thread, the spawn | 2.3, 2.4 ms | 1.5, 1.5 | 1.5, 1.4 | +0.3 |
| Main thread, the mountains | 1.6, 1.6 ms | 1.6, 1.6 | 1.6, 1.6 | +0.3 |
| Sprint flight, frames over 20 ms (two runs each) | 0, 0 | 0, 0 | 0, 0 | no more |
| Sprint flight, main thread p50 | 2.8, 3.1 ms | 2.7, 2.0 | 2.5, 2.5 | |

- *(Corrected in step 2: this didn't hold up. Timed again with the builds interleaved over 4–15 runs each, a storm is
  within 0.2 ms of before, and this view's runs vary by ±0.5 ms by themselves. The allowance isn't partly spent.)*
  **A storm in the mountains already takes 0.6 ms of GPU over before** (0.8–1.1 over clear on this commit) of the 1.5
  allowed, with nothing falling yet. Presumably the near-full cloud layer drawn over the view (not isolated). That
  leaves 0.4–0.9 ms for drops, wet tops and snow.
- **The main thread's numbers wander:** two flights of the same code differed by 0.7 ms, so the spawn's 0.8 ms under
  before isn't claimed as a gain. Timed headless,
  a frame's weather (step, look, sky, threshold) is 0.0001 ms clear and 0.001 ms in a storm.

## Step 2: cover, and the shader's cost (2026-11-22)

**Built:**
- `world/cover.ts`: a tile a column, two bytes a place (the height in half blocks, up to 512, takes ten bits; what falls
  sits in the bits above), what falls from the climate sampled every 8 blocks and dithered. The generate worker makes it
  after the saved chunks are put in. `World` keeps it, puts it right on every way of setting a block, and works it out
  itself for a column that came without one.
- `render/coverMap.ts`: the 1024 x 1024 RG8 texture wrapped round the world, only changed tiles uploaded.
- The mesher marks level tops in the colour's spare fourth byte with the cell of their detail (1, 2 or 4 blocks); the
  solid and cutout shader looks the place up and, where rain falls and gets to, darkens the top to 0.6 (linear) as it
  wets. Lava, water, glass and sides stay as they are. The lookup is skipped while dry.
- `?stats` says what falls where you stand.

**Changed from the plan:**
- **Only what fills its block seen from above shelters** (and liquids). "Anything solid" left a dry stripe under every
  row of fences and panes, seen in the browser; so fences, panes, doors and lanterns don't stop rain.
- **The test is "at or above the cover", not "exactly at it":** less half a block near (a stair's lower step), less a
  cell on far chunks.
- **Height needs ten bits,** so the two bytes aren't a byte each for height and what falls.

**Found and fixed:**
- **The shader first cost 0.8 ms of GPU in the mountains in clear weather,** against the 0.3 allowed: 8.6 ms, against 7.8
  for the same code without the weather's shader (8 runs each, interleaved). The cost was the extra numbers interpolated
  for every vertex. Packed (the shade one number instead of three, the place two, the top's height not interpolated),
  it's 8.0 there.
- **The cover's scan took 0.141 ms a column in the mountains** (0.15 allowed); looking only at places still open on the
  way down, 0.10.

**Tests:** 16 in `tests/cover.test.ts` (against a scan from the sky on three versions' columns and after 900 random
edits, what falls with four and six biomes, the worker's tile with saved chunks, the marks at each detail, the texture's
slots, moves and uploads, a storm editing nothing); three existing tests follow the new argument and transfer. 697 in
all pass; the build passes.

**Looked at** (`docs/milestone-21/2-…`, the production build): wet grass and sand at the spawn, dry under canopies,
glass placed leaving dry ground under it and wet again when broken, fences and panes, a desert staying dry, both
biome edges. No console or shader errors.

**Measured:** the production builds of `9bddd4c` and this step side by side under one server, interleaved, medians,
752 x 457 at 1.5x unless said:

| GPU (runs each) | Before | Clear | Storm, wet | Limit |
| --- | --- | --- | --- | --- |
| The spawn (4) | 3.67 ms | 3.61 | 3.84 | +0.3 clear, +1.5 storm |
| The mountains (7) | 8.02 | 7.94 | 7.91 | the same |
| Looking down, wet tops filling the view (4) | 1.63 | 1.60 | 1.73 | the same |
| The spawn at 1920 x 1080 (6) | 6.81 | 6.52 | 6.44 | the same |
| Looking down at 1920 x 1080 (6) | 6.32 | 6.21 | 6.22 | the same |
| The mountains at 1920 x 1080 (6) | 7.39 | 7.70 | 7.04 | the same |
| The spawn at radius 16 (4) | 8.91 | 7.58 | 8.96 | recorded |

- **Inside the limits,** with one on the line: the mountains at full HD in clear weather, +0.31 against 0.3, where the
  runs of one build spread over 1–2.5 ms, so it can't be told from noise. Differences below zero are noise too.
- **A first pass of two runs each read 1–3 ms over** at full HD and radius 16; with controls and more runs (above) it
  didn't hold. One or two runs of GPU time prove nothing here.

| | Measured | Limit |
| --- | --- | --- |
| Main thread standing, means of 4–15 runs | +0.12 ms at the spawn, +0.09 in the mountains, -0.07 looking down | +0.3 |
| Sprint flights, frames over 20 ms | before none in 17, clear none in 13, storm one frame in one of 14 (not repeated in the 6 storm flights after it) | no more than before |
| Sprint flight, main thread p50 (means of 6 each, interleaved) | clear 2.03 ms, storm 2.05, before 2.10 | +0.3 |
| Cover a column, in the generate job | 0.060 ms at the spawn, 0.099 in the mountains | +0.15 |
| An edit's cover, the dearest kind | 5–13 us | |
| The texture written whole; crossing a column | 0.9–1.2 ms; 0.05 ms | |
| Meshing a chunk, marking tops (Vitest) | 1.55 ms, before 1.49 (+4 %) | |
| Chunks modified or remeshed by weather | none (tested) | none |

This is still this machine's GPU; a laptop's is a playtest question.

**Left for step 3:**
- **The far chunks' tops** haven't been judged from above.
- **The biome edges are busy:** the wet and dry dither lies over the ground's own, a patchwork in single blocks
  (`2-edge-dry.jpg`); a narrower dither may be better.
- **Snow-topped blocks just outside the snow line get rain** and are darkened like the rest (`2-edge-snow.jpg`).

## Step 3: what falls and lies (2026-11-22)

**Built:**
- `render/precipitation.ts`: one instanced mesh in one draw. 3,000 streaks in a storm (60 % of them in rain) or half as
  many flakes, by what falls at each one's own x and z, and 300 splashes, all moved by the vertex shader in a 48-block box
  round the eye and ended at the cover. None under water, above y 240, or where there's none to see (under cover with no
  sky within 24 blocks, deserts): then no draw at all. Speeds are whole blocks a second, so the clock wraps every 48 s.
- **Settled snow,** in the chunk shader: the snow texture over tops open to the sky where it snows, in patches a few
  blocks across of quarter-block squares that fill in as it settles, drawn as their average where they'd be under a
  pixel. None where block light is 11 or more, so torches clear a ring. No new interpolated numbers.
- **Footsteps** in settled snow sound of snow.

**The three left from steps 1 and 2:**
- **Clouds over mountains:** the weather's extra cover thins to a clear day's over the 8 blocks above the layer
  (`3-summit.jpg`, against `1-mountains-storm.jpg`).
- **Busy biome edges:** the dither narrowed from 0.06 of weight to 0.02, so the band of mixed wet and dry is about a
  third as wide (`3-edge-dry.jpg`). The patchwork left is mostly the ground's own.
- **Snowy blocks outside the snow line** (2.6 % of the mountain biome's ground, counted over 8,000 x 8,000 blocks) still
  get rain, but no longer darken. The threshold is as agreed.

**Changed from the plan:**
- **Far chunks' tops may be two cells under the cover,** not one. Coarsening takes canopies and ledges off: of the tops
  seen from above, one cell missed 2.9–10.2 %, two miss 1.3–3.8 % (three places, both levels). The price: some ground
  under far trees turns white. A test holds it to at most 6 %, and none missed at full detail.
- **Drops and flakes a little bigger** than first drawn, and the nearest flakes faded, or they were big squares.

**Found and fixed:** **the first frame of rain took 50 ms.** The mesh is hidden until it rains, so its shader compiled
then; held weather, as every flight uses, never showed it. It's now compiled at startup: 17 ms at worst over the change
from dry to rain, against 50, three trials each with shaders no cache had seen.

**Tests:** 9 in `tests/precipitation.test.ts` and 1 more in `tests/cover.test.ts`. 707 in all pass; the build passes.

**Looked at** (`docs/milestone-21/3-…`, the production build): storms at the spawn, under a canopy, at night, over a
desert (nothing falling), at the snow line and on a summit; snow settling over 84 s; a torch clearing it; radius 16 from
high up, bare and settled, with no banding seen. No console or shader errors. The footsteps weren't listened to.

**Measured** as in step 2: production builds against `9bddd4c` under one server, interleaved, medians, 752 x 457 at 1.5x
unless said. "Storm" is with what falls; in the mountains with snow settled whole. (Taken before the warm-up fix, which
only moves a compile to startup.)

| GPU (runs each) | Before | Clear | Storm | Lying, clear sky | Limit |
| --- | --- | --- | --- | --- | --- |
| The spawn (6) | 4.10 ms | 4.24 | 4.56 | | +0.3 clear, +1.5 storm or snow |
| Looking down, wet (4) | 1.85 | 1.90 | 2.20 | | the same |
| The mountains (6) | 8.44 | 8.41 | 8.74 | 8.54 | the same |
| The spawn at 1920 x 1080 (6) | 6.28 | 6.46 | 6.70 | | the same |
| The mountains at 1920 x 1080 (6) | 7.30 | 7.34 | 6.64 | | the same |
| Looking down at snow, 1920 x 1080 (8) | 7.19 | | 6.96 (settling: 7.31) | 7.27 | the same |
| The spawn at radius 16 (4) | 8.28 | | 9.01 | | recorded |

- **Inside the limits everywhere.** Looking down at snow at full HD first read +1.5, right on the limit, over 4 runs
  spread over 6.4–10.0 ms; 8 runs each with controls didn't bear it out. Differences below zero are noise.

| | Measured | Limit |
| --- | --- | --- |
| Main thread standing, means | at most +0.21 ms | +0.3 |
| Looking for sky near, a frame while it falls | 0.005 ms | |
| Sprint flights, frames over 20 ms (6 each) | none: before, clear, storm with snow | no more than before |
| Sprint flight, main thread p50, means | before 2.30 ms, clear 2.40, storm 2.28 | +0.3 |
| Cover a column, in the generate job | 0.057 ms at the spawn, 0.084 in the mountains | +0.15 |
| Chunks modified or remeshed by weather | none (tested) | none |

A laptop's GPU is still a playtest question.
