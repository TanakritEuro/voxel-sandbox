import { describe, expect, it } from 'vitest';
import { findPath, type Path } from '../src/mobs/pathfind';
import { Block } from '../src/world/blocks';
import { Grid } from './grid';

/** Each step of a path goes to a neighbouring column, never further. */
function expectConnected(start: [number, number, number], path: Path): void {
  let [px, , pz] = start;
  for (const [x, , z] of path) {
    expect(Math.max(Math.abs(x - px), Math.abs(z - pz))).toBe(1);
    px = x;
    pz = z;
  }
}

describe('mob paths', () => {
  it('go straight across flat ground, diagonally where they can', () => {
    const w = new Grid().floor(0, 10, 0, 10);
    const { path } = findPath(w, [0, 1, 0], [5, 1, 5]);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5); // five diagonal steps
    expect(path!.at(-1)).toEqual([5, 1, 5]);
    expectConnected([0, 1, 0], path!);
  });

  it('go round a wall, and never cut a corner', () => {
    const w = new Grid().floor(-5, 10, -5, 10);
    // A wall along z = 3, x -2..6, two high.
    for (let x = -2; x <= 6; x++) w.pillar(x, 3, 1, 2);
    const { path } = findPath(w, [2, 1, 0], [2, 1, 6]);
    expect(path).not.toBeNull();
    expectConnected([2, 1, 0], path!);
    for (const [x, , z] of path!) expect(z === 3 && x >= -2 && x <= 6).toBe(false);
    // Every diagonal step has both sides open.
    let [px, , pz] = [2, 1, 0];
    for (const [x, , z] of path!) {
      if (x !== px && z !== pz) {
        expect(w.getBlock(x, 1, pz)).toBe(Block.Air);
        expect(w.getBlock(px, 1, z)).toBe(Block.Air);
      }
      px = x;
      pz = z;
    }
  });

  it('climb a step as high as they can, and no higher', () => {
    // Ground at y = 1 for x < 5, a terrace two blocks higher from x = 5: feet at 3 there.
    const w = new Grid().floor(0, 4, 0, 0);
    for (let x = 5; x <= 8; x++) w.pillar(x, 0, 0, 2);
    expect(findPath(w, [0, 1, 0], [7, 3, 0], { step: 1 }).path).toBeNull();
    const goat = findPath(w, [0, 1, 0], [7, 3, 0], { step: 2 }).path;
    expect(goat).not.toBeNull();
    expect(goat![4]).toEqual([5, 3, 0]); // straight up the two blocks
    // A one-block step is fine for anyone.
    const low = new Grid().floor(0, 4, 0, 0);
    for (let x = 5; x <= 8; x++) low.pillar(x, 0, 0, 1);
    expect(findPath(low, [0, 1, 0], [7, 2, 0], { step: 1 }).path).not.toBeNull();
  });

  it('need room over their heads to jump up a step', () => {
    const w = new Grid().floor(0, 4, 0, 0);
    for (let x = 5; x <= 8; x++) w.pillar(x, 0, 0, 1);
    w.set(4, 2, 0, Block.Stone); // a ceiling just over the foot of the step
    expect(findPath(w, [0, 1, 0], [7, 2, 0], { step: 1 }).path).toBeNull();
  });

  it('drop as far as they may, and not off a cliff', () => {
    // A ledge at feet 6, ground at feet 3 (a drop of 3) and at feet 1 (a drop of 5).
    const w = new Grid();
    for (let x = 0; x <= 2; x++) w.pillar(x, 0, 0, 5);
    for (let x = 3; x <= 6; x++) w.pillar(x, 0, 0, 2);
    expect(findPath(w, [0, 6, 0], [5, 3, 0], { drop: 3 }).path).not.toBeNull();
    const cliff = new Grid();
    for (let x = 0; x <= 2; x++) cliff.pillar(x, 0, 0, 5);
    cliff.floor(3, 6, 0, 0);
    expect(findPath(cliff, [0, 6, 0], [5, 1, 0], { drop: 3 }).path).toBeNull();
    expect(findPath(cliff, [0, 6, 0], [5, 1, 0], { drop: 5 }).path).not.toBeNull();
  });

  it('go round a lake rather than through it, and swim across when there is no other way', () => {
    // A pond in the middle of a field: water at y 1 over x 3..7, z -2..2, its bed at y 0.
    const field = new Grid().floor(-1, 11, -6, 6);
    for (let x = 3; x <= 7; x++) for (let z = -2; z <= 2; z++) field.set(x, 0, z, Block.Water).set(x, -1, z, Block.Stone);
    const round = findPath(field, [0, 1, 0], [10, 1, 0], { swim: true }).path!;
    expect(round).not.toBeNull();
    for (const [x, y, z] of round) expect(field.getBlock(x, y - 1, z)).not.toBe(Block.Water);
    // A river right across, from z -6 to 6: swim, or no way at all.
    const river = new Grid().floor(-1, 11, -6, 6);
    for (let x = 3; x <= 7; x++) for (let z = -6; z <= 6; z++) river.set(x, 0, z, Block.Water).set(x, 1, z, Block.Water).set(x, -1, z, Block.Stone);
    expect(findPath(river, [0, 1, 0], [10, 1, 0], { swim: false }).path).toBeNull();
    const across = findPath(river, [0, 1, 0], [10, 1, 0], { swim: true }).path;
    expect(across).not.toBeNull();
    expect(across!.some(([x, y, z]) => river.getBlock(x, y, z) === Block.Water)).toBe(true);
  });

  it('give up within their limits when there is no way, and arrive near when asked', () => {
    // The goal is on a pillar no one can climb.
    const w = new Grid().floor(-30, 30, -30, 30).pillar(5, 5, 1, 6);
    const none = findPath(w, [0, 1, 0], [5, 8, 5], { maxNodes: 500 });
    expect(none.path).toBeNull();
    expect(none.expanded).toBeLessThanOrEqual(500);
    // Out of range.
    expect(findPath(w, [0, 1, 0], [28, 1, 0], { range: 24 }).path).toBeNull();
    // Near: next to the pillar will do.
    const near = findPath(w, [0, 1, 0], [5, 1, 5], { near: 1.5 }).path;
    expect(near).not.toBeNull();
    const [x, , z] = near!.at(-1)!;
    expect(Math.max(Math.abs(x - 5), Math.abs(z - 5))).toBeLessThanOrEqual(1);
  });

  it('fit their height: a tall mob does not go under a low roof a short one does', () => {
    const w = new Grid().floor(0, 10, -1, 1);
    // A tunnel at x 3..6 with a roof at y 2: one block of room.
    for (let x = 3; x <= 6; x++) {
      for (const z of [-1, 1]) w.pillar(x, z, 1, 2);
      w.set(x, 2, 0, Block.Stone);
    }
    expect(findPath(w, [0, 1, 0], [9, 1, 0], { height: 1 }).path).not.toBeNull();
    expect(findPath(w, [0, 1, 0], [9, 1, 0], { height: 2 }).path).toBeNull();
  });

  it('are the same every time', () => {
    const w = new Grid().floor(-10, 10, -10, 10);
    for (let x = -5; x <= 5; x += 2) w.pillar(x, 0, 1, 1);
    const a = findPath(w, [-8, 1, -3], [8, 1, 4]);
    const b = findPath(w, [-8, 1, -3], [8, 1, 4]);
    expect(a).toEqual(b);
  });
});
