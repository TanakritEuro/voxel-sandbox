import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { decodeRle, encodeRle } from '../src/save/rle';
import { Block } from '../src/world/blocks';
import { CHUNK_VOLUME, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { Generator } from '../src/world/generate';

const roundTrip = (blocks: Uint8Array) => {
  const data = encodeRle(blocks);
  expect(decodeRle(data)).toEqual(blocks);
  return data;
};

describe('RLE', () => {
  it('round-trips all air and all one block in a few bytes', () => {
    expect(roundTrip(new Uint8Array(CHUNK_VOLUME)).length).toBe(4); // 32768 as a 3-byte varint, then the block
    expect(roundTrip(new Uint8Array(CHUNK_VOLUME).fill(Block.Stone)).length).toBe(4);
  });

  it('round-trips random blocks, short runs and runs across varint sizes', () => {
    const rng = createRng(5);
    roundTrip(Uint8Array.from({ length: CHUNK_VOLUME }, () => Math.floor(rng() * 23)));
    roundTrip(Uint8Array.from({ length: CHUNK_VOLUME }, (_, i) => (i % 2 ? Block.Dirt : Block.Stone)));
    // Runs of 1, 127, 128, 255, 256, 16383, 16384 and the rest.
    const blocks = new Uint8Array(CHUNK_VOLUME);
    let at = 0;
    let b = 1;
    for (const run of [1, 127, 128, 255, 256, 16383]) {
      blocks.fill(b, at, at + run);
      at += run;
      b = (b % 20) + 1;
    }
    blocks.fill(b, at);
    roundTrip(blocks);
  });

  it('round-trips generated chunks and shrinks them', () => {
    const column = new Generator(20261022).generateColumn(3, -2, MIN_CHUNK_Y, MAX_CHUNK_Y);
    let raw = 0;
    let packed = 0;
    for (const chunk of column) {
      if (!chunk) continue;
      raw += chunk.length;
      packed += roundTrip(chunk).length;
    }
    expect(raw).toBeGreaterThan(0);
    expect(packed).toBeLessThan(raw / 4);
  });

  it('rejects data that is not exactly one chunk', () => {
    const data = encodeRle(new Uint8Array(CHUNK_VOLUME));
    expect(() => decodeRle(data.subarray(0, 3))).toThrow();
    expect(() => decodeRle(new Uint8Array([...data, 1, 1]))).toThrow();
    expect(() => decodeRle(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 1]))).toThrow();
  });
});
