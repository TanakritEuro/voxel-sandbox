import * as THREE from 'three';
import type { ChunkMesh, MeshData } from '../mesh/mesher';

/** Owns the Three.js meshes for chunks: creates, replaces and disposes them. */
export class ChunkRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Mesh[]>();
  private readonly opaqueMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly transparentMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });

  /** Triangles currently in the scene, for the stats line. */
  triangles = 0;
  /** Bytes of vertex and index data currently in the scene, for `?stats`. */
  bytes = 0;

  set(key: string, data: ChunkMesh): void {
    this.remove(key);
    const list: THREE.Mesh[] = [];
    if (data.opaque.indices.length) list.push(this.make(data.opaque, this.opaqueMaterial));
    if (data.transparent.indices.length) {
      const water = this.make(data.transparent, this.transparentMaterial);
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

  get count(): number {
    return this.meshes.size;
  }

  has(key: string): boolean {
    return this.meshes.has(key);
  }

  keys(): IterableIterator<string> {
    return this.meshes.keys();
  }

  private make(data: MeshData, material: THREE.Material): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere(); // Three.js frustum-culls each chunk with this
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
