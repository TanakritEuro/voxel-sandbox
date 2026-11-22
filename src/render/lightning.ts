// Lightning as drawn: a forked bolt of boxes from the clouds to the ground, there for a moment
// and fading, and the flash: one soft brightening of the sky and sunlight, rising and falling
// once (never a flicker), at most one in `TUNING.weather.lightning.flash.gap` seconds, and none
// with the setting off or when the system asks for less motion (the game says). Everything but
// `BoltMesh` is pure.

import * as THREE from 'three';
import { TUNING } from '../config';
import { createRng } from '../math';
import type { Bolt } from '../world/lightning';
import type { RGB, SkyState } from './sky';

/** A bolt's pieces: the main stroke, and at most this many forks of a few each. */
const MAIN = 14;
const MAX_FORKS = 4;
const FORK = 3;
export const MAX_SEGMENTS = MAIN + MAX_FORKS * FORK;

/** The flash's colour. */
const FLASH: RGB = [0.86, 0.9, 1];

export interface Segment {
  from: [number, number, number];
  to: [number, number, number];
  /** Of the main stroke's width, 0–1. */
  width: number;
}

/** A bolt's pieces, the same for the same bolt: wandering down to exactly its place, forks off it. */
export function boltSegments(bolt: Bolt): Segment[] {
  const rng = createRng(bolt.seed);
  const L = TUNING.weather.lightning;
  // From the clouds, or from over a mountain that reaches into them.
  const top = Math.max(TUNING.sky.cloudHeight, bolt.y + L.shortest);
  const drop = (top - bolt.y) / MAIN;
  const wander = () => (rng() * 2 - 1) * L.wander;
  const points: [number, number, number][] = [];
  let ox = wander() * 2;
  let oz = wander() * 2;
  for (let i = 0; i <= MAIN; i++) {
    // The wandering closes in as it nears the ground, so it lands where it's said to.
    const left = 1 - i / MAIN;
    const near = Math.min(1, left * 4);
    points.push([bolt.x + ox * near, i === MAIN ? bolt.y : top - i * drop, bolt.z + oz * near]);
    ox += wander();
    oz += wander();
  }
  const out: Segment[] = [];
  for (let i = 0; i < MAIN; i++) out.push({ from: points[i], to: points[i + 1], width: 1 - (0.3 * i) / MAIN });
  const forks = 2 + Math.floor(rng() * (MAX_FORKS - 1));
  for (let f = 0; f < forks; f++) {
    let at = points[2 + Math.floor(rng() * (MAIN - FORK - 2))];
    const angle = rng() * 2 * Math.PI;
    for (let k = 0; k < FORK; k++) {
      const reach = L.wander * (0.8 + rng() * 0.8);
      const to: [number, number, number] = [at[0] + reach * Math.cos(angle) + wander() * 0.5, Math.max(bolt.y, at[1] - drop * (0.6 + rng() * 0.4)), at[2] + reach * Math.sin(angle) + wander() * 0.5];
      out.push({ from: at, to, width: 0.5 - k * 0.12 });
      at = to;
    }
  }
  return out;
}

export class Flash {
  private since = Number.POSITIVE_INFINITY;
  private peak = 0;

  /** A bolt `distance` blocks off has struck: a flash, unless they're off or the last was too lately. Whether there was one. */
  strike(distance: number, on: boolean): boolean {
    const F = TUNING.weather.lightning.flash;
    if (!on || this.since < F.gap) return false;
    this.since = 0;
    this.peak = F.peak * (1 - 0.5 * Math.min(1, distance / TUNING.weather.lightning.away.max));
    return true;
  }

  step(dt: number): void {
    this.since += dt;
  }

  /** Gone at once (the setting turned off); the gap still runs. */
  stop(): void {
    this.peak = 0;
  }

  /** How bright it is now, 0–1: a smooth rise to its peak, then a smooth fall. */
  get level(): number {
    const { rise, fall } = TUNING.weather.lightning.flash;
    const t = this.since;
    if (!this.peak || t >= rise + fall) return 0;
    const x = t < rise ? t / rise : 1 - (t - rise) / fall;
    return this.peak * x * x * (3 - 2 * x);
  }
}

/** A colour of the sky lit by a flash of `level`. */
export function flashed(colour: RGB, level: number): RGB {
  if (level === 0) return colour;
  return colour.map((c, i) => c + Math.max(0, FLASH[i] - c) * level) as RGB;
}

/** The sky to draw, lit by a flash of `level`: `sky` itself without one. For drawing only, as the gloom is. */
export function skyFlashed(sky: SkyState, level: number): SkyState {
  if (level === 0) return sky;
  return {
    ...sky,
    daylight: sky.daylight + (1 - sky.daylight) * level,
    sunlight: flashed(sky.sunlight, level),
    colour: flashed(sky.colour, level),
    zenith: flashed(sky.zenith, level),
    clouds: flashed(sky.clouds, level),
  };
}

/** The last bolt, as boxes in one draw, fading away. */
export class BoltMesh {
  readonly mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private age = Number.POSITIVE_INFINITY;
  private readonly matrix = new THREE.Matrix4();
  private readonly from = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly size = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xe6eeff,
      // It shows through a storm's fog, but not through hills.
      fog: false,
      transparent: true,
      depthWrite: false,
      // Keep the canvas's alpha (see blockMaterial.ts).
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, MAX_SEGMENTS);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 4;
  }

  /** Show `bolt`, seen from `eye`: thicker far off, or it's thinner than a pixel. */
  show(bolt: Bolt, eye: { x: number; y: number; z: number }): void {
    const L = TUNING.weather.lightning;
    const distance = Math.hypot(bolt.x - eye.x, bolt.z - eye.z);
    const width = Math.max(L.width, distance * L.widthFar);
    const segments = boltSegments(bolt);
    segments.forEach((s, i) => {
      this.from.set(...s.from);
      this.along.set(...s.to).sub(this.from);
      const length = this.along.length();
      const w = width * s.width;
      // The box's middle, its y along the piece, overlapping the next.
      this.from.addScaledVector(this.along, 0.5);
      if (length > 1e-6) this.turn.setFromUnitVectors(this.up, this.along.divideScalar(length));
      this.size.set(w, length + w * 0.6, w);
      this.matrix.compose(this.from, this.turn, this.size);
      this.mesh.setMatrixAt(i, this.matrix);
    });
    this.mesh.count = segments.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.age = 0;
  }

  step(dt: number): void {
    this.age += dt;
    const left = 1 - this.age / TUNING.weather.lightning.shown;
    this.mesh.visible = left > 0;
    if (left > 0) this.mesh.material.opacity = Math.min(1, left * 1.6);
  }
}
