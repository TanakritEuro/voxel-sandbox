import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { Block, delay, gateOf, inverter, wirePower } from '../src/world/blocks';
import { CHUNK_VOLUME, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { LogicFlow, type LogicWorld, wakeLogicColumn } from '../src/world/logic';
import { World } from '../src/world/world';
import { Grid } from './grid';

/** A grid loaded everywhere, with a stone floor under y = 1 (circuits stand at y 1). */
class Board extends Grid implements LogicWorld {
  constructor() {
    super();
    this.floor(-40, 40, -10, 10, 1);
  }
  hasColumn(): boolean {
    return true;
  }
}

/** Put a block and wake round it, as an edit in the game does. */
function put(board: Board, flow: LogicFlow, x: number, z: number, b: Block): void {
  board.set(x, 1, z, b);
  flow.wake(x, 1, z);
}

/** Tick `n` times, making each tick's changes; `each` sees the board after every tick. */
function run(board: Board, flow: LogicFlow, n: number, each?: (tick: number) => void, budget?: number): void {
  for (let t = 0; t < n; t++) {
    for (const [x, y, z, b] of flow.tick(board, budget)) board.set(x, y, z, b);
    each?.(flow.ticks);
  }
}

/** Wire along x from x0 to x1 at z. */
function line(board: Board, flow: LogicFlow, x0: number, x1: number, z = 0): void {
  for (let x = x0; x <= x1; x++) put(board, flow, x, z, Block.Wire);
}

const powers = (board: Board, x0: number, x1: number, z = 0) => Array.from({ length: x1 - x0 + 1 }, (_, i) => wirePower(board.getBlock(x0 + i, 1, z)));

describe('wires', () => {
  it('carry a switch’s signal 15 next to it, one less a block along, nothing past 15 blocks; off empties them in a tick', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, 0, 0, Block.Switch);
    line(board, flow, 1, 20);
    run(board, flow, 2);
    expect(powers(board, 1, 20).every((p) => p === 0)).toBe(true);
    put(board, flow, 0, 0, Block.SwitchOn);
    run(board, flow, 1);
    expect(powers(board, 1, 20)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    put(board, flow, 0, 0, Block.Switch);
    run(board, flow, 1);
    expect(powers(board, 1, 20).every((p) => p === 0)).toBe(true);
    run(board, flow, 5);
    expect(flow.pending).toBe(0); // and then it's still
  });

  it('take the stronger signal where two meet, and power from a source under them', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, 0, 0, Block.ChargedBlock);
    line(board, flow, 1, 12);
    put(board, flow, 13, 0, Block.ChargedBlock);
    run(board, flow, 1);
    expect(powers(board, 1, 12)).toEqual([15, 14, 13, 12, 11, 10, 10, 11, 12, 13, 14, 15]);
    // A wire standing on a charged block is fed by it.
    board.set(20, 0, 5, Block.ChargedBlock);
    line(board, flow, 20, 23, 5);
    run(board, flow, 1);
    expect(powers(board, 20, 23, 5)).toEqual([15, 14, 13, 12]);
  });
});

describe('lamps', () => {
  it('light beside a powered wire or a source, and go dark when it goes', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, 0, 0, Block.Switch);
    line(board, flow, 1, 5);
    put(board, flow, 6, 0, Block.SignalLamp);
    put(board, flow, 0, 1, Block.SignalLamp); // beside the switch itself
    run(board, flow, 2);
    expect([board.getBlock(6, 1, 0), board.getBlock(0, 1, 1)]).toEqual([Block.SignalLamp, Block.SignalLamp]);
    put(board, flow, 0, 0, Block.SwitchOn);
    run(board, flow, 1);
    expect([board.getBlock(6, 1, 0), board.getBlock(0, 1, 1)]).toEqual([Block.SignalLampOn, Block.SignalLampOn]);
    put(board, flow, 0, 0, Block.Switch);
    run(board, flow, 1);
    expect([board.getBlock(6, 1, 0), board.getBlock(0, 1, 1)]).toEqual([Block.SignalLamp, Block.SignalLamp]);
  });
});

