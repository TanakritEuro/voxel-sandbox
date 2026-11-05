import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { meshChunk } from '../src/mesh/mesher';
import { PADDED_VOLUME, paddedIndex } from '../src/mesh/padding';
import { dropsOf } from '../src/survival/drops';
import { FUEL, Furnace, Furnaces, INPUT, OUTPUT } from '../src/survival/furnace';
import { Item, toolOf } from '../src/survival/items';
import { Block, BLOCKS, FACINGS, furnace, furnaceOf, logicPlacement } from '../src/world/blocks';
import { textureLayer } from '../src/world/textures';

const T = TUNING.survival.smeltSeconds;

/** A furnace with these in it. */
function loaded(input: [number, number] | null, fuel: [number, number] | null): Furnace {
  const f = new Furnace();
  if (input) f.slots.slots[INPUT] = { item: input[0], count: input[1] };
  if (fuel) f.slots.slots[FUEL] = { item: fuel[0], count: fuel[1] };
  return f;
}

/** Step it `seconds` at 60 a second; how many times it was lit or put out. */
function run(f: Furnace, seconds: number): number {
  let changes = 0;
  for (let t = 0; t < seconds * 60; t++) if (f.step(1 / 60)) changes++;
  return changes;
}

const out = (f: Furnace) => f.slots.slots[OUTPUT];

describe('the furnace', () => {
  it('smelts raw copper, raw iron and sand, one item every 5 s', () => {
    for (const [raw, made] of [
      [Item.RawCopper, Item.Copper],
      [Item.RawIron, Item.Iron],
      [Block.Sand, Block.Glass],
    ]) {
      const f = loaded([raw, 3], [Item.Coal, 1]);
      run(f, T - 0.1);
      expect(out(f)).toBe(null);
      run(f, 0.2);
      expect(out(f)).toEqual({ item: made, count: 1 });
      run(f, 2 * T);
      expect(out(f)).toEqual({ item: made, count: 3 });
      expect(f.slots.slots[INPUT]).toBe(null);
    }
  });

  it('burns each fuel for its items: coal 8, planks 1.5, a stick half', () => {
    const smelted = (fuel: number, count: number) => {
      const f = loaded([Block.Sand, 64], [fuel, count]);
      run(f, 60);
      return out(f)?.count ?? 0;
    };
    expect(smelted(Item.Coal, 1)).toBe(8);
    expect(smelted(Block.Planks, 1)).toBe(1); // half of the second
    expect(smelted(Block.Planks, 2)).toBe(3);
    expect(smelted(Block.Wood, 2)).toBe(3);
    expect(smelted(Item.Stick, 1)).toBe(0);
    expect(smelted(Item.Stick, 2)).toBe(1);
  });

  it('lights only with something to smelt and fuel, burns its fuel out once lit, and says when it lights and goes out', () => {
    const empty = loaded(null, [Item.Coal, 4]);
    expect(run(empty, 10)).toBe(0);
    expect(empty.slots.slots[FUEL]!.count).toBe(4); // not lit for nothing
    const nothingToBurn = loaded([Item.RawIron, 4], null);
    expect(run(nothingToBurn, 10)).toBe(0);
    // One raw iron and a coal: lit, it smelts the iron, and the coal burns on to its end.
    const f = loaded([Item.RawIron, 1], [Item.Coal, 1]);
    expect(f.step(1 / 60)).toBe(true);
    expect(f.lit).toBe(true);
    run(f, T + 1);
    expect(out(f)).toEqual({ item: Item.Iron, count: 1 });
    expect(f.lit).toBe(true);
    expect(run(f, 8 * T)).toBe(1); // put out once, at the coal's end
    expect(f.lit).toBe(false);
  });

  it('stops when what it makes has no room', () => {
    const f = loaded([Block.Sand, 10], [Item.Coal, 4]);
    f.slots.slots[OUTPUT] = { item: Block.Glass, count: 63 };
    run(f, 3 * T);
    expect(out(f)!.count).toBe(64);
    expect(f.slots.slots[INPUT]!.count).toBe(9);
    // Something else in the output: nothing smelts.
    const g = loaded([Block.Sand, 10], [Item.Coal, 4]);
    g.slots.slots[OUTPUT] = { item: Item.Iron, count: 1 };
    run(g, 3 * T);
    expect(g.slots.slots[INPUT]!.count).toBe(10);
    expect(g.slots.slots[FUEL]!.count).toBe(4);
  });

  it('takes anything to smelt, only fuel in its fuel slot, and nothing in its output', () => {
    expect(Furnace.accepts(INPUT, { item: Block.Dirt, count: 1 })).toBe(true);
    expect(Furnace.accepts(FUEL, { item: Item.Coal, count: 1 })).toBe(true);
    expect(Furnace.accepts(FUEL, { item: Block.Dirt, count: 1 })).toBe(false);
    expect(Furnace.accepts(OUTPUT, { item: Item.Coal, count: 1 })).toBe(false);
  });

  it('keeps what is in it by place through saving, leaving out the empty ones and what is wrong', () => {
    const all = new Furnaces();
    const f = all.at(3, 64, -7);
    f.slots.slots[INPUT] = { item: Item.RawCopper, count: 5 };
    f.slots.slots[FUEL] = { item: Item.Coal, count: 2 };
    run(f, 7);
    all.at(0, 0, 0); // empty and out: not kept
    const back = Furnaces.from(JSON.parse(JSON.stringify(all)));
    expect(back.size).toBe(1);
    expect(back.get(3, 64, -7)!.toJSON()).toEqual(f.toJSON());
    expect(back.get(3, 64, -7)!.lit).toBe(true);
    const cleaned = Furnaces.from({ '1,2': {}, 'a,b,c': {}, '1,2,3': { slots: [{ item: 999, count: 1 }], burn: 1e9, progress: -1 } });
    expect(cleaned.size).toBe(1);
    expect(cleaned.get(1, 2, 3)!.toJSON()).toEqual(new Furnace().toJSON());
  });
});

