import { describe, expect, it } from 'vitest';
import { RECIPES, make } from '../src/survival/crafting';
import { pickTier, rightTool } from '../src/survival/drops';
import { FUEL, Furnace, INPUT, OUTPUT } from '../src/survival/furnace';
import { Inventory } from '../src/survival/inventory';
import { Item } from '../src/survival/items';
import { LOOT, lootSource } from '../src/survival/loot';
import { TUNING } from '../src/config';
import { bedOf, Block, BLOCKS, chestOf, doorOf, FACINGS, wheatStage } from '../src/world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y, SEA_LEVEL } from '../src/world/coords';
import { findNearest } from '../src/world/find';
import { Generator } from '../src/world/generate';
import { SETTLEMENT_CELL, SETTLEMENT_REACH, type Settlement, settlementInCell, Settlements } from '../src/world/settlements';
import { StructureKind } from '../src/world/structures';
import { columnChecksum } from './generationV1.test';

const SEEDS = [20261022, 7, 123];

/** Every settlement in the cells from -4 to 3 each way, by seed (version 4). */
const found = new Map<number, Settlement[]>();
for (const seed of SEEDS) {
  const g = new Generator(seed, { generation: 4 });
  const list: Settlement[] = [];
  for (let gz = -4; gz < 4; gz++) for (let gx = -4; gx < 4; gx++) {
    const s = g.settlements.inCell(gx, gz);
    if (s) list.push(s);
  }
  found.set(seed, list);
}
const all = [...found.values()].flat();

/** A block of seed's land by `g`, its columns generated as asked for. */
function lander(g: Generator) {
  const columns = new Map<string, (Uint8Array | null)[]>();
  return (x: number, y: number, z: number): Block => {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let c = columns.get(key);
    if (!c) columns.set(key, (c = g.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y)));
    const chunk = c[Math.floor(y / CHUNK_SIZE) - MIN_CHUNK_Y];
    return chunk ? (chunk[((y & 31) << 10) | ((z & 31) << 5) | (x & 31)] as Block) : Block.Air;
  };
}

