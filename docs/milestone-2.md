# Milestone 2 plan: walking player

## Status: planned, waiting for your OK

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
| Ctrl (hold) | Sprint | Fly faster |
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
