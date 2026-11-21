// The pause menu: over the game whenever the mouse isn't captured (at the start, and after
// Esc). Play captures it again; Settings opens the settings; quitting saves and goes back to
// the world list (a guest leaves). Playing together has a part of its own (`together`: open to
// friends, the code, who's in), and so does the world's mode (creative or survival, and switching).
// The keys are listed under it as keycaps, in groups, for the world's mode (`keys.ts`).

import type { Settings } from '../settings';
import { button, el } from './dom';
import { keysFor } from './keys';
import { settingsControls } from './settingsPanel';

export interface PauseEvents {
  onPlay(): void;
  onQuit(): void;
  /** A setting changed (already saved). */
  onSettings(settings: Settings): void;
  /** Draws the playing-together part into the menu, each time it's shown (`refresh` asks again). */
  together?(panel: HTMLElement, refresh: () => void): void;
  /** Draws the world's mode, and switching it, into the menu each time it's shown. */
  mode?(panel: HTMLElement, refresh: () => void): void;
  /** The mode whose keys to list (creative if not given). */
  keys?(): 'creative' | 'survival';
}

export interface PauseOptions {
  /** Kept in this browser (else a note says it isn't). */
  saved: boolean;
  /** Instead of the usual note about unsaved worlds. */
  note?: string;
  /** The quit button's words, if not the usual. */
  quitLabel?: string;
}

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private quitting_ = false;

  constructor(
    parent: HTMLElement,
    private readonly world: string,
    private readonly options: PauseOptions,
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

  /** Draw the main view again (what's shown for playing together changed). */
  refresh(): void {
    if (!this.root.classList.contains('hidden') && !this.inSettings) this.main();
  }

  private inSettings = false;

  /** Quitting: nothing more to press while the world is written. */
  quitting(): void {
    this.quitting_ = true;
    this.main();
  }

  private main(): void {
    this.inSettings = false;
    this.panel.replaceChildren();
    el(this.panel, 'div', 'menu-title', this.world);
    const { saved, note, quitLabel } = this.options;
    if (note) el(this.panel, 'p', 'menu-help', note);
    else if (!saved) el(this.panel, 'p', 'menu-help', 'This world isn’t saved: links with ?seed, ?at or ?autofly start afresh each time.');
    const actions = el(this.panel, 'div', 'menu-row');
    const play = button(actions, 'Resume', this.events.onPlay, 'menu-go');
    const settings = button(actions, 'Settings', () => this.showSettings());
    const quit = button(actions, quitLabel ?? (saved ? 'Save and quit to the world list' : 'Quit to the world list'), this.events.onQuit);
    if (this.events.mode && !this.quitting_) this.events.mode(el(this.panel, 'div', 'menu-mode'), () => this.refresh());
    if (this.events.together && !this.quitting_) this.events.together(el(this.panel, 'div', 'menu-together'), () => this.refresh());
    if (this.quitting_) {
      play.disabled = settings.disabled = quit.disabled = true;
      quit.textContent = 'Saving…';
    }
    this.keys();
  }

  /** The keys as keycaps, a column a group. */
  private keys(): void {
    const box = el(this.panel, 'div', 'keys');
    for (const [group, lines] of keysFor(this.events.keys?.() ?? 'creative')) {
      const column = el(box, 'div', 'keys-group');
      el(column, 'div', 'keys-heading', group);
      for (const line of lines) {
        const row = el(column, 'div', 'keys-line');
        const caps = el(row, 'span', 'keys-caps');
        for (const cap of line.caps) el(caps, 'kbd', cap.length > 3 ? 'wide' : '', cap);
        el(row, 'span', 'keys-what', line.what);
      }
    }
  }

  private showSettings(): void {
    this.inSettings = true;
    this.panel.replaceChildren();
    el(this.panel, 'div', 'menu-title', this.world);
    el(this.panel, 'div', 'menu-heading', 'Settings');
    settingsControls(this.panel, this.settings, this.events.onSettings);
    const actions = el(this.panel, 'div', 'menu-row');
    button(actions, 'Done', () => this.main(), 'menu-go');
  }
}
