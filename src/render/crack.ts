// Cracks over a block being broken: one seeded pattern of branches wandering out from near
// the middle, shown a little more at each of the CRACK_STAGES, on a box just outside the
// block. Generated at startup (no image files).

import * as THREE from 'three';
import { createRng } from '../math';
import { CRACK_STAGES } from '../world/mining';

/** Texture size in pixels: pixel-art cracks, drawn without smoothing. */
export const CRACK_SIZE = 16;
const BRANCHES = 7;
const BRANCH_LENGTH = 11;

/**
 * The crack pattern as pixel indices (y * CRACK_SIZE + x) in the order they appear: the
 * branches grow together, one pixel each in turn, so earlier stages are shorter cracks.
 */
export function crackPixels(seed = 3): number[] {
  const rng = createRng(seed);
  const paths: number[][] = [];
  for (let b = 0; b < BRANCHES; b++) {
    let x = CRACK_SIZE / 2 - 1 + rng() * 2;
    let y = CRACK_SIZE / 2 - 1 + rng() * 2;
    let angle = (b / BRANCHES) * 2 * Math.PI + rng() * 0.6;
    const path: number[] = [];
    for (let i = 0; i < BRANCH_LENGTH; i++) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || py < 0 || px >= CRACK_SIZE || py >= CRACK_SIZE) break;
      path.push(py * CRACK_SIZE + px);
      angle += (rng() - 0.5) * 0.9;
      x += Math.cos(angle);
      y += Math.sin(angle);
    }
    paths.push(path);
  }
  const order: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < BRANCH_LENGTH; i++) {
    for (const path of paths) {
      const p = path[i];
      if (p === undefined || seen.has(p)) continue;
      seen.add(p);
      order.push(p);
    }
  }
  return order;
}

/** The pixels cracked at a stage (0 .. CRACK_STAGES - 1): the first part of the pattern. */
export function crackStage(stage: number, pixels = crackPixels()): number[] {
  return pixels.slice(0, Math.ceil((pixels.length * (stage + 1)) / CRACK_STAGES));
}

export class CrackOverlay {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly textures: THREE.Texture[] = [];

  constructor() {
    const pixels = crackPixels();
    for (let stage = 0; stage < CRACK_STAGES; stage++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = CRACK_SIZE;
      const ctx = canvas.getContext('2d')!;
      const image = ctx.createImageData(CRACK_SIZE, CRACK_SIZE);
      for (const p of crackStage(stage, pixels)) image.data.set([24, 20, 18, 210], p * 4);
      ctx.putImageData(image, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.push(texture);
    }
    this.material = new THREE.MeshBasicMaterial({
      map: this.textures[0],
      transparent: true,
      depthWrite: false,
      // Drawn just in front of the block's own faces, never fighting them.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.material);
    this.mesh.visible = false;
  }

  /** Show the cracks of `stage` on the block at `at`, or hide them (stage -1 or no block). */
  show(at: { x: number; y: number; z: number } | null, stage: number): void {
    this.mesh.visible = at !== null && stage >= 0;
    if (!at || stage < 0) return;
    this.mesh.position.set(at.x + 0.5, at.y + 0.5, at.z + 0.5);
    this.material.map = this.textures[stage];
  }
}
