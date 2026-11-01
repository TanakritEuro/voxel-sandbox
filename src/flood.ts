// `?flood`: the worst case for flowing water, to measure it (Milestone 8). Once the player's land
// has loaded: a room 32 × 32 and 6 high is carved under the nearest open sea, and two seconds
// later the 2 blocks of ceiling between it and the sea are taken away at once, so a thousand
// columns pour in together. For the next 10 s it counts frames and the water's ticks, then
// reports to the console and the `?stats` overlay. Taking the ceiling away (thousands of blocks
// in one frame, which no player can do) is timed on its own, and its frame isn't counted.
// `?flood=guest` waits until the world is open to friends and someone has joined.

import { LONG_FRAME_MS } from './stats';
import { Block } from './world/blocks';
import type { WaterFlow } from './world/water';
import type { World } from './world/world';

type Change = [number, number, number, Block];

export interface FloodReport {
  at: [number, number];
  frames: number;
  over20: number;
  over33: number;
  maxFrame: number;
  ticks: number;
  changes: number;
  /** The slowest tick: the water's simulation, and making its changes (light included). */
  maxSim: number;
  maxApply: number;
  /** Taking the ceiling away (ms). */
  openMs: number;
}

export class Flood {
  private phase: 'waiting' | 'carved' | 'flooding' | 'done' = 'waiting';
  private since = 0;
  private at: [number, number] = [0, 0];
  private roof = 0;
  private report: FloodReport | null = null;
  /** Frames left not to count after the opening. */
  private skip = 0;

  constructor(
    private readonly world: World,
    private readonly flow: WaterFlow,
    /** Make these changes as the game does (blocks, light, remeshing, saving). */
    private readonly apply: (changes: Change[]) => void,
    private readonly onReport: (report: FloodReport, text: string) => void,
  ) {}

  /** Once a frame, with the time, the frame's interval and where the player is (waiting while the ground loads). */
  update(now: number, interval: number, px: number, pz: number, waiting: boolean): void {
    if (this.phase === 'waiting') {
      if (waiting) return;
      const found = this.findSea(Math.floor(px), Math.floor(pz));
      if (!found) {
        console.log('[flood] no open sea 32 × 32 near the player');
        this.phase = 'done';
        return;
      }
      this.at = found;
      this.carve();
      this.phase = 'carved';
      this.since = now;
    } else if (this.phase === 'carved' && now - this.since > 2000) {
      const t0 = performance.now();
      this.open();
      this.phase = 'flooding';
      this.since = now;
      this.skip = 2;
      this.report = { at: this.at, frames: 0, over20: 0, over33: 0, maxFrame: 0, ticks: 0, changes: 0, maxSim: 0, maxApply: 0, openMs: performance.now() - t0 };
    } else if (this.phase === 'flooding' && this.report) {
      const r = this.report;
      // The frames that carried the opening.
      if (this.skip > 0) {
        this.skip--;
        return;
      }
      r.frames++;
      if (interval > LONG_FRAME_MS) r.over20++;
      if (interval > 33.4) r.over33++;
      r.maxFrame = Math.max(r.maxFrame, interval);
      if (now - this.since > 10000) {
        this.phase = 'done';
        const text =
          `flood at ${r.at[0]}, ${r.at[1]}: 10 s, ${r.frames} frames, ${r.over20} over 20 ms, ${r.over33} over 33, slowest ${r.maxFrame.toFixed(1)} ms; ` +
          `${r.ticks} water ticks, ${r.changes} changes, slowest tick ${r.maxSim.toFixed(2)} ms simulating, ${r.maxApply.toFixed(2)} ms making changes; ` +
          `the opening itself ${r.openMs.toFixed(1)} ms`;
        this.onReport(r, text);
      }
    }
  }

  /** A water tick happened (while flooding, it counts). */
  tick(changes: number, simMs: number, applyMs: number): void {
    const r = this.report;
    if (this.phase !== 'flooding' || !r) return;
    r.ticks++;
    r.changes += changes;
    r.maxSim = Math.max(r.maxSim, simMs);
    r.maxApply = Math.max(r.maxApply, applyMs);
  }

  private bed(x: number, z: number): number {
    let y = 62;
    while (y > 0 && this.world.getBlock(x, y, z) === Block.Water) y--;
    return y;
  }

  /** The corner of the nearest 32 × 32 of open sea (water at sea level, open sky, seabed below 30) within 64 blocks. */
  private findSea(px: number, pz: number): [number, number] | null {
    const w = this.world;
    for (let r = 0; r <= 64; r += 2) {
      for (let dz = -r; dz <= r; dz += 2) {
        for (let dx = -r; dx <= r; dx += 2) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = px + dx;
          const z = pz + dz;
          let open = true;
          for (let sz = 0; sz < 32 && open; sz += 4)
            for (let sx = 0; sx < 32 && open; sx += 4) open = w.getBlock(x + sx, 62, z + sz) === Block.Water && w.getBlock(x + sx, 63, z + sz) === Block.Air;
          if (open && this.bed(x, z) > 30) return [x, z];
        }
      }
    }
    return null;
  }

  private carve(): void {
    const [x0, z0] = this.at;
    let floor = 62;
    for (let dz = 0; dz < 32; dz++) for (let dx = 0; dx < 32; dx++) floor = Math.min(floor, this.bed(x0 + dx, z0 + dz));
    this.roof = floor - 2;
    const changes: Change[] = [];
    for (let dz = 0; dz < 32; dz++) for (let dx = 0; dx < 32; dx++) for (let y = this.roof - 6; y < this.roof; y++) changes.push([x0 + dx, y, z0 + dz, Block.Air]);
    this.apply(changes);
    console.log(`[flood] room carved at ${x0}, ${this.roof - 6}, ${z0}; opening in 2 s`);
  }

  private open(): void {
    const [x0, z0] = this.at;
    const changes: Change[] = [];
    for (let dz = 0; dz < 32; dz++) for (let dx = 0; dx < 32; dx++) for (let y = this.bed(x0 + dx, z0 + dz); y >= this.roof; y--) changes.push([x0 + dx, y, z0 + dz, Block.Air]);
    this.apply(changes);
    for (const [x, y, z] of changes) this.flow.wake(x, y, z);
    console.log(`[flood] ceiling opened: ${changes.length} blocks`);
  }
}
