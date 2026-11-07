import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { settable } from '../src/net/hostWorld';
import { dropsOf, rightTool } from '../src/survival/drops';
import { bed, bedOf, BED_HEIGHT, Block, BLOCKS, chest, door, doorOf, doorSide, FACINGS, logicPlacement, PANEL, wheat, wheatStage } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { pairPlacement, partnerOf } from '../src/world/parts';
import { createBody, moveBody, overlapsBlock } from '../src/world/physics';
import { raycast } from '../src/world/raycast';
import { Chunk, World } from '../src/world/world';
import { Grid } from './grid';

/** Yaws looking along +x, -x, +z and -z (FACINGS order). */
const LOOK = [-Math.PI / 2, Math.PI / 2, Math.PI, 0];

/** A world with empty (all-air) chunks at the given chunk coordinates. */
function emptyWorld(...coords: [number, number, number][]): World {
  const world = new World(1);
  for (const [cx, cy, cz] of coords) {
    const c = new Chunk(cx, cy, cz, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
  }
  return world;
}

/** Each triangle's normal against the way out from `centre`: all positive if they face outwards. */
function outwards(positions: Float32Array, indices: Uint16Array | Uint32Array, centre: number[]): boolean {
  for (let i = 0; i < indices.length; i += 3) {
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((a) => positions[indices[i + k] * 3 + a]));
    const e1 = p[1].map((v, a) => v - p[0][a]);
    const e2 = p[2].map((v, a) => v - p[0][a]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const mid = [0, 1, 2].map((a) => (p[0][a] + p[1][a] + p[2][a]) / 3 - centre[a]);
    if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] <= 0) return false;
  }
  return true;
}

describe('the homes blocks', () => {
  it('give each door, bed, chest and wheat state an id that reads back', () => {
    for (let f = 0; f < 4; f++) {
      for (const open of [false, true]) for (const upper of [false, true]) expect(doorOf(door(f, open, upper))).toEqual({ facing: f, open, upper });
      for (const head of [false, true]) expect(bedOf(bed(f, head))).toEqual({ facing: f, head });
    }
    for (let s = 0; s < 8; s++) expect(wheatStage(wheat(s))).toBe(s);
    expect(doorOf(Block.Bed)).toBe(null);
    expect(bedOf(Block.Farmland)).toBe(null);
    expect(wheatStage(Block.Farmland)).toBe(-1);
    expect(Block.Slab).toBe(Block.Wheat + 8);
  });

  it("puts a closed door's panel on the side nearest the player, and swings it open to their left", () => {
    // Looking along +x: closed against -x; open, the hinge on the left (-z).
    expect(FACINGS[doorSide(0, false)]).toEqual([-1, 0]);
    expect(FACINGS[doorSide(0, true)]).toEqual([0, -1]);
    // Looking along +z: closed against -z; open against +x (the left, looking along +z).
    expect(FACINGS[doorSide(2, false)]).toEqual([0, -1]);
    expect(FACINGS[doorSide(2, true)]).toEqual([1, 0]);
    expect(BLOCKS[door(0, false, false)].boxes).toEqual([[0, 0, 0, PANEL, 1, 1]]);
    expect(BLOCKS[bed(1, true)].boxes).toEqual([[0, 0, 0, 1, BED_HEIGHT, 1]]);
  });

  it('places a chest with its front to the player', () => {
    expect(logicPlacement(Block.Chest, 1, LOOK[0])).toBe(chest(1));
    expect(logicPlacement(Block.Chest, 0, LOOK[3])).toBe(chest(2));
  });
});

describe('collision with boxes', () => {
  // A closed door at x = 5 placed looking along +x: its panel from x = 5 to 5 + 3/16.
  const doorWorld = (open: boolean) => new Grid().floor(-5, 15, -5, 5).set(5, 1, 0, door(0, open, false)).set(5, 2, 0, door(0, open, true));

  it("stops at a closed door's panel, not at its block", () => {
    const world = doorWorld(false);
    // From the far side, going -x: against the panel's back, inside the door's block.
    const body = createBody(8.5, 1, 0.5);
    moveBody(body, -5, 0, 0, world);
    expect(body.x).toBeCloseTo(5 + PANEL + 0.3, 6);
    // From the near side, going +x: against its front (the block's side, as a wall).
    const near = createBody(2.5, 1, 0.5);
    moveBody(near, 5, 0, 0, world);
    expect(near.x).toBeCloseTo(5 - 0.3, 6);
  });

  it('walks through an open door beside its panel', () => {
    const world = doorWorld(true);
    // Open, the panel lies along the -z side (z from 0 to 3/16); a body at z = 0.5 passes it.
    const body = createBody(2.5, 1, 0.5);
    moveBody(body, 6, 0, 0, world);
    expect(body.x).toBeCloseTo(8.5, 6);
    // Squeezed against the panel's side, it stops at it.
    const side = createBody(5.5, 1, 1.5);
    moveBody(side, 0, 0, -2, world);
    expect(side.z).toBeCloseTo(PANEL + 0.3, 6);
  });

  it('stands on a bed at its height, and walks off it', () => {
    const world = new Grid().floor(-5, 5, -5, 5).set(0, 1, 0, bed(0, false)).set(1, 1, 0, bed(0, true));
    const body = createBody(0.5, 3, 0.5);
    const hits = moveBody(body, 0, -3, 0, world);
    expect(hits.y).toBe(true);
    expect(body.y).toBeCloseTo(1 + BED_HEIGHT, 6);
    // Walking across it stays on it, then steps off the end into the air beyond (and falls to the floor).
    moveBody(body, 0, 0, 3, world);
    expect(body.z).toBeCloseTo(3.5, 6);
    moveBody(body, 0, -1, 0, world);
    expect(body.y).toBeCloseTo(1, 6);
    // A bed ahead stops a body walking into it at its side.
    const beside = createBody(-1.5, 1, 0.5);
    moveBody(beside, 2, 0, 0, world);
    expect(beside.x).toBeCloseTo(-0.3, 6);
  });

  it("overlaps a door's block only where its panel is, for placing", () => {
    const closed = door(0, false, false);
    expect(overlapsBlock(createBody(5.6, 1, 0.5), 5, 1, 0, closed)).toBe(false);
    expect(overlapsBlock(createBody(5.4, 1, 0.5), 5, 1, 0, closed)).toBe(true);
    expect(overlapsBlock(createBody(5.6, 1, 0.5), 5, 1, 0)).toBe(true);
  });
});

