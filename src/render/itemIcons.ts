// Pictures for the items that aren't blocks (sticks, the metals, tools): 16 × 16 pixel art drawn
// from small masks, coloured by material with a little seeded speckle, as the block textures are.
// `itemArt` is pure (RGBA bytes, for tests and the held item's mesh); `itemIcons` makes them data
// URLs for the hotbar and the inventory screen. All invented.

import { createRng } from '../math';
import { Item } from '../survival/items';

const N = 16;

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** A material's colours: main, dark (edges, shadow) and light (highlights). */
interface Palette {
  m: RGB;
  d: RGB;
  l: RGB;
}
const palette = (m: number, d: number, l: number): Palette => ({ m: hex(m), d: hex(d), l: hex(l) });

const WOOD = palette(0xb88c55, 0x7d5a32, 0xd9ac72);
const STONE = palette(0x8a8d91, 0x5a5d61, 0xb0b3b7);
const IRON = palette(0xd6d8da, 0x8f9396, 0xffffff);
const COPPER = palette(0xd0703a, 0x8a4520, 0xf3a668);
const COAL = palette(0x2e2e30, 0x161617, 0x5a5a5e);
const CRYSTAL = palette(0x7fdcec, 0x2f8fa8, 0xe2fcff);
const HANDLE = palette(0x8a6238, 0x5a3d20, 0xa87c4c);
const RAW_MEAT = palette(0xd0545a, 0x8e2f35, 0xf2c2c4);
const COOKED_MEAT = palette(0x9a5a2e, 0x5c3418, 0xc9894f);
const BERRY = palette(0x7b2fa6, 0x3f1758, 0xc58ae6);
const EMBER = palette(0xff8a2a, 0x8a2a12, 0xfff0a0);
const RAW_COPPER = palette(0xb5683c, 0x6b6560, 0xe0925a);
const RAW_IRON = palette(0xb8a898, 0x6b6560, 0xe3d6c8);
const SEED = palette(0xa08a4a, 0x5e4f24, 0xd8c47a);
const GRAIN = palette(0xd8b54a, 0x8a6a1e, 0xf6e08a);
const CRUST = palette(0xc0803a, 0x7a4a1c, 0xe8b46a);
const MOSS = palette(0x5f8f3a, 0x35552a, 0x9cc46a);

// Masks, row 0 at the top: '.' empty, m/d/l the material's main, dark and light, h a handle.
const PICK = [
  '................',
  '...llmmmmmmmm...',
  '..lmmddddddmmd..',
  '.lmd...hh...dmd.',
  '.md....hh....dd.',
  '.d.....hh.....d.',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '................',
];
const AXE = [
  '................',
  '......hh.lmm....',
  '......hhlmmmmd..',
  '......hhmmmmmmd.',
  '......hhmmmmmmd.',
  '......hhmmmmmd..',
  '......hh.dddd...',
  '......hh........',
  '......hh........',
  '......hh........',
  '......hh........',
  '......hh........',
  '......hh........',
  '......hh........',
  '......hh........',
  '................',
];
const SPADE = [
  '................',
  '......lmmm......',
  '.....lmmmmmd....',
  '.....lmmmmmd....',
  '.....mmmmmmd....',
  '.....mmmmmmd....',
  '......dmmdd.....',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '................',
];
const MEAT = [
  '................',
  '................',
  '................',
  '......dddd......',
  '....ddmmmmdd....',
  '...dmmmllmmmd...',
  '..dmmllmmmmmmd..',
  '..dmmmmmmmlmmd..',
  '..dmmmmlmmmmmd..',
  '..dmlmmmmmmmd...',
  '...dmmmmmmmd....',
  '....ddmmmdd.....',
  '......ddd.......',
  '................',
  '................',
  '................',
];
const BERRIES = [
  '................',
  '.......hh.......',
  '........h.......',
  '.....dd.hdd.....',
  '....dlmd.dlmd...',
  '....dmmd.dmmd...',
  '.....dd.dd.dd...',
  '......ddlmd.....',
  '...dd.dmmmd.dd..',
  '..dlmd.ddd.dlmd.',
  '..dmmd.....dmmd.',
  '...dd.dd....dd..',
  '.....dlmd.......',
  '.....dmmd.......',
  '......dd........',
  '................',
];
const SEEDS = [
  '................',
  '................',
  '................',
  '.....dd.........',
  '....dlmd...dd...',
  '....dmmd..dlmd..',
  '.....dd...dmmd..',
  '...........dd...',
  '..dd....dd......',
  '.dlmd..dlmd.....',
  '.dmmd..dmmd..dd.',
  '..dd....dd..dlmd',
  '............dmmd',
  '.....dd......dd.',
  '....dlmd........',
  '.....dd.........',
];
/** A sheaf: ears at the top, stalks tied in the middle (h, the band). */
const SHEAF = [
  '................',
  '...l..l.l..l....',
  '..lml.lmlml.l...',
  '..dmlmmmlmmlml..',
  '...dmmdmmdmmd...',
  '....dmdmmdmd....',
  '.....mdmmdm.....',
  '......mmmm......',
  '.....hhhhhh.....',
  '......mmmm......',
  '.....dmmmmd.....',
  '....dm.mm.md....',
  '...dm..mm..md...',
  '..dm...mm...md..',
  '..d....dd....d..',
  '................',
];
const LOAF = [
  '................',
  '................',
  '................',
  '................',
  '.....llllll.....',
  '...llmmlmmlll...',
  '..lmmdmmdmmdml..',
  '.lmmmmmmmmmmmmd.',
  '.mmmmmmmmmmmmmd.',
  '.mmmmmmmmmmmmmd.',
  '.dmmmmmmmmmmmdd.',
  '..ddddddddddddd.',
  '................',
  '................',
  '................',
  '................',
];
/** A soft tuft, ragged at the edges. */
const TUFT = [
  '................',
  '................',
  '................',
  '......l..l......',
  '....dlmllmld....',
  '...dmmmlmmmmd...',
  '..dmlmmmmmlmmd..',
  '..mmmmmlmmmmmd..',
  '.dmmlmmmmmmlmmd.',
  '.dmmmmmmlmmmmmd.',
  '..dmmlmmmmmmmd..',
  '...ddmmmdmmdd...',
  '.....dd..dd.....',
  '................',
  '................',
  '................',
];
const LUMP = [
  '................',
  '................',
  '................',
  '................',
  '.....dddd.......',
  '....dmmlmdd.....',
  '...dmlmmmmmd....',
  '...dmmmmmlmmd...',
  '..dmmmmmmmmmd...',
  '..dmmlmmmmmmd...',
  '...dmmmmmmmd....',
  '....dddmmdd.....',
  '.......dd.......',
  '................',
  '................',
  '................',
];
const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '....llllllll....',
  '...lmmmmmmmmd...',
  '..lmmmmmmmmmmd..',
  '..mmmmmmmmmmmd..',
  '..ddddddddddd...',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const GEM = [
  '................',
  '................',
  '.......l........',
  '......lmm.......',
  '.....lmmmm......',
  '....lmmlmmd.....',
  '...lmmmmmmmd....',
  '...mmmmmmmmd....',
  '....mmmmmmd.....',
  '.....mmmmd......',
  '......mmd.......',
  '.......d........',
  '................',
  '................',
  '................',
  '................',
];
/** A stick: two pixels wide, corner to corner. */
const STICK = Array.from({ length: N }, (_, y) =>
  Array.from({ length: N }, (_, x) => {
    const t = 12 - y;
    if (t < 0 || t > 9) return '.';
    return x === 3 + t ? 'l' : x === 4 + t ? 'h' : '.';
  }).join(''),
);

