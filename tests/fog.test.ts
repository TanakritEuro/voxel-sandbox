import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { biomeFogs, blendFog, easeFog, fogColour } from '../src/render/fog';
import type { RGB } from '../src/render/sky';
import { waterFlow } from '../src/render/water';
import { Biome } from '../src/world/biomes';
import { Generator } from '../src/world/generate';

const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const only = (b: Biome) => [0, 1, 2, 3].map((i) => (i === b ? 1 : 0));

describe('fog by biome', () => {
  it("is each biome's own fog where only that biome is", () => {
    const fogs = biomeFogs();
    for (const b of [Biome.Forest, Biome.Desert, Biome.Mountains]) {
      const f = blendFog(only(b));
      close(f.tint, fogs[b].tint);
      expect(f.amount).toBeCloseTo(fogs[b].amount);
      expect(f.start).toBeCloseTo(fogs[b].start);
    }
    // Plains has no tint: the horizon stays as the time of day makes it.
    const plains = blendFog(only(Biome.Plains));
    expect(plains.amount).toBe(0);
    const horizon: RGB = [0.6, 0.8, 1];
    close(fogColour(horizon, plains, 1), horizon);
    // The desert closes in, the mountains open out.
    expect(blendFog(only(Biome.Desert)).start).toBeLessThan(plains.start);
    expect(blendFog(only(Biome.Mountains)).start).toBeGreaterThan(plains.start);
  });

  it("blends between biomes, without a tintless biome washing out its neighbour's colour", () => {
    const fogs = biomeFogs();
    const half = blendFog([0.5, 0, 0.5, 0]); // plains and desert
    close(half.tint, fogs[Biome.Desert].tint);
    expect(half.amount).toBeCloseTo(fogs[Biome.Desert].amount / 2);
    expect(half.start).toBeCloseTo((fogs[Biome.Plains].start + fogs[Biome.Desert].start) / 2);
    const mixed = blendFog([0, 0.5, 0.5, 0]); // forest and desert: a tint between theirs
    for (let c = 0; c < 3; c++) {
      const [lo, hi] = [fogs[Biome.Forest].tint[c], fogs[Biome.Desert].tint[c]].sort((a, b) => a - b);
      expect(mixed.tint[c]).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(mixed.tint[c]).toBeLessThanOrEqual(hi + 1e-9);
    }
    // The climate's own weights give a fog in range everywhere.
    const climate = new Generator(20261022).climate;
    for (const [x, z] of [[384, 0], [0, 192], [-121, -226], [36, 53], [1000, -700]]) {
      const f = blendFog(climate.weights(x, z));
      expect(f.amount).toBeGreaterThanOrEqual(0);
      expect(f.amount).toBeLessThanOrEqual(1);
      expect(f.start).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(f.start).toBeLessThanOrEqual(0.65 + 1e-9);
    }
  });

  it('eases towards a new biome over a few seconds rather than flicking', () => {
    const fogs = biomeFogs();
    const from = blendFog(only(Biome.Plains));
    const to = blendFog(only(Biome.Desert));
    const current = { ...from, tint: [...from.tint] as RGB };
    easeFog(current, to, TUNING.fog.ease, TUNING.fog.ease);
    // About 63 % of the way after `ease` seconds.
    expect((current.start - from.start) / (to.start - from.start)).toBeCloseTo(1 - Math.exp(-1));
    for (let i = 0; i < 60 * 30; i++) easeFog(current, to, 1 / 60, TUNING.fog.ease);
    expect(current.start).toBeCloseTo(fogs[Biome.Desert].start, 3);
    expect(current.amount).toBeCloseTo(fogs[Biome.Desert].amount, 3);
  });

  it('tints the horizon fully by day and not at all at night', () => {
    const desert = blendFog(only(Biome.Desert));
    const horizon: RGB = [0.62, 0.82, 1];
    close(fogColour(horizon, desert, TUNING.day.night), horizon);
    const noon = fogColour(horizon, desert, 1);
    const a = desert.amount;
    close(noon, horizon.map((h, c) => h + (desert.tint[c] - h) * a));
  });
});

describe('water flow', () => {
  it('starts still, stays within one block, and moves smoothly frame to frame', () => {
    const start = waterFlow(0, 0.12);
    expect([...start.a, ...start.b, start.ripple]).toEqual([0, 0, 0, 0, 0]);
    const wrapDiff = (p: number, q: number) => Math.min(Math.abs(p - q), 1 - Math.abs(p - q));
    for (let t = 0; t < 600; t += 7.3) {
      const now = waterFlow(t, 0.12);
      const next = waterFlow(t + 1 / 60, 0.12);
      for (const v of [...now.a, ...now.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      for (let i = 0; i < 2; i++) {
        expect(wrapDiff(now.a[i], next.a[i])).toBeLessThan(0.01);
        expect(wrapDiff(now.b[i], next.b[i])).toBeLessThan(0.01);
      }
    }
  });
});
