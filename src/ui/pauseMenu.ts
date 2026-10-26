// The pause menu: over the game whenever the mouse isn't captured (at the start, and after
// Esc). Play captures it again; Settings opens the settings; quitting saves and goes back to
// the world list. The keys are listed under it.

import type { Settings } from '../settings';
import { button, el } from './dom';
import { settingsControls } from './settingsPanel';

export const KEYS = [
  'WASD walk · Space jump / swim up · Shift crouch · tap Ctrl to sprint · F or Space twice to fly (Space / Shift up / down)',
  'Hold left button to break · Right click place · 1–9 or wheel pick a block · Esc pause · F3 stats',
];

export interface PauseEvents {
  onPlay(): void;
  onQuit(): void;
  /** A setting changed (already saved). */
  onSettings(settings: Settings): void;
}

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private quitting_ = false;

  constructor(
    parent: HTMLElement,
    private readonly world: string,
    private readonly saved: boolean,
    private readonly settings: Settings,
    private readonly events: PauseEvents,
  ) {
    this.root = el(parent, 'div', 'menu-root pause hidden');
    this.panel = el(this.root, 'div', 'menu');
    this.main();
  }

  set visible(visible: boolean) {
    // Opening again starts from the main view, not the settings left open.
    if (visible && this.root.classList.contains('hidden')) this.main();
    this.root.classList.toggle('hidden', !visible);
  }

  /** Quitting: nothing more to press while the world is written. */
  quitting(): void {
    this.quitting_ = true;
    this.main();
  }

  private main(): void {
    this.panel.replaceChildren();
    el(this.panel, 'div', 'menu-title', this.world);
    if (!this.saved) el(this.panel, 'p', 'menu-help', 'This world isn’t saved: links with ?seed, ?at or ?autofly start afresh each time.');
    const actions = el(this.panel, 'div', 'menu-row');
    const play = button(actions, 'Play', this.events.onPlay, 'menu-go');
    const settings = button(actions, 'Settings', () => this.showSettings());
    const quit = button(actions, this.saved ? 'Save and quit to the world list' : 'Quit to the world list', this.events.onQuit);
    if (this.quitting_) {
      play.disabled = settings.disabled = quit.disabled = true;
      quit.textContent = 'Saving…';
    }
    for (const line of KEYS) el(this.panel, 'p', 'menu-help', line);
  }

  private showSettings(): void {
    this.panel.replaceChildren();
    el(this.panel, 'div', 'menu-title', this.world);
    el(this.panel, 'div', 'menu-heading', 'Settings');
    settingsControls(this.panel, this.settings, this.events.onSettings);
    const actions = el(this.panel, 'div', 'menu-row');
    button(actions, 'Done', () => this.main(), 'menu-go');
  }
}
