# Milestone 11: survival basics

**Plan approved (2026-11-04)** as proposed: drops straight into the inventory, no hunger or hostile
mobs, no smelting, crafting from a list, tools wearing out, dying keeping the inventory, the mode
chosen with the world and switchable from the pause menu, guests' inventories kept by the host, and
the items and recipes listed.

**Goal.** A world can be played for survival, not only built in:
- blocks you break go into your inventory, and you build with what you have;
- you craft what you need from them: planks, sticks, torches, tools, glass, the logic blocks;
- tools dig faster, and stone and ores need a pick;
- you can get hurt (falling, drowning, cactus), heal over time, and die and start again.

Creative stays exactly as it is: the picker, flying, every block. Each world is one or the other.
The game stays inside its budget: survival adds no per-frame cost worth measuring beyond the HUD,
which changes only when something in it does.

## What a survival world plays like

- **Making one:** the new-world screen asks Creative or Survival. Worlds made before this are
  creative. The pause menu can switch a world between them (to agree), each keeping its own hotbar.
- **Breaking:** takes a block's time as now, divided by the tool's speed when it's the right tool.
  What it drops goes straight into the inventory (to agree): the first slot with room for it.
- **Placing** uses one from the selected hotbar slot; an empty slot places nothing.
- **No flying** (F and double Space do nothing), no picker; E opens the inventory and crafting.
- **Health:** 20 points, shown as 10 pips above the hotbar.
  - **Falling** more than 3 blocks costs a point a block beyond 3; landing in water costs nothing.
  - **Drowning:** 10 s of air under water, shown as bubbles, then a point a second.
  - **Cactus:** a point every half second while touching one.
  - **Healing:** a point every 4 s, from 5 s after the last hurt.
- **Dying:** a "You died" screen with a button to start again at the world's spawn, inventory kept
  (to agree).

## Items

Every block a player can place is an item of the same id. New items for what isn't a block get ids
from 256.

| Item | From | Used for |
| --- | --- | --- |
| **Stick** | crafted from planks; sometimes from leaves | torches, tools, switches |
| **Coal** | coal ore (any pick) | torches, glass, delays |
| **Copper** | copper ore (a stone pick or better) | wire and the logic blocks |
| **Iron** | iron ore (a stone pick or better) | iron tools |
| **Crystal** | crystal ore (an iron pick) | lamps, charged blocks |
| **Pick, axe and spade** of wood, stone and iron | crafted | digging faster; a pick for stone and ores |

- **No smelting** (to agree): ores give their metal as they break. Glass is crafted from sand and
  coal.
- **Stacks** of up to 64; tools one to a slot.
- **Tools wear out** (to agree): 60 blocks for wood, 130 for stone, 250 for iron, shown as a bar
  on the slot. A worn-out tool is gone.
- **Names and looks are invented,** 16 × 16 icons painted at startup like the textures.

## What blocks drop

- **Most blocks drop themselves:** dirt, sand, gravel, planks, wood, snow, sandstone, torches, lamps,
  cactus, and every logic block (as placed: a lit lamp drops a lamp).
- **Grass and snowy grass** drop dirt.
- **Stone, sandstone and ores need a pick.** By hand they take three times as long and drop nothing.
- **Ores** drop their material: coal, copper, iron, crystal.
- **Leaves** drop a stick one time in eight; **glass** breaks to nothing.
- **Seeded,** not `Math.random`: from the block's place and a count of what's been broken, so a test
  can say what drops.

## Tools

| | dig speed | pick can take |
| --- | --- | --- |
| Hand | 1 | — |
| Wood | 2 | stone, sandstone, coal ore |
| Stone | 4 | and copper and iron ore |
| Iron | 6 | and crystal ore |

- **Which tool is right:** a pick for stone, sandstone, ores, lamps and charged blocks; an axe for
  wood and planks; a spade for dirt, grass, sand, gravel and snow. Anything else is the same by
  hand.
- **Numbers in `TUNING.survival`,** to be judged by playtest.

## Crafting

A list, not a grid (to agree). The inventory screen shows every recipe:
- the ones you can make bright, the rest dimmed;
- a click makes one, Shift and click as many as you can.