describe('gates', () => {
  it('an inverter is on with nothing behind it, goes off a tick after a signal arrives, and powers the wire in front', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, 0, 0, Block.Switch);
    put(board, flow, 1, 0, Block.Wire);
    put(board, flow, 2, 0, inverter(0, false)); // facing +x
    line(board, flow, 3, 5);
    run(board, flow, 2);
    expect(gateOf(board.getBlock(2, 1, 0))!.on).toBe(true);
    expect(powers(board, 3, 5)).toEqual([15, 14, 13]);
    put(board, flow, 0, 0, Block.SwitchOn);
    run(board, flow, 1);
    expect(gateOf(board.getBlock(2, 1, 0))!.on).toBe(true); // not in the same tick
    run(board, flow, 1);
    expect(gateOf(board.getBlock(2, 1, 0))!.on).toBe(false);
    expect(powers(board, 3, 5)).toEqual([0, 0, 0]);
  });

  it('a delay passes a pulse on its setting’s ticks later, as long as it was', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, 0, 0, Block.Switch);
    put(board, flow, 1, 0, Block.Wire);
    put(board, flow, 2, 0, delay(0, 3, false));
    put(board, flow, 3, 0, Block.SignalLamp);
    run(board, flow, 2);
    const lit: number[] = [];
    // On for 4 ticks, then off.
    put(board, flow, 0, 0, Block.SwitchOn);
    const start = flow.ticks;
    run(board, flow, 12, (t) => {
      if (t === start + 4) put(board, flow, 0, 0, Block.Switch);
      if (board.getBlock(3, 1, 0) === Block.SignalLampOn) lit.push(t - start);
    });
    // The switch went on at tick 1 (of these) and off at 5: the lamp on from 4 to 7, 3 ticks later and 4 long.
    expect(lit).toEqual([4, 5, 6, 7]);
  });

  it('take nothing in at their front', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, 3, 0, Block.ChargedBlock); // in front of a delay facing +x
    put(board, flow, 2, 0, delay(0, 1, false));
    run(board, flow, 5);
    expect(gateOf(board.getBlock(2, 1, 0))!.on).toBe(false);
  });

  it('make a clock of an inverter feeding itself, blinking steadily for minutes without growing work', () => {
    const board = new Board();
    const flow = new LogicFlow();
    // An inverter facing +x at (0, 0); its output round a loop of wire back behind it, with a lamp on the loop.
    put(board, flow, 0, 0, inverter(0, false));
    for (const [x, z] of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) put(board, flow, x, z, Block.Wire);
    put(board, flow, 1, 2, Block.SignalLamp);
    const states: boolean[] = [];
    let mostPending = 0;
    run(board, flow, 60 * 10, () => {
      states.push(gateOf(board.getBlock(0, 1, 0))!.on);
      mostPending = Math.max(mostPending, flow.pending);
    });
    const flips = states.slice(1).filter((s, i) => s !== states[i]).length;
    // On a tick, off the next: a flip every tick or so, the whole minute.
    expect(flips).toBeGreaterThan(250);
    expect(states.slice(-20).filter((s) => s).length).toBeGreaterThan(5);
    expect(mostPending).toBeLessThan(40);
  });
});

describe('buttons', () => {
  it('go off a second after they are pressed', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, 0, 0, Block.ButtonOn);
    put(board, flow, 1, 0, Block.SignalLamp);
    let off = -1;
    run(board, flow, 30, (t) => {
      if (off < 0 && board.getBlock(0, 1, 0) === Block.Button) off = t;
    });
    expect(off).toBe(1 + TUNING.logic.buttonTicks);
    expect(board.getBlock(1, 1, 0)).toBe(Block.SignalLamp);
  });
});

describe('the work', () => {
  it('ends the same however it is split across ticks', () => {
    const build = () => {
      const board = new Board();
      const flow = new LogicFlow();
      put(board, flow, -10, 0, Block.SwitchOn);
      line(board, flow, -9, 9);
      for (let z = 1; z <= 6; z++) put(board, flow, 0, z, Block.Wire);
      put(board, flow, 10, 0, Block.SignalLamp);
      put(board, flow, 0, 7, Block.SignalLamp);
      put(board, flow, -8, 1, Block.SignalLamp); // beside the wire where it's strong
      put(board, flow, -7, 1, delay(2, 2, false)); // facing +z, its input the wire behind it
      put(board, flow, -7, 2, Block.SignalLamp);
      return { board, flow };
    };
    const whole = build();
    run(whole.board, whole.flow, 20);
    const split = build();
    run(split.board, split.flow, 400, undefined, 3);
    const diff: string[] = [];
    for (let z = -2; z <= 8; z++) for (let x = -12; x <= 12; x++) if (split.board.getBlock(x, 1, z) !== whole.board.getBlock(x, 1, z)) diff.push(`${x},${z}: ${split.board.getBlock(x, 1, z)} vs ${whole.board.getBlock(x, 1, z)}`);
    expect(diff).toEqual([]);
    // The signal reaches the branch at 6 and has faded out by its end: the lamp there stays dark.
    expect(powers(whole.board, 0, 0, 1)).toEqual([5]);
    expect(powers(whole.board, 0, 0, 6)).toEqual([0]);
    expect(whole.board.getBlock(0, 1, 7)).toBe(Block.SignalLamp);
    expect(whole.board.getBlock(-8, 1, 1)).toBe(Block.SignalLampOn);
    expect(gateOf(whole.board.getBlock(-7, 1, 1))!.on).toBe(true);
    expect(whole.board.getBlock(-7, 1, 2)).toBe(Block.SignalLampOn);
  });
});

