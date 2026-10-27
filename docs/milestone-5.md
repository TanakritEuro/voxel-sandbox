# Milestone 5 plan: polish

## Status: built; waiting for your playtest

Approved 2026-10-26 as proposed: blocky clouds at y = 192, a creative inventory with the
hotbar saved per world, the settings as listed with view distance up to 16, a held block
only, and no ambient sounds for now.

Goal from the roadmap:
- a sky with sun, moon and clouds;
- fog by biome;
- water that animates;
- footstep and digging sounds (synthesised, as in the earlier games);
- block particles when breaking;
- a held block;
- an inventory with a creative-mode block picker;
- settings (view distance, mouse sensitivity, FOV).

Playable after every step and inside the budget (60 fps on your laptop at radius 8, no frame
over 20 ms flying). The Milestone 4 playtest is still to come; anything it turns up
(night brightness, torch reach, cave darkness) is a number in `TUNING` and can be folded in
along the way.

All seven steps are in:
- settings (view distance live, field of view, mouse, invert Y, volume, mute);
- a sky dome with sun, moon, stars and blocky clouds;
- fog by biome;
- moving water;
- synthesised sounds;
- block particles;
- the held block;
- a creative block picker with the hotbar saved per world.

There are 186 tests. It's live at https://tanakriteuro.github.io/voxel-sandbox/.

### Before and after

Measured back to back on 2026-10-27 on this machine. The end of Milestone 4 (`81bf16d`) was
built alongside, and `?autofly` alternated M4, M5, M4, M5 at radius 8.

| | end of Milestone 4 | end of Milestone 5 |
| --- | --- | --- |
| `?autofly` main thread p50 / p99 / max | 2.2 / 5.6 / 6.9 ms, 2.3 / 5.5 / 6.5 ms | 2.3 / 5.9 / 7.3 ms, 2.4 / 5.8 / 6.7 ms |
| frames over 20 ms, holes | 0, 0 | 0, 0 |
| first view (in front / all) | 1.25 / 1.75 s, 1.44 / 2.00 s | 1.69 / 2.12 s, 1.68 / 2.19 s |
| draw calls (by day), triangles drawn | 177, 468k | 181, 468k |
| meshes, chunks + light | 148.5, 66.3 MB | 148.5, 66.3 MB |
| JS heap after the flight | 265 MB | 283 MB |
| bench (same engine code) | | generate 485, light 163, greedy mesh 712 ms; worst edit 7.6–9.4 ms |

What the polish costs:
- **Frame time:** about 0.1 ms of main thread a frame for the sky, clouds, biome fog, water
  drift and the held block's pass.
- **Draw calls:** 4 more by day (5 at night).
- **Memory:** nothing in meshes or chunks, about 18 MB of heap.
- **First view:** about 0.3 s later. The cloud pattern and the block icons are made on the
  main thread at startup.
- Nothing goes over 20 ms, and there are no holes.

While digging, particles keep the main thread within 0.2 ms of standing still. From step 1:
radius 12 still holds the budget on this machine, while 16 can't load fast enough at sprint
speed and passes 800 MB.

## Playtest questions

Open https://tanakriteuro.github.io/voxel-sandbox/, make a world (or open one), and press Play.
E opens the block picker, M mutes, and Settings is in the pause menu (Esc) and the world list.

