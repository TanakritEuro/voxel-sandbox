// Showing the world's map (Milestone 18, `survival/map.ts`): a panel in the corner while a map is held
// (256 × 256 blocks round the player, 2 blocks a pixel), and the whole map full screen (N), zoomed with
// the wheel and dragged about. North is up; the player is an arrow the way they look. Each is painted
// only when shown, the panel a few times a second.

import type { WorldMap } from '../survival/map';
import { el } from '../ui/dom';

/** The panel's pixels a side (2 blocks each), and how often it's painted again (seconds). */
const PANEL = 128;
const PANEL_EVERY = 0.25;
/** The full-screen map's zooms: blocks a pixel. */
const ZOOMS = [0.5, 1, 2, 4, 8];

export class MapView {
  private readonly panel: HTMLCanvasElement;
  private readonly root: HTMLDivElement;
  private readonly full: HTMLCanvasElement;
  private readonly label: HTMLDivElement;
  private sincePanel = Number.POSITIVE_INFINITY;
  private zoom = 1;
  /** The full-screen map's middle, in blocks, while it's dragged away from the player. */
  private centre: [number, number] | null = null;
  private dragging: { x: number; y: number } | null = null;
  /** What the full-screen map shows round, painted again when it moves or zooms. */
  private player: [number, number, number] = [0, 0, 0];
  /** Painted again at once (zoomed, dragged, opened), or when the player has moved, at most every `PANEL_EVERY`. */
  private dirty = true;
  private moved = false;
  private sinceFull = 0;

  constructor(
    parent: HTMLElement,
    private readonly map: WorldMap,
    /** Called when the full-screen map closes (the game takes the mouse back). */
    private readonly onClose: () => void,
  ) {
    this.panel = el(parent, 'canvas', 'map-panel hidden');
    this.panel.width = this.panel.height = PANEL;
    this.root = el(document.body, 'div', 'map-root hidden');
    this.full = el(this.root, 'canvas', 'map-full');
    this.label = el(this.root, 'div', 'map-label');
    this.full.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, this.zoom + Math.sign(e.deltaY)));
      this.dirty = true;
    });
    this.full.addEventListener('mousedown', (e) => (this.dragging = { x: e.clientX, y: e.clientY }));
    window.addEventListener('mouseup', () => (this.dragging = null));
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.open) return;
      const scale = (ZOOMS[this.zoom] * this.full.width) / this.full.clientWidth;
      const [cx, cz] = this.centre ?? [this.player[0], this.player[1]];
      this.centre = [cx - (e.clientX - this.dragging.x) * scale, cz - (e.clientY - this.dragging.y) * scale];
      this.dragging = { x: e.clientX, y: e.clientY };
      this.dirty = true;
    });
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  /** Is the full-screen map up? */
  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Open the full-screen map, round the player. */
  show(): void {
    this.root.classList.remove('hidden');
    this.centre = null;
    this.dirty = true;
  }

  close(): void {
    if (!this.open) return;
    this.root.classList.add('hidden');
    this.onClose();
  }

  /**
   * Once a frame: the panel shown (and painted now and then) while `holding`, the full-screen map painted
   * when it has moved. (x, z) is where the player is, `yaw` the way they look.
   */
  update(dt: number, holding: boolean, x: number, z: number, yaw: number): void {
    this.panel.classList.toggle('hidden', !holding || this.open);
    this.sincePanel += dt;
    if (holding && !this.open && this.sincePanel >= PANEL_EVERY) {
      this.sincePanel = 0;
      this.paint(this.panel, x, z, 2, yaw, x, z);
    }
    if (!this.open) return;
    this.sinceFull += dt;
    // Moved since it was last painted.
    if (Math.abs(this.player[0] - x) > 0.5 || Math.abs(this.player[1] - z) > 0.5 || Math.abs(this.player[2] - yaw) > 0.05) this.moved = true;
    // The canvas a pixel for each screen pixel (at most 1024), so a zoom of a block a pixel is sharp.
    const size = Math.min(1024, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.85));
    if (this.full.width !== size) {
      this.full.width = this.full.height = size;
      this.dirty = true;
    }
    if (!this.dirty && !(this.moved && this.sinceFull >= PANEL_EVERY)) return;
    this.dirty = this.moved = false;
    this.sinceFull = 0;
    this.player = [x, z, yaw];
    const [cx, cz] = this.centre ?? [x, z];
    this.paint(this.full, cx, cz, ZOOMS[this.zoom], yaw, x, z);
    const blocks = Math.round(size * ZOOMS[this.zoom]);
    this.label.textContent = `${blocks} × ${blocks} blocks · ${this.map.size} columns explored · wheel to zoom, drag to look about, N or Esc to close`;
  }

  /** The map round (cx, cz) at `scale` blocks a pixel into `canvas`, the player at (px, pz) an arrow. */
  private paint(canvas: HTMLCanvasElement, cx: number, cz: number, scale: number, yaw: number, px: number, pz: number): void {
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(canvas.width, canvas.height);
    this.map.paint(image.data, canvas.width, canvas.height, cx, cz, scale);
    ctx.putImageData(image, 0, 0);
    // The arrow: where the player is, pointing the way they look (north up: -z is up the canvas).
    const ax = canvas.width / 2 + (px - cx) / scale;
    const ay = canvas.height / 2 + (pz - cz) / scale;
    const r = Math.max(4, canvas.width / 40);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.4);
    ctx.lineTo(r, r);
    ctx.lineTo(0, r * 0.4);
    ctx.lineTo(-r, r);
    ctx.closePath();
    ctx.fillStyle = '#f4f0e6';
    ctx.strokeStyle = '#3a2c1c';
    ctx.lineWidth = Math.max(1, r / 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
