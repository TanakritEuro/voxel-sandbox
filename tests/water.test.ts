import { describe, expect, it } from 'vitest';
import { Block } from '../src/world/blocks';
import { flowing, flowLevel, WaterFlow, type WaterWorld } from '../src/world/water';
import { Grid } from './grid';

/** A grid that is loaded everywhere (or where `loaded` says). */
class Land extends Grid implements WaterWorld {
  constructor(private readonly loaded: (cx: number, cz: number) => boolean = () => true) {
    super();
  }
  hasColumn(cx: number, cz: number): boolean {
    return this.loaded(cx, cz);
  }
}

/** Tick until nothing changes (applying each tick's changes); the ticks it took. */
function settle(land: Land, flow: WaterFlow, budget?: number, most = 500): number {
  for (let t = 1; t <= most; t++) {
    const changes = flow.tick(land, budget);
    for (const [x, y, z, b] of changes) land.set(x, y, z, b);
    if (!changes.length && !flow.pending) return t;
  }
  throw new Error('water never settled');
}

/** Put a block and wake the water around it, as an edit in the game does. */
function edit(land: Land, flow: WaterFlow, x: number, y: number, z: number, b: Block): void {
  land.set(x, y, z, b);
  flow.wake(x, y, z);
}

/** Every water block in the box, as "x,y,z" → block, for comparing worlds. */
function waterIn(land: Land, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Map<string, Block> {
  const out = new Map<string, Block>();
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const b = land.getBlock(x, y, z);
        if (b === Block.Water || b === Block.WaterFalling || flowLevel(b)) out.set(`${x},${y},${z}`, b);
      }
  return out;
}