| Makes | From |
| --- | --- |
| 4 planks | 1 wood (oak or spruce) |
| 4 sticks | 2 planks |
| 4 torches | 1 stick, 1 coal |
| A pick, axe or spade | 3, 3 or 1 of planks, stone or iron, and 2 sticks |
| 4 glass | 4 sand, 1 coal |
| Sandstone | 4 sand |
| A lamp | 4 glass, 1 crystal |
| 8 copper wire | 1 copper |
| A switch | 1 copper, 1 stick, 1 stone |
| A button | 1 copper, 1 stone |
| A signal lamp | 1 glass, 2 copper |
| A charged block | 4 copper, 1 crystal |
| An inverter | 3 copper, 1 stone |
| A delay | 3 copper, 1 stone, 1 coal |

## The inventory screen (E, survival)

- **36 slots:** the hotbar's 9 (the bottom row) and 27 more, each with its icon and count.
- **Moving things:**
  - a click picks up a stack, and a click on another slot puts it down, swaps or merges;
  - a right click picks up half, or puts down one;
  - Shift and a click moves a stack between the hotbar and the rest.
- **Crafting** beside it, as above.
- **Leaving it** with something picked up puts that back where it came from.

## Design

### 1. Items and the inventory (new `src/survival/`, pure)
- **`items.ts`:** item ids (blocks below 256, the rest from 256), names, icons, stack sizes, and for
  tools their kind, tier, speed and wear. `isBlockItem`.
- **`inventory.ts`:** `Inventory` with `slots: (Stack | null)[]` (36), where `Stack` is
  `{ item, count, wear? }`.
  - `add(item, count)` returns what didn't fit; `take(slot, count)`; `move(from, to, count)`
    merging and swapping;
  - `count(item)`, `has(cost)`, `spend(cost)`;
  - `toJSON` and `from` (cleaned on load, like `hotbarFrom`).
- **`drops.ts`:** `dropsOf(block, tool, roll)`, `digTime(block, tool)`, `rightTool(block)`.
- **`crafting.ts`:** `RECIPES`, `canMake(inventory, recipe)`, `make(inventory, recipe, times)`.
- **`health.ts`:** `Health`, stepped with what happened: a landing at some speed, the eye under
  water, touching cactus. It returns damage taken, and keeps healing and air. Dying is when health
  reaches 0.

### 2. In the game (`game.ts`, `player.ts`, `world/physics.ts`)
- **The world's mode:** `WorldRecord.mode` ('creative' | 'survival', missing = creative), plus
  `survival` (inventory, health, air) saved with the player.
- **Survival:**
  - breaking adds the drops; placing spends one; digging uses `digTime`; tools wear;
  - the player can't fly;
  - the body says how far it fell (the highest point since last on the ground, or in water) for the
    fall damage;
  - touching cactus is a box test against the blocks round the body.
