// The block textures on the GPU and the material that draws chunks with them: one texture
// array, a layer per block texture, sampled by a small shader (vertex shade × light ×
// texture, alpha test for leaves, Three.js fog). In the transparent pass, water moves: two
// copies of its texture drift different ways and are blended, and its brightness ripples
// slowly (`water.ts` works out the offsets); nothing is remeshed. Hotbar icons are drawn from the same pixels. `?light` draws
// the light the mesher put in the vertices instead of the textures, for checking it.

import * as THREE from 'three';
import { TUNING } from '../config';
import { makeTextures, TEXTURE_NAMES, TEXTURE_SIZE, type TextureName, textureLayer } from '../world/textures';

const vertexShader = /* glsl */ `
  attribute vec4 color;
  attribute vec4 uvl;
  varying vec3 vShade;
  varying vec2 vLight;
  varying vec2 vUv;
  flat varying float vLayer;
  #include <fog_pars_vertex>

  void main() {
    // The mesher's shade (directional × AO, in red) is meant in display terms, like the flat
    // colours it replaced: squared towards linear so it darkens textures as much as it did them.
    vShade = vec3(pow(color.r, 2.2));
    // Sunlight and block light, 0–1 for levels 0–15.
    vLight = color.gb;
    vUv = uvl.xy;
    vLayer = uvl.z;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray map;
  uniform float alphaTest;
  uniform float lightFalloff;
  uniform vec3 blockLightColour;
  /** Sunlight's colour and brightness for the time of day (sky.ts); block light doesn't change. */
  uniform vec3 sunlight;
  #ifdef WATER
    uniform float waterLayer;
    uniform vec2 flowA;
    uniform vec2 flowB;
    uniform float ripple;
  #endif
  varying vec3 vShade;
  varying vec2 vLight;
  varying vec2 vUv;
  flat varying float vLayer;
  #include <fog_pars_fragment>

  /** The texture at uv (in blocks), repeated every block; v runs up, image rows run down. */
  vec4 sampleTile(vec2 uv, vec2 dx, vec2 dy) {
    return textureGrad(map, vec3(fract(uv.x), 1.0 - fract(uv.y), vLayer), dx, dy);
  }

  void main() {
    // UVs are in blocks across a merged quad: repeat the texture every block. Mip level from
    // the unwrapped UVs, so it doesn't jump at every block seam (thin lines in the distance).
    vec2 dx = dFdx(vUv);
    vec2 dy = dFdy(vUv);
    vec4 texel;
    #ifdef WATER
    if (abs(vLayer - waterLayer) < 0.5) {
      // Two copies drifting different ways (the second 4/3 the size: 32 blocks of a chunk are a
      // whole number of its tiles, so no seam at chunk borders), and a slow ripple of light.
      texel = mix(sampleTile(vUv + flowA, dx, dy), sampleTile(vUv * 0.75 + flowB, dx * 0.75, dy * 0.75), 0.5);
      float a = 6.2832 * (vUv.x + vUv.y) / 8.0 + ripple;
      float b = 6.2832 * (vUv.x - vUv.y) / 8.0 - ripple * 0.7;
      texel.rgb *= 1.0 + 0.07 * sin(a) * sin(b);
    } else
    #endif
    texel = sampleTile(vUv, dx, dy);
    if (texel.a < alphaTest) discard;
    #ifdef LIGHT_VIEW
      // The brighter of sunlight and block light as grey, shaded so shapes still read.
      texel.rgb = vec3(pow(max(vLight.x, vLight.y), 2.2));
    #else
      // Light levels (smoothly interpolated, 0–15) to brightness: each level lightFalloff times
      // the one above, rescaled so level 0 is black. In display terms like the shade, so squared
      // towards linear the same way.
      vec2 level = vLight * 15.0;
      float darkest = pow(lightFalloff, 15.0);
      vec2 bright = (pow(vec2(lightFalloff), 15.0 - level) - darkest) / (1.0 - darkest);
      vec3 lit = max(bright.x * sunlight, bright.y * blockLightColour);
      texel.rgb *= pow(lit, vec3(2.2));
    #endif
    #ifdef OPAQUE
      // Holes are cut by the alpha test; what's left is solid, so alpha 1 (see the blending below).
      gl_FragColor = vec4(texel.rgb * vShade, 1.0);
    #else
      gl_FragColor = vec4(texel.rgb * vShade, texel.a);
    #endif
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Every block texture in one array texture, made once at startup. */
export function createBlockTextures(): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(makeTextures(), TEXTURE_SIZE, TEXTURE_SIZE, TEXTURE_NAMES.length);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  // Hard pixels up close; mipmaps so distant blocks don't shimmer.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** A chunk material: `alphaTest` cuts holes (leaves) in the opaque pass. */
export function createBlockMaterial(
  map: THREE.DataArrayTexture,
  options: { alphaTest: number; transparent: boolean; lightView?: boolean },
): THREE.ShaderMaterial {
  // Merged copies the fog uniforms; the texture is set after, since merging would clone it.
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      alphaTest: { value: options.alphaTest },
      lightFalloff: { value: TUNING.render.lightFalloff },
      blockLightColour: { value: new THREE.Vector3(...TUNING.render.blockLightColour) },
      sunlight: { value: new THREE.Vector3(1, 1, 1) },
      waterLayer: { value: textureLayer('water') },
      flowA: { value: new THREE.Vector2() },
      flowB: { value: new THREE.Vector2() },
      ripple: { value: 0 },
    },
  ]);
  uniforms.map = { value: map };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    defines: { ...(options.transparent ? { WATER: '' } : { OPAQUE: '' }), ...(options.lightView && { LIGHT_VIEW: '' }) },
    fog: true,
    transparent: options.transparent,
    depthWrite: !options.transparent,
    // Water and glass from both sides (the water's surface from below), in one pass: Three.js
    // would otherwise draw transparent double-sided meshes twice, back faces then front.
    side: options.transparent ? THREE.DoubleSide : THREE.FrontSide,
    forceSinglePass: true,
    // Three.js always gives the canvas an alpha channel, and the browser shows the page through
    // wherever it's below 1. So blend colour as usual but leave the canvas's alpha as it was (1);
    // the opaque pass writes 1 too, however mipmapping averaged a leaf's holes.
    ...(options.transparent && {
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    }),
  });
}

/** A data URL of one texture, for an `<img>` or CSS background (hotbar icons). */
export function textureIcon(name: TextureName, pixels: Uint8Array = makeTextures()): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  const area = TEXTURE_SIZE * TEXTURE_SIZE * 4;
  const layer = textureLayer(name);
  const image = new ImageData(new Uint8ClampedArray(pixels.subarray(layer * area, (layer + 1) * area)), TEXTURE_SIZE, TEXTURE_SIZE);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