describe('flowing water', () => {
  it('spreads from a source on flat ground in a diamond of levels 7 down to 1, and stops', () => {
    const land = new Land().floor(-20, 20, -20, 20, 10);
    const flow = new WaterFlow();
    edit(land, flow, 0, 10, 0, Block.Water);
    settle(land, flow);
    for (let z = -10; z <= 10; z++) {
      for (let x = -10; x <= 10; x++) {
        const d = Math.abs(x) + Math.abs(z);
        const want = d === 0 ? Block.Water : d <= 7 ? flowing(8 - d) : Block.Air;
        expect(land.getBlock(x, 10, z), `${x},${z}`).toBe(want);
      }
    }
    // Nothing above or below it.
    expect(waterIn(land, -10, 10, 11, 12, -10, 10).size).toBe(0);
  });

  it('runs towards the nearest drop, falls, and spreads again at the bottom', () => {
    // A ledge (top at y = 11) for x ≤ 2, the ground (top at y = 1) everywhere.
    const land = new Land().floor(-30, 30, -30, 30, 1);
    for (let x = -30; x <= 2; x++) for (let z = -30; z <= 30; z++) for (let y = 1; y <= 10; y++) land.set(x, y, z, Block.Stone);
    const flow = new WaterFlow();
    edit(land, flow, 0, 11, 0, Block.Water);
    settle(land, flow);
    // Along the ledge towards the edge only: not back the other way, not sideways.
    expect(land.getBlock(1, 11, 0)).toBe(flowing(7));
    expect(land.getBlock(2, 11, 0)).toBe(flowing(6));
    expect(land.getBlock(-1, 11, 0)).toBe(Block.Air);
    expect(land.getBlock(0, 11, 1)).toBe(Block.Air);
    // Over the edge: flowing at 5, then a falling column down to the ground.
    expect(land.getBlock(3, 11, 0)).toBe(flowing(5));
    for (let y = 1; y <= 10; y++) expect(land.getBlock(3, y, 0), `y ${y}`).toBe(Block.WaterFalling);
    // At the bottom it spreads again, away from the cliff, as from a source.
    expect(land.getBlock(4, 1, 0)).toBe(flowing(7));
    expect(land.getBlock(10, 1, 0)).toBe(flowing(1));
    expect(land.getBlock(11, 1, 0)).toBe(Block.Air);
    expect(land.getBlock(3, 1, 3)).toBe(flowing(5));
  });

  it('drains away completely when its source is taken', () => {
    const land = new Land().floor(-20, 20, -20, 20, 10);
    const flow = new WaterFlow();
    edit(land, flow, 0, 10, 0, Block.Water);
    settle(land, flow);
    edit(land, flow, 0, 10, 0, Block.Air);
    settle(land, flow);
    expect(waterIn(land, -10, 10, 9, 12, -10, 10).size).toBe(0);
  });

  it('makes a new source between two sources on solid ground, and not over air', () => {
    // A trench one wide along x: walls at z = ±1.
    const land = new Land().floor(-5, 5, -5, 5, 10);
    for (let x = -5; x <= 5; x++) land.set(x, 10, 1, Block.Stone).set(x, 10, -1, Block.Stone);
    const flow = new WaterFlow();
    edit(land, flow, -1, 10, 0, Block.Water);
    edit(land, flow, 1, 10, 0, Block.Water);
    settle(land, flow);
    expect(land.getBlock(0, 10, 0)).toBe(Block.Water);
    // Over a hole it stays flowing (and falls).
    const open = new Land().floor(-5, 5, -5, 5, 10);
    open.set(0, 9, 0, Block.Air);
    const flow2 = new WaterFlow();
    edit(open, flow2, -1, 10, 0, Block.Water);
    edit(open, flow2, 1, 10, 0, Block.Water);
    settle(open, flow2);
    expect(open.getBlock(0, 10, 0)).not.toBe(Block.Water);
    expect(open.getBlock(0, 9, 0)).toBe(Block.WaterFalling);
  });

  it('stops at solid blocks and washes torches away', () => {
    const land = new Land().floor(-20, 20, -20, 20, 10);
    // A wall across at x = 2, and a torch at (-2, 10, 0).
    for (let z = -20; z <= 20; z++) land.set(2, 10, z, Block.Stone);
    land.set(-2, 10, 0, Block.Torch);
    const flow = new WaterFlow();
    edit(land, flow, 0, 10, 0, Block.Water);
    settle(land, flow);
    expect(waterIn(land, 2, 20, 10, 10, -20, 20).size).toBe(0);
    expect(land.getBlock(-2, 10, 0)).toBe(flowing(6));
  });

  it("treats land that isn't loaded as a wall", () => {
    // Columns with x ≥ 0 (blocks 0 and up) aren't loaded.
    const land = new Land((cx) => cx < 0).floor(-40, 40, -10, 10, 10);
    const flow = new WaterFlow();
    edit(land, flow, -2, 10, 0, Block.Water);
    settle(land, flow);
    expect(land.getBlock(-1, 10, 0)).toBe(flowing(7));
    expect(waterIn(land, 0, 40, 9, 11, -10, 10).size).toBe(0);
  });

  it('leaves still water still: a pool of sources does nothing', () => {
    const land = new Land().floor(-6, 6, -6, 6, 10);
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) land.set(x, 10, z, Math.abs(x) === 6 || Math.abs(z) === 6 ? Block.Stone : Block.Water);
    const flow = new WaterFlow();
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) flow.wake(x, 10, z);
    expect(flow.tick(land)).toEqual([]);
    expect(flow.pending).toBe(0);
  });

  it('ends the same however the work is split across ticks', () => {
    const build = () => {
      const land = new Land().floor(-30, 30, -30, 30, 1);
      // Steps down and a couple of pillars in the way.
      for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) for (let y = 1; y <= Math.max(0, 4 - Math.floor((x + 30) / 8)); y++) land.set(x, y, z, Block.Stone);
      land.pillar(-20, 2, 1, 8).pillar(-18, -3, 1, 8);
      return land;
    };
    const whole = build();
    const flowA = new WaterFlow();
    edit(whole, flowA, -25, 5, 0, Block.Water);
    const ticksWhole = settle(whole, flowA);
    const split = build();
    const flowB = new WaterFlow();
    edit(split, flowB, -25, 5, 0, Block.Water);
    const ticksSplit = settle(split, flowB, 5, 5000);
    expect(ticksSplit).toBeGreaterThan(ticksWhole);
    const a = waterIn(whole, -30, 30, 0, 8, -30, 30);
    expect(a.size).toBeGreaterThan(20);
    expect(waterIn(split, -30, 30, 0, 8, -30, 30)).toEqual(a);
  });
});
