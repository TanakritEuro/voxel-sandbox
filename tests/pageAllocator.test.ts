import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { PageAllocator } from '../src/render/pageAllocator';

describe('page allocator', () => {
  it('fills from the start, first fit, and says when nothing fits', () => {
    const a = new PageAllocator(100);
    expect(a.alloc(30)).toBe(0);
    expect(a.alloc(30)).toBe(30);
    expect(a.alloc(50)).toBe(-1);
    expect(a.alloc(40)).toBe(60);
    expect(a.used).toBe(100);
    expect(a.alloc(1)).toBe(-1);
    expect(a.alloc(0)).toBe(-1);
  });

  it('merges freed ranges with their neighbours, and reuses them', () => {
    const a = new PageAllocator(100);
    const [x, y, z] = [a.alloc(20), a.alloc(20), a.alloc(20)];
    a.release(x, 20);
    a.release(z, 20); // merges with the free tail
    expect(a.ranges).toEqual([[0, 20], [40, 60]]);
    a.release(y, 20); // joins both sides
    expect(a.ranges).toEqual([[0, 100]]);
    expect(a.used).toBe(0);
    expect(a.largestFree).toBe(100);
  });

  it('never hands out the same quad twice, through random use', () => {
    const rand = createRng(7);
    const a = new PageAllocator(10_000);
    const owned = new Uint8Array(10_000);
    const live: [number, number][] = [];
    for (let step = 0; step < 5000; step++) {
      if (live.length && rand() < 0.45) {
        const [start, length] = live.splice(Math.floor(rand() * live.length), 1)[0];
        owned.fill(0, start, start + length);
        a.release(start, length);
      } else {
        const length = 1 + Math.floor(rand() * 400);
        const start = a.alloc(length);
        if (start < 0) {
          expect(a.largestFree).toBeLessThan(length);
          continue;
        }
        for (let i = start; i < start + length; i++) expect(owned[i]).toBe(0);
        owned.fill(1, start, start + length);
        live.push([start, length]);
      }
      expect(a.used).toBe(owned.reduce((s, v) => s + v, 0));
    }
    for (const [start, length] of live) a.release(start, length);
    expect(a.ranges).toEqual([[0, 10_000]]);
  });
});
