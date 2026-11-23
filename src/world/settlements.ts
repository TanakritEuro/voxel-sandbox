// Settlements (generation version 4, Milestone 22): hamlets of the hearthfolk, one chance per 320 x
// 320-block cell. A well of stone bricks on a square of gravel in the middle; 3–7 huts round it on
// level, dry ground, each facing the well, with beds, a chest and a lantern, one of them a trader's
// with a counter out front; a field or two of wheat with water down the middle; gravel paths from
// each door to the well, along the ground as it is; lanterns on fence posts. Like structures, a
// settlement is decided from the seed and the generator's height function alone, so every chunk
// decides the same, and each column job writes the parts that fall inside it, last. Laying one out
// asks the ground a few hundred questions, and every column job within reach asks for it, so layouts
// (and their blocks) are kept per cell. Pure.

import { hash3 } from '../math';
import { Biome } from './biomes';
import { bed, Block, chest, door, FACINGS, slab, wheat } from './blocks';
import { SEA_LEVEL, toChunk } from './coords';
import { caveLimit } from './caves';
import type { Placed, StructureGround } from './structures';

/** What laying out a settlement asks of the generator. */
export interface SettlementGround extends StructureGround {
  /** Has a cave carved the block at (x, y, z), its column carved up to `limit` (`caveLimit`)? */
  carvedAt(x: number, y: number, z: number, limit: number): boolean;
}

/**
 * The ground as one layout asks it: each column's height worked out once (a layout asks for most of
 * them several times: levelling, caves' limits, paths), caves from those heights.
 */
class Memo implements StructureGround {
  private readonly heights = new Map<number, number>();

  constructor(private readonly ground: SettlementGround) {}

  height(x: number, z: number): number {
    const key = (x + 0x200000) * 0x400000 + (z + 0x200000);
    let h = this.heights.get(key);
    if (h === undefined) this.heights.set(key, (h = this.ground.height(x, z)));
    return h;
  }

  biome(x: number, z: number) {
    return this.ground.biome(x, z);
  }

  caveAt(x: number, y: number, z: number): boolean {
    const h = this.height(x, z);
    const lowest = Math.min(h, this.height(x + 1, z), this.height(x - 1, z), this.height(x, z + 1), this.height(x, z - 1));
    return this.ground.carvedAt(x, y, z, caveLimit(h, lowest));
  }

  caveColumn(x: number, z: number, y0: number, y1: number): Uint8Array {
    return this.ground.caveColumn(x, z, y0, y1);
  }
}

/** A chunk column's key in `Settlement.columns`. */
export const columnKey = (cx: number, cz: number): number => (cx + 0x8000) * 0x10000 + (cz + 0x8000);

/** The world is split into cells this wide; each has a settlement or not. */
export const SETTLEMENT_CELL = 320;
const CELL = SETTLEMENT_CELL;
/** Furthest any of a settlement's blocks reach from its well, along x or z. */
export const SETTLEMENT_REACH = 32;
/** No ruin or camp stands within this many blocks of a settlement's reach. */
export const SETTLEMENT_CLEAR = 24;
/** A settlement's middle is at least this far inside its cell. */
const MARGIN = 40;
/** Huts stand this far from the well (their middles), at the least and the most. */
const NEAREST = 10;
const FURTHEST = 26;
/** A hut's half width (its walls), and with the levelled ring round it. */
const HUT_HALF = 3;
const HUT_RING = 4;
/** The most a hut's ground may differ from its floor (a field's: 1), and from the well's. */
const HUT_LEVEL = 2;
const FIELD_LEVEL = 1;
const FROM_WELL = 6;
/** The well's half width with its square of gravel. */
const WELL_RING = 3;
/** How many places are tried for the middle, for huts, and for fields. */
const MIDDLE_TRIES = 2;
const HUT_TRIES = 80;
const FIELD_TRIES = 48;

/** How a settlement's huts are built: planks under a gabled roof, or mud bricks under a flat one. */
export enum HutStyle {
  Plank = 0,
  Mud = 1,
}

export interface Hut {
  /** Its middle and floor (the ground there). */
  x: number;
  z: number;
  y: number;
  /** The way its door faces, towards the well: an index into `FACINGS`. */
  facing: number;
  /** Beds inside: 1 or 2 (a folk each, in step 2). */
  beds: number;
  /** The trader's hut, with a counter out front. */
  trader: boolean;
  chest: [number, number, number];
}

