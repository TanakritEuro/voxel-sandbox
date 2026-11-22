// What falls: one instanced mesh of quads in one draw call, round the eye in a box
// `TUNING.weather.precipitation.box` blocks across. An instance is a streak of rain where rain
// falls, a square flake where snow does (every other one: snow is sparser), nothing elsewhere,
// and a few of them are splashes where drops land. The vertex shader moves them all and reads
// the cover (`world/cover.ts`, `coverMap.ts`) to end each where it lands, so nothing falls
// under a roof and the main thread does nothing for a drop.
//
// Everything repeats every `box` seconds: speeds are whole blocks a second, sways and splashes
// whole numbers of cycles, so the clock can be wrapped and stay exact for the shader however
// long the world runs, and a drop leaving one side of the box comes back at the other.

import * as THREE from 'three';
import { TUNING } from '../config';
import { createRng } from '../math';
import { COVER_GLSL, COVER_SIZE, type CoverMap } from './coverMap';
import type { RGB } from './sky';

/** The clock `dt` seconds on, wrapped where everything repeats. */
export const fallClock = (clock: number, dt: number): number => (clock + dt) % TUNING.weather.precipitation.box;

/** `v` wrapped into the box (0 to `box`), kept small for the shader. */
export const inBox = (v: number): number => {
  const box = TUNING.weather.precipitation.box;
  return ((v % box) + box) % box;
};

/** How many instances to draw with it falling this hard (0–1): the splashes, then that share of the drops. */
export function instancesFor(fall: number): number {
  const { drops, splashes } = TUNING.weather.precipitation;
  return fall > 0 ? splashes + Math.ceil(drops * Math.min(1, fall)) : 0;
}

/** Whether any of it could be seen from eye height `eyeY`, rain getting down to `lowest` near it (Infinity: nothing falls near). */
export function canShow(lowest: number, eyeY: number): boolean {
  const { box, ceiling } = TUNING.weather.precipitation;
  const top = Math.min(eyeY + box / 2, ceiling);
  return lowest < top && eyeY - box / 2 < ceiling;
}

