import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { Block, slab } from '../src/world/blocks';
import { CHUNK_SIZE, chunkKey, localIndex, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal } from '../src/world/coords';
import {
  ALL_CONNECTED,
  chunkConnectivity,
  chunkRegions,
  faceCell,
  linksOf,
  MAX_REGIONS,
  NO_REGION,
  OPEN_REGIONS,
  reachableChunks,
  regionMap,
  seeThrough,
  SOLID_REGIONS,
  walkRegions,
} from '../src/world/visibility';
import { World } from '../src/world/world';

const S = CHUNK_SIZE;
const at = (x: number, y: number, z: number) => (y * S + z) * S + x;
const stone = () => new Uint8Array(S * S * S).fill(Block.Stone);
const [NX, PX, NY, PY, NZ, PZ] = [0, 1, 2, 3, 4, 5];
const bit = (...faces: number[]) => faces.reduce((m, f) => m | (1 << f), 0);

describe('regions', () => {
  it('are shared for open air and solid stone', () => {
    expect(chunkRegions(new Uint8Array(S * S * S))).toBe(OPEN_REGIONS);
    expect(chunkRegions(stone())).toBe(SOLID_REGIONS);
  });

  it('number separate tunnels in scan order, with the faces each touches and its blocks on them', () => {
    const c = stone();
    for (let y = 0; y < S; y++) c[at(20, y, 20)] = Block.Air; // up and down: first met at y 0
    for (let x = 0; x < S; x++) c[at(x, 4, 4)] = Block.Air; // along x
    const map = new Uint8Array(S * S * S);
    const r = regionMap(c, map);
    expect(r.count).toBe(2);
    expect([...r.faces]).toEqual([bit(NY, PY), bit(NX, PX)]);
    expect(map[at(20, 9, 20)]).toBe(0);
    expect(map[at(9, 4, 4)]).toBe(1);
    expect(map[at(9, 5, 4)]).toBe(NO_REGION);
    // On the faces: x faces keep (z, y), y faces (x, z).
    expect(r.border[NX * 1024 + faceCell(4, 4)]).toBe(1);
    expect(r.border[PX * 1024 + faceCell(4, 4)]).toBe(1);
    expect(r.border[NX * 1024 + faceCell(5, 4)]).toBe(NO_REGION);
    expect(r.border[PY * 1024 + faceCell(20, 20)]).toBe(0);
    expect(r.border[NZ * 1024 + faceCell(9, 4)]).toBe(NO_REGION);
  });

  it('leave sealed pockets out', () => {
    const c = stone();
    for (let x = 5; x < 10; x++) c[at(x, 10, 10)] = Block.Air;
    const map = new Uint8Array(S * S * S);
    expect(regionMap(c, map)).toBe(SOLID_REGIONS);
    expect(map[at(7, 10, 10)]).toBe(NO_REGION);
    c[at(1, 1, 1)] = Block.Air; // and a pocket beside a tunnel
    for (let z = 0; z < S; z++) c[at(20, 20, z)] = Block.Air;
    const r = regionMap(c, map);
    expect(r.count).toBe(1);
    expect(map[at(7, 10, 10)]).toBe(NO_REGION);
    expect(map[at(20, 20, 3)]).toBe(0);
  });

  it(`keep the ${MAX_REGIONS - 1} largest of more than ${MAX_REGIONS} apart, the rest sharing the last number`, () => {
    // 20 shafts up from the bottom, 1..20 blocks tall, at x = 0, 3, 6, ... (scan order: by x at y 0).
    const c = stone();
    for (let k = 0; k < 20; k++) for (let y = 0; y <= k; y++) c[at((k % 10) * 3, y, k < 10 ? 2 : 20)] = Block.Air;
    const map = new Uint8Array(S * S * S);
    const r = regionMap(c, map);
    expect(r.count).toBe(MAX_REGIONS);
    const shaft = (k: number) => map[at((k % 10) * 3, 0, k < 10 ? 2 : 20)];
    // The 11 tallest (9..19) numbered in scan order; 0..8 share 11.
    expect([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(shaft)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let k = 0; k <= 8; k++) expect(shaft(k)).toBe(MAX_REGIONS - 1);
    expect(r.faces[MAX_REGIONS - 1]).toBe(bit(NX, NY)); // the shaft at x 0 is on the -x face
  });

  it('come out the same for the same blocks', () => {
    const world = new World(20261022);
    world.ensureColumn(0, 0);
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
      const blocks = world.getChunk(0, cy, 0)!.blocks;
      const a = chunkRegions(blocks);
      const b = regionMap(blocks.slice(), new Uint8Array(S * S * S));
      expect(b.count).toBe(a.count);
      expect(b.faces).toEqual(a.faces);
      expect(b.border).toEqual(a.border);
    }
  });

  it('take in water, glass, leaves and slabs, not planks', () => {
    for (const [block, open] of [[Block.Water, true], [Block.Glass, true], [Block.Leaves, true], [slab(0, false), true], [Block.Planks, false]] as const) {
      const c = stone();
      for (let z = 0; z < S; z++) c[at(7, 7, z)] = block;
      const r = chunkRegions(c);
      expect(r.count, Block[block] ?? String(block)).toBe(open ? 1 : 0);
      expect(seeThrough(block)).toBe(open);
    }
  });

  it('link to the neighbour regions they share open blocks with on a face', () => {
    // a: two tunnels out of +x at z 4 and z 20; b: one tunnel in at z 4, another at z 9.
    const a = stone();
    for (let x = 0; x < S; x++) a[at(x, 4, 4)] = a[at(x, 4, 20)] = Block.Air;
    const b = stone();
    for (let x = 0; x < S; x++) b[at(x, 4, 9)] = Block.Air;
    for (let x = 0; x < 10; x++) b[at(x, 4, 4)] = Block.Air;
    for (let y = 4; y < S; y++) b[at(9, y, 4)] = Block.Air; // and up
    const ra = chunkRegions(a);
    const rb = chunkRegions(b);
    expect(ra.count).toBe(2);
    expect(rb.count).toBe(2);
    const links = linksOf(ra, PX, rb);
    expect(links[0]).toBe(1 << 0); // a's z 4 tunnel into b's z 4 one (b's first, scanned at x 0)
    expect(links[1]).toBe(0); // a's z 20 tunnel meets rock
    expect(ra.linkedWith![PX]).toBe(rb); // kept
    expect(linksOf(rb, NX, ra)[0]).toBe(1 << 0);
    expect(linksOf(rb, NX, ra)[1]).toBe(0);
    // Open and solid neighbours.
    expect(linksOf(ra, PX, OPEN_REGIONS)[1]).toBe(1);
    expect(linksOf(OPEN_REGIONS, NX, rb)[0]).toBe(bit(1)); // b's +x face: only the z 9 tunnel
    expect(linksOf(OPEN_REGIONS, PX, rb)[0]).toBe(bit(0, 1)); // its -x face: both
    expect(linksOf(ra, PX, SOLID_REGIONS)[0]).toBe(0);
    expect(linksOf(ra, NY, rb)[0]).toBe(0); // a touches no -y
  });
});

