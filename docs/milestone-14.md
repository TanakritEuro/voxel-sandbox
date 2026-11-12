# Milestone 14: shapes

**Plan approved (2026-11-07)** as proposed.

**Goal.** Blocks that aren't cubes, to build with: slabs, stairs, fences and glass panes, placed the
way you look or where you click, with walking up half a block without jumping. Built on Milestone
13's collision boxes, grown to several boxes a block and to shapes that depend on their
neighbours. The budget holds: 60 fps at radius 8, no frame over 20 ms flying, the mesher no slower
where there are no shapes.

## The blocks
- **Slabs,** in stone, planks and sandstone: half a block, in the lower or the upper half.
  - Which half: where you click. The top of a block puts a lower slab; a ceiling an upper one; a
    side the half of the side you clicked.
  - A slab clicked onto its own kind's open half makes the whole block (stone, planks, sandstone).
- **Stairs,** in the same three: a lower slab and a quarter block on it, at the back.
  - The back away from you, as you place them.
  - Upside down when placed on a ceiling or the upper half of a side.
  - No corner stairs: two side by side stay two straight flights.
- **A wooden fence:**
  - a post in the middle, and rails to each neighbouring fence or solid block;
  - 1.5 blocks high to bump into, so it can't be jumped (mobs and players);
  - a fence with nothing beside it is a post.
- **A glass pane:** a thin sheet through the middle, joining panes and solid blocks beside it as a
  fence does. A full block high; drawn with the glass.
- **Walking up half a block:** walking into a rise of half a block or less (a slab, a stair, a bed)
  steps up onto it without jumping, on the ground only, and not while crouching. A whole block still
  needs a jump.

## Survival and together
- **Recipes:**
  - 6 slabs from 3 of the block;
  - 4 stairs from 6;
  - 3 fences from 4 planks and 2 sticks;
  - 16 panes from 6 glass.
- **Drops:** each gives itself. The right tool is the block's own. (A slab made whole is its material's
  block, and gives that, not two slabs.)
- **Together:** placing any state is allowed for guests (as with doors and chests); a slab made
  whole is an edit to the whole block.

## Design

### 1. Block ids and boxes (`world/blocks.ts`)

| Ids | Block |
| --- | --- |
| 143–148 | slabs: stone, planks, sandstone × lower, upper (`slab`, `slabOf`) |
| 149–172 | stairs: the three × 4 facings × upright, upside down (`stairs`, `stairsOf`) |
| 173 | wooden fence |
| 174 | glass pane |

- **`BlockInfo.boxes`** (in place of the single `box`): one or more boxes a block is made of.
  - a slab: one box;
  - stairs: two;
  - a door or a bed: one, as now.
- **`BlockInfo.connects`** for fences and panes: their boxes come from their four neighbours
  (`connectedBoxes(block, world, x, y, z)`, pure): a post or a sheet, and up to four arms.

### 2. Collision, raycast and placing (`world/physics.ts`, `world/raycast.ts`)
- **The sweep** goes through every box of a block, and works out a fence's or pane's from its
  neighbours. That's four lookups, only for those blocks: they mark themselves as blocks with boxes,
  so `nearBox` keeps the rest as cheap as now.
- **A fence's boxes** reach 1.5 high. The sweep looks at the block below the body's feet layer for
  boxes that rise into it.
- **Step-up** in `stepPlayer` and `stepMob`, on the ground and not crouching:
  - a horizontal move that hits something also tries the move half a block higher;
  - if that gets further, the body goes there and down onto what's under it.
  - The camera eases up rather than jumping (the eye height already eases).
- **The raycast** hits the nearest of a block's boxes, and the hit point is kept, so placing can
  tell the upper half of a side from the lower.
- **`overlapsBlock`** checks every box.

### 3. Meshing (`mesh/mesher.ts`)
- **`piece`** draws every box of a block. A face of a box lying on the block's side against an
  opaque neighbour is left out, as now; faces between a block's own boxes aren't drawn.
- **Fences and panes** get their boxes from the padded neighbours (the mesher has the 34³ border, so
  across chunk borders too). Panes go in the transparent pass.
- **Slabs and stairs aren't opaque,** so the faces against them are drawn and light goes through
  (as glass). Upper slabs and upside-down stairs need no change: the boxes say where they are.
- **Textures:** the material's own, cropped as Milestone 13's pieces are (in eighths up a side). A
  fence uses planks; a pane uses the glass texture's edge for its rims.

### 4. Placing (`world/parts.ts` or a new `world/shapes.ts`, pure)
- **`shapePlacement(item, face, hitY, yaw, world, x, y, z)`:** the state to set, or a whole block when
  a slab is clicked onto its own half.
