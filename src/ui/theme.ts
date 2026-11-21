// The look's settings (Milestone 20): the UI size, applied as a CSS variable that menus and the HUD
// scale by (`zoom` in `style.css`); and the menus' clicks.

import type { Sound } from '../audio/sound';
import type { Settings } from '../settings';

/** Size everything on screen by `settings.uiScale`. */
export function applyTheme(settings: Settings): void {
  document.documentElement.style.setProperty('--ui', String(settings.uiScale));
}

/** A soft click whenever a menu's button is pressed (the sound unlocked by that press). */
export function menuClicks(sound: Sound): void {
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target instanceof Element ? e.target.closest('.menu button, .loading button') : null;
      if (!target || (target as HTMLButtonElement).disabled) return;
      sound.unlock();
      sound.play({ name: 'click', gain: 1 });
    },
    true,
  );
}
