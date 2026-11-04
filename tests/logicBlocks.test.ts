import { describe, expect, it } from 'vitest';
import type { MeshData } from '../src/mesh/builder';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { settable } from '../src/net/hostWorld';
import {
  Block,
  BLOCKS,
  delay,
  FACINGS,
  facingFromYaw,
  gateOf,
  inverter,
  isThinLogic,
  logicPlacement,
  PLACEABLE,
  torchSupport,
  useBlock,
  wire,
  wirePower,
} from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/coords';
import { textureLayer } from '../src/world/textures';
import { torchesHeldBy } from '../src/world/torches';
import { Chunk, World } from '../src/world/world';

describe('logic blocks', () => {
  it('are 63 ids after the water, each state its own', () => {
    expect(Block.Wire).toBe(35);
    expect(Block.Delay + 31).toBe(BLOCKS.length - 1);
    for (let p = 0; p <= 15; p++) expect(wirePower(wire(p))).toBe(p);
    expect(wirePower(Block.Switch)).toBe(-1);
    for (let f = 0; f < 4; f++)
      for (const on of [false, true]) {
        expect(gateOf(inverter(f, on))).toEqual({ kind: 'inverter', facing: f, on, setting: 1 });
        for (let s = 1; s <= 4; s++) expect(gateOf(delay(f, s, on))).toEqual({ kind: 'delay', facing: f, on, setting: s });
      }
    expect(gateOf(Block.SignalLamp)).toBe(null);
  });

  it('offer the picker their seven blocks, and nothing else of theirs', () => {
    const logic = PLACEABLE.filter((b) => b >= Block.Wire);
    expect(logic).toEqual([Block.Wire, Block.Switch, Block.Button, Block.SignalLamp, Block.ChargedBlock, Block.Inverter, Block.Delay]);
    expect(logic.map((b) => BLOCKS[b].name)).toEqual(['Copper wire', 'Switch', 'Button', 'Signal lamp', 'Charged block', 'Inverter', 'Delay']);
  });

  it('can be walked through when thin, stand on the block below, and the lit lamp gives light', () => {
    for (const b of [Block.Wire, wire(9), Block.Switch, Block.ButtonOn, inverter(2, true), delay(1, 3, false)]) {
      expect(isThinLogic(b)).toBe(true);
      expect(BLOCKS[b].passable).toBe(true);
      expect(torchSupport(b)).toEqual([0, -1, 0]);
    }
    expect(BLOCKS[Block.SignalLampOn].light).toBe(15);
    expect(BLOCKS[Block.SignalLamp].light).toBe(0);
    expect(BLOCKS[Block.ChargedBlock].opaque).toBe(true);
    expect(isThinLogic(Block.SignalLamp)).toBe(false);
  });

  it('face the way the player looks when placed, and only go on a top', () => {
    expect(facingFromYaw(0)).toBe(3); // looking along -z
    expect(facingFromYaw(Math.PI / 2)).toBe(1); // -x
    expect(facingFromYaw(-Math.PI / 2)).toBe(0); // +x
    expect(facingFromYaw(Math.PI)).toBe(2); // +z
    expect(logicPlacement(Block.Inverter, 1, Math.PI)).toBe(inverter(2, false));
    expect(logicPlacement(Block.Delay, 1, -Math.PI / 2)).toBe(delay(0, 1, false));
    expect(logicPlacement(Block.Wire, 1, 0)).toBe(Block.Wire);
    expect(logicPlacement(Block.Switch, 0, 0)).toBe(null); // not on a side
    expect(logicPlacement(Block.Stone, 0, 0)).toBe(Block.Stone);
  });

  it('are used with a click: a switch flipped, a button pressed, a delay set one more round', () => {
    expect(useBlock(Block.Switch)).toBe(Block.SwitchOn);
    expect(useBlock(Block.SwitchOn)).toBe(Block.Switch);
    expect(useBlock(Block.Button)).toBe(Block.ButtonOn);
    expect(useBlock(Block.ButtonOn)).toBe(Block.ButtonOn);
    let d = delay(2, 1, true);
    const settings = [];
    for (let i = 0; i < 4; i++) {
      d = useBlock(d)!;
      settings.push(gateOf(d)!.setting);
      expect(gateOf(d)).toMatchObject({ facing: 2, on: true });
    }
    expect(settings).toEqual([2, 3, 4, 1]);
    expect(useBlock(Block.Inverter)).toBe(null);
    expect(useBlock(Block.Stone)).toBe(null);
  });

  it('go with the block they stand on', () => {
    const world = new World(1);
    const c = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(5, 41, 5, Block.Wire);
    world.setBlock(6, 40, 5, Block.Stone);
    world.setBlock(6, 41, 5, delay(0, 2, false));
    expect(torchesHeldBy(world, 5, 40, 5)).toEqual([[5, 41, 5]]);
    expect(torchesHeldBy(world, 6, 40, 5)).toEqual([[6, 41, 5]]);
  });

  it("may be set by a guest as placed, but other states are the signals' to set or come of using a block", () => {
    for (const b of [Block.Wire, Block.Switch, Block.Button, Block.SignalLamp, Block.ChargedBlock, inverter(3, false), delay(2, 1, false)]) expect(settable(b)).toBe(true);
    for (const b of [wire(5), Block.SwitchOn, Block.ButtonOn, Block.SignalLampOn, inverter(3, true), delay(1, 4, false), delay(0, 1, true)]) expect(settable(b)).toBe(false);
    expect(settable(BLOCKS.length)).toBe(false);
  });
});

