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
  },
  player: {
    /** Physics step (seconds): fixed, so movement is the same at any frame rate. */
    step: 1 / 120,
    /** Blocks per second. */
    walkSpeed: 4.3,
    sprintSpeed: 5.6,
    /** How fast the velocity turns towards the one you're asking for (blocks / s²): on the ground, and in the air. */
    groundAccel: 60,
    airAccel: 15,
    /** Blocks / s². */
    gravity: 32,
    /** Blocks the feet rise in a jump (the jump speed follows from it and gravity). */
    jumpHeight: 1.25,
    /** Fastest fall, blocks per second. */
    terminalVelocity: 60,
    /** Eye above the feet. */
    eyeHeight: 1.62,
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
  },
  sky: {
    colour: 0x9fd0ff,
    /** Fog fades chunks out just before the load radius, hiding the edge of the world. */
    fogStartFraction: 0.55,
  },
};