const vertexShader = /* glsl */ `
  uniform float clock;
  uniform vec3 eyeInBox;
  uniform float fall;
  attribute vec4 seed;
  attribute float id;
  varying vec2 vCorner;
  varying float vFade;
  /** 0 a streak, 1 a flake, 2 a splash. */
  flat varying float vKind;
  /** How far through its life a splash is, 0–1. */
  flat varying float vAge;

  ${COVER_GLSL}

  float random(float a, float b) {
    return fract(sin(a * 12.9898 + b * 78.233) * 43758.5453);
  }

  /** The nearest to the eye of the places that are p in the box, from the eye. */
  vec3 nearest(vec3 p) {
    return mod(p - eyeInBox + BOX * 0.5, BOX) - BOX * 0.5;
  }

  void hide() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }

  void main() {
    vCorner = vec2(position.x + 0.5, position.y);
    vFade = 0.0;
    vKind = 0.0;
    vAge = 0.0;
    mat3 turn = mat3(viewMatrix);
    vec3 view;

    if (id < SPLASHES) {
      if (id >= SPLASHES * fall) { hide(); return; }
      float cycle = clock / SPLASH_LIFE + seed.x;
      float n = mod(floor(cycle), SPLASH_CYCLES);
      vec3 at = nearest(vec3(random(id, n), 0.0, random(id + 0.5, n)) * BOX);
      vec2 cover = coverAt(at.xz + cameraPosition.xz);
      if (cover.y != 1.0 || cover.x > CEILING) { hide(); return; }
      at.y = cover.x + 0.03 - cameraPosition.y;
      vKind = 2.0;
      vAge = fract(cycle);
      vFade = (1.0 - smoothstep(10.0, 18.0, length(at))) * (1.0 - vAge * 0.6);
      view = turn * at;
      view.xy += vec2(position.x * SPLASH_WIDTH, position.y * SPLASH_WIDTH * 0.6);
    } else {
      // What falls is the column's: the x and z it's at decide whether it's a drop or a flake.
      float rainSpeed = floor(mix(RAIN_SPEED.x, RAIN_SPEED.y + 0.999, seed.w));
      vec3 rainFall = vec3(RAIN_WIND.x, -rainSpeed, RAIN_WIND.y);
      vec3 at = nearest(seed.xyz * BOX + rainFall * clock);
      vec2 cover = coverAt(at.xz + cameraPosition.xz);

      if (cover.y == 1.0) {
        float height = cover.x - cameraPosition.y;
        vec3 streak = -normalize(rainFall) * RAIN_LENGTH;
        if (at.y + streak.y <= height || at.y + cameraPosition.y > CEILING) { hide(); return; }
        // Cut off where it lands.
        float from = clamp((height - at.y) / streak.y, 0.0, 1.0);
        vec3 middle = at + streak * 0.5;
        vec3 across = normalize(cross(streak, middle) + vec3(1e-4, 0.0, 0.0));
        // A little wider far off, or it's thinner than a pixel.
        float width = max(RAIN_WIDTH, length(middle) * 0.0016);
        view = turn * (at + streak * mix(from, 1.0, position.y) + across * position.x * width);
        vCorner.y = mix(from, 1.0, position.y);
        vFade = smoothstep(0.8, 2.5, length(middle));
      } else {
        // Snow falls slower, so it's placed again by its own speed, and asked again what falls there.
        float n = floor(id - SPLASHES);
        if (mod(n, 2.0) > 0.5) { hide(); return; }
        float snowSpeed = floor(mix(SNOW_SPEED.x, SNOW_SPEED.y + 0.999, seed.w));
        float turns = floor(5.0 + seed.x * 5.0);
        float angle = 6.2831853 * (clock * turns / BOX + seed.y);
        vec3 drift = vec3(SNOW_WIND.x, -snowSpeed, SNOW_WIND.y) * clock + vec3(sin(angle), 0.0, cos(angle)) * SNOW_SWAY;
        at = nearest(seed.xyz * BOX + drift);
        cover = coverAt(at.xz + cameraPosition.xz);
        float worldY = at.y + cameraPosition.y;
        if (cover.y != 2.0 || worldY < cover.x || worldY > CEILING) { hide(); return; }
        vKind = 1.0;
        float size = max(SNOW_SIZE, length(at) * 0.003);
        view = turn * at;
        view.xy += vec2(position.x, position.y - 0.5) * size;
        vFade = smoothstep(1.5, 4.0, length(at)); // none so near it's a big square
      }
      // Faded out by the box's sides, so none pops in or out there.
      vFade *= (1.0 - smoothstep(BOX * 0.35, BOX * 0.5, length(at.xz))) * (1.0 - smoothstep(BOX * 0.4, BOX * 0.5, abs(at.y)));
    }
    if (vFade <= 0.0) { hide(); return; }
    gl_Position = projectionMatrix * vec4(view, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 rainColour;
  uniform vec3 snowColour;
  varying vec2 vCorner;
  varying float vFade;
  flat varying float vKind;
  flat varying float vAge;

  void main() {
    if (vKind == 1.0) {
      gl_FragColor = vec4(snowColour, 0.9 * vFade);
    } else if (vKind == 2.0) {
      // Three square specks thrown up and out.
      float up = 0.12 + 2.6 * vAge * (1.0 - vAge);
      float out_ = 0.08 + 0.36 * vAge;
      bool speck = false;
      for (int k = -1; k <= 1; k++) {
        vec2 middle = vec2(0.5 + float(k) * out_, k == 0 ? up : up * 0.6);
        vec2 off = abs(vCorner - middle);
        speck = speck || (off.x < 0.06 && off.y < 0.1);
      }
      if (!speck) discard;
      gl_FragColor = vec4(rainColour, 0.75 * vFade);
    } else {
      // Fainter towards its tail.
      gl_FragColor = vec4(rainColour, RAIN_OPACITY * vFade * (1.0 - 0.6 * vCorner.y));
    }
    #include <colorspace_fragment>
  }
`;

