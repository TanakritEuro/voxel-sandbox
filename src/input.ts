// Keyboard and mouse: which keys and buttons are held, presses kept until something takes
// them (so a tap shorter than a physics step still counts), and mouse look with pointer
// lock. Mouse buttons are codes too: 'Mouse0' (left), 'Mouse2' (right).

import { TUNING } from './config';

/** A mouse move bigger than this (px in one event)... */
const SPIKE_PX = 200;
/** ...and this many times the biggest of the few before it is a spike. */
const SPIKE_RATIO = 6;

/**
 * Chrome on Windows, with pointer lock and the system's mouse acceleration, sometimes reports
 * one move of hundreds of pixels in the middle of a quick turn, which snaps the view (seen in
 * a playtest: 722 px between moves of 23–67). Raw input (`unadjustedMovement`) doesn't do it;
 * without raw input, such moves are dropped. Every move counts as one of the recent ones,
 * dropped or not, so a real flick loses at most its first event.
 */
export class SpikeFilter {
  private readonly recent = [0, 0, 0];
  private next = 0;
  /** Moves dropped so far. */
  dropped = 0;

  /** Whether to use this move. */
  accept(dx: number, dy: number): boolean {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    const before = Math.max(this.recent[0], this.recent[1], this.recent[2], 10);
    this.recent[this.next] = size;
    this.next = (this.next + 1) % this.recent.length;
    const spike = size > SPIKE_PX && size > SPIKE_RATIO * before;
    if (spike) this.dropped++;
    return !spike;
  }
}

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
  /** The biggest mouse move in one event (px), since `takeBiggestMove` and since the mouse was first captured: for `?stats`. */
  private biggestMove = 0;
  biggestMoveEver = 0;
  /** The mouse is captured with raw input (no system acceleration, no spikes). */
  raw = false;
  readonly spikes = new SpikeFilter();
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('click', () => this.lock());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const size = Math.max(Math.abs(e.movementX), Math.abs(e.movementY));
      this.biggestMove = Math.max(this.biggestMove, size);
      this.biggestMoveEver = Math.max(this.biggestMoveEver, size);
      if (!this.raw && !this.spikes.accept(e.movementX, e.movementY)) return;
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
    if (this.locked) return;
    // Raw input where the browser has it (see `SpikeFilter`); otherwise the plain kind. Some
    // embedded browsers refuse, and browsers refuse for a moment after Esc; say so rather than
    // leave an unhandled rejection.
    const refused = (e: Error) => console.warn('Pointer lock refused:', e.message);
    this.canvas.requestPointerLock({ unadjustedMovement: true }).then(
      () => (this.raw = true),
      () => {
        this.raw = false;
        this.canvas.requestPointerLock().catch(refused);
      },
    );
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** The biggest mouse move in one event since the last call (px). */
  takeBiggestMove(): number {
    const m = this.biggestMove;
    this.biggestMove = 0;
    return m;
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
