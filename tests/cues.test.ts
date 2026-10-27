import { describe, expect, it } from 'vitest';
import { type CueInput, landingGain, SoundCues, underfoot } from '../src/audio/cues';
import { TUNING } from '../src/config';
import { Block, BLOCKS } from '../src/world/blocks';

const DT = 1 / 60;
const still: CueInput = { dt: DT, moved: 0, vy: 0, onGround: true, flying: false, inWater: false, ground: 'grass', digging: null };

/** Frames of `input` (merged over standing still on grass), every sound they make. */
function run(cues: SoundCues, frames: number, input: Partial<CueInput>) {
  const out = [];
  for (let i = 0; i < frames; i++) out.push(...cues.frame({ ...still, ...input }));
  return out;
}

describe('sound cues', () => {
  it('step once every stride walked on the ground, in the ground’s material', () => {
    const cues = new SoundCues();
    // 16 blocks at 4.3 blocks a second.
    const frames = Math.round(16 / 4.3 / DT);
    const steps = run(cues, frames, { moved: 4.3 * DT, ground: 'wood' });
    expect(steps.length).toBe(Math.floor((frames * 4.3 * DT) / TUNING.sound.stride));
    expect(steps.every((e) => e.name === 'step' && e.material === 'wood')).toBe(true);
    // Sprinting covers the ground faster, so the steps come faster per second.
    expect(run(new SoundCues(), 60, { moved: 5.6 * DT }).length).toBeGreaterThan(run(new SoundCues(), 60, { moved: 4.3 * DT }).length);
  });

  it('keep their rhythm walking down a slope: a short drop each block neither loses nor doubles a step', () => {
    const cues = new SoundCues();
    const out = [];
    // 10 blocks downhill: on the ground most of the way, a few frames in the air at each block.
    for (let i = 0; i < Math.round(10 / 4.3 / DT); i++) {
      const air = i % 14 < 3;
      out.push(...cues.frame({ ...still, moved: 4.3 * DT, onGround: !air, vy: air ? -3 : 0 }));
    }
    const steps = out.filter((e) => e.name === 'step').length;
    expect(steps).toBeGreaterThanOrEqual(Math.floor(10 / TUNING.sound.stride) - 1);
    expect(steps).toBeLessThanOrEqual(Math.ceil(10 / TUNING.sound.stride));
    expect(out.some((e) => e.name === 'land')).toBe(false);
  });

  it('make no footsteps in the air, flying or in water', () => {
    expect(run(new SoundCues(), 300, { moved: 0.1, onGround: false, vy: -1 }).filter((e) => e.name === 'step')).toEqual([]);
    expect(run(new SoundCues(), 300, { moved: 0.1, flying: true })).toEqual([]);
    expect(run(new SoundCues(), 300, { moved: 0.1, inWater: true })).toEqual([]);
  });

  it('thud on landing from a fall, louder for a bigger fall, but not after a jump', () => {
    const land = (speed: number) => {
      const cues = new SoundCues();
      run(cues, 10, { onGround: false, vy: -speed });
      return run(cues, 1, { onGround: true, vy: 0 }).filter((e) => e.name === 'land');
    };
    const jump = Math.sqrt(2 * TUNING.player.gravity * TUNING.player.jumpHeight);
    expect(land(jump)).toEqual([]);
    const small = land(14);
    const big = land(24);
    expect(small).toHaveLength(1);
    expect(big).toHaveLength(1);
    expect(big[0].gain).toBeGreaterThan(small[0].gain);
    expect(landingGain(1000)).toBe(1);
  });

  it('splash going into water fast, and not wading in slowly', () => {
    const into = (vy: number) => {
      const cues = new SoundCues();
      run(cues, 5, { onGround: false, vy });
      return run(cues, 1, { onGround: false, vy, inWater: true }).filter((e) => e.name === 'splash');
    };
    expect(into(-12)).toHaveLength(1);
    expect(into(-1)).toEqual([]);
  });

  it('hit once at once and then every interval while digging, in the block’s material', () => {
    const cues = new SoundCues();
    const hits = run(cues, 60, { digging: 'stone' });
    expect(hits.map((e) => e.name)).toEqual(['dig', 'dig', 'dig', 'dig']);
    expect(hits.every((e) => e.name === 'dig' && e.material === 'stone')).toBe(true);
    // Stopping and starting again hits at once.
    run(cues, 3, {});
    expect(run(cues, 1, { digging: 'dirt' })).toHaveLength(1);
  });

  it('find the ground underfoot, at an edge too, and give every block a sound', () => {
    const at = (blocks: Record<string, Block>) => ({ getBlock: (x: number, y: number, z: number) => blocks[`${x},${y},${z}`] ?? Block.Air });
    expect(underfoot(at({ '3,9,3': Block.SnowyGrass }), 3.5, 10, 3.5)).toBe('snow');
    expect(underfoot(at({ '3,9,3': Block.Planks }), 3.5, 10, 3.5)).toBe('wood');
    // Standing over an edge: the middle is over air, a corner over sand.
    expect(underfoot(at({ '4,9,3': Block.Sand }), 3.9, 10, 3.5)).toBe('sand');
    expect(underfoot(at({}), 3.5, 10, 3.5)).toBeNull();
    // Water isn't ground.
    expect(underfoot(at({ '3,9,3': Block.Water }), 3.5, 10, 3.5)).toBeNull();
    for (const info of BLOCKS) expect(info.sound).toBeTruthy();
  });
});