- **Picker and hotbar:** one of each (a stone slab, stone stairs, and so on).

## Files
- **New:** `world/shapes.ts` (placement, connected boxes), tests.
- **Changed:**
  - `world/blocks.ts`, `world/physics.ts`, `world/raycast.ts`, `mesh/mesher.ts`, `world/textures.ts`;
  - `survival/` (crafting, drops), `net/hostWorld.ts` (`settable`);
  - `game.ts` (placing, the outline round boxes), `render/icons.ts` (icons for the shapes);
  - CLAUDE.md.

## Tests (headless)
- **Collision:**
  - stands on a slab at 1/2, an upper slab's bottom at 1/2 stops a jump;
  - walks up a flight of stairs without jumping;
  - can't walk up a whole block or a fence;
  - can't jump a fence (1.5);
  - walks between two fences' posts where they don't join, and not where they do;
  - a pane stops a body along its sheet.
- **Step-up:** half a block yes, 0.6 no, not crouching, not in the air; a mob steps up too.
- **Mesher:**
  - a slab is 6 quads at its half;
  - stairs are 10 or fewer quads, facing out, for each facing and upside down;
  - a fence alone is a post; with neighbours, arms to them, across a chunk border too;
  - a pane goes in the transparent pass.
- **Placing:**
  - a lower or upper slab by the face and where on it;
  - a slab onto its own half makes the block;
  - stairs face away from the player, upside down from a ceiling.
- **Raycast:** hits a stair's upper box, passes over a lower slab, gives the hit point.
- **Survival:** recipes and drops.

## Measuring
- **`npm run bench`:**
  - the mesher on the usual chunks (none of the new shapes: no slower);
  - the mesher on a chunk full of fences and stairs;
  - player physics on the usual walk, and on a walk up and down stairs.
- **In the browser:** a 20 s sprint flight (`?autofly=20`), and the same over a field of stairs and
  fences (`?shapes`, new: a block of them round the player).
- **Target:** no frame over 20 ms; the usual mesher and physics numbers within noise.

## Steps (each built, tested, measured, committed and pushed)
1. **Several boxes a block:** `boxes` in place of `box`, collision, raycast with the hit point, and
   `piece` drawing them; slabs and stairs as blocks. Built (2026-11-07).
2. **Placing slabs and stairs,** slabs made whole, the picker, recipes and drops. Built (2026-11-07).
3. **Step-up** for players and mobs. Built (2026-11-07).
4. **Fences and panes:** boxes from neighbours, in collision, raycast and the mesher; 1.5 high fences. Built (2026-11-07).
5. **Measurements,** notes and playtest questions. Done (2026-11-12).

## Decisions to agree
- **Three materials** (stone, planks, sandstone) for slabs and stairs; more are easy to add after.
- **No corner stairs.**
- **Fences 1.5 high to bump into,** so nothing jumps them; no fence gates (a door does).
- **Step-up of half a block,** for players and mobs, not while crouching.
- **Slabs and stairs let light through,** as glass does.
- **Names:** stone slab, plank slab, sandstone slab, the same for stairs, fence, glass pane.

## Step 1: several boxes a block — built (2026-11-07)

**What's there:**
- **`BlockInfo.boxes`** (a list) in place of Milestone 13's `box`: a door's panel and a bed are one
  box, a slab one, stairs two.
- **Slabs** (143–148) and **stairs** (149–172) in stone, planks and sandstone (`SHAPE_MATERIALS`;
  `slab`/`slabOf`, `stairs`/`stairsOf`):
  - not opaque, so light goes through and the faces against them are drawn;
  - the picker offers a lower slab and stairs facing +x of each. Placing them by face, click and
    look is step 2.
- **Collision:** the sweep looks at every box of a block. Whole cubes take a quicker path than
  before (no box arithmetic). `overlapsBlock` checks every box.
- **Raycast:** the nearest of a block's boxes. Every hit now gives its point (`px`, `py`, `pz`), for
  step 2's placing.