describe('settlements (generation version 4)', () => {
  it('come about one every 700–1000 blocks, with 3–7 huts, one a trader, and 1–2 fields', () => {
    const cells = SEEDS.length * 64;
    const every = SETTLEMENT_CELL / Math.sqrt(all.length / cells);
    expect(every).toBeGreaterThan(650);
    expect(every).toBeLessThan(1100);
    for (const s of all) {
      expect(s.huts.length).toBeGreaterThanOrEqual(3);
      expect(s.huts.length).toBeLessThanOrEqual(7);
      expect(s.huts.filter((h) => h.trader).length).toBe(1);
      expect(s.fields.length).toBeGreaterThanOrEqual(1);
      expect(s.fields.length).toBeLessThanOrEqual(2);
      for (const h of s.huts) expect(h.beds === 1 || h.beds === 2).toBe(true);
    }
    // Both kinds of hut are seen.
    expect(new Set(all.map((s) => s.style)).size).toBe(2);
  });

  it('stand on level, dry land, huts and fields never overlapping, all within reach of the well', () => {
    for (const seed of SEEDS) {
      const g = new Generator(seed, { generation: 4 });
      for (const s of found.get(seed)!) {
        // Each with what's levelled round it: the well's square, a hut's ring, a field's (9 across, 7 along its facing).
        const rects = [
          { x: s.x, z: s.z, hx: 3, hz: 3 },
          ...s.huts.map((h) => ({ x: h.x, z: h.z, hx: 4, hz: 4 })),
          ...s.fields.map((f) => (FACINGS[f.facing][0] ? { x: f.x, z: f.z, hx: 3, hz: 4 } : { x: f.x, z: f.z, hx: 4, hz: 3 })),
        ];
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            // Apart one way or the other, with a block between for a path.
            expect(Math.abs(a.x - b.x) > a.hx + b.hx + 1 || Math.abs(a.z - b.z) > a.hz + b.hz + 1).toBe(true);
          }
        for (const h of s.huts) {
          expect(Math.abs(h.y - s.y)).toBeLessThanOrEqual(6);
          for (let dz = -3; dz <= 3; dz++)
            for (let dx = -3; dx <= 3; dx += 3) {
              const ground = g.height(h.x + dx, h.z + dz);
              expect(ground).toBeGreaterThan(SEA_LEVEL);
              // Within 2 at the points looked at; a block more between them at the most.
              expect(Math.abs(ground - h.y)).toBeLessThanOrEqual(3);
            }
          expect(Math.max(Math.abs(h.x - s.x), Math.abs(h.z - s.z)) + 4).toBeLessThanOrEqual(SETTLEMENT_REACH);
        }
        for (const [x, y, z] of s.blocks) {
          expect(Math.abs(x - s.x)).toBeLessThanOrEqual(SETTLEMENT_REACH);
          expect(Math.abs(z - s.z)).toBeLessThanOrEqual(SETTLEMENT_REACH);
          expect(y).toBeGreaterThan(SEA_LEVEL - 10);
        }
      }
    }
  });

  it('are the same whichever column is generated first, across chunk borders', () => {
    const s = found.get(123)![0];
    const cells: [number, number][] = [];
    for (let cz = Math.floor((s.z - SETTLEMENT_REACH) / 32); cz <= Math.floor((s.z + SETTLEMENT_REACH) / 32); cz++)
      for (let cx = Math.floor((s.x - SETTLEMENT_REACH) / 32); cx <= Math.floor((s.x + SETTLEMENT_REACH) / 32); cx++) cells.push([cx, cz]);
    const sums = (order: [number, number][]) => {
      const g = new Generator(123, { generation: 4 });
      const out = new Map<string, string>();
      for (const [cx, cz] of order) out.set(`${cx},${cz}`, columnChecksum(g.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y)));
      return out;
    };
    const forwards = sums(cells);
    const backwards = sums([...cells].reverse());
    expect(cells.length).toBeGreaterThanOrEqual(4);
    for (const [k, v] of forwards) expect(backwards.get(k)).toBe(v);
    // And a layout made afresh (not kept) is the same as one kept.
    const g = new Generator(123, { generation: 4 });
    expect(settlementInCell(123, s.gx, s.gz, g)).toEqual(s);
  });

  it('are written whole: the well of water, huts with open doors, beds, a chest and a lantern, wheat, paths of gravel', () => {
    const g = new Generator(123, { generation: 4 });
    const block = lander(g);
    for (const s of found.get(123)!.slice(0, 3)) {
      // The well: water three deep inside its rim, gravel round it.
      for (let k = s.y - 3; k <= s.y; k++) expect(block(s.x, k, s.z)).toBe(Block.Water);
      expect(block(s.x, s.y - 4, s.z)).toBe(Block.StoneBricks);
      expect(block(s.x + 2, s.y + 1, s.z)).toBe(Block.StoneBricks);
      expect(block(s.x + 3, s.y, s.z)).toBe(Block.Gravel);
      for (const h of s.huts) {
        const [fx, fz] = FACINGS[h.facing];
        // The doorway in front, its door open.
        const lower = doorOf(block(h.x + fx * 3, h.y + 1, h.z + fz * 3));
        const upper = doorOf(block(h.x + fx * 3, h.y + 2, h.z + fz * 3));
        expect(lower && lower.open && !lower.upper).toBeTruthy();
        expect(upper && upper.open && upper.upper).toBeTruthy();
        // Room to walk in: the floor of planks, air over it.
        expect(block(h.x, h.y, h.z)).toBe(Block.Planks);
        expect(block(h.x, h.y + 1, h.z)).toBe(Block.Air);
        expect(block(h.x, h.y + 2, h.z)).toBe(Block.Air);
        // The doorstep is gravel.
        expect(block(h.x + fx * 4, h.y, h.z + fz * 4)).toBe(Block.Gravel);
        // Beds, the chest, the lantern.
        let beds = 0;
        let lanterns = 0;
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const b = block(h.x + dx, h.y + 1, h.z + dz);
            if (bedOf(b)?.head) beds++;
            if (b === Block.Lantern) lanterns++;
          }
        expect(beds).toBe(h.beds);
        expect(lanterns).toBe(1);
        expect(chestOf(block(...h.chest))).not.toBe(null);
        expect(g.lootAt(...h.chest)).toBe(StructureKind.Hut);
        // A roof over the middle.
        let roofed = false;
        for (let k = h.y + 3; k <= h.y + 8; k++) if (block(h.x, k, h.z) === Block.Thatch) roofed = true;
        expect(roofed).toBe(true);
      }
      // Wheat growing on every field, ripening.
      for (const f of s.fields) {
        const [fx, fz] = FACINGS[f.facing];
        const stage = wheatStage(block(f.x + fx, f.y + 1, f.z + fz));
        expect(stage).toBeGreaterThanOrEqual(3);
        expect(block(f.x + fx, f.y, f.z + fz)).toBe(Block.Farmland);
        expect(block(f.x, f.y, f.z)).toBe(Block.Water);
      }
      // Paths: gravel, with air over it.
      expect(s.paths.length).toBeGreaterThan(0);
      for (const [x, z] of s.paths) {
        const y = g.height(x, z);
        expect(block(x, y, z)).toBe(Block.Gravel);
        expect(block(x, y + 1, z)).toBe(Block.Air);
      }
    }
  });

  it('have no tree in a hut, a field, the well or on a path, and no ruin or camp near', () => {
    for (const seed of SEEDS) {
      const g = new Generator(seed, { generation: 4 });
      const block = lander(g);
      for (const s of found.get(seed)!.slice(0, 2)) {
        for (const h of s.huts)
          for (let dz = -4; dz <= 4; dz++)
            for (let dx = -4; dx <= 4; dx++)
              for (let k = h.y + 1; k <= h.y + 8; k++) {
                const b = block(h.x + dx, k, h.z + dz);
                expect(b === Block.Leaves || b === Block.SpruceLeaves || b === Block.ParasolLeaves).toBe(false);
              }
        for (const [x, z] of s.paths) expect(block(x, g.height(x, z) + 1, z)).toBe(Block.Air);
        const near = g.structuresIn(s.x - SETTLEMENT_REACH - 24, s.z - SETTLEMENT_REACH - 24, s.x + SETTLEMENT_REACH + 24, s.z + SETTLEMENT_REACH + 24);
        expect(near.filter((st) => st.kind === StructureKind.Ruin || st.kind === StructureKind.Camp)).toEqual([]);
      }
    }
  });

  it('come only in version 4, and are found by ?find=settlement', () => {
    for (const seed of SEEDS) {
      const g4 = new Generator(seed, { generation: 4 });
      const g3 = new Generator(seed, { generation: 3 });
      const at = findNearest(g4, 'settlement', 0, 0)!;
      expect(at).not.toBe(null);
      const st = g4.settlementsIn(at.x, at.z, at.x, at.z);
      expect(st.length).toBe(1);
      // On the gravel by the well.
      expect(Math.max(Math.abs(at.x - st[0].x), Math.abs(at.z - st[0].z))).toBe(3);
      // The nearest: none of the others found is nearer.
      const d = Math.hypot(st[0].x, st[0].z);
      for (const s of found.get(seed)!) expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(d - 1e-9);
      expect(g3.settlementsIn(at.x - 64, at.z - 64, at.x + 64, at.z + 64)).toEqual([]);
      expect(findNearest(g3, 'settlement', 0, 0)).toBe(null);
      expect(g3.lootAt(...st[0].huts[0].chest)).toBe(null);
    }
  });

  it('are laid out once a cell and kept, the most recently asked for', () => {
    const g = new Generator(7, { generation: 4 });
    const kept = new Settlements(7, g);
    const s = found.get(7)![0];
    const first = kept.inCell(s.gx, s.gz);
    expect(kept.inCell(s.gx, s.gz)).toBe(first);
    // Many other cells asked for: it's laid out again, the same.
    for (let i = 0; i < 40; i++) kept.inCell(100 + i, 100);
    const again = kept.inCell(s.gx, s.gz);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });
});

