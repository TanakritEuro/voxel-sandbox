// `?bot` (`?bot=3` for three): a test guest in the same page, joined over the test network
// (`loopback.ts`), to see other players and their edits without a second browser, and to measure
// a host with guests. It walks a circle round where the host started (each bot its own size), on
// the ground (read from the host's world: it has no world of its own), swinging its arm as it
// builds a plank block beside its path every few seconds and breaks the last one again. Only for
// looking and measuring.

import { TUNING } from '../config';
import { Block, BLOCKS } from '../world/blocks';
import type { World } from '../world/world';
import type { LoopRoom } from './loopback';
import { GuestSession } from './session';

/** How long a step of building takes (s). */
const BUILD_EVERY = 3;

export class Bot {
  readonly session: GuestSession;
  private readonly started: number;
  private lastState = Number.NEGATIVE_INFINITY;
  private lastBuild: number;
  private built: [number, number, number] | null = null;
  private swings = 0;

  constructor(
    room: LoopRoom,
    private readonly world: World,
    private readonly centre: [number, number],
    private readonly now: () => number,
    name = 'Bot',
    /** The circle's radius (blocks). */
    private readonly radius = 6,
  ) {
    this.session = new GuestSession(room.join().guest, name, now);
    this.session.attach({ apply: () => {}, hasColumn: () => false });
    this.started = now();
    this.lastBuild = this.started;
  }

  /** Once a frame. */
  update(): void {
    const t = this.now();
    this.session.update();
    const speed = TUNING.player.walkSpeed * 0.6;
    const angle = ((t - this.started) * speed) / this.radius;
    const x = this.centre[0] + Math.cos(angle) * this.radius;
    const z = this.centre[1] + Math.sin(angle) * this.radius;
    const y = this.ground(Math.floor(x), Math.floor(z));
    // Facing along the circle: moving (-sin, cos), and yaw 0 faces -z.
    const yaw = Math.atan2(Math.sin(angle), -Math.cos(angle));
    if (t - this.lastBuild > BUILD_EVERY) {
      this.lastBuild = t;
      this.swings++;
      if (this.built) {
        this.session.edit(...this.built, Block.Air);
        this.built = null;
      } else {
        // On the ground just outside the circle.
        const bx = Math.floor(this.centre[0] + Math.cos(angle) * (this.radius + 2));
        const bz = Math.floor(this.centre[1] + Math.sin(angle) * (this.radius + 2));
        this.built = [bx, this.ground(bx, bz), bz];
        this.session.edit(...this.built, Block.Planks);
      }
    }
    if (t - this.lastState < 1 / TUNING.net.stateRate) return;
    this.lastState = t;
    this.session.sendState({ x, y, z, yaw, pitch: -0.2, flying: false, crouching: false, swimming: false, onGround: true, held: Block.Planks, swings: this.swings, digging: 0 });
  }

  /** The first place to stand at (x, z), from a little above the host's position down. */
  private ground(x: number, z: number): number {
    let y = 120;
    while (y > 1 && BLOCKS[this.world.getBlock(x, y - 1, z)].passable) y--;
    return y;
  }
}
