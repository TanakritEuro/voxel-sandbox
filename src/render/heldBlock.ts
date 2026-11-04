// The held block: the selected hotbar block, small, at the lower right of the view. It's meshed
// by the chunk mesher as a lone block (so a torch is a torch and leaves have holes) and drawn
// with the chunk material, lit by the light where the player's eyes are. It has its own scene
// and camera, drawn after the world with the depth cleared, so it never sinks into a wall, and
// a field of view of its own, so the FOV setting doesn't stretch it.
//
// It bobs with each stride walked, swings down and forward when breaking, digging or placing,
// and dips out and back in when the selection changes (`HeldMotion`, pure).
//
// An item that isn't a block (a tool, a stick) is held as its picture made solid: a slab one pixel
// thick, a little box per filled pixel with only the faces that show (`itemMesh`), coloured by
// the pixels, tilted like a tool in the hand, and as bright as the light where the eyes are.

import * as THREE from 'three';
import { meshChunk } from '../mesh/mesher';
import type { ChunkMesh } from '../mesh/mesher';
import { PADDED_VOLUME, paddedIndex } from '../mesh/padding';
import { Block } from '../world/blocks';
import { createBlockMaterial } from './blockMaterial';
import { chunkGeometry } from './chunkRenderer';

/** A lone block's mesh, at (0, 0, 0)–(1, 1, 1), every neighbour air, lit throughout by `light` (packed). */
export function heldMesh(block: Block, light: number): ChunkMesh {
  const padded = new Uint8Array(PADDED_VOLUME);
  padded[paddedIndex(1, 1, 1)] = block;
  return meshChunk(padded, 0, 0, 0, new Uint8Array(PADDED_VOLUME).fill(light));
}

/** Faces of an item's slab: the direction out, and how bright (front and back full, sides darker). */
const SLAB_FACES: { n: [number, number, number]; shade: number }[] = [
  { n: [0, 0, 1], shade: 1 },
  { n: [0, 0, -1], shade: 0.8 },
  { n: [1, 0, 0], shade: 0.65 },
  { n: [-1, 0, 0], shade: 0.65 },
  { n: [0, 1, 0], shade: 0.9 },
  { n: [0, -1, 0], shade: 0.55 },
];

/**
 * An item's 16 × 16 picture (`itemArt`) as a slab: positions and colours of triangles, the
 * picture across (-0.5, -0.5)–(0.5, 0.5) facing +z, a sixteenth thick. A face is kept only where the
 * pixel beside it is empty (the front and back always).
 */
export function itemMesh(art: Uint8Array): { positions: Float32Array; colours: Float32Array } {
  const N = 16;
  const p = 1 / N;
  const filled = (x: number, y: number) => x >= 0 && x < N && y >= 0 && y < N && art[(y * N + x) * 4 + 3] > 0;
  const positions: number[] = [];
  const colours: number[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!filled(x, y)) continue;
      const i = (y * N + x) * 4;
      // Row 0 is the top of the picture.
      const x0 = -0.5 + x * p;
      const y0 = 0.5 - (y + 1) * p;
      for (const { n, shade } of SLAB_FACES) {
        if ((n[0] || n[1]) && filled(x + n[0], y - n[1])) continue;
        const [a, b] = n[2] ? [[1, 0, 0], [0, 1, 0]] : n[0] ? [[0, 1, 0], [0, 0, 1]] : [[0, 0, 1], [1, 0, 0]];
        // The face's corner nearest the origin, then its two edges.
        const c = [x0 + (n[0] > 0 ? p : 0), y0 + (n[1] > 0 ? p : 0), n[2] > 0 ? p / 2 : -p / 2];
        const size = [p, p, p];
        const ea = a.map((v, k) => v * size[k]);
        const eb = b.map((v, k) => v * size[k]);
        const corner = (u: number, v: number) => [c[0] + ea[0] * u + eb[0] * v, c[1] + ea[1] * u + eb[1] * v, c[2] + ea[2] * u + eb[2] * v];
        for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) positions.push(...corner(u, v));
        for (let k = 0; k < 6; k++) colours.push((art[i] / 255) * shade, (art[i + 1] / 255) * shade, (art[i + 2] / 255) * shade);
      }
    }
  }
  return { positions: new Float32Array(positions), colours: new Float32Array(colours) };
}

/** Where the held block is, relative to its resting place: offsets (view units) and turns (radians). */
export interface HeldPose {
  x: number;
  y: number;
  z: number;
  pitch: number;
}

const SWING_SECONDS = 0.25;
const DIP_SECONDS = 0.2;
/** One bob (down and up) a stride; this high and this far sideways. */
const BOB_STRIDE = 1.6;
const BOB_HEIGHT = 0.035;
const BOB_SIDE = 0.025;

