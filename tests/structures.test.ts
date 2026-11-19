import { describe, expect, it } from 'vitest';
import { hostSurvival } from '../src/net/hostSurvival';
import { Chests } from '../src/survival/chest';
import { Furnaces } from '../src/survival/furnace';
import { GroundItems } from '../src/survival/ground';
import { LOOT, lootFor, lootSource } from '../src/survival/loot';
import { Block, chest, chestOf } from '../src/world/blocks';
import { SEA_LEVEL, toChunk } from '../src/world/coords';
import { findNearest } from '../src/world/find';
import { Generator } from '../src/world/generate';
import { type Structure, StructureKind } from '../src/world/structures';
import { World } from '../src/world/world';

const SEED = 20261022;
const v1 = new Generator(SEED, { generation: 1 });
const v2 = new Generator(SEED, { generation: 2 });

/** Every structure with its middle in 4096 x 4096 blocks round the origin. */
const ALL = v2.structuresIn(-2048, -2048, 2047, 2047).filter((s) => s.x >= -2048 && s.x < 2048 && s.z >= -2048 && s.z < 2048);

/** A world with the columns round a structure loaded, in the order given. */
function worldAround(s: Structure, reverse = false): World {
  const world = new World(SEED, { generation: 2 });
  const cols: [number, number][] = [];
  for (let cz = toChunk(s.z - s.half) - 1; cz <= toChunk(s.z + s.half) + 1; cz++) for (let cx = toChunk(s.x - s.half) - 1; cx <= toChunk(s.x + s.half) + 1; cx++) cols.push([cx, cz]);
  for (const [cx, cz] of reverse ? cols.reverse() : cols) world.ensureColumn(cx, cz);
  return world;
}

describe('structures (generation 2)', () => {
  it('are ruins and camps, about one every 200 x 200 blocks, and none in version 1', () => {
    const ruins = ALL.filter((s) => s.kind === StructureKind.Ruin).length;
    const camps = ALL.filter((s) => s.kind === StructureKind.Camp).length;
    expect(ruins).toBeGreaterThan(50);
    expect(camps).toBeGreaterThan(50);
    expect(ALL.length).toBeGreaterThan(4096 ** 2 / 400 ** 2);
    expect(ALL.length).toBeLessThan(4096 ** 2 / 120 ** 2);
    expect(v1.structuresIn(-2048, -2048, 2047, 2047)).toEqual([]);
  });

  it('stand on dry, nearly level land, a brick floor or the ground under them, the chest where it should be', () => {
    for (const s of ALL.slice(0, 12)) {
      expect(s.y).toBeGreaterThanOrEqual(SEA_LEVEL + 2);
      for (const [dx, dz] of [[-s.half, -s.half], [s.half, s.half], [-s.half, s.half], [s.half, -s.half]]) expect(Math.abs(v2.height(s.x + dx, s.z + dz) - s.y)).toBeLessThanOrEqual(2);
      const world = worldAround(s);
      let solidUnder = 0;
      for (let dz = -s.half; dz <= s.half; dz++)
        for (let dx = -s.half; dx <= s.half; dx++) {
          const floor = world.getBlock(s.x + dx, s.y, s.z + dz);
          if (s.kind === StructureKind.Ruin) expect([Block.StoneBricks, Block.MossyBricks]).toContain(floor);
          else expect(floor).not.toBe(Block.Air);
          if (world.getBlock(s.x + dx, s.y - 1, s.z + dz) !== Block.Air) solidUnder++;
        }
      // Nothing hangs: under the floor is ground or the foundation (a cave just under it, now and then).
      expect(solidUnder / (2 * s.half + 1) ** 2).toBeGreaterThan(0.9);
      const [cx, cy, cz] = s.chest;
      expect(chestOf(world.getBlock(cx, cy, cz))).not.toBeNull();
      expect(v2.lootAt(cx, cy, cz)).toBe(s.kind);
      expect(v2.lootAt(cx + 1, cy, cz)).toBeNull();
      expect(v2.lootAt(cx, cy + 1, cz)).toBeNull();
    }
  });

  it('come out the same whichever of their columns is generated first, across chunk borders', () => {
    // One crossing a chunk border in x or z.
    const s = ALL.find((t) => toChunk(t.x - t.half) !== toChunk(t.x + t.half) || toChunk(t.z - t.half) !== toChunk(t.z + t.half))!;
    expect(s).toBeDefined();
    const a = worldAround(s);
    const b = worldAround(s, true);
    for (let dy = -3; dy <= 7; dy++)
      for (let dz = -s.half - 1; dz <= s.half + 1; dz++)
        for (let dx = -s.half - 1; dx <= s.half + 1; dx++) expect(b.getBlock(s.x + dx, s.y + dy, s.z + dz)).toBe(a.getBlock(s.x + dx, s.y + dy, s.z + dz));
    // And its walls or tent are on both sides of the border.
    const sides = new Set<string>();
    for (let dz = -s.half; dz <= s.half; dz++)
      for (let dx = -s.half; dx <= s.half; dx++)
        for (let dy = 1; dy <= 3; dy++) if (a.getBlock(s.x + dx, s.y + dy, s.z + dz) !== Block.Air) sides.add(`${toChunk(s.x + dx)},${toChunk(s.z + dz)}`);
    expect(sides.size).toBeGreaterThan(1);
  });

  it('are found by ?find, out in front of the door', () => {
    for (const [kind, name] of [
      [StructureKind.Ruin, 'ruin'],
      [StructureKind.Camp, 'camp'],
    ] as const) {
      const at = findNearest(v2, name, 0, 0)!;
      const s = ALL.find((t) => t.kind === kind && Math.max(Math.abs(t.x - at.x), Math.abs(t.z - at.z)) === t.half + 2)!;
      expect(s).toBeDefined();
      expect(findNearest(v1, name, 0, 0)).toBeNull();
    }
  });
});

