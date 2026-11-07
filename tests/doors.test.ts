import { describe, expect, it } from 'vitest';
import { findPath } from '../src/mobs/pathfind';
import { canMake, RECIPES } from '../src/survival/crafting';
import { Inventory } from '../src/survival/inventory';
import { Block, door, doorOf } from '../src/world/blocks';
import { LogicFlow, type LogicWorld } from '../src/world/logic';
import { useAt } from '../src/world/parts';
import { Grid } from './grid';

/** A grid loaded everywhere, with a stone floor under y = 1. */
class Board extends Grid implements LogicWorld {
  constructor() {
    super();
    this.floor(-10, 10, -10, 10, 1);
  }
  hasColumn(): boolean {
    return true;
  }
}

/** Set blocks and wake round each, as edits in the game do. */
function put(board: Board, flow: LogicFlow, ...parts: [number, number, number, Block][]): void {
  for (const [x, y, z, b] of parts) {
    board.set(x, y, z, b);
    flow.wake(x, y, z);
  }
}

/** Tick `n` times, making each tick's changes. */
function run(board: Board, flow: LogicFlow, n = 3): void {
  for (let t = 0; t < n; t++) for (const [x, y, z, b] of flow.tick(board)) board.set(x, y, z, b);
}

/** A door at (0, 1, 0) placed looking along +z, closed. */
const DOOR: [number, number, number, Block][] = [
  [0, 1, 0, door(2, false, false)],
  [0, 2, 0, door(2, false, true)],
];
const isOpen = (board: Board) => [doorOf(board.getBlock(0, 1, 0))!.open, doorOf(board.getBlock(0, 2, 0))!.open];

describe('doors by hand', () => {
  it('open and shut both halves with a click on either, and a lone half alone', () => {
    const board = new Board();
    for (const [x, y, z, b] of DOOR) board.set(x, y, z, b);
    expect(useAt(board, 0, 1, 0)).toEqual([
      [0, 1, 0, door(2, true, false)],
      [0, 2, 0, door(2, true, true)],
    ]);
    board.set(0, 1, 0, door(2, true, false)).set(0, 2, 0, door(2, true, true));
    expect(useAt(board, 0, 2, 0)).toEqual([
      [0, 2, 0, door(2, false, true)],
      [0, 1, 0, door(2, false, false)],
    ]);
    board.set(0, 2, 0, Block.Air);
    expect(useAt(board, 0, 1, 0)).toEqual([[0, 1, 0, door(2, false, false)]]);
    expect(useAt(board, 0, 0, 0)).toBe(null);
  });

  it('are made from 6 planks', () => {
    const recipe = RECIPES.find((r) => r.makes === Block.Door)!;
    expect(recipe.cost).toEqual([[Block.Planks, 6]]);
    const pack = new Inventory();
    pack.add(Block.Planks, 5);
    expect(canMake(pack, recipe)).toBe(false);
    pack.add(Block.Planks, 1);
    expect(canMake(pack, recipe)).toBe(true);
  });
});

describe('doors and signals', () => {
  it('open while a switch beside the lower half is on, and shut when it goes off', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, ...DOOR, [1, 1, 0, Block.Switch]);
    run(board, flow);
    expect(isOpen(board)).toEqual([false, false]);
    put(board, flow, [1, 1, 0, Block.SwitchOn]);
    run(board, flow);
    expect(isOpen(board)).toEqual([true, true]);
    put(board, flow, [1, 1, 0, Block.Switch]);
    run(board, flow);
    expect(isOpen(board)).toEqual([false, false]);
  });

  it('open from a signal at the upper half too, and from powered wire', () => {
    const board = new Board();
    const flow = new LogicFlow();
    // A charged block beside the upper half.
    put(board, flow, ...DOOR, [-1, 2, 0, Block.ChargedBlock]);
    run(board, flow);
    expect(isOpen(board)).toEqual([true, true]);
    // Wire from a switch to the lower half of another door.
    const other = new Board();
    const flow2 = new LogicFlow();
    put(other, flow2, ...DOOR, [3, 1, 0, Block.Switch], [2, 1, 0, Block.Wire], [1, 1, 0, Block.Wire]);
    run(other, flow2);
    expect(isOpen(other)).toEqual([false, false]);
    put(other, flow2, [3, 1, 0, Block.SwitchOn]);
    run(other, flow2);
    expect(isOpen(other)).toEqual([true, true]);
  });

  it("keep a click until the signal changes: shut by hand while powered stays shut, and opens with the next signal", () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, ...DOOR, [1, 1, 0, Block.SwitchOn]);
    run(board, flow);
    expect(isOpen(board)).toEqual([true, true]);
    // Shut by hand (both halves, as a click makes them): the signal hasn't changed, so it stays shut.
    put(board, flow, ...useAt(board, 0, 1, 0)!);
    run(board, flow, 5);
    expect(isOpen(board)).toEqual([false, false]);
    // Off: nothing to do (shut already). On again: open.
    put(board, flow, [1, 1, 0, Block.Switch]);
    run(board, flow);
    expect(isOpen(board)).toEqual([false, false]);
    put(board, flow, [1, 1, 0, Block.SwitchOn]);
    run(board, flow);
    expect(isOpen(board)).toEqual([true, true]);
    // Opened by hand with no signal: it stays open.
    const quiet = new Board();
    const flow2 = new LogicFlow();
    put(quiet, flow2, ...DOOR);
    run(quiet, flow2);
    put(quiet, flow2, ...useAt(quiet, 0, 2, 0)!);
    run(quiet, flow2, 5);
    expect(isOpen(quiet)).toEqual([true, true]);
  });

  it('start afresh for a new door where an old one was', () => {
    const board = new Board();
    const flow = new LogicFlow();
    put(board, flow, ...DOOR, [1, 1, 0, Block.ChargedBlock]);
    run(board, flow);
    expect(isOpen(board)).toEqual([true, true]);
    // Broken, and a new one put there by the charged block: it opens too.
    put(board, flow, [0, 1, 0, Block.Air], [0, 2, 0, Block.Air]);
    run(board, flow);
    put(board, flow, ...DOOR);
    run(board, flow);
    expect(isOpen(board)).toEqual([true, true]);
  });
});

describe('doors and mobs', () => {
  // A wall across z = 3 from x -10 to 10, two high, with a door in it at x = 2.
  function walled(open: boolean): Grid {
    const w = new Grid().floor(-10, 10, -10, 10);
    for (let x = -10; x <= 10; x++) if (x !== 2) w.pillar(x, 3, 1, 2);
    w.set(2, 1, 3, door(2, open, false)).set(2, 2, 3, door(2, open, true));
    return w;
  }

  it("go through an open door, and can't through a closed one", () => {
    const through = findPath(walled(true), [2, 1, 0], [2, 1, 6]).path;
    expect(through).not.toBeNull();
    expect(through!.some(([x, , z]) => x === 2 && z === 3)).toBe(true);
    expect(findPath(walled(false), [2, 1, 0], [2, 1, 6]).path).toBeNull();
  });
});
