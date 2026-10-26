// The pause menu: over the game whenever the mouse isn't captured (at the start, and after
// Esc). Play captures it again; quitting saves and goes back to the world list. The keys are
// listed under it.

import { button, el } from './dom';

export const KEYS = [
  'WASD walk · Space jump / swim up · Shift crouch · tap Ctrl to sprint · F or Space twice to fly (Space / Shift up / down)',
  'Hold left button to break · Right click place · 1–9 or wheel pick a block · Esc pause · F3 stats',
];

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly play: HTMLButtonElement;
  private readonly quit: HTMLButtonElement;

  constructor(parent: HTMLElement, world: string, saved: boolean, events: { onPlay(): void; onQuit(): void }) {
    this.root = el(parent, 'div', 'menu-root pause hidden');
    const panel = el(this.root, 'div', 'menu');
    el(panel, 'div', 'menu-title', world);
    if (!saved) el(panel, 'p', 'menu-help', 'This world isn’t saved: links with ?seed, ?at or ?autofly start afresh each time.');
    const actions = el(panel, 'div', 'menu-row');
    this.play = button(actions, 'Play', events.onPlay, 'menu-go');
    this.quit = button(actions, saved ? 'Save and quit to the world list' : 'Quit to the world list', events.onQuit);
    for (const line of KEYS) el(panel, 'p', 'menu-help', line);
  }

  set visible(visible: boolean) {
    this.root.classList.toggle('hidden', !visible);
  }

  /** Quitting: nothing more to press while the world is written. */
  quitting(): void {
    this.play.disabled = this.quit.disabled = true;
    this.quit.textContent = 'Saving…';
  }
}