- **Death:** the world stops for this player behind a screen (not the others' world, together), then
  the player starts again at the spawn.

### 3. Looks (`render/`, `ui/`, `style.css`)
- **Icons:** the block icons as now; new 16 × 16 icons for sticks, materials and tools
  (`render/itemIcons.ts`).
- **The held item:** a block as now; a tool or material as its icon, a thin slab made from the
  icon's pixels (one box per filled pixel, merged greedily), bobbing and swinging like the block.
- **HUD:** health pips and air bubbles above the hotbar, counts and wear bars on its slots.
- **`ui/backpack.ts`:** the inventory screen and crafting list (plain DOM, as the picker is).
- **Sounds:** a hurt sound and a pickup sound, synthesised like the rest.

### 4. Together (`net/`)
- **The host's world's mode is everyone's,** sent in the welcome.
- **Guests' inventories and health are kept by the host** (to agree), by name, in its world record.
  They come back in the welcome when a guest rejoins, and the guest sends its own when it changes (at
  most every 2 s).
- **Each player's game works out its own damage and drops.** The host checks edits as now, but not
  whether a guest had the block (friends; a known limit).
- `PROTOCOL` 3.

## Files
- **New:**
  - `src/survival/` (`items.ts`, `inventory.ts`, `drops.ts`, `crafting.ts`, `health.ts`);
  - `src/render/itemIcons.ts`, `src/ui/backpack.ts`;
  - tests.
- **Changed:**
  - `game.ts`, `player.ts`, `world/physics.ts` (how far a body fell);
  - `render/heldBlock.ts` (held items);
  - `save/store.ts` (`mode`, `survival`, guests'), `ui/worldList.ts` (the mode on the new-world
    screen and in the list), `ui/pauseMenu.ts`;
  - `audio/sound.ts`;
  - `net/protocol.ts`, `net/session.ts`, `net/hostWorld.ts`;
  - `config.ts` (`TUNING.survival`), `style.css`, CLAUDE.md.

## Tests (headless)
- **Inventory:**
  - adding fills partial stacks first, then empty slots, and returns what doesn't fit;
  - moving merges, swaps and splits;
  - tools never stack;
  - a saved inventory loads the same, and a broken one (unknown items, counts over 64) is cleaned.
- **Drops and digging:**
  - grass gives dirt;
  - stone by hand takes three times as long and gives nothing, with a wooden pick gives stone;
  - each ore needs its tier;
  - leaves give a stick one time in eight over many rolls, the same rolls each run;
  - a tool wears by one a block and is gone at the end.
- **Crafting:**
  - each recipe spends exactly its cost and adds what it makes;
  - Shift makes as many as the inventory allows;
  - nothing is made when it doesn't fit.
- **Health, through the real physics:**
  - falls of 3 and 4 blocks cost 0 and 1, of 10 blocks 7, into water 0;
  - under water for 10 s nothing, then a point a second;
  - healing starts 5 s after the last hurt;
  - reaching 0 is death.
- **Saving:** a survival world's mode, inventory, health and air round trip; an old record loads as
  creative.
- **Together:** a guest's inventory is kept by the host by name and comes back when it rejoins; the
  host's mode reaches guests.

## Measuring
- **Frame time:** `?stats` frame and main-thread times in a survival world against a creative one,
  standing and digging. The HUD and inventory change the DOM only when their contents change.
- **The held tool:** its mesh's triangles and draw calls in `?stats`.
- **Mostly feel:** dig times, damage and crafting costs are for the playtest.

## Steps (each built, tested, measured, committed and pushed)
1. **Items, inventory, drops and crafting,** headless (`src/survival/`), with tests.
2. **Survival play:**
   - the world's mode (new-world screen, list, pause menu);
   - breaking into the inventory, placing from it, dig times and wear;
   - no flying, the hotbar with counts;
   - saving.
3. **The inventory screen and crafting,** item icons, the held tool. Looked at in Chrome.
4. **Health:** falls, drowning, cactus, healing, death and starting again, the HUD and sounds.
5. **Together:** the mode for all, guests' inventories kept by the host.
6. **Measurements,** notes and playtest questions.

## Decisions to agree
- **Drops go straight into the inventory,** with no items lying on the ground. If there's no room,
  the block still breaks and a line says so. Items on the ground (to pick up, to throw) could be a
  later milestone.
- **No hunger and no hostile mobs:** the dangers are falls, water and cactus.
- **No smelting:** ores give metal as they break; glass is crafted from sand and coal.
- **Crafting from a list,** not a grid to arrange.
- **Tools wear out** (60, 130, 250 blocks).
- **Dying keeps your inventory,** back at the spawn.
- **The mode is chosen when making a world** and can be switched from the pause menu. Older worlds
  are creative.
- **Guests' inventories are kept by the host,** by name, so rejoining gives them back.
- **The items and recipes** above: Stick, Coal, Copper, Iron, Crystal, three tools in three tiers.

## Step 1: items, inventory, drops and crafting, headless — built (2026-11-04)

**What changed** (new `src/survival/`, pure; numbers in `TUNING.survival`):
- **`items.ts`:**
  - every placeable block is an item of its id;
  - `Item` from 256: stick, coal, copper, iron, crystal, then pick, axe and spade in wood, stone and
    iron (ids 256–269);
  - `itemInfo` (name, stack size, tool), `toolOf`, `isItem`, `ALL_ITEMS`.
  - Tools: speed 2, 4, 6 and wear 60, 130, 250 by tier.
- **`inventory.ts`, `Inventory`:** 36 slots, the hotbar the first 9.
  - `add` fills stacks already there first, then empty slots from the hotbar on, returning what
    didn't fit.
  - `spend` takes from the last slots first, so the hotbar keeps what's in it longest. Also
    `count`, `has` and `fits`, and `takeOne` for placing.
  - `wearTool` counts a tool's blocks; at its wear it's gone.
  - For the screen: `pick` (all or half), `put` (all or one: into an empty slot, merged up to 64,
    or swapped) and `shiftMove` (between the hotbar and the rest, merging first).
  - `toJSON` and `from`, which leaves out anything that isn't an item, a count off the stack, or a
    wear past the tool's.
- **`drops.ts`:**
  - `dropsOf(block, tool, roll)`: blocks give themselves as placed (a lit lamp a lamp, powered wire
    wire, a gate in any state the gate); grass dirt; ores their metal; leaves a stick when the roll is
    under 1/8; glass nothing.
  - **`pickTier`:** stone, sandstone and coal need a pick of wood or better; copper and iron
    stone; crystal iron. Without one they give nothing.
  - **`digTime`:** the hardness divided by the speed of the right tool (`rightTool`: a pick for
    stone, ores and lamps, an axe for wood and planks, a spade for earth). Three times the hardness
    without the pick a block needs, or with too low a tier.
- **`crafting.ts`:** the plan's 23 recipes (planks from either wood, each tool in each tier).
  - `canMake`: the cost is there, and what's made fits once the cost is spent.
  - `make(…, times)`: Infinity for Shift.

**Tests (17 new, 366 in all,** `tests/survival.test.ts`):
- **Items:** what is one, names, tools one to a slot.
- **Inventory:**
  - adding (merging, the order of slots, what doesn't fit);
  - tools not stacking and wearing out at 60;
  - picking half, putting one, merging up to 64, swapping;
  - Shift moves, spending from the end, placing one at a time;
  - saving round trip, and a broken save cleaned.
- **Drops:**
  - grass and the spade;
  - stone by hand three times as long and nothing, with a wooden pick half the time and stone;
  - each ore's tier;
  - 8,000 seeded rolls of leaves give 900–1,100 sticks;
  - blocks back as placed;
  - only items ever dropped.
- **Crafting:**
  - each recipe spends exactly its cost;
  - Shift makes 10 times from 10 wood;
  - nothing is made when it wouldn't fit;
  - every tool, torch and logic block can be made.
- My first test of merging set up two stacks with `add`, which merged them; the test now sets the
  slots directly.

## Step 2: survival play — built (2026-11-04)

**What changed:**
- **The world's mode:**
  - **Saved:** `WorldRecord.mode` ('creative' | 'survival') and `survival` (the inventory, the
    record holding the inventory's own slots, so every save has it as it is). `modeOf` says creative
    for records from before.
  - **The new-world screen** asks: "Creative: every block, flying" or "Survival: gather, craft, take
    care" (`ui/dom.ts`, `choice`). World cards say which.
  - **The pause menu** says which and switches it (`mode` in `PauseEvents`), and lists the keys for
    it: no flying in survival, E for the inventory.
  - **Each mode keeps its own hotbar:** creative's nine blocks, survival's the inventory's first nine.
  - `?survival` makes an unsaved world (`?seed=…`) a survival one, for looking and measuring.
- **Breaking in survival** (`survival/play.ts`, `harvest`):
  - a block's drops go into the inventory, seeded by the world's seed, the place and a count of
    blocks broken;
  - torches that go with it drop torches without wearing the tool;
  - the tool held wears by one;
  - a line on screen says when there's no room for something, or a tool wore out.
- **Dig times:** `Mining.timeOf`, in survival `digTime` with the tool in the selected slot.
- **Placing** takes the block from the selected slot (`placeableIn`); an empty slot or a stick
  places nothing.
- **No flying:** `Player.canFly`, false in survival, stops F and two presses of Space, and ends
  flying loaded from creative.
- **The hotbar in survival:** counts, a green bar for a tool's wear, and the name of an item that has
  no icon yet (icons are step 3). The hand holds the selected slot's block, or nothing.
- **E** does nothing in survival until step 3's inventory screen. A guest plays creative until step 5.

**Tests (7 new, 373 in all):**
- **Saving,** in memory and in IndexedDB: a survival world's mode and its inventory (a stack, a worn
  tool) come back as saved; an old record and a new default are creative.
- **The player:** with `canFly` false, F and two taps of Space don't fly, and flying stops.
- **Breaking:**
  - stone with a wooden pick goes in, wearing it;
  - a torch that went with it doesn't wear it;
  - by hand stone gives nothing;
  - with no room it says so, and a worn-out spade is named and gone.
- **Placing:** only blocks.
- **Mining:** stone with a stone pick breaks at a quarter of its hardness.

**Looked at in Chrome:**
- the new-world screen with the mode choice, the choice switching;
- `?seed=7&survival`: the pause menu's mode line and keys, an empty hotbar; grass dug into one dirt
  (in the hotbar and the hand), placed back into the hole, the slot empty again;
- switching to creative in the pause menu brought back the creative hotbar and keys.
- No console errors. Digging and placing were driven by mouse events sent from a script.

## Step 3: the inventory screen, crafting, item icons and the held tool — built (2026-11-04)

**What changed:**
- **Item pictures** (`render/itemIcons.ts`): 16 × 16 pixel art for the 14 items that aren't blocks.
  - Each is drawn from a mask (pick, axe, spade, stick, lump, ingot, gem), in a material's three
    colours (wood, stone, iron, copper, coal, crystal) with a handle, and a little seeded speckle.
  - `itemArt` is pure; `itemIcons` makes data URLs at startup.
  - The hotbar shows them instead of the names step 2 used.
- **The inventory screen** (`ui/backpack.ts`, E or Tab in survival; E, Tab or Esc close):
  - the 27 slots above and the hotbar's 9 below, with icons, counts and wear;
  - a click picks up a stack (it follows the pointer) and puts it down, merges or swaps; a right
    click picks up half or puts down one; Shift and a click moves it to or from the hotbar;
  - closing with a stack picked up puts it back (a line says if there was no room).
  - **Crafting** beside it: every recipe, with its icon, what it makes and its cost
    ("Planks × 3, Stick × 2"). Bright when it can be made; a click makes one, Shift and a click as
    many as can be.
  - The pause menu stays hidden while it's open, as for the picker.
- **The held item** (`render/heldBlock.ts`, `setItem`): a tool, stick or metal is held as its
  picture made solid.
  - **`itemMesh`:** a box a pixel square and a sixteenth thick per filled pixel, keeping only the
    faces that show, coloured by the pixels and shaded by side.
  - Tilted like a tool held out, it bobs and swings as the block does, as bright as the light where
    the eyes are.
- **`?kit`** (an unsaved world only): a tool of each kind and tier, torches, planks, and things to
  craft with, for looking and for the playtest.

**Tests (2 new, 375 in all):**
- **Pictures:** every item that isn't a block has a 16 × 16 picture with something in it, the same
  each time, and tools differ by material; blocks have none.
- **Held slab:** one pixel is a box of 6 faces; two side by side lose the 2 between them; it stays
  within the square and a sixteenth thick; a pick has far fewer faces than six a pixel.
- The screen is DOM, so it was tried in Chrome rather than tested: its moves are the inventory's,
  tested in step 1.

**Looked at in Chrome** (`?seed=7&survival&kit`):
- **The hotbar:** the icons read clearly (each tool's kind and material, torch, planks), with
  counts and wear bars.
- **The held stone pick:** at first it reached nearly to the hotbar; it was made a fifth smaller.
- **The inventory screen:**
  - crafting torches turned a stick and a coal into 4 torches (16 to 20);
  - the wood stack followed the pointer and went down in an empty slot, and while it was held the
    planks recipes dimmed;
  - a right click took half the stone (30 to 15 and 15);
  - E closed it and caught the mouse again.
- **The costs** first read "1 planks" and "2 stick"; they're now "Planks × 1", "Stick × 2".
- No console errors.

## Step 4: health — built (2026-11-04)

**What changed:**
- **`survival/health.ts`, `Health`:** stepped every frame in survival with how the body is (feet
  height, on the ground, in water, flying, eyes under water, touching a cactus). Numbers are in
  `TUNING.survival`.
  - **Falls:** the highest the feet were since they last stood (on the ground, in water or flying),
    against where they land: a point a block past 3. Water breaks a fall.
  - **Air:** 10 s with the eyes under water, then a point a second. It comes back five times as fast
    above.
  - **Cactus:** a point on touching one, then every half second (`touches` in `world/physics.ts`:
    the block within 0.05 of the body's box).
  - **Healing:** a point every 4 s from 5 s after the last hurt, not while dead.
  - It says what hurt last, for the death screen.
  - Saved with the inventory (`survival.health`). Loading dead or broken is full health; while dead
    the player is saved at the spawn.
- **HUD:** 10 pips over the hotbar (a half pip for an odd point), and air bubbles while short of air.
  They are drawn again only when what they show changes. A red flash when hurt.
- **Dying:** the death screen ("You died", why, "Everything you carried is still with you", Start
  again). The mouse is freed and the pause menu stays hidden. Starting again puts the player at the
  spawn with full health (`Player.moveTo`).
- **Sounds** (synthesised, `audio/sound.ts`): hurt, a low thump with a quick falling grunt; picking
  something up, a soft rising blip.

**One fix on the way:** the falls through the physics came out a point short (4 blocks cost nothing,
10 cost 6). The highest point was first taken a frame into the fall, already a little below the
ledge, so a 4-block fall measured 3.99. A fall now starts where the feet last stood.

**Tests (8 new, 383 in all,** `tests/health.test.ts`, and saving):
- **Falls,** a body dropped through the real physics at its fixed step, health stepped at 60 frames
  a second: 1 and 3 blocks cost nothing, 4 cost 1, 10 cost 7; 10 blocks into water nothing.
- **Drowning:** nothing for 10 s under water, then 5 points in the next 5.2 s; air full again
  after 2 s above.
- **Cactus:** a point at once, then one at half a second.
- **Healing:** hurt to 19, back to 20 between 8.9 and 9.1 s later, and no further.
- **Death** at 0, no healing while dead, full after a reset.
- **Saving:** health round trip; dead or broken loads full; health in a saved survival world.
- **Touching:** a cactus 0.05 away beside, or under the feet, is felt; one 0.2 away or a block off
  isn't.

**Looked at in Chrome** (`?seed=7&survival&kit`):
- the pips over the hotbar;
- walked into the sea: bubbles going down, then health draining (4½ pips left at one look);
- the death screen said "You ran out of air";
- Start again put the player back at the spawn, full, with the mouse caught and the inventory kept.
- No console errors. Sounds can't be heard from here; they're for the playtest.

## Step 5: together — built (2026-11-04)

**What changed** (`PROTOCOL` 3):
- **The host's mode is everyone's:**
  - the welcome carries it, and a guest plays it;
  - when the host switches it in the pause menu, a new `mode` message makes every guest switch too;
  - guests can't switch it themselves.
- **Guests' survival states are kept by the host, by name:**
  - **Kept:** a guest sends its inventory and health (`kept`) every 2 s when they've changed
    (`TUNING.net.keptEvery`), and once more as it leaves.
  - **Stored:** the host cleans each one as it would a save (`Inventory.from`, `Health.from`) and
    keeps it in its world record under `guests`, saved with the world.
  - **Given back:** the welcome carries what was kept for the name the guest joins with (null the
    first time), and the guest starts with it.
  - **Checked on arrival:** a mode is one of the two, and a kept state must be an object of at most
    8 KB of JSON.
- **Each player's game does its own survival:** drops, dig times, wear, damage and dying. A guest
  that dies starts again at the world's spawn, which is the same for everyone.
- The host still checks a guest's edits as before (reach, not inside anyone, settable blocks), but
  not whether the guest had the block.

**Tests (1 new, 384 in all):**
- **Over the loopback network:** a guest gets the host's survival mode and nothing kept the first
  time; it hears the host switch to creative. What it sends is kept under its name. Gone and back
  under the same name, it's in the welcome; a guest with another name gets nothing.
- **Messages** (added to the protocol test): welcomes with a mode and a kept state or none, `mode` and
  `kept` come through. Turned away: an unknown mode, a kept state that's a list or over 8 KB, `kept`
  with nothing.

**Tried in Chrome, over the real PeerJS server, in two tabs:**
- a survival world (`?seed=7&survival&kit`) opened to friends as Host;
- Pim joined from the world list: survival, an empty hotbar, full health;
- Pim dug a block of dirt and left after 3 s; joining again, the dirt was in the hotbar;
- the host switched to creative, and Pim's game went creative at once (the creative hotbar, no
  health);
- no console errors on either.
- Once, paused just after joining, the bottom of Pim's view was red; playing, it was gone. Most
  likely Pim's eyes were inside the host's red figure: a guest joins where the host stands, as since
  Milestone 9.

**Known limits:**
- **A guest's refused edit isn't undone in its inventory:** a block broken out of reach still gave
  its drop, and a block placed and refused is gone. Reach is checked on both sides, so it's rare.
- **Names are the key:** two guests with one name share one inventory. A host can't see or clear
  what's kept.
- **A host trusts its guests' inventories,** as friends.

## Step 6: measurements, and the end of the milestone (2026-11-04)

**The held item** (counted from `itemMesh`): a tool or material in the hand is one mesh, one draw
call, of 164 triangles (a stick) to 368 (a pick); a held block is 10–12. Too small to show in a
frame's time.

**Survival against creative,** Chrome on your laptop, radius 8, `?seed=7&stats&mobs=0&time=0.5`
(`&survival&kit` for survival), standing at the spawn, then looking down and holding the button
(digging grass and the dirt under it). Two loads each, alternating; `?stats` read every 2 s:

| | main thread ms, average (max) standing | GPU ms standing | main thread ms digging, average (max) |
| --- | --- | --- | --- |
| Creative (2 runs) | 1.7–1.9 (3.0), 2.2–2.3 (3.3) | 8.6, 8.0 | 2.1 (15.5) |
| Survival (2 runs) | 2.2–2.3 (3.0), 2.0–2.1 (3.5) | 8.0, 8.0 | 2.3–2.6 (15.5) |

- **No difference beyond the noise between loads:** survival's first run was 0.4 ms over creative's
  first, and creative's second the same over survival's second. What survival adds a frame is
  small: a health step, 27 block reads for cactus, and a comparison of what the HUD shows. The
  hotbar and HUD are redrawn only when what they show changes.
- **Digging:** the frames where a block breaks reach 15.5 ms in both modes. That is the edit's
  remeshing on the main thread, as since Milestone 4; survival adds the drop, a hotbar redraw and a
  sound. 60 fps throughout, no frame over 20 ms while measuring.
- **Measuring needed a second go:** Chrome refused to capture the mouse ("The root document of this
  element is not valid for pointer lock") until you'd seen to the window; then it worked at once.

**The plan's targets:** no per-frame cost worth measuring beyond the HUD: met. The rest of survival
is feel: dig times, damage and crafting costs are for the playtest.

**Known limits:**
- **No items lying on the ground:** drops go straight into the inventory; with no room they're gone
  (a line says so). Nothing can be thrown away, but blocks can be placed.
- **No hunger, no hostile mobs, no smelting:** ores give their metal; glass is crafted from sand and
  coal.
- **No water in survival:** it can't be picked up (no bucket), so it can't be placed.
- **The animals give nothing** when they go in a puff.
- **Together:** a guest's refused edit isn't put right in its inventory; two guests with one name
  share one; the host trusts guests' inventories (step 5).
- **A guest joins where the host stands,** so for a moment its eyes can be inside the host's figure.

## Playtest questions

1. **Starting out:** make a survival world. Is it clear what to do first (wood, planks, sticks, a
   wooden pick)? Is anything missing to get going?
2. **Digging:** do dig times feel right by hand, with the wrong tool and with the right one? Is
   stone by hand (7.5 s, nothing) too harsh, or fair?
3. **Tools wearing out:** are 60, 130 and 250 blocks about right? Is the wear bar easy to read?
4. **Ores:** can you find coal, copper, iron and crystal? Is it clear why an ore gave nothing?
5. **The inventory screen (E):** are picking up, splitting (right click) and Shift-moving easy? Does
   the stack following the pointer feel right?
6. **Crafting:** is the list easy to find your way in? Are the costs sensible (torches, glass, the
   logic blocks)?
7. **The held tool:** does it look right in the hand, walking and digging?
8. **Health:** do falls hurt as you'd expect (stepping off 4 blocks costs a point; a jump adds its height)? Is 10 s of air
   about right? Is the cactus too harsh? Does healing feel too fast or slow?
9. **Dying:** is the death screen clear, and is starting at the spawn with everything kept the right
   amount of forgiveness?
10. **Sounds:** the hurt grunt and the pickup blip: right, too loud, annoying?
11. **Switching modes** in the pause menu: useful, or too easy a way out?
12. **Together:** host a survival world and have a friend play. Do they keep their things when they
   leave and come back under the same name?
