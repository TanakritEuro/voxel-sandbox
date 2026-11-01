// Logic blocks' signals (Milestone 10). Pure.
//
// Each tick (`TUNING.logic.tickSeconds`), only round what was woken (an edit wakes the block and its
// six neighbours, every change its own):
// 1. Gates' outputs and buttons' releases that fall due are made.
// 2. Every wire network touched is worked out at once: the wires joined to each other sideways on
//    one level, 15 next to a source (a charged block, a switch or button on, beside it or under it;
//    a gate that is on, facing into it), one less a block along, as light spreads. So a signal
//    crosses a network in the tick it changes, and switching off empties it at once.
// 3. Lamps round anything touched or changed are lit if a powered wire, a source that is on, or a
//    gate on facing into them is beside them.
// 4. Gates round anything touched or changed read the block behind them (powered wire, a source on,
//    a gate on facing into them) and queue their output for later: an inverter the opposite, a
//    tick on; a delay the same, its setting's ticks on, each change queued so a pulse keeps its
//    length. Gates never change in the tick their input does: that is what makes loops clocks
//    rather than hangs.
// 5. A button seen pressed is let go `TUNING.logic.buttonTicks` later.
//
// A tick's changes go into an overlay that its own reads see, and are returned for the caller to
// make (as the water's are). At most `budget` woken blocks a tick, oldest first; the rest wait.
// Unloaded land is nothing.

import { TUNING } from '../config';
import { Block, delay, FACINGS, gateOf, inverter, wire, wirePower } from './blocks';
import { MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, WORLD_HEIGHT } from './coords';
import type { BlockSource } from './physics';

/** The blocks, and which columns are loaded. */
export interface LogicWorld extends BlockSource {
  hasColumn(cx: number, cz: number): boolean;
}

/** A block a tick sets at (x, y, z). */
export type LogicChange = [number, number, number, Block];

// Positions as one number, as the water has them: x and z offset into 21 bits each, y above them.
const OFF = 1 << 20;
const SPAN = 1 << 21;
const keyOf = (x: number, y: number, z: number) => (y * SPAN + (x + OFF)) * SPAN + (z + OFF);
const xOf = (k: number) => (Math.floor(k / SPAN) % SPAN) - OFF;
const yOf = (k: number) => Math.floor(k / SPAN / SPAN);
const zOf = (k: number) => (k % SPAN) - OFF;
/** The step from a key to its neighbour along (dx, dy, dz). */
const stepOf = (dx: number, dy: number, dz: number) => dy * SPAN * SPAN + dx * SPAN + dz;
const SIX = [stepOf(1, 0, 0), stepOf(-1, 0, 0), stepOf(0, 1, 0), stepOf(0, -1, 0), stepOf(0, 0, 1), stepOf(0, 0, -1)];
const FOUR = [stepOf(1, 0, 0), stepOf(-1, 0, 0), stepOf(0, 0, 1), stepOf(0, 0, -1)];
const BELOW = stepOf(0, -1, 0);
/** A facing's step, by `FACINGS` index. */
const FACING_STEP = FACINGS.map(([dx, dz]) => stepOf(dx, 0, dz));

/** A source that is on: it powers wire beside or on it, lamps beside it, gates behind which it is. */
const sourceOn = (b: Block) => b === Block.ChargedBlock || b === Block.SwitchOn || b === Block.ButtonOn;
const isLamp = (b: Block) => b === Block.SignalLamp || b === Block.SignalLampOn;

export class LogicFlow {
  /** Blocks to look round next tick, in the order they were woken. */
  private readonly active = new Set<number>();
  /** Gates' queued outputs, by place: the tick each falls due and the state it brings. */
  private readonly queued = new Map<number, { tick: number; on: boolean }[]>();
  /** Buttons to let go, by place: the tick. */
  private readonly releases = new Map<number, number>();
  // Per tick: blocks read, columns loaded, and what the tick has set so far.
  private readonly blocks = new Map<number, Block>();
  private readonly columns = new Map<number, boolean>();
  private readonly overlay = new Map<number, Block>();
  private world: LogicWorld | null = null;
  /** Ticks so far. */
  ticks = 0;
  /** For `?stats`: changes in the last tick, and wire blocks worked out in it. */
  changed = 0;
  wires = 0;

