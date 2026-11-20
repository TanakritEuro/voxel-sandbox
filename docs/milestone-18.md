# Milestone 18: getting about

**Status:** built (2026-11-21), waiting for playtests.

## Goal

Ways to travel further than you can walk, and a way to know where you've been:
1. **Boats** on the sea and on Milestone 16's rivers.
2. **Rails and carts,** laid by hand, with powered rails driven by Milestone 10's logic signals: a
   railway you can build, switch and stop.
3. **A map** that fills in as you explore.

Everything works together: the host owns the vehicles, and guests ride them. Physics, rail shapes,
saving and the map are tested headless; how riding feels is left for playtests.

## Design

### Vehicles (`src/vehicles/`, new)

- **`Vehicle`:**
  - a kind (boat, cart, chest cart);
  - a body (a box, as mobs and items have) and its yaw;
  - a speed along its rail (carts);
  - who is riding (a player number, or none);
  - a chest cart's 27 slots.
- **`VehicleManager`:**
  - steps every vehicle at the mobs' fixed rate;
  - stores the vehicles of a column when it unloads and gives them back when it loads (as kept animals
    are);
  - saves them in the world record's `vehicles`, cleaned on load;
  - at most 256 a world.
- **Vehicles aren't solid:**
  - players and mobs walk through them, and vehicles pass through each other;
  - a right click gets in;
  - hitting one 3 times (once in creative) breaks it back into its item, a chest cart's contents dropped.
- **Riding:**
  - right click to get in; crouch (Shift) to get out, set down beside it where there's room;
  - the player's body follows the seat, and its own physics waits;
  - you look about freely;
  - falls are reset on getting out, so a cart down a hill doesn't kill you.
