import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { createMob } from '../src/mobs/brain';
import { MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { findPath } from '../src/mobs/pathfind';
import { GroundItems } from '../src/survival/ground';
import { Health } from '../src/survival/health';
import { Item } from '../src/survival/items';
import { Block, BLOCKS, isWater } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { LAVA_LEVEL } from '../src/world/deep';
import { findNearest } from '../src/world/find';
import { Generator } from '../src/world/generate';
import { LAVA, LiquidFlow, type LiquidWorld } from '../src/world/liquids';
import { createBody, liquidAt, NO_INPUT, stepPlayer, touchesLava } from '../src/world/physics';
import { Chunk, World } from '../src/world/world';
import { Grid } from './grid';

class Land extends Grid implements LiquidWorld {
  hasColumn(): boolean {
    return true;
  }
}

/** Tick both liquids until nothing changes, each change waking the other, as the game does; the ticks. */
function settle(land: Land, flows: LiquidFlow[], most = 500): number {
  for (let t = 1; t <= most; t++) {
    let changed = 0;
    for (const f of flows) {
      const changes = f.tick(land);
      for (const [x, y, z, b] of changes) {
        land.set(x, y, z, b);
        for (const g of flows) if (g !== f) g.wake(x, y, z);
      }
      changed += changes.length;
    }
    if (!changed && flows.every((f) => !f.pending)) return t;
  }
  throw new Error('never settled');
}

function put(land: Land, flows: LiquidFlow[], x: number, y: number, z: number, b: Block): void {
  land.set(x, y, z, b);
  for (const f of flows) f.wake(x, y, z);
}

describe('lava', () => {
  it('spreads 3 blocks on flat ground, in levels 3 down to 1, and stops', () => {
    const land = new Land().floor(-10, 10, -10, 10, 10);
    const lava = new LiquidFlow(LAVA);
    put(land, [lava], 0, 10, 0, Block.Lava);
    settle(land, [lava]);
    for (let z = -5; z <= 5; z++)
      for (let x = -5; x <= 5; x++) {
        const d = Math.abs(x) + Math.abs(z);
        const want = d === 0 ? Block.Lava : d <= 3 ? ((Block.LavaFlow1 + 3 - d) as Block) : Block.Air;
        expect(land.getBlock(x, 10, z), `${x},${z}`).toBe(want);
      }
    // Ticked half as often as water, and looking half as far for a drop.
    expect(TUNING.lava.tickSeconds).toBe(TUNING.water.tickSeconds * 2);
    expect(TUNING.lava.dropSearch).toBeLessThan(TUNING.water.dropSearch);
  });

  it('spills from a deep lake into a tunnel dug into its side, as a deep lake of water does', () => {
    for (const [source, flow1, levels] of [
      [Block.Lava, Block.LavaFlow1, 3],
      [Block.Water, Block.WaterFlow1, 7],
    ] as const) {
      // A lake 3 deep (y 8–10) over x -5..0, walled by rock; a tunnel dug east from it at y 9, one block high.
      const land = new Land().floor(-6, 12, -3, 3, 8);
      for (let x = -6; x <= 12; x++) for (let z = -3; z <= 3; z++) for (let y = 8; y <= 11; y++) land.set(x, y, z, x <= 0 && y <= 10 ? source : Block.Stone);
      const flows = [new LiquidFlow(), new LiquidFlow(LAVA)];
      for (let x = 1; x <= 8; x++) put(land, flows, x, 9, 0, Block.Air);
      settle(land, flows);
      // It runs along the tunnel as far as it spreads, falling a level a block.
      for (let x = 1; x <= 8; x++) expect(land.getBlock(x, 9, 0), `${BLOCKS[source].name} at ${x}`).toBe(x <= levels ? ((flow1 + levels - x) as Block) : Block.Air);
    }
  });

    it('falls off a ledge as falling lava and spreads again below', () => {
    const lava = new LiquidFlow(LAVA);
    const ledge = new Land().floor(-6, 6, -6, 6, 5).floor(-6, 0, -6, 6, 10);
    put(ledge, [lava], 0, 10, 0, Block.Lava);
    settle(ledge, [lava]);
    for (let y = 5; y <= 9; y++) expect(ledge.getBlock(1, y, 0), `y ${y}`).toBe(Block.LavaFalling);
    expect(ledge.getBlock(2, 5, 0)).toBe(Block.LavaFlow3);
  });

  it('turns to basalt as a source and to stone flowing where it meets water, and water never flows into it', () => {
    const land = new Land().floor(-10, 10, -10, 10, 10);
    const water = new LiquidFlow();
    const lava = new LiquidFlow(LAVA);
    const flows = [water, lava];
    // A lava source, and water poured beside it (where its lava flowed) and a little way off.
    put(land, flows, 0, 10, 0, Block.Lava);
    settle(land, flows);
    put(land, flows, 1, 10, 0, Block.Water);
    put(land, flows, -3, 10, 0, Block.Water);
    settle(land, flows);
    expect(land.getBlock(0, 10, 0)).toBe(Block.Basalt);
    // The flowing lava round it turned to stone wherever water reached it; no lava is left next to water.
    let stone = 0;
    for (let z = -5; z <= 5; z++)
      for (let x = -5; x <= 5; x++) {
        const b = land.getBlock(x, 10, z);
        if (b === Block.Stone) stone++;
        if (BLOCKS[b].lava)
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            expect(isWater(land.getBlock(x + dx, 10, z + dz))).toBe(false);
      }
    expect(stone).toBeGreaterThan(0);
    // Water poured on top of a lava source turns it to basalt too.
    const pool = new Land().floor(-3, 3, -3, 3, 10);
    put(pool, flows, 0, 10, 0, Block.Lava);
    settle(pool, flows);
    put(pool, flows, 0, 12, 0, Block.Water);
    settle(pool, flows);
    expect(pool.getBlock(0, 10, 0)).toBe(Block.Basalt);
  });

  it('gives light 15, and is a liquid that is not water', () => {
    const world = new World(1);
    const c = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
    for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) world.setBlock(x, 63, z, Block.Stone);
    world.setBlock(10, 40, 10, Block.Lava);
    expect(world.getLight(10, 41, 10) & 15).toBe(14);
    expect(world.getLight(13, 40, 10) & 15).toBe(12);
    expect(BLOCKS[Block.Lava].light).toBe(15);
    expect([BLOCKS[Block.Lava].liquid, isWater(Block.Lava), isWater(Block.WaterFlow3)]).toEqual([true, false, true]);
  });

  it('is drawn in the opaque pass, not the transparent one', () => {
    const world = new World(1);
    const c = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
    world.setBlock(5, 40, 5, Block.Lava);
    world.setBlock(9, 40, 5, Block.LavaFlow2);
    const m = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0, paddedLight(world, 0, 1, 0));
    expect(m.transparent.indices.length).toBe(0);
    // A full block's six faces and the flowing one's top, sides and bottom.
    expect(m.opaque.indices.length / 6).toBe(12);
  });

  it('is swum in at half the speed of water, and the eye in it knows it', () => {
    const pool = (liquid: Block) => {
      const g = new Grid().floor(-2, 40, -3, 3, 10);
      for (let x = -2; x <= 40; x++) for (let z = -3; z <= 3; z++) for (let y = 10; y < 14; y++) g.set(x, y, z, liquid);
      return g;
    };
    const swim = (liquid: Block) => {
      const world = pool(liquid);
      const body = createBody(0.5, 11, 0.5);
      for (let t = 0; t < 240; t++) stepPlayer(body, { ...NO_INPUT, forward: 1, yaw: -Math.PI / 2 }, world);
      return { x: body.x, lava: touchesLava(body, world), inLava: body.inLava, eye: liquidAt(world, body.x, 12.5, body.z) };
    };
    const water = swim(Block.Water);
    const lava = swim(Block.Lava);
    expect(water.lava).toBe(false);
    expect([lava.lava, lava.inLava, lava.eye, water.eye]).toEqual([true, true, 2, 1]);
    expect((lava.x - 0.5) / (water.x - 0.5)).toBeCloseTo(TUNING.lava.swimSpeed, 1);
  });

  it('burns: 4 points at once and every half second in it, then a point a half second for 3 s out of it, put out by water', () => {
    const still = { y: 10, onGround: true, inWater: false, flying: false, eyeInWater: false, touchingCactus: false };
    const h = new Health();
    expect(h.step(0.01, { ...still, inWater: true, inLava: true })).toBe(4);
    expect(h.cause).toBe('burning');
    // Half a second more in it (60 frames a second): another 4.
    let lost = 0;
    for (let t = 0; t < 30; t++) lost += h.step(1 / 60, { ...still, inWater: true, inLava: true });
    expect(lost).toBe(4);
    // Out of it: burning on for 3 s, a point each half second, then not.
    expect(h.burning).toBe(TUNING.lava.after);
    lost = 0;
    for (let t = 0; t < 240; t++) lost += h.step(1 / 60, still);
    expect(lost).toBe(6);
    expect(h.burning).toBe(0);
    // Into water while burning: put out at once.
    const w = new Health();
    w.step(0.01, { ...still, inWater: true, inLava: true });
    lost = 0;
    for (let t = 0; t < 240; t++) lost += w.step(1 / 60, { ...still, inWater: true });
    expect([lost, w.burning]).toEqual([0, 0]);
  });

  it('burns up items on the ground in it, falling in or lying where it flows', () => {
    const world = new Grid().floor(-4, 4, -4, 4, 1);
    for (let x = 2; x <= 4; x++) for (let z = -4; z <= 4; z++) world.set(x, 1, z, Block.Lava);
    const ground = new GroundItems();
    ground.drop(3.5, 3, 0.5, { item: Item.Coal, count: 3 });
    ground.drop(-2.5, 1.5, 0.5, { item: Item.Coal, count: 1 });
    for (let t = 0; t < 120; t++) ground.update(1 / 60, world, () => true, [], () => 0);
    expect(ground.items.length).toBe(1);
    expect(ground.takeBurned().length).toBe(1);
    // The other, asleep on the floor, when lava flows over it.
    world.set(-3, 1, 0, Block.LavaFlow2);
    for (let t = 0; t < 120; t++) ground.update(1 / 60, world, () => true, [], () => 0);
    expect(ground.items.length).toBe(0);
    expect(ground.takeBurned().length).toBe(1);
  });

  it('is found by ?find=lava: a rock shore just above a lava lake, in version 3 only', () => {
    const g3 = new Generator(20261022, { generation: 3 });
    const at = findNearest(g3, 'lava', 0, 0)!;
    expect(at.y).toBe(LAVA_LEVEL + 1);
    const cave = (x: number, y: number, z: number) => g3.caves.carvedAt(x, y, z, g3.caveLimitAt(x, z));
    expect([cave(at.x, at.y!, at.z), cave(at.x, at.y! + 1, at.z), cave(at.x, LAVA_LEVEL, at.z)]).toEqual([true, true, false]);
    // And the lake's lava really is there, in the generated chunk.
    const chunks = g3.generateColumn(Math.floor(at.x / 32), Math.floor(at.z / 32), 0, 0);
    let lava = 0;
    for (const b of chunks[0]!) if (b === Block.Lava) lava++;
    expect(lava).toBeGreaterThan(0);
    expect(findNearest(new Generator(20261022, { generation: 2 }), 'lava', 0, 0)).toBe(null);
  });

  it('is never in a path: a mob swims across water but not lava', () => {
    const across = (liquid: Block) => {
      // A channel right across, two deep, on a bed at y -1.
      const g = new Grid().floor(-2, 8, -3, 3, 1);
      for (let x = 3; x <= 4; x++) for (let z = -3; z <= 3; z++) g.set(x, 0, z, liquid).set(x, 1, z, liquid).set(x, -1, z, Block.Stone);
      return findPath(g, [0, 1, 0], [6, 1, 0], { swim: true }).path;
    };
    expect(across(Block.Water)).not.toBeNull();
    expect(across(Block.Lava)).toBeNull();
  });

  it('hurts a mob in it every half second until it is gone', () => {
    // A pool of lava two deep high in the air over loaded land.
    const world = new World(5);
    world.ensureColumn(0, 0);
    for (let x = 0; x < 32; x++)
      for (let z = 0; z < 32; z++) {
        world.setBlock(x, 199, z, Block.Stone);
        world.setBlock(x, 200, z, Block.Lava);
        world.setBlock(x, 201, z, Block.Lava);
      }
    const m = new MobManager(world, 1, 0);
    const mob = createMob(1, MobKind.Mossback, 16.5, 200, 16.5, 1);
    m.mobs.push(mob);
    m.update(0.1, [[16, 16]], 1);
    expect(mob.hits).toBeGreaterThan(0);
    for (let t = 0; t < 100 && m.mobs.length; t++) m.update(0.1, [[16, 16]], 1);
    expect(m.mobs.length).toBe(0);
  });
});
