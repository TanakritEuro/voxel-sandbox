// Run-length encoding of a chunk's blocks, for saving. Voxel data is mostly long runs of
// the same block along x (layers of stone, air, water), so a chunk shrinks from 32 KB to a
// few hundred bytes or a few KB. Pure, typed arrays only.
//
// Format: (run length, block) pairs over the chunk's blocks in index order; the length is a
// varint (7 bits a byte, low first, high bit set on all but the last), the block one byte.

import { CHUNK_VOLUME } from '../world/coords';

/** Encode a chunk's blocks (CHUNK_VOLUME bytes). */
export function encodeRle(blocks: Uint8Array): Uint8Array {
  // At worst every block is its own run: 2 bytes each.
  const out = new Uint8Array(blocks.length * 2);
  let at = 0;
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    let run = 1;
    while (i + run < blocks.length && blocks[i + run] === b) run++;
    i += run;
    while (run > 0x7f) {
      out[at++] = (run & 0x7f) | 0x80;
      run >>>= 7;
    }
    out[at++] = run;
    out[at++] = b;
  }
  return out.slice(0, at);
}

/** Decode what `encodeRle` made into `out`. Throws if it isn't exactly one chunk's worth. */
export function decodeRle(data: Uint8Array, out: Uint8Array = new Uint8Array(CHUNK_VOLUME)): Uint8Array {
  let i = 0;
  let at = 0;
  while (at < data.length) {
    let run = 0;
    let shift = 0;
    let byte: number;
    do {
      if (at >= data.length || shift > 28) throw new Error('RLE: bad run length');
      byte = data[at++];
      run |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    if (at >= data.length) throw new Error('RLE: run without a block');
    if (run === 0 || i + run > out.length) throw new Error('RLE: runs overflow the chunk');
    out.fill(data[at++], i, i + run);
    i += run;
  }
  if (i !== out.length) throw new Error(`RLE: ${i} blocks, expected ${out.length}`);
  return out;
}
