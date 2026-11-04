# Milestone 10: logic blocks

**Plan approved (2026-11-01)** as proposed: the seven blocks and their names, 10 ticks a second and
signals 15 blocks long, wires flat on one level, only lamps giving light, delays set by clicking
(1–4 ticks), and a right click to use (Shift and right click to place against).

**Goal.** Blocks that carry a signal, so players can build machines:
- a switch that lights a lamp across the room;
- a button that opens nothing yet but lights a row of lamps for a second;
- a gate that turns a signal round (on becomes off);
- a delay that passes it on later, so lamps chase each other along a line, or blink on their own
  (a clock).

The game stays inside its budget: 60 fps at radius 8, and no frame over 20 ms with a big circuit
running.

## The blocks (invented: names and looks to agree)

All the moving parts are copper, to go with the copper ore already in the ground.

| Block | Does | Looks |
| --- | --- | --- |
| **Copper wire** | carries a signal sideways along the floor, 15 at a source, a step less each block | a thin trace on the floor, dull when off, bright orange when on |
| **Switch** | on or off, a click to flip it; on is a source | a small base with a handle that tips one way or the other |
| **Button** | a click turns it on for 1 s | a small square on the floor, pressed flat while on |
| **Signal lamp** | lit (light 15) while a signal reaches it | dark glass and copper, glowing when on |
| **Charged block** | always on: a source | a solid copper block with a bright core |
| **Inverter** | on in front while off behind, one tick late | a flat plate with an arrow and a bar |
| **Delay** | passes the signal from behind to the front, 1–4 ticks late (a click sets how late) | a flat plate with an arrow and 1–4 dots |

- **Each state is a block id,** as the water's levels are: wire powers 0–15, switches and buttons on
  and off, lamps lit and dark, gates by facing, on and off, and delays by setting.
  - That is 63 new ids (35–97), all saved as they are.
  - The picker offers the seven blocks; their states it doesn't.
