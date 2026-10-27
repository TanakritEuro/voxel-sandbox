import { describe, expect, it } from 'vitest';
import { cleanSettings, DEFAULT_SETTINGS, type KeyValue, loadSettings, saveSettings } from '../src/settings';

const memory = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('settings', () => {
  it('are the defaults with nothing saved, and come back as saved', () => {
    const storage = memory();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    const mine = { viewDistance: 12, fov: 90, resolution: 0.75, antialias: false, sensitivity: 3.5, invertY: true, volume: 0.3, muted: true };
    saveSettings(mine, storage);
    expect(loadSettings(storage)).toEqual(mine);
  });

  it('keep what makes sense of a bad entry and use the defaults for the rest', () => {
    expect(cleanSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ fov: 'wide', invertY: 'yes', volume: Number.NaN, viewDistance: 10 })).toEqual({ ...DEFAULT_SETTINGS, viewDistance: 10 });
    // Out of range: the nearest allowed value; view distance a whole number of chunks.
    expect(cleanSettings({ viewDistance: 40, fov: 10, sensitivity: -2, volume: 3, resolution: 0.2 })).toMatchObject({ viewDistance: 16, fov: 60, sensitivity: 0.5, volume: 1, resolution: 0.5 });
    expect(cleanSettings({ resolution: 3, antialias: 'off' })).toMatchObject({ resolution: 1, antialias: true });
    expect(cleanSettings({ antialias: false }).antialias).toBe(false);
    expect(cleanSettings({ viewDistance: 6.6 }).viewDistance).toBe(7);
    const storage = memory();
    storage.data.set('voxel.settings.v1', '{not json');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('work without storage, or with storage that throws', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const blocked: KeyValue = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(blocked)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, blocked)).not.toThrow();
  });
});