export interface Field {
  x: number;
  z: number;
  y: number;
  /** Its long side runs across this facing (`FACINGS`): 7 long, 5 deep, water down the middle. */
  facing: number;
}

export interface Settlement {
  /** The cell. */
  gx: number;
  gz: number;
  /** The well's middle and the ground there. */
  x: number;
  z: number;
  y: number;
  style: HutStyle;
  huts: Hut[];
  fields: Field[];
  /** What it writes, in order, and the highest y of anything not air. */
  blocks: Placed[];
  top: number;
  /** The columns its paths are on. */
  paths: [number, number][];
  /** Its blocks by chunk column (`columnKey`), each part in order, with the highest y not air in it. */
  columns: Map<number, { blocks: Placed[]; top: number }>;
}

/** A rectangle of columns, inclusive. */
interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const overlaps = (a: Rect, b: Rect, gap: number) => a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.z0 - gap <= b.z1 && b.z0 - gap <= a.z1;
const rectAround = (x: number, z: number, hx: number, hz: number): Rect => ({ x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz });

/** Local (a across, b forward, towards the door) to world, for something facing `facing`. */
function place(s: { x: number; z: number; facing: number }, a: number, b: number): [number, number] {
  const [fx, fz] = FACINGS[s.facing];
  return [s.x - a * fz + b * fx, s.z + a * fx + b * fz];
}

/** The facing index of a world direction. */
const facingOf = (dx: number, dz: number): number => FACINGS.findIndex(([x, z]) => x === dx && z === dz);
/** The facing pointing the other way. */
const back = (f: number): number => facingOf(-FACINGS[f][0], -FACINGS[f][1]);

/** Can a settlement's middle be in this biome: the plains, the savanna, or the forest near its edge? */
function settles(ground: StructureGround, x: number, z: number): HutStyle | null {
  const biome = ground.biome(x, z);
  if (biome === Biome.Plains) return HutStyle.Plank;
  if (biome === Biome.Savanna) return HutStyle.Mud;
  if (biome !== Biome.Forest) return null;
  // The forest's edge: open land within 48 blocks one way or another.
  for (const [dx, dz] of FACINGS) {
    const b = ground.biome(x + dx * 48, z + dz * 48);
    if (b === Biome.Plains || b === Biome.Savanna) return HutStyle.Plank;
  }
  return null;
}

/** Is the ground under a rectangle (corners, middles of the sides, middle) dry and within `level` of y? */
function levelUnder(ground: StructureGround, r: Rect, y: number, level: number): boolean {
  const xm = (r.x0 + r.x1) >> 1;
  const zm = (r.z0 + r.z1) >> 1;
  for (const x of [r.x0, xm, r.x1])
    for (const z of [r.z0, zm, r.z1]) {
      const h = ground.height(x, z);
      if (h <= SEA_LEVEL + 1 || Math.abs(h - y) > level) return false;
    }
  return true;
}

