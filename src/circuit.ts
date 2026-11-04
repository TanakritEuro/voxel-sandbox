// `?circuit`: logic blocks to look at and measure (Milestone 10). Once the player's land has
// loaded, a stone board 104 × 40 is laid 8 blocks above the player's feet, the air over it
// cleared, and the player put on its near end looking along it (+x). On it:
// - a clock: an inverter feeding itself through a delay of 4, a blink every 10 ticks;
// - a chaser: 50 delays of 1 passing the clock's pulse along +x, a lamp beside the wire after each;
// - a 32 × 32 grid of wire fed by a switch that `update` flips every second (the worst case: a
//   network of 1,024 wires worked out at once), a lamp at each corner.
// For 20 s from the building (whose own frames aren't counted) it counts frames and logic ticks,
// then reports to the console and the `?stats` overlay, as `?flood` does.

import { LONG_FRAME_MS } from './stats';
import { Block, delay, inverter } from './world/blocks';

type Change = [number, number, number, Block];

export interface CircuitReport {
  frames: number;
  over20: number;
  maxFrame: number;
  ticks: number;
  changes: number;
  /** The slowest tick: working it out, and making its changes (light included). */
  maxSim: number;
  maxApply: number;
  /** Building the board (ms). */
  buildMs: number;
}

const LONG = 104;
const WIDE = 40;

export class Circuit {
  private phase: 'waiting' | 'running' | 'done' = 'waiting';
  private since = 0;
  private flipped = 0;
  private on = false;
  /** The board's corner (its floor's lowest x and z) and the height of what stands on it. */
  private x0 = 0;
  private y = 0;
  private z0 = 0;
  private report: CircuitReport | null = null;
  /** Frames left not to count after the building. */
  private skip = 0;

  constructor(
    /** Make these changes as the game does (blocks, light, remeshing, saving), waking the logic round them. */
    private readonly apply: (changes: Change[]) => void,
    /** Stand the player here, looking along +x. */
    private readonly stand: (x: number, y: number, z: number) => void,
    private readonly onReport: (report: CircuitReport, text: string) => void,
  ) {}

  /** Once a frame, with the time, the frame's interval and where the player is (waiting while the ground loads). */
  update(now: number, interval: number, px: number, py: number, pz: number, waiting: boolean): void {
    if (this.phase === 'waiting') {
      if (waiting) return;
      const t0 = performance.now();
      this.build(Math.floor(px), Math.floor(py) + 8, Math.floor(pz));
      this.report = { frames: 0, over20: 0, maxFrame: 0, ticks: 0, changes: 0, maxSim: 0, maxApply: 0, buildMs: performance.now() - t0 };
      this.phase = 'running';
      this.since = this.flipped = now;
      this.skip = 2;
      return;
    }
    if (this.phase !== 'running') {
      if (now - this.flipped > 1000) this.flip(now);
      return;
    }
    // The frames that carried the building.
    if (this.skip > 0) {
      this.skip--;
      return;
    }
    const r = this.report!;
    r.frames++;
    if (interval > LONG_FRAME_MS) r.over20++;
    r.maxFrame = Math.max(r.maxFrame, interval);
    if (now - this.flipped > 1000) this.flip(now);
    if (now - this.since > 20000) {
      this.phase = 'done';
      const text =
        `circuit: 20 s, ${r.frames} frames, ${r.over20} over 20 ms, slowest ${r.maxFrame.toFixed(1)} ms; ` +
        `${r.ticks} logic ticks, ${r.changes} changes, slowest tick ${r.maxSim.toFixed(2)} ms working out, ${r.maxApply.toFixed(2)} ms making changes; ` +
        `building ${r.buildMs.toFixed(1)} ms`;
      this.onReport(r, text);
    }
  }

  /** A logic tick that changed something happened (while running, it counts). */
  tick(changes: number, simMs: number, applyMs: number): void {
    const r = this.report;
    if (this.phase !== 'running' || !r) return;
    r.ticks++;
    r.changes += changes;
    r.maxSim = Math.max(r.maxSim, simMs);
    r.maxApply = Math.max(r.maxApply, applyMs);
  }

  /** The grid's switch, flipped. */
  private flip(now: number): void {
    this.flipped = now;
    this.on = !this.on;
    this.apply([[this.x0 + 40, this.y, this.z0 + 6, this.on ? Block.SwitchOn : Block.Switch]]);
  }

  private build(px: number, floor: number, pz: number): void {
    const x0 = (this.x0 = px + 2);
    const z0 = (this.z0 = pz - 2);
    const y = (this.y = floor + 1);
    const changes: Change[] = [];
    for (let dz = 0; dz < WIDE; dz++) {
      for (let dx = 0; dx < LONG; dx++) {
        changes.push([x0 + dx, floor, z0 + dz, Block.Stone]);
        for (let dy = 1; dy <= 4; dy++) changes.push([x0 + dx, floor + dy, z0 + dz, Block.Air]);
      }
    }
    const put = (dx: number, dz: number, b: Block) => changes.push([x0 + dx, y, z0 + dz, b]);
    // The clock, round (2, 2): an inverter facing +x feeds the wire (3, 2), (3, 1), (2, 1); a delay
    // of 4 at (1, 1) facing -x reads that and feeds (0, 1), (0, 2), (1, 2), behind the inverter.
    put(2, 2, inverter(0, false));
    for (const [dx, dz] of [[3, 2], [3, 1], [2, 1], [0, 1], [0, 2], [1, 2]]) put(dx, dz, Block.Wire);
    put(1, 1, delay(1, 4, false));
    // The chaser, from the clock's wire along +x, its lamps on the side away from the clock.
    for (let i = 0; i < 50; i++) {
      put(4 + i * 2, 2, delay(0, 1, false));
      put(5 + i * 2, 2, Block.Wire);
      put(5 + i * 2, 3, Block.SignalLamp);
    }
    // The grid, its switch at its near corner, a lamp off each corner.
    put(40, 6, Block.Switch);
    for (let dz = 0; dz < 32; dz++) for (let dx = 0; dx < 32; dx++) put(41 + dx, 6 + dz, Block.Wire);
    for (const [dx, dz] of [[41, 5], [72, 5], [40, 37], [73, 37]]) put(dx, dz, Block.SignalLamp);
    this.apply(changes);
    this.stand(x0 + 0.5, y, z0 + 8.5);
    console.log(`[circuit] built at ${x0}, ${y}, ${z0}: a clock, a 50-stage chaser, a 32 × 32 grid`);
  }
}
