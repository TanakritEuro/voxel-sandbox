# Milestone 2 plan: walking player

## Status: in progress (steps 1–3 of 5 done)

Approved 2026-10-23 as proposed: fly mode collides with blocks, breaking takes time in fly
mode too, sprint on Ctrl only.

## Results so far

**Step 1 (physics).** `world/physics.ts`: `moveBody` sweeps y, x, z, checking every layer
of blocks crossed and setting the position to the face it stops at (so resting heights are
exact: feet at 41, not 40.99999); `stepPlayer` walks, sprints, jumps and flies. Position
moves by the average of the step's start and end velocity, which is exact under steady
gravity, so the jump peaks at `jumpHeight` (1.25) at any step length. `FixedStep` (in
`math.ts`) turns frame times into steps and drops the backlog after a stall. 13 tests: exact
landing, no tunnelling through a one-block floor even in a single 1000-block move,
terminal velocity, stopping at a wall face, sliding along a wall at √½ of walking speed,
inside corners, a 1 × 2 gap passable and 1 × 1 not, jump apex, a 1-block step climbable
and 2 not, a ceiling 0.2 above the head, flying without gravity but with collision, and
identical bodies after 2 s of changing input at 30, 60 and 144 fps.

Differs from the plan: fly speeds stay in `TUNING.fly` (with the mouse sensitivity) rather
than moving into `TUNING.player`. The game doesn't use the new physics until step 2.

**Step 2 (the player in the game).** `input.ts` holds keys, keeps presses until taken
(a tap of Space between two physics steps still jumps) and does mouse look; `Player` runs
`stepPlayer` at 120 Hz through `FixedStep`, draws the camera between the last two steps,
toggles flying on F or two taps of Space within 0.3 s, ends a flight on landing, and holds
still until the 3 × 3 columns around it are loaded. You spawn standing on the dry-land
column. Placing a solid block is refused where it would overlap the player (water still
goes anywhere). `?autofly` flies through the same player with collision off.

Checked in the pane by sending held keys from the page: W for a second walked 4.7 blocks
and stepped down a 3-block ledge, Space jumped and landed, F + Space flew up 12 blocks,
Shift came down and landing switched back to walking, two quick Space taps flew again.
`?autofly` at radius 8 unchanged: main thread p99 3.7 ms, max 4.3 ms, nothing over 20 ms,
no holes. 7 more tests: waiting for loaded columns, a tap shorter than a step jumps,
double-tap vs two slow taps, F / Space / Shift / landing, the interpolated camera, and
placement (feet, head, straddling, next to, above, under, mid-jump, touching a face).

Differs from the plan: placement moved here from step 4 (it was needed as soon as you
could stand somewhere). `Player` reads a small `Controls` interface rather than `Input`,
so the tests drive it without a DOM.

**Found on the way: Ctrl+W closes the tab.** Browsers keep Ctrl+W for themselves and a
page can't stop it, so holding Ctrl to sprint (or to fly fast, as in the scaffold) and
then pressing W closes the game. Pressing W first and Ctrl second is safe. Decided
2026-10-23: sprint is a toggle. A tap of Ctrl starts it (and fast flying), another tap or
no longer moving forward ends it, so there is no reason to hold Ctrl.

**Step 3 (crouching, swimming, underwater).** Shift while walking crouches: crouching
speed 1.3, the eye eases down 0.3, sprinting stops, and on the ground any move that would
leave nothing under the box is shortened (in 0.005-block steps, axis by axis), so you can
walk right up to an edge and along it. In water (the box touching a `liquid` block) the
velocity is pulled towards the wanted one at `drag` 4/s: across at 2.2, up at 3.5 with
Space, otherwise down to a 2 blocks/s sink. Swimming into a wall with Space held pushes up
at 8.5 blocks/s, enough to clear a bank one block above the water. With the eye in water
the fog turns blue and closes to 1–20 blocks; water is drawn double-sided so its surface
shows from below.

7 more tests: crouching to all four edges and the corner of a floating platform (stays on,
and gets within 0.02 of the edge), sliding along an edge, falling off without crouching,
crouching speed; in a pool, sinking at no more than 2 blocks/s, a fall from 30 blocks
slowed by the water, bobbing at the surface with Space held, and climbing out onto a bank
(which fails with the boost set to 0, so the test does test it).