1. **Sounds** (the main question, as I can't hear them).
   - Do footsteps on grass, sand, gravel, snow, stone and planks sound like what they are?
   - Is the step rate right walking and sprinting?
   - Do digging, breaking, placing, landing from a jump off a hill, and splashing work?
   - Anything too loud, too quiet, too harsh, or tiring after a while?
2. **Sky.**
   - Are the sun and moon the right size?
   - Are the clouds right? (40 % cover, 12-block cells, at y = 192, drifting at 1.5 blocks a
     second.)
   - Is the dusk glow and the stars at night good? `?seed=20261022&time=0.76` shows dusk.
3. **Fog by biome.** Is the desert haze noticeable without being murky? Can you tell the
   mountains' clearer air and the forest's touch of green? Are crossings smooth?
4. **Water.** Is the drift too fast, too slow, or distracting from above?
5. **Particles.** The size of the cubes, how many, how long they last: right, or too much
   for repeated digging?
6. **Held block.** Size and place; how strong the bob and the swing are. Does it get in the
   way?
7. **Block picker.** Is E or Tab handy? Are the icons clear (ores, sandstone, gravel)? Would
   you like the hotbar to scroll through the picker, or a search?
8. **Settings.** Does view distance changing live work smoothly on your laptop? Up to which
   value does it stay smooth there? Are the FOV and mouse ranges wide enough?
9. **Laptop performance:** `?autofly&stats` once more, and walk about at night with torches.

The Milestone 3 and 4 playtest questions are still open in their notes. Night brightness
(`TUNING.day.night`) could become a setting if you'd like.

## Results by step

**Step 1 (settings).**
- **`settings.ts`:**
  - `Settings`, defaults from `TUNING`, and the ranges and steps.
  - `cleanSettings` keeps the known fields of the right type, clamped (view distance rounded
    to whole chunks), and uses the defaults for the rest.
  - `loadSettings` / `saveSettings` use `localStorage` (`voxel.settings.v1`) and fall back to
    the defaults where storage is missing or throws.
- **`ui/settingsPanel.ts`:**
  - Sliders for view distance (with "Beyond 12 chunks may be slow on a laptop." above 12),
    field of view, mouse speed and volume.
  - Toggles for invert mouse Y and mute.
  - Every change is saved and applied at once.
  - It opens from a Settings button in the world list and in the pause menu (which goes back
    to its main view when opened again).
- **Applied in the game (`applySettings`):**
  - *View distance:* sets the loader's radius, and `ChunkLoader.radiusChanged` makes the next
    update re-sort the columns, unload what's out of range and walk again, as after moving.
    It also moves the fog's range and the far plane. `?radius` still holds it for measuring.
  - *Field of view* goes to the camera.
  - *Mouse speed and invert Y* go to the input.
  - Volume and mute are kept for the sounds in step 4.
- **Checked in the pane (production build):**
  - The world list's Settings showed the panel.
  - In a world, from the pause menu: view distance 8 → 12 grew the world from 2152 to 4360
    chunks and 183 to 454 draw calls. Then 6 brought it down to 2312 chunks and 129 draw
    calls.
  - The values were in `localStorage` (then cleared again).
  - One frame went over 20 ms while 12 was filling in. No console errors.
- **Tests (4 new, 157 in all):**
  - settings: defaults, a round trip, junk and out-of-range values, no or blocked storage;
  - the loader: after shrinking the radius nothing is kept beyond the new range and nothing
    beyond it is shown; after growing it, everything within it is meshed.

`?autofly` (production build, this machine), for the warning above 12:

| | radius 8 (Milestone 4) | radius 12 | radius 16 |
| --- | --- | --- | --- |
| main thread p50 / p99 / max | 2.2 / 5.5 / 6.4 ms | 3.2 / 7.6 / 9.7 ms | 7.0 / 11.1 / 14.7 ms |
| frames over 20 ms | 0 | 0 | 0 |
| holes (missing chunks inside the fog) | none | up to 10, in 1 of 30 s | up to 57, in 11 of 30 s |
| first view (in front / all) | 1.4 / 1.9 s | 2.4 / 3.8 s | 4.8 / 9.3 s |
| draw calls, triangles drawn | 177, 468k | 452, 1217k | 774, 2082k |
| meshes, chunks + light, JS heap | 149, 66, 250 MB | 312, 131, 511 MB | 545, 222, 822 MB |

At 16, the frames hold on this machine, but at sprint speed loading falls behind (gaps in a
third of the flight) and memory passes 800 MB. That supports the warning; walking speed is
easier.

**Step 2 (sky and clouds).**
- **`render/sky.ts`** (still pure) gives `skyAt(time)` more fields:
  - the zenith colour (day, twilight, night);
  - the twilight glow strength;
  - star brightness;
  - the clouds' colour;
  - the sun's direction and angle.

  The sun rises in the east (+x), sets in the west, and its path leans 0.35 rad towards +z
  (`TUNING.sky.sunTilt`). The moon is opposite it.
- **`render/skyDome.ts`:**
  - *Dome:* a sphere round the camera at 0.9 of the far plane, so mountains still hide what's
    behind them. Its shader blends the horizon colour (the fog's, so the world's edge melts
    in as before) up to the zenith, and at dawn and dusk adds a warm glow round the sun, low
    in the sky.
  - *Sun and moon:* square pixel-art sprites (16 × 16, made at startup). The sun is drawn
    additive; the moon has craters and clipped corners and is faint by day.
  - *Stars:* 900 seeded points that fade in as the sun goes down and turn with it.
  - All of it is drawn behind the world without fog or depth writes, and hidden under water.
- **`render/clouds.ts`:**
  - *The pattern:* 128 × 128 cells (12 blocks each, so it repeats every 1536 blocks), from
    two octaves of value noise that wraps round, so it tiles without a seam. It's cut at the
    level that covers `cloudCover` (40 %) of the cells, and seeded by the world.
  - *Drawing:* one quad at y = 192 following the camera, with a red-channel texture (one
    texel a cell, nearest) looked up from world x and z. It drifts at 1.5 blocks a second.
  - *Fading:* it fades by horizontal distance from 0.6 to 1.6 view distances, rather than by
    the 3D fog, which at small view distances would hide clouds straight overhead.
  - *Colour:* white by day, peach at dusk, navy at night, a little darker underneath.
  - It keeps the canvas's alpha like the water, and is hidden under water.
- **Checked in the pane** from autofly's vista (`?autofly=1&time=…`):
  - *Noon:* a blue gradient to the zenith, the square sun, and blocky white clouds overhead.
  - *18:00 looking west:* a peach sky glowing over the horizon, peach clouds, and the
    blue-violet zenith showing through their gaps.
  - *Midnight looking up:* stars between dark navy clouds.
  - No console errors.
- **Cost:** `?autofly` at radius 8 has 181 draw calls against 177 (dome, sun, moon, clouds;
  stars too, at night). The main thread was p50 2.4, p99 5.7 and max 6.8 ms against 2.2 /
  5.5 / 6.4, which is noise. No frame went over 20 ms and there were no holes.
- **Tests (5 new, 162 in all):**
  - the sun's path: east at sunrise, west at sunset, high and leaning at noon, below at
    midnight, always a unit vector;
  - zenith colours, stars, glow and cloud colour at noon, dusk and midnight;
  - clouds: the same for a seed and different for another, covering the share asked for, no
    seam across the repeat (it changes no more there than inside), clumps rather than salt
    and pepper, and the drift.

**Step 3 (fog by biome, animated water).**
- **`render/fog.ts`** (pure):
  - Each biome has a tint, how much of it shows by day, and where the fog starts
    (`TUNING.fog`):
    - plains: none, at 0.55;
    - forest: a slight green, 0.3, at 0.5;
    - desert: a sandy haze, 0.6, at 0.35;
    - mountains: pale cold blue-white, 0.45, at 0.65.
  - `blendFog` mixes them by the climate's biome weights at the camera. Tints are weighted by
    how much each shows, so plains (no tint) next to the desert halve the haze's strength
    rather than greying its colour.
  - `easeFog` follows a change exponentially (`TUNING.fog.ease`, 3 s).
  - `fogColour` mixes the tint, darkened to the daylight, into the time of day's horizon:
    fully by day, not at all at night.
  - The result is the horizon for the fog, the background and the sky dome together, so the
    edge of the world still meets the sky without a line. The fog's start follows the biome
    each frame (`WaterView.setRange`).
- **Animated water:**
  - The transparent chunk material (`#define WATER`) draws water faces from two copies of the
    water texture, drifting different ways (`TUNING.water.flow`, 0.12 blocks a second), and
    blends them.
  - The second copy is 4/3 the size: 32 blocks are a whole number of its tiles, so there are
    no seams at chunk borders.
  - A slow ripple of brightness (±7 %) runs over them.
  - `water.ts`'s pure `waterFlow(seconds, flow)` gives the offsets, kept within one block, so
    the shader never sees large numbers.
  - Nothing is remeshed, and the surface stays flush with the shore. Glass is drawn as before.
- **Checked in the pane (production build, at 10:48):**
  - *Over the desert* (`?at=384,0`) the horizon is a pale sandy haze, and the fog closes in
    sooner.
  - *Over plains and sea* (`?at=36,53`) the horizon is clear blue as before.
  - *In shallow water,* looking down: overlapping light streaks that move between two shots
    3 s apart.
  - No console errors.
- **Cost:** `?autofly` at radius 8 had main thread p50 2.4, p99 5.7, max 6.4 ms, no frame over
  20 ms and no holes, the same as after step 2. The climate weights at the camera are a few
  microseconds a frame.
- **Tests (5 new, 167 in all):**
  - each biome's own fog where only it is; plains leaves the horizon alone; the desert is
    nearer and the mountains further;
  - blends (a tintless biome doesn't wash out its neighbour's colour), and the climate's
    weights give fogs in range;
  - easing: 63 % in `ease` seconds, there after 30;
  - full tint by day, none at night;
  - water flow starts still, stays within a block, and moves smoothly from frame to frame.

**Step 4 (sounds).**
- **`BlockInfo.sound`:** stone, dirt, grass, sand, gravel, snow, wood, leaves, glass or water,
  from a table in `blocks.ts` (stone unless listed).
  - Snowy grass sounds like snow, planks and torches like wood, cactus like leaves, and the
    lamp like glass.
- **`audio/cues.ts`** (pure, `SoundCues.frame`):
  - *Footsteps:* one every 1.6 blocks walked, in the material underfoot. `underfoot` looks
    under the middle of the feet, then under the box's corners, for standing over an edge.
  - *Landing* from falls faster than a jump's (silent up to 10 blocks a second, full at 30),
    with a step.
  - *Splashing* into water from 3 blocks a second.
  - *Digging:* a hit at once, then every 0.25 s.
  - The numbers are in `TUNING.sound`.
- **`audio/sound.ts`:**
  - `Sound` ported from the racing game: the context unlocked by the first click or key, a
    master gain for volume and mute, and a shared noise buffer.
  - *A recipe per material:* filtered noise, sometimes in a few quick bursts (grass, sand,
    gravel, leaves), sometimes with a pitched click (stone a tick, wood a hollow knock,
    glass a ring).
  - *Events:* a step is the recipe; a dig is shorter; a break is a louder crunch in two
    bursts; a place is a low thump with the material on top; a landing is a deeper thud;
    a splash is two low washes.
  - Pitch and level vary a little each time.
- **In the game:**
  - The cues run each unpaused frame from how the player moved. Breaking and placing play
    their sounds where they happen.
  - Volume and mute come from the settings; M toggles mute and remembers it.
- **One fix after measuring:** walking down a slope drops a block at a time, so the step
  count started again at every landing, and 9 blocks gave 3 steps instead of 5. Now the
  distance counts in the air too, a step due in the air sounds on touching down, and only a
  real (audible) landing restarts the rhythm.
- **Checked in the pane (production build):** I can't hear the pane, so I counted the audio
  nodes made, with `AudioContext` wrapped.
  - Walking 8.7 blocks over grass and sand: 5 steps (10 noise bursts).
  - Digging sand for 1.5 s: hits every quarter second and breaks.
  - Placing: a thump.
  - With M, nothing plays and `muted` is saved; a second M turns it back.
  - No console errors.

  How they sound is for your playtest.
- **Tests (7 new, 174 in all):**
  - steps per stride, in the ground's material, faster when sprinting;
  - the rhythm kept down a slope;
  - no steps in the air, flying or in water;
  - landings louder for bigger falls, and none after a jump;
  - splashes fast and not slow;
  - digging hits at once, then every interval;
  - underfoot at an edge, water not counting as ground, and every block having a sound.

**Step 5 (particles).**
- **`render/particles.ts`:**
  - *`Particles`* is the simulation, pure: struct of arrays for at most 512 particles. Slots
    are used in turn, so when full the oldest is reused.
    - `burst`: 20 cubes from anywhere in a broken block, outwards and up.
    - `chips`: 3 smaller ones just in front of the face being dug, at each digging hit.
  - *Movement:* gravity, then a move one axis at a time against the world. A move into a
    solid block is undone and bounces back at 0.3; landing slows the sliding. So none ever
    ends up inside a block.
  - *Life:* 0.6–1.1 s; they shrink away over the last third. The numbers are in
    `TUNING.particles`.
  - *Colours* are the block's top and side colours from `BLOCKS`, varied ±15 %, lit once when
    made. `brightness` gives the light where they appear, by the same curve as the chunk
    shader (daylight on sunlight; block light as it is).
  - *`ParticleMesh`* draws the living ones as one `InstancedMesh` of unit cubes, with a
    matrix and colour per instance and fog: one draw call.
- **In the game:** breaking a block bursts it, each digging hit (the sound cue) chips the
  face, and particles move only when not paused.
- **Checked in the pane (production build):**
  - Breaking grass on the plains (`?at=36,53`) burst green and brown cubes out of the hole;
    they fell into it and settled.
  - Digging without stop for 3 s: main thread 2.4–2.5 ms on average against 2.3 standing
    still. The peaks (up to 7.3 ms) are the edits' remeshing, as before.
  - No console errors.
- **Tests (5 new, 179 in all):**
  - a burst's count, and its cubes falling onto a floor and never inside it;
  - all gone after their life;
  - chips in front of the dug face;
  - the limit, with the newest burst all there;
  - brightness (dark, daylight, night, a lamp), and colours times the light.

**Step 6 (held block).**
- **`render/heldBlock.ts`:**
  - *The mesh:* `heldMesh` runs the chunk mesher on a padded array with the one block in it
    and air all round, lit throughout by the light where the player's eyes are. So a torch
    has its own shape, leaves have their holes, glass and water go in the transparent pass,
    and a lamp glows. It's remade only when the block or that light changes.
  - *Drawing:* `HeldBlock` has its own scene, a camera with a fixed 70° field of view (the FOV
    setting doesn't stretch it), and its own pair of chunk materials. They take the day's
    sunlight colour from the world each frame and share its texture array (now
    `ChunkRenderer.textures`, with `chunkGeometry` shared too).
  - It's drawn after the world with the depth cleared, so it never sinks into a wall.
  - At rest it's in the lower right, turned to show its top and two sides.
- **Motion (`HeldMotion`, pure):**
  - a bob, down and a little sideways, once per stride walked on the ground (fading in and
    out as you start and stop);
  - a swing down and forward (0.25 s) at every break, digging hit and placing;
  - a dip out and back in (0.2 s) when the selection changes.
  - Hidden under `?autofly`.
- **Checked in the pane (production build):**
  - Holding grass on the plains, the block sat in the lower right. I made it a little
    smaller and higher after the first look, so it no longer runs off the bottom edge.
  - Key 4 gave a small torch.
  - Key 7 and digging: the lamp tipped forward mid-swing, with the cracks on the target.
  - No console errors. The extra pass is a few dozen triangles.
- **Tests (4 new, 183 in all):**
  - the lone-block mesh: six faces in the unit cube, a torch's five within its box, leaves'
    six, glass in the transparent pass, nothing for air;
  - its light: given sunlight in the vertex colours, and a lamp at full glow in the dark;
  - motion at rest, a bob within its height when walking, the swing's pitch and its return,
    and the dip.

**Step 7 (creative block picker).**
- **`blocks.ts`:**
  - `PLACEABLE` lists every block but air: 22 of them, ores, water and the lamp included.
  - `hotbarFrom` cleans a saved hotbar: nine placeable blocks, with the default for any slot
    that's missing, air, a block id that doesn't exist, or not a whole number.
- **The hotbar is saved per world:** `WorldRecord.hotbar` holds it (optional, so worlds from
  before get the default). It's written with the record as soon as a block is chosen.
- **`render/icons.ts`:** an isometric cube per block, drawn on a 48 × 48 canvas at startup from
  its own textures.
  - The top, then the side twice: the left 20 % darker and the right 35 %, darkened only
    where the texture is, so leaves and glass keep their holes.
  - The torch keeps its own flat icon.
  - These replace the flat side textures in the hotbar (the old `textureIcon` is gone), so
    grass no longer looks like dirt there.
- **`ui/inventory.ts`:**
  - E or Tab opens a grid of every placeable block, with its icon and name. The block in the
    selected slot is highlighted.
  - Clicking one puts it in that slot. The number keys move the slot while it's open.
  - E, Tab or Esc closes it and captures the mouse again.
  - Opening it frees the mouse without the pause menu, and the player and clock stand still
    as when paused.
- **A world that isn't there** (`?world=` an id that was deleted) now goes back to the list
  quietly, rather than throwing after starting to leave.
- **Checked in the pane (production build):**
  - The pane's storage had been reset since the last session, so I made a new test world
    from the list.
  - E showed the grid of icons, every block recognisable, with Grass (slot 1) highlighted.
  - Crystal ore went into slot 1. Then 3 and Lamp put a lamp in slot 3, and the help line
    followed the slot.
  - E closed it and took the mouse back without the pause menu.
  - The hotbar showed the new icons, and after reloading the world it was still Crystal ore,
    Dirt, Lamp, ….
  - `?world=missing` landed on the list with nothing in the console.
- **Tests (3 new, 186 in all):**
  - the picker offers every block but air, once each;
  - `hotbarFrom` keeps a good hotbar and repairs a bad one slot by slot, without touching the
    default;
  - a chosen block survives the world being written and read again, and an old record gets
    the default.

**After the milestone: jumps when turning quickly (2026-10-27, your report).**
- **Cause:** Three.js uploads a mesh's buffers to the GPU the first time it draws one. Chunks
  that load behind or beside the player are never drawn until the camera faces them, so a
  quick turn uploaded hundreds of them in a frame or two.
  - Measured in the pane: the first fast 360° spin after loading made 1920 `bufferData`
    calls (about 480 chunk meshes, 37 ms of them) and one 41.5 ms frame.
  - The same spin again made none, and its slowest frame was 8.5 ms.
  - No shaders were compiled, so it wasn't that.
- **Fix:**
  - `ChunkRenderer` keeps the meshes it hasn't drawn yet.
  - Each frame, once the loader has had nothing to do for a second, `uploadSome` has up to
    `TUNING.view.uploadBytesPerSecond` (20 MB a second) of them drawn whatever the frustum,
    which uploads them. Each goes back to normal culling after its first draw.
  - Meshes in view upload as before. `?stats` shows how many are still to upload.
- **Two tries that were worse, while flying:**
  1. Drawing every new mesh once as it arrived also uploaded the ones behind during sprint
     flight.
  2. A per-frame budget was too much at 120 Hz, and gating on the loader being idle at that
     moment still caught the short gaps mid-flight.

  With a full second of idleness required, flying is as before.
- **After the fix:**
  - The backlog is gone within 8 s of loading.
  - Two fast spins at fresh places made no uploads, with a slowest frame of 8.5 ms.
  - `?autofly` at radius 8 (the pane now at 120 Hz) had 4–5 frames over 20 ms against 0–8
    in six runs of the build without it, the same main thread (p99 9.5–9.7 ms), and no holes.
- **Tests (2 new, 188 in all):** meshes are counted until drawn or removed; uploads take a
  budget of bytes at a time, skip hidden meshes, and go back to normal culling once drawn.

**Still jumping, in Chrome at view distance 16 (2026-10-27, your second report).** The upload
fix above was measured at radius 8; your setting is 16, where the loader itself was the problem.
- **Causes:**
  1. **Loading stalled at 16.** Every frame `dispatch` looked at every chunk in range again
     (about 7,500, building string keys). That used up the 3 ms budget before it reached the
     work still to do, so nothing started: `?stats` sat at "153 queued, 0 in flight" for good.
  2. **Every turn of more than 30° cost a frame.** It rebuilt the column order from scratch and
     ran the visibility walk again: 10–17 ms at 16 (headless). The walk doesn't depend on the
     look direction, only on the player's chunk.
  3. `?stats` showed "draw calls 1": the held block's own render pass reset Three.js's counts.
- **Fix:**
  - Columns are kept between frames with their chunks once loaded, whether their neighbours are
    loaded, and **settled** once nothing in them is left to do. Settled columns are skipped until
    something could change that: a walk, an edit, or a result for them or a neighbour.
  - A turn only re-sorts the existing columns (0.3–1.4 ms at 16); moving to another column or
    another height still walks.
  - `Chunk.key` is made once, not on every call.
  - `renderer.info` is reset once a frame, so both passes count.
- **Measured in Chrome** (production build, your view distance 16, fast spins by a script):

  | | Before | After |
  | --- | --- | --- |
  | Radius 16, loading | never finished | 7,464 chunks in about 16 s; upload backlog gone 10 s later |
  | Radius 16, standing | | about 6 ms of main thread a frame |
  | Radius 16, fast spins | 10–17 ms extra per turn | slowest frame about 17 ms (one at 25) |
  | Radius 16, sprint flight | | 627 frames, 22 over 20 ms, slowest 33.4 |
  | Radius 8, sprint flight | | 919 frames, none over 20 ms |

  Flying at 16 is still over the budget (set for radius 8): each new column walks about 6,400
  chunks. Tracking the walk's visited chunks by number instead of string made no difference
  (2–5 ms either way), so it was left as it is.
- **Test (1 new, 189 in all):** once loaded, 64 turns through two full circles start no work and
  don't walk again (the old loader walked on each one).

**Still jumping: your recording (2026-10-27).** `?stats` now shows the biggest mouse move in
one event, so the recording could tell a snapping view from slow frames. It showed both:
- **The view snapped.** One event moved the mouse **722 px** while the ones around it moved
  23–67 px; another was 737 px. That is a known fault of Chrome on Windows with pointer lock and
  the system's mouse acceleration, and a script's turns can't show it (they make their own
  events).
  - **Fix:** the mouse is captured with raw input (`unadjustedMovement`: no system
    acceleration, which avoids the fault). Where a browser doesn't have it, a move over 200 px
    and more than 6 times the biggest of the 3 before it is dropped (`SpikeFilter` in
    `input.ts`). A flick that builds up is kept; one from rest loses at most its first event.
  - Raw input feels a little different from the system's pointer: slow moves turn a bit more,
    fast ones less. The mouse sensitivity setting covers it.
  - **Checked in Chrome:** clicking Play captures the mouse with raw input (`?stats`: "raw
    input"). With raw input made to fail, it captures the plain way and drops a 722 px move
    among 30–45 px ones ("1 spike dropped").
- **Frames were slow all the time,** at your view distance 16 and 2560 px wide: about 20 ms
  (50 fps) even standing still, half of all frames over 20 ms. The main thread took about 12 ms,
  so the rest was most likely the GPU drawing 1.6–3.7 million triangles in about 840 draw
  calls. That is beyond the budget (set for radius 8), and makes turning look uneven on a 60 Hz
  screen. A lower view distance is the cure for now.
- **Tests (3 new, 192 in all):** the recording's moves lose only the 722 px one; flicks that
  build up and big moves after big ones are kept; a sudden flick from rest loses one event.
- **Your check (2026-10-27):** quick turns are smooth now on the live site.

## Scope decisions

- **Settings first**, because later steps add to them.
  - Kept in `localStorage` (the racing game's `loadSettings` / `saveSettings`: saved values
    over the defaults, the defaults if storage is blocked), for every world alike.
  - A Settings button in the pause menu and in the world list opens one panel.
  - **What's in it:**
    - view distance 4–16 chunks (8 by default; above 12 says it may be slow on a laptop);
    - field of view 60–100° (75);
    - mouse sensitivity;
    - invert mouse Y;
    - sound volume and mute (M toggles mute in the game).
  - **Applied at once.** View distance changes the loader's radius, the fog and the camera's
    far plane, with no reload: the loader re-sorts its columns and unloads what's now far.
  - `?radius=` still overrides it for measuring.
- **Sky.**
  - *Dome:* a large sphere following the camera, drawn first and without fog. Its colour runs
    from a zenith colour to the horizon colour, and the horizon colour is the fog's, so the
    world's edge melts into it as now. `sky.ts` gains the zenith colours (day, twilight,
    night) beside the horizon ones it has.
  - *Sun and moon:* two square, pixel-art billboards (invented, made at startup like the
    block textures). They travel across the sky opposite each other, on the arc the time of
    day gives (east to west, slightly tilted). At dawn and dusk the dome glows warmer on the
    sun's side.
  - *Stars* at night: a few hundred points on the dome, fading in with darkness.
  - *Clouds:* flat blocky clouds as is usual in voxel games.
    - One horizontal layer at y = 192 (the highest mountains reach about 210, so some peaks
      go through it), following the camera.
    - Cells of 12 × 12 blocks from 2D noise, drawn as one big quad with a small cloud
      texture: one texel a cell, nearest-neighbour, alpha-tested.
    - They drift slowly with the wind, are tinted by daylight, and fade into the fog at the
      edge of the view.
    - One draw call.
- **Fog by biome.** The fog's colour and where it starts follow the biomes at the player's
  position, blended by the climate weights the generator already has, and eased over a few
  seconds so walking across a border doesn't flick:
  - desert: a warm sandy haze, starting nearer;
  - snowy mountains: a pale cold blue-white, starting further away;
  - forest: a slight green;
  - plains: as now.

  The tint is mixed into the time-of-day colour (strong by day, little at night). Under water,
  water fog as now.
- **Animated water.**
  - The water texture scrolls in two directions at once: two lookups of the same layer,
    blended, in the chunk shader.
  - The surface brightness ripples a little.
  - Only water layers move: the shader compares the layer with a `waterLayer` uniform.
  - No moving vertices: the surface stays flush with the shore, and nothing is remeshed.
  - `TUNING.water.flow` sets the speed.
- **Sounds,** synthesised with the Web Audio API like the earlier games.
  - *The engine:* `Sound` from the racing game (context unlocked by the first click, master
    volume, mute, a shared noise buffer).
  - *Each block has a `sound`:* stone, dirt, grass, sand, gravel, snow, wood, leaves, glass,
    water or wool-like soft (for later).
  - *What makes a sound:*
    - **footsteps** while walking on the ground, one per 1.6 blocks walked (faster when
      sprinting), with the material of the block underfoot;
    - **digging** hits about every 0.25 s while breaking, with the block's material;
    - **breaking:** a louder crunch when the block goes;
    - **placing:** a soft thump;
    - **landing** from a fall, louder for a bigger fall;
    - **splashing** into water.
  - *Each material is a recipe:* noise through a filter (band and cut-off), a short envelope,
    and sometimes a pitched click: stone a sharp click, grass a soft rustle, sand and snow a
    crunch, wood a hollow knock, glass a high tick. Pitch and level vary slightly each time.
  - *Testable:* the cadence and the cues (which sound, when, how loud) are pure functions, as
    in five-a-side's `cues.ts`. Only the node graph plays them.
- **Particles when breaking.**
  - 16–24 small cubes (1/8 of a block) burst from the broken block in its colour. The two
    colours per face `BLOCKS` already has are varied a little, and lit by the light where the
    block was.
  - They fall with gravity, bounce once off solid blocks (a point test against the world),
    and fade in about a second.
  - While digging, a few smaller ones every hit.
  - One `InstancedMesh` for all of them (at most 512), one draw call.
- **Held block.**
  - The selected hotbar block, small, at the lower right of the view, drawn after the world
    with its own camera, so it never sinks into walls.
  - Meshed by the chunk mesher as a lone block, so a torch is a torch and leaves have holes.
    It's drawn with the chunk material, lit by the light at the player's eyes.
  - It bobs as you walk, swings when you break or place, and dips briefly when you switch
    blocks.
- **Inventory: creative block picker.**
  - E (or Tab) opens a grid of every placeable block (not air), with their icons and names.
  - Clicking one puts it in the selected hotbar slot. Number keys still pick slots while it's
    open; E or Esc closes it.
  - Creative only: every block, without counts.
  - The hotbar's nine blocks are saved with the world, in its record (worlds from Milestone 4
    get today's hotbar).
  - Icons for every block, made from the textures: a three-face isometric cube (top, side,
    side), drawn on a canvas at startup. The flat side texture would no longer tell grass
    from dirt; the torch keeps its own icon.
- **Out of scope:**
  - wall torches;
  - survival (counts, crafting, health);
  - mobs;
  - weather (rain, snow falling);
  - a hand without a block;
  - music.

## Files

| File | Contents |
| --- | --- |
| `src/settings.ts` | `Settings`, defaults, `loadSettings` / `saveSettings` (after the racing game) |
| `src/ui/settingsPanel.ts` | The settings panel (sliders, toggles), shared by the pause menu and the world list |
| `src/render/sky.ts` | Zenith colours, sun and moon direction from the time of day (pure, as now), plus the `SkyDome` (dome, sun, moon, stars) |
| `src/render/clouds.ts` | Cloud cells from noise (pure), the cloud layer mesh and texture |
| `src/render/fog.ts` | Fog colour and start by biome weights, eased (pure part tested) |
| `src/render/blockMaterial.ts` | Water scrolling and ripple (`time`, `waterLayer` uniforms) |
| `src/audio/sound.ts` | `Sound` (ported), voices per material: step, dig, break, place, land, splash |
| `src/audio/cues.ts` | Pure: footstep cadence, which block is underfoot, landing loudness, digging hits |
| `src/render/particles.ts` | `Particles`: spawn, step (gravity, bounce on solid blocks, fade), one `InstancedMesh` |
| `src/render/heldBlock.ts` | The held block's mesh (mesher on a lone block), its camera, bob and swing |
| `src/ui/inventory.ts` | The block picker grid |
| `src/render/icons.ts` | Isometric block icons from the textures (canvas) |
| `src/world/blocks.ts` | `sound` per block; `PLACEABLE` (every block but air) |
| `src/save/store.ts` | `WorldRecord.hotbar` (optional; old records get the default) |
| `src/game.ts` | Wiring: settings, sky, fog, sounds, particles, held block, inventory |
| `src/chunkLoader.ts` | `setRadius`: re-sort and unload for a new view distance |

## Key data structures

```ts
interface Settings {
  viewDistance: number;   // chunks, 4–16
  fov: number;            // degrees, 60–100
  sensitivity: number;    // radians per pixel × 1000
  invertY: boolean;
  volume: number;         // 0–1
  muted: boolean;
}

type BlockSound = 'stone' | 'dirt' | 'grass' | 'sand' | 'gravel' | 'snow' | 'wood' | 'leaves' | 'glass' | 'water';
interface BlockInfo { /* … as now, plus */ sound: BlockSound }

/** A sound to play, from the cues (pure) to `Sound` (Web Audio). */
type SoundEvent =
  | { name: 'step' | 'dig' | 'break' | 'place'; material: BlockSound; gain: number }
  | { name: 'land'; speed: number }
  | { name: 'splash'; speed: number };

interface WorldRecord { /* … as now, plus */ hotbar?: Block[] }   // nine blocks

// Particles: struct of arrays, at most MAX_PARTICLES.
// position (3), velocity (3), age, life, colour (rgb) as Float32Arrays; dead slots reused.
```

## Tests

- **Settings:**
  - saved values over the defaults;
  - junk in storage gives the defaults;
  - values out of range are clamped;
  - blocked storage still works.
- **Sky:**
  - the sun is overhead at noon and below the horizon at night;
  - the moon is opposite the sun;
  - zenith colours at noon, twilight and midnight;
  - stars fade in only at night.
- **Clouds:** the same cells for the same seed and position, about the intended coverage,
  and drifting with time.
- **Fog by biome:** each biome's own colour and start at a pure point of it; blends between
  them; easing converges; night mutes the tint.
- **Sound cues:**
  - a step every 1.6 blocks on the ground, none in the air or flying;
  - the material comes from the block underfoot (snow on snowy grass, wood on planks);
  - landing loudness rises with fall speed, with nothing for a small hop;
  - a digging hit every 0.25 s while breaking;
  - every block has a sound.
- **Particles:**
  - a break spawns its count;
  - particles fall, never end up inside a solid block, and are gone after their life;
  - the slot limit holds.
- **Held block:** its mesh is the mesher's mesh of a lone block (a torch gives the torch's
  five faces).
