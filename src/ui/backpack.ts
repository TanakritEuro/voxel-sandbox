// The survival inventory screen (E or Tab in a survival world): the 27 slots above the hotbar's 9,
// and crafting beside them; or, opened from a furnace, the furnace in place of crafting. A click
// picks up a stack (it follows the pointer) and a click on a slot puts it down, merges or swaps; a
// right click picks up half or puts down one; Shift and a click moves a stack between the hotbar and
// the rest (with a furnace open: into the furnace, fuel to its fuel and the rest to be smelted, and
// back out). Each recipe is a button, bright when it can be made: a click makes it once, Shift and
// a click as many times as it can. A furnace's output only gives; its fuel slot takes only fuel.
// Closing with a stack picked up puts it back. Plain DOM, as the picker is.

import { TUNING } from '../config';
import { canMake, make, RECIPES, type Recipe } from '../survival/crafting';
import { FUEL, Furnace, FUELS, INPUT, OUTPUT, SMELTS } from '../survival/furnace';
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
  private readonly crafting: HTMLDivElement;
  private readonly furnacePart: HTMLDivElement;
  private readonly furnaceEls: HTMLButtonElement[] = [];
  private readonly flame: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly cursor: HTMLDivElement;
  private held: Stack | null = null;
  private isOpen = false;
  /** The furnace open, if the screen was opened from one. */
  private furnace: Furnace | null = null;
  /** What the furnace part shows now, so it's redrawn only when that changes. */
  private furnaceShown = '';

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
    for (let i = 0; i < SLOTS; i++) this.slotEls[i] = this.slotButton(i < HOTBAR_SLOTS ? bar : pack, (e) => this.click(i, e.button === 2, e.shiftKey));
    el(left, 'p', 'menu-help', 'Click: pick up, put down · Right click: half, or one · Shift click: to or from the hotbar · E, Tab or Esc close');
    // Crafting, or a furnace.
    this.crafting = el(columns, 'div', 'backpack-right');
    el(this.crafting, 'div', 'menu-heading', 'Crafting');
    const list = el(this.crafting, 'div', 'recipe-list');
    for (const recipe of RECIPES) this.recipeEls.push(this.recipeButton(list, recipe));
    el(this.crafting, 'p', 'menu-help', 'Click: make one · Shift click: as many as you can');
    this.furnacePart = el(columns, 'div', 'backpack-right hidden');
    el(this.furnacePart, 'div', 'menu-heading', 'Furnace');
    const works = el(this.furnacePart, 'div', 'furnace-works');
    const ins = el(works, 'div', 'furnace-column');
    this.furnaceEls[INPUT] = this.slotButton(ins, (e) => this.clickFurnace(INPUT, e.button === 2, e.shiftKey));
    this.flame = el(el(ins, 'div', 'furnace-flame'), 'div');
    this.furnaceEls[FUEL] = this.slotButton(ins, (e) => this.clickFurnace(FUEL, e.button === 2, e.shiftKey));
    this.arrow = el(el(works, 'div', 'furnace-arrow'), 'div');
    this.furnaceEls[OUTPUT] = this.slotButton(works, (e) => this.clickFurnace(OUTPUT, e.button === 2, e.shiftKey));
    el(this.furnacePart, 'p', 'menu-help', 'Top: what to smelt (raw copper, raw iron, sand). Bottom: fuel (coal, wood, planks, sticks). Shift click puts things in and takes them out.');
    this.cursor = el(this.root, 'div', 'backpack-cursor slot');
    this.root.addEventListener('mousemove', (e) => this.follow(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get open(): boolean {
    return this.isOpen;
  }

  /** The furnace this screen shows, if it was opened from one. */
  get showing(): Furnace | null {
    return this.isOpen ? this.furnace : null;
  }

  /** Open it with crafting beside the inventory, or with `furnace`. */
  show(furnace: Furnace | null = null): void {
    this.isOpen = true;
    this.furnace = furnace;
    this.furnaceShown = '';
    this.crafting.classList.toggle('hidden', furnace !== null);
    this.furnacePart.classList.toggle('hidden', furnace === null);
    this.root.classList.remove('hidden');
    this.refresh();
  }

  /** Close it; a stack picked up goes back into the inventory. */
  hide(): void {
    this.isOpen = false;
    this.furnace = null;
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
    this.tick();
  }

  /** Once a frame while open: the furnace's slots, flame and arrow, if they changed. */
  tick(): void {
    const f = this.furnace;
    if (!this.isOpen || !f) return;
    const flame = f.burnTotal > 0 ? Math.round((f.burn / f.burnTotal) * 100) : 0;
    const arrow = Math.round((f.progress / TUNING.survival.smeltSeconds) * 100);
    const key = `${JSON.stringify(f.slots.slots)},${flame},${arrow}`;
    if (key === this.furnaceShown) return;
    this.furnaceShown = key;
    f.slots.slots.forEach((s, i) => this.drawSlot(this.furnaceEls[i], s));
    this.flame.style.height = `${flame}%`;
    this.arrow.style.width = `${Math.min(100, arrow)}%`;
  }

  private slotButton(parent: HTMLElement, onClick: (e: MouseEvent) => void): HTMLButtonElement {
    const b = el(parent, 'button', 'slot');
    b.type = 'button';
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onClick(e);
    });
    return b;
  }

  private click(slot: number, right: boolean, shift: boolean): void {
    const inv = this.inventory;
    if (!this.held) {
      if (shift && !right) {
        if (!this.furnace || !this.intoFurnace(slot)) inv.shiftMove(slot);
      } else this.held = inv.pick(slot, right);
    } else this.held = inv.put(slot, this.held, right);
    this.refresh();
    this.events.changed();
  }

  /** Shift and a click on the inventory with a furnace open: the stack into its fuel or its input, if it fits there. */
  private intoFurnace(slot: number): boolean {
    const s = this.inventory.slots[slot];
    const f = this.furnace!;
    if (!s) return false;
    const target = FUELS.has(s.item) && this.fits(FUEL, s) ? FUEL : SMELTS.has(s.item) && this.fits(INPUT, s) ? INPUT : -1;
    if (target < 0) return false;
    this.inventory.slots[slot] = f.slots.put(target, this.inventory.pick(slot)!);
    return true;
  }

  /** Would `s` go onto furnace slot `slot` (empty, or the same item with room)? */
  private fits(slot: number, s: Stack): boolean {
    const t = this.furnace!.slots.slots[slot];
    return !t || (t.item === s.item && t.count < itemInfo(t.item).stack);
  }

  private clickFurnace(slot: number, right: boolean, shift: boolean): void {
    const f = this.furnace;
    if (!f) return;
    const there = f.slots.slots[slot];
    if (!this.held) {
      if (shift && !right && there) {
        // Out into the inventory, as much as fits.
        const left = this.inventory.add(there.item, there.count, there.wear);
        f.slots.slots[slot] = left ? { ...there, count: left } : null;
      } else this.held = f.slots.pick(slot, right);
    } else if (slot === OUTPUT) {
      // The output only gives: onto what's held, if it's the same.
      if (there && there.item === this.held.item) {
        const n = Math.min(there.count, itemInfo(there.item).stack - this.held.count);
        this.held = { ...this.held, count: this.held.count + n };
        f.slots.slots[OUTPUT] = there.count - n ? { ...there, count: there.count - n } : null;
      }
    } else if (Furnace.accepts(slot, this.held)) this.held = f.slots.put(slot, this.held, right);
    this.furnaceShown = '';
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