Checked in the pane: crouching lowered the eye from 48.6 to 48.3; walking off the spawn
into the sea sank to the eye at 40.6 with the blue underwater view; holding Space bobbed
with the eye at 42.5–42.7 (head out); backing out with Space held climbed out onto the
beach and up the terraces, and the sky came back. No console errors.

Differs from the plan: water's pull is one rate (`drag`) for every direction instead of
separate gravity and drag numbers, and the exit boost is 8.5, not 6 (6 doesn't reach a bank
one block above the water).

Goal: walk the world instead of flying over it. Gravity, an AABB that collides with the
blocks, jumping, sprinting, crouching that won't walk off edges, swimming with an
underwater view, and fly mode as a toggle. Breaking a block takes time per block type and
shows cracks; placing can't put a block inside the player. Feel is tuned by playtesting,
so every number is in `TUNING.player`.

## Scope decisions

- **Physics is pure and runs at a fixed 120 Hz step**, in `world/physics.ts` (no `three`,
  no DOM), like the world code, so it is tested headless and exactly. The camera draws
  between the last two steps (interpolated), as the racing game does, so it's smooth at
  any refresh rate and the same inputs give the same path at any frame rate.
- **Collision sweeps one axis at a time**: y, then x, then z. Each move checks every block
  the box passes through on the way, not just where it ends, so nothing tunnels even at
  terminal velocity (60 blocks/s is 0.5 blocks per step anyway). Hitting a block snaps the
  box to its face and zeroes that velocity. Solid means `!passable` (leaves and glass are
  solid; air and water aren't).
- **The box is 0.6 × 1.8 × 0.6 always**; crouching lowers the eye (1.62 → 1.32) and the
  speed, not the box. A shorter crouching box (to get under 1.5-high gaps) can come with
  slabs.
- **Crouching keeps you on the edge**: while crouching on the ground, a horizontal move
  that would leave no solid block under any part of the box is cut short, axis by axis, so
  you can still slide along an edge.
- **No step-up**: a one-block rise needs a jump. Auto-step belongs with slabs (roadmap).
- **Swimming**: in water, gravity and speeds drop and drag rises; Space swims up. Pressing
  Space against a wall at the surface gives a boost to climb out onto the bank. With the
  eye under water the fog turns blue and close, and water is drawn double-sided so its
  surface shows from below.
- **Fly mode** keeps today's controls (Space / Shift up and down, Ctrl fast) and collides
  with blocks. `?autofly` flies with collision off, so its path never depends on terrain.
- **Unloaded chunks**: the player is held in place (no gravity) until the columns around
  them are loaded and meshed, so nobody falls through an unloaded world at spawn or when
  outrunning the loader in fly mode. Spawn is on the ground at the dry-land column.
- **Breaking**: hold the left button. Each block type has a `hardness` in seconds (by hand;
  tools come later if ever): leaves 0.3, glass 0.4, sand and dirt 0.6, grass 0.7, planks
  and wood 1.5, stone 2.5. Looking away or releasing restarts it. Ten crack stages drawn on
  a box just outside the block, from a texture generated at startup (invented, no assets).
- **Placing** is refused where the block's cube would overlap the player's box.
- **Out of scope**: health, fall damage, hunger, items and drops, tools, footstep sounds
  and the hand (Milestone 5), mobs.

## Controls

| Input | Walking | Flying |
| --- | --- | --- |
| W A S D | Walk | Fly |
| Space | Jump; swim up in water | Up |
| Shift | Crouch | Down |
| Ctrl (tap) | Sprint, until you stop moving forward or tap again | Fly faster, the same way |
| F, or Space twice quickly | Start flying | Stop flying (and fall) |
| Left button (hold) | Break, takes time | Break, takes time |
| Right button | Place | Place |

## Files

| File | Contents |
| --- | --- |
| `src/world/physics.ts` | `Body` (feet position, velocity, on-ground / in-water flags), `moveBody` (swept per-axis AABB against a `isSolid` callback), `stepPlayer(body, input, world, dt)`: walking, sprinting, crouching edges, jumping, swimming, flying |
| `src/world/mining.ts` | Break progress: target, time held, `hardness`, stage 0–9, done |
| `src/world/blocks.ts` | `hardness`, `liquid` on `BLOCKS` |
| `src/input.ts` | Keys, mouse look and pointer lock (out of `player.ts`); presses that last until the next physics step takes them (jump, fly toggle, double-tap) |
| `src/player.ts` | Rewritten: input → `stepPlayer` at 120 Hz with an accumulator, interpolated camera, eye height easing when crouching, waiting for chunks, fly toggle |
| `src/render/crack.ts` | Crack stage textures (canvas, seeded), the overlay box |
| `src/render/water.ts` | Underwater fog and background on and off; double-sided water |
| `src/main.ts` | Uses `Player`; editing through `mining.ts` and the placement check; HUD shows walk / fly |
| `src/autofly.ts` | Flies with collision off through the same `Player` |
| `src/config.ts` | `TUNING.player` (below), `TUNING.water` (underwater fog) |

## Key data structures

```ts
interface Body {
  x: number; y: number; z: number;     // feet centre
  vx: number; vy: number; vz: number;
  onGround: boolean;
  inWater: boolean;                    // box overlaps water
  eyeInWater: boolean;
}

interface MoveInput {
  forward: number; strafe: number;     // -1..1, relative to yaw
  yaw: number;
  jump: boolean;                       // held (jump again on landing while held)
  crouch: boolean; sprint: boolean;
  flying: boolean; up: number;         // fly mode: -1..1
}

TUNING.player = {
  step: 1 / 120,
  walkSpeed: 4.3, sprintSpeed: 5.6, crouchSpeed: 1.3,     // blocks / s
  groundAccel: 60, airAccel: 15,                          // blocks / s², towards the wanted velocity
  gravity: 32, jumpHeight: 1.25, terminalVelocity: 60,    // jump speed = sqrt(2 g h) ≈ 8.9
  eyeHeight: 1.62, crouchEyeHeight: 1.32,
  swim: { gravity: 6, maxSink: 2, upSpeed: 3.5, speed: 2.2, drag: 4, exitBoost: 6 },
  fly: { speed: 12, sprintMultiplier: 3 },                // today's values
}
```

## Tests (headless, exact)

- **Falling and landing:** dropped from a height onto a floor, the feet end exactly on the
  block top, `onGround`, vertical speed 0; from terminal velocity onto a one-block floor,
  no tunnelling.
- **Walls:** walking into a wall stops the box exactly at the face (x = wall − 0.3);
  walking diagonally into it slides along it at full speed on the other axis; inside
  corners stop both axes; a 1-wide, 2-high gap can be walked through, a 1-high one can't.
- **Jumping:** apex 1.25 blocks above the floor (± 0.02); climbs onto a 1-block step,
  not a 2-block one; hitting a ceiling ends the rise at the ceiling.
- **Crouching:** at each of the four edges and the corners of a platform, crouch-walking
  outwards stays on it (the box still overlaps the platform) and slides along the edge;
  walking (not crouching) falls off.
- **Swimming:** sinks no faster than `maxSink`; Space rises to the surface; with Space held
  against a bank the player climbs out; out of water, normal gravity again.
- **Frame-rate independence:** the same 2 s of input driven at 30, 60 and 144 fps gives the
  same body after the same number of steps.
- **Unloaded chunks:** no movement until the columns around are loaded.
- **Breaking:** each block type breaks after its hardness; progress resets on looking away
  or releasing; stages go 0..9 evenly.
- **Placing:** refused where it would overlap the player (feet, head, and straddling two
  blocks), allowed right next to them and under them mid-jump.

## How it's measured

- Physics is cheap (a few dozen block lookups per step, at most 4 steps per frame at
  30 fps); `?stats` gains the simulation time per frame, and `?autofly` must stay as clean
  as Milestone 1 (main thread p99 under 4 ms at radius 8).
- The rest is feel, so it ends with a playtest: specific questions on speeds, jump,
  crouching, swimming and break times, with the numbers in `TUNING.player` to adjust.

## Order of work (one commit each, playable after each)

1. `physics.ts` with the collision, walking, jumping and frame-rate tests.
2. `input.ts` and the new `Player`: walk and fly modes, fixed step, interpolated camera,
   waiting for chunks, spawning on the ground.
3. Crouching at edges, swimming, the underwater view.
4. Timed breaking with the crack overlay, the placement check.
5. Notes, measurements, deploy, and the playtest questions.

## Questions for you

1. Fly mode collides with blocks (proposed), or passes through them like a spectator?
2. Breaking takes time in fly mode too (proposed, it's the same game mode for now), or is
   it instant there, creative-style?
3. Sprint on Ctrl held (as fly-faster is today), or also on double-tapping W?