/** Does a cave open under a rectangle's middle or corners, from `below` blocks down to the floor? */
function caveUnder(ground: StructureGround, r: Rect, y: number, below: number): boolean {
  const xm = (r.x0 + r.x1) >> 1;
  const zm = (r.z0 + r.z1) >> 1;
  for (const [x, z] of [[xm, zm], [r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) for (let k = y - below; k <= y; k++) if (ground.caveAt(x, k, z)) return true;
  return false;
}

/** The settlement of cell (gx, gz), laid out, if it has one where the land allows (not kept: see `Settlements`). */
export function settlementInCell(seed: number, gx: number, gz: number, land: SettlementGround): Settlement | null {
  const ground = new Memo(land);
  // A few places for the middle, the first where one can be laid out kept.
  for (let t = 0; t < MIDDLE_TRIES; t++) {
    const s = (seed ^ 0x5e77) + t * 0x9e3779b1;
    const x = gx * CELL + MARGIN + Math.floor(hash3(s, gx, 501, gz) * (CELL - 2 * MARGIN));
    const z = gz * CELL + MARGIN + Math.floor(hash3(s, gx, 502, gz) * (CELL - 2 * MARGIN));
    const st = layOut(seed, s, gx, gz, x, z, ground);
    if (st) return st;
  }
  return null;
}

/** A settlement round (x, z), if the land there allows one; `s` seeds its layout. */
function layOut(seed: number, s: number, gx: number, gz: number, x: number, z: number, ground: StructureGround): Settlement | null {
  const y = ground.height(x, z);
  if (y < SEA_LEVEL + 3) return null;
  const style = settles(ground, x, z);
  if (style === null) return null;
  const well = rectAround(x, z, WELL_RING, WELL_RING);
  if (!levelUnder(ground, well, y, 1) || caveUnder(ground, rectAround(x, z, 0, 0), y, 5)) return null;

  // Huts: places tried round the well, the first that fit kept.
  const taken: Rect[] = [well];
  const huts: Hut[] = [];
  const want = 3 + Math.floor(hash3(s, gx, 503, gz) * 5);
  for (let t = 0; t < HUT_TRIES && huts.length < want; t++) {
    const angle = hash3(s, gx, 510 + t, gz) * Math.PI * 2;
    const dist = NEAREST + hash3(s, gx, 560 + t, gz) * (FURTHEST - NEAREST);
    const hx = x + Math.round(Math.cos(angle) * dist);
    const hz = z + Math.round(Math.sin(angle) * dist);
    const rect = rectAround(hx, hz, HUT_RING, HUT_RING);
    // A block between rings, for a path to pass.
    if (taken.some((r) => overlaps(r, rect, 1))) continue;
    const hy = ground.height(hx, hz);
    if (Math.abs(hy - y) > FROM_WELL || !levelUnder(ground, rectAround(hx, hz, HUT_HALF, HUT_HALF), hy, HUT_LEVEL)) continue;
    if (caveUnder(ground, rectAround(hx, hz, HUT_HALF, HUT_HALF), hy, 2)) continue;
    // Facing the well, along whichever way it's further.
    const dx = x - hx;
    const dz = z - hz;
    const facing = Math.abs(dx) >= Math.abs(dz) ? facingOf(Math.sign(dx), 0) : facingOf(0, Math.sign(dz));
    const beds = hash3(s, gx, 610 + t, gz) < 0.6 ? 2 : 1;
    const hut = { x: hx, z: hz, y: hy, facing, beds, trader: huts.length === 0 };
    const [cx, cz] = place(hut, beds === 2 ? 0 : 2, -2);
    huts.push({ ...hut, chest: [cx, hy + 1, cz] });
    taken.push(rect);
  }
  if (huts.length < 3) return null;

  // Fields: one or two, the same way, a little further out if need be.
  const fields: Field[] = [];
  const fieldsWanted = hash3(s, gx, 504, gz) < 0.5 ? 1 : 2;
  for (let t = 0; t < FIELD_TRIES && fields.length < fieldsWanted; t++) {
    const angle = hash3(s, gx, 660 + t, gz) * Math.PI * 2;
    const dist = NEAREST + 2 + hash3(s, gx, 700 + t, gz) * (FURTHEST - NEAREST - 2);
    const fx = x + Math.round(Math.cos(angle) * dist);
    const fz = z + Math.round(Math.sin(angle) * dist);
    const facing = hash3(s, gx, 740 + t, gz) < 0.5 ? 0 : 2;
    // 9 across (local a) and 7 deep (b, along its facing) with its ring.
    const rect = FACINGS[facing][0] !== 0 ? rectAround(fx, fz, 3, 4) : rectAround(fx, fz, 4, 3);
    if (taken.some((r) => overlaps(r, rect, 1))) continue;
    const fy = ground.height(fx, fz);
    const inner = FACINGS[facing][0] !== 0 ? rectAround(fx, fz, 2, 3) : rectAround(fx, fz, 3, 2);
    if (Math.abs(fy - y) > FROM_WELL || !levelUnder(ground, inner, fy, FIELD_LEVEL) || caveUnder(ground, inner, fy, 2)) continue;
    fields.push({ x: fx, z: fz, y: fy, facing });
    taken.push(rect);
  }
  // A settlement has a field at least.
  if (!fields.length) return null;

  const { blocks, top, paths } = settlementBlocks(seed, { x, z, y, style, huts, fields }, taken, ground);
  // Each column job wants only the blocks in its column.
  const columns = new Map<number, { blocks: Placed[]; top: number }>();
  for (const p of blocks) {
    const key = columnKey(toChunk(p[0]), toChunk(p[2]));
    let part = columns.get(key);
    if (!part) columns.set(key, (part = { blocks: [], top: 0 }));
    part.blocks.push(p);
    if (p[3] !== Block.Air && p[1] > part.top) part.top = p[1];
  }
  return { gx, gz, x, z, y, style, huts, fields, blocks, top, paths, columns };
}

/** The block on top of levelled ground round things: the biome's grass. */
const turf = (style: HutStyle) => (style === HutStyle.Mud ? Block.DryGrass : Block.Grass);

/**
 * A settlement's blocks, in the order to write them: paths first (so nothing else is drawn over by
 * one), then the well, the fields and the huts, each clearing its volume and levelling its ground.
 */
function settlementBlocks(
  seed: number,
  st: Pick<Settlement, 'x' | 'z' | 'y' | 'style' | 'huts' | 'fields'>,
  taken: readonly Rect[],
  ground: StructureGround,
): { blocks: Placed[]; top: number; paths: [number, number][] } {
  const out: Placed[] = [];
  const paths: [number, number][] = [];
  const grass = turf(st.style);

  /** Ground at (x, z) made level at y: filled with dirt up to it, cut down to it, `topBlock` on top. */
  const level = (x: number, z: number, y: number, topBlock: Block, clearTo: number) => {
    const g = ground.height(x, z);
    for (let k = g + 1; k < y; k++) out.push([x, k, z, Block.Dirt]);
    out.push([x, y, z, topBlock]);
    for (let k = y + 1; k <= Math.max(g, clearTo); k++) out.push([x, k, z, Block.Air]);
  };

  // Paths: from in front of each door to the well's square, a block at a time along x or z, on the ground as it is.
  const inside = (x: number, z: number) => taken.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  for (const hut of st.huts) {
    let [px, pz] = place(hut, 0, HUT_RING + 1);
    const tx = st.x;
    const tz = st.z;
    for (let guard = 0; guard < 80; guard++) {
      if (inside(px, pz)) {
        // Stop at the well's square; go round another hut's ring or a field by carrying on.
        if (Math.abs(px - tx) <= WELL_RING && Math.abs(pz - tz) <= WELL_RING) break;
      } else {
        const h = ground.height(px, pz);
        if (h > SEA_LEVEL && !ground.caveAt(px, h, pz)) {
          out.push([px, h, pz, Block.Gravel]);
          out.push([px, h + 1, pz, Block.Air]);
          paths.push([px, pz]);
        }
      }
      const dx = tx - px;
      const dz = tz - pz;
      if (dx === 0 && dz === 0) break;
      if (Math.abs(dx) >= Math.abs(dz)) px += Math.sign(dx);
      else pz += Math.sign(dz);
    }
  }

  // The well: a square of gravel, a rim of stone bricks round water three deep, posts and a plank roof.
  const { x: wx, z: wz, y: wy } = st;
  for (let dz = -WELL_RING; dz <= WELL_RING; dz++)
    for (let dx = -WELL_RING; dx <= WELL_RING; dx++) {
      const x = wx + dx;
      const z = wz + dz;
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d === WELL_RING) {
        level(x, z, wy, Block.Gravel, wy + 4);
        continue;
      }
      level(x, z, wy, Block.StoneBricks, wy + 4);
      if (d === 2) {
        for (let k = wy - 3; k <= wy + 1; k++) out.push([x, k, z, Block.StoneBricks]);
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          out.push([x, wy + 2, z, Block.Fence]);
          out.push([x, wy + 3, z, Block.Fence]);
        }
      } else {
        out.push([x, wy - 4, z, Block.StoneBricks]);
        for (let k = wy - 3; k <= wy; k++) out.push([x, k, z, Block.Water]);
      }
      out.push([x, wy + 4, z, slab(1, false)]);
    }
  // Lanterns on posts at two corners of the square.
  for (const [dx, dz] of [
    [WELL_RING, WELL_RING],
    [-WELL_RING, -WELL_RING],
  ]) {
    out.push([wx + dx, wy + 1, wz + dz, Block.Fence]);
    out.push([wx + dx, wy + 2, wz + dz, Block.Lantern]);
  }

  // Fields: farmland either side of a row of water, ripening wheat on it, the ground round levelled.
  for (const f of st.fields) {
    for (let a = -4; a <= 4; a++)
      for (let b = -3; b <= 3; b++) {
        const [x, z] = place(f, a, b);
        if (Math.abs(a) === 4 || Math.abs(b) === 3) {
          level(x, z, f.y, grass, f.y + 2);
          continue;
        }
        if (b === 0) {
          level(x, z, f.y, Block.Water, f.y + 2);
          continue;
        }
        level(x, z, f.y, Block.Farmland, f.y + 2);
        out.push([x, f.y + 1, z, wheat(3 + Math.floor(hash3(seed, x, f.y + 520, z) * 5))]);
      }
  }

  // Huts.
  for (const hut of st.huts) hutBlocks(hut, st.style, level, out);

  let top = 0;
  for (const [, y, , b] of out) if (b !== Block.Air && y > top) top = y;
  return { blocks: out, top, paths };
}