describe('the region walk', () => {
  /** A world of chunks from blocks by key (anything else open), walked within `radius` of the start's column, heights 0..2. */
  const walk = (start: [number, number, number], from: number, chunks: Record<string, Uint8Array>, radius = 2) => {
    const regions = Object.fromEntries(Object.entries(chunks).map(([k, b]) => [k, chunkRegions(b)]));
    return walkRegions(start, from, radius, 0, 2, (x, y, z) => regions[chunkKey(x, y, z)]);
  };
  const old = (start: [number, number, number], chunks: Record<string, Uint8Array>, radius = 2) =>
    reachableChunks(
      start,
      (x, y, z) => y >= 0 && y <= 2 && (x - start[0]) ** 2 + (z - start[2]) ** 2 <= radius * radius,
      (x, y, z) => (chunks[chunkKey(x, y, z)] ? chunkConnectivity(chunks[chunkKey(x, y, z)]) : ALL_CONNECTED),
    );
  /** Ground: chunks at height 1 open above y 16, everything at height 0 stone, all within 3 of the origin. */
  const ground = () => {
    const chunks: Record<string, Uint8Array> = {};
    for (let z = -3; z <= 3; z++)
      for (let x = -3; x <= 3; x++) {
        const surface = stone();
        surface.fill(Block.Air, 16 * S * S);
        chunks[chunkKey(x, 1, z)] = surface;
        chunks[chunkKey(x, 0, z)] = stone();
      }
    return chunks;
  };

  it('reaches everything through open space', () => {
    const reach = walk([0, 1, 0], -1, {});
    expect(reach.chunks).toBe(13 * 3); // the 13 columns within 2
    expect(reach.has(2, 0, 0)).toBe(true);
    expect(reach.has(2, 0, 1)).toBe(false); // out of the circle
  });

  it('sees the ground and the walls on its top, nothing under it', () => {
    const reach = walk([0, 1, 0], 1 << 0, ground());
    expect(reach.regions[reach.index(1, 1, 0)]).toBe(1);
    expect(reach.has(1, 0, 0)).toBe(false); // the ground's top is in the chunk above's own stone
    expect(reach.faces[reach.index(1, 1, 0)]).toBe(bit(NX, PX, PY, NZ, PZ)); // seen from every side and above
  });

  it('marks the walls of a chunk seen across its face, though nothing in it is reached', () => {
    const chunks = ground();
    chunks[chunkKey(1, 1, 0)] = stone(); // a solid block of land beside the start
    const reach = walk([0, 1, 0], 1 << 0, chunks);
    expect(reach.regions[reach.index(1, 1, 0)]).toBe(0);
    expect(reach.faces[reach.index(1, 1, 0)] & bit(NX)).toBeTruthy();
    expect(reach.has(1, 1, 0)).toBe(true);
  });

  it("doesn't come in by the sky and leave by a tunnel the sky isn't joined to (the chunk walk does)", () => {
    const chunks = ground();
    // Beside the start, a tunnel out of the -x face (into the start chunk's rock) and down.
    const leaky = chunks[chunkKey(1, 1, 0)];
    for (let x = 0; x <= 16; x++) leaky[at(x, 5, 16)] = Block.Air;
    for (let y = 0; y <= 5; y++) leaky[at(16, y, 16)] = Block.Air;
    // Under it, a shaft from that tunnel down into the rock.
    const below = chunks[chunkKey(1, 0, 0)];
    for (let y = 20; y < S; y++) below[at(16, y, 16)] = Block.Air;
    expect(old([0, 1, 0], chunks).has(chunkKey(1, 0, 0))).toBe(true);
    const reach = walk([0, 1, 0], 1 << 0, chunks);
    expect(reach.has(1, 0, 0)).toBe(false);
    // In the chunk beside, the sky (region 1: the tunnel is met first) but not the tunnel.
    expect(reach.regions[reach.index(1, 1, 0)]).toBe(1 << 1);
    // From inside the tunnel, down the shaft.
    const inside = walk([1, 1, 0], 1 << 0, chunks);
    expect(inside.regions[inside.index(1, 0, 0)]).toBe(1);
    expect(inside.regions[inside.index(1, 1, 0)]).toBe(1 << 0);
  });

  it('starts from every region of the chunk when the eye is in none', () => {
    const chunks = ground();
    // In the start chunk, a shaft up from its bottom, stopping a block short of the sky (region 0;
    // the sky is 1); under it, a shaft right through.
    for (let y = 0; y <= 14; y++) chunks[chunkKey(0, 1, 0)][at(16, y, 16)] = Block.Air;
    for (let y = 0; y < S; y++) chunks[chunkKey(0, 0, 0)][at(16, y, 16)] = Block.Air;
    expect(walk([0, 1, 0], -1, chunks).has(0, 0, 0)).toBe(true);
    expect(walk([0, 1, 0], 1 << 0, chunks).has(0, 0, 0)).toBe(true); // from the shaft
    expect(walk([0, 1, 0], 1 << 1, chunks).has(0, 0, 0)).toBe(false); // from the sky
  });

  it('never turns back towards where it started', () => {
    // From the start's sky, a tunnel beside it goes down two chunks and back along -x under the
    // start; the only way into the chunk under the start is that U-turn.
    const chunks: Record<string, Uint8Array> = {};
    for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) for (let y = 0; y <= 1; y++) chunks[chunkKey(x, y, z)] = stone();
    const down = stone(); // in from -x at y 16, down out of -y
    for (let x = 0; x <= 16; x++) down[at(x, 16, 16)] = Block.Air;
    for (let y = 0; y <= 16; y++) down[at(16, y, 16)] = Block.Air;
    const shaft = stone();
    for (let y = 0; y < S; y++) shaft[at(16, y, 16)] = Block.Air;
    const back = stone(); // in from +y, out of -x at y 16
    for (let y = 16; y < S; y++) back[at(16, y, 16)] = Block.Air;
    for (let x = 0; x <= 16; x++) back[at(x, 16, 16)] = Block.Air;
    const start = new Uint8Array(S * S * S); // open, at height 2
    chunks[chunkKey(1, 2, 0)] = down;
    chunks[chunkKey(1, 1, 0)] = shaft;
    chunks[chunkKey(1, 0, 0)] = back;
    chunks[chunkKey(0, 0, 0)] = (() => {
      const c = stone();
      for (let x = 0; x < S; x++) c[at(x, 16, 16)] = Block.Air; // open to +x, where back comes out
      return c;
    })();
    chunks[chunkKey(0, 2, 0)] = start;
    const reach = walk([0, 2, 0], -1, chunks);
    expect(reach.regions[reach.index(1, 0, 0)]).toBe(1); // down the shaft is fine
    expect(reach.regions[reach.index(0, 0, 0)]).toBe(0); // back under the start is not
  });
});

