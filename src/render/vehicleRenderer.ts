// Drawing vehicles (Milestone 18), as the mobs are drawn: each kind a few boxes, each box one
// InstancedMesh with an instance per vehicle, shaded by direction as the chunks are, with painted
// textures, lit by the world's light where it stands and the day's light, and fogged. Each is drawn
// between its last two steps, facing along its rail and tipped up or down a slope.

import * as THREE from 'three';
import type { Vehicle } from '../vehicles/vehicle';
import { VehicleKind } from '../vehicles/vehicle';
import type { VehicleBefore } from '../vehicles/manager';
import type { World } from '../world/world';
import { shadedBox } from './mobRenderer';
import { fur, painted } from './mobTextures';
import { brightness } from './particles';

/** What the renderer draws: the vehicles, and where each is drawn now. */
export interface VehicleView {
  readonly vehicles: readonly Vehicle[];
  drawnAt(v: Vehicle): VehicleBefore;
}

type VehicleTexture = 'iron' | 'floor' | 'wheel' | 'chest';

interface Box {
  size: [number, number, number];
  /** Its middle, from the vehicle's feet (forward is -z). */
  at: [number, number, number];
  texture: VehicleTexture;
}

/** A cart: an open iron tub on four small wheels, its floor low. */
const CART: Box[] = [
  { size: [0.9, 0.08, 1.0], at: [0, 0.2, 0], texture: 'floor' },
  { size: [0.08, 0.48, 1.0], at: [-0.41, 0.48, 0], texture: 'iron' },
  { size: [0.08, 0.48, 1.0], at: [0.41, 0.48, 0], texture: 'iron' },
  { size: [0.74, 0.48, 0.08], at: [0, 0.48, -0.46], texture: 'iron' },
  { size: [0.74, 0.48, 0.08], at: [0, 0.48, 0.46], texture: 'iron' },
  ...[-0.3, 0.3].flatMap((z) => [-0.47, 0.47].map((x): Box => ({ size: [0.08, 0.22, 0.22], at: [x, 0.12, z], texture: 'wheel' }))),
];
/** A chest cart: the cart with a chest sitting in it. */
const CHEST_CART: Box[] = [...CART, { size: [0.7, 0.66, 0.84], at: [0, 0.57, 0], texture: 'chest' }];

const MODELS: Record<VehicleKind, Box[]> = {
  [VehicleKind.Cart]: CART,
  [VehicleKind.ChestCart]: CHEST_CART,
};

function textures(): Record<VehicleTexture, THREE.DataTexture> {
  const rgb = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const shade = ([r, g, b]: [number, number, number], k: number): [number, number, number] => [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];
  return {
    // Grey plates with darker seams and rivets.
    iron: painted(41, (x, y, r) => {
      const seam = x % 8 === 0 || y === 0 || y === 15;
      const rivet = (x % 8 === 2 || x % 8 === 6) && (y === 2 || y === 13);
      return shade(rgb(seam ? 0x55595e : rivet ? 0xc8ccd0 : 0x8a8e93), 1 + (r() - 0.5) * 0.12);
    }),
    floor: fur(42, 0x6b6f74, 0.2),
    wheel: painted(43, (x, y, r) => shade(rgb(Math.hypot(x - 7.5, y - 7.5) < 3 ? 0x8a8e93 : 0x2a2a2c), 1 + (r() - 0.5) * 0.15)),
    // Boards and dark edges, as a chest.
    chest: painted(44, (x, y, r) => {
      const edge = x === 0 || x === 15 || y === 0 || y === 15 || y === 5;
      return shade(rgb(edge ? 0x5a3a1e : 0x9a6a3a), (y % 4 === 3 ? 0.88 : 1) * (1 + (r() - 0.5) * 0.12));
    }),
  };
}

interface Part {
  kind: VehicleKind;
  box: Box;
  mesh: THREE.InstancedMesh;
}

const m = new THREE.Matrix4();
const step = new THREE.Matrix4();
const colour = new THREE.Color();

export class VehicleRenderer {
  readonly group = new THREE.Group();
  private readonly parts: Part[] = [];

  /** `capacity`: the most vehicles there can be. */
  constructor(capacity: number) {
    const maps = textures();
    const materials = new Map<VehicleTexture, THREE.MeshBasicMaterial>();
    for (const kind of [VehicleKind.Cart, VehicleKind.ChestCart]) {
      for (const box of MODELS[kind]) {
        let mat = materials.get(box.texture);
        if (!mat) materials.set(box.texture, (mat = new THREE.MeshBasicMaterial({ map: maps[box.texture], vertexColors: true, fog: true })));
        const mesh = new THREE.InstancedMesh(shadedBox(...box.size), mat, Math.max(1, capacity));
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.setColorAt(0, colour.set(0xffffff));
        this.parts.push({ kind, box, mesh });
        this.group.add(mesh);
      }
    }
  }

  /** Once a frame, after the vehicles moved. */
  update(view: VehicleView, world: World, daylight: number): void {
    for (const p of this.parts) p.mesh.count = 0;
    for (const v of view.vehicles) {
      const at = view.drawnAt(v);
      const light = brightness(world.getLight(Math.floor(at.x), Math.floor(at.y + 0.5), Math.floor(at.z)), daylight);
      colour.setRGB(light, light, light, THREE.SRGBColorSpace);
      for (const p of this.parts) {
        if (p.kind !== v.kind) continue;
        m.makeTranslation(at.x, at.y, at.z);
        m.multiply(step.makeRotationY(at.yaw));
        m.multiply(step.makeRotationX(at.pitch));
        m.multiply(step.makeTranslation(...p.box.at));
        const n = p.mesh.count++;
        p.mesh.setMatrixAt(n, m);
        p.mesh.setColorAt(n, colour);
      }
    }
    for (const p of this.parts) {
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Draw calls this frame: one per box of each kind with any vehicles. */
  get drawCalls(): number {
    return this.parts.filter((p) => p.mesh.count > 0).length;
  }
}