- **Mesher:** `piece` draws every box.
  - A face against an opaque neighbour on the block's side is left out, as before.
  - So is a face lying wholly on another of its boxes (a stair's quarter on its slab): stairs are 11
    quads.
- **The outline** goes round all of a block's boxes.

**Changed from the plan:** texture coordinates were whole blocks in u and eighths only in v. A stair's
half-width faces would have shown one column of the texture stretched across them.
- The fourth byte of a vertex's texture coordinates now carries u's eighths too, in the 3 bits above
  v's. v's eighths never go above 7, so water and greedy quads are unchanged.
- The shader reads both.
- So every box face shows the part of its texture where it is in the block, in both directions, to
  an eighth. A door's 3/16 edges now round to 2/16.

**Tests** (9 new, 482 in all, `tests/shapes.test.ts`):
- every slab and stair state's id reads back; names;
- the boxes of slabs and stairs, upright and upside down, for two facings;
- **collision:**
  - standing on a lower slab at 1/2;
  - a jump under an upper slab stops at its underside;
  - on a stair's step at 1/2 and its back at 1;
  - walking into the back from the step, and into the slab from the floor;
- `overlapsBlock` only where the boxes are;
- **raycast:** over a lower slab onto a stair's back, with the hit point; a slab's side; down onto a
  stair's step at 1/2;
- **mesher:**
  - a slab is 6 quads at its half, upper and lower, its sides' v the height in the block;
  - stairs are 11 quads for every facing and upside down, all facing out;
  - a half-width face's u in eighths.

**Bench** (`bench` meshing and `player physics`, against the last commit's mesher and physics, two
rounds each; the machine was slower than at the end of Milestone 13):

| | greedy meshing, 724 chunks (ms) | 120 s walk (ms) |
| --- | --- | --- |
| Before (last commit) | 1,221 / 1,208 | 65 / 62 |
| After | 1,188 / 1,183 | 68 / 61 |

- Within noise: the usual chunks have none of the new blocks.

**Looked at in the browser** (`?seed=7&nolock`, creative):
- the six in the picker;
- a stone slab, plank stairs and sandstone stairs and a slab placed on the grass;
- the textures cropped to each part and continuous across the parts (the sandstone's stripes line up
  from the step to the back).
- The hotbar's icons are still whole cubes: step 2.
- No console errors.

## Step 2: placing slabs and stairs — built (2026-11-07)

**What's there** (`world/shapes.ts`, `shapePlacement`, pure):
- **A slab** goes low on a top face, high on a ceiling, and on a side in the half clicked (the hit
  point's height from step 1).
- **Made whole:**
  - a slab clicked onto the open half of its own material's slab (a lower one's top, an upper one's
    underside) makes the whole block there;
  - so does one put where its kind is in the other half (the ray went through the empty half);
  - a different material goes beside it as a slab of its own.
- **Stairs:** the back the way the player looks; upside down on a ceiling or the upper half of a side.
- **Icons** of the shapes: each box drawn as the cube is, the part of each texture where it is, the
  boxes further back and lower first.
- **Survival:**
  - 6 slabs from 3 of the block, 4 stairs from 6;
  - each gives itself as the picker has it;
  - dug with its material's tool, and stone and sandstone need a pick as their blocks do;
  - a slab made whole is the block, and gives the block. The plan said a double slab gives two;
    there's no double slab.
- **Together:** a guest may set any slab or stairs state; a slab made whole is an edit to the block.

**Tests** (6 new, 488 in all, in `tests/shapes.test.ts`):
- **Slabs:**
  - low on a top, high on a ceiling, upper and lower on a side by the click's height;
  - made whole from a lower one's top and an upper one's underside;
  - a different material goes above;
  - made whole from the side into the empty half;
  - nothing into the half it's in already.
- **Stairs** facing the way the player looks (two ways), upside down from a ceiling and the upper half
  of a side, nothing into a block.
- **Survival:** drops and tools, stone stairs by hand give nothing, the recipes.
- **Together:** every state settable by a guest.

**Tried in the browser** (`?seed=7&nolock`, creative):
- the icons show a slab and a flight of stairs in the hotbar;
- a stone slab on the grass;
- a click on its near side's lower half put a second slab beside it (a log of the click showed the
  hit there, at height 0.2 up the side). That's as it should be, though it surprised me at first;
- a click on a slab's top made whole stone;
- plank stairs placed on the slab had their back away from the player and their step towards them.
- No console errors.

## Step 3: stepping up — built (2026-11-07)

**What's there:**
- **`moveStepping`** (`world/physics.ts`), `moveBody` with a step:
  - a move that something stops sideways is tried again `TUNING.player.stepUp` (half a block) higher,
    as far up as there's room for the head, then brought back down onto what's there;
  - it's kept if it gets further across and lands on something.
  - So a slab, a stair, a bed or two slabs in a row are walked up; a whole block isn't (nothing is
    gained half a block up). Under a low ceiling nothing is stepped up either.
- **The player** steps up on the ground, walking or sprinting, not crouching (so crouching at an edge
  is unchanged) and not swimming.
- **Mobs** step up on the ground out of water. Their paths still take slabs and stairs as whole
  blocks to climb by jumping, which their bodies now walk up instead.
