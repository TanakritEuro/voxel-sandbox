// Tooltips on survival's slots (Milestone 20): an item's name, and what's worth knowing about it: a tool's
// uses left (with a bar), what food gives, what a furnace makes of it, how long it burns. `tooltipOf` is
// pure; `Tooltip` is the box following the pointer.

import { FUELS, SMELTS } from '../survival/furnace';
import type { Stack } from '../survival/inventory';
import { itemInfo } from '../survival/items';
import { el } from './dom';

export interface TooltipText {
  title: string;
  lines: string[];
  /** A tool's wear left, 0–1 (a bar under the lines). */
  left?: number;
}

/** What a stack's tooltip says. */
export function tooltipOf(stack: Stack): TooltipText {
  const info = itemInfo(stack.item);
  const out: TooltipText = { title: stack.count > 1 ? `${info.name} × ${stack.count}` : info.name, lines: [] };
  if (info.tool) {
    const left = Math.max(0, info.tool.wear - (stack.wear ?? 0));
    out.lines.push(`${left} of ${info.tool.wear} uses left`);
    out.left = left / info.tool.wear;
  }
  if (info.food) out.lines.push(`Eat for ${info.food} hunger`);
  const smelts = SMELTS.get(stack.item);
  if (smelts !== undefined) out.lines.push(`Smelts into ${itemInfo(smelts).name.toLowerCase()}`);
  const burns = FUELS.get(stack.item);
  if (burns !== undefined) out.lines.push(`Fuel: smelts ${burns} ${burns === 1 ? 'thing' : 'things'}`);
  return out;
}

/** The box: shown by a slot under the pointer, hidden as it leaves or a stack is picked up. */
export class Tooltip {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el(parent, 'div', 'tooltip hidden');
  }

  /**
   * Show what `stackAt` says over `slot` while the pointer is on it (and `quiet` doesn't say to keep
   * still: a stack is being carried).
   */
  attach(slot: HTMLElement, stackAt: () => Stack | null, quiet: () => boolean): void {
    slot.addEventListener('mousemove', (e) => {
      const s = stackAt();
      if (!s || quiet()) return this.hide();
      this.show(tooltipOf(s), e.clientX, e.clientY);
    });
    slot.addEventListener('mouseleave', () => this.hide());
    slot.addEventListener('mousedown', () => this.hide());
  }

  show(text: TooltipText, x: number, y: number): void {
    const r = this.root;
    r.replaceChildren();
    el(r, 'div', 'tooltip-title', text.title);
    for (const line of text.lines) el(r, 'div', 'tooltip-line', line);
    if (text.left !== undefined) {
      const bar = el(el(r, 'div', 'tooltip-bar'), 'div');
      bar.style.width = `${Math.round(text.left * 100)}%`;
      bar.classList.toggle('low', text.left < 0.25);
    }
    r.classList.remove('hidden');
    // Beside the pointer, kept on screen.
    const w = r.offsetWidth;
    const h = r.offsetHeight;
    r.style.left = `${Math.min(x + 16, window.innerWidth - w - 8)}px`;
    r.style.top = `${Math.max(8, Math.min(y - h - 10, window.innerHeight - h - 8))}px`;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
