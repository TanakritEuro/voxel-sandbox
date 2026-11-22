// The weather's drawn things behind a few calls, so the game stays out of them: what falls
// (`precipitation.ts`), lightning's bolt and flash (`lightning.ts`), and when a bolt's thunder
// is due (`audio/weather.ts` says how it sounds).

import * as THREE from 'three';
import { thunderDelay } from '../audio/weather';
import type { Bolt } from '../world/lightning';
import type { CoverMap } from './coverMap';
import { BoltMesh, Flash } from './lightning';
import { Precipitation } from './precipitation';
import type { RGB } from './sky';

export class WeatherView {
  readonly group = new THREE.Group();
  private readonly precipitation: Precipitation;
  private readonly bolt = new BoltMesh();
  private readonly flash = new Flash();
  private waiting: { bolt: Bolt; left: number }[] = [];

  constructor(cover: CoverMap) {
    this.precipitation = new Precipitation(cover);
    this.group.add(this.precipitation.mesh, this.bolt.mesh);
  }

  /** Compile its shaders now: all hidden until wanted, they would be on the first frame they show (50 ms for rain's). */
  warm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): void {
    renderer.compile(this.group, camera, scene);
  }

  /** A bolt has struck, seen and heard from `eye`; `flashes`: whether a flash is allowed. */
  strike(bolt: Bolt, eye: { x: number; y: number; z: number }, flashes: boolean): void {
    this.bolt.show(bolt, eye);
    const distance = Math.hypot(bolt.x - eye.x, bolt.z - eye.z);
    this.flash.strike(distance, flashes);
    this.waiting.push({ bolt, left: thunderDelay(distance) });
  }

  /**
   * A frame of `dt` on, before the sky is lit, `worldDt` of it the world's (0 while it stands still:
   * thunder waits, but a flash and a bolt still fade, not left lit behind a menu): the flash's
   * level now and the bolts whose thunder is due.
   */
  step(dt: number, worldDt: number, flashes: boolean): { flash: number; thunder: Bolt[] } {
    this.bolt.step(dt);
    this.flash.step(dt);
    if (!flashes) this.flash.stop();
    const thunder: Bolt[] = [];
    if (worldDt > 0 && this.waiting.length) {
      for (const w of this.waiting) if ((w.left -= worldDt) <= 0) thunder.push(w.bolt);
      if (thunder.length) this.waiting = this.waiting.filter((w) => w.left > 0);
    }
    return { flash: this.flash.level, thunder };
  }

  /** What falls, after the cover's update (`Precipitation.update`). */
  draw(eye: THREE.Vector3, dt: number, fall: number, horizon: RGB, daylight: number, eyeUnder: boolean): void {
    this.precipitation.update(eye, dt, fall, horizon, daylight, eyeUnder);
  }
}
