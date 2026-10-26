import { describe, expect, it } from 'vitest';
import { CLOUD_CELLS, cloudCells, cloudDrift } from '../src/render/clouds';

const N = CLOUD_CELLS;

describe('clouds', () => {
  it('are the same for the same seed, different for another, and cover the share asked for', () => {
    const a = cloudCells(20261022, 0.4);
    expect(cloudCells(20261022, 0.4)).toEqual(a);
    expect(cloudCells(7, 0.4)).not.toEqual(a);
    const cover = a.reduce((n, c) => n + (c ? 1 : 0), 0) / a.length;
    expect(cover).toBeGreaterThan(0.39);
    expect(cover).toBeLessThan(0.41);
    expect(cloudCells(20261022, 0.1).reduce((n, c) => n + (c ? 1 : 0), 0) / a.length).toBeLessThan(0.11);
  });

  it('tile without a seam: the pattern changes across its edge no more than inside it', () => {
    const cells = cloudCells(20261022, 0.4);
    const across = (x0: number, x1: number) => {
      let n = 0;
      for (let y = 0; y < N; y++) if (cells[y * N + x0] !== cells[y * N + x1]) n++;
      return n;
    };
    let inside = 0;
    for (let x = 0; x < N - 1; x++) inside += across(x, x + 1);
    inside /= N - 1;
    expect(across(N - 1, 0)).toBeLessThanOrEqual(Math.max(4, inside * 3));
    // And clouds come in clumps, not salt and pepper: neighbours mostly agree.
    expect(inside / N).toBeLessThan(0.2);
  });

  it('drift with the wind', () => {
    expect(cloudDrift(10, 1.5)).toBe(15);
    expect(cloudDrift(0, 1.5)).toBe(0);
  });
});
