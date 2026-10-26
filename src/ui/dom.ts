// Tiny DOM helpers for the menus.

/** A new element in `parent`, with classes and text. */
export function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  parent.append(e);
  return e;
}

/** A button in `parent` that runs `onClick`. */
export function button(parent: HTMLElement, label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el(parent, 'button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A labelled text field in `parent`; Enter runs `onEnter`, Escape `onEscape`. */
export function field(parent: HTMLElement, label: string, value: string, placeholder: string, onEnter: () => void, onEscape: () => void): HTMLInputElement {
  const row = el(parent, 'label', 'menu-field');
  el(row, 'span', 'menu-label', label);
  const input = el(row, 'input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = 40;
  input.spellcheck = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onEnter();
    if (e.key === 'Escape') onEscape();
  });
  return input;
}
