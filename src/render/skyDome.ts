// The sky: a dome round the camera shading from the horizon's colour (the fog's, so the edge
// of the world melts into it) up to the zenith's, glowing round the sun at dawn and dusk; a
// square pixel-art sun and moon opposite each other; and stars that come out at night and turn
// with the sun. All of it is drawn behind the world: inside the far plane, so mountains hide
// the sun, without fog, and without writing depth. Hidden under water, where the fog is the view.

import * as THREE from 'three';
import { createRng } from '../math';
import type { SkyState } from './sky';

const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const domeFragment = /* glsl */ `
  uniform vec3 horizon;
  uniform vec3 zenith;
  uniform vec3 glowColour;
  uniform float glow;
  uniform vec3 sunDir;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float up = max(dir.y, 0.0);
    vec3 colour = mix(horizon, zenith, smoothstep(0.0, 0.55, up));
    // Dawn and dusk: warm round the sun, mostly low in the sky.
    float toward = max(dot(dir, sunDir), 0.0);
    colour = mix(colour, glowColour, glow * pow(toward, 6.0) * (1.0 - smoothstep(0.0, 0.5, up)));
    gl_FragColor = vec4(colour, 1.0);
    #include <colorspace_fragment>
  }
`;

const SIZE = 16;
const STARS = 900;

/** RGBA pixels of a SIZE × SIZE image, painted by `paint(x, y)` → [r, g, b, a] (0–255). */
function image(paint: (x: number, y: number) => [number, number, number, number]): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) data.set(paint(x, y), (y * SIZE + x) * 4);
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** The sun: a square, white-hot in the middle, yellow towards the edge, a faint rim round it. */
function sunTexture(): THREE.DataTexture {
  return image((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 7) return [255, 200, 90, 70];
    if (d > 5) return [255, 214, 110, 255];
    if (d > 3) return [255, 236, 170, 255];
    return [255, 252, 232, 255];
  });
}

/** The moon: a pale square with clipped corners and a few darker craters. */
function moonTexture(): THREE.DataTexture {
  const rng = createRng(11);
  const craters = new Set<number>();
  for (let n = 0; n < 7; n++) {
    const cx = 3 + Math.floor(rng() * 9);
    const cy = 3 + Math.floor(rng() * 9);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (rng() < 0.7) craters.add((cy + dy) * SIZE + cx + dx);
  }
  return image((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const corner = Math.abs(x - 7.5) > 5 && Math.abs(y - 7.5) > 5;
    if (d > 6.5 || corner) return [0, 0, 0, 0];
    return craters.has(y * SIZE + x) ? [176, 184, 196, 255] : [222, 228, 236, 255];
  });
}

export class SkyDome {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly moonMaterial: THREE.SpriteMaterial;
  /** Leans the stars' circle like the sun's; `stars` turns within it. */
  private readonly tilt = new THREE.Group();
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly sunDir = new THREE.Vector3();

  constructor(tilt: number) {
    this.domeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        horizon: { value: new THREE.Color() },
        zenith: { value: new THREE.Color() },
        glowColour: { value: new THREE.Color() },
        glow: { value: 0 },
        sunDir: { value: this.sunDir },
      },
      vertexShader: domeVertex,
      fragmentShader: domeFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.domeMaterial);
    this.dome.renderOrder = -3;
    this.dome.frustumCulled = false;

    // Stars: seeded directions over the sky, a few below the horizon so none pop out as they turn.
    const rng = createRng(29);
    const positions = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const z = rng() * 2 - 1;
      const a = rng() * 2 * Math.PI;
      const r = Math.sqrt(1 - z * z);
      positions.set([r * Math.cos(a), r * Math.sin(a), z], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
    this.stars = new THREE.Points(geometry, this.starMaterial);
    this.stars.renderOrder = -2;
    this.stars.frustumCulled = false;
    this.tilt.rotation.x = tilt;
    this.tilt.add(this.stars);

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.moonMaterial = new THREE.SpriteMaterial({ map: moonTexture(), depthWrite: false, fog: false });
    this.moon = new THREE.Sprite(this.moonMaterial);
    for (const s of [this.sun, this.moon]) {
      s.renderOrder = -1;
      s.frustumCulled = false;
    }
    this.group.add(this.dome, this.tilt, this.sun, this.moon);
  }

  /** Once a frame: follow the camera, inside its far plane, and show the sky for `sky`. */
  update(camera: THREE.PerspectiveCamera, sky: SkyState, glowHex: number, underwater: boolean): void {
    this.group.visible = !underwater;
    if (underwater) return;
    const r = camera.far * 0.9;
    this.group.position.copy(camera.position);
    this.dome.scale.setScalar(r);
    this.stars.scale.setScalar(r * 0.97);
    this.stars.rotation.z = sky.angle;
    this.starMaterial.opacity = sky.stars;
    this.stars.visible = sky.stars > 0.01;

    const u = this.domeMaterial.uniforms;
    (u.horizon.value as THREE.Color).setRGB(...sky.colour, THREE.SRGBColorSpace);
    (u.zenith.value as THREE.Color).setRGB(...sky.zenith, THREE.SRGBColorSpace);
    (u.glowColour.value as THREE.Color).setHex(glowHex);
    u.glow.value = sky.glow;
    this.sunDir.set(...sky.sun);

    this.sun.position.copy(this.sunDir).multiplyScalar(r * 0.95);
    this.sun.scale.setScalar(r * 0.16);
    this.moon.position.copy(this.sunDir).multiplyScalar(-r * 0.95);
    this.moon.scale.setScalar(r * 0.11);
    // Faint in daylight, as the moon is.
    this.moonMaterial.opacity = 1 - 0.7 * Math.min(1, Math.max(0, sky.elevation * 3));
  }
}
