// The held block: the selected hotbar block, small, at the lower right of the view. It's meshed
// by the chunk mesher as a lone block (so a torch is a torch and leaves have holes) and drawn
// with the chunk material, lit by the light where the player's eyes are. It has its own scene
// and camera, drawn after the world with the depth cleared, so it never sinks into a wall, and
// a field of view of its own, so the FOV setting doesn't stretch it.
//
// It bobs with each stride walked, swings down and forward when breaking, digging or placing,
// and dips out and back in when the selection changes (`HeldMotion`, pure).

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
  private block: Block | null = null;
  private light = -1;

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
    if (this.block !== null && block !== this.block) this.motion.switched();
    this.block = block;
    this.light = light;
    for (const child of [...this.holder.children]) {
      this.holder.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
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

  /** Draw it over what's on screen: after the world, with the depth cleared. */
  render(renderer: THREE.WebGLRenderer, aspect: number, visible: boolean): void {
    if (!visible || !this.holder.children.length) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const p = this.motion.pose;
    // At rest: lower right, turned to show its top and two sides.
    this.holder.position.set(0.58 + p.x, -0.44 + p.y, -1.15 + p.z);
    this.holder.rotation.set(0.35 + p.pitch, -0.75, 0, 'XYZ');
    this.holder.scale.setScalar(0.36);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
