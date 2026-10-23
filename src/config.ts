// Tuning values: everything you might want to tweak while playtesting.

export const TUNING = {
  world: {
    /** World seed; `?seed=123` in the URL overrides it. */
    seed: 20261022,
  },
  view: {
    /** Chunks are loaded and drawn within this many chunks of the player (horizontally). */
    radius: 7,
    /** Chunks further than radius + this are unloaded. */
    unloadMargin: 2,
    /** Milliseconds per frame the main thread may spend generating and meshing chunks. */
    meshBudgetMs: 8,
    fov: 75,
  },
  render: {
    /**
     * Brightness of a face corner by ambient occlusion level: 0 = in an inside corner (both
     * side neighbours solid) .. 3 = nothing around it. Baked into vertex colours by the mesher.
     */
    ao: [0.5, 0.68, 0.84, 1],
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
