# Milestone 20: a better-looking UI

**Status:** plan approved (2026-11-21); steps 1–3 built.

## Goal

Make every screen look like it belongs to one game, and a good-looking one: the world list, loading, the HUD,
the pause menu, settings, the block picker, survival's inventory, crafting, furnaces and chests, the map, death.
Today each is a plain dark box over the game (or over a flat gradient), with run-on text, browser-default
controls and a debug line always in the corner. Nothing in the game's rules changes, and the UI must cost no
frame time (some of it costs a little today: the health row is rebuilt every frame).

## What's there now (looked at in the browser, 2026-11-21)

- **World list:** a dark panel on a flat sky-and-grass gradient; worlds as a list of names; a new world as a form.
- **Loading:** a blank sky-blue screen with a dot until the ground is in.
- **HUD:** the debug line (fps, xyz, chunk, tris) always top left; a small dark hotbar; survival's health and
  hunger as plain red and orange rectangles and circles over it.
- **Pause menu:** the world's name, Play, Settings, Save and quit; the keys as two run-on sentences.
- **Settings:** five browser sliders and three toggle buttons, unsorted.
- **Block picker:** one long grid of 57 blocks, no groups or search; it covers the hotbar it fills; small shapes
  (the lantern) get a tiny icon.
- **Survival inventory:** a wide panel with a gap under the slots, no names on hover, a long crafting list with a
  browser scrollbar.
- **Death:** the same dark panel over a red wash.

## Design

### One look (`src/style.css` reorganised, `src/ui/theme.ts` new)

- **Colours and sizes as CSS variables** in one place: slate panels, a light top edge and dark bottom edge (a bevel,
  so panels and buttons read as blocks), a dark outline; amber for what's selected, green for go, red for danger.
- **Buttons** bevelled, pressing down when clicked; a keyboard focus ring on everything; disabled ones dimmed.
- **Sliders, toggles and scrollbars** styled to match (no browser defaults left).
- **A display font for titles and headings:** Pixelify Sans (SIL Open Font Licence), bundled with the game through
  `@fontsource/pixelify-sans` (no request to a font server), recorded in `ASSETS.md`. Body text stays the system font.
- **Motion:** panels fade and rise in (120 ms), toasts slide; none of it when the system asks for reduced motion.
- **UI size** (a new setting, 80–130 %): everything on screen scales together, for small laptops and big screens.

### The title screen (`ui/worldList.ts`, `main.ts`, `backdrop.ts` new)

- **A live world behind the list:** the game itself in a `?backdrop` mode in a frame behind the menu: a fixed seed
  and place, view radius 6, the camera drifting slowly along a path, the time held at early evening, no HUD, input,
  sound or mobs, at most 30 frames a second. It's loaded only after the list is up (the list still comes up
  without Three.js, as now) and fades in; none with reduced motion or `?nobackdrop`; it stops while the tab is hidden.
- **World cards:** each world with a picture of it (a small screenshot taken when you save and quit, 192 × 108 JPEG,
  about 8 KB, kept in its record as `thumb` and checked on load), its name, a creative or survival badge, and when it
  was last played ("2 h ago"). A world never quit from has a picture drawn from its seed's colours.
- **A new world** as its own panel: name, seed, and the two modes as two big cards with a line each.
- **Join a friend** and **Settings** as quieter buttons along the bottom.

### Loading (`game.ts`)

- A panel saying the world is being built, with a bar filling as the columns round the spawn come in, over the
  sky colour, in place of the blank screen.

### The HUD (`game.ts`, `ui/hud.ts` new, `ui/hudIcons.ts` new)

