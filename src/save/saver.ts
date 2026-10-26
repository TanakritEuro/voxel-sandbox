// Saving a world as it's played: edited chunks are written (RLE, `rle.ts`) to the store a
// couple of seconds after an edit, at once when they're about to be unloaded, and when the
// page is hidden; the world's record (where the player is, the time of day) every few
// seconds. Which chunks a world has saved is read once when it opens (keys only), so the
// loader knows which columns to read before generating them; the reading and the putting
// back happen in the chunk worker (`workers/jobs.ts`), so light and connectivity come out
// right for edited chunks too.
//
// Writes are queued one after another, and reads wait for the writes before them, so a
// chunk saved as it's unloaded is read back as saved if the player turns round at once.

import { TUNING } from '../config';
import type { SavedChunk } from '../workers/protocol';
import type { Chunk } from '../world/world';
import { encodeRle } from './rle';
import type { PlayerState, StoredChunk, WorldRecord, WorldStore } from './store';

const columnKey = (cx: number, cz: number) => `${cx},${cz}`;

export class WorldSaver {
  /** Column → the chunk heights it has saved. */
  private readonly columns = new Map<string, Set<number>>();
  /** Chunks edited since they were last written. */
  private readonly dirty = new Set<Chunk>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The last write, then every one after it. */
  private writing: Promise<void> = Promise.resolve();
  /** The last chunk write, for `?stats`. */
  last: { chunks: number; bytes: number; ms: number } | null = null;

  private constructor(
    readonly store: WorldStore,
    readonly record: WorldRecord,
  ) {}

  /** Start saving `record`'s world in `store`: learn which chunks it has, and write the record. */
  static async open(store: WorldStore, record: WorldRecord): Promise<WorldSaver> {
    const saver = new WorldSaver(store, record);
    for (const [cx, cy, cz] of await store.chunkKeys(record.id)) saver.index(cx, cy, cz);
    await store.putWorld(record);
    return saver;
  }

  /** Has column (cx, cz) any saved chunks? */
  has(cx: number, cz: number): boolean {
    return this.columns.has(columnKey(cx, cz));
  }

  /** The saved chunks of column (cx, cz), as stored (RLE), once every write before now is done. */
  async load(cx: number, cz: number): Promise<SavedChunk[]> {
    const heights = [...(this.columns.get(columnKey(cx, cz)) ?? [])];
    await this.writing;
    const data = await this.store.getChunks(
      this.record.id,
      heights.map((cy) => [cx, cy, cz]),
    );
    return heights.flatMap((cy, i) => (data[i] ? [{ cy, data: data[i]! }] : []));
  }

  /** The blocks of `chunk` changed: write it within `TUNING.save.delayMs`. */
  edited(chunk: Chunk): void {
    this.dirty.add(chunk);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.writeDirty();
    }, TUNING.save.delayMs);
  }

  /** Chunks about to be unloaded: write the edited ones now, while their blocks are still here. */
  unloading(chunks: readonly Chunk[]): void {
    const leaving = chunks.filter((c) => this.dirty.has(c));
    if (!leaving.length) return;
    for (const c of leaving) this.dirty.delete(c);
    void this.write(leaving.map((c) => this.encode(c)));
  }

  /** Edited chunks not yet written. */
  get unsaved(): number {
    return this.dirty.size;
  }

  /** Write every edited chunk now. */
  writeDirty(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const chunks = [...this.dirty].map((c) => this.encode(c));
    this.dirty.clear();
    return chunks.length ? this.write(chunks) : this.writing;
  }

  /** Write the world's record with where the player is and the time of day. */
  saveRecord(player: PlayerState, time: number): Promise<void> {
    this.record.player = player;
    this.record.time = time;
    this.record.played = Date.now();
    const record = structuredClone(this.record);
    return this.queue(() => this.store.putWorld(record));
  }

  /** Is `chunk` saved, or waiting to be? (For tests.) */
  isSaved(chunk: Chunk): boolean {
    return !this.dirty.has(chunk) && (this.columns.get(columnKey(chunk.cx, chunk.cz))?.has(chunk.cy) ?? false);
  }

  private encode(chunk: Chunk): StoredChunk {
    this.index(chunk.cx, chunk.cy, chunk.cz);
    return { cx: chunk.cx, cy: chunk.cy, cz: chunk.cz, data: encodeRle(chunk.blocks) };
  }

  private index(cx: number, cy: number, cz: number): void {
    const key = columnKey(cx, cz);
    let heights = this.columns.get(key);
    if (!heights) this.columns.set(key, (heights = new Set()));
    heights.add(cy);
  }

  private write(chunks: StoredChunk[]): Promise<void> {
    const bytes = chunks.reduce((s, c) => s + c.data.length, 0);
    return this.queue(async () => {
      const t0 = performance.now();
      await this.store.putChunks(this.record.id, chunks);
      this.last = { chunks: chunks.length, bytes, ms: performance.now() - t0 };
    });
  }

  /** Run `task` after every write before it; a failed write is reported, and doesn't stop the ones after. */
  private queue(task: () => Promise<void>): Promise<void> {
    this.writing = this.writing.then(task).catch((e: unknown) => console.error('saving failed:', e));
    return this.writing;
  }
}
