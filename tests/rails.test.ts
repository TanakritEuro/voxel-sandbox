import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { settable } from '../src/net/hostWorld';
import { RECIPES } from '../src/survival/crafting';
import { dropsOf } from '../src/survival/drops';
import { Item } from '../src/survival/items';
import { Block, BLOCKS, FACINGS, PLACEABLE, poweredRail, rail, RAIL_SHAPES, railOf, torchSupport } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { LogicFlow } from '../src/world/logic';
import { joinedEnds, RAIL_ENDS, RAIL_RISE, railPlacement, shapeWith } from '../src/world/rails';
import { Chunk, World } from '../src/world/world';
import { Grid } from './grid';

/** A grid that's a logic world too: every column loaded. */
class Ground extends Grid {
  hasColumn(): boolean {
    return true;
  }
}

/** Lay rails (`kind`) at `places` in that order on `grid`, as a player would, making each one's changes. */
function lay(grid: Grid, places: readonly [number, number, number][], kind: Block = Block.Rail): void {
  for (const [x, y, z] of places) for (const [px, py, pz, pb] of railPlacement(grid, x, y, z, kind, 0)) grid.set(px, py, pz, pb);
}

const shapeAt = (grid: Grid, x: number, y: number, z: number) => railOf(grid.getBlock(x, y, z))?.shape ?? -1;

/** A rectangle's edge from (x0, z0) to (x1, z1) at height y, going round. */
function ring(x0: number, z0: number, x1: number, z1: number, y = 1): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = x0; x < x1; x++) out.push([x, y, z0]);
  for (let z = z0; z < z1; z++) out.push([x1, y, z]);
  for (let x = x1; x > x0; x--) out.push([x, y, z1]);
  for (let z = z1; z > z0; z--) out.push([x0, y, z]);
  return out;
}

