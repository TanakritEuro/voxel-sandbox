// `?backdrop`: the game as the title screen's backdrop (Milestone 20), in a frame behind the world list
// (`ui/backdropFrame.ts`). No HUD, input, sound or saving; the camera drifts slowly over the land, a
// little above the ground ahead and turning gently, and says when the view is in so the frame fades in.

import type { ChunkLoader } from './chunkLoader';
import { TUNING } from './config';
import type { Player } from './player';
import { SEA_LEVEL } from './world/coords';

/** Blocks a second, as a share of the autopilot's sprinting flight speed. */
const SPEED = 3.2;
/** The eye this far over the highest ground just ahead, eased towards it. */
const CLEARANCE = 26;
/** Looking a little down at the land. */
const PITCH = -0.24;
/** Turning: a slow wander either side of a heading, radians and radians a second. */
const HEADING = -Math.PI / 4;
const SWAY = 0.7;
const SWAY_RATE = 0.045;
/** At most this many frames a second: it's only scenery. */
export const BACKDROP_FPS = 30;

export class Backdrop {
  private t = 0;
  private ready = false;

  constructor(
    private readonly player: Player,
    private readonly loader: ChunkLoader,
    /** The ground's height at (x, z) by the generator (no chunks needed). */
    private readonly height: (x: number, z: number) => number,
    private readonly onReady: () => void,
  ) {
    player.flying = true;
    player.input.pitch = PITCH;
    player.input.yaw = HEADING;
    player.body.y = this.altitude() - TUNING.player.eyeHeight;
  }

  /** Once a frame: drift on, and say once when the view first is in. */
  update(dt: number): void {
    this.t += dt;
    const p = this.player;
    p.input.yaw = HEADING + Math.sin(this.t * SWAY_RATE * Math.PI * 2) * SWAY;
    p.input.pitch = PITCH;
    // Hold still until the view is in, then drift.
    p.autopilot(dt, this.ready ? SPEED / (TUNING.fly.speed * TUNING.fly.sprintMultiplier) : 0);
    const want = this.altitude() - TUNING.player.eyeHeight;
    p.body.y += (want - p.body.y) * Math.min(1, dt * 0.6);
    if (!this.ready && this.loader.pending === 0 && this.loader.missing(TUNING.view.radius) === 0) {
      this.ready = true;
      this.onReady();
    }
  }

  /** The eye's height for here: clear of the highest ground a little ahead, never below the sea's. */
  private altitude(): number {
    const b = this.player.body;
    const sin = Math.sin(this.player.input.yaw);
    const cos = Math.cos(this.player.input.yaw);
    let top = SEA_LEVEL;
    for (const d of [0, 12, 24, 36]) top = Math.max(top, this.height(b.x - sin * d, b.z - cos * d));
    return top + CLEARANCE;
  }
}