describe('logic in a loaded world', () => {
  /** Column (cx, cz)'s chunks: a stone floor whose top is at y = 59, air above. */
  const floorColumn = (): (Uint8Array | null)[] =>
    Array.from({ length: MAX_CHUNK_Y - MIN_CHUNK_Y + 1 }, (_, i) => {
      if (MIN_CHUNK_Y + i !== 1) return null;
      const blocks = new Uint8Array(CHUNK_VOLUME);
      blocks.fill(Block.Stone, 0, 28 * 32 * 32);
      return blocks;
    });
  const make = (copy?: World) => {
    const w = new World(1);
    for (let cz = -1; cz <= 0; cz++)
      for (let cx = -1; cx <= 0; cx++)
        w.addColumn(cx, cz, copy ? Array.from({ length: MAX_CHUNK_Y - MIN_CHUNK_Y + 1 }, (_, i) => copy.getChunk(cx, MIN_CHUNK_Y + i, cz)!.blocks.slice()) : floorColumn());
    return w;
  };
  const tick = (world: World, flow: LogicFlow) => world.setBlocks(flow.tick(world));

  it('carries on after being saved and loaded: a clock across a chunk border still blinks, its lamp with it', () => {
    const world = make();
    const flow = new LogicFlow();
    // The clock of the bench round (0, 0), across the border at x = 0, and a lamp beside its wire.
    const blocks: [number, number, number, Block][] = [[0, 60, 0, inverter(0, false)], [-1, 60, -1, delay(1, 4, false)], [2, 60, 0, Block.SignalLamp]];
    for (const [x, z] of [[1, 0], [1, -1], [0, -1], [-2, -1], [-2, 0], [-1, 0]]) blocks.push([x, 60, z, Block.Wire]);
    world.setBlocks(blocks);
    for (const [x, y, z] of blocks) flow.wake(x, y, z);
    for (let t = 0; t < 33; t++) tick(world, flow);
    // "Saved" mid-blink, then loaded: the chunks copied into a new world, its columns woken.
    const loaded = make(world);
    const again = new LogicFlow();
    let woken = 0;
    for (let cz = -1; cz <= 0; cz++) for (let cx = -1; cx <= 0; cx++) woken += wakeLogicColumn(again, loaded, cx, cz, true);
    expect(woken).toBeGreaterThanOrEqual(blocks.length);
    let flips = 0;
    let lit = 0;
    let was = gateOf(loaded.getBlock(0, 60, 0))!.on;
    for (let t = 0; t < 100; t++) {
      tick(loaded, again);
      const on = gateOf(loaded.getBlock(0, 60, 0))!.on;
      if (on !== was) flips++;
      was = on;
      if (loaded.getBlock(2, 60, 0) === Block.SignalLampOn) lit++;
    }
    expect(flips).toBeGreaterThanOrEqual(18);
    expect(lit).toBeGreaterThan(20);
    expect(lit).toBeLessThan(80);
    // A lit lamp gives light.
    for (let t = 0; t < 10 && loaded.getBlock(2, 60, 0) !== Block.SignalLampOn; t++) tick(loaded, again);
    expect(loaded.getBlock(2, 60, 0)).toBe(Block.SignalLampOn);
    expect(loaded.getLight(3, 60, 0) & 15).toBeGreaterThan(0);
  });

  it('a wire changing power is remeshed but leaves the light as it was; a lamp lighting changes it', () => {
    const world = make();
    world.setBlocks([[5, 60, 5, Block.Wire], [8, 60, 5, Block.SignalLamp]]);
    const before = world.getChunk(0, 1, 0)!.light.slice();
    const stale = world.setBlocks([[5, 60, 5, Block.Wire + 15]]);
    expect(stale.map((c) => c.key)).toContain(world.getChunk(0, 1, 0)!.key);
    expect(world.getChunk(0, 1, 0)!.light).toEqual(before);
    world.setBlocks([[8, 60, 5, Block.SignalLampOn]]);
    expect(world.getChunk(0, 1, 0)!.light).not.toEqual(before);
  });

  it('nothing to wake in a column that was generated, and only its neighbours’ faces looked at', () => {
    const world = make();
    const flow = new LogicFlow();
    expect(wakeLogicColumn(flow, world, 0, 0, false)).toBe(0);
    // Wire at the face of column (-1, 0) that looks into (0, 0), and one further in.
    world.setBlocks([[-1, 60, 5, Block.Wire], [-3, 60, 5, Block.Wire]]);
    expect(wakeLogicColumn(flow, world, 0, 0, false)).toBe(1);
    expect(flow.pending).toBe(7);
  });
});
