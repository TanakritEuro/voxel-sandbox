// Small rules about worlds as the menus show them: which URLs play an unsaved world, seeds
// typed as text, ids and default names for new worlds, and "played 5 min ago". Pure.

import type { WorldRecord } from './store';

/**
 * URLs that look at or measure one particular world (`?seed=`, `?at=`, `?autofly`): played
 * fresh each time, in memory, without the world list.
 */
export const isUnsavedUrl = (params: URLSearchParams): boolean => params.has('seed') || params.has('at') || params.has('autofly');

/**
 * A seed from what was typed: a whole number is used as it is; other text is hashed (so a
 * word makes the same world every time); nothing means `random()` (an unsigned 32-bit number).
 */
export function seedFromText(text: string, random: () => number): number {
  const t = text.trim();
  if (t === '') return random() >>> 0;
  if (/^-?\d{1,10}$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n) && Math.abs(n) <= 0xffffffff) return n;
  }
  // FNV-1a over the UTF-16 code units.
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** An id no world in `taken` has: "w-" and 8 base-36 characters from `random()` (0–1). */
export function newWorldId(taken: ReadonlySet<string>, random: () => number): string {
  for (;;) {
    let id = 'w-';
    for (let i = 0; i < 8; i++) id += Math.floor(random() * 36).toString(36);
    if (!taken.has(id)) return id;
  }
}

/** "New world", or "New world 2", 3… if that name is taken. */
export function freeName(base: string, names: readonly string[]): string {
  const taken = new Set(names);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Most recently played first. */
export const byLastPlayed = (worlds: readonly WorldRecord[]): WorldRecord[] => [...worlds].sort((a, b) => b.played - a.played);

/** How long ago `then` was, in words ("just now", "5 min ago", "3 h ago", "yesterday", "4 days ago"). */
export function ago(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