/** A hut's blocks: the floor and its ring levelled, walls, a doorway with the door open, windows, a roof, beds, a chest, a lantern. */
function hutBlocks(hut: Hut, style: HutStyle, level: (x: number, z: number, y: number, top: Block, clearTo: number) => void, out: Placed[]): void {
  const { y } = hut;
  const mud = style === HutStyle.Mud;
  const wall = mud ? Block.MudBricks : Block.Planks;
  const post = mud ? Block.ParasolWood : Block.Wood;
  const roofTop = mud ? y + 5 : y + 7;
  for (let a = -HUT_RING; a <= HUT_RING; a++)
    for (let b = -HUT_RING; b <= HUT_RING; b++) {
      const [x, z] = place(hut, a, b);
      const ring = Math.abs(a) === HUT_RING || Math.abs(b) === HUT_RING;
      // The doorstep: gravel, where the path begins.
      level(x, z, y, ring ? (a === 0 && b === HUT_RING ? Block.Gravel : turf(style)) : Block.Planks, ring ? y + 3 : roofTop);
    }
  const at = (a: number, b: number, k: number, block: Block) => {
    const [x, z] = place(hut, a, b);
    out.push([x, y + k, z, block]);
  };
  // Walls, 3 high, posts at the corners; the doorway in front, windows in the sides and back.
  for (let a = -HUT_HALF; a <= HUT_HALF; a++)
    for (let b = -HUT_HALF; b <= HUT_HALF; b++) {
      if (Math.abs(a) !== HUT_HALF && Math.abs(b) !== HUT_HALF) continue;
      const corner = Math.abs(a) === HUT_HALF && Math.abs(b) === HUT_HALF;
      for (let k = 1; k <= 3; k++) {
        if (a === 0 && b === HUT_HALF && k <= 2) continue;
        const window = k === 2 && ((b === 0 && Math.abs(a) === HUT_HALF) || (a === 0 && b === -HUT_HALF));
        at(a, b, k, corner ? post : window ? Block.Pane : wall);
      }
    }
  // The door, open, as if placed from outside.
  const inwards = back(hut.facing);
  at(0, HUT_HALF, 1, door(inwards, true, false));
  at(0, HUT_HALF, 2, door(inwards, true, true));
  // The roof.
  if (mud) {
    for (let a = -HUT_RING; a <= HUT_RING; a++) for (let b = -HUT_RING; b <= HUT_RING; b++) at(a, b, 4, Block.Thatch);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) at(a, b, 5, Block.Thatch);
  } else {
    // Gabled along the way it faces: stepping up from the eaves on each side to a ridge, the gable ends planks.
    for (let b = -HUT_RING; b <= HUT_RING; b++) {
      for (const a of [-4, -3, 3, 4]) at(a, b, 4, Block.Thatch);
      for (const a of [-2, 2]) at(a, b, 5, Block.Thatch);
      for (const a of [-1, 1]) at(a, b, 6, Block.Thatch);
      at(0, b, 7, Block.Thatch);
    }
    for (const b of [-HUT_HALF, HUT_HALF]) {
      for (let a = -2; a <= 2; a++) at(a, b, 4, Block.Planks);
      for (let a = -1; a <= 1; a++) at(a, b, 5, Block.Planks);
      at(0, b, 6, Block.Planks);
    }
  }
  // Inside: beds along the back wall, heads to it; the chest; a lantern by the door.
  const headBack = back(hut.facing);
  for (const a of hut.beds === 2 ? [-2, 2] : [-2]) {
    at(a, -1, 1, bed(headBack, false));
    at(a, -2, 1, bed(headBack, true));
  }
  const [cx, cy, cz] = hut.chest;
  out.push([cx, cy, cz, chest(hut.facing)]);
  at(2, 2, 1, Block.Lantern);
  // Outside: a lantern on a post left of the door; the trader's counter of plank slabs to the right.
  at(-2, HUT_RING, 1, Block.Fence);
  at(-2, HUT_RING, 2, Block.Lantern);
  if (hut.trader) for (const a of [2, 3]) at(a, HUT_RING, 1, slab(1, true));
}

