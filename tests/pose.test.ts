import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createMob } from '../src/mobs/brain';
import { KINDS, MobKind } from '../src/mobs/kinds';
import type { MobManager } from '../src/mobs/mobs';
import { MODELS } from '../src/mobs/models';
import { poseOf } from '../src/mobs/pose';
import { MobRenderer } from '../src/render/mobRenderer';
import { mobTextures, sideAndFront } from '../src/render/mobTextures';
import { World } from '../src/world/world';

const kinds = [MobKind.Mossback, MobKind.Hopper, MobKind.CragGoat, MobKind.DuneBeetle];

describe('mob poses', () => {
  it('keep the legs still when standing, and swing them with the ground covered, harder when faster', () => {
    const mob = createMob(1, MobKind.Mossback, 0, 0, 0, 1);
    mob.state = 'wander';
    for (const walked of [0, 0.3, 1.7]) {
      mob.walked = walked;
      expect(poseOf(mob, 0).swing).toBeCloseTo(0, 12);
    }
    mob.body.vx = KINDS[MobKind.Mossback].walkSpeed;
    const swings = [0.2, 0.7, 1.2].map((w) => {
      mob.walked = w;
      return poseOf(mob, 0).swing;
    });
    expect(Math.max(...swings)).toBeGreaterThan(0.2);
    expect(Math.min(...swings)).toBeLessThan(-0.2); // forward and back
    mob.walked = 0.2;
    const full = poseOf(mob, 0).swing;
    mob.body.vx /= 2;
    expect(Math.abs(poseOf(mob, 0).swing)).toBeCloseTo(Math.abs(full) / 2);
  });

  it('lie down at rest: sunk, legs folded, still', () => {
    const mob = createMob(1, MobKind.CragGoat, 0, 0, 0, 1);
    mob.state = 'rest';
    mob.body.vx = 2;
    const p = poseOf(mob, 0);
    expect(p.drop).toBeCloseTo(KINDS[MobKind.CragGoat].height * 0.3);
    expect(p.fold).toBe(1);
    expect(p.swing).toBe(0);
  });

  it('graze now and then when idle: the head goes down and comes back up', () => {
    const mob = createMob(1, MobKind.Mossback, 0, 0, 0, 1);
    mob.state = 'idle';
    const heads = Array.from({ length: 80 }, (_, i) => poseOf(mob, i * 0.05).head);
    expect(Math.max(...heads)).toBeGreaterThan(0.6);
    expect(Math.min(...heads)).toBe(0);
  });

  it('lean a hopper nose up rising and nose down falling, and lay its ears back', () => {
    const mob = createMob(1, MobKind.Hopper, 0, 0, 0, 1);
    mob.body.onGround = false;
    mob.body.vy = 4;
    expect(poseOf(mob, 0).lean).toBeGreaterThan(0.2);
    expect(poseOf(mob, 0).ears).toBeGreaterThan(0.4);
    mob.body.vy = -4;
    expect(poseOf(mob, 0).lean).toBeLessThan(-0.2);
    mob.body.onGround = true;
    mob.body.vy = 0;
    expect(poseOf(mob, 0).lean).toBe(0);
  });
});

describe('mob models', () => {
  it('stand on their feet: every leg reaches the ground when straight', () => {
    for (const kind of kinds) {
      for (const part of MODELS[kind].parts) {
        if (part.anim !== 'leg' && part.anim !== 'legYaw') continue;
        for (const copy of part.at) {
          const bottom = copy.pivot[1] + (copy.offset ?? part.offset)[1] - part.size[1] / 2;
          expect(bottom, `${KINDS[kind].name}`).toBeGreaterThanOrEqual(-0.001);
          expect(bottom, `${KINDS[kind].name}`).toBeLessThan(0.05);
        }
      }
    }
  });

  it('fit their bodies, give or take a leg or an ear', () => {
    for (const kind of kinds) {
      const k = KINDS[kind];
      for (const part of MODELS[kind].parts) {
        for (const copy of part.at) {
          const [cx, cy] = [copy.pivot[0] + (copy.offset ?? part.offset)[0], copy.pivot[1] + (copy.offset ?? part.offset)[1]];
          expect(Math.abs(cx) + part.size[0] / 2, k.name).toBeLessThanOrEqual(k.halfWidth + 0.25);
          expect(cy + part.size[1] / 2, k.name).toBeLessThanOrEqual(k.height + 0.3);
        }
      }
    }
  });

  it('use only textures there are', () => {
    const textures = mobTextures();
    for (const kind of kinds) for (const part of MODELS[kind].parts) for (const t of [part.texture, part.front]) if (t) expect(textures[t]).toBeInstanceOf(THREE.DataTexture);
  });

  it('put a face beside its sides in one texture, so a head is one material', () => {
    const t = mobTextures();
    const pair = sideAndFront(t.mossFur, t.mossFace);
    const [w, h] = [pair.image.width, pair.image.height];
    expect([w, h]).toEqual([32, 16]);
    const px = (data: Uint8ClampedArray | Uint8Array, width: number, x: number, y: number) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
    const [data, side, face] = [pair.image.data as Uint8Array, t.mossFur.image.data as Uint8Array, t.mossFace.image.data as Uint8Array];
    for (const [x, y] of [[0, 0], [15, 7], [3, 15]]) {
      expect(px(data, 32, x, y)).toEqual(px(side, 16, x, y));
      expect(px(data, 32, x + 16, y)).toEqual(px(face, 16, x, y));
    }
    for (const mesh of new MobRenderer(1).group.children as THREE.InstancedMesh[]) expect(Array.isArray(mesh.material)).toBe(false);
  });

  it('are drawn with an instance per part copy per mob', () => {
    const world = new World(20261022);
    world.ensureColumn(0, 0);
    const mobs = [createMob(1, MobKind.Mossback, 5.5, 70, 5.5, 1), createMob(2, MobKind.Mossback, 8.5, 70, 5.5, 2), createMob(3, MobKind.DuneBeetle, 3.5, 70, 3.5, 3)];
    const manager = { mobs, before: new Map(), alpha: 1 } as unknown as MobManager;
    const view = new MobRenderer(4);
    view.update(manager, world, 1, 0);
    const meshes = view.group.children as THREE.InstancedMesh[];
    const total = meshes.reduce((s, mesh) => s + mesh.count, 0);
    const copies = (kind: MobKind) => MODELS[kind].parts.reduce((s, p) => s + p.at.length, 0);
    expect(total).toBe(2 * copies(MobKind.Mossback) + copies(MobKind.DuneBeetle));
    // Mossbacks and the beetle drawn; hoppers and goats not.
    expect(view.drawCalls).toBe(MODELS[MobKind.Mossback].parts.length + MODELS[MobKind.DuneBeetle].parts.length);
  });
});