- **Thin blocks** (wire, switch, button, inverter, delay) can be walked through, as torches are,
  and broken in a click (a hardness like the torch's).

## How signals work

- **Ticks:** 10 a second (\`TUNING.logic.tickSeconds\`), apart from the water's.
- **Sources:** charged blocks, switches on, buttons pressed, and gates that are on, each into the
  block in front of it.
- **Wires:**
  - each tick, every wire network touched is worked out at once, by a breadth-first search from
    its sources, as light is;
  - a wire's power is 15 next to a source, one less a block along, 0 beyond 15 blocks;
  - so a signal crosses a network in the tick it changes, and switching off empties it at once
    (no flicker).
  - Wires join wires, sources, lamps and gates beside them on the same level.
  - **To agree:** they don't climb steps for now. Running up or down a block would need a wire on
    the step's side.
- **Lamps** are lit when a powered wire, a source on, or a gate facing them is beside them.
- **Gates** read the block behind them (a powered wire, or a source on) at the end of a tick, and
  change their output one tick later (an inverter) or 1–4 ticks later (a delay). That is what
  makes clocks and chasers possible, and stops loops from hanging the game.
- **Buttons** go off 10 ticks (1 s) after they're pressed.
- **Only what changed is looked at,** as for water:
  - an edit or a click wakes the block and its neighbours;
  - a change wakes what it touches;
  - a gate or button waiting to change stays awake until it does;
  - a still circuit costs nothing.
- **Budget:** at most 4,096 wire blocks a tick; the rest wait.

## Design

### 1. Blocks, looks and use (\`world/blocks.ts\`, \`world/textures.ts\`, \`mesh/mesher.ts\`)
- **Ids, properties and textures** for each state. Textures are painted at startup like the rest:
  copper traces, lamp glass, arrows and dots.
- **Shapes:**
  - wire, a 1/16 slab;
  - switch and button, small boxes, the switch's handle tipped by its state;
  - gates, 1/8 plates whose top texture turns with their facing (the mesher turns the texture
    coordinates);
  - lamps and charged blocks are cubes.
- **Placing:** a gate faces the way the player looks (its back towards them).
- **Using:** a right click on a switch, button or delay uses it (flip, press, next setting)
  instead of placing against it. Shift and right click places as usual.

### 2. The signals (new \`world/logic.ts\`, pure)
- **\`LogicFlow\`,** after \`WaterFlow\`: the woken set, \`wake\`, and \`tick(world, budget)\` returning the
  changes.
- Gates' pending outputs and buttons' timers are kept as the tick they're due, by place.
- Each tick reads the world as it was at the start, as the water does.

### 3. In the game (\`game.ts\`)
- **Ticks:** applied with \`World.setBlocks\` (lamps change the light, in one update), remeshed in the
  workers, saved.
- **Clicks:** using a block is an edit of the block, so it shows at once and is shared.
- **Loading:** a column read from the save wakes its logic blocks, so circuits carry on.
  - A delay's pulse on the way, or a button's second, isn't saved: they settle on load.
- **\`?stats\`:** a logic line with blocks woken, changes and time a tick.

### 4. Together (\`net/\`)
- **The host runs the logic,** and its changes go to guests like the water's.
- **A guest's click** is a new \`use\` message. The host checks the reach and makes it.
- Guests don't tick logic of their own.

## Files
- **Changed:**
  - \`world/blocks.ts\`, \`world/textures.ts\`;
  - \`mesh/mesher.ts\` (shapes, turned tops);
  - \`world/physics.ts\` (thin blocks passable, as torches);
  - \`game.ts\`;
  - \`net/protocol.ts\`, \`net/session.ts\`, \`net/hostWorld.ts\`;
  - \`config.ts\` (\`TUNING.logic\`);
  - \`stats.ts\`;
  - CLAUDE.md.
- **New:** \`world/logic.ts\`; tests; bench cases.

## Tests (headless)
- **Wires:**
  - a switch powers a wire 15, 14, … along it and nothing past 15 blocks;
  - switching off empties the whole network in one tick;
  - two sources: the stronger wins along the way.
- **Lamps:** lit beside a powered wire or a source, dark when it goes off; their light follows (a
  test against the light reference).
- **Gates:**
  - an inverter is on with nothing behind it and off a tick after a signal arrives;
  - a delay of 3 passes a pulse on 3 ticks later and keeps its length;
  - facing matters (nothing goes in at the front).
- **Clocks:** an inverter feeding itself through a delay blinks with the period it should, for
  minutes, without growing work.
- **Buttons** go off after 1 s.
- **The same result** in any order, and from any split of the work across ticks.
- **Meshes:** thin shapes at their heights, the gate's top turned with its facing, faces
  counter-clockwise.
- **Saving:** a circuit saved and loaded settles to the same state.
- **Together:** a guest's click reaches the host, and the result reaches every guest.

## Measuring
- **\`npm run bench\`:** a 1,000-block wire grid switched on and off, and a 50-lamp chaser clock run
  for a minute: time a tick (median, worst), changes, light.
- **Chrome, radius 8:** the chaser running in view, with frame times and the logic line.
- **Target:** a busy tick under 2 ms, no frame over 20 ms.

## Steps (each built, tested, measured, committed and pushed)
1. **The blocks:** ids, textures, shapes, placing with a facing, and using (flip, press, set), with
   no signals yet. Tested; looked at in Chrome.
2. **The signals,** headless (\`world/logic.ts\`), with tests and bench.
3. **In the game:** ticks applied, saving and waking on load, \`?stats\`; a chaser and a clock built
   and measured.
4. **Together:** the host's logic to guests, guests' clicks.
5. **Measurements,** notes and playtest questions.

## Decisions to agree
- **The seven blocks and their names** (copper wire, switch, button, signal lamp, charged block,
  inverter, delay)? A pressure plate (on while someone stands on it) could be an eighth.
- **10 ticks a second,** and signals 15 blocks long?
- **Wires flat on one level** (no climbing steps) for now?
- **Wires don't give light;** only lamps do (light changes cost the most)?
- **Delays set by clicking,** 1–4 ticks?
- **Using with a right click,** Shift and right click to place against a usable block?

## Step 1: the blocks — built (2026-11-01)

**What changed:**
- **63 block ids, 35–97** (`world/blocks.ts`):
  - copper wire by power 0–15;
  - switch and button, off and on;
  - signal lamp, dark and lit (light 15);
  - charged block;
  - inverters by facing, off and on;
  - delays by facing, setting 1–4, off and on.

  Helpers turn them into ids and back: `wire`, `wirePower`, `inverter`, `delay`, `gateOf`.
- **The picker offers the seven blocks,** each at its first state.
- **Thin blocks** (wire, switch, button, gates) can be walked through, break in a click (0.05 s),
  and stand on the block below. Breaking that block takes them with it, as it does torches
  (`torchSupport`).
- **21 textures painted at startup** (`world/textures.ts`):
  - copper plate;
  - wire off and on, a copper cross on a dark board;
  - the switch's handle with a red knob, lit when on;
  - the lamp's dark panes and lit panes in a copper frame;
  - the charged block's bright core;
  - the gates' plates with an arrow, the inverter's with a bar, the delays' with 1–4 dots, all lit
    when on;
  - flat icons for the wire, switch and button.
- **Meshing** (`mesh/mesher.ts`, `logicShape` and `box`): boxes with the whole texture across each
  face, as the torch has, lit flat by the block's own light.
  - Wire is a 1/16 sheet.
  - A switch is a base, with its handle on the left when off and the right when on.
  - A button is a small square, flatter while pressed.
  - A gate is a 1/8 plate. Its top's texture coordinates are turned so the painted arrow points the
    way the gate faces.
- **Placing** (`game.ts`, `place`, and `logicPlacement`): thin logic blocks only on the top of a
  solid block, into air. A gate faces the way the player looks (`facingFromYaw`).
- **Using:** a right click on a switch flips it, on a button presses it, and on a delay sets it to
  the next delay round (1, 2, 3, 4, 1); Shift and right click places against them instead
  (`useBlock`). With no signals yet, nothing else happens.
- **A guest may set** any logic block as placed or used, but not powered wire, which is for the
  signals to set (`settable`). Step 4 replaces clicks by guests with a `use` message.

**Looked at in Chrome:**
- The seven blocks were picked into the hotbar by script (their icons: the wire's cross, the switch,
  the button, the lamp, the charged block, the gates' arrows) and placed on the grass by the spawn.
- **Wire:** a dark sheet with a copper cross. **Button:** a small copper square. **Switch:** a
  copper base with a dark handle and red knob.
- **Lamp:** dark panes in copper. **Charged block:** orange with a bright core.
- **Gates:** their arrows point the way they were placed.
- Right-clicking a switch moved its handle across.
- The first try placed only four of the seven: the script's small turns aimed at blocks already
  placed, and a thin block can't stand on a thin one (by design). Stepping sideways between
  placements put all seven down.

**Tests (10 new, 334 in all):**
- The ids and their helpers both ways.
- The picker offers exactly the seven, by name.
- Thin blocks can be walked through and stand on the block below; the lit lamp gives light 15.
- Placing faces the way the player looks, and only on tops.
- Using flips, presses, and cycles the delay keeping its facing and state; nothing else is used.
- Breaking a block takes the wire and the gate on it.
- What a guest may set.
- **Drawing:**
  - wire 1/16 high, in its texture by power;
  - the switch's handle on either side;
  - a pressed button lower;
  - each of the four facings' arrow pointing its way.

## Step 2: the signals, headless — built (2026-11-01)

**What changed:**
- **`world/logic.ts`, `LogicFlow`:** each tick (`TUNING.logic`: 0.1 s, 4,096 woken blocks at most, a
  button on for 10 ticks):
  1. **Due changes:** gates' queued outputs and buttons' releases that fall due are made.
  2. **Wire networks:** every network at or beside a woken block is worked out at once.
     - The wires joined sideways on one level, each fed with 15 if a source that is on is beside it
       or under it (a charged block, a switch or button on), or a gate that is on faces into it.
     - Then outwards a step less a block, by a breadth-first search, as light spreads.
     - So a signal crosses a network in the tick it changes, and switching off empties it at once.
  3. **Lamps** round anything woken or changed are lit if a powered wire, a source on, or a gate on
     facing into them is beside them (six sides).
  4. **Gates** round anything woken or changed read the block behind them and queue their output:
     an inverter the opposite a tick on, a delay the same its setting's ticks on.
     - Each change is queued, so a pulse keeps its length through a delay.
     - A gate never changes in the tick its input does, so a loop is a clock, not a hang.
  5. **Buttons** seen pressed are let go 10 ticks later.
- **A tick's changes go into an overlay** that the rest of the tick reads, and are returned for the
  caller to make, each waking its neighbours. `pending` counts woken blocks, queued outputs and
  buttons waiting, so a still circuit costs nothing.
- Unloaded land is nothing, as for the water.

**Bench** (`npm run bench`, `logic`, Node under Vitest, 600 ticks = a minute):

| | changes | most a tick | wires worked out at most | ms a tick, median / p95 / worst after the first | the first |
| --- | --- | --- | --- | --- | --- |
| A 32 × 32 wire grid, a switch flipped every 10 ticks | 7,200 | 120 | 1,024 | 0.001 / 1.17 / 3.5 | 13.9 |
| A 50-stage chaser on a 10-tick clock | 18,221 | 34 | 56 | 0.33 / 0.55 / 1.4 | 2.2 |

- **The first tick** has everything just placed woken at once (1,024 wires each with six
  neighbours), on code not yet warmed up.
- **The grid is over the plan's 2 ms at worst** (3.5 ms) when a switch flips the whole network. That
  is in Node under Vitest, usually slower than Chrome. Step 3 measures it in Chrome; if it's still
  over, the network's search moves from Maps to typed arrays.

**Tests (9 new, 343 in all), on a stone board:**
- **Wire:**
  - a switch powers a line 15, 14, … 1, then nothing past 15 blocks;
  - off empties it in one tick, and then nothing is pending;
  - two charged blocks: each wire takes the stronger, meeting in the middle;
  - a wire on a charged block is fed by it.
- **Lamps:** lit beside powered wire, and beside the switch itself; dark again when it's off.
- **Inverter:** on with nothing behind; its front wire powered; still on in the tick its input comes
  on, and off the next.
- **Delay of 3:** a 4-tick pulse comes out 3 ticks later and 4 ticks long.
- **Facing:** a charged block at a delay's front doesn't turn it on.
- **A clock:** an inverter feeding itself round a loop of wire flips over 250 times in a minute, still
  blinking at the end, with never more than 40 things pending.
- **Buttons:** let go 10 ticks after being pressed; the lamp beside goes dark with them.
- **Splitting the work:** a circuit with a long wire, a branch, lamps lit and dark, and a delay ends
  the same at 3 woken blocks a tick as with no limit.
  - My first expectation here was wrong (a lamp I thought lit sits where the signal has faded out).
    The two runs agreed; the expectation was corrected, and a lit lamp and a delay that turns on
    were added.

## Step 3: in the game — built (2026-11-04)

**What changed:**
- **Ticks** (`game.ts`): every 0.1 s while the world runs (on the host or alone), a `LogicFlow` tick
  over a `BlockCache`, its changes made at once: `World.setBlocks` (blocks and light in one update),
  saved, remeshed in the workers, and sent to guests as the water's are (made there the same way; the
  rest of playing together is step 4).
  - Water's changes and logic's go through one `applyChanges`.
  - Unlike the water's, a tick's changes aren't put off to the next frame: there are few of them and
    working them out is quick, so a click shows on the next tick.
- **Waking:**
  - every edit wakes the logic round it, as it wakes the water (a switch used, a wire placed or
    broken, the block a gate reads);
  - water flowing into a thin logic block (they're open to it, as torches are) wakes it, so its
    circuit loses it;
  - a column loading wakes its logic blocks if it was read from the save, and those on the faces of
    the columns beside it (`wakeLogicColumn`). The water's column wake is now shared
    (`world/wake.ts`, `wakeColumnBlocks`), each with its own table of ids.
  - A delay's pulse on its way, or a button's second, isn't saved: they settle on load.
- **`?stats`:** a logic line: what's waiting, the last tick that changed something (blocks, wires
  worked out, ms working out and making them, the light's share) and the slowest tick since last read.
- **`?circuit`** (`circuit.ts`, an unsaved world): once the land is in, a stone board 104 × 40 is laid
  8 blocks above the player, the air above it cleared, and the player stood on its end looking along
  it. On it: the bench's clock and 50-stage chaser, and a 32 × 32 wire grid with a lamp at each
  corner, its switch flipped every second. For 20 s it counts frames and ticks, then reports.

**Measured in Chrome** (`?seed=7&circuit&mobs=0`, 20 s, about 1,190 frames and 199 ticks, 7,880 changes):

| | frames over 20 ms | slowest frame | slowest tick, working out | slowest tick, making the changes |
| --- | --- | --- | --- | --- |
| First try | 2 | 100.1 ms | 2.9 ms | 28.5 ms |
| Light skipped where nothing can change it | 0 | 17.1 ms | 2.1 ms | 18.8 ms |
| And the light's chunk lookups cached (two runs) | 1, then 0 | 33.4, then 17.1 ms | 2.2, 2.1 ms | 5.8, 5.3 ms |

- **Working the logic out was never the problem.** The grid's 1,024 wires take 1.1 ms in Chrome, under
  the plan's 2 ms, so its network search stays on Maps.
- **The light was.** Making a tick's changes was almost all light:
  - **Wire changing power, a switch flipped, a gate turned on** were relit like any block, though light
    can't change: the blocks treat it the same. `World.setBlocks` now skips the light for those
    (`sameLight`: opaque, step cost and glow all equal). The grid's flip stopped costing 28 ms.
  - **Lamps** do change it: about 11 ms a tick in Chrome for the chaser's, which turns about 15 on or off. The light's
    breadth-first search looked up the chunk for every block it stepped into through
    `World.getChunk`, which builds a string key. It now keeps the last chunk (most steps stay in
    it), cleared at the end of each edit or column.
  - The first try's 100 ms frame was the board being built (21,000 blocks), counted by mistake; the
    report now skips those frames, as `?flood` does.
- **The one 33 ms frame** in the third run came with no tick near it (the slowest was 8 ms in all),
  and didn't come back in the fourth.

**Bench** (`npm run bench`, `edits`, light only, medians; a new line for 15 lamps at once):

| | before | after |
| --- | --- | --- |
| 15 signal lamps lit at once (`setBlocks`) | 7.23 ms | 2.19 ms |
| put out at once | 5.24 ms | 2.35 ms |
| A torch at a chunk corner, surface: placed / taken away | 1.91 / 1.63 ms | 1.08 / 0.91 ms |
| A torch near a chunk corner in a cave | 1.01 / 0.95 ms | 0.65 / 0.51 ms |

- So every edit's light got quicker, not only the logic's.
- Water's bench is the same within noise (its changes mostly do change light).

**Tests (3 new, 346 in all):**
- **Saved and loaded:** a clock across a chunk border, saved mid-blink and loaded into a new world,
  is woken by its columns and still blinks, its lamp lit about half the time and giving light.
- **Waking on load:** a generated column wakes nothing of its own; a wire on a neighbour's face looking
  into it is woken, one further in isn't.
- **Light:** a wire changing power is remeshed but leaves the light exactly as it was; a lamp lighting
  changes it.
- The world-list rule test also has `?circuit` playing an unsaved world.

**Not checked here:** clicking a switch in the game (it's an edit, so it wakes the logic as any edit
does). That's for the playtest at the end.
