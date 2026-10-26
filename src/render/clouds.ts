// Flat blocky clouds, as voxel games have them: one layer at `TUNING.sky.cloudHeight`, made of
// square cells (`cloudCell` blocks) that are either cloud or clear sky, drifting with the
// wind. The cells come from a repeating pattern of CLOUD_CELLS × CLOUD_CELLS, made from the
// world's seed at startup (value noise that wraps round, so the pattern tiles without seams),
// drawn as a texture with one texel a cell on a single quad that follows the camera. It fades
// out towards the edge of the view by horizontal distance, so it never looks cut off.

import * as THREE from 'three';
import { hash3 } from '../math';

/** The pattern repeats every this many cells, each way. */
export const CLOUD_CELLS = 128;

/** Value noise on a lattice `period` cells apart, wrapping round every CLOUD_CELLS cells: 0–1. */
function wrappedNoise(seed: number, x: number, y: number, period: number, salt: number): number {
  const n = CLOUD_CELLS / period;
  const gx = Math.floor(x / period);
  const gy = Math.floor(y / period);
  const fx = x / period - gx;
  const fy = y / period - gy;
  const at = (i: number, j: number) => hash3(seed + salt, ((gx + i) % n + n) % n, ((gy + j) % n + n) % n, 0);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx;
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
  return top + (bottom - top) * sy;
}

/**
 * Which cells are cloud (255) and which clear (0), CLOUD_CELLS² of them, row by row: about
 * `cover` of them cloud. Two octaves of wrapped noise, so clouds have big shapes and ragged edges.
 */
export function cloudCells(seed: number, cover: number): Uint8Array {
  const values = new Float32Array(CLOUD_CELLS * CLOUD_CELLS);
  for (let y = 0; y < CLOUD_CELLS; y++)
    for (let x = 0; x < CLOUD_CELLS; x++)
      values[y * CLOUD_CELLS + x] = wrappedNoise(seed, x, y, 16, 1) * 0.7 + wrappedNoise(seed, x, y, 4, 2) * 0.3;
  // The threshold that covers exactly `cover` of the cells.
  const sorted = Float32Array.from(values).sort();
  const threshold = sorted[Math.min(sorted.length - 1, Math.floor((1 - cover) * sorted.length))];
  return Uint8Array.from(values, (v) => (v >= threshold ? 255 : 0));
}

/** How far the clouds have drifted (blocks along +x) after `seconds`. */
export const cloudDrift = (seconds: number, wind: number): number => seconds * wind;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D cells;
  uniform vec3 colour;
  uniform vec2 eye;
  uniform float drift;
  uniform float period;
  uniform float fadeNear;
  uniform float fadeFar;
  varying vec3 vWorld;
  void main() {
    vec2 uv = (vWorld.xz - vec2(drift, 0.0)) / period;
    if (texture2D(cells, uv).r < 0.5) discard;
    // Fade by horizontal distance, into the sky behind; the underside a little darker.
    float fade = 1.0 - smoothstep(fadeNear, fadeFar, length(vWorld.xz - eye));
    if (fade <= 0.0) discard;
    gl_FragColor = vec4(colour * (gl_FrontFacing ? 1.0 : 0.82), 0.85 * fade);
    #include <colorspace_fragment>
  }
`;

export class Clouds {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    seed: number,
    cover: number,
    private readonly height: number,
    cell: number,
  ) {
    const texture = new THREE.DataTexture(cloudCells(seed, cover), CLOUD_CELLS, CLOUD_CELLS, THREE.RedFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        cells: { value: texture },
        colour: { value: new THREE.Color() },
        eye: { value: new THREE.Vector2() },
        drift: { value: 0 },
        period: { value: CLOUD_CELLS * cell },
        fadeNear: { value: 0 },
        fadeFar: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Keep the canvas's alpha (see blockMaterial.ts).
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    // After the water, before nothing else that matters.
    this.mesh.renderOrder = 2;
  }

  /** Once a frame: over the camera, as wide as the view, drifted by `seconds` of wind, in `colour` (sRGB). */
  update(camera: THREE.Camera, seconds: number, wind: number, colour: [number, number, number], viewDistance: number, underwater: boolean): void {
    this.mesh.visible = !underwater;
    const reach = viewDistance * 1.6;
    this.mesh.position.set(camera.position.x, this.height, camera.position.z);
    this.mesh.scale.set(reach * 2, 1, reach * 2);
    const u = this.material.uniforms;
    (u.colour.value as THREE.Color).setRGB(...colour, THREE.SRGBColorSpace);
    (u.eye.value as THREE.Vector2).set(camera.position.x, camera.position.z);
    u.drift.value = cloudDrift(seconds, wind) % (u.period.value as number);
    u.fadeNear.value = viewDistance * 0.6;
    u.fadeFar.value = reach;
  }
}