- **Drawing:**
  - a `vehicleRenderer.ts` like the mobs': boxes, one instanced mesh per box, lit by the world's light;
  - a rider drawn sitting (this player's own held view unchanged).

### Boats (`vehicles/boat.ts`)

- **The boat:**
  - 1.4 wide (a square box: boxes don't turn), 0.6 high;
  - floats with its bottom a little under the water's surface;
  - bobs slightly;
  - on land it drags to a stop; falls like anything.
- **Controls:** W and S row forward and back (4.5 blocks a second, faster than swimming's 2.2), A and D
  turn. Flowing water carries it (`currentAt`).
- **Made from 5 planks.** Placed on water by right-clicking the water's surface.
- **`?boat`** puts you in a boat on the nearest water (with `?find=river` for a river).

### Rails (`world/blocks.ts`, `world/rails.ts`, new)

- **Rail blocks (ids 182–203):**
  - plain rails in 10 shapes:
    - straight north–south and east–west;
    - 4 slopes, rising one block over the length of a block;
    - 4 curves;
  - powered rails in 6 shapes (no curves), each off and on.
- **Not solid,** like torches and wheat:
  - drawn flat 1/16 above the block below, or slanting up to the next block for a slope;
  - in the cutout pass (sleepers and rails on a see-through texture);
  - held up by the block under them (`torchSupport`);
  - clicked by a thin box.
- **Shapes from neighbours (`rails.ts`, pure):**
  - a rail placed joins up to two rails beside it (or a block higher, making a slope);
  - a rail with an open end beside it turns to join the new one, as a fence joins;
  - the same when a rail is broken.
  - Always the same result, whatever order rails are laid in.
- **Powered rails** take a signal like a lamp: on while a wire, switch or charged block beside or under
  them is on (`logic.ts`, a new consumer).
- **Recipes:**
  - 16 rails from 6 iron and a stick;
  - 6 powered rails from 6 iron, a copper and a stick;
  - a cart from 5 iron;
  - a chest cart from a cart and a chest.

### Carts (`vehicles/cart.ts`)

- **On a rail:** a cart moves along its line through each block (straight, curved or sloped), with a
  speed along it:
  - gravity on slopes;
  - a little friction (from 8 blocks a second it runs about 100 blocks on the level);
  - an **on** powered rail pushes it up to 8 blocks a second the way it's going (or off the block behind
    if it stands still);
  - an **off** one brakes it to a stop.
  - A cart at a rail's dead end stops.
  - A rider's W pushes gently the way they look (as on foot, slowly), only from a near standstill.
- **Off rails:** a box that slides to a stop.
- **A chest cart** carries 27 slots, opened with a right click (like a chest), and can't be ridden.
- **`?railway`:**
  - builds a loop of rails on a raised bed round you, about 120 blocks round, with powered stretches
    and a switch;
  - puts you in a cart on it;
  - reports frame times after a few laps (as `?autofly` does), to measure riding through loading land.

### The map (`survival/map.ts`, `render/mapView.ts`)

- **Paper:** 3 from 3 reeds (Milestone 16's reeds have a use). A map: 8 paper and a copper.
- **What it records:**
  - every column within 4 chunks of a player is **explored**;
  - for each explored column, a 16 × 16 tile of colours (one pixel for 2 × 2 blocks: the top block's
    colour, darker by height steps, water by depth), taken when the column is loaded or changes;
  - kept per world (saved run-length encoded in the record's `map`, measured in step 4), not per item,
    so every map in a world shows the same.
- **Showing it:** holding a map draws it in a panel:
  - 256 × 256 blocks round you, north up, with you as an arrow;
  - M opens it full screen, scrolled and zoomed with the wheel;
  - what isn't explored is blank parchment.
- **Playing together:** each player's map is their own world's record, so the host's for the host. A
  guest explores and keeps their own map, saved by name like their inventory. Shared maps could come
  later.

### Playing together (`net/`)

- **The host owns the vehicles:** it steps them and sends their states with the mobs' (`vehicleState.ts`,
  about 40 bytes each, the rider and a cart's speed).
- **A ridden vehicle is moved by its rider:**
  - a guest riding steps their boat or cart themself (rails and water are the same for both) and sends
    its place in their player state;
  - the host takes it, checked it isn't a jump across the map, as for the player.
  - So riding feels as quick for a guest as walking does.
- **New messages:** `mount` and `dismount` (asked of the host, which says yes if nobody's in it and the
  guest is within reach), and a chest cart's slots through the existing container messages.
- **`PROTOCOL` 11.**

## Files

| File | Change |
| --- | --- |
| `src/vehicles/vehicle.ts`, `manager.ts` (new) | `Vehicle`, `VehicleManager`: stepping, riding, breaking, by column, saving |
| `src/vehicles/boat.ts`, `cart.ts` (new) | boat physics on water; cart physics along rails (pure) |
| `src/world/rails.ts` (new) | rail shapes from neighbours, a rail's line through its block (pure) |
| `src/world/blocks.ts` | rails and powered rails (182–203), not solid, held up |
| `src/world/logic.ts` | powered rails on while signalled |
| `src/mesh/mesher.ts`, `world/textures.ts` | rails flat and sloped in the cutout pass, their textures |
| `src/world/raycast.ts`, `physics.ts` | a rail's thin box to click; not bumped into |
| `src/survival/items.ts`, `crafting.ts` | boat, cart, chest cart, paper, map; their recipes |
| `src/survival/map.ts` (new) | explored columns, tiles, saving |
| `src/render/vehicleRenderer.ts`, `mapView.ts` (new) | boats and carts drawn; the map panel and full-screen map |
| `src/render/playerRenderer.ts` | riders sitting |
| `src/player.ts`, `src/game.ts` | getting in and out, riding, the camera at the seat; `?boat`, `?railway` |
| `src/save/store.ts` | `vehicles`, `map` in the world record |
| `src/net/protocol.ts`, `session.ts`, `vehicleState.ts` (new), `playerState.ts` | vehicles to guests, riding, `mount`/`dismount`, PROTOCOL 11 |
| `bench/bench.ts` | carts on a long railway, boats, saving vehicles and the map |

## Tests

- **Rails:**
  - each shape's line through its block, slopes rising one block;
  - placing joins neighbours the same in any order;
  - breaking one turns its neighbours back;
  - powered rails on and off with a signal;
  - a rail held up, and dropped when its block goes.
- **Carts:**
  - rolling along a straight, round a curve, up and down a slope (speed from height);
  - coming to a stop by friction, at a dead end, on an off powered rail;
  - pushed to 8 blocks a second by an on one;
  - never leaving the rail at full speed round a curve;
  - the same path whatever the frame times (fixed step).
- **Boats:**
  - floating at the surface;
  - rowing faster than swimming;
  - turning;
  - carried by a current;
  - stopping against a shore;
  - dragging on land.
- **Riding:** getting in, the body at the seat, getting out beside it where there's room (not into a
  wall); no fall damage from a ride.
- **Vehicles:**
  - stored with their column and given back;
  - saved and loaded, a chest cart's slots too, junk cleaned;
  - the cap;
  - breaking gives the item back.
- **The map:**
  - columns explored round the player, their tiles' colours from the top blocks;
  - saved and loaded;
  - its size measured for 1000 columns.
- **Network** (loopback):
  - a guest gets in, rides and gets out, the host seeing it move;
  - two can't ride one boat;
  - a chest cart's slots through the host.

## How to measure

- **Bench:**
  - 50 carts running on a long railway (ms a frame);
  - 50 boats on the sea;
  - saving and loading 256 vehicles;
  - the map's tiles for a 64 × 64-column area, made and saved (time and bytes).
- **Browser:**
  - `?railway` at full speed through loading land: frame times, holes, over 20 ms;
  - `?boat` along a river;
  - the map open in a world with 1000 explored columns: time to draw a frame.
- **Before and after:** the mobs and sprint flight numbers, which shouldn't move.

## Steps

1. **Rails.** Blocks, shapes from neighbours, meshing flat and sloped, held up, recipes, powered rails
   with logic; tests. Done (2026-11-20).
2. **Carts.** Vehicles, their manager, rail physics, riding, chest carts, drawing, saving; `?railway`;
   tests. Done (2026-11-20).
3. **Boats.** Water physics, rowing, placing on water, drawing; `?boat`; tests. Done (2026-11-20).
4. **The map.** Paper and maps, explored tiles, the panel and full-screen map, saving; tests. Done (2026-11-20).
5. **Together.** Vehicles to guests, riders moving their own, `mount` and `dismount`, chest carts,
   riders drawn; PROTOCOL 11; tests. Done (2026-11-20).
6. **Measurements,** notes, playtest questions. Done (2026-11-21).

## Decisions to agree

1. **Vehicles aren't solid:** you walk through them and they pass through each other. Carts don't
   bump on a shared track. Solid vehicles need the vehicles to collide with each other and with
   players, a much bigger job.
2. **Powered rails, no other rail kinds:** no switches between tracks or detectors. A junction is two
   curves you change by breaking and relaying a rail, or by a powered stretch to stop at.
3. **A ridden vehicle is moved by its rider,** even a guest's, so riding isn't laggy; the host checks it
   as it checks players.
4. **One map per world,** filling in as anyone explores. Not one map per item, and guests keep their
   own.
5. **Carts go at most 8 blocks a second** and boats 4.5: faster than sprinting (5.6) and swimming, slower
   than flying, so loading keeps up.
6. **Recipes and costs:**
   - rails are iron-hungry (6 iron for 16), powered rails need copper;
   - boats are 5 planks;
   - maps are 8 paper (from reeds) and a copper.

## Step 1: rails (2026-11-20)

**What's in:**
- **Blocks:**
  - rails 182–191 by shape: straight along z and x, four slopes, four curves (`rail`, `railOf`);
  - powered rails 192–203: the six straight and sloped shapes, off and on (`poweredRail`).
  - Each is a sheet, walked through, in the cutout pass, held up by the block under it (broken with
    it), broken in 0.7 s (a pick is the right tool, any tier).
  - The picker and inventories have one of each kind; any shape gives that back when broken.
- **`world/rails.ts`:**
  - each shape's two ends and the side it rises towards (`RAIL_ENDS`, `RAIL_RISE`, `shapeWith`);
  - two rails join when each has an end towards the other, level, or with the lower rising to the
    higher; `joinedEnds`;
  - `railPlacement`: a rail laid joins the rails beside it (level, a block up, a block down):
    - those already pointing at it first;
    - then any that are open (joined at most once), which turn to it, keeping the end they have;
    - two if it can (straight before curved, curves not for powered rails);
    - it rises towards one a block up, and one a block down rises to it;
    - with nothing beside it, it lies the way the player looks.
  - A straight line or a loop comes out the same in any order it's laid in (tested over 12 and 20
    orders).
- **Meshing (`railSheet`):** one quad a sixteenth over the floor, or slanting up a block for a slope (two
  quads, one seen from under it). The texture is turned to the shape:
  - straight rails run up the image;
  - a curve goes from the image's bottom edge to its right.
- **Textures:** `rail` (grey rails on brown sleepers, clear between), `rail_curve`, `powered_rail` and
  `powered_rail_on` (copper rails, a strip down the middle, dark off and glowing on).
- **Logic:** powered rails are on while a lamp in their place would be lit (a powered wire, a source on, a
  gate on facing in, beside, above or under them). They're logic blocks, so a loaded column wakes them.
- **Recipes:** 16 rails from 6 iron and a stick; 6 powered rails from 6 iron, a copper and a stick.
- **Laying in the game:** a rail goes on the top of an opaque block, into air; it and the neighbours that
  turn are edits, so a guest's go to the host. `settable` takes any rail shape and powered rails only off.
- **`?railway`:**
  - a loop of 116 rails, 40 x 20, round the player;
  - on a stone bed a block over the highest ground under it, air cleared over the rails;
  - a hump on the near side, slopes up a block and up again;
  - ten powered rails on the far side, a wire beside them and a switch, on.
  - Laid a rail at a time with `railPlacement`, as a player would, then made at once.
- **Tests (11 new, 1 updated):**
  - shapes;
  - blocks, drops, the picker and `settable`;
  - recipes;
  - laying: alone, beside one, a straight line and a loop in any order, slopes laid either way, a rail
    joined at both ends left alone, powered rails not curving;
  - powered rails with a switch and a charged block;
  - the mesh of a flat rail and each slope's corner heights.
  - The picker's count updated.

**Measured:** the bench's meshing makes the same triangles as before (1924k greedy for the 724 chunks).
Every time was 15–17% lower than Milestone 17's last run, generation too, which this step didn't touch:
the machine is faster today.

**In the browser** (`?seed=20261022&railway&nolock`, flying over it):
- the loop on its bed, sides straight;
- the hump's slopes each rising a block;
- the powered stretch glowing beside its powered wire;
- no console errors.
- **A bug found there:** every curve's texture was a half turn out, bending round the outer corner. The
  shader reads v upwards and image rows downwards, so the image's bottom is -z, not +z. The turns are
  fixed, and the corner now curves round the inside.

**Changed from the plan:**
- **Breaking a rail leaves the rails beside it as they are,** rather than turning them back: the next rail
  laid there joins them again, and nothing else turns unexpectedly.
- **"The same in any order"** holds for lines and loops; at a junction of three, the first two laid win.
- **Rails are clicked as a whole block,** as wire is, not by a thin box: no new click shape.
- **`?railway`** came in this step without its cart, to look at the rails.

## Step 2: carts (2026-11-20)

**What's in:**
- **`vehicles/vehicle.ts`:** a `Vehicle` has:
  - a kind (cart or chest cart) and a body 0.9 wide and 0.7 high;
  - its facing and pitch;
  - where it is on a rail (`OnRail`: the rail's block and how far along its path) and its speed along it;
  - its rider, its hits, and a chest cart's 27 slots.
- **`vehicles/cart.ts`** (pure):
  - **a rail's path:** straight from the middle of one end's side to the other's, rising a block on a
    slope, a quarter circle of half a block round the corner on a curve (`railPoint`, `railTangent`,
    `railLength`);
  - **`stepCart`:**
    - gravity down slopes (14 blocks a second², times the slope);
    - a powered rail that's on pushes it up to 8 a second the way it's going (from a standstill, away
      from a dead end); one that's off brakes it;
    - drag (7% of its speed a second and 0.05 more), so from top speed it rolls 80–130 blocks on the level;
    - a rider's W starts it from a near standstill (up to 1.5) the way they look;
    - on through each end into the rail joined there (`nextRail`, new in `rails.ts`), entering it from
      either end; stopping at a dead end;
  - **off rails** a box falling and sliding to a stop, landing back on a rail it comes down on
    (`putOnRail`).
- **`vehicles/manager.ts`** (`VehicleManager`):
  - carts put only on rails, at most 256 a world;
  - stepped at 60 Hz, drawn between steps;
  - riding: one rider each, never a chest cart;
  - three hits within 2 seconds break one (one in creative), giving the cart back, a chest cart its chest
    and contents too;
  - stored when their column unloads (not while ridden), given back when it loads;
  - saved in the record's `vehicles`, cleaned on load.
- **Items and recipes:** a cart from 5 iron; a chest cart from a cart and a chest. Pictures: an iron tub on
  wheels, the chest cart wooden with a lid.
- **In the game:**
  - right-clicking a rail with a cart (survival) puts it there;
  - right-clicking a cart gets in; a chest cart opens as a chest;
  - left-clicking hits it; Shift gets out, beside it, off the track where there's room;
  - riding, the player's body sits where the cart is drawn (`Player.seat`), its own physics waiting, a
    sitting eye, no footsteps, no falls counted;
  - dying or lying in bed gets you out.
  - Carts are the host's or a lone player's for now: guests don't see them until step 5.
- **Drawing** (`render/vehicleRenderer.ts`): as the mobs are drawn:
  - an iron tub (floor, four sides) on four small wheels; a chest cart has a chest in it;
  - one InstancedMesh a box, lit by the world's light, fogged;
  - facing along the rail, tipped on slopes.
- **`?railway`** now puts you in a cart at the end of the powered stretch with a start, and has seven
  powered rails before the hump each way (fed by a charged block through a wire), so the cart has the
  speed to climb it every lap. **`?railway=60`** reports frame times after a minute of riding.
- **Tests (12 new, 1 updated):**
  - each shape's path, its ends, and its tangent along it;
  - rolling to a stop on the level from top speed (80–130 blocks);
  - stopping at a dead end;
  - rolling down a slope from a standstill;
  - laps of a loop kept to the rails, pushed by powered rails on and stopped by them off;
  - starting off a powered rail away from a dead end, and a rider's push;
  - falling onto a rail;
  - the same steps however the frames fall;
  - carts only on rails, the cap, chest carts' slots, one rider each;
  - breaking, and what it gives;
  - storing by column (not a ridden one);
  - saving and loading, with junk cleaned.
  - Updated: the item test's last item.

**In the browser** (`?seed=20261022&railway=60&nolock`):
- riding laps of the loop, the cart's iron sides round you, over the hump and round the corners;
- **riding for 60 s:** 7195 frames, p50 8.3 ms, p95 8.5, p99 8.5, max 17.2, none over 20 ms;
- getting out with Shift: beside the track, the cart rolling on alone;
- from above, the cart going round;
- no console errors.
- **Found there:**
  - the first `?railway` cart stood on the powered stretch's west end going west, got one block of push
    and stopped 26 blocks on. It now starts at the east end, through all ten.
  - From 8 blocks a second a cart can't climb the two-block hump 55 blocks on (it needs about 7.5 at its
    foot), so `?railway` has powered rails before it each way.
  - Getting out first put the rider on the next rail along the track (it's room to stand). Spots without
    a rail come first now.
- **Not tried in the browser:** putting a cart down from the inventory, a chest cart, breaking one (the
  tests cover them).

**Changed from the plan:**
- **Creative players have no cart item:** the creative hotbar holds only blocks. In creative there's
  `?railway`'s cart for now; carts in the creative picker are a question for the playtest.
- **The rider's W** only starts a cart from a near standstill (up to 1.5 blocks a second), as planned, and
  carts don't steer at junctions (there are none).

## Step 3: boats (2026-11-20)

**What's in:**
- **`VehicleKind.Boat`:** a square box 1.4 wide (boxes don't turn) and 0.6 high.
- **`vehicles/boat.ts`** (pure):
  - `surfaceAt`: the water's surface in the column under the boat's middle (a full block under more
    water, else its depth);
  - **`stepBoat`:**
    - afloat, its bottom sprung to 0.06 under the surface and damped;
    - rowed: W forwards at 4.5 blocks a second (twice swimming's 2.2), S back at half, A and D turning
      2.2 radians a second, its speed easing to what's rowed (and gliding to a stop);
    - flowing water's current added (`currentAt`, `TUNING.water.push`);
    - shores stop it (it moves as a box);
    - out of the water it falls, and on land drags to a stop, rowed only at 0.6;
  - `waterOnRay`: the first water surface along the view within reach, not through anything solid.
- **The manager** puts boats on water (`placeBoat`) and steps each vehicle by its rider's `RiderInput`
  (W/S, A/D and the way they look): boats are rowed; carts pushed from a standstill while W is held, as
  before. Records take boats.
- **Item and recipe:** a boat from 5 planks; its picture a hull with an oar.
- **In the game:**
  - right-clicking water with a boat (survival) puts it there;
  - right-clicking a boat gets in, sat 0.2 over its bottom;
  - rowing turns the rower's view with the boat;
  - Shift gets out onto the shore if one's beside it, else into the water.
- **Drawing:** a plank hull longer than it's wide (1 × 1.5), low sides, a seat across it; bobbing a
  little afloat.
- **`?boat`:** the nearest water within 48 blocks, a boat on it, and the player in it
  (`?find=river&boat` for a river).
- **Tests (8 new, 1 updated):**
  - the surface, still and flowing;
  - settling afloat from a drop;
  - rowing faster than swimming, turning, gliding to a stop;
  - stopping at a shore;
  - carried down flowing water;
  - falling onto land and dragging there;
  - put on water along a ray, not through stone, not out of reach;
  - the recipe, the seat, rowing through the manager, saving and loading, breaking.
  - Updated: the item test's last item.

**In the browser** (`?seed=20261022&find=river&boat&nolock`):
- in a boat on the river, the hull round you;
- W rowed about 10 blocks in 2.5 s;
- D turned the boat and the view with it;
- got out in mid-river into the water, swam up, saw the boat floating, got back in with a right click;
- no console errors.
- **Found there:** with the bottom 0.2 under the surface, water showed inside the hull over its floor. The
  draft is 0.06 now, the floor just above the water.

**Changed from the plan:** getting out with no shore beside the boat puts you in the water (to swim). The
plan didn't say.

## Step 4: the map (2026-11-20)

**What's in:**
- **`survival/map.ts`** (`WorldMap`, pure):
  - a tile of 16 × 16 pixels per explored column, each pixel 2 × 2 blocks;
  - each pixel holds its top block, and a shade: land lower than, level with or higher than the pixel north
    (so hills show), water deep (6+), middling (3–5) or shallow;
  - `tileOf` takes a tile from the loaded column, finding each top by skipping all-air chunks;
  - `explore`: the loaded columns within 4 chunks of the player not yet explored (or edited since),
    nearest first, two a frame;
  - `touch`: an edit's column taken again when next near;
  - `paint`: any window at any scale into RGBA, the top block's colour by its shade, unexplored land
    parchment;
  - saved in the record's `map`, each tile run-length encoded as base 64, cleaned on load.
- **Items and recipes:** paper, 3 from 3 reeds; a map from 8 paper and a copper; pictures of a sheet and of
  a map.
- **`render/mapView.ts`:**
  - holding a map (survival), a panel in the bottom right: 256 × 256 blocks round you, 2 a pixel, north
    up, you an arrow the way you look, painted four times a second;
  - **N** opens the map full screen (in creative always, in survival with a map in the inventory):
    zoomed with the wheel (half a block to 8 blocks a pixel, a block to start), dragged about, closed with
    N, Esc or a click outside. The world goes on while it's open, as with the inventory.
- **The game** explores round the player each frame, touches the tile of every edit's column, and saves the
  map with the record. A guest's map is their own for the visit, not saved.
- **`?kit`** also gives rails, powered rails, a cart, a chest cart, a boat, reeds and a map.
- **Keys help:** N map, M mute.
- **Tests (5 new, 1 updated):**
  - a tile's top blocks and shades (a platform, a step, a shallow and a deep pool, the top row against the
    column north, a generated column against its tops);
  - exploring nearest first, a few at a time, only loaded columns, and again after an edit;
  - painting explored land by shade and the rest parchment;
  - saving and loading tile for tile, small, junk left out;
  - the recipes.
  - Updated: the item test's last item.

**Measured** (bench `map`, the 289 columns round the origin):
- 0.43 ms a tile under Vitest, so two a frame cost under a millisecond while exploring;
- saved 229 bytes a tile: 65 KB for the 289, about 224 KB for 1000 columns;
- the 289 saved in 1.9 ms and loaded in 3.6 ms.

**In the browser** (`?seed=20261022&survival&kit&nolock`):
- N after a few seconds: 81 columns explored; the coast, the sea darker where deeper, the beach, grass
  dotted with trees, a snowy slope, a camp's planks; zoomed in with the wheel;
- the map moved to the hotbar and held: the panel in the corner, the arrow at the player;
- the inventory with the kit's rails, carts, boat, reeds and map, each with its picture;
- no console errors.
- **Found there:**
  - the full-screen map started at 2 blocks a pixel, the explored land a small patch in the middle; it
    starts at 1 now;
  - the hotbar showed over the map's backdrop, so the map has a z-index now.

**Changed from the plan:**
- **N, not M,** opens the map: M already mutes.
- **A guest's map** lasts the visit, not saved by name as the plan had it: a map is hundreds of KB, too
  much to keep for every guest in the host's record. It could come later.
- **Rails, carts, a boat and a map in `?kit`,** for trying them.

## Step 5: together (2026-11-20)

**What's in:**
- **Vehicles to guests (`net/vehicleState.ts`):**
  - 13 float32s each (52 bytes): id, kind, place, facing, pitch, rider, speed, and on a rail how far
    along and its block;
  - the host sends each guest those within 96 blocks with the mobs (`shareVehicles`, a new `vehicles`
    message);
  - a guest's `VehicleMirror` draws them between snapshots, as mobs are.
- **Riding together:**
  - **a guest gets in at once:** it rides its own copy of the host's vehicle, from where the host last had
    it (`VehicleManager.adopt`), steps it itself, and asks the host (`mount`);
  - **the host checks reach and that nobody's in it,** or answers `dismount` (the guest gets out);
  - **riding, the guest's state carries the vehicle's pose** (`PlayerState.riding`, 168 bytes instead of
    80): id, place, facing, speed, rail. The host takes it unless it's a jump of over 16 blocks, and
    doesn't step that vehicle meanwhile (`riddenElsewhere`);
  - **getting out** (`dismount`) gives it back to the host to step from where the guest left it;
  - a guest who leaves is out of what it rode;
  - one broken under a rider tells the rider it's out (the host itself, or a guest).
- **Guests putting down and hitting vehicles** (`vplace`, `vhit`): the host checks reach, a rail or water
  there, and makes them; a refused one comes back (`given`). Hits break as the host's world has it (one
  in creative, three in survival, what it gives on the host's ground).
- **Chest carts** go through the container messages as the place (their id, `VEHICLE_Y` = -1, 0): no
  block is ever there. `hostSurvival` serves them as chests, checked by reach to the cart.
- **`net/hostVehicles.ts`** (pure): the host's side of all this, as `hostSurvival.ts` is for survival.
- **Riders drawn sitting:** a player whose state says they ride is lowered 0.6 with their legs out in front.
- **`PROTOCOL` 11.**
- **Tests (7 new, 3 updated):**
  - vehicle states, their rider and rail, bad ones refused;
  - the riding state (168 bytes), a vehicle far from its rider refused, a rider's pose sitting;
  - the new messages, and a chest cart's container place (not y -2, not z 1);
  - the mirror between snapshots;
  - **through the loopback network:**
    - a guest sees a host's cart and gets in;
    - a second guest is refused and told;
    - the rider's pose is taken, a jump isn't;
    - getting out gives it back;
    - a guest puts down a cart, a chest cart with no rail under it comes back, and its hit breaks one
      (creative), putting the host out of it;
    - a guest opens a chest cart, puts and takes.
  - Updated: the test host and the two `HostWorld` fakes.

**In the browser:**
- `?railway&bot=1`: the host riding with a test guest in: 120 fps, 25 KB/s out, 52 messages a second,
  no console errors.
- `?bot=2` with the bots briefly made to say they ride (not kept): they're drawn lowered, sitting.
- **Not tried:** two browsers playing together, a guest riding (the loopback tests cover it).

**Changed from the plan:** none.

## Step 6: measurements (2026-11-21)

**Bench** (`npm run bench`, the server stopped; a slow day, generation 1147 against 710 at step 1, so compare
ratios):

| | |
| --- | --- |
| `carts` (new) | 50 on a loop of 500 rails in the air, 6 in 20 along the long sides powered, 60 s: all 50 still moving, 6.7 blocks a second each; 0.083 ms a frame median, p95 0.244, max 1.38 |
| `boats` (new) | 50 rowed round in circles on the sea, 60 s: 45 afloat at the end (5 rowed ashore); 1.15 ms a frame median, p95 2.16, max 4.4 (about 23 µs a boat: each step finds the surface and the current and moves the box) |
| Vehicles saved | 256 (50 boats, 206 chest carts full): 144 KB, saved in 0.76 ms, loaded in 1.98 ms |
| `map` | 0.46 ms a tile; 229 bytes a tile saved (224 KB for 1000 columns) |
| Map painted | full screen 1024 × 1024: 12–20 ms at any zoom (was 73–95 before this step); the panel 128 × 128: 0.16 ms |
| Meshing | the same 1924k triangles; mobs, gloamers, delvers, kept animals about as before against generation |

- **The first `carts` run stopped most of its carts:** its powered rails reached the loop's corners, and
  powered rails don't curve, so each corner was a dead end. The bench keeps them 3 from the corners now. A
  player laying powered rails round a corner gets the same, which is a playtest question.
- **Painting the map was slow:** 73–95 ms for the full-screen map at 1024 pixels a side. It's 4–6 times
  faster now:
  - a table of every block's colour at each shade instead of working each pixel out;
  - the row of columns' tiles looked up once each time the row changes.
  - The full-screen map now repaints at most four times a second when only the player moves (riding with
    it open); zooming and dragging still repaint at once.
- **Exploring is one tile a frame** (was two): about 0.4 ms at the most, still 120 a second.

**In the browser:**
- **Sprint flights** (`?autofly=40`), four on a day the bench ran 1.6 times slower than the day before:
  - frames p50 8.3, p99 16.5–16.6 ms;
  - 0–3 frames over 20 ms (max 25), none over 33;
  - main thread p50 3.4–3.6, p99 8.8–9.5, max 13.8–15.7 ms;
  - **missing chunks in one second of each run** (1, 6, 9 and 1). Milestone 16's flights had none.
  - One of the four ran with the map's exploring switched off, with the same result, so it isn't this
    milestone's map. The 25 s flight before opening the map had none.
- **`?railway=40` with the full-screen map open,** repainting as the cart went: 4791 frames, p50 8.3, p99 8.5,
  max 25.0 ms, 1 over 20.
- **`?railway=60`** (step 2): p50 8.3, p99 8.5, max 17.2, none over 20.
- **`?find=river&boat`, rowing 20 s:** 88 blocks (4.4 a second), no frames over 20 ms after loading, main thread
  2.5 ms on average.
- No console errors anywhere.

**Not measured:** a laptop; two browsers, a guest riding; a map of 1000 explored columns in the browser (the
bench's painting covers the cost).

**Changed from the plan, over the milestone:**
- **Rails:**
  - breaking a rail leaves its neighbours as they are;
  - "the same in any order" holds for lines and loops;
  - rails are clicked as a whole block, as wire is.
- **`?railway`** came in step 1 (without its cart), and has powered rails before its hump each way.
- **Carts:**
  - creative players have no cart item: the creative hotbar holds only blocks;
  - `?kit` gives rails, carts, a boat and a map in survival.
- **Boats:** getting out with no shore beside puts you in the water.
- **The map:**
  - N opens it (M already mutes);
  - a guest's map lasts the visit;
  - exploring is one tile a frame.
- **`PROTOCOL`** went to 11 in step 5 as planned.

## Playtest questions

Try `?railway` (a loop with a cart, in creative), `?find=river&boat`, and a survival world with `?survival&kit`
(rails, carts, a boat and a map in the inventory).

1. **Laying rails:** do they join up the way you expect: straight lines, corners, slopes up a block? Is a corner of
   powered rails (which stays a dead end: powered rails don't curve) a surprise?
2. **Carts:**
   - does riding feel right: the speed (8 blocks a second at most), coasting about a hundred blocks, climbing and
     rolling down slopes?
   - are powered rails worth their copper: how far apart do you need them?
   - getting in and out (right click, Shift): anything awkward?
3. **Chest carts:** useful for moving things?
4. **Boats:** does rowing feel right: speed, turning, the view turning with the boat? Is getting out into the water
   (with no shore beside) fine?
5. **The map:**
   - does the panel while holding a map help, and is N for the full map easy to find?
   - do the colours and shading read well (hills, water depth, trees)?
   - is 4 chunks round you the right distance to fill in?
6. **Creative:** should carts and boats be in the creative picker?
7. **Together:**
   - does a guest's ride feel as smooth as the host's?
   - can two of you share a railway without trouble (carts pass through each other)?

