import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { WorldSaver } from '../src/save/saver';
import { IndexedDbStore, MemoryStore, newWorldRecord, type WorldStore } from '../src/save/store';
import { handleJob } from '../src/workers/jobs';
import { Block } from '../src/world/blocks';
import { MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../src/world/coords';
import { World } from '../src/world/world';

const SEED = 20261022;

/** Columns -1..1 × -1..1, in the order given, each generated as the loader would: with its saved chunks, in a "worker". */
async function open(saver: WorldSaver, order: [number, number][]): Promise<World> {
  const world = new World(SEED);
  for (const [cx, cz] of order) {
    const saved = saver.has(cx, cz) ? await saver.load(cx, cz) : [];
    const result = handleJob({ kind: 'generate', id: 0, seed: SEED, cx, cz, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y, saved });
    if (result.kind !== 'generate') throw new Error('wrong kind');
    world.addColumn(cx, cz, result.chunks, result.connectivity, result.light);
  }
  return world;
}

const COLUMNS: [number, number][] = [];
for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) COLUMNS.push([cx, cz]);

describe.each([
  ['memory', async (): Promise<WorldStore> => new MemoryStore()],
  ['IndexedDB', (): Promise<WorldStore> => IndexedDbStore.open(`saving-${Math.random()}`)],
])('a world saved in %s', (_name, makeStore) => {
  it('comes back with its edits, lit as if they had always been there', async () => {
    const store = await makeStore();
    const record = newWorldRecord('w', 'Test', SEED, 0.3);
    const saver = await WorldSaver.open(store, record);
    const before = await open(saver, COLUMNS);

    // Dig a pit down from the surface at a chunk corner, and put a torch and a lamp in it.
    const g = before.generator;
    const top = g.height(0, 0);
    const edit = (x: number, y: number, z: number, block: Block) => {
      if (before.setBlock(x, y, z, block).length) saver.edited(before.getChunk(toChunk(x), toChunk(y), toChunk(z))!);
    };
    for (let y = top; y > top - 6; y--) for (let z = -2; z <= 1; z++) for (let x = -2; x <= 1; x++) edit(x, y, z, Block.Air);
    edit(-2, top - 5, -2, Block.Torch);
    edit(1, top - 5, 1, Block.Lamp);
    edit(0, top + 3, 0, Block.Glass);
    expect(saver.unsaved).toBeGreaterThan(1);
    await saver.writeDirty();
    expect(saver.unsaved).toBe(0);

    // Opened again, from the store alone, with columns in another order.
    const again = await WorldSaver.open(store, (await store.getWorld('w'))!);
    const after = await open(again, [...COLUMNS].reverse());
    let edited = 0;
    for (const chunk of before.chunks.values()) {
      const other = after.getChunk(chunk.cx, chunk.cy, chunk.cz)!;
      expect(other.blocks, chunk.key).toEqual(chunk.blocks);
      expect(other.light, chunk.key).toEqual(chunk.light);
      if (chunk.modified) edited++;
    }
    expect(edited).toBeGreaterThan(1);
    expect(after.getBlock(-2, top - 5, -2)).toBe(Block.Torch);
    expect(after.getLight(-1, top - 5, -2) & 15).toBe(13);
  });

  it('keeps where the player was and the time of day', async () => {
    const store = await makeStore();
    const saver = await WorldSaver.open(store, newWorldRecord('w', 'Test', SEED, 0.3));
    expect((await store.getWorld('w'))!.player).toBeNull();
    const player = { x: 10.25, y: 80, z: -4.5, yaw: 1.5, pitch: -0.4, flying: true };
    await saver.saveRecord(player, 0.62);
    const record = (await store.getWorld('w'))!;
    expect(record.player).toEqual(player);
    expect(record.time).toBe(0.62);
    expect(record.seed).toBe(SEED);
  });
});

it('reads a column back after a write of it that has not finished', async () => {
  const store = new MemoryStore();
  const saver = await WorldSaver.open(store, newWorldRecord('w', 'Test', SEED, 0));
  const world = new World(SEED);
  world.ensureColumn(0, 0);
  world.setBlock(3, 100, 3, Block.Planks);
  const chunk = world.getChunk(0, toChunk(100), 0)!;
  saver.edited(chunk);
  saver.unloading([chunk]); // written now, not awaited
  expect(saver.has(0, 0)).toBe(true);
  const saved = await saver.load(0, 0);
  expect(saved.map((s) => s.cy)).toEqual([toChunk(100)]);
});
