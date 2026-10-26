`# Milestone 5 plan: polish
`
`## Status: plan, waiting for your OK
`
`Goal from the roadmap:
`- a sky with sun, moon and clouds;
`- fog by biome;
`- water that animates;
`- footstep and digging sounds (synthesised, as in the earlier games);
`- block particles when breaking;
`- a held block;
`- an inventory with a creative-mode block picker;
`- settings (view distance, mouse sensitivity, FOV).
`
`Playable after every step and inside the budget (60 fps on your laptop at radius 8, no frame
`over 20 ms flying). The Milestone 4 playtest is still to come; anything it turns up
`(night brightness, torch reach, cave darkness) is a number in `TUNING` and can be folded in
`along the way.
`
`## Scope decisions
`
`- **Settings first**, because later steps add to them.
`  - Kept in \`localStorage\` (the racing game's \`loadSettings\` / \`saveSettings\`: saved values
`    over the defaults, the defaults if storage is blocked), for every world alike.
`  - A Settings button in the pause menu and in the world list opens one panel.
`  - **What's in it:**
`    - view distance 4–16 chunks (8 by default; above 12 says it may be slow on a laptop);
`    - field of view 60–100° (75);
`    - mouse sensitivity;
`    - invert mouse Y;
`    - sound volume and mute (M toggles mute in the game).
`  - **Applied at once.** View distance changes the loader's radius, the fog and the camera's
`    far plane, with no reload: the loader re-sorts its columns and unloads what's now far.
`  - \`?radius=\` still overrides it for measuring.
`- **Sky.**
`  - *Dome:* a large sphere following the camera, drawn first and without fog. Its colour runs
`    from a zenith colour to the horizon colour, and the horizon colour is the fog's, so the
`    world's edge melts into it as now. \`sky.ts\` gains the zenith colours (day, twilight,
`    night) beside the horizon ones it has.
`  - *Sun and moon:* two square, pixel-art billboards (invented, made at startup like the
`    block textures). They travel across the sky opposite each other, on the arc the time of
`    day gives (east to west, slightly tilted). At dawn and dusk the dome glows warmer on the
`    sun's side.
`  - *Stars* at night: a few hundred points on the dome, fading in with darkness.
`  - *Clouds:* flat blocky clouds as is usual in voxel games.
`    - One horizontal layer at y = 192 (the highest mountains reach about 210, so some peaks
`      go through it), following the camera.
`    - Cells of 12 × 12 blocks from 2D noise, drawn as one big quad with a small cloud
`      texture: one texel a cell, nearest-neighbour, alpha-tested.
`    - They drift slowly with the wind, are tinted by daylight, and fade into the fog at the
`      edge of the view.
`    - One draw call.
`- **Fog by biome.** The fog's colour and where it starts follow the biomes at the player's
`  position, blended by the climate weights the generator already has, and eased over a few
`  seconds so walking across a border doesn't flick:
`  - desert: a warm sandy haze, starting nearer;
`  - snowy mountains: a pale cold blue-white, starting further away;
`  - forest: a slight green;
`  - plains: as now.
`
`  The tint is mixed into the time-of-day colour (strong by day, little at night). Under water,
`  water fog as now.
`- **Animated water.**
`  - The water texture scrolls in two directions at once: two lookups of the same layer,
`    blended, in the chunk shader.
`  - The surface brightness ripples a little.
`  - Only water layers move: the shader compares the layer with a \`waterLayer\` uniform.
`  - No moving vertices: the surface stays flush with the shore, and nothing is remeshed.
`  - \`TUNING.water.flow\` sets the speed.
`- **Sounds,** synthesised with the Web Audio API like the earlier games.
`  - *The engine:* \`Sound\` from the racing game (context unlocked by the first click, master
`    volume, mute, a shared noise buffer).
`  - *Each block has a \`sound\`:* stone, dirt, grass, sand, gravel, snow, wood, leaves, glass,
`    water or wool-like soft (for later).
`  - *What makes a sound:*
`    - **footsteps** while walking on the ground, one per 1.6 blocks walked (faster when
`      sprinting), with the material of the block underfoot;
`    - **digging** hits about every 0.25 s while breaking, with the block's material;
`    - **breaking:** a louder crunch when the block goes;
`    - **placing:** a soft thump;
`    - **landing** from a fall, louder for a bigger fall;
`    - **splashing** into water.
`  - *Each material is a recipe:* noise through a filter (band and cut-off), a short envelope,
`    and sometimes a pitched click: stone a sharp click, grass a soft rustle, sand and snow a
`    crunch, wood a hollow knock, glass a high tick. Pitch and level vary slightly each time.
`  - *Testable:* the cadence and the cues (which sound, when, how loud) are pure functions, as
`    in five-a-side's \`cues.ts\`. Only the node graph plays them.
`- **Particles when breaking.**
`  - 16–24 small cubes (1/8 of a block) burst from the broken block in its colour. The two
`    colours per face \`BLOCKS\` already has are varied a little, and lit by the light where the
`    block was.
`  - They fall with gravity, bounce once off solid blocks (a point test against the world),
`    and fade in about a second.
`  - While digging, a few smaller ones every hit.
`  - One \`InstancedMesh\` for all of them (at most 512), one draw call.
`- **Held block.**
`  - The selected hotbar block, small, at the lower right of the view, drawn after the world
`    with its own camera, so it never sinks into walls.
`  - Meshed by the chunk mesher as a lone block, so a torch is a torch and leaves have holes.
`    It's drawn with the chunk material, lit by the light at the player's eyes.
`  - It bobs as you walk, swings when you break or place, and dips briefly when you switch
`    blocks.
`- **Inventory: creative block picker.**
`  - E (or Tab) opens a grid of every placeable block (not air), with their icons and names.
`  - Clicking one puts it in the selected hotbar slot. Number keys still pick slots while it's
`    open; E or Esc closes it.
`  - Creative only: every block, without counts.
`  - The hotbar's nine blocks are saved with the world, in its record (worlds from Milestone 4
`    get today's hotbar).
`  - Icons for every block, made from the textures: a three-face isometric cube (top, side,
`    side), drawn on a canvas at startup. The flat side texture would no longer tell grass
`    from dirt; the torch keeps its own icon.
`- **Out of scope:**
`  - wall torches;
`  - survival (counts, crafting, health);
`  - mobs;
`  - weather (rain, snow falling);
`  - a hand without a block;
`  - music.
`
`## Files
`
`| File | Contents |
`| --- | --- |
`| `src/settings.ts` | `Settings`, defaults, `loadSettings` / `saveSettings` (after the racing game) |
`| `src/ui/settingsPanel.ts` | The settings panel (sliders, toggles), shared by the pause menu and the world list |
`| `src/render/sky.ts` | Zenith colours, sun and moon direction from the time of day (pure, as now), plus the `SkyDome` (dome, sun, moon, stars) |
`| `src/render/clouds.ts` | Cloud cells from noise (pure), the cloud layer mesh and texture |
`| `src/render/fog.ts` | Fog colour and start by biome weights, eased (pure part tested) |
`| `src/render/blockMaterial.ts` | Water scrolling and ripple (`time`, `waterLayer` uniforms) |
`| `src/audio/sound.ts` | `Sound` (ported), voices per material: step, dig, break, place, land, splash |
`| `src/audio/cues.ts` | Pure: footstep cadence, which block is underfoot, landing loudness, digging hits |
`| `src/render/particles.ts` | `Particles`: spawn, step (gravity, bounce on solid blocks, fade), one `InstancedMesh` |
`| `src/render/heldBlock.ts` | The held block's mesh (mesher on a lone block), its camera, bob and swing |
`| `src/ui/inventory.ts` | The block picker grid |
`| `src/render/icons.ts` | Isometric block icons from the textures (canvas) |
`| `src/world/blocks.ts` | `sound` per block; `PLACEABLE` (every block but air) |
`| `src/save/store.ts` | `WorldRecord.hotbar` (optional; old records get the default) |
`| `src/game.ts` | Wiring: settings, sky, fog, sounds, particles, held block, inventory |
`| `src/chunkLoader.ts` | `setRadius`: re-sort and unload for a new view distance |
`
`## Key data structures
`
````ts
`interface Settings {
`  viewDistance: number;   // chunks, 4–16
`  fov: number;            // degrees, 60–100
`  sensitivity: number;    // radians per pixel × 1000
`  invertY: boolean;
`  volume: number;         // 0–1
`  muted: boolean;
`}
`
`type BlockSound = 'stone' | 'dirt' | 'grass' | 'sand' | 'gravel' | 'snow' | 'wood' | 'leaves' | 'glass' | 'water';
`interface BlockInfo { /* … as now, plus */ sound: BlockSound }
`
`/** A sound to play, from the cues (pure) to `Sound` (Web Audio). */
`type SoundEvent =
`  | { name: 'step' | 'dig' | 'break' | 'place'; material: BlockSound; gain: number }
`  | { name: 'land'; speed: number }
`  | { name: 'splash'; speed: number };
`
`interface WorldRecord { /* … as now, plus */ hotbar?: Block[] }   // nine blocks
`
`// Particles: struct of arrays, at most MAX_PARTICLES.
`// position (3), velocity (3), age, life, colour (rgb) as Float32Arrays; dead slots reused.
````
`
`## Tests
`
`- **Settings:**
`  - saved values over the defaults;
`  - junk in storage gives the defaults;
`  - values out of range are clamped;
`  - blocked storage still works.
`- **Sky:**
`  - the sun is overhead at noon and below the horizon at night;
`  - the moon is opposite the sun;
`  - zenith colours at noon, twilight and midnight;
`  - stars fade in only at night.
`- **Clouds:** the same cells for the same seed and position, about the intended coverage,
`  and drifting with time.
`- **Fog by biome:** each biome's own colour and start at a pure point of it; blends between
`  them; easing converges; night mutes the tint.
`- **Sound cues:**
`  - a step every 1.6 blocks on the ground, none in the air or flying;
`  - the material comes from the block underfoot (snow on snowy grass, wood on planks);
`  - landing loudness rises with fall speed, with nothing for a small hop;
`  - a digging hit every 0.25 s while breaking;
`  - every block has a sound.
`- **Particles:**
`  - a break spawns its count;
`  - particles fall, never end up inside a solid block, and are gone after their life;
`  - the slot limit holds.
`- **Held block:** its mesh is the mesher's mesh of a lone block (a torch gives the torch's
`  five faces).
`- **Inventory:** the picker lists every placeable block once; choosing one fills the
`  selected slot; the hotbar round-trips through the world record, and an old record gets the
`  default.
`- **View distance:** after `setRadius`, the loader meshes exactly the chunks within the new
`  radius and unloads beyond it.
`
`## How it's measured
`
`- `?autofly` at radius 8 before and after: the sky, clouds and particles add draw calls and
`  fill. Frames over 20 ms, main thread p99, draw calls.
`- `?autofly&radius=12` and `=16`, to put numbers next to the settings' warning.
`- The cost of a burst of particles and of the held block per frame in `?stats` (main thread).
`- Sounds are judged by ear: your playtest.
`
`## Order of work (one commit each, playable after each)
`
`1. Settings: storage, panel (pause menu and world list), view distance at runtime, FOV,
`   sensitivity, invert Y.
`2. Sky dome with sun, moon and stars; clouds.
`3. Fog by biome; animated water.
`4. Sounds: the `Sound` port, materials, footsteps, digging, breaking, placing, landing,
`   splashing; volume and mute.
`5. Particles when breaking and digging.
`6. Held block with bob and swing.
`7. Inventory: isometric icons, the block picker, the hotbar saved per world.
`8. Notes, measurements, playtest questions.
`
`## Questions for you
`
`1. Clouds: flat blocky ones at y = 192 (proposed), or another height or style?
`2. Inventory: creative only (every block, no counts), with the hotbar saved per world
`   (proposed)?
`3. Settings: anything to add, such as night brightness, a stats toggle or GUI scale? Should
`   view distance go up to 16, or stop at 12 on account of laptops?
`4. Held block only, no hand or arm (proposed)?
`5. Sounds: footsteps, digging, breaking, placing, landing and splashing, with no ambient
`   sounds (wind, birds, water) for now. Want any ambience?
