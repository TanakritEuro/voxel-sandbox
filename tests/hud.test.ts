import { describe, expect, it } from 'vitest';
import { vitalFills } from '../src/ui/hud';
import { hudArt, hudSize } from '../src/ui/hudIcons';

/** How many pixels of a picture are drawn, and how many of them in the full picture's colours. */
function pixels(art: Uint8Array, full: Uint8Array): { drawn: number; lit: number } {
  let drawn = 0;
  let lit = 0;
  for (let i = 0; i < art.length; i += 4) {
    if (!art[i + 3]) continue;
    drawn++;
    if (art[i] === full[i] && art[i + 1] === full[i + 1] && art[i + 2] === full[i + 2]) lit++;
  }
  return { drawn, lit };
}

describe('the HUD', () => {
  it('fills a row of icons, an icon for two points: full, half, then empty', () => {
    expect(vitalFills(20, 20)).toEqual(new Array(10).fill('full'));
    expect(vitalFills(0, 20)).toEqual(new Array(10).fill('empty'));
    expect(vitalFills(7, 20)).toEqual(['full', 'full', 'full', 'half', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty']);
    expect(vitalFills(8, 20).filter((f) => f === 'half')).toEqual([]);
  });

  it('draws gems, loaves and bubbles from their masks: the same shape full, half or empty, half filling one side', () => {
    for (const kind of ['health', 'hunger', 'air'] as const) {
      const [w, h] = hudSize(kind);
      expect(w).toBeGreaterThanOrEqual(8);
      expect(h).toBeGreaterThanOrEqual(7);
      const full = hudArt(kind, 'full');
      expect(full.length).toBe(w * h * 4);
      const f = pixels(full, full);
      const half = pixels(hudArt(kind, 'half'), full);
      const empty = pixels(hudArt(kind, 'empty'), full);
      // The shape is the same; only its colours change.
      expect([half.drawn, empty.drawn]).toEqual([f.drawn, f.drawn]);
      expect(f.lit).toBe(f.drawn);
      // The outline is shared, so an empty one still keeps a few of the full one's pixels.
      expect(empty.lit).toBeLessThan(f.drawn / 2);
      expect(half.lit).toBeGreaterThan(empty.lit);
      expect(half.lit).toBeLessThan(f.lit);
    }
    // Hunger's half fills the right side (its row fills from the right).
    const [w] = hudSize('hunger');
    const art = hudArt('hunger', 'half', true);
    const full = hudArt('hunger', 'full');
    const row = 3;
    const at = (x: number) => (row * w + x) * 4;
    expect([...art.slice(at(w - 3), at(w - 3) + 3)]).toEqual([...full.slice(at(w - 3), at(w - 3) + 3)]);
    expect([...art.slice(at(2), at(2) + 3)]).not.toEqual([...full.slice(at(2), at(2) + 3)]);
  });
});