- **The debug line only with F3 or `?stats`** (it's always on now).
- **Hotbar:** bevelled slots a little bigger (44 px), the selected one amber and raised; the selected thing's name
  fades in above the hotbar for 2 s when it changes; counts and tools' wear bars kept.
- **Health and hunger as small invented pixel icons** in place of rectangles and circles: health as red gems,
  hunger as loaves of bread, air as bubbles; drawn from masks (pure, as item art is) at startup. Each half fills.
  Rebuilt only when a value changes (today the row is rebuilt every frame).
- **Toasts** (someone joined, a chest's loot, …) as small panels sliding in.
- **Death:** a darker red vignette, "You died" in the display font, the cause, and Start again.
- The crosshair gets a thin dark outline so it shows on snow and sand.

### The pause menu (`ui/pauseMenu.ts`, `ui/keys.ts` new)

- The world's name, **Resume** first, then Settings and Save and quit.
- **The keys as keycaps** in groups (Moving, Building, Screens), from one table that the help text and the
  settings both use, so they can't drift from what the keys do.
- The mode and playing together as quieter sections below.

### Settings (`ui/settingsPanel.ts`)

- In sections: **Display** (view distance, field of view, resolution, antialiasing, UI size), **Controls** (mouse
  speed, invert), **Sound** (volume, mute), **You** (your name for playing together).

### The block picker (`ui/inventory.ts`, `ui/categories.ts` new)

- **Tabs by kind:** Building, Nature, Light, Logic, Travel, Deep, and All; every placeable block in one tab.
- **A search box**, typed into as soon as the picker opens (it filters by name).
- **Names on hover**; the hotbar along the bottom of the panel, so you see where a block goes; the panel stops above
  the game's hotbar.

### Survival's screens (`ui/backpack.ts`, `ui/tooltip.ts` new)

- **Tooltips:** an item's name, a tool's wear (as a bar and uses left), what food gives, what a furnace makes of it.
- **Inventory and crafting side by side** at the same height; crafting in groups (Basics, Tools, Building,
  Travel, Food) with a "can make" filter.
- **Furnace and chest** in the same frame, the furnace's flame and arrow drawn as pixel art.

### The map and the icons (`render/mapView.ts`, `render/icons.ts`)

- The map in a parchment frame with N marked; the full-screen map with a title bar and its keys as keycaps.
- **Small shapes' icons fill their square** (the lantern, a button, a rail): drawn to the extent of their boxes
  rather than at their true size in a whole block.

### UI sounds (`audio/sound.ts`)

- A soft synthesised click on buttons and a tick when a tab or slot changes, at the game's volume; none when muted.

## Files

| File | Change |
| --- | --- |
| `src/style.css` | reorganised: variables, the look, every screen's styles |
| `src/ui/theme.ts` (new) | the UI size setting applied, reduced motion, the font loaded |
| `src/ui/worldList.ts`, `src/main.ts`, `src/backdrop.ts` (new) | world cards with pictures, the new-world panel, the live backdrop |
| `src/ui/hud.ts`, `src/ui/hudIcons.ts` (new) | hotbar, item name, health, hunger and air icons, toasts, death, loading |
| `src/ui/pauseMenu.ts`, `src/ui/keys.ts` (new) | the pause menu, keycaps from one table |
| `src/ui/settingsPanel.ts`, `src/settings.ts` | sections; UI size |
| `src/ui/inventory.ts`, `src/ui/categories.ts` (new) | tabs, search, names |
| `src/ui/backpack.ts`, `src/ui/tooltip.ts` (new) | tooltips, crafting groups and filter, furnace and chest |
| `src/render/mapView.ts`, `src/render/icons.ts` | the map's frame; small shapes' icons |
| `src/audio/sound.ts` | UI clicks |
| `src/game.ts` | the HUD through `ui/hud.ts`, the debug line only with stats, the picture on quit, loading |
| `src/save/store.ts` | a world record's `thumb`, checked on load |
| `package.json`, `ASSETS.md` | the font |

## Tests

- **Categories:** every placeable block in exactly one tab; search finds by any part of a name, any case.
- **Keys:** every key the game listens for is in the keys table, and nothing in it isn't.
- **Records:** `thumb` kept when it's a small JPEG or PNG data URL, dropped otherwise (too big, not an image).
- **Settings:** UI size cleaned to 80–130 %.
- **HUD icons:** masks the right size; health, hunger and air drawn full, half and empty for each value.
- **Tooltips:** a tool's uses left, food's points, a furnace's product.
- **Crafting groups:** every recipe in one group.
- **World cards:** "played …" for minutes, hours, days, and long ago.

## How to measure

- **Frame time in survival** with the HUD, before and after (the health row no longer rebuilt every frame);
  the same sprint flight as every milestone (warm server).
- **The title screen:** time until the list is up (it must not get slower: the backdrop comes after), and the
  backdrop's frame rate and CPU.
- **Screenshots** of every screen before and after, in the notes.

## Steps

1. **The look:** variables, the font, panels, buttons, sliders, scrollbars, motion, focus; every screen restyled with
   its layout as it is. Done (2026-11-21).
2. **The HUD:** hotbar and item name, health, hunger and air icons (rebuilt only on change), the debug line with stats
   only, toasts, death, loading. Done (2026-11-21).
3. **Menus:** world cards with pictures and the live backdrop, the new-world panel, the pause menu with keycaps,
   settings in sections, UI size, UI sounds. Done (2026-11-21).
4. **Picker and survival screens:** tabs and search, tooltips, crafting groups, furnace and chest, the map's frame,
   small shapes' icons.
5. **Measurements,** screenshots, notes, playtest questions.

## Decisions to agree

1. **A live world behind the title screen** (the game in a frame, loaded after the list). The other way is a
   drawn backdrop (hills, clouds and sun painted from the block textures): cheaper, less alive.
2. **A bundled display font** (Pixelify Sans) for titles and headings; body text stays the system font.
3. **Health as red gems and hunger as loaves** (invented icons; no hearts or drumsticks).
4. **The debug line only with F3 or `?stats`.**
5. **UI sounds** (clicks and ticks).
6. **A UI size setting.**

## Step 1: the look (2026-11-21)

**What's in** (`src/style.css`, rewritten; no layout or code changed):
- **Variables at the top:** the slate panel and its bevel (`--panel`, `--panel-hi`, `--panel-lo`, `--outline`), wells sunk into
  it (`--well`, slots, fields and tracks), raised things on it (`--raised`, buttons), words (`--text`, `--text-dim`,
  `--text-faint`), meaning (amber `--accent` for what's chosen, `--go`, `--danger`, `--health`, `--hunger`, `--air`), and the
  shapes (`--bevel`, `--raise`, `--sink`, `--drop`).
- **Panels:** slate with a light top edge, a dark bottom edge and a dark outline, a soft drop shadow; rising in over
  140 ms when shown.
- **Buttons:** raised, lighter on hover, pressing a pixel down when clicked; Play green, Delete red only on hover;
  what's chosen (a world, a mode, a toggle, a block) amber with dark words; a keyboard focus ring.
- **Fields, sliders and scrollbars:** sunk wells; sliders' thumbs raised amber blocks; scrollbars a raised thumb in a
  sunk track (Chrome and Firefox).
- **Titles and headings** in Pixelify Sans (SIL OFL; 500 and 700, latin only, bundled: 8 KB a weight as WOFF2),
  titles amber with a pixel drop shadow.
- **HUD:** the hotbar a bevelled panel, slots sunk, the selected one amber and glowing; the crosshair outlined so it
  shows on snow; health, hunger and air pips with a highlight; toasts as small panels sliding in.
- **Overlays:** the pause menu, death and the full-screen map over a vignette rather than a flat wash; death's title
  red; the map in a wooden frame; the playing-together code in a sunk box in the display font.
- **Less motion** when the system asks for it: no rising panels, sliding toasts or flickering burn.
- `ASSETS.md`: the font's row.

**In the browser:** the world list, pause menu, settings, block picker and survival inventory looked at, before and
after, saved in `docs/milestone-20/` (`0-…-before`, `1-…`); no console errors. The build's CSS is 8 KB larger with
the font's faces referenced; the faces load only when a title is drawn.

## Step 2: the HUD (2026-11-21)

**A correction to the plan:** it said the health row was rebuilt every frame. It wasn't: `renderVitals` already
skipped redrawing when health, hunger and air were unchanged. What was written every frame was the debug line, which
now isn't while it's hidden.

**What's in:**
- **`ui/hudIcons.ts`:** health as a cut red gem (9 x 9 pixels), hunger as a scored loaf (10 x 7), air as a bubble with a
  glint (8 x 8), each full, half or empty (the same shape, dull when used up; a half loaf fills from the right, as hunger
  fills from the right), from masks; `hudArt` pure, `hudIcons` data URLs, made the first time they're shown, drawn at
  twice their size, crisp.
- **`ui/hud.ts`:** `Vitals` (the rows of icons, redrawn only when a value changes; bubbles over them under water),
  `ItemName` (the selected thing's name in a small panel over the hotbar, fading in when it changes and out after 2 s;
  higher in survival, over the vitals), `Loading` (a panel saying the world is being built, a green bar filling as the
  5 x 5 columns round the player come in, fading away once there's ground to stand on; not over a menu).
- **The hotbar:** slots 44 px (from 40), the selected one raised 3 px as well as amber.
- **The debug line** (fps, place, chunks, tris, the block looked at) only with the stats (F3 or `?stats`), and not
  written at all while hidden.
- **Death:** the vignette, title and cause from step 1; the icons show it (no gems left).
- **Tests (2 new):** the rows' fills for any points; each picture the same shape full, half and empty, half filling one
  side (hunger's the right).

**In the browser:**
- survival (`?survival&kit`): ten gems, six loaves of twelve points filling from the right, "Torch" over the hotbar when
  slot 4 was picked, fading after 2 s; `docs/milestone-20/2-hud.jpg`;
- a world far from anything loaded (`?seed=424242&at=3000,3000`): "Building the world" with the bar at 16 %, gone once
  the land was in; `2-loading.jpg`;
- F3 brings the debug line back and takes it away again;
- death in lava: "You died / You burned." over the vignette; `2-death.jpg`;
- no console errors.

**Measured:** a sprint flight (`?autofly=30`, warm server): no frame over 20 ms, main thread p50 3.6 ms, p99 9.4.

## Step 3: the menus (2026-11-21)

**What's in:**
- **The live backdrop** (`backdrop.ts`, `ui/backdropFrame.ts`): once the world list is up, a frame behind it opens the game
  as `?backdrop&seed=20261022&at=-40,360&radius=6&mobs=0&time=0.31&workers=2`: snowy mountains and spruce forest in the
  morning. In that mode there's nothing on screen but the world (no HUD, menus, held block or sound, no saving), the
  camera drifts at 3.2 blocks a second, 26 blocks over the highest ground 36 blocks ahead, eased, swaying ±0.7 rad
  either side of its heading over 22 s, and the page draws at most 30 frames a second. It tells the list when its view
  is in, and the frame fades in over 1.2 s. None with reduced motion or `?nobackdrop`.
- **World cards:** each world's picture (96 x 54), its name, a Creative or Survival badge, "Played … · seed …". The
  picture is taken on **save and quit** (the world drawn once more without the outline or held block, cropped to 16:9,
  192 x 108 JPEG at 82 %, kept in the record as `thumb`, `thumbOf` dropping anything that isn't a small JPEG or PNG data
  URL); a world never quit from gets a landscape drawn from its seed (`seedScene`: sky, far hills, near hills of grass
  and earth, the sea where the land dips).
- **New world:** name and seed, and the modes as two cards ("Creative: every block to build with, and flying",
  "Survival: gather, craft and take care: health, hunger, the dark").
- **The pause menu:** Resume first (was Play); the keys as keycaps in three columns (Moving, Building, Screens) for the
  world's mode, from `ui/keys.ts`.
- **Settings in sections:** Display (view distance, field of view, resolution, **UI size**, antialiasing), Controls
  (mouse speed, invert), Sound (volume, mute), You (your name, which before could only be set when joining).
- **UI size** (`settings.uiScale`, 80–130 %): a `--ui` variable that panels and the HUD's parts `zoom` by; panels'
  limits divided by it so they still fit the window (at 120 % the settings panel first ran off the top).
- **UI sounds:** a soft synthesised tock on any menu button (world list and game), a tiny tick when the hotbar's slot
  changes by key or wheel.
- **Tests (3 new, 1 updated):** the keys table against every key the source reads (it found right Ctrl and the mouse
  buttons missing from the first table); `thumbOf` (JPEG and PNG kept, too big, HTML, script and broken ones dropped);
  `seedScene` (the same for a seed, different for another, sky over land); UI size cleaned to 80–130 %.

**Measured:**
- **The list comes up as fast as before:** 60–84 ms from the page starting to the first world card, with the backdrop
  or with `?nobackdrop` alike (three loads each, dev server); the backdrop is only added after.
- **The backdrop:** 30 frames a second, main thread 1.0 ms a frame, GPU 5.8 ms (`?backdrop…&stats`, after its view
  was in).

**In the browser:** the list over the gradient, then the mountains fading in behind it and drifting; the new-world
panel; settings in sections at 100 % and 120 %; the pause menu's keycaps; save and quit giving the world's card its
picture; no console errors. Screenshots `docs/milestone-20/3-…`.

**Changed from the plan:**
- **The backdrop is in the morning** (time 0.31), not the plan's early evening; evening light wasn't tried, a playtest question.
- **Ticks only for the hotbar** (tabs come in step 4).

