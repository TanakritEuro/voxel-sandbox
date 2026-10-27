import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { Block, BLOCKS } from '../src/world/blocks';
import { CHUNK_SIZE, CHUNK_VOLUME } from '../src/world/coords';
import { makeTextures, TEXTURE_NAMES, TEXTURE_SIZE, textureLayer } from '../src/world/textures';
import { Chunk, World } from '../src/world/world';

const AREA = TEXTURE_SIZE * TEXTURE_SIZE;
const pixels = makeTextures();
const layer = (name: (typeof TEXTURE_NAMES)[number]) => pixels.subarray(textureLayer(name) * AREA * 4, (textureLayer(name) + 1) * AREA * 4);
/** Share of a layer's pixels with alpha below 128. */
const holes = (data: Uint8Array) => {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) n++;
  return n / AREA;
};

describe('block textures', () => {
  it('are the same every time, one layer per name, all different', () => {
    expect(makeTextures()).toEqual(pixels);
    expect(pixels.length).toBe(TEXTURE_NAMES.length * AREA * 4);
    const seen = new Set<string>();
    for (const name of TEXTURE_NAMES) seen.add(layer(name).join());
    expect(seen.size).toBe(TEXTURE_NAMES.length);
  });

  it('cover every face of every block', () => {
    for (const info of BLOCKS) for (const name of Object.values(info.textures)) expect(TEXTURE_NAMES, info.name).toContain(name);
  });

  it('are fully opaque for opaque blocks, have holes for leaves, and are see-through for glass and water', () => {
    for (const info of BLOCKS) {
      if (!info.opaque) continue;
      for (const name of Object.values(info.textures)) expect(holes(layer(name)), `${info.name} ${name}`).toBe(0);
    }
    expect(holes(layer('leaves'))).toBeGreaterThan(0.2);
    expect(holes(layer('leaves'))).toBeLessThan(0.5);
    expect(holes(layer('glass'))).toBeGreaterThan(0.6); // the pane; the frame is solid
    const water = layer('water');
    for (let i = 3; i < water.length; i += 4) expect(water[i]).toBeLessThan(255);
  });
});

/** A world with one empty chunk at (0, 1, 0) and `fill` writing blocks into it (local coordinates). */
function chunkWith(fill: (set: (x: number, y: number, z: number, b: Block) => void) => void) {
  const world = new World(1);
  const chunk = new Chunk(0, 1, 0, new Uint8Array(CHUNK_VOLUME));
  world.chunks.set(chunk.key, chunk);
  fill((x, y, z, b) => world.setBlock(x, CHUNK_SIZE + y, z, b));
  return meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
}

/** Each quad as its four corners' position and uvl. */
function quads(data: { positions: Float32Array; uvl: Uint8Array }) {
  const out: { p: number[][]; uv: number[][]; layer: number }[] = [];
  for (let v = 0; v < data.positions.length / 3; v += 4) {
    const p = [0, 1, 2, 3].map((k) => [0, 1, 2].map((a) => data.positions[(v + k) * 3 + a]));
    const uv = [0, 1, 2, 3].map((k) => [data.uvl[(v + k) * 4], data.uvl[(v + k) * 4 + 1]]);
    out.push({ p, uv, layer: data.uvl[v * 4 + 2] });
  }
  return out;
}

describe('textured meshes', () => {
  it('give a merged quad texture coordinates spanning its size in blocks', () => {
    // A 5 × 3 wall of stone, one block thick, standing in x and y.
    const m = chunkWith((set) => {
      for (let x = 2; x < 7; x++) for (let y = 4; y < 7; y++) set(x, y, 10, Block.Stone);
    });
    const qs = quads(m.opaque);
    expect(qs.length).toBe(6);
    for (const q of qs) {
      const extent = (a: number) => Math.max(...q.p.map((c) => c[a])) - Math.min(...q.p.map((c) => c[a]));
      const span = (i: number) => Math.max(...q.uv.map((c) => c[i])) - Math.min(...q.uv.map((c) => c[i]));
      const flat = [0, 1, 2].find((a) => extent(a) === 0)!;
      const sizes = [0, 1, 2].filter((a) => a !== flat).map(extent).sort();
      expect([span(0), span(1)].sort()).toEqual(sizes);
      // On walls v runs up the y axis.
      if (flat !== 1) {
        for (const [k, c] of q.p.entries()) expect(q.uv[k][1]).toBe(c[1] - CHUNK_SIZE);
      }
      expect(q.layer).toBe(textureLayer('stone'));
    }
  });

  it("use each face's own texture: grass top, grass sides, dirt underneath", () => {
    const m = chunkWith((set) => set(5, 5, 5, Block.Grass));
    const byNormal = new Map<string, number>();
    for (const q of quads(m.opaque)) {
      const flat = [0, 1, 2].find((a) => q.p.every((c) => c[a] === q.p[0][a]))!;
      byNormal.set(flat === 1 ? (q.p[0][1] === CHUNK_SIZE + 6 ? 'top' : 'bottom') : 'side', q.layer);
    }
    expect(byNormal.get('top')).toBe(textureLayer('grass_top'));
    expect(byNormal.get('side')).toBe(textureLayer('grass_side'));
    expect(byNormal.get('bottom')).toBe(textureLayer('dirt'));
  });

  it('draw the faces between two leaf blocks (so a canopy is not hollow through its holes), not between two glass blocks', () => {
    const leaves = chunkWith((set) => {
      set(5, 5, 5, Block.Leaves);
      set(6, 5, 5, Block.Leaves);
    });
    // Each block's 6 faces, the shared pair included: merged, the outer faces of the pair are
    // 4 long quads and 2 ends, plus the 2 faces between them.
    const faces = quads(leaves.cutout).length;
    expect(faces).toBe(8);
    const glass = chunkWith((set) => {
      set(5, 5, 5, Block.Glass);
      set(6, 5, 5, Block.Glass);
    });
    expect(quads(glass.transparent).length).toBe(6);
  });
});
