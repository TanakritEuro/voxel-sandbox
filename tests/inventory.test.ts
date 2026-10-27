import { describe, expect, it } from 'vitest';
import { WorldSaver } from '../src/save/saver';
import { MemoryStore, newWorldRecord } from '../src/save/store';
import { Block, BLOCKS, HOTBAR, hotbarFrom, PLACEABLE } from '../src/world/blocks';

describe('the block picker and the hotbar', () => {
  it('offers every block but air, once each', () => {
    expect(PLACEABLE).not.toContain(Block.Air);
    expect(new Set(PLACEABLE).size).toBe(PLACEABLE.length);
    expect(PLACEABLE.length).toBe(BLOCKS.length - 1);
    for (const b of HOTBAR) expect(PLACEABLE).toContain(b);
  });

  it('takes a saved hotbar as it is, and the default for anything missing or wrong', () => {
    expect(hotbarFrom(undefined)).toEqual([...HOTBAR]);
    expect(hotbarFrom('junk')).toEqual([...HOTBAR]);
    const mine = [Block.Snow, Block.Cactus, Block.Lamp, Block.Torch, Block.Glass, Block.Sand, Block.Gravel, Block.CrystalOre, Block.Water];
    expect(hotbarFrom(mine)).toEqual(mine);
    // Air, an id that doesn't exist, a fraction, a string, and too few slots.
    const bad = hotbarFrom([Block.Air, 999, 2.5, 'stone', Block.Snow]);
    expect(bad).toEqual([HOTBAR[0], HOTBAR[1], HOTBAR[2], HOTBAR[3], Block.Snow, ...HOTBAR.slice(5)]);
    // A fresh copy: changing it doesn't change the default.
    hotbarFrom(undefined)[0] = Block.Lamp;
    expect(HOTBAR[0]).toBe(Block.Grass);
  });

  it('is kept with the world: a chosen block is still there when it is opened again', async () => {
    const store = new MemoryStore();
    const record = newWorldRecord('w', 'Test', 1, 0.3);
    expect(hotbarFrom(record.hotbar)).toEqual([...HOTBAR]); // a world from before the picker
    const hotbar = hotbarFrom(record.hotbar);
    record.hotbar = hotbar;
    const saver = await WorldSaver.open(store, record);
    hotbar[2] = Block.CrystalOre;
    await saver.saveRecord({ x: 0, y: 70, z: 0, yaw: 0, pitch: 0, flying: false }, 0.3);
    const again = await store.getWorld('w');
    expect(hotbarFrom(again!.hotbar)[2]).toBe(Block.CrystalOre);
  });
});
