import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { MobKind } from '../src/mobs/kinds';
import { MobManager } from '../src/mobs/mobs';
import { Chests } from '../src/survival/chest';
import { Item } from '../src/survival/items';
import { LOOT, lootFor, lootSource } from '../src/survival/loot';
import { Block, chestOf } from '../src/world/blocks';
import { CHUNK_SIZE, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { findNearest } from '../src/world/find';
import { Generator } from '../src/world/generate';
import { DUNGEON_CELL, StructureKind } from '../src/world/structures';
import { World } from '../src/world/world';

const SEED = 20261022;
const g3 = new Generator(SEED, { generation: 3 });
const g2 = new Generator(SEED, { generation: 2 });

/** A block of the land by version 3, its columns generated as asked for. */
const columns = new Map<string, (Uint8Array | null)[]>();
function block(x: number, y: number, z: number): Block {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const key = `${cx},${cz}`;
  let c = columns.get(key);
  if (!c) columns.set(key, (c = g3.generateColumn(cx, cz, MIN_CHUNK_Y, MAX_CHUNK_Y)));
  const chunk = c[Math.floor(y / CHUNK_SIZE) - MIN_CHUNK_Y];
  return chunk ? (chunk[((y & 31) << 10) | ((z & 31) << 5) | (x & 31)] as Block) : Block.Air;
}

describe('dungeons (generation version 3)', () => {
  const all = g3.dungeonsIn(-1024, -1024, 1023, 1023).filter((d) => d.x >= -1024 && d.x < 1024 && d.z >= -1024 && d.z < 1024);

  it('are buried rooms 9 x 5 x 9, about one in each 96 x 96-block cell where the ground is deep enough, only in version 3', () => {
    const cells = (2048 / DUNGEON_CELL) ** 2;
    expect(all.length).toBeGreaterThan(cells * 0.3);
    expect(all.length).toBeLessThan(cells * 0.8);
    for (const d of all) {
      expect(d.kind).toBe(StructureKind.Dungeon);
      expect(d.y).toBeGreaterThanOrEqual(12);
      expect(d.y + 4).toBeLessThanOrEqual(35);
      expect(g3.height(d.x, d.z)).toBeGreaterThanOrEqual(d.y + 8);
    }
    // None in version 2: its structures are the surface's alone.
    expect(g2.structuresIn(-1024, -1024, 1023, 1023).some((s) => s.kind === StructureKind.Dungeon)).toBe(false);
    expect(g2.dungeonsIn(-1024, -1024, 1023, 1023)).toEqual([]);
    expect(g3.structuresIn(-1024, -1024, 1023, 1023).filter((s) => s.kind === StructureKind.Dungeon).length).toBeGreaterThanOrEqual(all.length);
  });

  it('are written whole: the room cleared, brick walls, floor and ceiling except where a cave runs through, the chest in a corner', () => {
    // The nearest few to the origin.
    const near = [...all].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 4);
    let open = 0;
    for (const d of near) {
      for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++)
          for (let k = 0; k <= 4; k++) {
            const x = d.x + dx;
            const y = d.y + k;
            const z = d.z + dz;
            const b = block(x, y, z);
            const shell = Math.abs(dx) === 4 || Math.abs(dz) === 4 || k === 0 || k === 4;
            if (x === d.chest[0] && y === d.chest[1] && z === d.chest[2]) {
              expect(chestOf(b)).not.toBeNull();
              continue;
            }
            if (!shell) expect(b, `${x},${y},${z}`).toBe(Block.Air);
            else if (g3.caves.carvedAt(x, y, z, g3.caveLimitAt(x, z))) {
              expect([Block.StoneBricks, Block.MossyBricks]).not.toContain(b);
              open++;
            } else expect([Block.StoneBricks, Block.MossyBricks]).toContain(b);
          }
      expect(g3.lootAt(...d.chest)).toBe(StructureKind.Dungeon);
    }
    // Some cave meets at least one of them.
    expect(open).toBeGreaterThan(0);
  });

  it("hold better loot than a ruin, given once: iron, crystal, an iron tool now and then", () => {
    const iron = (kind: StructureKind) => LOOT[kind].find(([item]) => item === Item.Iron)!;
    expect(iron(StructureKind.Dungeon)[3]).toBeGreaterThan(iron(StructureKind.Ruin)[3]);
    let tools = 0;
    let crystal = 0;
    for (const d of all) {
      const slots = lootFor(SEED, StructureKind.Dungeon, ...d.chest).filter((s) => s !== null);
      expect(slots.length).toBeGreaterThan(0);
      if (slots.some((s) => s!.item === Item.IronPick || s!.item === Item.IronAxe || s!.item === Item.IronSpade)) tools++;
      if (slots.some((s) => s!.item === Item.Crystal)) crystal++;
    }
    expect(tools).toBeGreaterThan(0);
    expect(crystal).toBeGreaterThan(all.length / 3);
    // Filled the first time it's opened, never again.
    const d = all[0];
    const chests = new Chests(lootSource(g3));
    const first = chests.at(...d.chest).slots.filter((s) => s !== null).length;
    expect(first).toBeGreaterThan(0);
    for (let i = 0; i < 27; i++) chests.at(...d.chest).slots[i] = null;
    expect(chests.at(...d.chest).slots.every((s) => s === null)).toBe(true);
  });

  it('are found by ?find=dungeon: stood on the floor inside', () => {
    const at = findNearest(g3, 'dungeon', 0, 0)!;
    const d = all.find((s) => s.x === at.x && s.z === at.z)!;
    expect(d).toBeDefined();
    expect(at.y).toBe(d.y + 1);
    expect([block(at.x, at.y!, at.z), block(at.x, at.y! + 1, at.z)]).toEqual([Block.Air, Block.Air]);
    // The nearest: none closer to the origin.
    for (const s of all) expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(Math.hypot(at.x, at.z));
    expect(findNearest(g2, 'dungeon', 0, 0)).toBe(null);
  });

  it('bring delvers twice as often to a player near one', () => {
    const d = all[0];
    const world = new World(SEED, { generation: 3 });
    expect(world.generator.dungeonNear(d.x, d.y + 1, d.z, TUNING.mobs.dungeonReach)).toBe(true);
    expect(world.generator.dungeonNear(d.x + 200, d.y + 1, d.z + 200, TUNING.mobs.dungeonReach) && all.every((s) => Math.hypot(s.x - d.x - 200, s.z - d.z - 200) > 32)).toBe(false);
    // Count the delvers' turns at spawning, near and far from it, over 40 intervals.
    const turns = (x: number, z: number) => {
      const m = new MobManager(world, 1, 0);
      let delver = 0;
      const tries = m.trySpawnHostile.bind(m);
      m.trySpawnHostile = (near, prey, daylight, only = null) => {
        if (only === MobKind.Delver) delver++;
        return tries(near, prey, daylight, only);
      };
      for (let t = 0; t < 40; t++) m.update(TUNING.mobs.hostileInterval, [], 1, [{ x, y: d.y + 1, z }]);
      return delver;
    };
    expect(turns(d.x + 0.5, d.z + 0.5)).toBeGreaterThanOrEqual(15);
    // Far from any dungeon: no extra turns.
    let fx = d.x + 300;
    while (g3.dungeonNear(fx, d.y + 1, d.z, TUNING.mobs.dungeonReach)) fx += 40;
    expect(turns(fx + 0.5, d.z + 0.5)).toBe(0);
  });
});