/** The world box a settlement's blocks fall in. */
export const settlementRect = (st: { x: number; z: number }, grow = 0): Rect => rectAround(st.x, st.z, SETTLEMENT_REACH + grow, SETTLEMENT_REACH + grow);

/** How many cells' layouts are kept. */
const KEPT = 32;

/** Settlements of one world, laid out once per cell and kept (the most recently asked for). */
export class Settlements {
  private readonly cells = new Map<number, Settlement | null>();

  constructor(
    readonly seed: number,
    private readonly ground: SettlementGround,
  ) {}

  /** Cell (gx, gz)'s settlement, if any. */
  inCell(gx: number, gz: number): Settlement | null {
    // Cells far beyond any world (more than 2^15 cells out) aren't asked for.
    const key = (gx + 32768) * 65536 + (gz + 32768);
    if (this.cells.has(key)) {
      const kept = this.cells.get(key)!;
      this.cells.delete(key);
      this.cells.set(key, kept);
      return kept;
    }
    const st = settlementInCell(this.seed, gx, gz, this.ground);
    this.cells.set(key, st);
    if (this.cells.size > KEPT) this.cells.delete(this.cells.keys().next().value!);
    return st;
  }

  /** The settlements whose blocks may reach into [x0, x1] x [z0, z1] (`grow` more each way), in world order. */
  within(x0: number, z0: number, x1: number, z1: number, grow = 0): Settlement[] {
    const out: Settlement[] = [];
    const R = SETTLEMENT_REACH + grow;
    for (let gz = Math.floor((z0 - R) / CELL); gz <= Math.floor((z1 + R) / CELL); gz++)
      for (let gx = Math.floor((x0 - R) / CELL); gx <= Math.floor((x1 + R) / CELL); gx++) {
        const st = this.inCell(gx, gz);
        if (st && overlaps(settlementRect(st, grow), { x0, z0, x1, z1 }, 0)) out.push(st);
      }
    return out;
  }
}

