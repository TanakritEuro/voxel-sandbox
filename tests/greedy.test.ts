import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createRng } from '../src/math';
import type { MeshData } from '../src/mesh/builder';
import { meshCulled } from '../src/mesh/culled';
import { type ChunkMesh, meshChunk, SHADE } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { Block, BLOCKS } from '../src/world/blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { SURFACE_ONLY } from '../src/world/generate';
import { Chunk, World } from '../src/world/world';

type Vec = [number, number, number];

/** One quad of a mesh: its four corners in order, colours, and how it was triangulated. */
interface Quad {
  corners: Vec[];
  colours: Vec[];
  /** The two corner numbers (0–3) the triangles share. */
  diagonal: [number, number];
  /** Axis the quad faces along and the sign of its normal (from the winding). */
  axis: number;
  sign: number;
  pass: 'opaque' | 'transparent';
}

function quadsOf(data: MeshData, pass: Quad['pass']): Quad[] {
  const out: Quad[] = [];
  const vertex = (i: number): Vec => [data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2]];
  for (let t = 0; t < data.indices.length; t += 6) {
    const idx = [...data.indices.subarray(t, t + 6)];
    const base = Math.min(...idx);
    const corners = [0, 1, 2, 3].map((k) => vertex(base + k));
    const colours = [0, 1, 2, 3].map((k): Vec => [data.colors[(base + k) * 4], data.colors[(base + k) * 4 + 1], data.colors[(base + k) * 4 + 2]]);
    const first = idx.slice(0, 3);
    const shared = idx.slice(3).filter((i) => first.includes(i)).map((i) => i - base);
    const axis = [0, 1, 2].find((a) => corners.every((c) => c[a] === corners[0][a]))!;
    const e1 = corners[1].map((v, a) => v - corners[0][a]);
    const e2 = corners[2].map((v, a) => v - corners[0][a]);
    const normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    out.push({ corners, colours, diagonal: [shared[0], shared[1]], axis, sign: Math.sign(normal[axis]), pass });
  }
  return out;
}

const quadsOfMesh = (m: ChunkMesh) => [...quadsOf(m.opaque, 'opaque'), ...quadsOf(m.transparent, 'transparent')];

const otherAxes = (axis: number): [number, number] => [(axis + 1) % 3, (axis + 2) % 3];

/** Every unit face a quad covers, as the solid block behind it and the face direction. */
function unitFaces(q: Quad): { block: Vec; key: string }[] {
  const [a1, a2] = otherAxes(q.axis);
  const lo = (a: number) => Math.min(...q.corners.map((c) => c[a]));
  const hi = (a: number) => Math.max(...q.corners.map((c) => c[a]));
  const out: { block: Vec; key: string }[] = [];
  for (let p1 = lo(a1); p1 < hi(a1); p1++) {
    for (let p2 = lo(a2); p2 < hi(a2); p2++) {
      const block: Vec = [0, 0, 0];
      block[q.axis] = q.corners[0][q.axis] - (q.sign > 0 ? 1 : 0);
      block[a1] = p1;
      block[a2] = p2;
      out.push({ block, key: `${q.pass} ${q.axis}${q.sign > 0 ? '+' : '-'} ${block.join(',')}` });
    }
  }
  return out;
}

/** Unit faces of a whole mesh; fails if any face is covered twice. */
function faceSet(m: ChunkMesh): Set<string> {
  const keys = quadsOfMesh(m).flatMap((q) => unitFaces(q).map((f) => f.key));
  const set = new Set(keys);
  expect(set.size).toBe(keys.length);
  return set;
}

const opaqueAt = (world: World, p: Vec): number => (BLOCKS[world.getBlock(p[0], p[1], p[2])].opaque ? 1 : 0);
const add = (p: Vec, axis: number, by: number): Vec => {
  const r: Vec = [...p];
  r[axis] += by;
  return r;
};

/**
 * Check every quad against the world, independently of the mesher: it faces away from its
 * block, each unit face inside it has the AO and the light (of the block in front) the quad's
 * corner colours say (so faces with different AO or light were not merged), and it's split
 * along the darker diagonal.
 */