describe('the region walk on generated land', () => {
  // Every open block a straight line of sight from the eye passes through must be in a region the
  // walk reached: the walk may draw too much, never too little.
  const RADIUS = 3;
  const world = new World(20261022);
  const spawn = world.generator.findLand(0, 0);
  const ox = toChunk(spawn.x);
  const oz = toChunk(spawn.z);
  for (let dz = -RADIUS - 1; dz <= RADIUS + 1; dz++) for (let dx = -RADIUS - 1; dx <= RADIUS + 1; dx++) world.ensureColumn(ox + dx, oz + dz);
  const maps = new Map<string, Uint8Array>();
  const regionOf = (x: number, y: number, z: number): number => {
    const chunk = world.getChunk(toChunk(x), toChunk(y), toChunk(z))!;
    let map = maps.get(chunk.key);
    if (!map) {
      map = new Uint8Array(S * S * S);
      chunk.regions = regionMap(chunk.blocks, map);
      maps.set(chunk.key, map);
    }
    return map[localIndex(toLocal(x), toLocal(y), toLocal(z))];
  };

  /** Look from (ex, ey, ez) along many seeded directions (exact grid traversal); count the open blocks checked. */
  function check(ex: number, ey: number, ez: number): number {
    const sx = toChunk(Math.floor(ex));
    const sy = toChunk(Math.floor(ey));
    const sz = toChunk(Math.floor(ez));
    const eye = regionOf(Math.floor(ex), Math.floor(ey), Math.floor(ez));
    expect(eye).not.toBe(NO_REGION);
    const reach = walkRegions([sx, sy, sz], 1 << eye, RADIUS, MIN_CHUNK_Y, MAX_CHUNK_Y, (x, y, z) => world.getChunk(x, y, z)?.regions);
    const rng = createRng(7);
    let checked = 0;
    for (let n = 0; n < 3000; n++) {
      // A direction uniformly on the sphere.
      const u = rng() * 2 - 1;
      const a = rng() * Math.PI * 2;
      const dx = Math.sqrt(1 - u * u) * Math.cos(a);
      const dy = u;
      const dz = Math.sqrt(1 - u * u) * Math.sin(a);
      let x = Math.floor(ex);
      let y = Math.floor(ey);
      let z = Math.floor(ez);
      const stepX = Math.sign(dx);
      const stepY = Math.sign(dy);
      const stepZ = Math.sign(dz);
      let tx = dx ? (stepX > 0 ? x + 1 - ex : ex - x) / Math.abs(dx) : Infinity;
      let ty = dy ? (stepY > 0 ? y + 1 - ey : ey - y) / Math.abs(dy) : Infinity;
      let tz = dz ? (stepZ > 0 ? z + 1 - ez : ez - z) / Math.abs(dz) : Infinity;
      for (;;) {
        const cx = toChunk(x);
        const cz = toChunk(z);
        if (y < 0 || y >= (MAX_CHUNK_Y + 1) * S || (cx - sx) ** 2 + (cz - sz) ** 2 > RADIUS * RADIUS) break;
        if (!seeThrough(world.getBlock(x, y, z))) {
          // The wall hit: its chunk must be drawn.
          expect(reach.has(cx, toChunk(y), cz), `wall ${x},${y},${z}`).toBe(true);
          break;
        }
        const r = regionOf(x, y, z);
        expect(r, `pocket at ${x},${y},${z}`).not.toBe(NO_REGION);
        const reached = reach.regions[reach.index(cx, toChunk(y), cz)];
        expect(reached & (1 << r), `${x},${y},${z} region ${r} of ${reached.toString(2)}`).not.toBe(0);
        checked++;
        if (tx <= ty && tx <= tz) {
          x += stepX;
          tx += 1 / Math.abs(dx);
        } else if (ty <= tz) {
          y += stepY;
          ty += 1 / Math.abs(dy);
        } else {
          z += stepZ;
          tz += 1 / Math.abs(dz);
        }
      }
    }
    return checked;
  }

  it('reaches every open block in sight from the surface', () => {
    const ey = world.generator.height(spawn.x, spawn.z) + 2.6;
    expect(check(spawn.x + 0.5, ey, spawn.z + 0.5)).toBeGreaterThan(10000);
  });

  it('reaches every open block in sight from inside a cave', () => {
    // The first open block under solid ground near the spawn point.
    let found: [number, number, number] | null = null;
    for (let d = 0; d < 32 && !found; d++)
      for (let y = world.generator.height(spawn.x + d, spawn.z) - 4; y > 8 && !found; y--)
        if (world.getBlock(spawn.x + d, y, spawn.z) === Block.Air && world.getBlock(spawn.x + d, y - 1, spawn.z) !== Block.Air)
          found = [spawn.x + d, y, spawn.z];
    expect(found).not.toBeNull();
    const [x, y, z] = found!;
    expect(check(x + 0.5, y + 0.6, z + 0.5)).toBeGreaterThan(100);
  });
});
