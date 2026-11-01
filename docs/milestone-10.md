# Milestone 10: logic blocks

**Plan, to check with you.**

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
