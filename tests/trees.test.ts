import { describe, expect, it } from 'vitest';
import { Biome } from '../src/world/biomes';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk, toLocal } from '../src/world/coords';
import { type Tree, TreeKind, treesIn } from '../src/world/features';
import { Generator } from '../src/world/generate';
import { World } from '../src/world/world';

const SEED = 20261022;
const S = CHUNK_SIZE;
const WOOD: Record<TreeKind, Block> = { [TreeKind.Oak]: Block.Wood, [TreeKind.Spruce]: Block.SpruceWood, [TreeKind.Cactus]: Block.Cactus };
const LEAVES: Record<TreeKind, Block> = { [TreeKind.Oak]: Block.Leaves, [TreeKind.Spruce]: Block.SpruceLeaves, [TreeKind.Cactus]: Block.Air };

/** A world of the chunk columns around (cx, cz), and the trees standing in their middle part. */
function forest(cx: number, cz: number, r = 1) {
  const world = new World(SEED);
  for (let z = cz - r - 1; z <= cz + r + 1; z++) for (let x = cx - r - 1; x <= cx + r + 1; x++) world.ensureColumn(x, z);
  const g = world.generator;
  const trees = treesIn(SEED, (cx - r) * S, (cz - r) * S, (cx + r + 1) * S - 1, (cz + r + 1) * S - 1, g.ground());
  return { world, g, trees };
}

// A forest near the origin (?at=-121,-226 is inside one) and a desert (?at=384,0).
const FOREST = [toChunk(-121), toChunk(-226)] as const;
const DESERT = [toChunk(384), toChunk(0)] as const;

describe('trees', () => {
  const { world, g, trees } = forest(...FOREST);

  it('stand whole in the world: a wood trunk on dirt, leaves round its top, across chunk borders', () => {
    expect(trees.length).toBeGreaterThan(20);
    let acrossBorders = 0;
    for (const t of trees) {
      for (let i = 0; i < t.height; i++) expect(world.getBlock(t.x, t.y + i, t.z)).toBe(WOOD[t.kind]);
      expect(world.getBlock(t.x, t.y - 1, t.z)).toBe(t.kind === TreeKind.Cactus ? Block.Sand : Block.Dirt);
      if (t.kind === TreeKind.Cactus) continue;
      // The leaf just beside the top of the trunk, on each side (another tree's trunk may stand there).
      const top = t.y + t.height - 1;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = world.getBlock(t.x + dx, top, t.z + dz);
        expect([LEAVES[t.kind], Block.Leaves, Block.SpruceLeaves, Block.Wood, Block.SpruceWood]).toContain(b);
        if (toChunk(t.x + dx) !== toChunk(t.x) || toChunk(t.z + dz) !== toChunk(t.z)) acrossBorders++;
      }
    }
    expect(acrossBorders).toBeGreaterThan(0);
    // And the other way round: every trunk standing on the ground is one of these trees (the
    // column jobs, asking their height maps, chose exactly what the generator chose).
    const listed = new Set(trees.map((t) => `${t.x},${t.z}`));
    const [cx, cz] = FOREST;
    for (let z = (cz - 1) * S; z < (cz + 2) * S; z++)
      for (let x = (cx - 1) * S; x < (cx + 2) * S; x++) {
        const b = world.getBlock(x, g.height(x, z) + 1, z);
        if (b === Block.Wood || b === Block.SpruceWood || b === Block.Cactus) expect(listed.has(`${x},${z}`), `${x},${z}`).toBe(true);
      }
  });

  it('come out the same whichever chunk is generated first, or alone', () => {
    // A tree whose canopy crosses into the next chunk column along x.
    const t = trees.find((t) => toLocal(t.x) === S - 1 && t.kind !== TreeKind.Cactus)!;
    expect(t).toBeDefined();
    const [cx, cz] = [toChunk(t.x) + 1, toChunk(t.z)];
    const cy = toChunk(t.y + t.height - 1);
    const alone = new Generator(SEED).generate(cx, cy, cz);
    expect(alone).toEqual(world.getChunk(cx, cy, cz)!.blocks);
    // The canopy is there in the neighbour, made without its trunk's chunk.
    const lx = toLocal(t.x + 1);
    const ly = toLocal(t.y + t.height - 1);
    const lz = toLocal(t.z);
    expect([Block.Leaves, Block.Wood]).toContain(alone[(ly * S + lz) * S + lx]);
  });

  it('grow only where they belong: their biome, dry land, ground no cave has taken', () => {
    const desert = forest(...DESERT);
    const all: Tree[] = [...trees, ...desert.trees];
    const kinds = new Set(all.map((t) => t.kind));
    expect(kinds).toEqual(new Set([TreeKind.Oak, TreeKind.Cactus]));
    for (const t of all) {
      const biome = g.biome(t.x, t.z);
      if (t.kind === TreeKind.Cactus) expect(biome).toBe(Biome.Desert);
      if (t.kind === TreeKind.Oak) expect([Biome.Plains, Biome.Forest]).toContain(biome);
      expect(g.ground().dry(t.x, t.z)).toBe(true);
      expect(g.ground().carved(t.x, t.y - 1, t.z)).toBe(false);
    }
  });

  it('are spruces on the snowy grass of the mountains', () => {
    const { world: w, trees: spruces } = forest(toChunk(0), toChunk(192), 2);
    const found = spruces.filter((t) => t.kind === TreeKind.Spruce);
    expect(found.length).toBeGreaterThan(0);
    for (const t of found) expect(w.generator.biome(t.x, t.z)).toBe(Biome.Mountains);
  });

  it('are much denser in forests than on plains', () => {
    const count = (x: number, z: number) => treesIn(SEED, x - 64, z - 64, x + 64, z + 64, g.ground()).length;
    expect(count(-121, -226)).toBeGreaterThan(3 * Math.max(1, count(36, 53)));
  });

  it('are never where the player spawns', () => {
    const t = trees.find((t) => t.kind === TreeKind.Oak)!;
    const spawn = g.findLand(t.x, t.z);
    expect(spawn).not.toEqual({ x: t.x, z: t.z });
    expect(g.treeAt(spawn.x, spawn.z)).toBe(false);
    expect(g.treeAt(t.x, t.z)).toBe(true);
  });

  it('reach into chunks above the ground, which are then not all air', () => {
    for (const t of trees) {
      const cy = toChunk(t.y + t.height);
      if (cy > MAX_CHUNK_Y || cy < MIN_CHUNK_Y) continue;
      expect(world.getChunk(toChunk(t.x), cy, toChunk(t.z))!.empty).toBe(false);
    }
  });
});
