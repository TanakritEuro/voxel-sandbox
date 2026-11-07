import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { findPath } from '../src/mobs/pathfind';
import { canMake, RECIPES } from '../src/survival/crafting';
import { dropsOf, rightTool } from '../src/survival/drops';
import { Inventory } from '../src/survival/inventory';
import { Item } from '../src/survival/items';
import { Block, slab } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { createBody, moveBody, NO_INPUT, stepPlayer } from '../src/world/physics';
import { raycast } from '../src/world/raycast';
import { blockBoxes, connectedBoxes, joinsAt } from '../src/world/shapes';
import { Chunk, World } from '../src/world/world';
import { Grid } from './grid';

/** A world with empty (all-air) chunks at the given chunk coordinates. */
function emptyWorld(...coords: [number, number, number][]): World {
  const world = new World(1);
  for (const [cx, cy, cz] of coords) {
    const c = new Chunk(cx, cy, cz, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
  }
  return world;
}

describe('fences and panes joining', () => {
  it('join their own kind and whole solid blocks, and not air, slabs or the other kind', () => {
    const g = new Grid().set(0, 1, 0, Block.Fence).set(1, 1, 0, Block.Fence).set(-1, 1, 0, Block.Stone).set(0, 1, 1, slab(0, false)).set(0, 1, -1, Block.Pane);
    // +x a fence, -x stone: bits 1 and 2.
    expect(joinsAt(g, 'fence', 0, 1, 0)).toBe(3);
    const p = new Grid().set(0, 1, 0, Block.Pane).set(0, 1, 1, Block.Pane).set(1, 1, 0, Block.Fence).set(0, 1, -1, Block.Glass);
    // +z a pane; not the fence (+x) or glass (-z, not opaque).
    expect(joinsAt(p, 'pane', 0, 1, 0)).toBe(4);
  });

  it('are a post or a sheet with arms to the sides they join', () => {
    expect(connectedBoxes('fence', 0)).toEqual([[6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16]]);
    // Joined along +x: the post and two rails.
    const joined = connectedBoxes('fence', 1);
    expect(joined.length).toBe(3);
    expect(joined[1]).toEqual([9 / 16, 6 / 16, 7 / 16, 1, 9 / 16, 9 / 16]);
    // Bumped into: 1.5 high, a bar to the side.
    expect(connectedBoxes('fence', 1, true)).toEqual([
      [6 / 16, 0, 6 / 16, 10 / 16, 1.5, 10 / 16],
      [10 / 16, 0, 6 / 16, 1, 1.5, 10 / 16],
    ]);
    // A pane on its own is a cross; joined along x, a sheet along x.
    expect(connectedBoxes('pane', 0).length).toBe(5);
    expect(connectedBoxes('pane', 3).length).toBe(3);
  });
});

describe('colliding with fences and panes', () => {
  /** A floor, and a fence along z = 0 from x -3 to 3. */
  const fenced = () => {
    const g = new Grid().floor(-6, 6, -6, 6);
    for (let x = -3; x <= 3; x++) g.set(x, 1, 0, Block.Fence);
    return g;
  };

  it("can't be jumped: walking and jumping at it, the body stays on its side", () => {
    const g = fenced();
    const body = createBody(0.5, 1, -1.5);
    for (let i = 0; i < 240; i++) stepPlayer(body, { ...NO_INPUT, forward: 1, yaw: Math.PI, jump: true }, g);
    // Looking along +z: stopped at the bar's face (z 6/16), less half its width.
    expect(body.z).toBeLessThanOrEqual(6 / 16 - 0.3 + 1e-6);
  });

  it('is stood on at 1.5, and reaches up into the block above it from below', () => {
    const g = fenced();
    const body = createBody(0.5, 4, 0.5);
    moveBody(body, 0, -4, 0, g);
    expect(body.y).toBeCloseTo(2.5, 6);
    // Standing on a block beside the fence, one higher than the fence's own block, walking at it:
    // stopped by the half block it reaches above its own (here its bar to that block, at z 0).
    const raised = fenced().set(0, 1, -1, Block.Stone);
    const up = createBody(0.5, 2, -1.5);
    moveBody(up, 0, 0, 2, raised);
    expect(up.z).toBeCloseTo(-0.3, 6);
  });

  it('lets a body between two posts that stand apart, and not through where they join', () => {
    const apart = new Grid().floor(-6, 6, -6, 6).set(-1, 1, 0, Block.Fence).set(1, 1, 0, Block.Fence);
    const body = createBody(0.5, 1, -2.5);
    moveBody(body, 0, 0, 5, apart);
    expect(body.z).toBeCloseTo(2.5, 6);
    const joined = new Grid().floor(-6, 6, -6, 6).set(-1, 1, 0, Block.Fence).set(0, 1, 0, Block.Fence).set(1, 1, 0, Block.Fence);
    const stopped = createBody(0.5, 1, -2.5);
    moveBody(stopped, 0, 0, 5, joined);
    expect(stopped.z).toBeCloseTo(6 / 16 - 0.3, 6);
  });

  it("stops a body at a pane's sheet", () => {
    const g = new Grid().floor(-6, 6, -6, 6);
    for (let x = -3; x <= 3; x++) g.set(x, 1, 0, Block.Pane);
    const body = createBody(0.5, 1, 2.5);
    moveBody(body, 0, 0, -5, g);
    expect(body.z).toBeCloseTo(9 / 16 + 0.3, 6);
  });
});

describe('fences, panes and the raycast and mesher', () => {
  it("hits a fence's post, and passes beside it", () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, Block.Fence);
    const hit = raycast(world, { x: 3.5, y: 40.5, z: 5.5 }, { x: 1, y: 0, z: 0 }, 5)!;
    expect(hit).toMatchObject({ x: 5, nx: -1 });
    expect(hit.px).toBeCloseTo(5 + 6 / 16, 6);
    expect(raycast(world, { x: 3.5, y: 40.5, z: 5.1 }, { x: 1, y: 0, z: 0 }, 5)).toBe(null);
    expect(blockBoxes(world, 5, 40, 5)!.length).toBe(1);
  });

  it('draws a lone fence as its post, and rails to a fence beside it across a chunk border', () => {
    const world = emptyWorld([0, 1, 0], [1, 1, 0]);
    world.setBlock(31, 40, 5, Block.Fence);
    const lone = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
    expect(lone.quads).toBe(6);
    world.setBlock(32, 40, 5, Block.Fence);
    // The one at x 31: its post and two rails towards x 32, in the next chunk.
    expect(meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0).quads).toBe(6 + 12);
    expect(meshChunk(paddedBlocks(world, 1, 1, 0), 1, 1, 0).quads).toBe(6 + 12);
  });

  it('draws a pane with the glass, a lone one as a cross with the faces between its parts left out', () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, Block.Pane);
    const m = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
    expect(m.opaque.indices.length).toBe(0);
    // The middle's top and bottom, and each arm's 5 faces.
    expect(m.transparent.indices.length).toBe((2 + 4 * 5) * 6);
  });
});

