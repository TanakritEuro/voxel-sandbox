// `?stats` overlay (F3 toggles): frame timing with a graph, what the renderer drew, and
// what the engine is doing. Cheap enough to leave on while measuring: the text updates
// four times a second and the graph is one small canvas.

import type * as THREE from 'three';

/** Engine numbers the overlay shows, read when it redraws. */
export interface EngineCounters {
  chunks: number;
  /** Chunks that could be seen from the player's chunk (the rest aren't meshed or drawn). */
  visible: number;
  meshed: number;
  queued: number;
  inFlight: number;
  /** Fraction of worker time spent on jobs, or null before there are workers. */
  workerBusy: number | null;
  chunkBytes: number;
  /** Bytes of light arrays (the shared ones once). */
  lightBytes: number;
  geometryBytes: number;
  /** Triangles in all chunk meshes, drawn or not. */
  sceneTriangles: number;
  /** The last block edit: ms in all, ms of it for light, chunks remeshed (null before the first). */
  lastEdit: { ms: number; lightMs: number; chunks: number } | null;
  /** Time of day and daylight, as text. */
  time: string;
  /** What saving is doing, as text. */
  saving: string;
}

/** Frames longer than this count as dropped (the budget in CLAUDE.md). */
export const LONG_FRAME_MS = 20;
const GRAPH_SECONDS = 5;
const GRAPH_MAX_MS = 40;
const TEXT_INTERVAL_MS = 250;

const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

export class Stats {
  /** Frames over LONG_FRAME_MS since load. */
  longFrames = 0;
  private readonly el: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly graph: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Recent frames: [time, interval ms, main-thread work ms, player physics ms, physics steps]. */
  private readonly frames: [number, number, number, number, number][] = [];
  private lastText = 0;
  /** Extra lines under the numbers (the autofly report). */
  note = '';

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly counters: () => EngineCounters,
    visible: boolean,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'stats';
    this.text = document.createElement('pre');
    this.graph = document.createElement('canvas');
    this.graph.width = 300;
    this.graph.height = 80;
    this.ctx = this.graph.getContext('2d')!;
    this.el.append(this.text, this.graph);
    document.querySelector('#hud')!.append(this.el);
    this.visible = visible;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F3') return;
      e.preventDefault();
      this.visible = !this.visible;
    });
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  /**
   * Call once per frame after rendering: `interval` since the previous frame, `work` spent in
   * this one, of which `physicsMs` on the player's `physicsSteps` physics steps.
   */
  frame(now: number, interval: number, work: number, physicsMs = 0, physicsSteps = 0): void {
    // A hidden tab pauses rAF; that gap isn't a dropped frame.
    if (interval > LONG_FRAME_MS && document.visibilityState === 'visible') this.longFrames++;
    this.frames.push([now, interval, work, physicsMs, physicsSteps]);
    while (this.frames.length && this.frames[0][0] < now - GRAPH_SECONDS * 1000) this.frames.shift();
    if (!this.visible) return;
    this.drawGraph(now);
    if (now - this.lastText >= TEXT_INTERVAL_MS) {
      this.lastText = now;
      this.drawText(now);
    }
  }

  private drawText(now: number): void {
    const recent = this.frames.filter((f) => f[0] >= now - 1000);
    const n = Math.max(recent.length, 1);
    const avg = recent.reduce((s, f) => s + f[1], 0) / n;
    const max = recent.reduce((m, f) => Math.max(m, f[1]), 0);
    const work = recent.reduce((s, f) => s + f[2], 0) / n;
    const workMax = recent.reduce((m, f) => Math.max(m, f[2]), 0);
    const physics = recent.reduce((s, f) => s + f[3], 0) / n;
    const physicsMax = recent.reduce((m, f) => Math.max(m, f[3]), 0);
    const steps = recent.reduce((s, f) => s + f[4], 0) / n;
    const r = this.renderer.info.render;
    const c = this.counters();
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    this.text.textContent = [
      `${(1000 / avg).toFixed(0)} fps   frame ${avg.toFixed(1)} ms avg, ${max.toFixed(1)} max`,
      `main thread ${work.toFixed(1)} ms avg, ${workMax.toFixed(1)} max`,
      `  player physics ${physics.toFixed(2)} ms avg, ${physicsMax.toFixed(2)} max (${steps.toFixed(1)} steps a frame)`,
      `over ${LONG_FRAME_MS} ms: ${this.longFrames} frames since load`,
      `draw calls ${r.calls}   triangles ${Math.round(r.triangles / 1000)}k drawn / ${Math.round(c.sceneTriangles / 1000)}k`,
      `chunks ${c.chunks} loaded, ${c.visible} could be seen, ${c.meshed} meshed`,
      `time ${c.time}`,
      `saving ${c.saving}`,
      `jobs ${c.queued} queued, ${c.inFlight} in flight` + (c.workerBusy === null ? '' : `, workers ${Math.round(c.workerBusy * 100)}% busy`),
      `memory: chunks ${mb(c.chunkBytes)}, light ${mb(c.lightBytes)}, meshes ${mb(c.geometryBytes)}` + (heap ? `, JS heap ${mb(heap)}` : ''),
      ...(c.lastEdit
        ? [`last edit ${c.lastEdit.ms.toFixed(1)} ms (light ${c.lastEdit.lightMs.toFixed(1)}), ${c.lastEdit.chunks} chunks remeshed`]
        : []),
      ...(this.note ? ['', this.note] : []),
    ].join('\n');
  }

  private drawGraph(now: number): void {
    const { ctx, graph } = this;
    const w = graph.width;
    const h = graph.height;
    const y = (msValue: number) => h - (Math.min(msValue, GRAPH_MAX_MS) / GRAPH_MAX_MS) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, w, h);
    for (const [t, interval, work] of this.frames) {
      const x = Math.floor(w - ((now - t) / (GRAPH_SECONDS * 1000)) * w);
      ctx.fillStyle = interval > LONG_FRAME_MS ? '#ff5a4f' : '#7fe08a';
      ctx.fillRect(x, y(interval), 1, h - y(interval));
      ctx.fillStyle = '#ffd34f';
      ctx.fillRect(x, y(work), 1, 1);
    }
    for (const [msValue, colour] of [
      [1000 / 60, 'rgba(255, 255, 255, 0.5)'],
      [LONG_FRAME_MS, 'rgba(255, 90, 79, 0.8)'],
    ] as const) {
      ctx.fillStyle = colour;
      ctx.fillRect(0, Math.round(y(msValue)), w, 1);
    }
  }
}