describe('the raycast and boxes', () => {
  it("passes through a door's block beside its panel and hits what's behind, and hits the panel with its face", () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, door(0, false, false));
    world.setBlock(8, 40, 5, Block.Stone);
    // Along +x at z = 5.5 from x = 7: towards the door from its far side.
    const back = raycast(world, { x: 7.9, y: 40.5, z: 5.5 }, { x: -1, y: 0, z: 0 }, 6);
    expect(back).toMatchObject({ x: 5, y: 40, z: 5, nx: 1, ny: 0, nz: 0 });
    expect(back!.distance).toBeCloseTo(7.9 - 5 - PANEL, 6);
    // Along -z inside the door's block past its panel: through to nothing.
    const along = raycast(world, { x: 5.5, y: 40.5, z: 7.5 }, { x: 0, y: 0, z: -1 }, 6);
    expect(along).toBe(null);
    // From the near side, going +x through the panel's thin front onto it.
    const front = raycast(world, { x: 3.5, y: 40.5, z: 5.5 }, { x: 1, y: 0, z: 0 }, 6);
    expect(front).toMatchObject({ x: 5, nx: -1 });
  });

  it("hits a bed's top at its height, and passes over it", () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, bed(0, false));
    const down = raycast(world, { x: 5.5, y: 42, z: 5.5 }, { x: 0, y: -1, z: 0 }, 5);
    expect(down).toMatchObject({ x: 5, y: 40, z: 5, ny: 1 });
    expect(down!.distance).toBeCloseTo(42 - 40 - BED_HEIGHT, 6);
    const over = raycast(world, { x: 3.5, y: 40.8, z: 5.5 }, { x: 1, y: 0, z: 0 }, 5);
    expect(over).toBe(null);
  });
});

describe('meshing the homes blocks', () => {
  it('draws a door as its panel (6 quads, facing out), turned by facing and open', () => {
    for (const [block, lo, hi] of [
      [door(0, false, false), [5, 40, 5], [5 + PANEL, 41, 6]],
      [door(0, true, false), [5, 40, 5], [6, 41, 5 + PANEL]],
      [door(2, true, true), [6 - PANEL, 40, 5], [6, 41, 6]],
    ] as const) {
      const world = emptyWorld([0, 1, 0]);
      world.setBlock(5, 40, 5, block);
      const m = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
      expect(m.quads).toBe(6);
      const p = m.opaque.positions;
      for (let a = 0; a < 3; a++) {
        const vs = Array.from({ length: p.length / 3 }, (_, k) => p[k * 3 + a]);
        expect(Math.min(...vs)).toBeCloseTo(lo[a], 5);
        expect(Math.max(...vs)).toBeCloseTo(hi[a], 5);
      }
      expect(outwards(p, m.opaque.indices, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2])).toBe(true);
    }
  });

  it('draws a bed as a slab half a block high, hiding its bottom on a floor and its sides against walls', () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 40, 5, bed(0, false));
    const lone = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
    expect(lone.quads).toBe(6);
    expect(Math.max(...lone.opaque.positions.filter((_, k) => k % 3 === 1))).toBeCloseTo(40 + BED_HEIGHT, 5);
    expect(outwards(lone.opaque.positions, lone.opaque.indices, [5.5, 40 + BED_HEIGHT / 2, 5.5])).toBe(true);
    // Its sides show the texture's bottom half: v from 0 at the floor to 4 eighths at the top
    // (texture coordinates are whole bytes; fractions of v only in eighths).
    const { positions, uvl } = lone.opaque;
    let sides = 0;
    for (let q = 0; q < positions.length / 12; q++) {
      const ys = [0, 1, 2, 3].map((k) => positions[(q * 4 + k) * 3 + 1]);
      // A side: its corners at more than one height.
      if (Math.min(...ys) === Math.max(...ys)) continue;
      sides++;
      for (let k = 0; k < 4; k++) {
        const v = q * 4 + k;
        expect(uvl[v * 4 + 1] + uvl[v * 4 + 3] / 8).toBeCloseTo(ys[k] - 40, 5);
      }
    }
    expect(sides).toBe(4);
    world.setBlock(5, 39, 5, Block.Stone);
    world.setBlock(4, 40, 5, Block.Stone);
    // The bed: its top and three sides. The stones keep all 6 faces each: a bed isn't opaque, so
    // the faces against it are drawn (under it, and behind its half).
    const m = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
    expect(m.quads).toBe(4 + 6 + 6);
  });

  it('draws wheat as two crossed sheets seen from both sides, in the cutout pass, without hiding the farmland', () => {
    const world = emptyWorld([0, 1, 0]);
    world.setBlock(5, 39, 5, Block.Farmland);
    world.setBlock(5, 40, 5, wheat(3));
    const m = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
    // Farmland's 6 faces (wheat doesn't hide its top) and the wheat's 4.
    expect(m.quads).toBe(6 + 4);
    expect(m.cutout.indices.length).toBe(4 * 6);
  });
});

