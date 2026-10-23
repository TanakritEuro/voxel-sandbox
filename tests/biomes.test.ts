import { describe, expect, it } from 'vitest';
import { Biome, BIOME_COUNT, Climate } from '../src/world/biomes';
import { Block } from '../src/world/blocks';
import { columnLayers, type ColumnInfo, Generator, SEA_LEVEL } from '../src/world/generate';

const SEED = 20261022;
const AREA = 4000;
const STEP = 32;

/** Sample points over an AREA × AREA square around the origin. */
function* grid(step = STEP): Iterable<[number, number]> {
  for (let z = -AREA / 2; z < AREA / 2; z += step) for (let x = -AREA / 2; x < AREA / 2; x += step) yield [x, z];
}

describe('biomes', () => {
  it('all four occur, each over at least 5 % of the land', () => {
    const climate = new Climate(SEED);
    const counts = new Array(BIOME_COUNT).fill(0);
    let n = 0;
    for (const [x, z] of grid()) {
      counts[climate.dominant(x, z)]++;
      n++;
    }
    for (let b = 0; b < BIOME_COUNT; b++) expect(counts[b] / n, Biome[b]).toBeGreaterThan(0.05);
  });

  it('are the same for the same seed and differ for another', () => {
    const a = new Climate(SEED);
    const b = new Climate(SEED);
    const c = new Climate(SEED + 1);
    let differ = 0;
    for (const [x, z] of grid(250)) {
      expect(a.dominant(x, z)).toBe(b.dominant(x, z));
      expect(a.height(x, z)).toBe(b.height(x, z));
      if (a.dominant(x, z) !== c.dominant(x, z)) differ++;
    }
    expect(differ).toBeGreaterThan(10);
  });

  it('blend heights: no step between neighbouring columns is a cliff, at borders or anywhere', () => {
    const g = new Generator(SEED);
    let borders = 0;
    let steepest = 0;
    for (const [x, z] of grid(64)) {
      // Walk 64 blocks along x from each sample, one column at a time.
      let previous = g.height(x, z);
      const crossesBorder = g.climate.dominant(x, z) !== g.climate.dominant(x + 64, z);
      if (crossesBorder) borders++;
      for (let i = 1; i <= 64; i++) {
        const h = g.height(x + i, z);
        steepest = Math.max(steepest, Math.abs(h - previous));
        previous = h;
      }
    }
    expect(borders).toBeGreaterThan(50);
    // Measured 4.3 at the steepest (in the mountains); a seam would be tens of blocks.
    expect(steepest).toBeLessThanOrEqual(6);
  });

  it('raise mountains far above the plains', () => {
    const g = new Generator(SEED);
    const tallest = new Array(BIOME_COUNT).fill(0);
    const w = new Float64Array(BIOME_COUNT);
    for (const [x, z] of grid()) {
      // Inside each biome: near a border, plains rise with the mountains beside them (the blend).
      g.climate.weights(x, z, w);
      if (Math.max(...w) < 0.9) continue;
      const b = g.climate.dominant(x, z);
      tallest[b] = Math.max(tallest[b], g.height(x, z) - SEA_LEVEL);
    }
    expect(tallest[Biome.Mountains]).toBeGreaterThan(100);
    expect(tallest[Biome.Plains]).toBeLessThan(40);
    expect(tallest[Biome.Desert]).toBeLessThan(40);
  });

  it('fray the line between two biomes only near it', () => {
    const g = new Generator(SEED);
    let frayed = 0;
    for (const [x, z] of grid(8)) {
      const w = g.climate.weights(x, z, new Float64Array(BIOME_COUNT));
      const dominant = g.climate.dominant(x, z);
      const biome = g.biome(x, z, w);
      if (biome !== dominant) {
        frayed++;
        // Only where another biome has nearly as much weight.
        expect(Math.max(...w)).toBeLessThan(0.75);
      }
    }
    expect(frayed).toBeGreaterThan(0);
  });
});

describe('column layers', () => {
  const info = (over: Partial<ColumnInfo>): ColumnInfo => ({ height: 90, biome: Biome.Plains, slope: 0, snowLine: 120, ...over });
  /** Blocks from the top down, as [block, count] runs, then what's under them. */
  const fromTop = (i: ColumnInfo) =>
    columnLayers(i)
      .filter(([from, to]) => to > from)
      .reverse()
      .map(([from, to, block]) => [Block[block], to - from]);

  it('plains and forest: grass on three dirt on stone', () => {
    expect(fromTop(info({}))).toEqual([['Grass', 1], ['Dirt', 3], ['Stone', 87]]);
    expect(fromTop(info({ biome: Biome.Forest }))[0]).toEqual(['Grass', 1]);
  });

  it('desert: sand, then sandstone, then stone', () => {
    expect(fromTop(info({ biome: Biome.Desert }))).toEqual([['Sand', 1], ['Sand', 3], ['Sandstone', 4], ['Stone', 83]]);
  });

  it('mountains: snow over stone above the snow line, snowy grass below it', () => {
    expect(fromTop(info({ biome: Biome.Mountains, height: 150 }))).toEqual([['Snow', 1], ['Stone', 150]]);
    expect(fromTop(info({ biome: Biome.Mountains, height: 100 }))).toEqual([['SnowyGrass', 1], ['Dirt', 3], ['Stone', 97]]);
  });

  it('steep slopes are bare stone, except in the desert', () => {
    expect(fromTop(info({ slope: 3 }))[0]).toEqual(['Stone', 1]);
    expect(fromTop(info({ slope: 2 }))[0]).toEqual(['Grass', 1]);
    expect(fromTop(info({ biome: Biome.Desert, slope: 5 }))[0]).toEqual(['Sand', 1]);
  });

  it('beaches are sand; deep sea floors are gravel, shallow ones sand; water fills up to sea level', () => {
    expect(fromTop(info({ height: SEA_LEVEL + 1 }))[0]).toEqual(['Sand', 1]);
    expect(fromTop(info({ height: SEA_LEVEL - 2 }))).toEqual([['Water', 2], ['Sand', 1], ['Sand', 3], ['Stone', SEA_LEVEL - 5]]);
    expect(fromTop(info({ height: SEA_LEVEL - 20 })).slice(0, 2)).toEqual([['Water', 20], ['Gravel', 1]]);
  });
});
