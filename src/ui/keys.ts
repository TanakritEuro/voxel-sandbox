// The keys, in one table (Milestone 20): the pause menu draws them as keycaps in groups, and a test
// checks the table against the keys the game listens for, so the help can't drift from the game.

export type KeyGroup = 'Moving' | 'Building' | 'Screens';

export interface KeyLine {
  /** What's written on the caps (a mouse button or the wheel is a cap too). */
  caps: readonly string[];
  /** The `KeyboardEvent.code`s it stands for (`Mouse0`, `Mouse2` for the buttons; the digits and the wheel are read otherwise). */
  codes: readonly string[];
  what: string;
  group: KeyGroup;
  /** Only in one mode. */
  only?: 'creative' | 'survival';
}

export const KEY_GROUPS: readonly KeyGroup[] = ['Moving', 'Building', 'Screens'];

export const KEY_LINES: readonly KeyLine[] = [
  { caps: ['W', 'A', 'S', 'D'], codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD'], what: 'walk, row', group: 'Moving' },
  { caps: ['Space'], codes: ['Space'], what: 'jump, swim up', group: 'Moving' },
  { caps: ['Shift'], codes: ['ShiftLeft', 'ShiftRight'], what: 'crouch, get out', group: 'Moving' },
  { caps: ['Ctrl'], codes: ['ControlLeft', 'ControlRight'], what: 'tap to sprint', group: 'Moving' },
  { caps: ['F'], codes: ['KeyF'], what: 'fly (or Space twice)', group: 'Moving', only: 'creative' },
  { caps: ['Left button'], codes: ['Mouse0'], what: 'hold to break, hit', group: 'Building' },
  { caps: ['Right button'], codes: ['Mouse2'], what: 'place, use, eat', group: 'Building' },
  { caps: ['1–9', 'Wheel'], codes: [], what: 'pick a slot', group: 'Building' },
  { caps: ['Q'], codes: ['KeyQ'], what: 'throw one (Shift: all)', group: 'Building', only: 'survival' },
  { caps: ['E'], codes: ['KeyE', 'Tab'], what: 'blocks', group: 'Screens', only: 'creative' },
  { caps: ['E'], codes: ['KeyE', 'Tab'], what: 'inventory', group: 'Screens', only: 'survival' },
  { caps: ['N'], codes: ['KeyN'], what: 'map', group: 'Screens' },
  { caps: ['M'], codes: ['KeyM'], what: 'mute', group: 'Screens' },
  { caps: ['Esc'], codes: ['Escape'], what: 'pause', group: 'Screens' },
  { caps: ['F3'], codes: ['F3'], what: 'stats', group: 'Screens' },
];

/** The lines for a mode, by group. */
export function keysFor(mode: 'creative' | 'survival'): Map<KeyGroup, KeyLine[]> {
  const out = new Map<KeyGroup, KeyLine[]>(KEY_GROUPS.map((g) => [g, []]));
  for (const line of KEY_LINES) if (!line.only || line.only === mode) out.get(line.group)!.push(line);
  return out;
}
