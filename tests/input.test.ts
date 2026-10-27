import { describe, expect, it } from 'vitest';
import { SpikeFilter } from '../src/input';

describe('mouse spike filter', () => {
  it('drops the lone huge move of the playtest, and keeps the turn around it', () => {
    const f = new SpikeFilter();
    // Moves from the recording: 23–67 px a event, then one of 722.
    const moves = [23, 48, 31, 67, 25, 39, 722, 44, 28];
    const kept = moves.filter((m) => f.accept(-m, 2));
    expect(kept).toEqual([23, 48, 31, 67, 25, 39, 44, 28]);
    expect(f.dropped).toBe(1);
  });

  it('keeps fast flicks that build up, small moves, and big moves after big ones', () => {
    const f = new SpikeFilter();
    for (const m of [0, 3, 1, 0, 150, 199, 600, 900, 1200, 800, 5, 180]) expect(f.accept(m, 0)).toBe(true);
    expect(f.dropped).toBe(0);
  });

  it('loses at most the first event of a sudden flick from rest', () => {
    const f = new SpikeFilter();
    f.accept(2, 1);
    expect(f.accept(0, 400)).toBe(false); // up or down counts the same
    expect(f.accept(0, 420)).toBe(true);
    expect(f.accept(0, -450)).toBe(true);
  });
});