  /** Is there anything to do: blocks woken, outputs queued, buttons to let go? */
  get pending(): number {
    return this.active.size + this.queued.size + this.releases.size;
  }

  /** Something changed at (x, y, z): look round it and its six neighbours next tick. */
  wake(x: number, y: number, z: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const k = keyOf(x, y, z);
    this.active.add(k);
    for (const s of SIX) this.active.add(k + s);
  }

  /** One tick, as described at the top. Returns the changes, which the caller must make before the next tick. */
  tick(world: LogicWorld, budget: number = TUNING.logic.maxPerTick): LogicChange[] {
    this.world = world;
    this.blocks.clear();
    this.columns.clear();
    this.overlay.clear();
    const n = ++this.ticks;
    // 0. What was woken, oldest first.
    const touched = new Set<number>();
    for (const k of this.active) {
      if (touched.size >= budget) break;
      touched.add(k);
    }
    for (const k of touched) this.active.delete(k);
    // 1. What falls due.
    for (const [k, events] of this.queued) {
      while (events.length && events[0].tick <= n) {
        const { on } = events.shift()!;
        const g = gateOf(this.block(k));
        if (g) this.set(k, g.kind === 'inverter' ? inverter(g.facing, on) : delay(g.facing, g.setting, on));
      }
      if (!events.length) this.queued.delete(k);
    }
    for (const [k, due] of this.releases) {
      if (due > n) continue;
      this.releases.delete(k);
      if (this.block(k) === Block.ButtonOn) this.set(k, Block.Button);
    }
    for (const k of this.overlay.keys()) touched.add(k);
    // 2. The wire networks at or beside what was touched.
    const done = new Set<number>();
    this.wires = 0;
    for (const k of touched) {
      if (wirePower(this.block(k)) >= 0 && !done.has(k)) this.network(k, done);
      for (const s of SIX) if (wirePower(this.block(k + s)) >= 0 && !done.has(k + s)) this.network(k + s, done);
    }
    // 3–5. Lamps, gates and buttons at or beside what was touched or changed.
    const around = new Set<number>(touched);
    for (const k of this.overlay.keys()) around.add(k);
    const looked = new Set<number>();
    for (const k of around) {
      for (const p of [k, k + SIX[0], k + SIX[1], k + SIX[2], k + SIX[3], k + SIX[4], k + SIX[5]]) {
        if (looked.has(p)) continue;
        looked.add(p);
        const b = this.block(p);
        if (isLamp(b)) {
          const lit = this.lampLit(p);
          if (lit !== (b === Block.SignalLampOn)) this.set(p, lit ? Block.SignalLampOn : Block.SignalLamp);
        } else if (b === Block.ButtonOn) {
          if (!this.releases.has(p)) this.releases.set(p, n + TUNING.logic.buttonTicks);
        } else {
          const g = gateOf(b);
          if (g) this.gate(p, g, n);
        }
      }
    }
    // The changes, each waking what's round it for next tick.
    const changes: LogicChange[] = [];
    for (const [k, b] of this.overlay) {
      if (b === this.read(k)) continue;
      const x = xOf(k);
      const y = yOf(k);
      const z = zOf(k);
      changes.push([x, y, z, b]);
      this.wake(x, y, z);
    }
    this.changed = changes.length;
    this.world = null;
    return changes;
  }

