// `?autofly[=seconds]`: a repeatable flight for measuring the engine. Waits at the start
// until the view is fully loaded, then flies a fixed straight heading at sprint speed and
// reports frame times and holes. Same seed, same path, so runs before and after a change
// are comparable. The report goes to the console and the `?stats` overlay.

import type { ChunkLoader } from './chunkLoader';
import { TUNING } from './config';
import type { FlyCamera } from './player';
import { LONG_FRAME_MS } from './stats';

const DEFAULT_SECONDS = 30;
/** High enough to clear nearly all terrain, so the path never depends on what's below. */
const ALTITUDE = 112;
/** Diagonal (+x, +z): crosses chunk borders on both axes, the most loading per block flown. */
const YAW = (-3 * Math.PI) / 4;
const PITCH = -0.3;
/** Holes are missing chunks this many rings inside the view radius, well inside the fog. */
const HOLE_MARGIN = 2;
/** A frame gap this long means the page was paused or throttled, not slow. */
const STALL_MS = 500;

export interface AutoflyReport {
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
  private flown = 0;
  private nextSample = 1;
  private readonly intervals: number[] = [];
  private readonly holes: number[] = [];
  private readonly pending: number[] = [];
  private stalled = false;

  constructor(
    private readonly fly: FlyCamera,
    private readonly loader: ChunkLoader,
    private readonly seconds: number,
    private readonly onReport: (report: AutoflyReport, text: string) => void,
  ) {
    fly.camera.position.y = ALTITUDE;
    fly.yaw = YAW;
    fly.pitch = PITCH;
  }

  /** `?autofly` or `?autofly=60` → the flight's length in seconds; null when absent. */
  static seconds(params: URLSearchParams): number | null {
    if (!params.has('autofly')) return null;
    const s = Number(params.get('autofly'));
    return s > 0 ? s : DEFAULT_SECONDS;
  }

  /** True until the report is out; while true it flies the camera instead of the keys. */
  get active(): boolean {
    return this.phase !== 'done';
  }

  /** Once per frame, before loading. `interval` is the real time since the previous frame, in ms. */
  update(now: number, dt: number, interval: number): void {
    if (document.visibilityState !== 'visible' || interval > STALL_MS) this.stalled = true;
    if (this.phase === 'loading') {
      this.fly.move(dt, 0, 0, 0, false);
      if (this.loader.pending === 0 && this.loader.missing(TUNING.view.radius) === 0) {
        this.firstViewMs = now;
        this.phase = 'flying';
      }
      return;
    }
    if (this.phase !== 'flying') return;

    this.fly.move(dt, 1, 0, 0, true);
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

  private report(): void {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const r: AutoflyReport = {
      firstViewMs: Math.round(this.firstViewMs),
      seconds: this.seconds,
      frames: sorted.length,
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      max: sorted[sorted.length - 1],
      over20: sorted.filter((v) => v > LONG_FRAME_MS).length,
      over33: sorted.filter((v) => v > 33.4).length,
      maxHoles: Math.max(0, ...this.holes),
      secondsWithHoles: this.holes.filter((h) => h > 0).length,
      maxPending: Math.max(0, ...this.pending),
      stalled: this.stalled,
    };
    const f = (v: number) => v.toFixed(1);
    const text = [
      `autofly ${r.seconds} s at radius ${TUNING.view.radius}${r.stalled ? ' (PAGE STALLED OR HIDDEN: numbers invalid)' : ''}`,
      `first view ${(r.firstViewMs / 1000).toFixed(1)} s after load`,
      `frames ${r.frames}: p50 ${f(r.p50)}  p95 ${f(r.p95)}  p99 ${f(r.p99)}  max ${f(r.max)} ms`,
      `over 20 ms: ${r.over20}   over 33 ms: ${r.over33}`,
      `holes: max ${r.maxHoles}, in ${r.secondsWithHoles} of ${this.holes.length} s   pending: max ${r.maxPending}`,
    ].join('\n');
    this.onReport(r, text);
  }
}
