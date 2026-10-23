// `?autofly[=seconds]`: a repeatable flight for measuring the engine. Waits at the start
// until the view is fully loaded, then flies a fixed straight heading at sprint speed and
// reports frame times and holes. Same seed, same path, so runs before and after a change
// are comparable. The report goes to the console and the `?stats` overlay.

import type { ChunkLoader } from './chunkLoader';
import { TUNING } from './config';
import type { Player } from './player';
import { LONG_FRAME_MS } from './stats';

const DEFAULT_SECONDS = 30;
/** Eye height: high enough to clear nearly all terrain. The flight passes through anything anyway. */
const ALTITUDE = 112;
/** Diagonal (+x, +z): crosses chunk borders on both axes, the most loading per block flown. */
const YAW = (-3 * Math.PI) / 4;
const PITCH = -0.3;
/** Holes are missing chunks this many rings inside the view radius, well inside the fog. */
const HOLE_MARGIN = 2;
/** A frame gap this long means the page was paused or throttled, not slow. */
const STALL_MS = 500;

export interface AutoflyReport {
  /** From page load until the chunks in front of the camera at the start were meshed. */
  frontViewMs: number;
  /** From page load until the view at the start was fully meshed. */
  firstViewMs: number;
  seconds: number;
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over20: number;
  over33: number;
  /**
   * Main-thread time per frame (our code plus submitting the draw calls): what's left of
   * it is the headroom, and what workers take away. Shows progress even on a machine fast
   * enough that no frame drops.
   */
  workP50: number;
  workP99: number;
  workMax: number;
  /** Most missing chunks inside the fog in any one-second sample, and how many samples had any. */
  maxHoles: number;
  secondsWithHoles: number;
  /** Most chunks still waiting to be meshed anywhere in the view, in any sample. */
  maxPending: number;
  /**
   * The page was hidden or throttled at some point (a gap over STALL_MS between frames,
   * which also catches a browser window that is covered but still reports "visible"),
   * so the numbers mean nothing.
   */
  stalled: boolean;
}

export class Autofly {
  private phase: 'loading' | 'flying' | 'done' = 'loading';
  private firstViewMs = 0;
  private frontViewMs = 0;
  private flown = 0;
  private nextSample = 1;
  private readonly intervals: number[] = [];
  private readonly work: number[] = [];
  private readonly holes: number[] = [];
  private readonly pending: number[] = [];
  private stalled = false;

  constructor(
    private readonly player: Player,
    private readonly loader: ChunkLoader,
    private readonly seconds: number,
    private readonly onReport: (report: AutoflyReport, text: string) => void,
  ) {
    player.body.y = ALTITUDE - TUNING.player.eyeHeight;
    player.flying = true;
    player.input.yaw = YAW;
    player.input.pitch = PITCH;
  }

  /** `?autofly` or `?autofly=60` → the flight's length in seconds; null when absent. */
  static seconds(params: URLSearchParams): number | null {
    if (!params.has('autofly')) return null;
    const s = Number(params.get('autofly'));
    return s > 0 ? s : DEFAULT_SECONDS;
  }

  /** True until the report is out; while true it flies the player instead of the keys. */
  get active(): boolean {
    return this.phase !== 'done';
  }

  /** Once per frame, before loading. `interval` is the real time since the previous frame, in ms. */
  update(now: number, dt: number, interval: number): void {
    if (document.visibilityState !== 'visible' || interval > STALL_MS) this.stalled = true;
    if (this.phase === 'loading') {
      this.player.autopilot(dt, 0);
      if (!this.frontViewMs && this.loader.missing(TUNING.view.radius, this.frontCos()) === 0) this.frontViewMs = now;
      if (this.loader.pending === 0 && this.loader.missing(TUNING.view.radius) === 0) {
        this.firstViewMs = now;
        this.phase = 'flying';
      }
      return;
    }
    if (this.phase !== 'flying') return;

    this.player.autopilot(dt, 1);
    this.intervals.push(interval);
    this.flown += dt;
    if (this.flown >= this.nextSample) {
      this.nextSample++;
      this.holes.push(this.loader.missing(TUNING.view.radius - HOLE_MARGIN));
      this.pending.push(this.loader.pending);
    }
    if (this.flown >= this.seconds) {
      this.phase = 'done';
      this.report();
    }
  }

  /** Once per frame, after rendering: main-thread milliseconds this frame. */
  frameWork(ms: number): void {
    if (this.phase === 'flying') this.work.push(ms);
  }

  /** Cosine of the angle from the look direction that counts as "in front": half the horizontal field of view, plus a little. */
  private frontCos(): number {
    const { fov, aspect } = this.player.camera;
    const halfWidth = Math.atan(Math.tan(((fov / 2) * Math.PI) / 180) * aspect);
    return Math.cos(Math.min(Math.PI, halfWidth + 0.2));
  }

  private report(): void {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const work = [...this.work].sort((a, b) => a - b);
    const pctOf = (v: number[], p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
    const pct = (p: number) => pctOf(sorted, p);
    const r: AutoflyReport = {
      frontViewMs: Math.round(this.frontViewMs),
      firstViewMs: Math.round(this.firstViewMs),
      seconds: this.seconds,
      frames: sorted.length,
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      max: sorted[sorted.length - 1],
      over20: sorted.filter((v) => v > LONG_FRAME_MS).length,
      over33: sorted.filter((v) => v > 33.4).length,
      workP50: pctOf(work, 0.5),
      workP99: pctOf(work, 0.99),
      workMax: work[work.length - 1],
      maxHoles: Math.max(0, ...this.holes),
      secondsWithHoles: this.holes.filter((h) => h > 0).length,
      maxPending: Math.max(0, ...this.pending),
      stalled: this.stalled,
    };
    const f = (v: number) => v.toFixed(1);
    const text = [
      `autofly ${r.seconds} s at radius ${TUNING.view.radius}${r.stalled ? ' (PAGE STALLED OR HIDDEN: numbers invalid)' : ''}`,
      `first view after load: in front ${(r.frontViewMs / 1000).toFixed(2)} s, all ${(r.firstViewMs / 1000).toFixed(2)} s`,
      `frames ${r.frames}: p50 ${f(r.p50)}  p95 ${f(r.p95)}  p99 ${f(r.p99)}  max ${f(r.max)} ms`,
      `over 20 ms: ${r.over20}   over 33 ms: ${r.over33}`,
      `main thread: p50 ${f(r.workP50)}  p99 ${f(r.workP99)}  max ${f(r.workMax)} ms`,
      `holes: max ${r.maxHoles}, in ${r.secondsWithHoles} of ${this.holes.length} s   pending: max ${r.maxPending}`,
    ].join('\n');
    this.onReport(r, text);
  }
}