- **Inventory:** the picker lists every placeable block once; choosing one fills the
  selected slot; the hotbar round-trips through the world record, and an old record gets the
  default.
- **View distance:** after `setRadius`, the loader meshes exactly the chunks within the new
  radius and unloads beyond it.

## How it's measured

- `?autofly` at radius 8 before and after: the sky, clouds and particles add draw calls and
  fill. Frames over 20 ms, main thread p99, draw calls.
- `?autofly&radius=12` and `=16`, to put numbers next to the settings' warning.
- The cost of a burst of particles and of the held block per frame in `?stats` (main thread).
- Sounds are judged by ear: your playtest.

## Order of work (one commit each, playable after each)

1. Settings: storage, panel (pause menu and world list), view distance at runtime, FOV,
   sensitivity, invert Y.
2. Sky dome with sun, moon and stars; clouds.
3. Fog by biome; animated water.
4. Sounds: the `Sound` port, materials, footsteps, digging, breaking, placing, landing,
   splashing; volume and mute.
5. Particles when breaking and digging.
6. Held block with bob and swing.
7. Inventory: isometric icons, the block picker, the hotbar saved per world.
8. Notes, measurements, playtest questions.

## Questions for you

1. Clouds: flat blocky ones at y = 192 (proposed), or another height or style?
2. Inventory: creative only (every block, no counts), with the hotbar saved per world
   (proposed)?
3. Settings: anything to add, such as night brightness, a stats toggle or GUI scale? Should
   view distance go up to 16, or stop at 12 on account of laptops?
4. Held block only, no hand or arm (proposed)?
5. Sounds: footsteps, digging, breaking, placing, landing and splashing, with no ambient
   sounds (wind, birds, water) for now. Want any ambience?
