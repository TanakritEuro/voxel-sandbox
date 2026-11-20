// Rails (Milestone 18): their shapes, how a rail joins the rails beside it as it's laid, and (for
// carts) its line through its block. Pure.
//
// A rail has two ends, each towards a side (`FACINGS`: 0 +x, 1 -x, 2 +z, 3 -z): straight along z or
// x, sloped (rising a block towards one end), or curved (a quarter turn joining two sides). Powered
// rails can't curve.
//
// Two rails are joined when each has an end towards the other, level with it, or with the lower one
// rising towards the higher (a rail beside it and a block up, or a block down).
//
// Laying a rail (`railPlacement`):
// 1. Each side's rail (level, a block up, or a block down, in that order) is a candidate if it
//    already has an end this way, or if it's open: joined at most once, so it can turn to join the
//    new one (keeping the end it has, rising towards the new rail if that's a block up from it).
// 2. The new rail joins two candidates if it can: those already pointing at it first, then a straight
//    pair, then a curve (not for powered rails); one alone it points at; none, it lies along the way
//    the player looks. It rises towards a candidate a block up.
// 3. Candidates that don't point at it yet turn to.
// So a straight line or a loop comes out the same whatever order its rails are laid in. Breaking a
// rail leaves the others as they are.

import { Block, FACINGS, poweredRail, rail, railOf } from './blocks';
import type { BlockSource } from './physics';

/** Each shape's two ends (`FACINGS` indices). */
export const RAIL_ENDS: readonly (readonly [number, number])[] = [
  [2, 3], // straight along z
  [0, 1], // straight along x
  [0, 1], // rising towards +x
  [1, 0], // rising towards -x
  [2, 3], // rising towards +z
  [3, 2], // rising towards -z
  [2, 0], // curve +z to +x
  [2, 1], // curve +z to -x
  [3, 1], // curve -z to -x
  [3, 0], // curve -z to +x
];

/** The side each shape rises towards, or -1 for level ones. */
export const RAIL_RISE: readonly number[] = [-1, -1, 0, 1, 2, 3, -1, -1, -1, -1];

/** The opposite side. */
const opposite = (d: number) => d ^ 1;

/** The shape with ends `a` and `b` (any order), rising towards `rise` (-1 for none); -1 if there's none such. */
export function shapeWith(a: number, b: number, rise = -1): number {
  if (a === b) return -1;
  if (rise >= 0) {
    if (opposite(a) !== b || (rise !== a && rise !== b)) return -1;
    return 2 + rise;
  }
  for (let s = 0; s < RAIL_ENDS.length; s++) {
    if (RAIL_RISE[s] >= 0) continue;
    const [e, f] = RAIL_ENDS[s];
    if ((e === a && f === b) || (e === b && f === a)) return s;
  }
  return -1;
}

/** The straight shape along side `d`'s axis, rising towards `d` if `rises`. */
const straightTowards = (d: number, rises: boolean) => (rises ? 2 + d : d < 2 ? 1 : 0);

type P = readonly [number, number, number];

/** Does shape `s` have an end towards `d`? */
const hasEnd = (s: number, d: number) => RAIL_ENDS[s][0] === d || RAIL_ENDS[s][1] === d;

/**
 * Do the rail at `p` (shape `s`) and the one at `q` (shape `t`) join through `p`'s end `d`? `q` must
 * be the block beside along `d`, level, one up (if `s` rises towards `d`), or one down (if `t` rises
 * towards `p`).
 */
function joinsAcross(p: P, s: number, d: number, q: P, t: number): boolean {
  if (!hasEnd(s, d) || !hasEnd(t, opposite(d))) return false;
  const [dx, dz] = FACINGS[d];
  if (q[0] !== p[0] + dx || q[2] !== p[2] + dz) return false;
  const dy = q[1] - p[1];
  if (dy === 0) return RAIL_RISE[s] !== d && RAIL_RISE[t] !== opposite(d);
  if (dy === 1) return RAIL_RISE[s] === d;
  if (dy === -1) return RAIL_RISE[t] === opposite(d);
  return false;
}

/** The rail beside `p` along `d` (level, a block up, a block down), and its shape; null if none. */
function besideAlong(blocks: BlockSource, p: P, d: number): { q: P; shape: number; powered: boolean } | null {
  const [dx, dz] = FACINGS[d];
  for (const dy of [0, 1, -1]) {
    const q: P = [p[0] + dx, p[1] + dy, p[2] + dz];
    const r = railOf(blocks.getBlock(q[0], q[1], q[2]));
    if (r) return { q, shape: r.shape, powered: r.powered };
  }
  return null;
}

/** Is the rail at `p` (shape `s`) joined through its end `d`? */
function joinedAt(blocks: BlockSource, p: P, s: number, d: number): boolean {
  if (!hasEnd(s, d)) return false;
  const n = besideAlong(blocks, p, d);
  return n !== null && joinsAcross(p, s, d, n.q, n.shape);
}

/**
 * The rail joined to the rail at (x, y, z) (shape `s`) through its end `d`: where it is and its shape
 * (it's entered through its end `d ^ 1`); null if that end isn't joined to anything.
 */
