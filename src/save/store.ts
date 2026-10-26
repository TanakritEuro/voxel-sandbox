// Where worlds are kept: a record per world (name, seed, where the player was, the time of
// day) and its edited chunks, RLE-encoded (`rle.ts`). Two implementations of one interface:
// IndexedDB in the browser, and memory for tests and for worlds that aren't saved
// (`?seed=`, `?autofly`), so the rest of the game doesn't care which it has.
//
// IndexedDB: database "voxel-sandbox", stores "worlds" (key: id) and "chunks" (key:
// [world id, cx, cy, cz], value: the RLE bytes).

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
}

export interface WorldRecord {
  id: string;
  name: string;
  seed: number;
  /** When it was made and last played, ms since 1970. */
  created: number;
  played: number;
  /** Where the player was; null until first saved (then they spawn on land near the origin). */
  player: PlayerState | null;
  /** Time of day, 0–1. */
  time: number;
}

/** A chunk's place and its RLE-encoded blocks. */
export interface StoredChunk {
  cx: number;
  cy: number;
  cz: number;
  data: Uint8Array;
}

export interface WorldStore {
  listWorlds(): Promise<WorldRecord[]>;
  getWorld(id: string): Promise<WorldRecord | undefined>;
  /** Add a world or replace its record. */
  putWorld(record: WorldRecord): Promise<void>;
  /** A world and all its chunks. */
  deleteWorld(id: string): Promise<void>;
  /** Where a world's saved chunks are, without reading them. */
  chunkKeys(world: string): Promise<[number, number, number][]>;
  /** Saved chunks of a world at these places (undefined where there is none). */
  getChunks(world: string, places: readonly [number, number, number][]): Promise<(Uint8Array | undefined)[]>;
  putChunks(world: string, chunks: readonly StoredChunk[]): Promise<void>;
}

/** A world's first record: the player spawns near the origin, in the morning. */
export function newWorldRecord(id: string, name: string, seed: number, time: number): WorldRecord {
  const now = Date.now();
  return { id, name, seed, created: now, played: now, player: null, time };
}

const chunkId = (world: string, cx: number, cy: number, cz: number) => `${world}/${cx},${cy},${cz}`;

/** Kept in memory: gone on reload. */
export class MemoryStore implements WorldStore {
  private readonly worlds = new Map<string, WorldRecord>();
  private readonly chunks = new Map<string, Map<string, StoredChunk>>();

  async listWorlds(): Promise<WorldRecord[]> {
    return [...this.worlds.values()].map((w) => structuredClone(w));
  }

  async getWorld(id: string): Promise<WorldRecord | undefined> {
    const w = this.worlds.get(id);
    return w && structuredClone(w);
  }

  async putWorld(record: WorldRecord): Promise<void> {
    this.worlds.set(record.id, structuredClone(record));
  }

  async deleteWorld(id: string): Promise<void> {
    this.worlds.delete(id);
    this.chunks.delete(id);
  }

  async chunkKeys(world: string): Promise<[number, number, number][]> {
    return [...(this.chunks.get(world)?.values() ?? [])].map((c) => [c.cx, c.cy, c.cz]);
  }

  async getChunks(world: string, places: readonly [number, number, number][]): Promise<(Uint8Array | undefined)[]> {
    const chunks = this.chunks.get(world);
    return places.map(([cx, cy, cz]) => chunks?.get(chunkId(world, cx, cy, cz))?.data.slice());
  }

  async putChunks(world: string, chunks: readonly StoredChunk[]): Promise<void> {
    let stored = this.chunks.get(world);
    if (!stored) this.chunks.set(world, (stored = new Map()));
    for (const c of chunks) stored.set(chunkId(world, c.cx, c.cy, c.cz), { ...c, data: c.data.slice() });
  }
}

const DB_VERSION = 1;

/** Kept in the browser's IndexedDB. */
export class IndexedDbStore implements WorldStore {
  private constructor(private readonly db: IDBDatabase) {}

  /** Open (or create) the database; rejects where IndexedDB isn't available (some private windows). */
  static open(name = 'voxel-sandbox'): Promise<IndexedDbStore> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
      const request = indexedDB.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      request.onsuccess = () => resolve(new IndexedDbStore(request.result));
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
    });
  }

  close(): void {
    this.db.close();
  }

  listWorlds(): Promise<WorldRecord[]> {
    return this.run('worlds', 'readonly', (s) => s.getAll() as IDBRequest<WorldRecord[]>);
  }

  getWorld(id: string): Promise<WorldRecord | undefined> {
    return this.run('worlds', 'readonly', (s) => s.get(id) as IDBRequest<WorldRecord | undefined>);
  }

  async putWorld(record: WorldRecord): Promise<void> {
    await this.run('worlds', 'readwrite', (s) => s.put(record));
  }

  deleteWorld(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
      tx.objectStore('worlds').delete(id);
      tx.objectStore('chunks').delete(worldRange(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async chunkKeys(world: string): Promise<[number, number, number][]> {
    const keys = await this.run('chunks', 'readonly', (s) => s.getAllKeys(worldRange(world)));
    return keys.map((k) => {
      const [, cx, cy, cz] = k as [string, number, number, number];
      return [cx, cy, cz];
    });
  }

  getChunks(world: string, places: readonly [number, number, number][]): Promise<(Uint8Array | undefined)[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chunks', 'readonly');
      const store = tx.objectStore('chunks');
      const out: (Uint8Array | undefined)[] = new Array(places.length);
      places.forEach(([cx, cy, cz], i) => {
        const request = store.get([world, cx, cy, cz]);
        request.onsuccess = () => (out[i] = request.result as Uint8Array | undefined);
      });
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  putChunks(world: string, chunks: readonly StoredChunk[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chunks', 'readwrite');
      const store = tx.objectStore('chunks');
      for (const c of chunks) store.put(c.data, [world, c.cx, c.cy, c.cz]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** One request in a transaction of its own; resolves with its result once the transaction completes. */
  private run<T>(storeName: string, mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      const request = make(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

/** Every chunk key of one world: [id, -∞, -∞, -∞] to [id, ∞, ∞, ∞]. */
const worldRange = (id: string): IDBKeyRange => IDBKeyRange.bound([id, -Infinity, -Infinity, -Infinity], [id, Infinity, Infinity, Infinity]);
