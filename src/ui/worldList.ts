// The world list, shown at start: the saved worlds, last played first. Play one, make a new
// one (a name, and a seed or a random one), rename or delete one. Plain DOM over the page, in
// the style of the earlier games' menus. Playing loads the page again with `?world=<id>`, so
// each world starts in a fresh page, workers and GPU memory included.

import { TUNING } from '../config';
import { IndexedDbStore, newWorldRecord, type WorldRecord, type WorldStore } from '../save/store';
import { ago, byLastPlayed, freeName, newWorldId, seedFromText } from '../save/worlds';
import { cleanRoomCode } from '../net/roomCode';
import { cleanName } from '../net/protocol';
import { loadSettings, saveSettings } from '../settings';
import { button, el, field } from './dom';
import { settingsControls } from './settingsPanel';

/** A random number from the browser's generator (seeds and ids of new worlds; not world code). */
const random32 = (): number => crypto.getRandomValues(new Uint32Array(1))[0];
const random01 = (): number => random32() / 2 ** 32;

/** Load the page again playing `query` (`?world=…` or an unsaved world). */
const go = (query: string) => {
  location.search = query;
};

/** Show the world list over the page. */
export async function showWorldList(): Promise<void> {
  document.body.classList.add('menu-mode');
  const root = el(document.body, 'div', 'menu-root');
  const panel = el(root, 'div', 'menu');
  let store: WorldStore;
  try {
    store = await IndexedDbStore.open();
  } catch (e) {
    console.warn('No IndexedDB:', e);
    el(panel, 'div', 'menu-title', 'VOXEL SANDBOX');
    el(panel, 'p', 'menu-help', "This browser window can't keep worlds (private browsing, or storage turned off). You can still play one that isn't saved.");
    const row = el(panel, 'div', 'menu-row');
    button(row, 'Play without saving', () => go(`?seed=${random32()}`), 'menu-go');
    return;
  }
  new WorldList(panel, store, await store.listWorlds());
}

/**
 * Why the last game ended, if it ended on its own (`?left=…`, from a game played together); taken
 * out of the address, so it's said once.
 */
function endedWhy(): string | null {
  const why = new URLSearchParams(location.search).get('left');
  if (why !== null) history.replaceState(null, '', location.pathname);
  return why ? why.slice(0, 200) : null;
}

class WorldList {
  private worlds: WorldRecord[];
  /** Why the last game ended: said on the first screen shown. */
  private notice = endedWhy();
  private selected: string | null;

  constructor(
    private readonly panel: HTMLElement,
    private readonly store: WorldStore,
    worlds: WorldRecord[],
  ) {
    this.worlds = byLastPlayed(worlds);
    this.selected = this.worlds[0]?.id ?? null;
    if (this.worlds.length) this.list();
    else this.create();
  }

  private get chosen(): WorldRecord | undefined {
    return this.worlds.find((w) => w.id === this.selected);
  }

  /** The list of worlds and what can be done with the chosen one. */
  private list(): void {
    const panel = this.reset();
    const list = el(panel, 'div', 'world-list');
    if (!this.worlds.length) el(list, 'p', 'menu-help', 'No worlds yet.');
    for (const w of this.worlds) {
      const card = button(list, '', () => this.select(w.id), 'world-card');
      card.classList.toggle('selected', w.id === this.selected);
      card.dataset.id = w.id;
      el(card, 'span', 'menu-card-name', w.name);
      el(card, 'span', 'menu-card-sub', `seed ${w.seed} · played ${ago(w.played, Date.now())}`);
      card.addEventListener('dblclick', () => go(`?world=${encodeURIComponent(w.id)}`));
    }
    const actions = el(panel, 'div', 'menu-row');
    const play = button(actions, 'Play', () => this.chosen && go(`?world=${encodeURIComponent(this.chosen.id)}`), 'menu-go');
    button(actions, 'New world', () => this.create());
    const rename = button(actions, 'Rename', () => this.rename());
    const remove = button(actions, 'Delete', () => this.remove(), 'menu-danger');
    button(actions, 'Settings', () => this.settings());
    for (const b of [play, rename, remove]) b.disabled = !this.chosen;
    const together = el(panel, 'div', 'menu-row');
    button(together, 'Join a friend', () => this.join());
    el(panel, 'p', 'menu-help', 'Worlds are kept in this browser. Double-click a world to play it. To play together, open your world to friends from its pause menu.');
    play.focus();
  }

