import { describe, expect, it } from 'vitest';
import { Block } from '../src/world/blocks';
import { CHUNK_SIZE, chunkKey } from '../src/world/coords';
import { ALL_CONNECTED, chunkConnectivity, connects, reachableChunks } from '../src/world/visibility';

const S = CHUNK_SIZE;
const at = (x: number, y: number, z: number) => (y * S + z) * S + x;
const stone = () => new Uint8Array(S * S * S).fill(Block.Stone);
const [NX, PX, NY, PY, NZ, PZ] = [0, 1, 2, 3, 4, 5];
/** Every pair of faces a mask connects, as "a-b" strings. */
const pairs = (mask: number) => {
  const out: string[] = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) if (connects(mask, a, b)) out.push(`${a}-${b}`);
  return out;
};

describe('chunk connectivity', () => {
  it('is everything for open air and nothing for solid stone', () => {
    expect(chunkConnectivity(new Uint8Array(S * S * S))).toBe(ALL_CONNECTED);
    expect(chunkConnectivity(stone())).toBe(0);
  });

  it('connects exactly the faces a tunnel opens onto', () => {
    const straight = stone();
    for (let x = 0; x < S; x++) straight[at(x, 16, 16)] = Block.Air;
    expect(pairs(chunkConnectivity(straight))).toEqual([`${NX}-${PX}`]);

    const bend = stone(); // in from -x, turning to leave by +z
    for (let x = 0; x <= 10; x++) bend[at(x, 5, 10)] = Block.Air;
    for (let z = 10; z < S; z++) bend[at(10, 5, z)] = Block.Air;
    expect(pairs(chunkConnectivity(bend))).toEqual([`${NX}-${PZ}`]);
  });

  it('keeps separate tunnels separate', () => {
    const two = stone();
    for (let x = 0; x < S; x++) two[at(x, 4, 4)] = Block.Air; // along x
    for (let y = 0; y < S; y++) two[at(20, y, 20)] = Block.Air; // up and down, elsewhere
    expect(pairs(chunkConnectivity(two))).toEqual([`${NX}-${PX}`, `${NY}-${PY}`]);
    const pocket = stone(); // open, but touching no face
    pocket[at(10, 10, 10)] = Block.Air;
    expect(chunkConnectivity(pocket)).toBe(0);
  });

  it('sees through water, glass and leaves, not through planks', () => {
    for (const [block, open] of [[Block.Water, true], [Block.Glass, true], [Block.Leaves, true], [Block.Planks, false]] as const) {
      const c = stone();
      for (let z = 0; z < S; z++) c[at(7, 7, z)] = block;
      expect(connects(chunkConnectivity(c), NZ, PZ), Block[block]).toBe(open);
    }
  });
});

describe('the walk', () => {
  /** A world of chunks with given masks (default: open); range a box around the origin. */
  const walk = (start: [number, number, number], masks: Record<string, number>, size = 3) =>
    reachableChunks(
      start,
      (x, y, z) => Math.abs(x) <= size && Math.abs(z) <= size && y >= 0 && y <= size,
      (x, y, z) => masks[chunkKey(x, y, z)] ?? ALL_CONNECTED,
    );
  /** Masks making every chunk at height y solid, for each y listed. */
  const solidLayers = (...ys: number[]) => {
    const m: Record<string, number> = {};
    for (const y of ys) for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) m[chunkKey(x, y, z)] = 0;
    return m;
  };

  it('reaches everything through open space', () => {
    expect(walk([0, 2, 0], {}).size).toBe(7 * 7 * 4);
  });

  it('sees the surface layer from above, nothing under it', () => {
    const seen = walk([0, 3, 0], solidLayers(0, 1, 2));
    expect(seen.has(chunkKey(2, 2, -1))).toBe(true); // its top faces are in view
    expect(seen.has(chunkKey(2, 1, -1))).toBe(false);
    expect(seen.has(chunkKey(0, 0, 0))).toBe(false);
  });

  it('goes down a shaft that opens through a chunk', () => {
    const masks = solidLayers(0, 1, 2);
    // A shaft: (1, 2, 1) and (1, 1, 1) open from top to bottom.
    const shaft = (() => {
      const c = stone();
      for (let y = 0; y < S; y++) c[at(16, y, 16)] = Block.Air;
      return chunkConnectivity(c);
    })();
    masks[chunkKey(1, 2, 1)] = shaft;
    masks[chunkKey(1, 1, 1)] = shaft;
    const seen = walk([1, 3, 1], masks);
    expect(seen.has(chunkKey(1, 0, 1))).toBe(true);
    expect(seen.has(chunkKey(2, 0, 1))).toBe(false);
  });

  it('never turns back towards where it started', () => {
    // From (0, 2, 0): out along +x, down two chunks, then back along -x under the start. The
    // chunk under the start is solid, so the only way to (0, 0, 0) is that U-turn.
    const masks = solidLayers(0, 1);
    masks[chunkKey(0, 1, 0)] = 0;
    const down = (() => {
      const c = stone();
      for (let x = 0; x <= 16; x++) c[at(x, 16, 16)] = Block.Air;
      for (let y = 0; y <= 16; y++) c[at(16, y, 16)] = Block.Air;
      return chunkConnectivity(c); // -x to -y
    })();
    const shaft = (() => {
      const c = stone();
      for (let y = 0; y < S; y++) c[at(16, y, 16)] = Block.Air;
      return chunkConnectivity(c);
    })();
    const back = (() => {
      const c = stone();
      for (let y = 16; y < S; y++) c[at(16, y, 16)] = Block.Air;
      for (let x = 0; x <= 16; x++) c[at(x, 16, 16)] = Block.Air;
      return chunkConnectivity(c); // +y to -x
    })();
    masks[chunkKey(1, 2, 0)] = down;
    masks[chunkKey(1, 1, 0)] = shaft;
    masks[chunkKey(1, 0, 0)] = back;
    const seen = walk([0, 2, 0], masks);
    expect(seen.has(chunkKey(1, 0, 0))).toBe(true); // down the shaft is fine
    expect(seen.has(chunkKey(0, 0, 0))).toBe(false); // back under the start is not
  });
});