const ART: Record<number, [string[], Palette]> = {
  [Item.Stick]: [STICK, HANDLE],
  [Item.Coal]: [LUMP, COAL],
  [Item.Copper]: [INGOT, COPPER],
  [Item.Iron]: [INGOT, IRON],
  [Item.Crystal]: [GEM, CRYSTAL],
  [Item.WoodPick]: [PICK, WOOD],
  [Item.WoodAxe]: [AXE, WOOD],
  [Item.WoodSpade]: [SPADE, WOOD],
  [Item.StonePick]: [PICK, STONE],
  [Item.StoneAxe]: [AXE, STONE],
  [Item.StoneSpade]: [SPADE, STONE],
  [Item.IronPick]: [PICK, IRON],
  [Item.IronAxe]: [AXE, IRON],
  [Item.IronSpade]: [SPADE, IRON],
  [Item.RawCopper]: [LUMP, RAW_COPPER],
  [Item.RawIron]: [LUMP, RAW_IRON],
  [Item.RawMeat]: [MEAT, RAW_MEAT],
  [Item.CookedMeat]: [MEAT, COOKED_MEAT],
  [Item.Berries]: [BERRIES, BERRY],
  [Item.Ember]: [LUMP, EMBER],
  [Item.Seeds]: [SEEDS, SEED],
  [Item.Wheat]: [SHEAF, GRAIN],
  [Item.Bread]: [LOAF, CRUST],
  [Item.Moss]: [TUFT, MOSS],
};

/** Item `item`'s picture: 16 × 16 RGBA, row 0 at the top, transparent where empty; null for a block (it has its own icon). */
export function itemArt(item: number): Uint8Array | null {
  const art = ART[item];
  if (!art) return null;
  const [mask, colours] = art;
  const out = new Uint8Array(N * N * 4);
  const rng = createRng(item * 7919);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = mask[y][x];
      if (c === '.') continue;
      // A handle's second column is in its shadow.
      const rgb = c === 'h' ? (mask[y][x - 1] === 'h' ? HANDLE.d : HANDLE.m) : colours[c as 'm' | 'd' | 'l'];
      const k = 0.92 + rng() * 0.16;
      const i = (y * N + x) * 4;
      out[i] = Math.min(255, Math.round(rgb[0] * k));
      out[i + 1] = Math.min(255, Math.round(rgb[1] * k));
      out[i + 2] = Math.min(255, Math.round(rgb[2] * k));
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Every non-block item's icon as a data URL, by item. */
export function itemIcons(): Map<number, string> {
  const icons = new Map<number, string>();
  for (const key of Object.keys(ART)) {
    const item = Number(key);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(itemArt(item)!), N, N), 0, 0);
    icons.set(item, canvas.toDataURL());
  }
  return icons;
}
