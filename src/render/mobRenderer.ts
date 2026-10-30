// Drawing the mobs. Each kind's model (`mobs/models.ts`) is a few boxes posed about pivots;
// each box of each kind is one InstancedMesh with an instance per copy per mob (all four legs of
// every mossback in one), so all the mobs together are about twenty draw calls at most.
//
// Boxes carry the chunk mesher's directional shading in their vertex colours and a painted
// texture (`mobTextures.ts`); each mob is lit by the world's light where it stands and the day's
// light, as the particles are, and fogged. Its pose (`mobs/pose.ts`: legs, head, lying down,
// a hopper's lean) sets each part's angle. Positions and facing are drawn between the last two
// physics steps, so they move smoothly at any frame rate.

import * as THREE from 'three';
import { SHADE } from '../mesh/mesher';
import type { Mob } from '../mobs/brain';
import { MobKind } from '../mobs/kinds';
import type { MobManager } from '../mobs/mobs';
import { MODELS, type MobTexture, type ModelPart } from '../mobs/models';
import { poseOf } from '../mobs/pose';
import type { World } from '../world/world';
import { mobTextures, sideAndFront } from './mobTextures';
import { brightness } from './particles';

/** How long a hit shows red (seconds). */
const FLASH = 0.25;
/** Folded legs at rest lie this far from hanging straight (radians). */
const FOLD = Math.PI * 0.45;
/** A beetle's legs swing sideways this much more than a walker's forward. */
const YAW_SWING = 1.5;

/**
 * A box geometry whose faces are shaded by direction (+x, -x, +y, -y, +z, -z), as the chunks are.
 * With `front`, its texture is a side-and-front pair (`sideAndFront`): the front face (-z) takes
 * the right half, the others the left.
 */
function shadedBox(w: number, h: number, d: number, front = false): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (front) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (i >= 20 ? 0.5 : 0) + uv.getX(i) * 0.5);
  }
  const colours = new Float32Array(geo.attributes.position.count * 3);
  // BoxGeometry's faces come in that order, four vertices each.
  for (let face = 0; face < 6; face++) for (let v = 0; v < 4; v++) colours.fill(SHADE[face], (face * 4 + v) * 3, (face * 4 + v) * 3 + 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geo;
}

interface Part {
  kind: MobKind;
  part: ModelPart;
  mesh: THREE.InstancedMesh;
}

const m = new THREE.Matrix4();
const place = new THREE.Matrix4();
const step = new THREE.Matrix4();
const colour = new THREE.Color();

export class MobRenderer {
  readonly group = new THREE.Group();
  private readonly parts: Part[] = [];

  /** `capacity`: the most mobs there can be (any one kind could be all of them). */
  constructor(capacity: number) {
    const textures = mobTextures();
    const materials = new Map<string, THREE.MeshBasicMaterial>();
    /** The material for a texture, or for a side texture and a front one together. */
    const material = (t: MobTexture, front?: MobTexture) => {
      const key = front ? `${t}|${front}` : t;
      let mat = materials.get(key);
      if (!mat) {
        const map = front ? sideAndFront(textures[t], textures[front]) : textures[t];
        materials.set(key, (mat = new THREE.MeshBasicMaterial({ map, vertexColors: true, fog: true })));
      }
      return mat;
    };
    for (const kind of Object.keys(MODELS).map(Number) as MobKind[]) {
      for (const part of MODELS[kind].parts) {
        // One material, its texture a side-and-front pair where the front differs: one draw call a part.
        const mesh = new THREE.InstancedMesh(shadedBox(...part.size, part.front !== undefined), material(part.texture, part.front), Math.max(1, capacity) * part.at.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.setColorAt(0, colour.set(0xffffff));
        this.parts.push({ kind, part, mesh });
        this.group.add(mesh);
      }
    }
  }

  /** Once a frame, after the mobs moved: their parts, posed, between the last two steps. `t` is any steady clock (seconds). */
  update(manager: MobManager, world: World, daylight: number, t: number): void {
    for (const p of this.parts) p.mesh.count = 0;
    const alpha = manager.alpha;
    for (const mob of manager.mobs) {
      const [x, y, z, yaw] = drawnAt(mob, manager.before.get(mob), alpha);
      const light = brightness(world.getLight(Math.floor(x), Math.floor(y + 0.5), Math.floor(z)), daylight);
      // A hit flashes red, fading out.
      const flash = mob.sinceHurt < FLASH ? 1 - mob.sinceHurt / FLASH : 0;
      colour.setRGB(light, light * (1 - flash), light * (1 - flash), THREE.SRGBColorSpace);
      const pose = poseOf(mob, t);
      const head = MODELS[mob.kind].headPivot;
      place.makeRotationY(yaw).setPosition(x, y - pose.drop, z);
      for (const p of this.parts) {
        if (p.kind !== mob.kind) continue;
        const part = p.part;
        for (const copy of part.at) {
          m.copy(place);
          if (part.onHead) pitchAbout(head, -pose.head);
          const [px, py, pz] = copy.pivot;
          m.multiply(step.makeTranslation(px, py, pz));
          if (part.tilt) m.multiply(step.makeRotationX(part.tilt));
          const phase = copy.phase ?? 1;
          switch (part.anim) {
            case 'head':
              m.multiply(step.makeRotationX(-pose.head));
              break;
            case 'body':
              m.multiply(step.makeRotationX(pose.lean));
              break;
            case 'ear':
              m.multiply(step.makeRotationX(pose.ears));
              break;
            case 'leg':
              // Swinging as it walks; folded at rest, front legs forward and back legs back.
              m.multiply(step.makeRotationX(pose.swing * phase * (1 - pose.fold) + pose.fold * (pz < 0 ? FOLD : -FOLD)));
              break;
            case 'legYaw':
              m.multiply(step.makeRotationY(pose.swing * phase * YAW_SWING));
              break;
          }
          const [ox, oy, oz] = copy.offset ?? part.offset;
          m.multiply(step.makeTranslation(ox, oy, oz));
          const n = p.mesh.count++;
          p.mesh.setMatrixAt(n, m);
          p.mesh.setColorAt(n, colour);
        }
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

/** Tip the matrix being built about a pivot by an angle about x (the head and what's on it). */
function pitchAbout([x, y, z]: [number, number, number], angle: number): void {
  m.multiply(step.makeTranslation(x, y, z)).multiply(step.makeRotationX(angle)).multiply(step.makeTranslation(-x, -y, -z));
}

/** Where a mob is drawn: between where it was before the last steps and now, by `alpha`; facing likewise, the short way round. */
export function drawnAt(mob: Mob, before: { x: number; y: number; z: number; yaw: number } | undefined, alpha: number): [number, number, number, number] {
  const b = mob.body;
  if (!before) return [b.x, b.y, b.z, mob.yaw];
  let turn = mob.yaw - before.yaw;
  turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
  return [before.x + (b.x - before.x) * alpha, before.y + (b.y - before.y) * alpha, before.z + (b.z - before.z) * alpha, before.yaw + turn * alpha];
}
