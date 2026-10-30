// Drawing the mobs: each kind is a few boxes (a model), and each box of each kind is one
// InstancedMesh with an instance per mob, so all the mobs together are a handful of draw calls.
// Boxes carry the chunk mesher's directional shading in their vertex colours; each mob is lit
// by the world's light where it stands and the day's light, as the particles are, and fogged.
// Positions and facing are drawn between the last two physics steps, so they move smoothly at
// any frame rate.

import * as THREE from 'three';
import { SHADE } from '../mesh/mesher';
import type { Mob } from '../mobs/brain';
import { MobKind } from '../mobs/kinds';
import type { MobManager } from '../mobs/mobs';
import type { World } from '../world/world';
import { brightness } from './particles';

/** One box of a model: its size, its middle relative to the feet (forward is -z), its colour (sRGB). */
export interface ModelBox {
  size: [number, number, number];
  at: [number, number, number];
  colour: number;
}

/** The models, by kind: for now a body and a head (step 4 adds legs and the rest). */
export const MODELS: Record<MobKind, ModelBox[]> = {
  [MobKind.Mossback]: [
    { size: [0.85, 0.65, 1.2], at: [0, 0.6, 0.05], colour: 0x6b5a45 },
    { size: [0.5, 0.5, 0.5], at: [0, 0.75, -0.75], colour: 0x7d6a52 },
  ],
  [MobKind.Hopper]: [
    { size: [0.42, 0.38, 0.55], at: [0, 0.22, 0.05], colour: 0xc9b48f },
    { size: [0.34, 0.34, 0.34], at: [0, 0.38, -0.3], colour: 0xd6c39e },
  ],
  [MobKind.CragGoat]: [
    { size: [0.6, 0.55, 1.0], at: [0, 0.8, 0.05], colour: 0xe4e2dc },
    { size: [0.38, 0.45, 0.45], at: [0, 1.05, -0.55], colour: 0xd2cfc6 },
  ],
  [MobKind.DuneBeetle]: [
    { size: [0.8, 0.32, 1.0], at: [0, 0.2, 0.05], colour: 0x3c4a5a },
    { size: [0.42, 0.24, 0.3], at: [0, 0.17, -0.6], colour: 0x2c3540 },
  ],
};

/** How long a hit shows red (seconds). */
const FLASH = 0.25;

/** A box geometry whose faces are shaded by direction (+x, -x, +y, -y, +z, -z), as the chunks are. */
function shadedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const colours = new Float32Array(geo.attributes.position.count * 3);
  // BoxGeometry's faces come in that order, four vertices each.
  for (let face = 0; face < 6; face++) for (let v = 0; v < 4; v++) colours.fill(SHADE[face], (face * 4 + v) * 3, (face * 4 + v) * 3 + 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geo;
}

interface Part {
  kind: MobKind;
  box: ModelBox;
  rgb: [number, number, number];
  mesh: THREE.InstancedMesh;
}

const matrix = new THREE.Matrix4();
const place = new THREE.Matrix4();
const colour = new THREE.Color();

export class MobRenderer {
  readonly group = new THREE.Group();
  private readonly parts: Part[] = [];

  /** `capacity`: the most mobs there can be (any one kind could be all of them). */
  constructor(capacity: number) {
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    for (const kind of Object.keys(MODELS).map(Number) as MobKind[]) {
      for (const box of MODELS[kind]) {
        const mesh = new THREE.InstancedMesh(shadedBox(...box.size), material, Math.max(1, capacity));
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.setColorAt(0, colour.set(0xffffff));
        const rgb: [number, number, number] = [((box.colour >> 16) & 255) / 255, ((box.colour >> 8) & 255) / 255, (box.colour & 255) / 255];
        this.parts.push({ kind, box, rgb, mesh });
        this.group.add(mesh);
      }
    }
  }

  /** Once a frame, after the mobs moved: their instances, between the last two steps. */
  update(manager: MobManager, world: World, daylight: number): void {
    for (const p of this.parts) p.mesh.count = 0;
    const alpha = manager.alpha;
    for (const mob of manager.mobs) {
      const [x, y, z, yaw] = drawnAt(mob, manager.before.get(mob), alpha);
      const light = brightness(world.getLight(Math.floor(x), Math.floor(y + 0.5), Math.floor(z)), daylight);
      // A hit flashes red, fading out.
      const flash = mob.sinceHurt < FLASH ? 1 - mob.sinceHurt / FLASH : 0;
      place.makeRotationY(yaw).setPosition(x, y, z);
      for (const p of this.parts) {
        if (p.kind !== mob.kind) continue;
        matrix.makeTranslation(p.box.at[0], p.box.at[1], p.box.at[2]).premultiply(place);
        const n = p.mesh.count++;
        p.mesh.setMatrixAt(n, matrix);
        const [r, g, b] = p.rgb;
        colour.setRGB((r + (1 - r) * flash) * light, g * (1 - flash) * light, b * (1 - flash) * light, THREE.SRGBColorSpace);
        p.mesh.setColorAt(n, colour);
      }
    }
    for (const p of this.parts) {
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Draw calls this frame (for `?stats`): one per box of each kind with any mobs. */
  get drawCalls(): number {
    return this.parts.filter((p) => p.mesh.count > 0).length;
  }
}

/** Where a mob is drawn: between where it was before the last steps and now, by `alpha`; facing likewise, the short way round. */
export function drawnAt(mob: Mob, before: { x: number; y: number; z: number; yaw: number } | undefined, alpha: number): [number, number, number, number] {
  const b = mob.body;
  if (!before) return [b.x, b.y, b.z, mob.yaw];
  let turn = mob.yaw - before.yaw;
  turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
  return [before.x + (b.x - before.x) * alpha, before.y + (b.y - before.y) * alpha, before.z + (b.z - before.z) * alpha, before.yaw + turn * alpha];
}
