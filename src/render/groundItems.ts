// Items lying on the ground (`survival/ground.ts`), drawn small, turning slowly and bobbing. One
// InstancedMesh for each kind of item lying about, so a kind is one draw call however many there are:
// - a block as a little cube, its top, side and bottom textures side by side on one small texture
//   (so one material), the sides and bottom shaded darker by vertex colour;
// - anything else (and blocks with an icon of their own: torches, the thin logic blocks) as its
//   picture made a slab, as when held (`itemMesh`).
// Each is as bright as the light where it lies (the instance colour).

import * as THREE from 'three';
import { isBlockItem } from '../survival/items';
import { BLOCKS } from '../world/blocks';
import { TEXTURE_SIZE, type TextureName, textureLayer } from '../world/textures';
import { itemMesh } from './heldBlock';
import { itemArt } from './itemIcons';

const T = TEXTURE_SIZE;
/** A block's cube, and a picture's slab, in blocks across. */
const CUBE = 0.25;
const SLAB = 0.4;

interface Kind {
  mesh: THREE.InstancedMesh;
  capacity: number;
  /** How far its middle sits above the item's box's bottom. */
  lift: number;
}

export class GroundItemView {
  readonly group = new THREE.Group();
  private readonly kinds = new Map<number, Kind>();
  private readonly looks = new Map<number, { geometry: THREE.BufferGeometry; material: THREE.Material; lift: number }>();
  private readonly used = new Map<number, number>();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly colour = new THREE.Color();

  /** `pixels`: every texture layer, as the chunks have them (`makeTextures`). */
  constructor(private readonly pixels: Uint8Array) {}

  /**
   * Once a frame: where everything lying about is (the ground's items, or a guest's mirror of
   * them), how bright it is there, and the time (s) for the turning.
   */
  update(items: readonly { id: number; item: number; body: { x: number; y: number; z: number } }[], brightness: (x: number, y: number, z: number) => number, time: number): void {
    const used = this.used;
    used.clear();
    for (const g of items) used.set(g.item, (used.get(g.item) ?? 0) + 1);
    for (const [item, kind] of this.kinds) if (!used.has(item)) kind.mesh.count = 0;
    for (const [item, n] of used) {
      this.kindFor(item, n).mesh.count = 0;
    }
    for (const g of items) {
      const kind = this.kinds.get(g.item)!;
      const i = kind.mesh.count++;
      const b = g.body;
      const bob = Math.sin(time * 2.5 + g.id) * 0.04 + 0.05;
      this.position.set(b.x, b.y + kind.lift + bob, b.z);
      this.turn.setFromAxisAngle(this.up, time * 1.2 + g.id * 1.7);
      kind.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.turn, this.scale));
      kind.mesh.setColorAt(i, this.colour.setScalar(0.2 + 0.8 * brightness(b.x, b.y + 0.15, b.z)));
    }
    for (const item of used.keys()) {
      const mesh = this.kinds.get(item)!.mesh;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Draw calls this frame (for `?stats`). */
  get drawn(): number {
    let n = 0;
    for (const k of this.kinds.values()) if (k.mesh.count) n++;
    return n;
  }

  /** The kind's instanced mesh, with room for `need`. */
  private kindFor(item: number, need: number): Kind {
    let kind = this.kinds.get(item);
    if (kind && kind.capacity >= need) return kind;
    const look = this.lookOf(item);
    const capacity = Math.max(8, need * 2);
    if (kind) {
      this.group.remove(kind.mesh);
      kind.mesh.dispose();
    }
    const mesh = new THREE.InstancedMesh(look.geometry, look.material, capacity);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    kind = { mesh, capacity, lift: look.lift };
    this.kinds.set(item, kind);
    return kind;
  }

  private lookOf(item: number): { geometry: THREE.BufferGeometry; material: THREE.Material; lift: number } {
    let look = this.looks.get(item);
    if (look) return look;
    const info = isBlockItem(item) ? BLOCKS[item] : null;
    if (info && !info.icon) {
      look = { geometry: this.cube(), material: this.cubeMaterial(info.textures), lift: CUBE / 2 };
    } else {
      // A picture: the item's own, or a block's icon layer.
      const art = info ? this.layer(info.icon!) : itemArt(item)!;
      const { positions, colours } = itemMesh(art);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      geometry.scale(SLAB, SLAB, SLAB);
      look = { geometry, material: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), lift: SLAB / 2 };
    }
    this.looks.set(item, look);
    return look;
  }

  /** A texture layer's pixels, row 0 at the top. */
  private layer(name: TextureName): Uint8Array {
    const area = T * T * 4;
    const l = textureLayer(name);
    return this.pixels.subarray(l * area, (l + 1) * area);
  }

  /** A cube a quarter of a block across, its faces' texture coordinates in thirds: top, side, bottom. */
  private cube(): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const colours = new Float32Array(uv.count * 3);
    // BoxGeometry's faces, 4 corners each: +x, -x, +y, -y, +z, -z.
    const part = [1, 1, 0, 2, 1, 1];
    const shade = [0.8, 0.8, 1, 0.55, 0.9, 0.9];
    for (let face = 0; face < 6; face++) {
      for (let c = 0; c < 4; c++) {
        const i = face * 4 + c;
        uv.setX(i, (part[face] + uv.getX(i)) / 3);
        colours.set([shade[face], shade[face], shade[face]], i * 3);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return g;
  }

  /** Top, side and bottom side by side, flipped for the GPU (its row 0 is the bottom). */
  private cubeMaterial(textures: { top: TextureName; side: TextureName; bottom: TextureName }): THREE.Material {
    const data = new Uint8Array(T * 3 * T * 4);
    [textures.top, textures.side, textures.bottom].forEach((name, part) => {
      const src = this.layer(name);
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const from = (y * T + x) * 4;
          const to = ((T - 1 - y) * T * 3 + part * T + x) * 4;
          data.set(src.subarray(from, from + 4), to);
        }
    });
    const texture = new THREE.DataTexture(data, T * 3, T, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.5 });
  }
}
