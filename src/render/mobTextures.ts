// The mobs' textures: 16 × 16 pixel-art patterns painted in code at startup, in the style of the
// block textures (speckled, a few colours): fur, moss, faces with eyes, ears, wool, horn, shell.
// Each is its own small texture; `mobRenderer.ts` maps one onto a model's box, or a pair side by
// side (`sideAndFront`) onto a box with a face.

import * as THREE from 'three';
import { createRng, type Rng } from '../math';
import type { MobTexture } from '../mobs/models';

const SIZE = 16;
type RGB = [number, number, number];

const rgb = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const shade = ([r, g, b]: RGB, k: number): RGB => [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];

/** A texture painted pixel by pixel by `paint(x, y, rng)` (y down), with its own seeded noise. */
function painted(seed: number, paint: (x: number, y: number, rng: Rng) => RGB): THREE.DataTexture {
  const rng = createRng(seed);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = paint(x, y, rng);
      // Texture rows run bottom up: the painted top row goes last.
      data.set([Math.round(r), Math.round(g), Math.round(b), 255], ((SIZE - 1 - y) * SIZE + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Speckled colour: each pixel the base, lighter or darker by up to `variation`. */
const fur = (seed: number, base: number, variation = 0.25) => painted(seed, (_x, _y, r) => shade(rgb(base), 1 + (r() - 0.5) * variation));

/** A face: fur with two eyes (and a nose, if given) on it. */
function face(seed: number, base: number, eye: number, nose?: number, pupil?: number): THREE.DataTexture {
  return painted(seed, (x, y, r) => {
    const eyeAt = (y === 6 || y === 7) && (x === 4 || x === 5 || x === 10 || x === 11);
    if (eyeAt) return pupil !== undefined && (x === 5 || x === 10) && y === 7 ? rgb(pupil) : rgb(eye);
    if (nose !== undefined && (y === 10 || y === 11) && (x === 7 || x === 8)) return rgb(nose);
    return shade(rgb(base), 1 + (r() - 0.5) * 0.2);
  });
}

/**
 * Two textures side by side in one (32 × 16): a box's sides on the left, its front (a face) on
 * the right, so the box is drawn with one material, in one draw call, rather than one per face.
 */
export function sideAndFront(side: THREE.DataTexture, front: THREE.DataTexture): THREE.DataTexture {
  const a = side.image.data as Uint8Array;
  const b = front.image.data as Uint8Array;
  const data = new Uint8Array(SIZE * 2 * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    data.set(a.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * SIZE * 8);
    data.set(b.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * SIZE * 8 + SIZE * 4);
  }
  const texture = new THREE.DataTexture(data, SIZE * 2, SIZE, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Every mob texture, by name. Made once (they're shared by all the mobs). */
export function mobTextures(): Record<MobTexture, THREE.DataTexture> {
  return {
    mossFur: fur(1, 0x6b5a45),
    moss: painted(2, (x, y, r) => {
      // Two greens in soft clumps, the odd darker tuft.
      const clump = Math.sin(x * 1.3 + y * 0.7) + Math.sin(x * 0.6 - y * 1.1) > 0.4;
      return shade(rgb(clump ? 0x6f9a42 : 0x4d7a30), 1 + (r() - 0.5) * (r() < 0.1 ? 0.6 : 0.25));
    }),
    mossFace: face(3, 0x7d6a52, 0x1e1a16, 0x3a2e24),
    hopperFur: fur(4, 0xcbb894, 0.18),
    hopperFace: face(5, 0xd6c39e, 0x24201c, 0xd88a8a),
    hopperEar: painted(6, (x, _y, r) => (x >= 5 && x <= 10 ? rgb(0xe0a6a0) : shade(rgb(0xcbb894), 1 + (r() - 0.5) * 0.18))),
    goatWool: painted(7, (x, y, r) => {
      // Off-white wool with grey curls.
      const curl = (x * 7 + y * 3) % 5 === 0 || (x * 3 + y * 7) % 7 === 0;
      return shade(rgb(curl ? 0xc9c5bb : 0xe6e3dc), 1 + (r() - 0.5) * 0.12);
    }),
    goatFace: face(8, 0xd8d5ce, 0xc8902a, 0x6b5f55, 0x201c18),
    horn: painted(9, (_x, y, r) => shade(rgb(Math.floor(y / 2) % 2 ? 0x8a7d6a : 0x6e6252), 1 + (r() - 0.5) * 0.1)),
    hoof: fur(10, 0x3a332b, 0.2),
    shell: painted(11, (x, y, r) => {
      // Dark blue-green, a seam down the middle, a pale sheen across.
      if (x === 7 || x === 8) return rgb(0x1c2a34);
      const sheen = Math.abs(x - y * 0.6 - 3) < 1.2;
      return shade(rgb(sheen ? 0x5e8696 : 0x2f4a5c), 1 + (r() - 0.5) * 0.15);
    }),
    beetleFace: face(12, 0x1f2830, 0x9fc6d6),
    black: fur(13, 0x1c1c1c, 0.15),
  };
}