/**
 * Would a tree standing at (x, z), its leaves reaching `reach` blocks, touch a settlement's huts, well,
 * fields or paths? Trees are left out where they would.
 */
export function crowds(st: Settlement, x: number, z: number, reach: number): boolean {
  if (Math.abs(x - st.x) > SETTLEMENT_REACH + reach || Math.abs(z - st.z) > SETTLEMENT_REACH + reach) return false;
  for (const r of footprints(st)) if (x >= r.x0 - reach && x <= r.x1 + reach && z >= r.z0 - reach && z <= r.z1 + reach) return true;
  // A path: gravel within a block of the trunk.
  for (const [px, pz] of st.paths) if (Math.abs(px - x) <= 1 && Math.abs(pz - z) <= 1) return true;
  return false;
}

/** The well's square, each hut with its ring and roof, each field with its ring. */
function footprints(st: Settlement): Rect[] {
  return [
    rectAround(st.x, st.z, WELL_RING, WELL_RING),
    ...st.huts.map((h) => rectAround(h.x, h.z, HUT_RING, HUT_RING)),
    ...st.fields.map((f) => (FACINGS[f.facing][0] !== 0 ? rectAround(f.x, f.z, 3, 4) : rectAround(f.x, f.z, 4, 3))),
  ];
}

/** For the hearthfolk (`mobs/folk.ts`): a place given across and forward of something facing a way, and the way back. */
export { back as backFacing, place as localPlace };
