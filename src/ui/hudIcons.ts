// The HUD's small pictures (Milestone 20): health as red gems, hunger as loaves of bread, air as
// bubbles, each full, half or empty, drawn from masks as the item art is (`render/itemIcons.ts`).
// `hudArt` is pure (RGBA bytes, for tests); `hudIcons` makes data URLs of them for the page. All invented.

export type HudIcon = 'health' | 'hunger' | 'air';
export type Fill = 'full' | 'half' | 'empty';

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** A kind's colours: o outline, l light, m main, d dark, w a white glint. */
interface Palette {
  o: RGB;
  l: RGB;
  m: RGB;
  d: RGB;
  w: RGB;
}
const palette = (o: number, l: number, m: number, d: number, w: number): Palette => ({ o: hex(o), l: hex(l), m: hex(m), d: hex(d), w: hex(w) });

const FULL: Record<HudIcon, Palette> = {
  health: palette(0x1a080a, 0xf28a8d, 0xe0393e, 0x9e1f24, 0xffffff),
  hunger: palette(0x221206, 0xf0b870, 0xd08a3a, 0x8a5420, 0xfff0c8),
  air: palette(0x0c2232, 0xe4f6ff, 0x9fdcff, 0x5aa8d8, 0xffffff),
};
/** What's used up: the shape kept, dark and dull. */
const EMPTY: Record<HudIcon, Palette> = {
  health: palette(0x1a080a, 0x4a2226, 0x3a1a1e, 0x2c1316, 0x4a2226),
  hunger: palette(0x221206, 0x4a3524, 0x3c2a1c, 0x2e2015, 0x4a3524),
  air: palette(0x0c2232, 0x29404e, 0x213642, 0x1a2c36, 0x29404e),
};

// Masks, row 0 at the top: '.' clear, o l m d w the palette's colours.
const MASKS: Record<HudIcon, readonly string[]> = {
  // A cut gem, lit from the top left.
  health: [
    '....o....', //
    '...owo...',
    '..olllo..',
    '.ollmmmo.',
    'ollmmmmdo',
    '.olmmmdo.',
    '..ommdo..',
    '...odo...',
    '....o....',
  ],
  // A loaf, scored along the top.
  hunger: [
    '..oooooo..', //
    '.olwllllo.',
    'ollmlmlmdo',
    'olmmmmmmdo',
    'ommmmmmmdo',
    'oddddddddo',
    '.oooooooo.',
  ],
  // A bubble with a glint.
  air: [
    '..oooo..', //
    '.ollmmo.',
    'olwmmmmo',
    'olmmmmmo',
    'ommmmmmo',
    'ommmmmdo',
    '.ommddo.',
    '..oooo..',
  ],
};

/** The size of a kind's picture in pixels. */
export function hudSize(kind: HudIcon): [number, number] {
  const mask = MASKS[kind];
  return [mask[0].length, mask.length];
}

/**
 * A kind's picture, full, half or empty, as RGBA bytes (row 0 at the top). Half fills the left half, or
 * the right half when `fromRight` (hunger empties from the left as its row fills from the right).
 */
export function hudArt(kind: HudIcon, fill: Fill, fromRight = false): Uint8Array {
  const mask = MASKS[kind];
  const [w, h] = hudSize(kind);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = mask[y][x];
      if (c === '.') continue;
      const filled = fill === 'full' || (fill === 'half' && (fromRight ? x >= w / 2 : x < w / 2));
      const rgb = (filled ? FULL : EMPTY)[kind][c as keyof Palette];
      const i = (y * w + x) * 4;
      out[i] = rgb[0];
      out[i + 1] = rgb[1];
      out[i + 2] = rgb[2];
      out[i + 3] = 255;
    }
  return out;
}

/** Every kind's pictures as data URLs, by `${kind}-${fill}`, for the page. */
export function hudIcons(): Map<string, string> {
  const out = new Map<string, string>();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  for (const kind of Object.keys(MASKS) as HudIcon[]) {
    const [w, h] = hudSize(kind);
    canvas.width = w;
    canvas.height = h;
    for (const fill of ['full', 'half', 'empty'] as Fill[]) {
      ctx.clearRect(0, 0, w, h);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(hudArt(kind, fill, kind === 'hunger')), w, h), 0, 0);
      out.set(`${kind}-${fill}`, canvas.toDataURL());
    }
  }
  return out;
}