describe('blocks in pairs', () => {
  const ground = () => new Grid().floor(-5, 5, -5, 5);

  it('places a door as both halves on a floor, facing the way the player looks, and not without room or floor', () => {
    const world = ground();
    expect(pairPlacement(world, Block.Door, 0, 1, 0, LOOK[2])).toEqual([
      [0, 1, 0, door(2, false, false)],
      [0, 2, 0, door(2, false, true)],
    ]);
    world.set(0, 2, 0, Block.Stone);
    expect(pairPlacement(world, Block.Door, 0, 1, 0, LOOK[2])).toBe(null);
    // In the air: no floor.
    expect(pairPlacement(ground(), Block.Door, 0, 3, 0, LOOK[2])).toBe(null);
  });

  it('places a bed foot first with its head the way the player looks, both on the floor', () => {
    const world = ground();
    expect(pairPlacement(world, Block.Bed, 0, 1, 0, LOOK[1])).toEqual([
      [0, 1, 0, bed(1, false)],
      [-1, 1, 0, bed(1, true)],
    ]);
    // The head would hang over a hole.
    world.set(-1, 0, 0, Block.Air);
    expect(pairPlacement(world, Block.Bed, 0, 1, 0, LOOK[1])).toBe(null);
    // Something where the head goes.
    expect(pairPlacement(ground().set(0, 1, 1, Block.Stone), Block.Bed, 0, 1, 0, LOOK[2])).toBe(null);
  });

  it("finds a half's other half, and not a different door's or bed's", () => {
    const world = ground().set(0, 1, 0, door(1, false, false)).set(0, 2, 0, door(1, false, true));
    expect(partnerOf(world, 0, 1, 0)).toEqual([0, 2, 0]);
    expect(partnerOf(world, 0, 2, 0)).toEqual([0, 1, 0]);
    // Opened, the halves still go together (both are set open).
    world.set(0, 1, 0, door(1, true, false)).set(0, 2, 0, door(1, true, true));
    expect(partnerOf(world, 0, 1, 0)).toEqual([0, 2, 0]);
    // A lone upper half over another door's upper: no partner.
    world.set(3, 1, 0, door(1, false, true)).set(3, 2, 0, door(1, false, true));
    expect(partnerOf(world, 3, 2, 0)).toBe(null);
    world.set(2, 1, 2, bed(3, false)).set(2, 1, 1, bed(3, true));
    expect(partnerOf(world, 2, 1, 2)).toEqual([2, 1, 1]);
    expect(partnerOf(world, 2, 1, 1)).toEqual([2, 1, 2]);
    expect(partnerOf(world, 0, 0, 0)).toBe(null);
  });
});

describe('the homes blocks in survival and together', () => {
  it('give one of themselves from either half or any facing, farmland its dirt, dug with the right tools', () => {
    expect(dropsOf(door(3, true, true), undefined, 0)).toEqual([[Block.Door, 1]]);
    expect(dropsOf(bed(2, true), undefined, 0)).toEqual([[Block.Bed, 1]]);
    expect(dropsOf(chest(3), undefined, 0)).toEqual([[Block.Chest, 1]]);
    expect(dropsOf(Block.Farmland, undefined, 0)).toEqual([[Block.Dirt, 1]]);
    expect(rightTool(door(1, false, false))).toBe('axe');
    expect(rightTool(chest(2))).toBe('axe');
    expect(rightTool(Block.Farmland)).toBe('spade');
  });

  it('let a guest set them as placed (any facing, both halves), and not a door open', () => {
    for (let f = 0; f < 4; f++) {
      expect(settable(chest(f))).toBe(true);
      expect(settable(door(f, false, false))).toBe(true);
      expect(settable(door(f, false, true))).toBe(true);
      expect(settable(bed(f, true))).toBe(true);
      expect(settable(door(f, true, false))).toBe(false);
    }
    expect(settable(wheat(7))).toBe(false);
  });
});
