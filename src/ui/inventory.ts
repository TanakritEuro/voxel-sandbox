// The creative block picker (E or Tab in the game): every placeable block, in tabs by kind (and All),
// with a search box typed into as soon as it opens. Clicking a block puts it in the selected hotbar slot;
// the hotbar is along the bottom (click a slot to pick it; the number keys still do too); E, Tab or Esc
// closes it (Esc from the search box too). Creative only: every block, no counts.

import { type Block, BLOCKS, PLACEABLE } from '../world/blocks';
import { BLOCK_KINDS, type BlockKind, kindOf, nameMatches } from './categories';
import { el } from './dom';

type Tab = BlockKind | 'All';

export class Inventory {
  private readonly root: HTMLDivElement;
  private readonly help: HTMLParagraphElement;
  private readonly search: HTMLInputElement;
  private readonly none: HTMLParagraphElement;
  private readonly cells = new Map<Block, HTMLButtonElement>();
  private readonly tabEls = new Map<Tab, HTMLButtonElement>();
  private readonly barEls: HTMLButtonElement[] = [];
  private tab: Tab = 'All';
  private isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly icons: readonly string[],
    private readonly onChoose: (block: Block) => void,
    /** A hotbar slot (0-based) clicked in the picker. */
    private readonly onSlot: (slot: number) => void = () => {},
  ) {
    this.root = el(parent, 'div', 'menu-root inventory hidden');
    const panel = el(this.root, 'div', 'menu picker');
    const head = el(panel, 'div', 'picker-head');
    el(head, 'div', 'menu-heading', 'Blocks');
    this.search = el(head, 'input', 'picker-search');
    this.search.type = 'search';
    this.search.placeholder = 'Search blocks';
    this.search.spellcheck = false;
    this.search.addEventListener('input', () => this.filter());
    // Typing is for the box, not the game; but Esc and Tab still close the picker, and E does while the box is empty.
    this.search.addEventListener('keydown', (e) => {
      const closes = e.key === 'Escape' || e.code === 'Tab' || (e.code === 'KeyE' && this.search.value === '');
      if (closes) e.preventDefault();
      else e.stopPropagation();
    });
    const tabs = el(panel, 'div', 'picker-tabs');
    for (const tab of ['All', ...BLOCK_KINDS] as Tab[]) {
      const b = el(tabs, 'button', 'picker-tab', tab);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.tab = tab;
        this.filter();
      });
      this.tabEls.set(tab, b);
    }
    const grid = el(panel, 'div', 'block-grid');
    for (const b of PLACEABLE) {
      const cell = el(grid, 'button', 'block-cell');
      cell.type = 'button';
      cell.title = BLOCKS[b].name;
      const icon = el(cell, 'span');
      icon.style.backgroundImage = `url(${icons[b]})`;
      el(cell, 'em', '', BLOCKS[b].name);
      cell.addEventListener('click', () => this.onChoose(b));
      this.cells.set(b, cell);
    }
    this.none = el(grid, 'p', 'menu-help picker-none', 'No block by that name.');
    const bar = el(panel, 'div', 'picker-bar');
    for (let i = 0; i < 9; i++) {
      const slot = el(bar, 'button', 'slot');
      slot.type = 'button';
      slot.addEventListener('click', () => this.onSlot(i));
      this.barEls.push(slot);
    }
    this.help = el(panel, 'p', 'menu-help');
    this.filter();
  }

  get open(): boolean {
    return this.isOpen;
  }

  show(slot: number, hotbar: readonly Block[]): void {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.refresh(slot, hotbar);
    this.search.focus({ preventScroll: true });
    this.search.select();
  }

  hide(): void {
    this.isOpen = false;
    this.search.blur();
    this.root.classList.add('hidden');
  }

  /** The selected slot (0-based) or what's in the hotbar changed. */
  refresh(slot: number, hotbar: readonly Block[]): void {
    const holding = hotbar[slot];
    for (const [b, cell] of this.cells) cell.classList.toggle('selected', b === holding);
    this.barEls.forEach((el_, i) => {
      el_.classList.toggle('selected', i === slot);
      el_.title = BLOCKS[hotbar[i]]?.name ?? '';
      el_.innerHTML = `<span style="background-image: url(${this.icons[hotbar[i]] ?? ''})"></span><em>${i + 1}</em>`;
    });
    this.help.textContent = `Click a block to put it in slot ${slot + 1} · type to search · a click below picks the slot · E, Tab or Esc closes`;
  }

  /** Show the blocks of the tab chosen whose names match what's typed. */
  private filter(): void {
    let shown = 0;
    for (const [b, cell] of this.cells) {
      const show = (this.tab === 'All' || kindOf(b) === this.tab) && nameMatches(b, this.search.value);
      cell.hidden = !show;
      if (show) shown++;
    }
    this.none.hidden = shown > 0;
    for (const [tab, b] of this.tabEls) b.classList.toggle('selected', tab === this.tab);
  }
}
