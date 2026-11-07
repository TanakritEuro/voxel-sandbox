# Milestone 13: homes

**Plan approved (2026-11-07)** as proposed, with real thin collision. One change while building:
a bed is **half a block high**, not 9/16. Texture coordinates are whole bytes with v's fractions
only in eighths, so a side 9/16 high can't show the texture cropped to its height; 1/2 can.

**Goal.** Something to build a home for, and things to keep in it:
- **chests** to store what you gather;
- **doors** that open by hand or by a signal, and that the gloamer can't get through;
- **a bed** that sleeps through the night and is where you wake after dying;
- **farming:** tilled earth, seeds, wheat growing in the light, bread.

Creative gets the blocks too (chests, doors and beds work there; nothing grows untended in a way that
matters). The budget holds: 60 fps at radius 8 beside a field of 500 growing wheat, no frame over
20 ms.

## Chests
- A wooden box with a latch on its front, placed facing you. **27 slots** (three rows of nine).
- **Right click opens it** on the inventory screen, in place of crafting, as a furnace does.
  - Click, right click and Shift-click move things between the chest and the inventory.
- **Its contents are saved** in the world record by place, as furnaces' are. Breaking it drops them.
- **Made from 8 planks.**
- Two chests side by side stay two chests (they don't join into a big one).

## Doors
- **Two blocks tall,** a thin panel (3/16 of a block) on the side of its block nearest you as you
  place it, hinged on your left.
  - Placing needs both blocks free and floor under the lower one.
  - Breaking either half takes the whole door (one door back in survival).
- **Right click opens and closes it:** it swings a quarter turn to the hinge side.
- **A signal opens it** while it has one: a powered wire, a switch that's on, a button, a charged
  block beside either half. It closes when the signal goes. A click still flips it in between, as
  a lamp has no click but a door does.
- **Mobs can't open doors.** A closed door is a wall to their paths, so a gloamer can't come in.
- **Made from 6 planks** (one door).
- Light goes through a door as through glass (it's a panel, not a wall).

## Beds
- **Two blocks long,** head and foot, half a block tall (planned 9/16), placed with the head away from you.
  Needs both blocks free.
- **Right click a bed:**
  - **In survival, it becomes where you wake** after dying: "You'll wake here."
  - **At night** (the sun down, daylight under 0.3) you lie down. After 2 s of the screen dimming,
    morning comes (time 0.27, a little after sunrise) and you get up.
  - **Not with a gloamer within 8 blocks:** "You can't sleep with something near."
  - **By day:** "You can only sleep at night." It's still where you wake.
- Moving (any movement key), being hit or dying gets you up.
- **Dying with a bed:** you wake beside it. If it's gone: at the world's spawn, "Your bed was missing."
- **Made from 3 planks and 3 moss.** Moss (new) comes from mossbacks, 1–2 with their meat.

## Farming
- **Tilling:** right click grass or dirt with a spade, air above it: it becomes **farmland**
  (dark, furrowed earth). The spade wears a little.
- **Seeds:** grass dug up gives seeds one time in eight.
- **Planting:** right click the top of farmland with seeds: wheat, stage 0 of 7.
- **Growing:**
  - in light 9 or more (the sun by day, or torches and lamps at any time), a stage about every 70 s:
    about 8 minutes from seed to ripe;
  - in the dark it waits;
  - only in loaded land, as furnaces burn only there.
- **Harvesting:** breaking ripe wheat gives 1 wheat and 1–3 seeds; unripe, just its seed back.
- Wheat goes when the farmland under it is broken. Farmland broken gives dirt.
- **Bread:** 3 wheat, food for 5.
- No watering and no trampling. Water may come later, if the farms want it.

## Design

### 1. Shapes and collision (`world/blocks.ts`, `world/physics.ts`, `mesh/mesher.ts`, `world/raycast.ts`)
- **Block ids** from 106:

  | Ids | Block |
  | --- | --- |
  | 106–109 | chests, by facing |
  | 110–125 | doors: facing × closed/open × lower/upper (`door`, `doorOf`) |
  | 126–133 | beds: facing × foot/head (`bed`, `bedOf`) |
  | 134 | farmland |
  | 135–142 | wheat, stages 0–7 (`wheat`, `wheatStage`) |

- **`BlockInfo.box`:** a block's collision box in sixteenths when it isn't a whole cube (a door's panel
  on its side, a bed's half).
  - `physics.ts`'s sweep stops against the box, not the cell.
  - `overlapsBlock` (placing) and the raycast use the box; the outline is drawn round it.
- **Mesher shapes:**
  - `panel` (a door, its face turned by facing and open, upper and lower textures);
  - `slab` (a bed, top and side textures by head and foot);
  - `cross` (wheat: two crossed quads in the cutout pass, a texture per stage).
- **Textures** (procedural): chest side, front and top; door lower and upper (a window in the upper);
  bed head, foot and sides; farmland; wheat's 8 stages; the moss, seeds, wheat and bread pictures.
- **Blocks in pairs** (`world/parts.ts`, pure): a door's or bed's other half. Placing makes both;
  breaking one takes both, as torches go with what holds them. Shared with the guest's edits.

### 2. Doors (`world/logic.ts`, `world/blocks.ts`, `game.ts`)
- `useBlock` flips a door (both halves).
- **`LogicFlow`:** doors are consumers, like lamps: when anything beside either half changes, the
  door is set open or closed by whether it has a signal. A door is only set when its signal
  changes, so a click lasts until then.
- **Mobs:** `pathfind.ts` takes a closed door as solid and an open one as open; a bed as a block to
  stand on.

### 3. Chests (`survival/chest.ts` pure, `ui/backpack.ts`, `save/store.ts`)
- **`Containers`** by place, saved in the record (`containers`), holding chests' 27-slot
  inventories. `Furnaces` stays as it is.
- **The screen:** a chest part above the inventory, in place of crafting.
- Breaking drops what's in it.

### 4. Farming (`survival/farming.ts` pure)
- **`Crops`:** wheat by place, with seconds grown, saved in the record (`crops`).
  - Stepped once a second for those in loaded land, by the light at each.
  - A stage's change goes in one batch with its light and remeshing in the workers, as furnaces'
    lighting does.
- **Tilling and planting** in `survival/play.ts`. Seeds and drops in `survival/drops.ts`.

### 5. Beds (`game.ts`, `survival/sleep.ts` pure)
- **`canSleep(daylight, hostilesNear)`**, and the spawn kept in the survival record (`bed`), cleaned
  on load.
- **Lying down:** the camera at the bed, the player held still, the screen dimming. Then the time is
  set to morning (saved), and the player gets up beside the bed.

### 6. Together (`net/`)
- **Chests are the host's,** as furnaces are: the furnace messages become container messages for
  any block with slots (`open`, `container`, `put`, `take`, slots 0–26). `hostSurvival` checks a chest
  as it does a furnace.
- **Doors:** a click is a use, made by the host as switches are (both halves).
- **Crops are the host's:** they grow there, and their stages reach guests as edits.
- **Sleeping:** a player in bed says so in their state (a flag in the 80 bytes). The night is
  skipped only when everyone is in bed; until then: "Waiting for the others to sleep (1 of 2)."
- **A guest's bed** is kept with their survival state by name.
- `PROTOCOL` 5.

## Files
- **New:** `world/parts.ts`, `survival/chest.ts`, `survival/farming.ts`, `survival/sleep.ts`, tests.
- **Changed:**
  - `world/` (blocks, textures, physics, raycast, logic);
  - `mesh/mesher.ts`, `mobs/pathfind.ts`;
  - `survival/` (items, drops, crafting, play), `ui/backpack.ts`, `render/` (outline, icons);
  - `save/store.ts`, `net/` (protocol, session, hostSurvival, playerState);
  - `game.ts`, `config.ts`, `style.css`, CLAUDE.md.

## Tests (headless)
- **Collision:** a player walks up to a closed door's panel and stops at it (not at the cell); walks
  through an open one; stands on a bed at 1/2; can't place a block where a door's panel is.
- **Mesher:** a door is 6 quads, turned by facing and open; a bed slab; wheat as 4 quads (two crossed,
  both sides) in the cutout pass; counter-clockwise from outside.
- **Pairs:** placing a door makes both halves, and is refused without room or floor; breaking either
  takes both; the same for a bed.
- **Doors and logic:** a switch beside the lower half opens it, off closes it; a signal at the upper
  half does too; a click flips it and lasts until the signal changes; a gloamer's path goes round a
  closed door and through an open one.
- **Chests:** put, take, Shift moves, save and load round trip, breaking drops all 27.
- **Farming:** tilling grass and dirt (not stone, not under a block); planting only on farmland;
  a stage every 70 s in light 9, none in the dark; ripe gives wheat and seeds, unripe a seed;
  breaking farmland takes the wheat; save round trip.
- **Sleeping:** refused by day and with a gloamer within 8 blocks; at night, morning comes; dying
  wakes you at the bed, or at the spawn if it's gone.
- **Together** (over the loopback): a guest's chest put and take made by the host; a guest's door
  click seen by everyone; the night skipped only when both are in bed.

## Measuring
- **`npm run bench`:**
  - 1,000 wheat growing, stepped as the game steps them: ms a second, and a stage's batch;
  - player physics with doors and beds about (the box sweep against the cube one).
- **In the browser** (radius 8): frame and main-thread time beside a 500-wheat field (`?farm`, new:
  a field planted round the player), against the same place without.
- **Target:** no frame over 20 ms; under 0.5 ms a frame on average for crops, chests and doors together.

## Steps (each built, tested, measured, committed and pushed)
1. **Shapes:** the new blocks and textures, collision boxes, the mesher's panel, slab and cross,
   blocks in pairs. Built (2026-11-07).
2. **Doors:** opening by hand and by signal, mobs kept out. Built (2026-11-07).
3. **Chests:** contents, the screen, saving, drops. Built (2026-11-07).
4. **Farming:** farmland, seeds, wheat growing, harvest, bread. Built (2026-11-07).
5. **Beds:** sleeping through the night, waking at the bed, moss. Built (2026-11-07).
6. **Together:** containers, doors, crops and sleeping for guests.
7. **Measurements,** notes and playtest questions.

## Decisions to agree
- **Real thin collision:** a door's panel and a bed's height are what you bump into, not the whole
  block. This is the bigger piece of step 1. The simpler choice is a closed door blocking its
  whole block and a bed being a full block to climb.
- **Doors:** hinged on the left as placed, no double doors joining, opened by a signal while it lasts,
  and gloamers can't open them.
- **Sleeping:** only at night, not with a gloamer within 8 blocks; it skips to morning and sets where
  you wake. Together, everyone must be in bed.
- **Farming:** seeds from grass (one in eight); wheat needs light 9 or more, grows only in loaded
  land, about 8 minutes from seed to ripe; no water needed; tilling with the spade (no hoe).
- **Chests:** 27 slots; two side by side stay two.
- **Beds from planks and moss** (from mossbacks), 3 of each.
- **Names:** chest, door, bed, farmland, wheat, seeds, bread, moss.

## Step 1: shapes — built (2026-11-07)

**What's there:**
- **Block ids** 106–142, as planned:
  - chests by facing;
  - doors by facing, open and half;
  - beds by facing and half;
  - farmland;
  - wheat by stage.
  - `chest`/`chestOf`, `door`/`doorOf`, `doorSide`, `bed`/`bedOf`, `wheat`/`wheatStage`.
  - The picker offers the chest, the door and the bed. Farmland and wheat come with farming
    (step 4).
- **Collision boxes** (`BlockInfo.box`):
  - a door's panel, 3/16 thick, against the side nearest the player who placed it when closed,
    or the side on their left when open;
  - a bed, half a block high.
  - `physics.ts`'s sweep stops at a box's face, even inside a block the body is already in. A box
    it already overlaps doesn't stop it.
  - `overlapsBlock` takes the block, so placing near a door counts only its panel.
  - The raycast passes through a door's block beside the panel and hits the panel with its face.
  - The outline is drawn round the box.
- **Mesher:**
  - `panel` and `slab` (`piece`): the box's faces, those on the block's side against something
    opaque left out. Each face shows the part of its texture where it is in the block; a bed's top
    is turned the way its head points.
  - `cross` (wheat): two sheets corner to corner, both sides, in the cutout pass.
- **Textures:**
  - chest top, side and front (an iron latch);
  - door lower (a brace and handle) and upper (a four-pane window);
  - bed head (pillow), foot and side;
  - farmland's furrows;
  - wheat's 8 stages;
  - the door's and bed's pictures for the hotbar.
- **Blocks in pairs** (`world/parts.ts`):
  - placing a door or bed makes both halves, or neither (no room, no floor, or the player in the way);
  - breaking either takes the other, giving one door or bed;
  - a guest's break of one half is made with its partner on the host.
- **Survival and together:**
  - either half or any facing gives one door, bed or chest; farmland gives dirt;
  - the axe digs chests, doors and beds faster, the spade farmland;
  - a guest may set chests, closed doors and beds facing any way (not a door open).

**Fixed while looking:** a bed's sides showed one row of its texture stretched up them. Texture
coordinates are whole bytes, so 0.5625 became 0. Sides now go up in eighths, which is why the bed is
half a block high. A test checks the eighths.

**Tests** (17 new, 437 in all, `tests/homes.test.ts`):
- **Ids:** every state's id reads back.
- **Doors:** which side the panel is on (closed and open, two facings). A chest is placed facing the
  player.
- **Collision:**
  - stopped at a closed door's panel from its far side, 3/16 in from the block's side;
  - through an open door beside its panel, and stopped against its side;
  - standing on a bed at 1/2, walking along it and off the end, stopped at its side;
  - overlapping a door's block only where the panel is.
- **Raycast:**
  - onto a panel from either side with the right face;
  - along a door's block beside its panel, through it;
  - onto a bed's top at 1/2, and over it.
- **Mesher:**
  - a door is 6 quads at its panel, facing out, for three states;
  - a bed's slab is 6 quads, its sides' texture in eighths, its faces against stone hidden;
  - wheat is 4 quads in the cutout pass and doesn't hide the farmland.
- **Pairs:**
  - a door's two halves, refused under a block or with no floor;
  - a bed's foot and head the way the player looks, refused over a hole or against a block;
  - a half's partner found, open or closed, and not a different door's.
- **Survival:** drops, tools, and what a guest may set.

**Bench** (`player physics`: the same 120 s walk, 468 blocks either way; `ground items`):

| | µs a player step | items on land, at rest: median ms a frame | items over the sea, floating |
| --- | --- | --- | --- |
| Before (whole blocks only) | 1.94 | 0.114 | 0.184 |
| Looking inside the blocks it's in, every move | 4.30 | 0.127 | 0.343 |
| Only with a door or bed about (`nearBox`, once a move) | 2.99 | 0.123 | 0.244 |

- Each block looked at builds a string key for its chunk, so every extra one costs.
- Now a move looks once at the blocks the box could reach. Only if there's a door or bed there do
  its three sweeps look inside the blocks the body is already in.
- 0.006 ms a frame for the player's two steps.

**Looked at in the browser** (`?seed=7&nolock`, creative):
- the chest, door and bed in the picker;
- placed on the grass: the chest's latch towards the player, the door's window above its brace,
  the bed's pillow at the far end and its side blanket, sheet and frame (after the fix);
- walking into the door stopped at its face (z 6.3, against the block's side, as planned for the
  near side);
- breaking its lower half took the upper too.
- No console errors.

## Step 2: doors — built (2026-11-07)

**What's there:**
- **A click opens and shuts a door,** both halves.
  - `useBlock` flips a half; `useAt` (`world/parts.ts`) gives both, used by the game and the host.
  - Shift and a click builds against it, as with the other blocks you use.
- **A signal opens it:** `LogicFlow` looks at doors as it does lamps (step 6 of its tick).
  - It opens while a powered wire, a source that's on, or a gate facing it is beside either half,
    and shuts when the signal goes.
  - Each door's last signal is kept, so a door is set only when its signal changes, and a click
    lasts until then. A door seen for the first time opens if it has a signal.
  - A door that's gone is forgotten, so a new one in its place starts afresh.
  - **Changed from what I first wrote:** I woke doors when their column loads. A test showed it
    isn't needed. Loading wakes every logic block and its six neighbours, and anything that can
    signal a door is a logic block beside it. Taken out.
- **Mobs:** a closed door is a wall to their paths, an open one a way through. Mobs can't open
  doors.
- **Made from 6 planks.**
- **Together:**
  - a guest's click is a use made by the host, both halves;
  - `HostWorld.use` now returns the places it set, and the session shares all of them (it shared
    only the block clicked, so the other guests saw half a door open: found by the test);
  - a refused click puts back both halves on the guest's screen.

**Tests** (9 new, 446 in all: `tests/doors.test.ts`, one in `tests/logic.test.ts`, one in
`tests/session.test.ts`):
- **By hand:** both halves from a click on either; a lone half alone; nothing to use, null.
- **Recipe:** made from 6 planks, not 5.
- **Signals:**
  - a switch beside the lower half opens it and shuts it;
  - a charged block beside the upper half, and powered wire to the lower, open it;
  - shut by hand while powered, it stays shut, and opens with the next signal;
  - opened by hand with no signal, it stays open;
  - a new door where a powered one was broken opens too.
- **Loading:** a door opened by a switch, saved and loaded, shuts when the switch goes off.
- **Mobs:** a path goes through an open door in a wall, and there's none through a closed one.
- **Together:**
  - a guest's click on the upper half opens both on its screen at once, and on the host and the
    other guest after;
  - the other guest shuts it from the lower half;
  - refused, both halves are put back.

**Bench** (`logic`): doors add a check to the tick's look round what changed. Within noise:
- the 32 × 32 grid: p95 2.12 ms before, 2.10 after;
- the 50-stage chaser: median 0.54 before, 0.49 after.

**Tried in the browser** (`?seed=7&nolock`, creative):
- a door placed and clicked swung its panel to the left side, and the crosshair reached the grass
  through it;
- walked through it (z 8.5 to 0.7);
- a second door with a switch beside it opened with the switch on and shut with it off.
- No console errors.

## Step 3: chests — built (2026-11-07)

**What's there:**
- **`Chests`** (`survival/chest.ts`; the plan called it `Containers`): 27 slots for each chest, by place.
  - Saved in the world record (`containers`); empty chests aren't kept.
  - Cleaned on load as an inventory is: a bad place is dropped, and so is a stack over its size or
    something that isn't an item.
- **A right click opens a chest** (survival) on the inventory screen, a Chest part in place of
  crafting.
  - Click, right click and Shift-click work as on the inventory's slots.
  - Shift and a click moves a stack between the chest and the inventory, as much as fits
    (`moveAll`).
- **Breaking a chest** drops what's in it, and closes it if it was open. A guest's break is made on
  the host, and the contents drop there.
  - Furnaces and chests now share this (`containerGone`).
- **Made from 8 planks;** the axe digs it faster.
- **Not yet:**
  - **A guest's click on a chest** says "A friend's chests can't be opened yet." (step 6).
  - **In creative** a chest is only a block: there's no inventory to fill it from, so a click builds
    against it.
- Also: a comment for `guestHit` had been left above the furnace's function in Milestone 12;
  it's back with its function.

**Tests** (5 new, 451 in all, `tests/chest.test.ts`):
- 27 slots kept by place; a broken one forgotten, giving what was in it (stacks and a worn tool).
- Saved without empty chests and loaded back; junk cleaned.
- Through the world record in a store and back.
- Shift moves between a chest and the inventory, as much as fits, and back; an empty slot does
  nothing.
- Made from 8 planks, not 7.

**Bench** (`chests`, new): 100 full chests (2,700 stacks) are 60 KB of JSON in the record.
- Saving (every 10 s, and on leaving): 0.55 ms.
- Loading: 1.3 ms.
- Nothing a frame.

**Tried in the browser** (`?seed=7&survival&kit&nolock`):
- a chest made from planks on the inventory screen and moved to the hotbar;
- placed, and opened with a right click: the Chest part below the inventory (the screen wraps at
  this window's width);
- coal, raw iron and berries Shift-clicked in;
- closed and opened again, all still there;
- broken with the stone axe: the chest and all three picked up again walking over.
- No console errors.

## Step 4: farming — built (2026-11-07)

**What's there** (numbers in `TUNING.survival.farming`):
- **Tilling:** a spade's right click on grass or dirt with air above makes farmland, and wears the
  spade by one.
- **Seeds:** grass dug up gives seeds one time in eight, with its dirt.
- **Sowing:** seeds' right click on the top of farmland with air above: wheat at stage 0.
- **Growing** (`survival/farming.ts`, `Crops`, saved in the record's `crops`):
  - a stage every 70 s, give or take a fifth for each plant and stage (from its place), so a field
    doesn't grow in step: about 8 minutes from seed to ripe;
  - only in light 9 or more (the sun by the daylight, or a torch's light), and only in loaded land;
  - a stage's change is made as a tick of water's is (light, remeshing in the workers, guests told).
- **Harvest:**
  - ripe wheat gives 1 wheat and 1–3 seeds; unripe, its seed back;
  - wheat goes with the farmland under it, as torches go with their block;
  - farmland gives dirt.
- **Bread:** 3 wheat, food for 5.
- **Items:** seeds, wheat and bread, with pictures (seeds scattered, a tied sheaf, a loaf).
- **`?kit`** adds 16 seeds and 6 wheat.
- **`?farm`** (new) plants a field round the player at random stages, up to 528 on whatever grass or
  dirt is there, for measuring.
- **Not yet:** a guest's spade or seeds say "Farming in a friend's world can't be done yet."
  (step 6).

**Fixed on the way:** `torchSupport` took every block that isn't a cube as standing on the block
below, so since step 1 breaking the floor under a door or bed would have taken only that half.
Now a door's lower half and wheat stand on the block below, and a door's upper half goes with its
lower one. A bed stands on its own.

**Changed while measuring:** I first stepped every plant once a second.
- The bench gave 0.4–1.0 ms a step (5–6 ms at worst) for 1,000, splitting each place's key back into
  numbers.
- Now each plant keeps its numbers, and the game steps the crops every frame, a slice of them each
  time. Each plant is looked at about once a second and grows by the time since it was last looked at.
- The time in unloaded land or the dark doesn't count.

**Tests** (11 new, 462 in all, `tests/farming.test.ts`):
- **Tilling and sowing:** tilling grass and dirt, not stone, sand or anything under a torch; sowing
  only on farmland with air above.
- **What wheat stands on:** wheat and a door's lower half stand on the block below; a door's upper
  half and a bed don't.
- **Growing:**
  - six plants in full light reach ripe in 0.8–1.2 of 8 minutes, each stage when its own time says
    (to the second), not all in step, then stop;
  - every stage of 40 places is between 0.8 and 1.2 of 70 s;
  - light: 9 or more grows, the sun at half daylight doesn't, a torch's 10 at night does, the dark
    doesn't (600 s at stage 0);
  - unloaded land waits;
  - a plant that isn't wheat any more is forgotten;
  - saved and loaded with its seconds, junk dropped.
- **Harvest:** seeds from grass by the roll; ripe wheat 1 wheat and 1–3 seeds; unripe a seed; bread
  of 3 wheat, food for 5.

**Bench** (`crops`, new: 1,000 wheat in full sun, 10 minutes at 60 frames a second, all ripe by the
end):
- before the change: 0.36–0.98 ms a step once a second (it varied run to run), 3–6 ms at worst;
- after it: 0.006 ms a frame median, 0.012–0.014 p95, 1.2–1.5 worst; at most 5 stages in a frame.

**In the browser** (the browser pane, `?seed=7&survival&nolock&stats&time=0.5&mobs=0`, radius 8;
the machine was busier than in Milestone 12's measurements, so the baseline is higher):

| | main thread, ms a frame (avg, a second at a time) |
| --- | --- |
| No field | 2.5–2.6 |
| `?farm` (about 500), in view | 2.8–3.4, about 3.1 |
| The same at midnight (nothing grows) | 3.1 |
| The same with the crops not stepped (a throwaway flag, taken out) | 2.8–3.2 |
| The same, looking at the sky | 2.4–2.5 |

- The field costs about 0.5 ms of main thread while it's in view, whether it grows or not. It's
  drawing it, not growing it.
- The GPU time was the same, 3.2–3.4 ms, with it and without.
- I couldn't find what on the main thread grows with the wheat in view: the draw calls go up by 1–3
  and the plants are in the cutout pass with the leaves. Inside the budget; for the laptop
  measurement.

**Tried in the browser** (`?seed=7&survival&kit&nolock`):
- the iron spade tilled two grass blocks to furrowed farmland;
- seeds sowed both, 16 to 14, sprouts showing;
- `?farm`'s field drew every stage from sprouts to tall green-gold stalks;
- breaking wheat and farmland gave seeds and dirt, picked up walking over them.
- No console errors.

## Step 5: beds — built (2026-11-07)

**What's there** (numbers in `TUNING.sleep`):
- **A right click on a bed** (either half; Shift builds against it):
  - in survival it becomes where you wake after dying, "You'll wake here." It's kept with the
    inventory and health (`SurvivalRecord.bed`, the foot's place, cleaned by `bedFrom`); a guest's
    goes to the host with the rest and is kept by name;
  - by day (daylight 0.3 or more): "You can only sleep at night.";
  - with a hostile mob within 8 blocks: "You can't sleep with something near.";
  - otherwise you lie on the bed, held still, the eye low, and the screen dims over 2 s. Then it's
    morning (06:28), saved, and you get up beside the bed.
  - Sleeping works in creative too; only survival keeps where you wake.
- **Getting up early:** a movement key or Space, being hit, dying, or the bed going.
- **Where you wake** (`survival/sleep.ts`, `wakeAt`, pure):
  - beside the foot, on the floor where there's room for a body;
  - else beside the head, then off the foot's end, then on the bed itself;
  - nowhere if the bed is gone.
- **Dying with a bed:** "Start again" puts you on the bed until its land has loaded, then beside it.
  If it's gone: at the world's spawn, "Your bed was missing.", and the bed is forgotten.
- **Moss:** a mossback leaves 1–2 moss with its meat (the drops now scatter a little).
- **A bed from 3 planks and 3 moss.** `?kit` adds a bed and 3 moss.
- **Not yet:** a guest's click says "Sleeping in a friend's world can't be done yet." (step 6),
  though it does keep the bed.

**Tests** (8 new, 470 in all, `tests/sleep.test.ts`):
- **Sleeping:** only at night; not with something hostile within 8 blocks (8.5 is fine); by day it's
  the day that says no.
- **The bed's foot** found from either half.
- **Saved beds:** three whole numbers kept; junk not.
- **Waking:**
  - beside the foot, in the middle of a block, on the floor;
  - beside the head with the foot's sides walled, then off the end, then on the bed;
  - not where there's no floor or a ceiling too low;
  - nowhere with the bed gone, or with its head's place given.
- **The recipe:** 3 planks and 3 moss, not 2 moss.

**Bench:** nothing to measure. Sleeping is one check on a click and a few lines a frame while
asleep.

**Tried in the browser** (`?seed=7&survival&kit&nolock&mobs=0&daylength=40`, a 40 s day):
- the bed from the kit placed on the grass, its head away from the player;
- clicked at 08:27: "You'll wake here." and "You can only sleep at night.";
- clicked at 18:56 (daylight 0.22): lying on the foot (feet at 67.8, on the bed), the screen dimmed;
- 2 s later it was 06:46 and the player stood beside the foot.
- No console errors.
- **Not tried in the browser:** dying and waking at the bed (I couldn't steer the player into the sea
  to drown in a reasonable time). The tests cover where you wake; "Start again" calls it.

