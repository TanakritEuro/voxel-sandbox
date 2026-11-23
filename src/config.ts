// Tuning values: everything you might want to tweak while playtesting.

export const TUNING = {
  world: {
    /** World seed; `?seed=123` in the URL overrides it. */
    seed: 20261022,
  },
  view: {
    /** Chunks are loaded and drawn within this many chunks of the player (horizontally). */
    radius: 8,
    /** Chunks further than radius + this are unloaded. */
    unloadMargin: 2,
    /**
     * Milliseconds per frame the main thread may spend on loading: storing generated chunks,
     * making padded copies for mesh jobs and turning finished meshes into Three.js meshes.
     */
    applyBudgetMs: 3,
    /**
     * Loading order: how much further a column straight behind the camera counts than one
     * straight ahead (1: twice as far). 0 loads in plain rings.
     */
    behindWeight: 1,
    fov: 75,
    /**
     * Lower detail for far columns (`mesh/lod.ts`), by distance in chunks from the player's
     * column: full within `near`, cells of 2³ from there, 4³ from `far`. 8 and 13 after a
     * playtest (the far skyline's trees showed at 7 and 11; 0.4 ms of GPU at view distance 16). A column changes level
     * only once it is `hysteresis` past the boundary, so moving along one doesn't remesh back
     * and forth. `?lod=0` keeps everything at full detail.
     */
    lod: { near: 8, far: 13, hysteresis: 0.5 },
  },
  workers: {
    /** At most this many chunk workers (otherwise one per core, less one for the main thread). */
    max: 8,
    /** Jobs handed to each worker at once: one running, one waiting, so it never idles between messages. */
    jobsPerWorker: 2,
  },
  render: {
    /**
     * Brightness of a face corner by ambient occlusion level: 0 = in an inside corner (both
     * side neighbours solid) .. 3 = nothing around it. Baked into vertex colours by the mesher.
     */
    ao: [0.5, 0.68, 0.84, 1],
    /**
     * Brightness of each light level is this times the one above (15 is 1), and level 0 is
     * black: caves are dark without torches.
     */
    lightFalloff: 0.8,
    /** Colour of block light (torches, lamps) at full strength; sunlight is white. */
    blockLightColour: [1, 0.86, 0.66],
  },
  player: {
    /** Physics step (seconds): fixed, so movement is the same at any frame rate. */
    step: 1 / 120,
    /** Blocks per second. */
    walkSpeed: 4.3,
    sprintSpeed: 5.6,
    crouchSpeed: 1.3,
    /** How fast the velocity turns towards the one you're asking for (blocks / s²): on the ground, and in the air. */
    groundAccel: 60,
    airAccel: 15,
    /** Blocks / s². */
    gravity: 32,
    /** Blocks the feet rise in a jump (the jump speed follows from it and gravity). */
    jumpHeight: 1.25,
    /** Fastest fall, blocks per second. */
    terminalVelocity: 60,
    /** Eye above the feet, standing and crouching. The box stays 1.8 high either way. */
    eyeHeight: 1.62,
    crouchEyeHeight: 1.32,
    /** How quickly the eye moves to its new height on crouching (per second; higher is snappier). */
    eyeEase: 14,
    /** Walking up a rise this high (blocks: a slab, a stair, a bed) needs no jump; the eye follows at `stepEase`. */
    stepUp: 0.5,
    stepEase: 18,
    swim: {
      /** Blocks / s across the water, and up while Space is held. */
      speed: 2.2,
      upSpeed: 3.5,
      /** Fastest sinking with nothing held, blocks / s. */
      maxSink: 2,
      /** Water pulls the velocity towards the wanted one at this rate (per second): higher is thicker water. */
      drag: 4,
      /** Upward speed from swimming against a wall with Space held: enough to jump out onto a bank one block above the water. */
      exitBoost: 8.5,
      /** Flowing water no deeper over the feet than this fraction of a body's height is waded through, not swum (any body, mobs too). */
      wade: 0.3,
    },
  },
  fly: {
    /** Free-fly speed (blocks per second); Ctrl multiplies it. */
    speed: 12,
    sprintMultiplier: 3,
    /** Radians per pixel of mouse movement. */
    mouseSensitivity: 0.0022,
  },
  edit: {
    /** How far away you can break or place blocks. */
    reach: 7,
    /** Seconds after breaking a block before the next one starts, while the button stays held. */
    breakPause: 0.2,
  },
  /** Logic blocks (`world/logic.ts`): a tick this often (s), at most this many woken blocks a tick, a button on this many ticks. */
  logic: {
    tickSeconds: 0.1,
    maxPerTick: 4096,
    buttonTicks: 10,
  },
  /** Survival worlds (`survival/`). */
  survival: {
    /** Most of one item a slot holds (a tool: one). */
    stack: 64,
    /** Dig speed by tier (0 the hand, then wood, stone, iron): the right tool divides a block's hardness by it. */
    toolSpeed: [1, 2, 4, 6] as const,
    /** Blocks a tool breaks before it's worn out, by tier. */
    toolWear: [0, 60, 130, 250] as const,
    /** A block that needs a better pick than the one held takes this many times its hardness, and drops nothing. */
    withoutPick: 3,
    /** One in this many leaves drops a stick, and one in this many berries. */
    leafStick: 8,
    leafBerries: 20,
    /** Hunger points each food gives back. */
    food: { rawMeat: 3, cookedMeat: 8, berries: 2, bread: 5 },
    /** Raw meat an animal leaves when it goes in a puff: from and to. */
    meat: [1, 2] as [number, number],
    /** Moss a mossback leaves as well: from and to. */
    moss: [1, 2] as [number, number],
    /** Farming: one in this many grass blocks dug gives seeds; wheat grows a stage every `stageSeconds` (give or
     *  take a fifth) in light of at least `light`, stepped every `tickSeconds`; ripe, it gives 1 wheat and
     *  1 to `ripeSeeds` seeds. */
    farming: { seedsFromGrass: 8, stageSeconds: 70, light: 9, tickSeconds: 1, ripeSeeds: 3 },
    /** Health (points; the HUD shows a pip for two). */
    maxHealth: 20,
    /** A fall up to this many blocks costs nothing; a point a block beyond. */
    safeFall: 3,
    /** Seconds of air under water, how fast it comes back above (seconds a second), then a point every `drownEvery` s. */
    air: 10,
    airBack: 5,
    drownEvery: 1,
    /** A point every this many seconds touching a cactus. */
    cactusEvery: 0.5,
    /** Healing: from this long after the last hurt (s), a point every `healEvery` s. */
    healDelay: 5,
    healEvery: 4,
    /**
     * Hunger (points, a pip for two): lost a point a minute standing, and a point a minute more for
     * every `hungerSprint` etc. (points a minute) on top. Healing waits for `healHunger` or more and
     * costs `healCost` a point healed; starving costs a point of health every `starveEvery` s, down to 1.
     */
    maxHunger: 20,
    hungerBase: 1,
    hungerSprint: 3,
    hungerSwim: 2,
    hungerDig: 1.5,
    healHunger: 15,
    healCost: 0.5,
    starveEvery: 4,
    /** Holding the button this long eats (s). */
    eatSeconds: 1.5,
    /** Seconds a furnace takes to smelt one item (`survival/furnace.ts`); fuel is counted in these. */
    smeltSeconds: 5,
    /** Items on the ground (`survival/ground.ts`). */
    ground: {
      /** Physics step (s); an item at rest sleeps, looking at the block under it this often (s). */
      step: 1 / 60,
      sleepCheck: 0.25,
      /** Picked up this close to a player's middle (blocks); gone after this long (s); at most this many. */
      pickup: 1.5,
      life: 300,
      cap: 256,
      /** The same items closer than this merge (blocks), looked for this often (s). */
      merge: 0.75,
      mergeEvery: 0.25,
      /** Thrown: this fast forward and up (blocks / s); not to be picked up again for this long (s). */
      throwSpeed: 6,
      throwUp: 2.5,
      throwDelay: 1,
      /** Broken out of a block: a hop up, and this much sideways at most (blocks / s). */
      hop: 3,
      scatter: 1.2,
      /** Slowing: on the ground, in the air, in water (a fraction a second, as 1 - e^-kt). */
      friction: 10,
      drag: 0.6,
      waterDrag: 4,
    },
  },
  /** Playing together (`net/`). */
  net: {
    /** Each player's state is sent this often (a second). */
    stateRate: 20,
    /** A guest's survival state goes to the host at most this often (s), when it has changed. */
    keptEvery: 2,
    /** Others are drawn this far behind their newest state (s), so there's usually one either side to draw between. */
    behind: 0.1,
    /** Past their newest state they're guessed on for at most this long (s), then held. */
    extrapolate: 0.25,
    /** A state this far (blocks) from where a player was drawn is a jump (a teleport): shown at once. */
    snap: 8,
    /** The host keeps the land this many chunks round each guest loaded (generated, not drawn): for their edits, mobs and water. */
    landRadius: 3,
    /** A guest's edit may be this much further than the reach (blocks), for the delay between where it was and where the host last heard. */
    reachSlack: 1.5,
    /** The host sends guests their mobs this often (a second); a guest draws them this far behind (s). */
    mobRate: 10,
    mobBehind: 0.15,
    /** The host's time of day is sent this often (s). */
    timeEvery: 2,
  },
  particles: {
    /** Cubes in a break's burst, and chips each digging hit. */
    breakCount: 20,
    digCount: 3,
    /** Size (blocks) of a burst's cubes and of chips. */
    size: 0.12,
    digSize: 0.08,
    /** Outward and upward speed (blocks / s), gravity, how much of the speed a bounce keeps, how much sliding keeps per bounce. */
    speed: 5,
    lift: 3.5,
    gravity: 18,
    bounce: 0.3,
    friction: 0.6,
    /** Seconds they live, from and to. */
    life: [0.6, 1.1],
    /** The puff a mob goes in: how many, how big. */
    puffCount: 24,
    puffSize: 0.2,
  },
  sound: {
    /** A footstep every this many blocks walked on the ground. */
    stride: 1.6,
    /** A digging hit this often (s) while breaking a block. */
    digInterval: 0.25,
    /** Landing: silent up to this fall speed (blocks / s; a jump lands at about 9), full this much faster. */
    landSpeed: 10,
    landFullSpeed: 20,
    /** Splashing in: from this speed, full at that one. */
    splashSpeed: 3,
    splashFullSpeed: 15,
    /** Levels before the master volume. */
    step: 0.35,
    dig: 0.5,
  },
  weather: {
    /** A spell: seconds dry, then seconds of weather (`world/weather.ts`). */
    dry: { min: 360, max: 840 },
    spell: { min: 120, max: 360 },
    /** What the weather is: rain, a storm, else only cloud. */
    shares: { rain: 0.6, storm: 0.25 },
    /** Seconds it takes to come on, and to clear. */
    ease: 20,
    /** Seconds of falling for snow to settle whole, and of none for it to melt. */
    settle: 120,
    melt: 300,
    /** Seconds of falling to wet the ground through, and of none to dry it. */
    soak: 20,
    dryOut: 60,
    /**
     * Each kind fully come on (`render/weatherLook.ts`): share of the sky under cloud, sunlight
     * as a share of a clear noon's, how grey colours go, where the fog starts as a fraction
     * of the view distance, and how hard it falls (0–1 of `precipitation.drops`).
     */
    look: {
      overcast: { cover: 0.8, light: 0.88, grey: 0.6, fogStart: 0.5, fall: 0 },
      rain: { cover: 0.9, light: 0.75, grey: 0.75, fogStart: 0.35, fall: 0.6 },
      storm: { cover: 0.95, light: 0.55, grey: 0.85, fogStart: 0.25, fall: 1 },
    },
    /** The share of that dimming left at night, when there's little light to lose. */
    nightDim: 0.3,
    /** How much darker clouds are than the light under them. */
    thickCloud: 0.15,
    /** Blocks over the cloud layer in which the weather's extra cloud thins to a clear day's, so a summit's valley shows. */
    overClouds: 8,
    /**
     * What falls where (`world/cover.ts`), by the biomes' weights: snow from this much snowy
     * mountain, nothing from this much desert and savanna together, else rain; the edges
     * dithered over `dither` of weight.
     */
    snowAt: 0.5,
    dryAt: 0.6,
    dither: 0.02,
    /** A wet top's brightness as a share of a dry one's (linear light). */
    wetShade: 0.6,
    /** Rain falling this hard puts out burning, as water does. */
    douses: 0.15,
    /**
     * Lightning (`world/lightning.ts`, `render/lightning.ts`) once a storm has come on this far:
     * a bolt every so often, so far from a player, harmless; thunder after it by the distance.
     */
    lightning: {
      from: 0.5,
      every: { min: 8, max: 25 },
      away: { min: 40, max: 240 },
      /** Blocks: a bolt's least height, how far it wanders a piece, its width (and by the distance). */
      shortest: 48,
      wander: 5,
      width: 0.4,
      widthFar: 0.006,
      /** Seconds it shows. */
      shown: 0.45,
      /** One soft brightening: up and down once, no more than one in `gap` seconds. */
      flash: { peak: 0.4, rise: 0.12, fall: 0.6, gap: 3 },
      delay: { min: 0.3, max: 2 },
    },
    /**
     * Rain's sound (`audio/weather.ts`): open places heard within `reach` blocks (and `sill` over
     * the ear), a roof drumming up to `roof` blocks overhead; levels beside, under and in water,
     * and snow's.
     */
    hearing: { reach: 6, sill: 1, roof: 16, nearOpen: 0.85, underRoof: 0.6, underWater: 0.15, snow: 0.06, level: 0.23 },
    /** Settled snow: none where block light is at least `melts`, footsteps in it from this much settled. */
    melts: 11,
    snowSteps: 0.5,
    /**
     * What falls (`render/precipitation.ts`), in a box this many blocks across round the eye:
     * speeds and winds whole blocks a second (so it all repeats every `box` seconds), none
     * above the `ceiling`.
     */
    precipitation: {
      box: 48,
      ceiling: 240,
      drops: 3000,
      splashes: 300,
      rain: { speed: [18, 24], wind: [2, 1], length: 1.2, width: 0.025, opacity: 0.6 },
      /** Every other drop is a flake. */
      snow: { speed: [2, 3], wind: [1, 0], size: 0.12, sway: 0.4 },
      /** A splash's width, and how many lives it has in those `box` seconds. */
      splash: { width: 0.35, cycles: 150 },
    },
  },
  /**
   * Fog by biome (`render/fog.ts`): a tint, how much of it shows by day, and where the fog
   * starts as a fraction of the view distance. Blended by the biomes where the player is.
   */
  fog: {
    plains: { tint: 0x9fd0ff, amount: 0, start: 0.55 },
    forest: { tint: 0x9cc8a4, amount: 0.3, start: 0.5 },
    desert: { tint: 0xe8d3a2, amount: 0.6, start: 0.35 },
    mountains: { tint: 0xe2ebf3, amount: 0.45, start: 0.65 },
    /** A dry golden haze; a damp green murk, close in. */
    savanna: { tint: 0xe6d49a, amount: 0.35, start: 0.5 },
    swamp: { tint: 0x8fa88a, amount: 0.55, start: 0.35 },
    /** Seconds to ease most of the way to a new biome's fog. */
    ease: 3,
  },
  water: {
    /** With the eye under water: fog colour and range (blocks). */
    fogColour: 0x1f4f80,
    fogNear: 1,
    fogFar: 20,
    /** The surface texture drifts this fast (blocks a second), in two directions at once. */
    flow: 0.12,
    /** Flowing water (`world/water.ts`): a tick this often (seconds), at most this many blocks looked at a tick. */
    tickSeconds: 0.25,
    maxPerTick: 1024,
    /** Water on flat ground runs towards the nearest drop within this many blocks (at most 8). */
    dropSearch: 4,
    /** Flowing water carries the player and mobs down its slope at this speed (blocks / s), added to their own. */
    push: 1.4,
  },
  lava: {
    /** Flowing lava (`world/liquids.ts`): ticked half as often as water, spreading 3 and looking 2 for a drop. */
    tickSeconds: 0.5,
    maxPerTick: 1024,
    dropSearch: 2,
    /** With the eye in lava: fog colour and range (blocks). */
    fogColour: 0xd8501a,
    /** The texture creeps this fast (blocks a second). */
    flow: 0.04,
    fogNear: 0,
    fogFar: 3,
    /** Swimming in lava: water's speeds times this. */
    swimSpeed: 0.5,
    /** Burning (survival): `damage` points every `every` seconds in lava; out of it, for `after` seconds more, `afterDamage` each `every`, put out by water. */
    damage: 4,
    every: 0.5,
    after: 3,
    afterDamage: 1,
    /** A mob in lava takes a hit this often (seconds). */
    mobEvery: 0.5,
  },
  save: {
    /** Edited chunks are written this long after an edit (ms); at once when unloaded or when the page is hidden. */
    delayMs: 2000,
    /** Where the player is and the time of day are written this often (ms). */
    recordIntervalMs: 10000,
  },
  day: {
    /** Seconds from one midnight to the next (`?daylength=60` overrides it). */
    length: 1200,
    /** Time of day a world starts at: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset (`?time=0.5` fixes it). */
    start: 0.3,
    /** Sunlight at night, as a fraction of the day's (moonlight); block light stays as it is. */
    night: 0.2,
  },
  /** Beds: sleeping when the daylight is under `night`, not with a hostile mob within `near` blocks; the screen dims
   *  for `dim` seconds, then it is `morning` (time of day). Waking with no room round the bed is on it, `onBed` up. */
  sleep: { night: 0.3, near: 8, dim: 2, morning: 0.27, onBed: 0.5 },
  sky: {
    /** The sky and the fog by day, at sunrise and sunset, and at night. */
    colour: 0x9fd0ff,
    twilight: 0xe9a274,
    night: 0x0b1228,
    /** Overhead, by day, at sunrise and sunset, and at night. */
    zenith: 0x4f8fd8,
    zenithTwilight: 0x55639e,
    zenithNight: 0x03050d,
    /** The glow round the sun at dawn and dusk. */
    glow: 0xff9a5a,
    /** How far the sun's path leans from straight overhead (radians). */
    sunTilt: 0.35,
    /** Clouds: height of the layer, size of a cell (blocks), share of the sky covered, drift (blocks a second along +x). */
    cloudHeight: 192,
    cloudCell: 12,
    cloudCover: 0.4,
    cloudWind: 1.5,
    /** Fog fades chunks out just before the load radius, hiding the edge of the world. */
    fogStartFraction: 0.55,
  },
  mobs: {
    /** Physics and thinking step (seconds), as the player's. */
    step: 1 / 120,
    /** Most mobs around the player (`?mobs=40`; `?mobs=0` none). */
    max: 24,
    /** Most kept animals a world has (fed ones beyond it stay wild). */
    kept: 128,
    /** Kept animals breeding (`mobs.ts`, `brain.ts`). */
    breeding: {
      /** Seconds a kept, grown animal fed while it may breed is in love. */
      love: 30,
      /** Two of a kind in love this near (blocks) court each other... */
      near: 8,
      /** ...and make a young one when their boxes are this close (blocks apart). */
      meet: 0.4,
      /** Seconds a parent waits before it may breed again. */
      wait: 300,
      /** Seconds a young one takes to grow up (from half size), and the part of that one feeding takes off. */
      grow: 600,
      feedGrow: 0.1,
      /** How much faster a young one walks and runs. */
      youngSpeed: 1.3,
      /** A young one goes back to its parent when further than this (blocks); it looks for one this far. */
      follow: 4,
      lead: 16,
    },
    /** How fast a mob's velocity turns towards the one it wants (blocks / s²), on the ground and in the air. */
    groundAccel: 30,
    airAccel: 8,
    /** In water: rising to the surface (blocks / s) and how thick the water is (per second). */
    floatSpeed: 1.6,
    waterDrag: 4,
    /** Turning to face where it goes (radians a second). */
    turnSpeed: 6,
    /** Idle (grazing, looking about) between wanders, seconds. */
    idle: [2, 7] as [number, number],
    /** A wander goes this many blocks away, a random direction. */
    wander: [4, 12] as [number, number],
    /** Fleeing: how long, and how far away it looks for a place to run to. */
    fleeSeconds: 4,
    fleeDistance: 10,
    /** No closer to the waypoint for this long (seconds): stuck, find a way again. */
    stuckSeconds: 0.6,
    /** At a waypoint when this close across (blocks). */
    arrive: 0.25,
    /** Daylight below this sends mobs to rest, above `wake` wakes them. */
    rest: 0.3,
    wake: 0.4,
    /** A try at spawning a group this often (seconds), this far from the player (blocks, across). */
    spawnInterval: 0.25,
    /** A try at a hostile mob this often (seconds): they gather slowly. */
    hostileInterval: 2,
    /** Delvers come twice as often within this many blocks of a dungeon's middle. */
    dungeonReach: 32,
    /** A hunter that found no way to its prey asks again after this (seconds), going straight meanwhile. */
    huntRetry: 4,
    spawnDistance: [24, 64] as [number, number],
    /** Gone beyond this (blocks, across) or when its column unloads. */
    despawnDistance: 96,
    /** Path searches stop for the frame once mobs have used this much of it (ms); the rest wait. */
    pathBudgetMs: 1,
    /** Points a hit does: by hand, and with each kind of tool (survival). An animal takes 3, a gloamer 8 (`mobs/kinds.ts`). */
    toolDamage: { hand: 1, pick: 2, spade: 2, axe: 3 },
    /** A hit's push away and up (blocks / s). */
    knockback: 6,
    knockUp: 5,
    /** A mob calls every so often (seconds, from and to), heard this far away (blocks). */
    calls: [8, 24] as [number, number],
    hearing: 24,
  },
  /** The hearthfolk (Milestone 22, `mobs/folk.ts`). */
  folk: {
    /** Daylight below this sends them home to bed; above `wake` they get up. Earlier than the animals: home by dusk. */
    home: 0.38,
    wake: 0.45,
    /** By day they wander to places this far from the well at most (blocks, across); further than `reach` they come back. */
    roam: 22,
    reach: 32,
    /** Idle between wanders (seconds). */
    idle: [3, 9] as [number, number],
    /** A trader goes back to stand by its counter this often of the times it picks somewhere to go. */
    counter: 0.75,
    /** A player this close (blocks, across) is turned to, for up to `greetSeconds`; a greeting at most every `greetAgain`. */
    greet: 3.5,
    greetSeconds: 6,
    greetAgain: 20,
    /** A hostile mob this close (blocks) sends them running. */
    scatter: 10,
    /** Going home: within this of the place by its bed (blocks), into bed; with no way after `homeTries` tries, or after `homeSeconds`, put there. */
    arrive: 1.2,
    homeTries: 3,
    homeSeconds: 90,
    /** A hit's push (blocks / s), much less than an animal's: a step back. */
    knockback: 2.5,
  },
  /** Vehicles (Milestone 18, `src/vehicles/`). */
  vehicles: {
    /** Stepped at this fixed rate (seconds). */
    step: 1 / 60,
    /** Most vehicles a world has. */
    most: 256,
    /** Hits that break one (survival; in creative one does it), forgotten after this long (seconds). */
    hits: 3,
    hitMemory: 2,
    /** A rider's feet above the vehicle's, and their eye above their feet, sitting. */
    seat: 0.35,
    sitEye: 1.2,
    /** Carts (`vehicles/cart.ts`), in blocks and seconds: their box; top speed; gravity along a slope; rolling drag (a part of the speed a second, and a constant); a powered rail's push and an off one's brake; a rider's push from a near standstill, up to this speed. */
    cart: {
      halfWidth: 0.45,
      height: 0.7,
      max: 8,
      gravity: 14,
      drag: 0.07,
      roll: 0.05,
      boost: 12,
      brake: 20,
      push: 3,
      pushUpTo: 1.5,
    },
    /**
     * Boats (`vehicles/boat.ts`), in blocks and seconds: their box (square: boxes don't turn); how deep
     * the bottom sits in the water; the rower's seat above the bottom; speed rowed on water and on land;
     * turning (radians a second); how fast the speed eases to what's rowed, on water and on land; the
     * spring to the surface and its damping.
     */
    boat: {
      halfWidth: 0.7,
      height: 0.6,
      draft: 0.06,
      seat: 0.2,
      speed: 4.5,
      landSpeed: 0.6,
      turn: 2.2,
      waterDrag: 2.5,
      landDrag: 6,
      spring: 40,
      damping: 10,
    },
  },
};
