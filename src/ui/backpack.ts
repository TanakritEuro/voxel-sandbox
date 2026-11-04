// The survival inventory screen (E or Tab in a survival world): the 27 slots above the hotbar's 9,
// and crafting beside them. A click picks up a stack (it follows the pointer) and a click on a slot
// puts it down, merges or swaps; a right click picks up half or puts down one; Shift and a click
// moves a stack between the hotbar and the rest. Each recipe is a button, bright when it can be
// made: a click makes it once, Shift and a click as many times as it can. Closing with a stack
// picked up puts it back. Plain DOM, as the picker is.

import { canMake, make, RECIPES, type Recipe } from '../survival/crafting';
import { HOTBAR_SLOTS, type Inventory, SLOTS, type Stack } from '../survival/inventory';
import { itemInfo } from '../survival/items';
import { el } from './dom';

export interface BackpackEvents {
  /** The inventory changed (a move or something made): the hotbar is drawn again. */
  changed(): void;
  /** What there was no room for when it closed (picked up, and nowhere to go). */
  lost(stack: Stack): void;
}

export class Backpack {
  private readonly root: HTMLDivElement;
  private readonly slotEls: HTMLButtonElement[] = [];
  private readonly recipeEls: HTMLButtonElement[] = [];
  private readonly cursor: HTMLDivElement;
  private held: Stack | null = null;
  private isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly inventory: Inventory,
    /** An item's icon (a data URL). */
    private readonly icon: (item: number) => string,
    private readonly events: BackpackEvents,
  ) {
    this.root = el(parent, 'div', 'menu-root backpack hidden');
    const panel = el(this.root, 'div', 'menu backpack-panel');
    const columns = el(panel, 'div', 'backpack-columns');
    const left = el(columns, 'div', 'backpack-left');
    el(left, 'div', 'menu-heading', 'Inventory');
    const pack = el(left, 'div', 'backpack-grid');
    const bar = el(left, 'div', 'backpack-grid backpack-hotbar');
    // The rest (slots 9–35) above, the hotbar (0–8) at the bottom, as on screen.
    for (let i = 0; i < SLOTS; i++) this.slotEls[i] = this.slotButton(i < HOTBAR_SLOTS ? bar : pack, i);
    el(left, 'p', 'menu-help', 'Click: pick up, put down · Right click: half, or one · Shift click: to or from the hotbar · E, Tab or Esc close');
    const right = el(columns, 'div', 'backpack-right');
    el(right, 'div', 'menu-heading', 'Crafting');
    const list = el(right, 'div', 'recipe-list');
    for (const recipe of RECIPES) this.recipeEls.push(this.recipeButton(list, recipe));
    el(right, 'p', 'menu-help', 'Click: make one · Shift click: as many as you can');
    this.cursor = el(this.root, 'div', 'backpack-cursor slot');
    this.root.addEventListener('mousemove', (e) => this.follow(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get open(): boolean {
    return this.isOpen;
  }

  show(): void {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.refresh();
  }

  /** Close it; a stack picked up goes back into the inventory. */
  hide(): void {
    this.isOpen = false;
    this.root.classList.add('hidden');
    if (this.held) {
      const left = this.inventory.add(this.held.item, this.held.count, this.held.wear);
      if (left) this.events.lost({ ...this.held, count: left });
      this.held = null;
      this.events.changed();
    }
  }

  /** Draw the slots, the stack picked up and which recipes can be made, as the inventory is now. */
  refresh(): void {
    this.inventory.slots.forEach((s, i) => this.drawSlot(this.slotEls[i], s));
    this.drawSlot(this.cursor, this.held);
    this.cursor.classList.toggle('hidden', !this.held);
    RECIPES.forEach((r, i) => this.recipeEls[i].classList.toggle('can', canMake(this.inventory, r)));
  }

  private slotButton(parent: HTMLElement, slot: number): HTMLButtonElement {
    const b = el(parent, 'button', 'slot');
    b.type = 'button';
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.click(slot, e.button === 2, e.shiftKey);
    });
    return b;
  }

  private click(slot: number, right: boolean, shift: boolean): void {
    const inv = this.inventory;
    if (!this.held) {
      if (shift && !right) inv.shiftMove(slot);
      else this.held = inv.pick(slot, right);
    } else this.held = inv.put(slot, this.held, right);
    this.refresh();
    this.events.changed();
  }

  private recipeButton(parent: HTMLElement, recipe: Recipe): HTMLButtonElement {
    const b = el(parent, 'button', 'recipe');
    b.type = 'button';
    const look = el(b, 'span', 'recipe-icon');
    look.style.backgroundImage = `url(${this.icon(recipe.makes)})`;
    const words = el(b, 'span', 'recipe-words');
    el(words, 'span', 'recipe-name', `${recipe.count > 1 ? `${recipe.count} × ` : ''}${itemInfo(recipe.makes).name}`);
    el(words, 'span', 'recipe-cost', recipe.cost.map(([item, n]) => `${itemInfo(item).name} × ${n}`).join(', '));
    b.addEventListener('click', (e) => {
      if (!make(this.inventory, recipe, e.shiftKey ? Infinity : 1)) return;
      this.refresh();
      this.events.changed();
    });
    return b;
  }

  private drawSlot(e: HTMLElement, s: Stack | null): void {
    if (!s) {
      e.replaceChildren();
      e.title = '';
      return;
    }
    const info = itemInfo(s.item);
    e.title = info.name;
    const look = document.createElement('span');
    look.style.backgroundImage = `url(${this.icon(s.item)})`;
    const parts: HTMLElement[] = [look];
    if (s.count > 1) {
      const count = document.createElement('b');
      count.textContent = String(s.count);
      parts.push(count);
    }
    if (info.tool) {
      const wear = document.createElement('i');
      wear.style.width = `${Math.round(100 * (1 - (s.wear ?? 0) / info.tool.wear))}%`;
      parts.push(wear);
    }
    e.replaceChildren(...parts);
  }

  /** The stack picked up follows the pointer. */
  private follow(e: MouseEvent): void {
    this.cursor.style.left = `${e.clientX - 22}px`;
    this.cursor.style.top = `${e.clientY - 22}px`;
  }
}