describe('loot', () => {
  const ruin = ALL.find((s) => s.kind === StructureKind.Ruin)!;
  const camp = ALL.find((s) => s.kind === StructureKind.Camp)!;

  it('is the same for the same chest, from its table, a stack a line at most', () => {
    for (const s of [ruin, camp]) {
      const a = lootFor(SEED, s.kind, ...s.chest);
      expect(lootFor(SEED, s.kind, ...s.chest)).toEqual(a);
      const items = a.filter((x) => x !== null);
      expect(items.length).toBeGreaterThan(0);
      const lines = new Map(LOOT[s.kind].map(([item, min, max]) => [item, [min, max]]));
      for (const st of items) {
        const [min, max] = lines.get(st!.item)!;
        expect(st!.count).toBeGreaterThanOrEqual(min);
        expect(st!.count).toBeLessThanOrEqual(max);
      }
      expect(new Set(items.map((x) => x!.item)).size).toBe(items.length);
    }
    // Different chests, different loot (over many, most differ).
    const others = ALL.slice(0, 20).map((s) => JSON.stringify(lootFor(SEED, s.kind, ...s.chest)));
    expect(new Set(others).size).toBeGreaterThan(15);
  });

  it('fills a structure chest once: opened, emptied, saved and loaded, broken, placed again', () => {
    const source = lootSource(v2);
    const chests = new Chests(source);
    const [x, y, z] = ruin.chest;
    const inv = chests.at(x, y, z);
    expect(inv.slots.filter((s) => s)).toEqual(lootFor(SEED, ruin.kind, x, y, z).filter((s) => s));
    inv.slots.fill(null); // taken
    expect(chests.at(x, y, z).slots.every((s) => s === null)).toBe(true);
    // Saved empty, and loaded: still empty.
    const saved = chests.toJSON();
    expect(saved[`${x},${y},${z}`]).toBeDefined();
    const loaded = Chests.from(JSON.parse(JSON.stringify(saved)), source);
    expect(loaded.at(x, y, z).slots.every((s) => s === null)).toBe(true);
    // Broken and placed again: nothing.
    loaded.remove(x, y, z);
    expect(loaded.at(x, y, z).slots.every((s) => s === null)).toBe(true);
    // A chest anywhere else starts empty.
    expect(chests.at(x + 3, y, z).slots.every((s) => s === null)).toBe(true);
  });

  it('drops from a structure chest broken before it was ever opened, once', () => {
    const chests = new Chests(lootSource(v2));
    const [x, y, z] = camp.chest;
    const dropped = chests.remove(x, y, z);
    expect(dropped).toEqual(lootFor(SEED, camp.kind, x, y, z).filter((s) => s));
    expect(chests.remove(x, y, z)).toEqual([]);
    expect(chests.at(x, y, z).slots.every((s) => s === null)).toBe(true);
  });

  it("is the host's to give a guest who opens one", () => {
    const chests = new Chests(lootSource(v2));
    const [x, y, z] = ruin.chest;
    const host = hostSurvival(new GroundItems(), new Furnaces(), chests, (bx, by, bz) => (bx === x && by === y && bz === z ? chest(0) : Block.Air), () => ({ x: x + 1.5, y, z: z + 0.5 }));
    const seen = host.container(1, x, y, z) as { slots: unknown[] };
    expect(seen.slots.filter((s) => s !== null).length).toBe(lootFor(SEED, ruin.kind, x, y, z).filter((s) => s).length);
  });
});