describe('fences and panes for mobs, in survival', () => {
  it("keep mobs out: no path over a fence, a way through a gap", () => {
    const g = new Grid().floor(-10, 10, -10, 10);
    for (let x = -10; x <= 10; x++) g.set(x, 1, 3, Block.Fence);
    expect(findPath(g, [0, 1, 0], [0, 1, 6]).path).toBeNull();
    g.set(4, 1, 3, Block.Air);
    expect(findPath(g, [0, 1, 0], [0, 1, 6]).path).not.toBeNull();
  });

  it('are made 3 fences from 4 planks and 2 sticks, 16 panes from 6 glass; a fence gives itself, a pane nothing', () => {
    const fences = RECIPES.find((r) => r.makes === Block.Fence)!;
    expect([fences.count, fences.cost]).toEqual([3, [[Block.Planks, 4], [Item.Stick, 2]]]);
    const panes = RECIPES.find((r) => r.makes === Block.Pane)!;
    expect([panes.count, panes.cost]).toEqual([16, [[Block.Glass, 6]]]);
    const pack = new Inventory();
    pack.add(Block.Planks, 4);
    pack.add(Item.Stick, 1);
    expect(canMake(pack, fences)).toBe(false);
    expect(dropsOf(Block.Fence, undefined, 0)).toEqual([[Block.Fence, 1]]);
    expect(dropsOf(Block.Pane, undefined, 0)).toEqual([]);
    expect(rightTool(Block.Fence)).toBe('axe');
  });
});
