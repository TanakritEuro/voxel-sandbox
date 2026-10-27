import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createRng } from '../src/math';
import { brightness, MAX_PARTICLES, Particles } from '../src/render/particles';

const STONE: [number, number, number][] = [[0.54, 0.55, 0.57]];
/** A floor: every block below y = 10 is solid. */
const floor = (_x: number, y: number, _z: number) => y < 10;
const DT = 1 / 60;

describe('block particles', () => {
  it('burst from a broken block, fall, and never end up inside a solid block', () => {
    const p = new Particles(createRng(1));
    p.burst(4, 10, 4, STONE, 1);
    expect(p.alive).toBe(TUNING.particles.breakCount);
    const startY = Array.from({ length: MAX_PARTICLES }, (_, i) => p.position[i * 3 + 1]).filter((_, i) => p.life[i] > 0);
    let lowest = Infinity;
    for (let frame = 0; frame < 40; frame++) {
      p.step(DT, floor);
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (p.life[i] <= 0) continue;
        expect(floor(Math.floor(p.position[i * 3]), Math.floor(p.position[i * 3 + 1]), Math.floor(p.position[i * 3 + 2]))).toBe(false);
        lowest = Math.min(lowest, p.position[i * 3 + 1]);
      }
    }
    // They came down onto the floor (y = 10) from where they started.
    expect(lowest).toBeLessThan(Math.min(...startY));
    expect(lowest).toBeGreaterThanOrEqual(10);
  });

  it('settle on the floor and are gone after their life', () => {
    const p = new Particles(createRng(2));
    p.burst(0, 10, 0, STONE, 1);
    for (let t = 0; t < TUNING.particles.life[1] + 0.05; t += DT) p.step(DT, floor);
    expect(p.alive).toBe(0);
  });

  it('chip off the face being dug, in front of it', () => {
    const p = new Particles(createRng(3));
    // The top face of the block at (2, 9, 2), which is solid.
    p.chips(2, 9, 2, 0, 1, 0, STONE, 1);
    expect(p.alive).toBe(TUNING.particles.digCount);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (p.life[i] <= 0) continue;
      expect(p.position[i * 3 + 1]).toBeGreaterThan(10);
      expect(p.position[i * 3]).toBeGreaterThan(2);
      expect(p.position[i * 3]).toBeLessThan(3);
    }
  });

  it('never hold more than their limit, reusing the oldest slots', () => {
    const p = new Particles(createRng(4));
    for (let n = 0; n < 100; n++) p.burst(n, 20, 0, STONE, 1);
    expect(p.alive).toBe(MAX_PARTICLES);
    // The newest burst is all there.
    let newest = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) if (p.position[i * 3] >= 99 && p.position[i * 3] < 100) newest++;
    expect(newest).toBe(TUNING.particles.breakCount);
  });

  it('are lit like the blocks: dark with no light, full in daylight or by a lamp', () => {
    expect(brightness(0, 1)).toBe(0);
    expect(brightness(0xf0, 1)).toBeCloseTo(1);
    expect(brightness(0xf0, 0.2)).toBeCloseTo(0.2);
    expect(brightness(0x0f, 0.2)).toBeCloseTo(1);
    expect(brightness(0x07, 1)).toBeGreaterThan(0);
    expect(brightness(0x07, 1)).toBeLessThan(0.5);
    // Colours are times the light.
    const p = new Particles(createRng(5));
    p.burst(0, 20, 0, [[1, 1, 1]], 0.5);
    for (let i = 0; i < MAX_PARTICLES; i++) if (p.life[i] > 0) expect(p.colour[i * 3]).toBeLessThanOrEqual(0.5 * 1.15 + 1e-6);
  });
});