/** A number as a GLSL float. */
const float = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const vec2 = ([x, y]: readonly number[]): string => `vec2(${float(x)}, ${float(y)})`;

export class Precipitation {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private clock = 0;

  constructor(private readonly cover: CoverMap) {
    const P = TUNING.weather.precipitation;
    const count = P.splashes + P.drops;
    const geometry = new THREE.InstancedBufferGeometry();
    // One quad: x across it, y along it from its foot.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const rng = createRng(31);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rng();
    const ids = new Float32Array(count);
    for (let i = 0; i < count; i++) ids[i] = i;
    geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.setAttribute('id', new THREE.InstancedBufferAttribute(ids, 1));
    geometry.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        cover: { value: cover.texture },
        coverOrigin: { value: cover.origin },
        clock: { value: 0 },
        eyeInBox: { value: new THREE.Vector3() },
        fall: { value: 0 },
        rainColour: { value: new THREE.Color() },
        snowColour: { value: new THREE.Color() },
      },
      defines: {
        COVER_SIZE,
        BOX: float(P.box),
        CEILING: float(P.ceiling),
        SPLASHES: float(P.splashes),
        SPLASH_CYCLES: float(P.splash.cycles),
        SPLASH_LIFE: float(P.box / P.splash.cycles),
        SPLASH_WIDTH: float(P.splash.width),
        RAIN_SPEED: vec2(P.rain.speed),
        RAIN_WIND: vec2(P.rain.wind),
        RAIN_LENGTH: float(P.rain.length),
        RAIN_WIDTH: float(P.rain.width),
        RAIN_OPACITY: float(P.rain.opacity),
        SNOW_SPEED: vec2(P.snow.speed),
        SNOW_WIND: vec2(P.snow.wind),
        SNOW_SIZE: float(P.snow.size),
        SNOW_SWAY: float(P.snow.sway),
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      // Keep the canvas's alpha (see blockMaterial.ts).
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // After the water and the clouds.
    this.mesh.renderOrder = 3;
  }

  /**
   * Once a frame, after the cover's update: `dt` on (0 while the world stands still), falling
   * `fall` hard (0–1) round `eye`, coloured for the `horizon` and the drawn `daylight`.
   */
  update(eye: THREE.Vector3, dt: number, fall: number, horizon: RGB, daylight: number, eyeUnder: boolean): void {
    this.clock = fallClock(this.clock, dt);
    const mesh = this.mesh;
    mesh.visible = false;
    if (fall <= 0 || eyeUnder) return;
    // Under cover with no sky near, and over deserts, there'd be none to see: no draw.
    if (!canShow(this.cover.lowestFalling(eye.x, eye.z, TUNING.weather.precipitation.box / 2), eye.y)) return;
    mesh.visible = true;
    mesh.geometry.instanceCount = instancesFor(fall);
    const u = mesh.material.uniforms;
    u.clock.value = this.clock;
    u.fall.value = fall;
    (u.eyeInBox.value as THREE.Vector3).set(inBox(eye.x), inBox(eye.y), inBox(eye.z));
    // Rain is the sky seen in it, a little lighter; snow is white in what light there is.
    const lift = 0.45 * daylight;
    const [r, g, b] = horizon.map((c) => c + (1 - c) * lift);
    (u.rainColour.value as THREE.Color).setRGB(r, g, b, THREE.SRGBColorSpace);
    const white = Math.min(1, 0.2 + daylight * 1.2);
    (u.snowColour.value as THREE.Color).setRGB(white * 0.97, white * 0.98, white, THREE.SRGBColorSpace);
  }
}
