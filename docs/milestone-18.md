# Milestone 18: getting about

**Status:** plan, to check (2026-11-20).

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
   with logic; tests.
2. **Carts.** Vehicles, their manager, rail physics, riding, chest carts, drawing, saving; `?railway`;
   tests.
3. **Boats.** Water physics, rowing, placing on water, drawing; `?boat`; tests.
4. **The map.** Paper and maps, explored tiles, the panel and full-screen map, saving; tests.
5. **Together.** Vehicles to guests, riders moving their own, `mount` and `dismount`, chest carts,
   riders drawn; PROTOCOL 11; tests.
6. **Measurements,** notes, playtest questions.

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
