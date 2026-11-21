// Parts of the HUD (Milestone 20): survival's health, hunger and air as pixel icons (`hudIcons.ts`), the
// selected thing's name fading in over the hotbar, and the panel shown while the world is being built.
// Each redraws only when what it shows changes.

import { el } from './dom';
import { type Fill, hudIcons, hudSize, type HudIcon } from './hudIcons';

/** What fills each of a row of `most / 2` icons for `points` (an icon for two points): full, half or empty. */
export function vitalFills(points: number, most: number): Fill[] {
  const out: Fill[] = [];
  for (let i = 0; i < most / 2; i++) {
    const left = points - i * 2;
    out.push(left >= 2 ? 'full' : left === 1 ? 'half' : 'empty');
  }
  return out;
}

/** How the vitals are now: health and hunger in points, air in tenths (null with air to spare). */
export interface VitalsState {
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  bubbles: number | null;
}

/** Health on the left, hunger on the right (filling from the right), bubbles over them under water. */
export class Vitals {
  private readonly root: HTMLDivElement;
  private shown = '';
  private icons: Map<string, string> | null = null;

  constructor(parent: HTMLElement) {
    this.root = el(parent, 'div', 'vitals hidden');
  }

  /** Show `state`, or hide them all (null: not survival). */
  show(state: VitalsState | null): void {
    const key = state ? `${state.health},${state.hunger},${state.bubbles}` : '';
    if (key === this.shown) return;
    this.shown = key;
    this.root.classList.toggle('hidden', !state);
    if (!state) return;
    this.icons ??= hudIcons();
    const row = (kind: HudIcon, fills: Fill[]) => {
      const [w, h] = hudSize(kind);
      return `<div class="pips ${kind}">${fills.map((f) => `<img class="pip ${f}" src="${this.icons!.get(`${kind}-${f}`)}" width="${w * 2}" height="${h * 2}" alt="">`).join('')}</div>`;
    };
    let html = '';
    if (state.bubbles !== null) {
      const fills: Fill[] = [];
      for (let i = 0; i < 10; i++) fills.push(i < state.bubbles ? 'full' : 'empty');
      html += `<div class="vitals-air">${row('air', fills)}</div>`;
    }
    html += `<div class="vitals-row">${row('health', vitalFills(state.health, state.maxHealth))}${row('hunger', vitalFills(state.hunger, state.maxHunger))}</div>`;
    this.root.innerHTML = html;
  }
}

/** The selected thing's name over the hotbar, fading in when it changes and out after a while. */
export class ItemName {
  private readonly root: HTMLDivElement;
  private name = '';
  private timer = 0;

  constructor(parent: HTMLElement, private readonly seconds = 2) {
    this.root = el(parent, 'div', 'item-name');
  }

  /** The thing selected now ('' for an empty slot): shown if it isn't what was. */
  show(name: string): void {
    if (name === this.name) return;
    this.name = name;
    window.clearTimeout(this.timer);
    this.root.textContent = name;
    this.root.classList.toggle('on', name !== '');
    if (name) this.timer = window.setTimeout(() => this.root.classList.remove('on'), this.seconds * 1000);
  }

  /** Sit higher while the vitals are over the hotbar. */
  set raised(on: boolean) {
    this.root.classList.toggle('raised', on);
  }
}

/** While the ground round the player is being made: a panel with a bar filling as columns come in. */
export class Loading {
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly words: HTMLParagraphElement;
  private shownPercent = -1;
  private on = true;

  constructor(parent: HTMLElement) {
    this.root = el(parent, 'div', 'loading');
    const panel = el(this.root, 'div', 'loading-panel');
    el(panel, 'div', 'menu-heading', 'Building the world');
    const track = el(panel, 'div', 'loading-track');
    this.bar = el(track, 'div', 'loading-bar');
    this.words = el(panel, 'p', 'loading-words', 'Making the land round you…');
  }

  /** Waiting for the ground (`fraction` of it in), or not (the panel fades away). */
  update(waiting: boolean, fraction: number): void {
    if (waiting !== this.on) {
      this.on = waiting;
      this.root.classList.toggle('done', !waiting);
    }
    if (!waiting) return;
    const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    if (percent === this.shownPercent) return;
    this.shownPercent = percent;
    this.bar.style.width = `${percent}%`;
    this.words.textContent = percent >= 100 ? 'Finding somewhere to stand…' : `Making the land round you… ${percent}%`;
  }
}
