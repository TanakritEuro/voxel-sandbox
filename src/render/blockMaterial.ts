// The block textures on the GPU and the material that draws chunks with them: one texture
// array, a layer per block texture, sampled by a small shader (vertex shade × light ×
// texture, alpha test for leaves, Three.js fog). In the transparent pass, water moves: two
// copies of its texture drift different ways and are blended, and its brightness ripples
// slowly (`water.ts` works out the offsets); nothing is remeshed. `?light` draws
// the light the mesher put in the vertices instead of the textures, for checking it.
//
// Weather on the ground is drawn here, not placed (`WEATHER`: the solid and cutout passes of
// chunks): a level top at or above its place's cover (`world/cover.ts`, `coverMap.ts`) is open
// to the sky and, where rain falls, darkened by how wet it is. Near, up to half a block under
// the cover counts (a stair's lower step); far chunks' coarser tops, up to a cell of theirs.

import * as THREE from 'three';
import { TUNING } from '../config';
import { type CoverMap, COVER_SIZE } from './coverMap';
import { makeTextures, TEXTURE_NAMES, TEXTURE_SIZE, textureLayer } from '../world/textures';

const vertexShader = /* glsl */ `
  attribute vec4 color;
  attribute vec4 uvl;
  varying float vShade;
  varying vec2 vLight;
  varying vec2 vUv;
  flat varying float vLayer;
  #ifdef WEATHER
    // As few interpolated numbers as will do: in the mountains the vertices are the cost. A top
    // is level, so only its x and z change across it.
    varying vec2 vPlace;
    /** The top's cell (0 not a top; else blocks across a cell of the mesh's detail), and its height. */
    flat varying vec2 vTop;
  #endif
  #include <fog_pars_vertex>

  void main() {
    // The mesher's shade (directional × AO, in red) is meant in display terms, like the flat
    // colours it replaced: squared towards linear so it darkens textures as much as it did them.
    vShade = pow(color.r, 2.2);
    // Sunlight and block light, 0–1 for levels 0–15.
    vLight = color.gb;
    // v in whole blocks, and eighths of one (water's sides end at its depth).
    // The fourth byte: eighths added to v in its low 3 bits, eighths added to u above them.
    vUv = vec2(uvl.x + floor(uvl.w / 8.0) * 0.125, uvl.y + mod(uvl.w, 8.0) * 0.125);
    vLayer = uvl.z;
    #ifdef WEATHER
      // Chunk meshes are in world space.
      vPlace = position.xz;
      float mark = floor(color.a * 255.0 + 0.5);
      vTop = vec2(mark < 255.0 ? mark : 0.0, position.y);
    #endif
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
  #ifdef LAVA
    uniform float lavaLayer;
    uniform vec2 lavaFlow;
  #endif
  varying float vShade;
  varying vec2 vLight;
  varying vec2 vUv;
  flat varying float vLayer;
  #ifdef WEATHER
    uniform highp sampler2D cover;
    uniform ivec2 coverOrigin;
    uniform float wetness;
    uniform float wetShade;
    varying vec2 vPlace;
    flat varying vec2 vTop;

    /** What falls on this fragment (a Fall: 0 nothing), 0 where it's under cover. */
    float fallsHere() {
      ivec2 cell = ivec2(floor(vPlace));
      ivec2 inside = cell - coverOrigin;
      if (inside.x < 0 || inside.y < 0 || inside.x >= COVER_SIZE || inside.y >= COVER_SIZE) return 0.0;
      vec2 stored = floor(texelFetch(cover, cell & (COVER_SIZE - 1), 0).rg * 255.0 + 0.5);
      float height = (stored.x + mod(stored.y, 4.0) * 256.0) * 0.5;
      float under = vTop.x > 1.5 ? vTop.x : 0.5;
      return vTop.y >= height - under - 0.01 ? floor(stored.y / 4.0) : 0.0;
    }
  #endif
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
    #ifdef LAVA
    if (abs(vLayer - lavaLayer) < 0.5) {
      // Lava, in the opaque pass: two copies creeping slowly across each other.
      texel = mix(sampleTile(vUv + lavaFlow, dx, dy), sampleTile(vUv * 0.75 - lavaFlow.yx, dx * 0.75, dy * 0.75), 0.5);
    } else
    #endif
    texel = sampleTile(vUv, dx, dy);
    // Only where asked: a shader that can discard loses early depth rejection on many GPUs, for
    // everything it draws (solid terrain took twice the GPU time on a laptop with leaves' discard).
    #ifdef ALPHA_TEST
    if (texel.a < alphaTest) discard;
    #endif
    #ifdef WEATHER
    // Dry, the first test is all it costs.
    if (wetness > 0.0 && vTop.x > 0.0
      #ifdef LAVA
        && abs(vLayer - lavaLayer) >= 0.5
      #endif
    ) {
      if (fallsHere() == 1.0) texel.rgb *= mix(1.0, wetShade, wetness);
    }
    #endif
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

/**
 * A chunk material: `alphaTest` above 0 cuts holes (leaves); 0 for solid blocks, which never
 * discard. With `cover`, weather is drawn on its tops.
 */
export function createBlockMaterial(
  map: THREE.DataArrayTexture,
  options: { alphaTest: number; transparent: boolean; lightView?: boolean; cover?: CoverMap },
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
      lavaLayer: { value: textureLayer('lava') },
      lavaFlow: { value: new THREE.Vector2() },
    },
  ]);
  uniforms.map = { value: map };
  const { cover } = options;
  const weathered = cover !== undefined && !options.transparent && !options.lightView;
  if (weathered) {
    uniforms.cover = { value: cover.texture };
    uniforms.coverOrigin = { value: cover.origin };
    uniforms.wetness = { value: 0 };
    uniforms.wetShade = { value: TUNING.weather.wetShade };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    defines: {
      ...(options.transparent ? { WATER: '' } : { OPAQUE: '' }),
      ...(options.alphaTest > 0 && { ALPHA_TEST: '' }),
      // Lava only in the solid pass.
      ...(!options.transparent && options.alphaTest === 0 && { LAVA: '' }),
      ...(options.lightView && { LIGHT_VIEW: '' }),
      ...(weathered && { WEATHER: '', COVER_SIZE }),
    },
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
