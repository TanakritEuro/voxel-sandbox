import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { ChunkRenderer } from '../src/render/chunkRenderer';
import { World } from '../src/world/world';

/** A rendered frame, as far as the renderer is concerned: Three.js calls this after drawing a mesh. */
const drawn = (m: THREE.Object3D) => m.onAfterRender(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never);
const meshesOf = (r: ChunkRenderer) => r.group.children as THREE.Mesh[];

describe('chunk renderer uploads', () => {
  const world = new World(20261022);
  world.ensureColumn(0, 0);
  const mesh = meshChunk(paddedBlocks(world, 0, 2, 0), 0, 2, 0);

  it('keeps count of meshes never drawn, and forgets them once drawn or removed', () => {
    const r = new ChunkRenderer();
    r.set('a', 0, 2, 0, mesh);
    r.set('b', 0, 2, 0, mesh);
    const n = meshesOf(r).length;
    expect(r.waitingUpload).toBe(n);
    drawn(meshesOf(r)[0]);
    expect(r.waitingUpload).toBe(n - 1);
    // What's left is chunk a's, one of which has been drawn.
    r.remove('b');
    expect(r.waitingUpload).toBe(meshesOf(r).length - 1);
  });

  it('sends unseen meshes a budget of bytes at a time, by drawing them once whatever the frustum', () => {
    const r = new ChunkRenderer();
    for (let i = 0; i < 6; i++) r.set(`c${i}`, 0, 2, 0, mesh);
    const all = meshesOf(r);
    expect(all.every((m) => m.frustumCulled)).toBe(true);
    // A budget of nothing sends nothing; a little sends one; it never picks hidden meshes.
    r.uploadSome(0);
    expect(all.filter((m) => !m.frustumCulled)).toHaveLength(0);
    all[0].visible = false;
    r.uploadSome(1);
    const sent = all.filter((m) => !m.frustumCulled);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toBe(all[0]);
    // Drawn: culled normally again, and no longer waiting.
    const before = r.waitingUpload;
    drawn(sent[0]);
    expect(sent[0].frustumCulled).toBe(true);
    expect(r.waitingUpload).toBe(before - 1);
    // A big budget sends every visible one left.
    r.uploadSome(1e12);
    expect(all.filter((m) => !m.frustumCulled)).toHaveLength(all.length - 2);
  });
});