  /** The wire network through wire `start`: every wire joined to it, its power from its sources. */
  private network(start: number, done: Set<number>): void {
    // The wires, and those next to something that powers them.
    const wires: number[] = [start];
    done.add(start);
    const power = new Map<number, number>();
    const queue: number[] = [];
    for (let i = 0; i < wires.length; i++) {
      const w = wires[i];
      let fed = sourceOn(this.block(w + BELOW));
      for (let d = 0; d < 4; d++) {
        const nb = w + FOUR[d];
        const b = this.block(nb);
        if (wirePower(b) >= 0) {
          if (!done.has(nb)) {
            done.add(nb);
            wires.push(nb);
          }
        } else if (sourceOn(b)) fed = true;
        else {
          // A gate on, facing into this wire.
          const g = gateOf(b);
          if (g?.on && nb + FACING_STEP[g.facing] === w) fed = true;
        }
      }
      if (fed) {
        power.set(w, 15);
        queue.push(w);
      }
    }
    this.wires += wires.length;
    // Outwards from the fed wires, a step less a block.
    for (let i = 0; i < queue.length; i++) {
      const w = queue[i];
      const p = power.get(w)! - 1;
      if (p <= 0) continue;
      for (const s of FOUR) {
        const nb = w + s;
        if (wirePower(this.block(nb)) < 0 || (power.get(nb) ?? 0) >= p) continue;
        power.set(nb, p);
        queue.push(nb);
      }
    }
    for (const w of wires) {
      const p = power.get(w) ?? 0;
      if (wirePower(this.block(w)) !== p) this.set(w, wire(p));
    }
  }

  /** Is something beside the lamp at `k` giving it a signal? */
  private lampLit(k: number): boolean {
    for (const s of SIX) {
      const b = this.block(k + s);
      if (wirePower(b) > 0 || sourceOn(b)) return true;
      const g = gateOf(b);
      if (g?.on && k + s + FACING_STEP[g.facing] === k) return true;
    }
    return false;
  }

  /** The gate at `k`: what its input says it should become, queued if that's a change. */
  private gate(k: number, g: NonNullable<ReturnType<typeof gateOf>>, n: number): void {
    const behind = k - FACING_STEP[g.facing];
    const b = this.block(behind);
    const back = gateOf(b);
    const input = wirePower(b) > 0 || sourceOn(b) || (back !== null && back.on && behind + FACING_STEP[back.facing] === k);
    const want = g.kind === 'inverter' ? !input : input;
    const events = this.queued.get(k);
    const last = events?.length ? events[events.length - 1].on : g.on;
    if (want === last) return;
    const event = { tick: n + (g.kind === 'inverter' ? 1 : g.setting), on: want };
    if (events) events.push(event);
    else this.queued.set(k, [event]);
  }

  /** Set `b` at `k` this tick (seen by the rest of the tick). */
  private set(k: number, b: Block): void {
    this.overlay.set(k, b);
  }

  /** The block at `k` as this tick sees it: what it has set, or the world. */
  private block(k: number): Block {
    return this.overlay.get(k) ?? this.read(k);
  }

  /** The block at `k` in the world (unloaded land and outside the world: air). */
  private read(k: number): Block {
    let b = this.blocks.get(k);
    if (b === undefined) {
      const y = yOf(k);
      const cy = toChunk(y);
      if (cy < MIN_CHUNK_Y || cy > MAX_CHUNK_Y) b = Block.Air;
      else {
        const x = xOf(k);
        const z = zOf(k);
        b = this.loaded(x, z) ? this.world!.getBlock(x, y, z) : Block.Air;
      }
      this.blocks.set(k, b);
    }
    return b;
  }

  private loaded(x: number, z: number): boolean {
    const cx = toChunk(x);
    const cz = toChunk(z);
    const k = (cx + 0x8000) * 0x10000 + (cz + 0x8000);
    let yes = this.columns.get(k);
    if (yes === undefined) {
      yes = this.world!.hasColumn(cx, cz);
      this.columns.set(k, yes);
    }
    return yes;
  }
}
