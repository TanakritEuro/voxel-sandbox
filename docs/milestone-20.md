# Milestone 20: a better-looking UI

**Status:** plan, to check (2026-11-21).

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
   its layout as it is.
2. **The HUD:** hotbar and item name, health, hunger and air icons (rebuilt only on change), the debug line with stats
   only, toasts, death, loading.
3. **Menus:** world cards with pictures and the live backdrop, the new-world panel, the pause menu with keycaps,
   settings in sections, UI size, UI sounds.
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
