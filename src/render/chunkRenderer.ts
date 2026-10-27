import * as THREE from 'three';
import type { MeshData } from '../mesh/builder';
import type { ChunkMesh } from '../mesh/mesher';
import { CHUNK_SIZE } from '../world/coords';
import { createBlockMaterial, createBlockTextures } from './blockMaterial';
import { BYTES_PER_QUAD, ChunkPage, type PageEntry } from './chunkPage';
import type { WaterFlow } from './water';

/**
 * Quads per page: 65 536 vertices, so 16-bit indices, and 1.3 MB of vertices. Small, so a new
 * page (uploaded whole when first drawn) never costs a frame: pages of 1 M vertices made
 * frames of 40–50 ms when they were added while flying. A chunk mesh bigger than this (rare)
 * gets a page of its own size.
 */
export const PAGE_QUADS = 1 << 14;

/**
 * Owns the chunk meshes: copies each chunk's passes into pages (`chunkPage.ts`), opaque and
 * transparent ones apart, and frees them when the chunk is remeshed or unloaded.
 */
export class ChunkRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, PageEntry[]>();
  /** The block texture array, shared with the held block. */
  readonly textures = createBlockTextures();
  /** Solid blocks, and leaves with their holes cut out (alpha test). */
  private readonly opaqueMaterial: THREE.ShaderMaterial;
  /** Water and glass, blended. */
  private readonly transparentMaterial: THREE.ShaderMaterial;
  private readonly opaquePages: ChunkPage[] = [];
  private readonly transparentPages: ChunkPage[] = [];

  /** Triangles currently in the scene, for the stats line. */
  triangles = 0;
  /** Bytes of vertex data in use, for `?stats`. */
  bytes = 0;

  /** With `lightView`, chunks show their light as grey instead of their textures (`?light`). */
  constructor(
    lightView = false,
    /** Smaller in tests. */
    private readonly pageQuads = PAGE_QUADS,
  ) {
    this.opaqueMaterial = createBlockMaterial(this.textures, { alphaTest: 0.5, transparent: false, lightView });
    this.transparentMaterial = createBlockMaterial(this.textures, { alphaTest: 0.01, transparent: true, lightView });
  }

  /** Sunlight's colour and brightness for the time of day (`sky.ts`), on every chunk at once. */
  setSunlight([r, g, b]: [number, number, number]): void {
    for (const m of [this.opaqueMaterial, this.transparentMaterial]) (m.uniforms.sunlight.value as THREE.Vector3).set(r, g, b);
  }

  /** Where the water's texture has drifted to (`water.ts`). */
  setWaterFlow(flow: WaterFlow): void {
    const u = this.transparentMaterial.uniforms;
    (u.flowA.value as THREE.Vector2).set(...flow.a);
    (u.flowB.value as THREE.Vector2).set(...flow.b);
    u.ripple.value = flow.ripple;
  }

  /** Show a chunk's mesh, replacing any it had. */
  set(key: string, cx: number, cy: number, cz: number, data: ChunkMesh): void {
    this.remove(key);
    const centre = new THREE.Vector3(cx + 0.5, cy + 0.5, cz + 0.5).multiplyScalar(CHUNK_SIZE);
    const list: PageEntry[] = [];
    if (data.opaque.indices.length) list.push(this.place(data.opaque, this.opaquePages, this.opaqueMaterial, false, centre));
    if (data.transparent.indices.length) list.push(this.place(data.transparent, this.transparentPages, this.transparentMaterial, true, centre));
    for (const e of list) {
      this.triangles += e.quads * 2;
      this.bytes += e.quads * BYTES_PER_QUAD;
    }
    this.meshes.set(key, list);
  }

  remove(key: string): void {
    const list = this.meshes.get(key);
    if (!list) return;
    for (const e of list) {
      this.triangles -= e.quads * 2;
      this.bytes -= e.quads * BYTES_PER_QUAD;
      e.page.removeMesh(e);
    }
    this.meshes.delete(key);
  }

  setVisible(key: string, visible: boolean): void {
    for (const e of this.meshes.get(key) ?? []) e.visible = visible;
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

  /** Pages, and the share of their space in use (for `?stats`). */
  get pages(): { count: number; full: number } {
    const all = [...this.opaquePages, ...this.transparentPages];
    const used = all.reduce((s, p) => s + p.space.used, 0);
    const capacity = all.reduce((s, p) => s + p.quads, 0);
    return { count: all.length, full: capacity ? used / capacity : 0 };
  }

  /** Into the first page with room, or a new one. */
  private place(data: MeshData, pages: ChunkPage[], material: THREE.Material, backToFront: boolean, centre: THREE.Vector3): PageEntry {
    for (const page of pages) {
      const e = page.addMesh(data, centre);
      if (e) return e;
    }
    const page = new ChunkPage(Math.max(this.pageQuads, data.positions.length / 12), material, backToFront);
    if (backToFront) page.renderOrder = 1;
    pages.push(page);
    this.group.add(page);
    const e = page.addMesh(data, centre);
    return e!; // an empty page of at least this size always has room
  }
}

/** A mesher pass as geometry for the chunk material (positions, colours, uvl, indices). */
export function chunkGeometry(data: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 4, true));
  geo.setAttribute('uvl', new THREE.BufferAttribute(data.uvl, 4));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geo;
}
