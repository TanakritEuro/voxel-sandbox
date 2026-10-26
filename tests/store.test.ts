import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStore, MemoryStore, type WorldRecord, type WorldStore } from '../src/save/store';

let dbCount = 0;
const stores: [string, () => Promise<WorldStore>][] = [
  ['memory', async () => new MemoryStore()],
  // A fresh database for each test.
  ['IndexedDB', () => IndexedDbStore.open(`test-${dbCount++}`)],
];

const record = (id: string, name = id): WorldRecord => ({
  id,
  name,
  seed: 123,
  created: 1,
  played: 2,
  player: { x: 1.5, y: 70, z: -3.25, yaw: 0.5, pitch: -0.25, flying: true },
  time: 0.3,
});
const bytes = (...v: number[]) => new Uint8Array(v);

describe.each(stores)('%s world store', (_name, open) => {
  it('keeps world records: adds, lists, replaces (renaming) and deletes them', async () => {
    const store = await open();
    expect(await store.listWorlds()).toEqual([]);
    await store.putWorld(record('a', 'First'));
    await store.putWorld(record('b', 'Second'));
    expect((await store.listWorlds()).map((w) => w.name).sort()).toEqual(['First', 'Second']);
    await store.putWorld({ ...record('a'), name: 'Renamed', player: null });
    expect(await store.getWorld('a')).toEqual({ ...record('a'), name: 'Renamed', player: null });
    expect(await store.getWorld('b')).toEqual(record('b', 'Second'));
    await store.deleteWorld('a');
    expect(await store.getWorld('a')).toBeUndefined();
    expect((await store.listWorlds()).map((w) => w.id)).toEqual(['b']);
  });

  it("keeps each world's chunks apart, replaces them, and deletes them with the world", async () => {
    const store = await open();
    await store.putWorld(record('a'));
    await store.putWorld(record('b'));
    await store.putChunks('a', [
      { cx: 0, cy: 1, cz: 0, data: bytes(1, 2, 3) },
      { cx: -5, cy: 7, cz: 12, data: bytes(4) },
    ]);
    await store.putChunks('b', [{ cx: 0, cy: 1, cz: 0, data: bytes(9) }]);
    await store.putChunks('a', [{ cx: 0, cy: 1, cz: 0, data: bytes(5, 6) }]);

    const sort = (k: [number, number, number][]) => k.map((p) => p.join()).sort();
    expect(sort(await store.chunkKeys('a'))).toEqual(['-5,7,12', '0,1,0']);
    expect(sort(await store.chunkKeys('b'))).toEqual(['0,1,0']);
    expect(
      await store.getChunks('a', [
        [0, 1, 0],
        [-5, 7, 12],
        [1, 1, 1],
      ]),
    ).toEqual([bytes(5, 6), bytes(4), undefined]);
    expect(await store.getChunks('b', [[0, 1, 0]])).toEqual([bytes(9)]);

    await store.deleteWorld('a');
    expect(await store.chunkKeys('a')).toEqual([]);
    expect(await store.getChunks('b', [[0, 1, 0]])).toEqual([bytes(9)]);
  });
});

it('a world in IndexedDB is still there when the database is opened again', async () => {
  const name = `test-reopen-${dbCount++}`;
  const first = await IndexedDbStore.open(name);
  await first.putWorld(record('w'));
  await first.putChunks('w', [{ cx: 2, cy: 3, cz: 4, data: bytes(7, 7) }]);
  first.close();
  const again = await IndexedDbStore.open(name);
  expect(await again.getWorld('w')).toEqual(record('w'));
  expect(await again.getChunks('w', [[2, 3, 4]])).toEqual([bytes(7, 7)]);
});