- **The camera** doesn't jolt up a stair: the eye lags behind a step up and eases to the feet
  (`TUNING.player.stepEase`, 18 a second).

**Tests** (6 new, 494 in all, `tests/stepup.test.ts`, through `stepPlayer` and `stepMob`):
- **The player walks up:**
  - onto a row of slabs and along them, on the ground at 1.5;
  - a flight of four stairs (each on the stone under it, a landing at the top), to 5;
  - onto a bed.
- **Not:**
  - up a whole block (stopped at its face);
  - crouching;
  - under a ceiling 2 above the floor (room to stand, not to step up);
  - in the air, falling past a slab's edge.
- **A mob** walks up onto a row of slabs.

**Bench** (`player physics` and `mobs`, against the last commit, two rounds each):

| | µs a player step | mobs: ms a frame median |
| --- | --- | --- |
| Before | 3.86 / 3.86 | 0.071 / 0.079 |
| After | 4.14 / 4.03 | 0.076 / 0.077 |

- The same walk (468 blocks covered) and the same mob paths (1,320 blocks walked).
- The player's step costs about 5% more: walking into the generated land's walls now also tries
  half a block up. It never succeeds there, as the terrain has no slabs.

**Tried in the browser** (`?seed=7&nolock`, creative, walking):
- a stone slab with plank stairs on it, placed on the grass;
- walking straight at them: up from 68.6 to 69.6 without jumping, two half-block steps, then off the
  far side and down;
- no console errors.
- **For the playtest:** how it feels, especially the eye easing up.

## Step 4: fences and panes — built (2026-11-07)

**What's there:**
- **Blocks:** `Fence` (173) and `Pane` (174), `BlockInfo.connects`. Their boxes come from their four
  neighbours (`world/shapes.ts`: `joins`, `joinsAt`, `connectedBoxes`, `blockBoxes`).
  - They join their own kind and whole solid blocks; not air, slabs, glass or the other kind.
- **A fence:**
  - drawn as a post 4/16 across and two rails (2/16 thick) to each side it joins;
  - bumped into as the post and a bar to each side, 1.5 high, so nothing jumps it;
  - a fence alone is a post.
- **A pane:** a sheet 2/16 thick from the middle to each side it joins, or a cross with none; drawn
  in the transparent pass with the glass.
- **Collision:** a fence or pane is a third kind of block in the sweep, its boxes worked out from its
  neighbours (four lookups, only for these).
  - With a box about, the sweep also looks a block lower, as a fence's top half reaches into the block
    above it.
  - `nearBox` looks there too.
- **The raycast and the outline** use the boxes as drawn.
- **The mesher** works them out from the padded border, so across chunk borders too; the faces between
  a pane's parts are left out as stairs' are.
- **Mobs:** a fence's top isn't a place to stand, so no path goes over one; a gap lets them through.
- **Survival:**
  - 3 fences from 4 planks and 2 sticks; 16 panes from 6 glass;
  - a fence gives itself (the axe digs it faster);
  - a pane gives nothing, as glass doesn't (the plan said each gives itself).