  /** Join a friend's world: their code, and the name to go by. */
  private join(): void {
    const panel = this.reset('Join a friend');
    const back = () => (this.worlds.length ? this.list() : this.create());
    const problem = el(panel, 'p', 'menu-help');
    const go_ = () => {
      const code = cleanRoomCode(codeInput.value);
      const name = cleanName(nameInput.value);
      if (!code) return void (problem.textContent = 'A code is four letters and numbers, as your friend sees it in their pause menu.');
      if (!name) return void (problem.textContent = 'Give yourself a name.');
      const settings = loadSettings();
      settings.name = name;
      saveSettings(settings);
      go(`?join=${code}`);
    };
    const codeInput = field(panel, 'Code', '', 'four letters, from your friend', go_, back);
    codeInput.maxLength = 8;
    const nameInput = field(panel, 'Your name', loadSettings().name, '', go_, back);
    nameInput.maxLength = 16;
    const actions = el(panel, 'div', 'menu-row');
    button(actions, 'Join', go_, 'menu-go');
    button(actions, 'Cancel', back);
    el(panel, 'p', 'menu-help', 'You play in their world while they do; nothing is saved in this browser.');
    codeInput.focus();
  }

  private select(id: string): void {
    this.selected = id;
    for (const card of this.panel.querySelectorAll<HTMLElement>('.world-card')) card.classList.toggle('selected', card.dataset.id === id);
  }

  /** A new world: a name and a seed (empty for a random one); made and played at once. */
  private create(): void {
    const panel = this.reset('New world');
    const back = () => (this.worlds.length ? this.list() : undefined);
    const make = async () => {
      const name = nameInput.value.trim() || freeName('New world', this.worlds.map((w) => w.name));
      const id = newWorldId(new Set(this.worlds.map((w) => w.id)), random01);
      await this.store.putWorld(newWorldRecord(id, name, seedFromText(seedInput.value, random32), TUNING.day.start));
      go(`?world=${encodeURIComponent(id)}`);
    };
    const nameInput = field(panel, 'Name', freeName('New world', this.worlds.map((w) => w.name)), '', () => void make(), back);
    const seedInput = field(panel, 'Seed', '', 'random (or a number, or any word)', () => void make(), back);
    const actions = el(panel, 'div', 'menu-row');
    button(actions, 'Create and play', () => void make(), 'menu-go');
    if (this.worlds.length) button(actions, 'Cancel', back);
    // With no worlds of their own yet, a friend's can still be joined.
    else button(actions, 'Join a friend', () => this.join());
    nameInput.select();
  }

  private rename(): void {
    const world = this.chosen;
    if (!world) return;
    const panel = this.reset('Rename');
    const save = async () => {
      const name = input.value.trim();
      if (!name) return;
      world.name = name;
      await this.store.putWorld(world);
      this.list();
    };
    const input = field(panel, 'Name', world.name, '', () => void save(), () => this.list());
    const actions = el(panel, 'div', 'menu-row');
    button(actions, 'Save', () => void save(), 'menu-go');
    button(actions, 'Cancel', () => this.list());
    input.select();
  }

  private settings(): void {
    const panel = this.reset('Settings');
    settingsControls(panel, loadSettings(), () => {});
    const actions = el(panel, 'div', 'menu-row');
    button(actions, 'Done', () => (this.worlds.length ? this.list() : this.create()), 'menu-go').focus();
  }

  private remove(): void {
    const world = this.chosen;
    if (!world) return;
    const panel = this.reset('Delete');
    el(panel, 'p', 'menu-text', `Delete “${world.name}”? Everything built in it is lost for good.`);
    const actions = el(panel, 'div', 'menu-row');
    button(
      actions,
      'Delete',
      async () => {
        await this.store.deleteWorld(world.id);
        this.worlds = this.worlds.filter((w) => w.id !== world.id);
        this.selected = this.worlds[0]?.id ?? null;
        if (this.worlds.length) this.list();
        else this.create();
      },
      'menu-danger',
    );
    button(actions, 'Cancel', () => this.list()).focus();
  }

  /** Empty the panel and give it the title (and a heading for sub-pages). */
  private reset(heading?: string): HTMLElement {
    this.panel.replaceChildren();
    el(this.panel, 'div', 'menu-title', 'VOXEL SANDBOX');
    if (this.notice) el(this.panel, 'p', 'menu-notice', this.notice);
    this.notice = null;
    if (heading) el(this.panel, 'div', 'menu-heading', heading);
    return this.panel;
  }
}
