// Block icons for the hotbar and the picker: a small isometric cube drawn from the block's own
// textures (top, and its side twice, the left a little darker and the right darker still, as
// the chunks are shaded), so grass looks like grass and not dirt. Blocks with an icon of their
// own (the torch) use it flat. Drawn on canvases once at startup, as data URLs.

import { Block, BLOCKS } from '../world/blocks';
import { makeTextures, TEXTURE_SIZE, type TextureName, textureLayer } from '../world/textures';

/** Icon size in pixels (drawn crisp; CSS scales it). */
const SIZE = 48;
const T = TEXTURE_SIZE;

/** A texture layer as a canvas, to draw from. */
function layerCanvas(name: TextureName, pixels: Uint8Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = T;
  const area = T * T * 4;
  const layer = textureLayer(name);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.subarray(layer * area, (layer + 1) * area)), T, T), 0, 0);
  return canvas;
}

/**
 * Faces of the cube as affine maps of the texture square (a, b, c, d, e, f as `setTransform`
 * takes them), with how dark each is. The top's corners are at (4, 14), (24, 4), (44, 14) and
 * (24, 24); the sides hang 20 pixels below its front edges.
 */
const FACES: { map: [number, number, number, number, number, number]; shade: number; face: 'top' | 'side' }[] = [
  { map: [20 / T, -10 / T, 20 / T, 10 / T, 4, 14], shade: 0, face: 'top' },
  { map: [20 / T, 10 / T, 0, 20 / T, 4, 14], shade: 0.2, face: 'side' },
  { map: [20 / T, -10 / T, 0, 20 / T, 24, 24], shade: 0.35, face: 'side' },
];

/** Every block's icon as a data URL, by block id (air's is empty). */
export function blockIcons(pixels: Uint8Array = makeTextures()): string[] {
  const layers = new Map<TextureName, HTMLCanvasElement>();
  const layer = (name: TextureName) => {
    let c = layers.get(name);
    if (!c) layers.set(name, (c = layerCanvas(name, pixels)));
    return c;
  };
  return BLOCKS.map((info, b) => {
    if (b === Block.Air) return '';
    if (info.icon) return layer(info.icon).toDataURL();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (const { map, shade, face } of FACES) {
      ctx.setTransform(...map);
      ctx.drawImage(layer(face === 'top' ? info.textures.top : info.textures.side), 0, 0);
      if (shade) {
        // Darken only where the texture is (leaves and glass keep their holes).
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
        ctx.fillRect(0, 0, T, T);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    return canvas.toDataURL();
  });
}
