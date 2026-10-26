// Water: the fog and the sky colour above water and below (above, the horizon colour for the
// time of day and the biome, `fog.ts`, with the fog just inside the view distance; with the eye
// in water, the fog closes in and turns blue, darker at night), and how far the surface's
// texture has drifted (`waterFlow`, for the chunk shader).

import * as THREE from 'three';
import { TUNING } from '../config';
import type { RGB } from './sky';

/** Offsets of the water texture's two drifting copies (0–1, blocks) and the ripple's phase. */
export interface WaterFlow {
  a: [number, number];
  b: [number, number];
  ripple: number;
}

const wrap = (v: number) => ((v % 1) + 1) % 1;

/** Where the water has drifted after `seconds` at `flow` blocks a second. */
export function waterFlow(seconds: number, flow: number): WaterFlow {
  const d = seconds * flow;
  return {
    a: [wrap(d * 0.8), wrap(d * 0.5)],
    b: [wrap(-d * 0.55), wrap(d * 0.75)],
    // Round once every 2π: kept small so the shader's sines stay precise.
    ripple: (seconds * 1.3) % (2 * Math.PI * 1000),
  };
}

export class WaterView {
  private readonly fog: THREE.Fog;
  /** The fog's range above water, to put back. */
  private air: { near: number; far: number };
  private readonly waterColour = new THREE.Color(TUNING.water.fogColour);

  constructor(private readonly scene: THREE.Scene) {
    this.fog = scene.fog as THREE.Fog;
    this.air = { near: this.fog.near, far: this.fog.far };
  }

  /** The fog's range above water (blocks), for a new view distance. */
  setRange(near: number, far: number): void {
    this.air.near = near;
    this.air.far = far;
  }

  /** Once a frame: whether the eye is under water, the sky's colour (sRGB 0–1) and daylight (`sky.ts`). */
  update(underwater: boolean, sky: RGB, daylight: number): void {
    const colour = this.fog.color;
    if (underwater) colour.copy(this.waterColour).multiplyScalar(0.25 + 0.75 * daylight);
    else colour.setRGB(sky[0], sky[1], sky[2], THREE.SRGBColorSpace);
    this.fog.near = underwater ? TUNING.water.fogNear : this.air.near;
    this.fog.far = underwater ? TUNING.water.fogFar : this.air.far;
    (this.scene.background as THREE.Color).copy(colour);
  }
}
