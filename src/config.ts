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
};
