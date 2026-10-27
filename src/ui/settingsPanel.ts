// The settings controls, for the pause menu and the world list alike: a slider for each number,
// a toggle for each switch. Every change is saved and handed on at once.

import { RANGES, saveSettings, type Settings, SLOW_VIEW_DISTANCE } from '../settings';
import { button, el } from './dom';

/** The controls for `settings`, added to `parent`; `onChange` after each change (already saved). */
export function settingsControls(parent: HTMLElement, settings: Settings, onChange: (settings: Settings) => void): void {
  const changed = () => {
    saveSettings(settings);
    onChange(settings);
  };

  const warning = el(parent, 'p', 'menu-help');
  const showWarning = () => {
    warning.textContent = settings.viewDistance > SLOW_VIEW_DISTANCE ? 'Beyond 12 chunks may be slow on a laptop.' : '';
  };
  slider(parent, 'View distance', 'viewDistance', settings, (v) => `${v} chunks`, () => {
    showWarning();
    changed();
  });
  parent.append(warning);
  showWarning();
  slider(parent, 'Field of view', 'fov', settings, (v) => `${v}°`, changed);
  slider(parent, 'Resolution', 'resolution', settings, (v) => `${Math.round(v * 100)} %`, changed);
  slider(parent, 'Mouse speed', 'sensitivity', settings, (v) => v.toFixed(1), changed);
  slider(parent, 'Volume', 'volume', settings, (v) => `${Math.round(v * 100)} %`, changed);

  const toggles = el(parent, 'div', 'menu-row');
  toggle(toggles, 'Invert mouse Y', () => settings.invertY, (v) => (settings.invertY = v), changed);
  toggle(toggles, 'Mute (M)', () => settings.muted, (v) => (settings.muted = v), changed);
  toggle(toggles, 'Antialiasing', () => settings.antialias, (v) => (settings.antialias = v), changed);
  el(parent, 'p', 'menu-help', 'Lower resolution or antialiasing off is faster on a slow GPU. Antialiasing changes the next time a world is opened.');
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
