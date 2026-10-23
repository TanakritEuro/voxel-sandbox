// The underwater view: with the eye in water, the fog closes in and turns blue.

import * as THREE from 'three';
import { TUNING } from '../config';

export class WaterView {
  private underwater = false;
  private readonly fog: THREE.Fog;
  /** The fog and background above water, to put back. */
  private readonly sky: { colour: THREE.Color; near: number; far: number };
  private readonly waterColour = new THREE.Color(TUNING.water.fogColour);

  constructor(private readonly scene: THREE.Scene) {
    this.fog = scene.fog as THREE.Fog;
    this.sky = { colour: this.fog.color.clone(), near: this.fog.near, far: this.fog.far };
  }

  update(underwater: boolean): void {
    if (underwater === this.underwater) return;
    this.underwater = underwater;
    const colour = underwater ? this.waterColour : this.sky.colour;
    this.fog.color.copy(colour);
    this.fog.near = underwater ? TUNING.water.fogNear : this.sky.near;
    this.fog.far = underwater ? TUNING.water.fogFar : this.sky.far;
    (this.scene.background as THREE.Color).copy(colour);
  }
}
