// The settings controls, for the pause menu and the world list alike, in sections (Display, Controls,
// Sound, You): a slider for each number, a toggle for each switch, a field for the name. Every change
// is saved and handed on at once.

import { cleanName } from '../net/protocol';
import { RANGES, saveSettings, type Settings, SLOW_VIEW_DISTANCE } from '../settings';
import { button, el } from './dom';
import { applyTheme } from './theme';

/** The controls for `settings`, added to `parent`; `onChange` after each change (already saved). */
export function settingsControls(parent: HTMLElement, settings: Settings, onChange: (settings: Settings) => void): void {
  const changed = () => {
    saveSettings(settings);
    onChange(settings);
  };

  const display = section(parent, 'Display');
  const warning = el(display, 'p', 'menu-help');
  const showWarning = () => {
    warning.textContent = settings.viewDistance > SLOW_VIEW_DISTANCE ? 'Beyond 12 chunks may be slow on a laptop.' : '';
  };
  slider(display, 'View distance', 'viewDistance', settings, (v) => `${v} chunks`, () => {
    showWarning();
    changed();
  });
  display.append(warning);
  showWarning();
  slider(display, 'Field of view', 'fov', settings, (v) => `${v}°`, changed);
  slider(display, 'Resolution', 'resolution', settings, (v) => `${Math.round(v * 100)} %`, changed);
  slider(display, 'UI size', 'uiScale', settings, (v) => `${Math.round(v * 100)} %`, () => {
    applyTheme(settings);
    changed();
  });
  toggle(el(display, 'div', 'menu-row'), 'Antialiasing', () => settings.antialias, (v) => (settings.antialias = v), changed);
  el(display, 'p', 'menu-help', 'Lower resolution or antialiasing off is faster on a slow GPU. Antialiasing changes the next time a world is opened.');
  toggle(el(display, 'div', 'menu-row'), 'Lightning flashes', () => settings.flashes, (v) => (settings.flashes = v), changed);
  el(display, 'p', 'menu-help', 'A soft brightening of the sky with each bolt in a storm. Always off while your system asks for less motion.');

  const controls = section(parent, 'Controls');
  slider(controls, 'Mouse speed', 'sensitivity', settings, (v) => v.toFixed(1), changed);
  toggle(el(controls, 'div', 'menu-row'), 'Invert mouse Y', () => settings.invertY, (v) => (settings.invertY = v), changed);

  const sound = section(parent, 'Sound');
  slider(sound, 'Volume', 'volume', settings, (v) => `${Math.round(v * 100)} %`, changed);
  toggle(el(sound, 'div', 'menu-row'), 'Mute (M)', () => settings.muted, (v) => (settings.muted = v), changed);

  const you = section(parent, 'You');
  const row = el(you, 'label', 'menu-field');
  el(row, 'span', 'menu-label', 'Name');
  const name = el(row, 'input');
  name.type = 'text';
  name.maxLength = 16;
  name.spellcheck = false;
  name.value = settings.name;
  name.addEventListener('change', () => {
    const clean = cleanName(name.value);
    if (clean) settings.name = clean;
    name.value = settings.name;
    changed();
  });
  // Typing a name isn't a key for the game.
  name.addEventListener('keydown', (e) => e.stopPropagation());
  el(you, 'p', 'menu-help', 'What others see over your head when you play together.');
}

/** A section of the panel under a heading. */
function section(parent: HTMLElement, heading: string): HTMLElement {
  const box = el(parent, 'section', 'settings-section');
  el(box, 'div', 'settings-heading', heading);
  return box;
}

function slider(
  parent: HTMLElement,
  label: string,
  key: keyof typeof RANGES,
  settings: Settings,
  show: (value: number) => string,
  onInput: () => void,
): void {
  const row = el(parent, 'label', 'menu-field');
  el(row, 'span', 'menu-label', label);
  const input = el(row, 'input', 'menu-slider');
  const { min, max, step } = RANGES[key];
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(settings[key]);
  const value = el(row, 'span', 'menu-value', show(settings[key]));
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    value.textContent = show(settings[key]);
    onInput();
  });
}

function toggle(parent: HTMLElement, label: string, get: () => boolean, set: (on: boolean) => void, onChange: () => void): void {
  const b = button(parent, label, () => {
    set(!get());
    b.classList.toggle('on', get());
    onChange();
  });
  b.classList.toggle('on', get());
}