- **Icons:** a fence and a pane joined along x.
- **Also:** plank slabs and stairs now sound of wood (they had stone's since step 1).

**Tests** (11 new, 505 in all, `tests/fences.test.ts`):
- **Joining:** what joins a fence and a pane, and what doesn't.
- **The boxes:** a lone post; post and rails; 1.5 high collision; a lone pane's cross, a sheet along x.
- **Collision:**
  - walking and jumping at a fence for 2 s, the body stays on its side;
  - dropped onto a fence, it stands at 1.5;
  - from a block one higher beside it, it's stopped by the half that reaches up;
  - through between two posts that stand apart, not where they join;
  - stopped at a pane's sheet.
  - Without looking a block lower, the jump test and the reaching test both fail.
- **Raycast:** hits a post, passes beside it.
- **Mesher:**
  - a lone fence is 6 quads;
  - with a fence beside it across a chunk border, post and rails in both chunks;
  - a lone pane's 22 quads in the transparent pass, none in the opaque.
- **Mobs:** no path over a fence line, one through a gap.
- **Survival:** the recipes, drops and the axe.

**Bench** (against the last commit, two rounds each):

| | greedy meshing (ms) | µs a player step |
| --- | --- | --- |
| Before | 1,070 / 1,081 | 4.22 / 4.01 |
| After | 1,095 / 1,101 | 5.24 / 4.64 |

- Meshing is the same within noise.
- A player step costs about 0.6–1 µs more (0.002–0.004 ms a frame): `nearBox` now looks a block
  lower on every move, for fences.
- Floating ground items: 0.36 ms a frame median, as at step 1.

**Looked at in the browser** (`?seed=7&nolock`, creative):
- two fences side by side joined by their rails;
- glass panes drawn with the glass, lone ones as crosses;
- the outline round the fence's parts;
- the icons of both in the hotbar.
- No console errors.

## Step 5: measurements, and the end of the milestone (2026-11-12)

The machine was noisy today: the same bench run twice in a row gave a player step 5.3 and 7.1 µs.
So the comparisons below are A/B runs, alternating old and new, and the medians are what count.

**Bench** (`npm run bench`; `shapes` new):

| | result |
| --- | --- |
| Meshing a chunk crowded with shapes (8 layers of 32 × 32, each block a slab, stairs, fence or pane in turn: 74,774 quads) | 13.5–14.5 ms, the mesher alone (a chunk of stone: 0.87 ms in the full run, 4.9 alone) |
| A walk up a 30-step flight and back down | 5.9–6.3 µs a step, stepping up all the way |
| A player step on the usual walk, against the end of Milestone 13 (3 rounds alternating) | 6.01 / 7.86 / 5.61 µs before; 6.54 / 6.36 / 7.30 after: about 9% more by the medians |
| Greedy meshing of the usual chunks (none of the new blocks) | within noise of before, at every step |

- The crowded chunk is a worst case (every block a shape), meshed in a worker: about 3 frames of a
  worker's time, not the main thread's.
- The player step's 9% matches the steps' own measurements: about 5% for stepping up (step 3),
  and about 1 µs for looking a block lower for fences (step 4).

**In the browser** (the browser pane, radius 8):
- **`?shapes`** (new: rows of fences and panes two high, stairs and slabs, 23 × 23 round the player),
  against the same place without (`?seed=7&nolock&stats&time=0.5&mobs=0`):

  | | main thread, ms (avg, each second) | GPU, ms | draw calls |
  | --- | --- | --- | --- |
  | Without | 2.7–2.9 | 5.9–6.0 | 49 |
  | With the field in view | 2.5–3.1 | 7.4 | 51 |

  - The main thread is the same; the GPU takes 1.4 ms more, mostly the glass panes drawn blended
    over everything behind them.
  - One frame of 27 ms just after Play, when the field was made (528 blocks at once, as a tick's
    changes).
- **A 20 s sprint flight** (`?autofly=20`):
  - 1,201 frames: p50 16.7 ms, p99 16.9, the longest 17.0; none over 20 ms;
  - no holes;
  - main thread p50 3.4 ms, at most 11.6. At the end of Milestone 13: p50 2.4, at most 7.3. Today's
    baseline standing still was higher too (2.7–2.9 against 2.5), so part of that is the machine.
- No console errors.
- **Not measured:** a laptop. These are this machine's numbers; the budget is a laptop's.

**Changed from the plan, over the milestone:**
- **Texture coordinates** gained eighths in u (they had them only in v), so half-width faces crop their
  textures (step 1).
- **Drops:** a slab made whole is its block and gives that (the plan said a double slab gives two;
  there's none). A pane gives nothing, as glass doesn't (the plan said each gives itself).
- **Plank slabs and stairs** sound of wood (fixed in step 4; stone's since step 1).
- **The collision sweep** looks a block lower when there's a box about, for a fence's top half (step 4).

## Playtest questions

1. **Stepping up:**
   - does walking up a slab, a stair or a bed without jumping feel natural?
   - does the eye easing up feel smooth, or floaty, or too slow?
   - is it ever surprising, stepping up when you didn't mean to?
2. **Stairs:** are they placed the way you expect (the back away from you, upside down from a ceiling
   or the top half of a side)? Do you miss corner stairs?
3. **Slabs:** is the half they go in where you'd expect when clicking a side? Is a slab on a slab
   making the whole block what you'd want?
4. **Fences:** do they join where you expect (fences and solid blocks, not slabs or glass)? Does 1.5
   high feel right: you can't jump them, and neither can mobs? Is it annoying with no fence gate?
5. **Glass panes:** do they look right, joined and alone (a cross)? Should a lone pane be a flat sheet
   instead?
6. **Looks:** the shapes' textures cropped to each part, and their icons in the hotbar and picker.
7. **Building:** with slabs, stairs, fences and panes, what's missing next (corner stairs, fence gates,
   walls, more materials)?
8. **Survival:** are the recipes about right (6 slabs from 3, 4 stairs from 6, 3 fences from 4 planks and
   2 sticks, 16 panes from 6 glass)?

