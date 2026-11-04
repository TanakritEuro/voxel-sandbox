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
    /** One in this many leaves drops a stick. */
    leafStick: 8,
  },
  /** Playing together (`net/`). */
  net: {
    /** Each player's state is sent this often (a second). */
    stateRate: 20,
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
  /**
   * Fog by biome (`render/fog.ts`): a tint, how much of it shows by day, and where the fog
   * starts as a fraction of the view distance. Blended by the biomes where the player is.
   */
  fog: {
    plains: { tint: 0x9fd0ff, amount: 0, start: 0.55 },
    forest: { tint: 0x9cc8a4, amount: 0.3, start: 0.5 },
    desert: { tint: 0xe8d3a2, amount: 0.6, start: 0.35 },
    mountains: { tint: 0xe2ebf3, amount: 0.45, start: 0.65 },
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
    spawnDistance: [24, 64] as [number, number],
    /** Gone beyond this (blocks, across) or when its column unloads. */
    despawnDistance: 96,
    /** Path searches stop for the frame once mobs have used this much of it (ms); the rest wait. */
    pathBudgetMs: 1,
    /** Hits that make a mob go (in a puff), and a hit's push away and up (blocks / s). */
    hits: 3,
    knockback: 6,
    knockUp: 5,
    /** A mob calls every so often (seconds, from and to), heard this far away (blocks). */
    calls: [8, 24] as [number, number],
    hearing: 24,
  },
};
