import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { BORDER_GROUP, FACE_ORDER, FACE_STARTS, GROUPS, type MeshData, PARTS } from '../src/mesh/builder';
import { type ChunkMesh, meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { Block, slab } from '../src/world/blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { NO_REGION, regionMap } from '../src/world/visibility';
import { Chunk, World } from '../src/world/world';

const S = CHUNK_SIZE;
type Vec = [number, number, number];
const mesh = (world: World, cx: number, cy: number, cz: number, flat = false) =>
  meshChunk(paddedBlocks(world, cx, cy, cz), cx, cy, cz, paddedLight(world, cx, cy, cz), flat);
const passes = (m: ChunkMesh): MeshData[] => [m.opaque, m.cutout, m.transparent];

/** A world whose chunk (0, 1, 0) and all its neighbours are filled by `fill` (block for a world position). */
function worldOf(fill: (x: number, y: number, z: number) => Block): World {
  const world = new World(1);
  for (let cy = 0; cy <= 2; cy++)
    for (let cz = -1; cz <= 1; cz++)
      for (let cx = -1; cx <= 1; cx++) {
        const blocks = new Uint8Array(CHUNK_VOLUME);
        for (let y = 0; y < S; y++)
          for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) blocks[(y * S + z) * S + x] = fill(cx * S + x, cy * S + y, cz * S + z);
        const c = new Chunk(cx, cy, cz, blocks);
        world.chunks.set(c.key, c);
      }
  return world;
}

/** Each quad of a pass with its group and part. */
function* quads(d: MeshData): Generator<{ q: number; group: number; part: number }> {
  for (let group = 0; group < GROUPS; group++)
    for (let part = 0; part < PARTS; part++)
      for (let q = d.faceStarts[group * PARTS + part]; q < d.faceStarts[group * PARTS + part + 1]; q++) yield { q, group, part };
}

const corner = (d: MeshData, q: number, k: number): Vec => [0, 1, 2].map((a) => d.positions[(q * 4 + k) * 3 + a]) as Vec;
/** Direction (+x, -x, +y, -y, +z, -z) as a step. */
const STEP: Vec[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Checks every face on the block grid (parts 0–5) of chunk (cx, cy, cz)'s mesh: each block it
 * covers looks at a block in the quad's group (its region, or across the chunk's face its border
 * group) and never into a pocket. Returns the quads checked.
 */
function checkGroups(world: World, cx: number, cy: number, cz: number): number {
  const map = new Uint8Array(CHUNK_VOLUME);
  regionMap(world.getChunk(cx, cy, cz)!.blocks, map);
  const m = mesh(world, cx, cy, cz);
  let checked = 0;
  for (const d of passes(m)) {
    expect(d.faceStarts).toHaveLength(FACE_STARTS);
    for (const { q, group, part } of quads(d)) {
      if (part === 6) continue;
      const dir = FACE_ORDER[part];
      const axis = dir >> 1;
      const step = STEP[dir];
      const cs = [0, 1, 2, 3].map((k) => corner(d, q, k));
      const [a1, a2] = [(axis + 1) % 3, (axis + 2) % 3];
      const lo = (a: number) => Math.min(...cs.map((c) => c[a]));
      const hi = (a: number) => Math.max(...cs.map((c) => c[a]));
      const plane = cs[0][axis];
      for (let p1 = lo(a1); p1 < hi(a1); p1++)
        for (let p2 = lo(a2); p2 < hi(a2); p2++) {
          const front: Vec = [0, 0, 0];
          front[axis] = step[axis] > 0 ? plane : plane - 1;
          front[a1] = p1;
          front[a2] = p2;
          const local = [front[0] - cx * S, front[1] - cy * S, front[2] - cz * S];
          const outside = local.findIndex((l) => l < 0 || l >= S);
          let want: number;
          if (outside >= 0) want = BORDER_GROUP + outside * 2 + (local[outside] >= S ? 1 : 0);
          else want = map[local[1] * S * S + local[2] * S + local[0]];
          expect(want, `face at ${front} looks into a pocket`).not.toBe(NO_REGION);
          expect(group, `quad ${q} part ${part} at ${front}`).toBe(want);
        }
      checked++;
    }
  }
  return checked;
}