/** `list` in an order from `seed`. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  const rng = createRng(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('rail shapes', () => {
  it('have two ends each, slopes rising towards one of theirs, curves a quarter turn', () => {
    expect(RAIL_ENDS).toHaveLength(RAIL_SHAPES);
    RAIL_ENDS.forEach(([a, b], s) => {
      expect(a).not.toBe(b);
      if (RAIL_RISE[s] >= 0) expect([a, b]).toContain(RAIL_RISE[s]);
      // Straight and sloped rails' ends are opposite; curves' at right angles.
      expect((a ^ 1) === b).toBe(s < 6);
      expect(shapeWith(a, b, RAIL_RISE[s])).toBe(s);
    });
    expect(shapeWith(0, 2, 0)).toBe(-1); // a curve can't slope
    expect(shapeWith(0, 0)).toBe(-1);
  });

  it('are blocks walked through, held up by the block under them, giving the rail back whatever their shape', () => {
    for (let s = 0; s < RAIL_SHAPES; s++) {
      const b = rail(s);
      expect(railOf(b)).toEqual({ shape: s, powered: false, on: false });
      expect(BLOCKS[b].passable).toBe(true);
      expect(BLOCKS[b].cutout).toBe(true);
      expect(torchSupport(b)).toEqual([0, -1, 0]);
      expect(dropsOf(b, undefined, 0)).toEqual([[Block.Rail, 1]]);
    }
    for (let s = 0; s < 6; s++)
      for (const on of [false, true]) {
        expect(railOf(poweredRail(s, on))).toEqual({ shape: s, powered: true, on });
        expect(dropsOf(poweredRail(s, on), undefined, 0)).toEqual([[Block.PoweredRail, 1]]);
      }
    // The picker (and an inventory) has one of each; a guest may set any shape, a powered one only off.
    expect(PLACEABLE.filter((b) => railOf(b))).toEqual([Block.Rail, Block.PoweredRail]);
    expect(settable(rail(7))).toBe(true);
    expect(settable(poweredRail(3, false))).toBe(true);
    expect(settable(poweredRail(3, true))).toBe(false);
  });

  it('are crafted: 16 rails from 6 iron and a stick, 6 powered from 6 iron, a copper and a stick', () => {
    const recipe = (b: Block) => RECIPES.find((r) => r.makes === b)!;
    expect(recipe(Block.Rail)).toMatchObject({ count: 16, cost: [[Item.Iron, 6], [Item.Stick, 1]] });
    expect(recipe(Block.PoweredRail)).toMatchObject({ count: 6, cost: [[Item.Iron, 6], [Item.Copper, 1], [Item.Stick, 1]] });
  });
});

describe('laying rails', () => {
  it('lies along the way the player looks with nothing beside it, and joins one beside it', () => {
    const grid = new Grid().floor(-5, 5, -5, 5);
    expect(railPlacement(grid, 0, 1, 0, Block.Rail, 0)).toEqual([[0, 1, 0, rail(1)]]); // looking along x
    expect(railPlacement(grid, 0, 1, 0, Block.Rail, 3)).toEqual([[0, 1, 0, rail(0)]]);
    lay(grid, [[0, 1, 0]]); // along x
    // Beside it along z: it turns to join the new one (it was joined to nothing).
    expect(railPlacement(grid, 0, 1, 1, Block.Rail, 0)).toEqual([
      [0, 1, 1, rail(0)],
      [0, 1, 0, rail(0)],
    ]);
  });

  it('makes a straight line the same whatever order it is laid in', () => {
    const line: [number, number, number][] = Array.from({ length: 9 }, (_, i) => [i - 4, 1, 0]);
    for (let seed = 1; seed <= 12; seed++) {
      const grid = new Grid().floor(-6, 6, -6, 6);
      lay(grid, shuffled(line, seed));
      expect(line.map(([x, y, z]) => shapeAt(grid, x, y, z))).toEqual(line.map(() => 1));
    }
  });

  it('makes a loop the same whatever order it is laid in: straight sides, curved corners, every end joined', () => {
    const loop = ring(-4, -3, 4, 3);
    let first: number[] | null = null;
    for (let seed = 1; seed <= 20; seed++) {
      const grid = new Grid().floor(-6, 6, -6, 6);
      lay(grid, shuffled(loop, seed));
      const shapes = loop.map(([x, y, z]) => shapeAt(grid, x, y, z));
      first ??= shapes;
      expect(shapes).toEqual(first);
      for (const [x, y, z] of loop) expect(joinedEnds(grid, [x, y, z], shapeAt(grid, x, y, z))).toHaveLength(2);
    }
    // The corners: (-4, -3) joins +x and +z; (4, 3) joins -x and -z.
    const grid = new Grid().floor(-6, 6, -6, 6);
    lay(grid, loop);
    expect(RAIL_ENDS[shapeAt(grid, -4, 1, -3)]).toEqual(expect.arrayContaining([0, 2]));
    expect(RAIL_ENDS[shapeAt(grid, 4, 1, 3)]).toEqual(expect.arrayContaining([1, 3]));
    expect(shapeAt(grid, 0, 1, -3)).toBe(1);
    expect(shapeAt(grid, 4, 1, 0)).toBe(0);
  });

  it('slopes up a block to a rail a block higher, laid either way round', () => {
    for (const order of [0, 1]) {
      // A step: the floor at y 0 for x < 2, a block higher from x 2.
      const grid = new Grid().floor(-4, 1, -2, 2, 1).floor(2, 6, -2, 2, 2);
      const places: [number, number, number][] = [
        [-1, 1, 0],
        [0, 1, 0],
        [1, 1, 0],
        [2, 2, 0],
        [3, 2, 0],
      ];
      lay(grid, order ? [...places].reverse() : places);
      expect(shapeAt(grid, 1, 1, 0)).toBe(2); // rising towards +x
      expect(shapeAt(grid, 0, 1, 0)).toBe(1);
      expect(shapeAt(grid, 2, 2, 0)).toBe(1);
      for (const [x, y, z] of places.slice(1, 4)) expect(joinedEnds(grid, [x, y, z], shapeAt(grid, x, y, z))).toHaveLength(2);
    }
  });

  it("doesn't turn a rail joined at both ends, and doesn't curve powered rails", () => {
    const grid = new Grid().floor(-5, 5, -5, 5);
    lay(grid, [
      [-1, 1, 0],
      [0, 1, 0],
      [1, 1, 0],
    ]);
    // Beside the middle one, which is joined both ways: the middle stays as it is, and the new one,
    // with nothing to join, lies the way the player looks (along x).
    expect(railPlacement(grid, 0, 1, 1, Block.Rail, 0)).toEqual([[0, 1, 1, rail(1)]]);
    // A corner of powered rails: the second can't make the first a curve, so it stays straight.
    const p = new Grid().floor(-5, 5, -5, 5);
    lay(p, [[0, 1, 0], [1, 1, 0], [1, 1, 1]], Block.PoweredRail);
    for (const [x, z] of [[0, 0], [1, 0], [1, 1]]) expect(shapeAt(p, x, 1, z)).toBeLessThan(6);
  });
});

describe('powered rails', () => {
  it('are on while a signal reaches them, as a lamp is lit', () => {
    const grid = new Ground().floor(-5, 5, -5, 5);
    lay(grid, [[0, 1, 0], [1, 1, 0], [2, 1, 0]], Block.PoweredRail);
    grid.set(1, 1, 1, Block.Switch);
    const logic = new LogicFlow();
    const run = () => {
      for (let t = 0; t < 4; t++) for (const [x, y, z, b] of logic.tick(grid)) grid.set(x, y, z, b);
    };
    logic.wake(1, 1, 1);
    run();
    expect(railOf(grid.getBlock(1, 1, 0))!.on).toBe(false);
    grid.set(1, 1, 1, Block.SwitchOn);
    logic.wake(1, 1, 1);
    run();
    // The one beside the switch is on; its shape kept; the others have no signal.
    expect(grid.getBlock(1, 1, 0)).toBe(poweredRail(1, true));
    expect(railOf(grid.getBlock(0, 1, 0))!.on).toBe(false);
    grid.set(1, 1, 1, Block.Switch);
    logic.wake(1, 1, 1);
    run();
    expect(grid.getBlock(1, 1, 0)).toBe(poweredRail(1, false));
    // A charged block under one keeps it on.
    grid.set(2, 0, 0, Block.ChargedBlock);
    logic.wake(2, 0, 0);
    run();
    expect(railOf(grid.getBlock(2, 1, 0))!.on).toBe(true);
  });
});

describe('meshing rails', () => {
  function meshOne(b: Block) {
    const world = new World(1);
    const c = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
    world.setBlock(5, 40, 5, b);
    return meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
  }

  it('draws a rail as one sheet a sixteenth over the floor, in the cutout pass', () => {
    const m = meshOne(rail(0));
    expect(m.quads).toBe(1);
    expect(m.cutout.indices.length).toBe(6);
    expect(m.opaque.indices.length).toBe(0);
    const ys = Array.from({ length: 4 }, (_, k) => m.cutout.positions[k * 3 + 1]);
    for (const y of ys) expect(y).toBeCloseTo(40 + 1 / 16, 5);
  });

  it('draws a slope rising a block towards its high end, seen from under it too', () => {
    for (let rise = 0; rise < 4; rise++) {
      const m = meshOne(rail(2 + rise));
      expect(m.quads).toBe(2);
      const [dx, dz] = FACINGS[rise];
      const p = m.cutout.positions;
      for (let k = 0; k < 4; k++) {
        const x = p[k * 3] - 5;
        const z = p[k * 3 + 2] - 5;
        const along = dx > 0 ? x : dx < 0 ? 1 - x : dz > 0 ? z : 1 - z;
        expect(p[k * 3 + 1]).toBeCloseTo(40 + 1 / 16 + along, 5);
      }
    }
  });
});