function checkAgainstWorld(world: World, m: ChunkMesh): void {
  for (const q of quadsOfMesh(m)) {
    const [a1, a2] = otherAxes(q.axis);
    const centre = [0, 1, 2].map((a) => q.corners.reduce((s, c) => s + c[a], 0) / 4);
    const dir = q.axis * 2 + (q.sign > 0 ? 0 : 1);
    let levels: number[] | null = null;
    for (const { block } of unitFaces(q)) {
      const b = world.getBlock(...block);
      const front = add(block, q.axis, q.sign);
      const nb = world.getBlock(...front);
      // Winding: the block behind the face is solid and the face is visible from the front.
      expect(b).not.toBe(Block.Air);
      expect(nb === Block.Air || (!BLOCKS[nb].opaque && (nb !== b || BLOCKS[b].cutout))).toBe(true);

      const faceLevels = q.corners.map((c) => {
        if (BLOCKS[b].transparent) return 3;
        const s1 = add(front, a1, Math.sign(c[a1] - centre[a1]));
        const s2 = add(front, a2, Math.sign(c[a2] - centre[a2]));
        const side1 = opaqueAt(world, s1);
        const side2 = opaqueAt(world, s2);
        const corner = opaqueAt(world, add(s1, a2, Math.sign(c[a2] - centre[a2])));
        return side1 && side2 ? 0 : 3 - side1 - side2 - corner;
      });
      if (levels) expect(faceLevels).toEqual(levels);
      levels = faceLevels;

      // Directional shade × AO, then sunlight and block light, each 0–15 as 0–255.
      const light = world.getLight(...front);
      const expected = faceLevels.map((l) => [Math.round(SHADE[dir] * TUNING.render.ao[l] * 255), (light >> 4) * 17, (light & 15) * 17]);
      expect(q.colours).toEqual(expected);
    }
    const l = levels!;
    const [i, j] = q.diagonal;
    expect(Math.abs(i - j)).toBe(2);
    const other = i === 0 || i === 2 ? [1, 3] : [0, 2];
    expect(l[i] + l[j]).toBeLessThanOrEqual(l[other[0]] + l[other[1]]);
  }
}

const mesh = (world: World, cx: number, cy: number, cz: number) => meshChunk(paddedBlocks(world, cx, cy, cz), cx, cy, cz, paddedLight(world, cx, cy, cz));
const culled = (world: World, cx: number, cy: number, cz: number) => meshCulled(paddedBlocks(world, cx, cy, cz), cx, cy, cz);

/** A world whose chunk (0, 1, 0) and all its neighbours are filled by `fill` (block for a world position). */
function worldOf(fill: (x: number, y: number, z: number) => Block): World {
  const world = new World(1);
  for (let cy = 0; cy <= 2; cy++)
    for (let cz = -1; cz <= 1; cz++)
      for (let cx = -1; cx <= 1; cx++) {
        const blocks = new Uint8Array(CHUNK_VOLUME);
        for (let y = 0; y < CHUNK_SIZE; y++)
          for (let z = 0; z < CHUNK_SIZE; z++)
            for (let x = 0; x < CHUNK_SIZE; x++)
              blocks[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x] = fill(cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y, cz * CHUNK_SIZE + z);
        const c = new Chunk(cx, cy, cz, blocks);
        world.chunks.set(c.key, c);
      }
  return world;
}

/** Random blocks of every kind; `density` of cells non-air. */
function soup(seed: number, density: number): World {
  const rng = createRng(seed);
  return worldOf(() => (rng() < density ? 1 + Math.floor(rng() * (BLOCKS.length - 1)) : Block.Air));
}

