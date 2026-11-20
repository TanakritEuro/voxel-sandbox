# Milestone 19: underground

**Status:** plan, to check (2026-11-21). Written in a hurry at the end of a session: the design is
outline only, to be filled in when it's checked.

## Goal

Make going deep worth it: lava, deep cave biomes, buried dungeons and a lantern. This is the
underground part Milestone 16 left for later, and it gives the delver somewhere to live. New worlds
only: generation version 3; old worlds keep their land (pinned by checksums, as in Milestone 16).

## Design (outline)

1. **Lava (`world/water.ts`):**
   - a second liquid in the same automaton: its own source and flowing ids;
   - slower (ticked half as often) and shorter (spreads 3, not 7);
   - light 15;
   - hurts and sets the player burning (`Health`, a new cause); items on the ground burn up;
   - water meeting a lava source makes basalt (a new block), and meeting flowing lava makes stone;
   - placed from a lava bucket? Not in this milestone: lava comes only from generation.
2. **Deep cave biomes below y 40 (`world/caves.ts`, `generate.ts`):** chosen by a 3D noise, version 3 only.
   - **Crystal caverns:** glowing crystal clusters (light 10), crystal ore twice as common.
   - **Mushroom grottoes:** giant mushrooms with glowing caps (light 8), mycelium-like floor.
   - **Lava lakes:** pools of lava filling cave floors below y 12.
3. **Dungeons (`world/structures.ts`):**
   - mossy-brick rooms deep down (y 10–35), one chance per 96 × 96-block cell;
   - a chest with better loot (`survival/loot.ts`: iron, crystal, tools);
   - delvers more likely to appear near one.
4. **A lantern:** block light 15, hanging from a ceiling or standing; crafted from iron and a torch.
5. **Blocks:** lava (source, flowing, falling), basalt, crystal cluster, giant mushroom stem and cap,
   grotto floor, lantern. About 15 of the 52 free ids (204–255).
6. **Together:** lava ticks on the host, as water does; nothing new on the wire beyond blocks.
   `PROTOCOL` 12 (generation version 3).
7. **Testing helpers:** `?find=crystal|grotto|dungeon|lava`.

## Steps

1. Generation version 3, deep cave biomes, new blocks and textures; checksums for versions 1–2.
2. Lava: the automaton, light, burning, lava meeting water.
3. Dungeons and their loot; delvers near them.
4. The lantern; `?find=` kinds; together.
5. Measurements, notes, playtest questions.

## How to measure

- Bench generation (version 3 against 2) and the water bench with lava.
- In the browser: a sprint flight over version 3 land, and in caves; lava lakes' frame times.

## Decisions to agree

1. **New worlds only** (generation version 3).
2. **No buckets:** lava and water can't be picked up and carried in this milestone.
3. **Lava's behaviour:** slower, spreads 3, light 15, burns.
4. **Three cave biomes and dungeons,** all below y 40.