describe('furnace blocks', () => {
  it('face four ways, out and burning, burning ones giving light; one is offered', () => {
    for (let facing = 0; facing < 4; facing++)
      for (const lit of [false, true]) {
        const b = furnace(facing, lit);
        expect(furnaceOf(b)).toEqual({ facing, lit });
        expect(BLOCKS[b].light).toBe(lit ? 13 : 0);
        expect(BLOCKS[b].pickable).toBe(facing === 0 && !lit);
      }
    expect(furnaceOf(Block.Stone)).toBe(null);
    expect(furnace(0, false)).toBe(Block.Furnace);
  });

  it('are placed with their front to the player', () => {
    // Looking along -z (yaw 0): the front faces +z, back at them.
    expect(furnaceOf(logicPlacement(Block.Furnace, 0, 0)!)!.facing).toBe(FACINGS.findIndex(([x, z]) => x === 0 && z === 1));
    // Looking along +x (yaw -π/2): the front faces -x.
    expect(furnaceOf(logicPlacement(Block.Furnace, 1, -Math.PI / 2)!)!.facing).toBe(FACINGS.findIndex(([x, z]) => x === -1 && z === 0));
  });

  it('show their front on the side they face, and the bricks elsewhere', () => {
    const front = textureLayer('furnace_front');
    const side = textureLayer('furnace_side');
    for (let facing = 0; facing < 4; facing++) {
      const padded = new Uint8Array(PADDED_VOLUME);
      padded[paddedIndex(1, 1, 1)] = furnace(facing, false);
      const m = meshChunk(padded, 0, 0, 0, new Uint8Array(PADDED_VOLUME).fill(0xf0)).opaque;
      // Each quad's layer, by the way its corners lie: all on one x (or z) means a side.
      const [fx, fz] = FACINGS[facing];
      let fronts = 0;
      for (let q = 0; q < m.positions.length / 12; q++) {
        const xs = [0, 1, 2, 3].map((k) => m.positions[q * 12 + k * 3]);
        const zs = [0, 1, 2, 3].map((k) => m.positions[q * 12 + k * 3 + 2]);
        const layer = m.uvl[q * 16 + 2];
        const atX = xs.every((v) => v === xs[0]) ? xs[0] : null;
        const atZ = zs.every((v) => v === zs[0]) ? zs[0] : null;
        const isFront = (fx !== 0 && atX === (fx > 0 ? 1 : 0)) || (fz !== 0 && atZ === (fz > 0 ? 1 : 0));
        if (isFront) fronts++;
        if (atX !== null || atZ !== null) expect(layer).toBe(isFront ? front : side);
      }
      expect(fronts).toBe(1);
    }
  });

  it('need a pick to give themselves back (out, facing the first way), whatever their state', () => {
    expect(dropsOf(furnace(2, true), toolOf(Item.WoodPick), 0)).toEqual([[Block.Furnace, 1]]);
    expect(dropsOf(furnace(1, false), undefined, 0)).toEqual([]);
  });
});
