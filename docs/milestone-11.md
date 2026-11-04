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
