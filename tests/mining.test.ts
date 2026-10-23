import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { CRACK_SIZE, crackPixels, crackStage } from '../src/render/crack';
import { Block, BLOCKS } from '../src/world/blocks';
import { CRACK_STAGES, Mining, type MiningTarget } from '../src/world/mining';

const FRAME = 1 / 60;
const at = (x: number, block: Block): MiningTarget => ({ x, y: 40, z: 0, block });

/** Seconds of holding on `target` until it breaks (frames of FRAME). */
function timeToBreak(mining: Mining, target: MiningTarget): number {
  for (let frame = 1; frame < 10_000; frame++) if (mining.update(target, true, FRAME)) return frame * FRAME;
  throw new Error('never broke');
}

describe('breaking blocks', () => {
  it('takes each block its hardness in seconds, to within a frame', () => {
    for (const block of [Block.Stone, Block.Dirt, Block.Grass, Block.Sand, Block.Wood, Block.Leaves, Block.Planks, Block.Glass]) {
      const t = timeToBreak(new Mining(), at(5, block));
      expect(t, BLOCKS[block].name).toBeGreaterThanOrEqual(BLOCKS[block].hardness - 1e-9);
      expect(t, BLOCKS[block].name).toBeLessThan(BLOCKS[block].hardness + FRAME + 1e-9);
    }
    expect(BLOCKS[Block.Stone].hardness).toBeGreaterThan(BLOCKS[Block.Dirt].hardness);
  });

  it('starts again on looking at another block or letting go', () => {
    const mining = new Mining();
    const stone = at(5, Block.Stone);
    for (let i = 0; i < 60; i++) mining.update(stone, true, FRAME);
    expect(mining.held).toBeCloseTo(1, 9);
    mining.update(at(6, Block.Stone), true, FRAME);
    expect(mining.held).toBeCloseTo(FRAME, 9);
    mining.update(at(6, Block.Stone), false, FRAME);
    expect(mining.target).toBe(null);
    expect(mining.stage).toBe(-1);
    mining.update(null, true, FRAME);
    expect(mining.target).toBe(null);
  });

  it('shows crack stages 0..9 evenly through the break', () => {
    const mining = new Mining();
    const dirt = at(5, Block.Dirt);
    const hardness = BLOCKS[Block.Dirt].hardness;
    const stages: number[] = [];
    let held = 0;
    while (!mining.update(dirt, true, FRAME)) {
      held += FRAME;
      expect(mining.stage).toBe(Math.min(CRACK_STAGES - 1, Math.floor((held / hardness) * CRACK_STAGES + 1e-9)));
      stages.push(mining.stage);
    }
    expect(new Set(stages)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  it('pauses before the next block while the button stays held', () => {
    const mining = new Mining();
    timeToBreak(mining, at(5, Block.Leaves));
    // The next block (as you keep holding) starts only after the pause.
    const t = timeToBreak(mining, at(6, Block.Leaves));
    expect(t).toBeGreaterThanOrEqual(TUNING.edit.breakPause + BLOCKS[Block.Leaves].hardness - 1e-9);
    expect(t).toBeLessThan(TUNING.edit.breakPause + BLOCKS[Block.Leaves].hardness + 2 * FRAME + 1e-9);
  });
});

describe('crack pattern', () => {
  it('grows: each stage keeps the last one cracks and adds to them', () => {
    const pixels = crackPixels();
    expect(new Set(pixels).size).toBe(pixels.length);
    for (const p of pixels) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(CRACK_SIZE * CRACK_SIZE);
    }
    let previous: number[] = [];
    for (let stage = 0; stage < CRACK_STAGES; stage++) {
      const now = crackStage(stage, pixels);
      expect(now.length).toBeGreaterThan(previous.length);
      expect(now.slice(0, previous.length)).toEqual(previous);
      previous = now;
    }
    // Fully cracked is a good share of the face without covering it.
    expect(previous.length / (CRACK_SIZE * CRACK_SIZE)).toBeGreaterThan(0.15);
    expect(previous.length / (CRACK_SIZE * CRACK_SIZE)).toBeLessThan(0.45);
  });

  it('is the same every time', () => {
    expect(crackPixels()).toEqual(crackPixels());
  });
});
