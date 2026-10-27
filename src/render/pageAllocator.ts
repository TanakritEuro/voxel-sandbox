// Free space in a page of chunk meshes (`chunkPage.ts`), counted in quads: first fit from a
// list of free ranges kept in order, merged with their neighbours when freed. Pure, so the
// bookkeeping is tested without a GPU.

export class PageAllocator {
  /** Free ranges as [start, length], by start, never touching (touching ones are merged). */
  private readonly free: [number, number][];
  /** Quads in use. */
  used = 0;

  constructor(readonly capacity: number) {
    this.free = capacity > 0 ? [[0, capacity]] : [];
  }

  /** The start of `length` free quads, now taken; -1 if no free range is that long. */
  alloc(length: number): number {
    if (length <= 0) return -1;
    for (let i = 0; i < this.free.length; i++) {
      const r = this.free[i];
      if (r[1] < length) continue;
      const start = r[0];
      if (r[1] === length) this.free.splice(i, 1);
      else {
        r[0] += length;
        r[1] -= length;
      }
      this.used += length;
      return start;
    }
    return -1;
  }

  /** Give back `length` quads from `start` (as `alloc` returned them). */
  release(start: number, length: number): void {
    const free = this.free;
    // The first free range after this one.
    let i = 0;
    while (i < free.length && free[i][0] < start) i++;
    const before = i > 0 ? free[i - 1] : null;
    const after = i < free.length ? free[i] : null;
    const end = start + length;
    if (before && before[0] + before[1] === start) {
      before[1] += length;
      if (after && after[0] === end) {
        before[1] += after[1];
        free.splice(i, 1);
      }
    } else if (after && after[0] === end) {
      after[0] = start;
      after[1] += length;
    } else free.splice(i, 0, [start, length]);
    this.used -= length;
  }

  /** The longest free range: the biggest mesh that still fits. */
  get largestFree(): number {
    let most = 0;
    for (const r of this.free) most = Math.max(most, r[1]);
    return most;
  }

  /** Free ranges (for tests). */
  get ranges(): readonly (readonly [number, number])[] {
    return this.free;
  }
}
