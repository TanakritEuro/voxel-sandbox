# Milestone 5 plan: polish

## Status: in progress (steps 1–4 done; particles next)

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

## Results so far

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
