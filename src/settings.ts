// Player settings, kept in localStorage for every world alike (after the racing game's).
// Read back through `cleanSettings`: anything missing, of the wrong type or out of range takes
// the default or the nearest allowed value, so a bad entry can't break the game. Where
// storage is missing or blocked (private windows), the defaults, for the visit.

import { TUNING } from './config';

export interface Settings {
  /** Chunks loaded and drawn around the player. */
  viewDistance: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Mouse look: thousandths of a radian per pixel. */
  sensitivity: number;
  invertY: boolean;
  /** Sound: master volume 0–1, and mute. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  viewDistance: TUNING.view.radius,
  fov: TUNING.view.fov,
  sensitivity: TUNING.fly.mouseSensitivity * 1000,
  invertY: false,
  volume: 0.8,
  muted: false,
};

/** Allowed range and step of each number. */
export const RANGES = {
  viewDistance: { min: 4, max: 16, step: 1 },
  fov: { min: 60, max: 100, step: 1 },
  sensitivity: { min: 0.5, max: 6, step: 0.1 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const;

/** Above this view distance the panel warns it may be slow on a laptop. */
export const SLOW_VIEW_DISTANCE = 12;

/** Where settings are kept: localStorage, or a stand-in in tests. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'voxel.settings.v1';

/** Settings from anything (parsed JSON): known fields of the right type, clamped to their ranges, the rest the defaults. */
export function cleanSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const v = r[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const { min, max } = RANGES[key];
    s[key] = Math.min(max, Math.max(min, v));
  }
  s.viewDistance = Math.round(s.viewDistance);
  for (const key of ['invertY', 'muted'] as const) if (typeof r[key] === 'boolean') s[key] = r[key];
  return s;
}

export function loadSettings(storage: KeyValue | null = browserStorage()): Settings {
  try {
    return cleanSettings(JSON.parse(storage?.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage: KeyValue | null = browserStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered this time; the game works the same.
  }
}

function browserStorage(): KeyValue | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
