// Keyboard and mouse: which keys and buttons are held, presses kept until something takes
// them (so a tap shorter than a physics step still counts), and mouse look with pointer
// lock. Mouse buttons are codes too: 'Mouse0' (left), 'Mouse2' (right).

import { TUNING } from './config';

/** What the player reads from the input (an interface, so tests can drive the player without a DOM). */
export interface Controls {
  yaw: number;
  pitch: number;
  isHeld(code: string): boolean;
  axis(code: string): number;
  take(code: string): boolean;
}

export class Input implements Controls {
  /** Facing, radians; 0 looks along -z. */
  yaw = 0;
  /** Up and down, radians, within ±89°. */
  pitch = -0.25;
  /** Moving the mouse up looks down (a setting). */
  invertY = false;
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('click', () => this.lock());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = TUNING.fly.mouseSensitivity;
      this.yaw -= e.movementX * s;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * s * (this.invertY ? -1 : 1)));
    });
    window.addEventListener('keydown', (e) => {
      // Keys count only with the mouse captured (otherwise a menu is up).
      if (!this.locked) return;
      // Space would scroll; Ctrl+S, D and A (save, bookmark, select all) would fire while
      // sprinting. Ctrl+W can't be stopped: browsers keep it for closing the tab.
      if (e.code === 'Space' || (e.ctrlKey && ['KeyS', 'KeyD', 'KeyA'].includes(e.code))) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    // Buttons count only with the mouse captured: the click that captures it does nothing else.
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.pressed.add(`Mouse${e.button}`);
      this.held.add(`Mouse${e.button}`);
    });
    document.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) return;
      this.held.clear();
      this.pressed.clear();
    });
  }

  /** Capture the mouse (from a click). */
  lock(): void {
    // Some embedded browsers refuse, and browsers refuse for a moment after Esc; say so rather
    // than leave an unhandled rejection.
    if (!this.locked) this.canvas.requestPointerLock().catch((e: Error) => console.warn('Pointer lock refused:', e.message));
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Is the key down now? */
  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  /** 1 if the key is down, else 0: for building axes like `axis('KeyW') - axis('KeyS')`. */
  axis(code: string): number {
    return this.held.has(code) ? 1 : 0;
  }

  /** Was the key pressed since the last time this was asked? Each press is taken once. */
  take(code: string): boolean {
    return this.pressed.delete(code);
  }
}