describe('mesh groups', () => {
  it("put every face on generated land in the group it's seen from", () => {
    const world = new World(20261022);
    for (let cz = -1; cz <= 2; cz++) for (let cx = -1; cx <= 2; cx++) world.ensureColumn(cx, cz);
    let checked = 0;
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) checked += checkGroups(world, 0, cy, 0) + checkGroups(world, 1, cy, 1);
    expect(checked).toBeGreaterThan(5000);
  });

  it('do the same for a soup of blocks, merging only within a group', () => {
    const rng = createRng(4);
    const world = worldOf(() => (rng() < 0.45 ? [Block.Stone, Block.Dirt, Block.Glass, Block.Water, Block.Leaves][Math.floor(rng() * 5)] : Block.Air));
    expect(checkGroups(world, 0, 1, 0)).toBeGreaterThan(1000);
  });

  it('put the walls on a chunk face in its border group', () => {
    // Stone below y 32: chunk (0, 0, 0)'s top faces look into the chunk above.
    const world = worldOf((_x, y) => (y < 32 ? Block.Stone : Block.Air));
    const d = mesh(world, 0, 0, 0).opaque;
    const end = d.faceStarts[FACE_STARTS - 1];
    expect(end).toBeGreaterThan(0);
    const up = BORDER_GROUP + 3;
    expect(d.faceStarts[up * PARTS + FACE_ORDER.indexOf(2)]).toBe(0);
    expect(d.faceStarts[up * PARTS + FACE_ORDER.indexOf(2) + 1]).toBe(end);
  });

  it('leave out a pocket, and show it once it opens onto a face of the chunk', () => {
    const hollow = (x: number, y: number, z: number) => x >= 8 && x < 12 && y >= 40 && y < 44 && z >= 8 && z < 12;
    const sealed = worldOf((x, y, z) => (hollow(x, y, z) ? Block.Air : Block.Stone));
    expect(mesh(sealed, 0, 1, 0).quads).toBe(0);
    // A tunnel from it to the chunk's -x face (the chunk beside is stone, so still closed there).
    const opened = worldOf((x, y, z) => (hollow(x, y, z) || (y === 41 && z === 9 && x >= 0 && x < 8) ? Block.Air : Block.Stone));
    const m = mesh(opened, 0, 1, 0);
    expect(m.quads).toBeGreaterThan(6 + 4); // the room's walls and the tunnel's (split where AO and light differ)
    expect(m.opaque.faceStarts[PARTS]).toBe(m.quads); // all in region 0
    expect(checkGroups(opened, 0, 1, 0)).toBe(m.quads);
    // The chunk beside: its wall closing the tunnel looks into region 0 of (0, 1, 0), across its +x face.
    const beside = mesh(opened, -1, 1, 0).opaque.faceStarts;
    const g = BORDER_GROUP + 1;
    expect(beside[g * PARTS + PARTS] - beside[g * PARTS]).toBe(1);
  });

  it('put shapes in their own block\'s region, and leave out those in pockets', () => {
    const world = worldOf((_x, y) => (y < 40 ? Block.Stone : Block.Air));
    world.chunks.get('0,1,0')!.blocks[(8 * S + 5) * S + 5] = slab(0, false); // on the ground (y 40)
    // A torch in a sealed hole in the rock.
    const rock = world.chunks.get('0,1,0')!.blocks;
    rock[(2 * S + 5) * S + 5] = Block.Torch; // y 34, sealed
    const m = mesh(world, 0, 1, 0);
    const shapes = [...quads(m.opaque)].filter((x) => x.part === 6);
    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes.every((x) => x.group === 0)).toBe(true); // the slab: open air, region 0
    // Each shape quad lies in the slab's block: none of the torch's.
    for (const { q } of shapes) for (let k = 0; k < 4; k++) expect(corner(m.opaque, q, k)[1]).toBeGreaterThanOrEqual(40);
  });

  it('put a far chunk in one group', () => {
    const world = new World(20261022);
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
    for (let cy = 0; cy <= 3; cy++) {
      const m = mesh(world, 0, cy, 0, true);
      for (const d of passes(m)) expect(d.faceStarts[PARTS]).toBe(d.faceStarts[FACE_STARTS - 1]);
    }
  });
});
