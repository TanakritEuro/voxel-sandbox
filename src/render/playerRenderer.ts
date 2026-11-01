// Other players, drawn (invented look): a blocky figure, head, body, two arms and two legs, the
// shirt in the player's colour, with their name above. Drawn like the mobs: one InstancedMesh per
// part (an instance per player), shaded by direction, lit by the world's light where they stand
// and the day's, fogged. Legs and arms swing with the ground they cover, the head tips to where
// they look, the right arm swings when they dig or place, and crouching bends the body.
//
// The name is a sprite drawn over everything (so friends can be found through walls), faint.

import * as THREE from 'three';
import { MAX_PLAYERS } from '../net/protocol';
import type { PlayerPose } from '../net/remotePlayer';
import type { World } from '../world/world';
import { shadedBox } from './mobRenderer';
import { face, fur, sideAndFront } from './mobTextures';
import { brightness } from './particles';

/** Shirt colours by player number: the host red, then blue, green, yellow. */
export const PLAYER_COLOURS = [0xd8503c, 0x3c7fd8, 0x3cb468, 0xe0b43c];

/** Radians of swing a block walked, and at most (at walking speed and up). */
const STRIDE = 2.6;
const SWING = 0.7;
/** How long an arm swing lasts (s). */
const ARM_SWING = 0.3;

type V3 = [number, number, number];
interface Part {
  size: V3;
  /** Pivot (hip, shoulder, neck) and the box's middle from it, in model space (feet at 0, facing -z). */
  pivot: V3;
  offset: V3;
  kind: 'leg' | 'arm' | 'body' | 'head';
  side: 1 | -1;
  /** Takes the player's colour. */
  shirt: boolean;
  map: THREE.Texture;
  /** Its front face (-z) has its own half of the texture (`sideAndFront`). */
  front?: boolean;
}

const m = new THREE.Matrix4();
const step = new THREE.Matrix4();
const colour = new THREE.Color();
const tint = new THREE.Color();

export class PlayerRenderer {
  readonly group = new THREE.Group();
  private readonly parts: { part: Part; mesh: THREE.InstancedMesh }[] = [];
  private readonly names = new Map<number, { sprite: THREE.Sprite; name: string }>();

  constructor() {
    const skin = 0xd6a07a;
    const trousers = fur(41, 0x34405c, 0.15);
    const shirt = fur(42, 0xeeeeee, 0.12);
    const head = sideAndFront(fur(43, skin, 0.08), face(44, skin, 0x26201c));
    const hands = fur(45, skin, 0.08);
    const list: Part[] = [
      { size: [0.25, 0.75, 0.25], pivot: [-0.125, 0.75, 0], offset: [0, -0.375, 0], kind: 'leg', side: 1, shirt: false, map: trousers },
      { size: [0.25, 0.75, 0.25], pivot: [0.125, 0.75, 0], offset: [0, -0.375, 0], kind: 'leg', side: -1, shirt: false, map: trousers },
      { size: [0.5, 0.75, 0.26], pivot: [0, 0.75, 0], offset: [0, 0.375, 0], kind: 'body', side: 1, shirt: true, map: shirt },
      { size: [0.22, 0.72, 0.22], pivot: [-0.36, 1.45, 0], offset: [0, -0.31, 0], kind: 'arm', side: -1, shirt: true, map: shirt },
      { size: [0.22, 0.72, 0.22], pivot: [0.36, 1.45, 0], offset: [0, -0.31, 0], kind: 'arm', side: 1, shirt: true, map: shirt },
      { size: [0.44, 0.44, 0.44], pivot: [0, 1.5, 0], offset: [0, 0.22, 0], kind: 'head', side: 1, shirt: false, map: head, front: true },
      // Hands: the bottom of each arm in skin.
      { size: [0.23, 0.12, 0.23], pivot: [-0.36, 1.45, 0], offset: [0, -0.62, 0], kind: 'arm', side: -1, shirt: false, map: hands },
      { size: [0.23, 0.12, 0.23], pivot: [0.36, 1.45, 0], offset: [0, -0.62, 0], kind: 'arm', side: 1, shirt: false, map: hands },
    ];
    for (const part of list) {
      const mesh = new THREE.InstancedMesh(shadedBox(...part.size, part.front), new THREE.MeshBasicMaterial({ map: part.map, vertexColors: true, fog: true }), MAX_PLAYERS);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, colour.set(0xffffff));
      this.parts.push({ part, mesh });
      this.group.add(mesh);
    }
  }

  /** Once a frame: every other player at their pose (`others`: number, name, pose). */
  update(others: readonly { id: number; name: string; pose: PlayerPose }[], world: World, daylight: number): void {
    for (const p of this.parts) p.mesh.count = 0;
    const shown = new Set<number>();
    for (const { id, name, pose } of others) {
      shown.add(id);
      const light = brightness(world.getLight(Math.floor(pose.x), Math.floor(pose.y + 1), Math.floor(pose.z)), daylight);
      const pace = Math.min(1, pose.speed / 4.3);
      const swing = pose.flying ? 0 : Math.sin(pose.walked * STRIDE) * SWING * pace;
      const arm = pose.sinceSwing < ARM_SWING ? Math.sin((pose.sinceSwing / ARM_SWING) * Math.PI) * 1.4 : 0;
      const drop = pose.crouching ? 0.25 : 0;
      const bend = pose.crouching ? 0.45 : 0;
      for (const { part, mesh } of this.parts) {
        m.makeRotationY(pose.yaw).setPosition(pose.x, pose.y - drop, pose.z);
        m.multiply(step.makeTranslation(...part.pivot));
        if (part.kind === 'leg') m.multiply(step.makeRotationX(swing * part.side));
        else if (part.kind === 'body') m.multiply(step.makeRotationX(-bend));
        else if (part.kind === 'arm') m.multiply(step.makeRotationX(-swing * part.side + (part.side > 0 ? arm : 0) + bend * 0.5));
        else m.multiply(step.makeRotationX(Math.max(-1.2, Math.min(1.2, pose.pitch))));
        m.multiply(step.makeTranslation(...part.offset));
        const n = mesh.count++;
        mesh.setMatrixAt(n, m);
        if (part.shirt) tint.setHex(PLAYER_COLOURS[id % PLAYER_COLOURS.length], THREE.SRGBColorSpace);
        else tint.setRGB(1, 1, 1);
        mesh.setColorAt(n, colour.setRGB(light, light, light, THREE.SRGBColorSpace).multiply(tint));
      }
      this.nameTag(id, name).position.set(pose.x, pose.y - drop + 2.15, pose.z);
    }
    for (const { mesh } of this.parts) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const [id, tag] of this.names) tag.sprite.visible = shown.has(id);
  }

  /** The sprite over player `id`'s head, made (or remade) when their name is new. */
  private nameTag(id: number, name: string): THREE.Sprite {
    const had = this.names.get(id);
    if (had && had.name === name) return had.sprite;
    if (had) {
      this.group.remove(had.sprite);
      had.sprite.material.map?.dispose();
      had.sprite.material.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 34px system-ui, sans-serif';
    const width = Math.min(248, ctx.measureText(name).width + 24);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.roundRect((256 - width) / 2, 8, width, 48, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 33, 232);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, opacity: 0.85, fog: false }));
    sprite.scale.set(1.6, 0.4, 1);
    sprite.renderOrder = 10;
    this.group.add(sprite);
    this.names.set(id, { sprite, name });
    return sprite;
  }
}
