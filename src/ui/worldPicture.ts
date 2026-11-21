// A world's picture on its card in the world list (Milestone 20): the small screenshot taken when it was
// last saved and quit (its record's `thumb`), or, for a world never quit from, a little landscape drawn
// from its seed: sky, far hills, near hills of grass and earth, the sea where the land dips. `seedScene`
// is pure (RGBA bytes, for tests); `worldPicture` makes a data URL of it.

import { createRng } from '../math';

export const PICTURE_W = 96;
export const PICTURE_H = 54;

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const SKY_TOP: RGB = [111, 166, 221];
const SKY_LOW: RGB = [207, 230, 247];
const FAR: RGB = [127, 159, 184];
const GRASS: RGB = [106, 168, 79];
const GRASS_TOP: RGB = [140, 198, 104];
const EARTH: RGB = [134, 96, 62];
const SEA: RGB = [58, 120, 201];

/** A row of hill heights (pixels from the top) from three waves with seeded phases, stepped into blocks. */
function hills(rng: () => number, w: number, base: number, size: number, block: number): number[] {
  const waves = [0, 1, 2].map((i) => ({ k: (0.04 + rng() * 0.05) * (i + 1), phase: rng() * Math.PI * 2, a: size / (i + 1.5) }));
  const out: number[] = [];
  for (let x = 0; x < w; x++) {
    const bx = Math.floor(x / block) * block;
    let y = base;
    for (const v of waves) y += Math.sin(bx * v.k + v.phase) * v.a;
    out.push(Math.round(y));
  }
  return out;
}

/** The seed's landscape, `PICTURE_W` x `PICTURE_H`, as RGBA bytes (row 0 at the top). */
export function seedScene(seed: number): Uint8Array {
  const w = PICTURE_W;
  const h = PICTURE_H;
  const rng = createRng(seed >>> 0 || 1);
  const far = hills(rng, w, h * 0.5, h * 0.12, 2);
  const near = hills(rng, w, h * 0.66, h * 0.16, 3);
  const sea = Math.round(h * 0.72);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c: RGB = mix(SKY_TOP, SKY_LOW, y / (h * 0.62));
      if (y >= far[x]) c = mix(FAR, SKY_LOW, 0.25);
      if (y >= sea && y < near[x]) c = y === sea ? mix(SEA, SKY_LOW, 0.35) : SEA;
      if (y >= near[x]) c = y === near[x] ? GRASS_TOP : y - near[x] < 3 ? GRASS : EARTH;
      const i = (y * w + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  return out;
}

/** The picture for a world: its screenshot if it has one, else its seed's landscape as a data URL. */
export function worldPicture(seed: number, thumb: string | undefined): string {
  if (thumb) return thumb;
  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_W;
  canvas.height = PICTURE_H;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(seedScene(seed)), PICTURE_W, PICTURE_H), 0, 0);
  return canvas.toDataURL();
}