describe('thatch and mud bricks', () => {
  it('are blocks with their own textures, building blocks for settlements', () => {
    expect(BLOCKS[Block.Thatch].name).toBe('Thatch');
    expect(BLOCKS[Block.MudBricks].name).toBe('Mud bricks');
    expect(BLOCKS[Block.Thatch].textures.side).toBe('thatch');
    expect(BLOCKS[Block.MudBricks].textures.side).toBe('mud_bricks');
    expect(BLOCKS[Block.Thatch].opaque).toBe(true);
  });

  it('thatch is made from 4 wheat; mud bricks are mud baked in the furnace, dug with a pick', () => {
    const recipe = RECIPES.find((r) => r.makes === Block.Thatch)!;
    const inv = new Inventory();
    inv.add(Item.Wheat, 9);
    expect(make(inv, recipe, 5)).toBe(2);
    expect(inv.count(Block.Thatch)).toBe(2);
    expect(inv.count(Item.Wheat)).toBe(1);

    const f = new Furnace();
    f.slots.slots[INPUT] = { item: Block.Mud, count: 2 };
    f.slots.slots[FUEL] = { item: Item.Coal, count: 1 };
    for (let t = 0; t < (TUNING.survival.smeltSeconds * 2 + 0.5) * 60; t++) f.step(1 / 60);
    expect(f.slots.slots[OUTPUT]).toEqual({ item: Block.MudBricks, count: 2 });

    expect(rightTool(Block.MudBricks)).toBe('pick');
    expect(pickTier(Block.MudBricks)).toBe(1);
    expect(rightTool(Block.Thatch)).toBe(null);
  });

  it('a hut chest holds a household’s things', () => {
    const items = LOOT[StructureKind.Hut].map(([item]) => item);
    expect(items).toContain(Item.Bread);
    expect(items).toContain(Item.Wheat);
    const s = found.get(123)![0];
    const g = new Generator(123, { generation: 4 });
    const slots = lootSource(g)(...s.huts[0].chest);
    expect(slots).not.toBe(null);
  });
});
