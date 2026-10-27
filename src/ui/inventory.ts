// The creative block picker (E or Tab in the game): every placeable block in a grid, with its
// icon and name. Clicking one puts it in the selected hotbar slot; the number keys still pick
// the slot while it's open; E, Tab or Esc closes it. Creative only: every block, no counts.

import { type Block, BLOCKS, PLACEABLE } from '../world/blocks';
import { el } from './dom';

export class Inventory {
  private readonly root: HTMLDivElement;
  private readonly help: HTMLParagraphElement;
  private readonly cells = new Map<Block, HTMLButtonElement>();
  private isOpen = false;

  constructor(
    parent: HTMLElement,
    icons: readonly string[],
    private readonly onChoose: (block: Block) => void,
  ) {
    this.root = el(parent, 'div', 'menu-root inventory hidden');
    const panel = el(this.root, 'div', 'menu');
    el(panel, 'div', 'menu-heading', 'Blocks');
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
    this.help = el(panel, 'p', 'menu-help');
  }

  get open(): boolean {
    return this.isOpen;
  }

  show(slot: number, holding: Block): void {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.refresh(slot, holding);
  }

  hide(): void {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }

  /** The selected slot (0-based) and the block in it changed. */
  refresh(slot: number, holding: Block): void {
    for (const [b, cell] of this.cells) cell.classList.toggle('selected', b === holding);
    this.help.textContent = `Click a block to put it in slot ${slot + 1} · 1–9 pick the slot · E, Tab or Esc close`;
  }
}
