import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { type GroundItem, GroundItems, type Picker } from '../src/survival/ground';
import { Item } from '../src/survival/items';
import { Block } from '../src/world/blocks';
import { Grid } from './grid';

const G = TUNING.survival.ground;
const everywhere = () => true;

/** Run `seconds` at 60 frames a second; `take` as the game's, by default taking everything. */
function run(ground: GroundItems, world: Grid, seconds: number, players: Picker[] = [], take: (g: GroundItem) => number = () => 0, loaded: (x: number, z: number) => boolean = everywhere) {
  for (let t = 0; t < seconds * 60; t++) ground.update(1 / 60, world, loaded, players, take);
}

describe('items on the ground', () => {
  it('fall and come to rest on the floor, and fall again when it goes', () => {
    const world = new Grid().floor(-4, 4, -4, 4, 1);
    const ground = new GroundItems();
    const g = ground.drop(0.5, 6, 0.5, { item: Block.Dirt, count: 1 }, 1.5, 3, 0);
    run(ground, world, 3);
    expect(g.body.y).toBeCloseTo(1, 5);
    expect(g.body.onGround).toBe(true);
    expect(g.asleep).toBe(true);
    // It slid a little, and stopped.
    expect(g.body.x).toBeGreaterThan(0.6);
    expect(g.body.x).toBeLessThan(2.5);
    const x = g.body.x;
    run(ground, world, 1);
    expect(g.body.x).toBe(x);
    // The block under it broken: it wakes and falls into the hole.
    const under = Math.floor(g.body.x);
    world.set(under, 0, 0, Block.Air);
    world.set(under, -1, 0, Block.Stone);
    run(ground, world, 2);
    expect(g.body.y).toBeCloseTo(0, 5);
  });

  it('float at the top of water', () => {
    const world = new Grid().floor(-4, 4, -4, 4, 1);
    for (let y = 1; y <= 3; y++) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) world.set(x, y, z, Block.Water);
    const ground = new GroundItems();
    const g = ground.drop(0.5, 8, 0.5, { item: Item.Stick, count: 1 });
    run(ground, world, 8);
    expect(g.body.y).toBeGreaterThan(3.3);
    expect(g.body.y).toBeLessThan(4.1);
    expect(g.asleep).toBe(false);
  });

  it('merge with the same item lying close, up to a full stack; not other items or tools', () => {
    const world = new Grid().floor(-4, 4, -4, 4, 1);
    const ground = new GroundItems();
    ground.drop(0.5, 1.2, 0.5, { item: Block.Dirt, count: 40 });
    ground.drop(0.9, 1.2, 0.6, { item: Block.Dirt, count: 30 });
    ground.drop(0.7, 1.2, 0.4, { item: Block.Sand, count: 5 });
    ground.drop(0.6, 1.2, 0.5, { item: Item.WoodPick, count: 1 });
    ground.drop(0.6, 1.2, 0.5, { item: Item.WoodPick, count: 1 });
    ground.drop(3.5, 1.2, 3.5, { item: Block.Dirt, count: 3 }); // too far
    run(ground, world, 1);
    const counts = ground.items.map((g) => [g.item, g.count]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(counts).toEqual([
      [Block.Dirt, 3],
      [Block.Dirt, 6],
      [Block.Dirt, 64],
      [Block.Sand, 5],
      [Item.WoodPick, 1],
      [Item.WoodPick, 1],
    ]);
  });

  it('are picked up within 1.5 blocks of a player, not further, nor while a thrown one waits', () => {
    const world = new Grid().floor(-8, 8, -8, 8, 1);
    const ground = new GroundItems();
    ground.drop(1.5, 1.2, 0.5, { item: Block.Dirt, count: 3 });
    const far = ground.drop(4.5, 1.2, 0.5, { item: Block.Sand, count: 1 });
    const thrown = ground.drop(-0.5, 1.2, 0.5, { item: Block.Gravel, count: 1 }, 0, 0, 0, G.throwDelay);
    const taken: number[] = [];
    run(ground, world, 0.5, [{ x: 0.5, y: 1, z: 0.5 }], (g) => {
      taken.push(g.item);
      return 0;
    });
    expect(taken).toEqual([Block.Dirt]);
    expect(ground.items).toEqual([far, thrown]);
    run(ground, world, 1, [{ x: 0.5, y: 1, z: 0.5 }], (g) => {
      taken.push(g.item);
      return 0;
    });
    expect(taken).toEqual([Block.Dirt, Block.Gravel]);
    expect(ground.items).toEqual([far]);
  });

  it('are in reach at the bottom of a hole just dug, from its edge', () => {
    const world = new Grid().floor(-4, 4, -4, 4, 1);
    world.set(1, 0, 0, Block.Air).set(1, -1, 0, Block.Stone);
    const ground = new GroundItems();
    const g = ground.drop(1.5, 0.5, 0.5, { item: Block.Dirt, count: 1 }, 0, 3, 0);
    run(ground, world, 0.6);
    expect(g.body.y).toBeCloseTo(0, 5); // lying in the hole
    const taken: number[] = [];
    run(ground, world, 0.1, [{ x: 0.5, y: 1, z: 0.5 }], (it) => {
      taken.push(it.item);
      return 0;
    });
    expect(taken).toEqual([Block.Dirt]);
  });

  it('stay as they are when there is no room, and lose what was taken', () => {
    const world = new Grid().floor(-4, 4, -4, 4, 1);
    const ground = new GroundItems();
    const g = ground.drop(0.5, 1.2, 0.5, { item: Block.Dirt, count: 10 });
    run(ground, world, 0.5, [{ x: 0.5, y: 1, z: 0.5 }], (it) => it.count);
    expect(ground.items).toEqual([g]);
    expect(g.count).toBe(10);
    run(ground, world, 0.1, [{ x: 0.5, y: 1, z: 0.5 }], () => 4); // room for 6
    expect(g.count).toBe(4);
  });

  it('are gone after 5 minutes, or when their land unloads', () => {
    const world = new Grid().floor(-4, 4, -4, 4, 1);
    const ground = new GroundItems();
    ground.drop(0.5, 1.2, 0.5, { item: Block.Dirt, count: 1 });
    run(ground, world, G.life - 1);
    expect(ground.items.length).toBe(1);
    run(ground, world, 2);
    expect(ground.items.length).toBe(0);
    ground.drop(0.5, 1.2, 0.5, { item: Block.Dirt, count: 1 });
    run(ground, world, 0.1, [], () => 0, (x) => x < 0);
    expect(ground.items.length).toBe(0);
  });

  it('keep to the cap, the oldest going first', () => {
    const ground = new GroundItems();
    const first = ground.drop(0.5, 50, 0.5, { item: Block.Dirt, count: 1 });
    const world = new Grid();
    run(ground, world, 0.1);
    for (let i = 0; i < G.cap; i++) ground.drop(i, 50, 0, { item: Block.Sand, count: 1 });
    expect(ground.items.length).toBe(G.cap);
    expect(ground.items).not.toContain(first);
  });
});