describe('greedy mesher', () => {
  it('draws exactly the faces the culled mesher draws, each once', () => {
    const cases: [string, World, Vec][] = [
      ['empty', worldOf(() => Block.Air), [0, 1, 0]],
      ['full', worldOf(() => Block.Stone), [0, 1, 0]],
      ['sparse soup', soup(1, 0.1), [0, 1, 0]],
      ['dense soup', soup(2, 0.6), [0, 1, 0]],
      ['blocky soup', worldOf((x, y, z) => ((x >> 2) + (y >> 3) + (z >> 2)) % 3 === 0 ? Block.Stone : (x * y + z) % 7 === 0 ? Block.Water : Block.Air), [0, 1, 0]],
    ];
    const terrain = new World(20261022);
    for (let cz = -1; cz <= 2; cz++) for (let cx = -1; cx <= 2; cx++) terrain.ensureColumn(cx, cz);
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
      cases.push([`terrain 0,${cy},0`, terrain, [0, cy, 0]]);
      cases.push([`terrain 1,${cy},1`, terrain, [1, cy, 1]]);
    }
    for (const [name, world, [cx, cy, cz]] of cases) {
      expect([...faceSet(mesh(world, cx, cy, cz))].sort(), name).toEqual([...faceSet(culled(world, cx, cy, cz))].sort());
    }
  });

  it('gets AO, merging, winding and the diagonal right on terrain and block soups', () => {
    const terrain = new World(20261022);
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) terrain.ensureColumn(cx, cz);
    for (let cy = MIN_CHUNK_Y; cy <= 2; cy++) checkAgainstWorld(terrain, mesh(terrain, 0, cy, 0));
    checkAgainstWorld(soup(3, 0.3), mesh(soup(3, 0.3), 0, 1, 0));
    const steps = worldOf((x, y, z) => (y < 40 + ((x + z) >> 2) % 5 ? Block.Stone : y < 44 ? Block.Water : Block.Air));
    checkAgainstWorld(steps, mesh(steps, 0, 1, 0));
  });

  it('merges a flat slab into one quad per side', () => {
    const world = worldOf((_x, y) => (y === 40 ? Block.Stone : Block.Air));
    // The slab crosses the chunk; inside it, top and bottom are whole chunk-sized quads and the
    // sides are covered by neighbours, so 2 quads.
    expect(mesh(world, 0, 1, 0).quads).toBe(2);
    const alone = new World(1);
    const c = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
    alone.chunks.set(c.key, c);
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) alone.setBlock(x, 40, z, Block.Stone);
    expect(mesh(alone, 0, 1, 0).quads).toBe(6);
  });

  it('does not merge different blocks', () => {
    const world = worldOf((x, y, z) => (y === 40 ? ((x + z) % 2 ? Block.Stone : Block.Dirt) : Block.Air));
    expect(mesh(world, 0, 1, 0).quads).toBe(culled(world, 0, 1, 0).quads);
  });

  it('darkens the corners next to a block standing on a floor', () => {
    const world = worldOf((_x, y) => (y === 40 ? Block.Stone : Block.Air));
    world.setBlock(10, 41, 10, Block.Stone);
    const m = mesh(world, 0, 1, 0);
    const top = quadsOf(m.opaque, 'opaque').filter((q) => q.axis === 1 && q.sign > 0 && q.corners[0][1] === 41);
    const bright = 255;
    const level = (q: Quad, x: number, z: number) => {
      const k = q.corners.findIndex((c) => c[0] === x && c[2] === z);
      return k < 0 ? null : TUNING.render.ao.indexOf(TUNING.render.ao.find((a) => Math.round(a * 255) === q.colours[k][0])!);
    };
    // The floor face east of the block: its two corners against the block have one solid side (level 2).
    const east = top.find((q) => q.corners.some((c) => c[0] === 11 && c[2] === 10) && q.corners.some((c) => c[0] === 12 && c[2] === 11) && unitFaces(q).length === 1)!;
    expect(east).toBeDefined();
    expect(level(east, 11, 10)).toBe(2);
    expect(level(east, 11, 11)).toBe(2);
    expect(level(east, 12, 10)).toBe(3);
    // The floor face diagonal to it: only the corner touching the block's edge is darkened, by the diagonal (level 2).
    const diag = top.find((q) => unitFaces(q).length === 1 && q.corners.some((c) => c[0] === 11 && c[2] === 11) && q.corners.some((c) => c[0] === 12 && c[2] === 12))!;
    expect(level(diag, 11, 11)).toBe(2);
    expect(level(diag, 12, 12)).toBe(3);
    // A lone dark corner: split along the diagonal through it.
    const k = diag.corners.findIndex((c) => c[0] === 11 && c[2] === 11);
    expect(diag.diagonal).toContain(k);
    // Far from the block the floor is one bright merged quad.
    expect(top.some((q) => unitFaces(q).length > 100 && q.colours.every((c) => c[0] === bright))).toBe(true);
  });

  it('puts an inside corner at the darkest level', () => {
    // An L of two walls on a floor: the floor corner in the L has both sides solid.
    const world = worldOf((x, y, z) => (y === 40 || (y === 41 && (x === 5 || z === 5)) ? Block.Stone : Block.Air));
    checkAgainstWorld(world, mesh(world, 0, 1, 0));
    const q = quadsOf(mesh(world, 0, 1, 0).opaque, 'opaque').find(
      (q) => q.axis === 1 && q.sign > 0 && unitFaces(q).some((f) => f.block.join() === '6,40,6') && unitFaces(q).length === 1,
    )!;
    const k = q.corners.findIndex((c) => c[0] === 6 && c[2] === 6);
    expect(q.colours[k][0]).toBe(Math.round(TUNING.render.ao[0] * 255));
  });

  it('takes AO from the neighbouring chunks, including diagonal ones', () => {
    // A floor across chunk corners with blocks standing just over the borders.
    const world = worldOf((_x, y) => (y === 40 ? Block.Stone : Block.Air));
    world.setBlock(32, 41, 32, Block.Stone); // in chunk (1, 1, 1), diagonal to (0, 1, 0)
    world.setBlock(-1, 41, 10, Block.Stone); // in chunk (-1, 1, 0)
    world.setBlock(10, 41, -1, Block.Stone); // in chunk (0, 1, -1)
    const m = mesh(world, 0, 1, 0);
    checkAgainstWorld(world, m);
    const corner = quadsOf(m.opaque, 'opaque').find((q) => q.axis === 1 && q.sign > 0 && unitFaces(q).some((f) => f.block.join() === '31,40,31'))!;
    const k = corner.corners.findIndex((c) => c[0] === 32 && c[2] === 32);
    expect(corner.colours[k][0]).toBe(Math.round(TUNING.render.ao[2] * 255));
  });

  // Per-vertex AO keeps faces with different corner shading apart, which on stepped terrain
  // costs about half the merging (radius 8: 4.8x fewer opaque quads without AO, 2.45x with).
  it('cuts triangles on generated terrain to under half of culled faces', () => {
    // Surface only: what the mesher makes of it, not how rugged caves make the walls
    // (with caves and ores, greedy quads are 0.61 of culled faces).
    const terrain = new World(20261022, SURFACE_ONLY);
    for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) terrain.ensureColumn(cx, cz);
    let greedy = 0;
    let faces = 0;
    for (let cz = -1; cz <= 1; cz++)
      for (let cx = -1; cx <= 1; cx++)
        for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
          greedy += mesh(terrain, cx, cy, cz).quads;
          faces += culled(terrain, cx, cy, cz).quads;
        }
    expect(greedy).toBeLessThan(faces / 2);
  });
});

describe('edits', () => {
  it('mark all 7 neighbours stale at a chunk corner', () => {
    const world = new World(1);
    for (let cy = 1; cy <= 2; cy++) for (let cz = 0; cz <= 1; cz++) for (let cx = 0; cx <= 1; cx++) world.ensureChunk(cx, cy, cz);
    const stale = world.setBlock(31, 63, 31, Block.Stone).map((c) => c.key).sort();
    expect(stale).toEqual(['0,1,0', '0,1,1', '0,2,0', '0,2,1', '1,1,0', '1,1,1', '1,2,0', '1,2,1']);
    expect(world.setBlock(31, 50, 31, Block.Dirt).map((c) => c.key).sort()).toEqual(['0,1,0', '0,1,1', '1,1,0', '1,1,1']);
  });
});
