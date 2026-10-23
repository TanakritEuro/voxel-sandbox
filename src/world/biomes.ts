// Biomes: where the world is plains, forest, desert or snowy mountains, and how high the
// ground is there. Two low-frequency noises give every column a temperature and a humidity;
// each biome sits at a point in that climate and weighs in by how close the column's climate
// is to it. Heights blend by those weights, so mountains rise out of the plains over a
// hundred blocks or so instead of starting at a wall. Pure and deterministic, like all world
// code.

import { Noise } from './noise';

export enum Biome {
  Plains = 0,
  Forest = 1,
  Desert = 2,
  Mountains = 3,
}
export const BIOME_COUNT = 4;

interface BiomeDef {
  name: string;
  /** Where the biome sits in the climate: temperature, humidity (each about -1..1). */
  climate: [number, number];
  /** Ground above the continent's level, and how far the biome's own shape lifts it. */
  base: number;
  amplitude: number;
}

/** The biomes' climates, heights and names. Indexed by `Biome`. */
export const BIOMES: readonly BiomeDef[] = [
  { name: 'plains', climate: [0.08, -0.04], base: 2, amplitude: 9 },
  { name: 'forest', climate: [0.04, 0.22], base: 4, amplitude: 14 },
  { name: 'desert', climate: [0.3, -0.22], base: 3, amplitude: 7 },
  { name: 'snowy mountains', climate: [-0.34, 0.02], base: 26, amplitude: 120 },
];

/** Width of the blend between biomes, in climate units: smaller is sharper. */
const BLEND = 0.09;
/** Climate noise scale: about one full swing of temperature or humidity per this many blocks. */
const CLIMATE_SCALE = 1400;

export class Climate {
  private readonly temperature: Noise;
  private readonly humidity: Noise;
  private readonly continent: Noise;
  private readonly shape: Noise;
  private readonly w = new Float64Array(BIOME_COUNT);

  constructor(seed: number) {
    // Separate noises, each its own seed, so the four fields don't line up.
    this.temperature = new Noise(seed ^ 0x5eed7e3);
    this.humidity = new Noise(seed ^ 0x40a1d17);
    this.continent = new Noise(seed);
    this.shape = new Noise(seed ^ 0x3a9e5);
  }

  /** Temperature and humidity at a column, each roughly -1..1. */
  at(x: number, z: number): [number, number] {
    return [this.temperature.fbm2(x / CLIMATE_SCALE, z / CLIMATE_SCALE, 2), this.humidity.fbm2(x / CLIMATE_SCALE, z / CLIMATE_SCALE, 2)];
  }

  /** Each biome's weight at a column, summing to 1, into `out` (indexed by `Biome`). */
  weights(x: number, z: number, out: Float64Array = this.w): Float64Array {
    const [t, h] = this.at(x, z);
    let sum = 0;
    for (let i = 0; i < BIOME_COUNT; i++) {
      const [bt, bh] = BIOMES[i].climate;
      const d2 = (t - bt) ** 2 + (h - bh) ** 2;
      out[i] = Math.exp(-d2 / (2 * BLEND * BLEND));
      sum += out[i];
    }
    // Far from every biome (rare), fall back to plains rather than dividing by ~0.
    if (sum < 1e-12) {
      out.fill(0);
      out[Biome.Plains] = 1;
      return out;
    }
    for (let i = 0; i < BIOME_COUNT; i++) out[i] /= sum;
    return out;
  }

  /** The biome with the most weight at a column. */
  dominant(x: number, z: number): Biome {
    const w = this.weights(x, z);
    let best = 0;
    for (let i = 1; i < BIOME_COUNT; i++) if (w[i] > w[best]) best = i;
    return best;
  }

  /**
   * Ground height above sea level at a column, before rounding: the continent (where seas
   * and land masses are) plus each biome's base and shape, blended by the biome weights.
   */
  height(x: number, z: number, weights: Float64Array = this.weights(x, z)): number {
    let h = this.continent.fbm2(x / 400, z / 400, 3) * 32 - 4;
    const s = this.shape;
    for (let i = 0; i < BIOME_COUNT; i++) {
      const w = weights[i];
      if (w < 1e-4) continue; // too little to see; skip its noise
      const def = BIOMES[i];
      let shape: number;
      if (i === Biome.Desert) shape = 1 - Math.abs(s.noise2(x / 38, z / 38)); // dunes: rounded crests
      else if (i === Biome.Mountains) {
        // Ridged: sharp crests where the noise crosses zero, plus rougher detail.
        const ridge = 1 - Math.abs(s.fbm2(x / 170 + 50, z / 170 - 50, 4));
        shape = ridge * ridge + 0.15 * s.fbm2(x / 30, z / 30, 3);
      } else shape = s.fbm2(x / (i === Biome.Forest ? 70 : 110), z / (i === Biome.Forest ? 70 : 110), 4);
      h += w * (def.base + def.amplitude * shape);
    }
    return h;
  }
}
