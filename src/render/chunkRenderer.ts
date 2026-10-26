import * as THREE from 'three';
import type { MeshData } from '../mesh/builder';
import type { ChunkMesh } from '../mesh/mesher';
import { CHUNK_SIZE } from '../world/coords';
import { createBlockMaterial, createBlockTextures } from './blockMaterial';

/** Radius of the sphere around a chunk cube; every chunk mesh fits inside it. */
const CHUNK_RADIUS = (CHUNK_SIZE * Math.sqrt(3)) / 2;

/** Owns the Three.js meshes for chunks: creates, replaces and disposes them. */
export class ChunkRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Mesh[]>();
  private readonly textures = createBlockTextures();
  /** Solid blocks, and leaves with their holes cut out (alpha test). */
  private readonly opaqueMaterial: THREE.ShaderMaterial;
  /** Water and glass, blended. */
  private readonly transparentMaterial: THREE.ShaderMaterial;

  /** Triangles currently in the scene, for the stats line. */
  triangles = 0;
  /** Bytes of vertex and index data currently in the scene, for `?stats`. */
  bytes = 0;

  /** With `lightView`, chunks show their light as grey instead of their textures (`?light`). */
  constructor(lightView = false) {
    this.opaqueMaterial = createBlockMaterial(this.textures, { alphaTest: 0.5, transparent: false, lightView });
    this.transparentMaterial = createBlockMaterial(this.textures, { alphaTest: 0.01, transparent: true, lightView });
  }

  /** Sunlight's colour and brightness for the time of day (`sky.ts`), on every chunk at once. */
  setSunlight([r, g, b]: [number, number, number]): void {
    for (const m of [this.opaqueMaterial, this.transparentMaterial]) (m.uniforms.sunlight.value as THREE.Vector3).set(r, g, b);
  }

  /** Show a chunk's mesh, replacing any it had. */
  set(key: string, cx: number, cy: number, cz: number, data: ChunkMesh): void {
    this.remove(key);
    // Frustum culling uses this; the chunk's own bounds are free, measuring the vertices isn't.
    const centre = new THREE.Vector3(cx + 0.5, cy + 0.5, cz + 0.5).multiplyScalar(CHUNK_SIZE);
    const list: THREE.Mesh[] = [];
    if (data.opaque.indices.length) list.push(this.make(data.opaque, this.opaqueMaterial, centre));
    if (data.transparent.indices.length) {
      const water = this.make(data.transparent, this.transparentMaterial, centre);
      water.renderOrder = 1;
      list.push(water);
    }
    for (const m of list) {
      this.group.add(m);
      this.triangles += (m.geometry.index?.count ?? 0) / 3;
      this.bytes += geometryBytes(m.geometry);
    }
    this.meshes.set(key, list);
  }

  remove(key: string): void {
    const list = this.meshes.get(key);
    if (!list) return;
    for (const m of list) {
      this.triangles -= (m.geometry.index?.count ?? 0) / 3;
      this.bytes -= geometryBytes(m.geometry);
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes.delete(key);
  }

  setVisible(key: string, visible: boolean): void {
    for (const m of this.meshes.get(key) ?? []) m.visible = visible;
  }

  get count(): number {
    return this.meshes.size;
  }

  has(key: string): boolean {
    return this.meshes.has(key);
  }

  keys(): IterableIterator<string> {
    return this.meshes.keys();
  }

  private make(data: MeshData, material: THREE.Material, centre: THREE.Vector3): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 4, true));
    geo.setAttribute('uvl', new THREE.BufferAttribute(data.uvl, 4));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.boundingSphere = new THREE.Sphere(centre.clone(), CHUNK_RADIUS);
    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false; // positions are already in world space
    return mesh;
  }
}

function geometryBytes(geo: THREE.BufferGeometry): number {
  let bytes = geo.index?.array.byteLength ?? 0;
  for (const a of Object.values(geo.attributes)) bytes += a.array.byteLength;
  return bytes;
}