describe('logic blocks drawn', () => {
  /** A world of one chunk (0, 1, 0) with a stone floor at y 40 under (x, z), and `block` on it. */
  function oneOn(block: Block): MeshData {
    const world = new World(1);
    const c = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
    world.chunks.set(c.key, c);
    world.setBlock(5, 40, 5, Block.Stone);
    world.setBlock(5, 41, 5, block);
    return meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0, paddedLight(world, 0, 1, 0)).opaque;
  }
  /** The vertices of the mesh above the stone (the block's own), as x, y, z, u, v, layer. */
  const above = (m: MeshData) => {
    const out: number[][] = [];
    for (let k = 0; k < m.positions.length / 3; k++) {
      const y = m.positions[k * 3 + 1];
      if (y > 41 - 1e-6) out.push([m.positions[k * 3], y, m.positions[k * 3 + 2], m.uvl[k * 4], m.uvl[k * 4 + 1], m.uvl[k * 4 + 2]]);
    }
    return out;
  };

  it('as a sheet 1/16 thick for wire, its top in the wire texture by power', () => {
    const off = above(oneOn(Block.Wire));
    expect(Math.max(...off.map((v) => v[1]))).toBeCloseTo(41 + 1 / 16);
    expect(off.filter((v) => v[1] > 41.01).every((v) => v[5] === textureLayer('wire_off'))).toBe(true);
    const on = above(oneOn(wire(15)));
    expect(on.filter((v) => v[1] > 41.01).every((v) => v[5] === textureLayer('wire_on'))).toBe(true);
  });

  it('with the switch handle on one side off and the other on, and a pressed button flatter', () => {
    // The handle is the part in the side texture: its lowest x.
    const handleX = (b: Block) => Math.min(...above(oneOn(b)).filter((v) => v[5] === textureLayer(BLOCKS[b].textures.side)).map((v) => v[0]));
    expect(handleX(Block.Switch)).toBeCloseTo(5 + 5 / 16);
    expect(handleX(Block.SwitchOn)).toBeCloseTo(5 + 9 / 16);
    const height = (b: Block) => Math.max(...above(oneOn(b)).map((v) => v[1]));
    expect(height(Block.Button)).toBeCloseTo(41 + 2 / 16);
    expect(height(Block.ButtonOn)).toBeCloseTo(41 + 1 / 16);
  });

  it("with a gate's top turned so its arrow points the way the gate faces", () => {
    for (let f = 0; f < 4; f++) {
      const top = above(oneOn(inverter(f, false))).filter((v) => Math.abs(v[1] - (41 + 2 / 16)) < 1e-6 && v[5] === textureLayer('inverter'));
      expect(top.length).toBe(4);
      // From the corners where the texture's v is 0 to those where it's 1: the painted arrow's way.
      const at = (v: number) => top.filter((c) => c[4] === v);
      const mid = (cs: number[][]) => [cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[2], 0) / cs.length];
      const [x0, z0] = mid(at(0));
      const [x1, z1] = mid(at(1));
      expect([Math.sign(x1 - x0), Math.sign(z1 - z0)], `facing ${f}`).toEqual([...FACINGS[f]]);
    }
  });
});