export function nextRail(blocks: BlockSource, x: number, y: number, z: number, s: number, d: number): { x: number; y: number; z: number; shape: number } | null {
  if (!hasEnd(s, d)) return null;
  const p: P = [x, y, z];
  const n = besideAlong(blocks, p, d);
  if (!n || !joinsAcross(p, s, d, n.q, n.shape)) return null;
  return { x: n.q[0], y: n.q[1], z: n.q[2], shape: n.shape };
}

/** The ends of the rail at `p` (shape `s`) that are joined to a rail. */
export function joinedEnds(blocks: BlockSource, p: P, s: number): number[] {
  return RAIL_ENDS[s].filter((d) => joinedAt(blocks, p, s, d));
}

/** A block to set: (x, y, z, block). */
export type RailChange = [number, number, number, Block];

/**
 * Laying a rail (`block`: a plain or powered rail, any shape) at (x, y, z) by a player looking along
 * the facing `facing` (`FACINGS`): the rail as it joins up, first, then each rail beside it that turns
 * to join it. The caller checks there's room and a floor.
 */
export function railPlacement(blocks: BlockSource, x: number, y: number, z: number, block: Block, facing: number): RailChange[] {
  const kind = railOf(block);
  if (!kind) return [];
  const p: P = [x, y, z];
  const make = (shape: number, powered: boolean, on: boolean) => (powered ? poweredRail(shape, on) : rail(shape));
  // 1. The candidates: the rail beside along each side, what it would turn into, and whether it points here already.
  interface Candidate {
    d: number;
    q: P;
    up: boolean;
    pointing: boolean;
    /** The block it becomes to join (its own if it points here already). */
    becomes: Block;
  }
  const candidates: Candidate[] = [];
  for (let d = 0; d < 4; d++) {
    const n = besideAlong(blocks, p, d);
    if (!n) continue;
    const back = opposite(d);
    const dy = n.q[1] - y;
    const r = railOf(blocks.getBlock(n.q[0], n.q[1], n.q[2]))!;
    // Pointing here already: an end this way, at a height that joins.
    const pointing = hasEnd(n.shape, back) && (dy === 0 ? RAIL_RISE[n.shape] !== back : dy === -1 ? RAIL_RISE[n.shape] === back : RAIL_RISE[n.shape] !== back);
    if (pointing) {
      candidates.push({ d, q: n.q, up: dy === 1, pointing: true, becomes: blocks.getBlock(n.q[0], n.q[1], n.q[2]) });
      continue;
    }
    // Open: joined at most once; it keeps that end and turns this way.
    const ends = joinedEnds(blocks, n.q, n.shape);
    if (ends.length > 1) continue;
    const keep = ends.length ? ends[0] : -1;
    // A block down from here, it rises towards this rail; a block up from here, it stays level
    // (this one rises to it) unless it already rises towards the end it keeps.
    let shape: number;
    if (dy === -1) shape = keep < 0 ? straightTowards(back, true) : shapeWith(keep, back, back);
    else if (keep < 0) shape = straightTowards(back, false);
    else shape = shapeWith(keep, back, RAIL_RISE[n.shape] === keep ? keep : -1);
    if (shape < 0 || (n.powered && shape >= 6)) continue;
    candidates.push({ d, q: n.q, up: dy === 1, pointing: false, becomes: make(shape, n.powered, r.on) });
  }
  // 2. The new rail's ends: pointing candidates first, then a straight pair, then a curve.
  const ordered = [...candidates.filter((c) => c.pointing), ...candidates.filter((c) => !c.pointing)];
  let chosen: Candidate[] = [];
  let shape = -1;
  const tryPair = (a: Candidate, b: Candidate) => {
    if (a.up && b.up) return -1;
    const s = shapeWith(a.d, b.d, a.up ? a.d : b.up ? b.d : -1);
    return s < 0 || (kind.powered && s >= 6) ? -1 : s;
  };
  // Pairs in order of preference: both pointing, then straight before curved, earlier candidates first.
  const pairs: [Candidate, Candidate, number][] = [];
  for (let i = 0; i < ordered.length; i++)
    for (let j = i + 1; j < ordered.length; j++) {
      const s = tryPair(ordered[i], ordered[j]);
      if (s >= 0) pairs.push([ordered[i], ordered[j], s]);
    }
  const rank = ([a, b, s]: [Candidate, Candidate, number]) => (a.pointing ? 0 : 4) + (b.pointing ? 0 : 4) + (s >= 6 ? 1 : 0);
  pairs.sort((u, v) => rank(u) - rank(v));
  if (pairs.length) {
    chosen = [pairs[0][0], pairs[0][1]];
    shape = pairs[0][2];
  } else if (ordered.length) {
    chosen = [ordered[0]];
    shape = straightTowards(ordered[0].d, ordered[0].up);
  } else shape = straightTowards(facing, false);
  // 3. The rail, then each chosen neighbour that turns to join it.
  const changes: RailChange[] = [[x, y, z, make(shape, kind.powered, false)]];
  for (const c of chosen) if (!c.pointing) changes.push([c.q[0], c.q[1], c.q[2], c.becomes]);
  return changes;
}

/** Is `b` a rail of either kind? */
export const isRail = (b: Block): boolean => railOf(b) !== null;