export class HeldMotion {
  /** Through the walk, radians: a full bob each stride. */
  private phase = 0;
  /** How much of the bob shows (it fades in walking and out standing). */
  private walking = 0;
  /** Time since a swing or a switch started (Infinity: none). */
  private swingAge = Infinity;
  private dipAge = Infinity;

  /** Once a frame: `moved` blocks walked on the ground this frame (0 in the air or flying). */
  update(dt: number, moved: number): void {
    this.phase += (moved / BOB_STRIDE) * Math.PI * 2;
    const target = moved > 0 ? 1 : 0;
    this.walking += (target - this.walking) * (1 - Math.exp(-dt * 10));
    this.swingAge += dt;
    this.dipAge += dt;
  }

  /** Breaking, digging or placing. */
  swing(): void {
    this.swingAge = 0;
  }

  /** The held block changed. */
  switched(): void {
    this.dipAge = 0;
  }

  get pose(): HeldPose {
    const bobY = -Math.abs(Math.sin(this.phase / 2)) * BOB_HEIGHT * this.walking;
    const bobX = Math.sin(this.phase / 2) * BOB_SIDE * this.walking;
    const s = this.swingAge < SWING_SECONDS ? Math.sin((Math.PI * this.swingAge) / SWING_SECONDS) : 0;
    const d = this.dipAge < DIP_SECONDS ? 1 - this.dipAge / DIP_SECONDS : 0;
    return { x: bobX - 0.05 * s, y: bobY - 0.12 * s - 0.35 * d, z: -0.12 * s, pitch: -0.7 * s };
  }
}

/** The held block's scene, camera and materials; `render` draws it over the world. */
export class HeldBlock {
  readonly motion = new HeldMotion();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private readonly holder = new THREE.Group();
  private readonly opaque: THREE.ShaderMaterial;
  private readonly cutout: THREE.ShaderMaterial;
  private readonly transparent: THREE.ShaderMaterial;
  private readonly itemMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  /** What's held: a block's id or an item's (from 256), or null before anything is. */
  private block: number | null = null;
  private light = -1;
  private holdingItem = false;

  constructor(textures: THREE.DataArrayTexture) {
    this.opaque = createBlockMaterial(textures, { alphaTest: 0, transparent: false });
    this.cutout = createBlockMaterial(textures, { alphaTest: 0.5, transparent: false });
    this.transparent = createBlockMaterial(textures, { alphaTest: 0.01, transparent: true });
    this.scene.add(this.holder);
  }

  /** Hold `block`, lit by `light` (packed, where the eyes are), under the day's `sunlight`; nothing for air. */
  set(block: Block, light: number, sunlight: [number, number, number]): void {
    for (const m of [this.opaque, this.cutout, this.transparent]) (m.uniforms.sunlight.value as THREE.Vector3).set(...sunlight);
    if (block === this.block && light === this.light) return;
    this.replace(block, light);
    this.holdingItem = false;
    if (block === Block.Air) return;
    const mesh = heldMesh(block, light);
    for (const [data, material] of [
      [mesh.opaque, this.opaque],
      [mesh.cutout, this.cutout],
      [mesh.transparent, this.transparent],
    ] as const) {
      if (!data.indices.length) continue;
      const m = new THREE.Mesh(chunkGeometry(data), material);
      // Centred on the block's middle, so it turns about it.
      m.position.set(-0.5, -0.5, -0.5);
      this.holder.add(m);
    }
  }

  /** Hold item `item` (not a block) as its picture `art` made solid, `brightness` 0–1 as lit where the eyes are. */
  setItem(item: number, art: Uint8Array, brightness: number): void {
    this.itemMaterial.color.setScalar(0.25 + 0.75 * brightness);
    if (item === this.block) return;
    this.replace(item, -1);
    this.holdingItem = true;
    const { positions, colours } = itemMesh(art);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const m = new THREE.Mesh(geometry, this.itemMaterial);
    // Tilted like a tool held out: its head up and away, its face half to the eye.
    m.rotation.set(0, -0.9, 0.55, 'YXZ');
    m.scale.setScalar(1.35);
    m.position.set(0.15, 0.3, 0);
    this.holder.add(m);
  }

  /** What's held changes: a dip if it was something else, and the old meshes gone. */
  private replace(held: number, light: number): void {
    if (this.block !== null && held !== this.block) this.motion.switched();
    this.block = held;
    this.light = light;
    for (const child of [...this.holder.children]) {
      this.holder.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
  }

  /** Draw it over what's on screen: after the world, with the depth cleared. */
  render(renderer: THREE.WebGLRenderer, aspect: number, visible: boolean): void {
    if (!visible || !this.holder.children.length) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const p = this.motion.pose;
    // At rest: lower right, turned to show its top and two sides.
    this.holder.position.set(0.58 + p.x, -0.44 + p.y, -1.15 + p.z);
    this.holder.rotation.set(0.35 + p.pitch, this.holdingItem ? 0 : -0.75, 0, 'XYZ');
    this.holder.scale.setScalar(0.36);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
