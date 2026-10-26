import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { newWorldRecord } from '../src/save/store';
import { ago, byLastPlayed, freeName, isUnsavedUrl, newWorldId, seedFromText } from '../src/save/worlds';

describe('worlds in the menus', () => {
  it('plays an unsaved world for ?seed, ?at and ?autofly, and saves otherwise', () => {
    for (const q of ['?seed=5', '?at=1,2', '?autofly', '?autofly=10&stats']) expect(isUnsavedUrl(new URLSearchParams(q))).toBe(true);
    for (const q of ['', '?world=w-1', '?stats&time=0.5', '?light']) expect(isUnsavedUrl(new URLSearchParams(q))).toBe(false);
  });

  it('takes seeds as numbers, hashes words the same every time, and picks one when left empty', () => {
    const never = () => {
      throw new Error('no random seed wanted');
    };
    expect(seedFromText('20261022', never)).toBe(20261022);
    expect(seedFromText(' -7 ', never)).toBe(-7);
    expect(seedFromText('mountains', never)).toBe(seedFromText('mountains', never));
    expect(seedFromText('mountains', never)).not.toBe(seedFromText('Mountains', never));
    expect(Number.isInteger(seedFromText('99999999999999', never))).toBe(true);
    expect(seedFromText('', () => 123)).toBe(123);
    expect(seedFromText('   ', () => 2 ** 32 + 5)).toBe(5);
  });

  it('gives new worlds ids nobody has, and free default names', () => {
    const rng = createRng(1);
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newWorldId(taken, rng);
      expect(id).toMatch(/^w-[0-9a-z]{8}$/);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
    // A random source that repeats itself at first still ends up with a free id.
    let n = 0;
    const repeating = () => (n++ < 16 ? 0 : 0.5);
    expect(newWorldId(new Set(['w-00000000']), repeating)).not.toBe('w-00000000');
    expect(freeName('New world', [])).toBe('New world');
    expect(freeName('New world', ['New world', 'New world 2'])).toBe('New world 3');
  });

  it('lists the last played first and says how long ago', () => {
    const w = (id: string, played: number) => ({ ...newWorldRecord(id, id, 1, 0), played });
    expect(byLastPlayed([w('a', 5), w('b', 9), w('c', 1)]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    const now = 10 * 86_400_000;
    expect(ago(now - 20_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ago(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(ago(now - 4 * 86_400_000, now)).toBe('4 days ago');
  });
});
