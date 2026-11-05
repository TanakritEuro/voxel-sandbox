// Items on the ground on the wire, host → guests: what a guest needs to draw one and ask for it,
// 6 float32s an item (24 bytes): its id, what it is, how many, and where. Pure.

import { isItem, itemInfo } from '../survival/items';

/** An item lying on the host's ground, as a guest hears of it. */
export interface GroundSnap {
  id: number;
  item: number;
  count: number;
  x: number;
  y: number;
  z: number;
}

const FLOATS = 6;
/** Far beyond the world: a number like this is junk. */
const FAR = 2 ** 21;

export function packGround(items: readonly { id: number; item: number; count: number; body: { x: number; y: number; z: number } }[]): ArrayBuffer {
  const out = new Float32Array(items.length * FLOATS);
  items.forEach((g, i) => out.set([g.id, g.item, g.count, g.body.x, g.body.y, g.body.z], i * FLOATS));
  return out.buffer;
}

/** What `packGround` packed; null if any of it isn't an item lying somewhere. */
export function unpackGround(data: ArrayBuffer): GroundSnap[] | null {
  if (data.byteLength % (FLOATS * 4) !== 0) return null;
  const v = new Float32Array(data);
  const out: GroundSnap[] = [];
  for (let i = 0; i < v.length; i += FLOATS) {
    const [id, item, count, x, y, z] = v.subarray(i, i + FLOATS);
    if (!v.subarray(i, i + FLOATS).every(Number.isFinite)) return null;
    if (!Number.isInteger(id) || id < 0 || !Number.isInteger(item) || !isItem(item)) return null;
    if (!Number.isInteger(count) || count < 1 || count > itemInfo(item).stack) return null;
    if (Math.abs(x) > FAR || Math.abs(z) > FAR || Math.abs(y) > 1024) return null;
    out.push({ id, item, count, x, y, z });
  }
  return out;
}
