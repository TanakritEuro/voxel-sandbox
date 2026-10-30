// What the mobs look like: each kind a few boxes, posed about pivots (legs at the hip, the head
// at the neck). Pure data, so tests can check the models stand on their feet and fit their
// bodies; `render/mobRenderer.ts` draws them. Model space: the feet at y = 0, forward is -z.

import { MobKind } from './kinds';

/** The mob textures (`render/mobTextures.ts` paints them). */
export type MobTexture =
  | 'mossFur'
  | 'moss'
  | 'mossFace'
  | 'hopperFur'
  | 'hopperFace'
  | 'hopperEar'
  | 'goatWool'
  | 'goatFace'
  | 'horn'
  | 'hoof'
  | 'shell'
  | 'beetleFace'
  | 'black';

/**
 * How a part moves: not at all; a leg swinging forward and back (and folding at rest); a
 * beetle's leg swinging sideways; the head; an ear laid back; the body leaning (hoppers).
 */
export type Anim = 'none' | 'leg' | 'legYaw' | 'head' | 'ear' | 'body';

type V3 = [number, number, number];

export interface ModelPart {
  size: V3;
  /** One copy per entry (four legs): its pivot, the side its swing goes (1 or -1), and its own offset if it has one. */
  at: { pivot: V3; phase?: number; offset?: V3 }[];
  /** The box's middle from its pivot (unless the copy has its own). */
  offset: V3;
  anim: Anim;
  /** Moves with the head (ears, horns, beard, antennae). */
  onHead?: boolean;
  /** A fixed tilt about x, top back positive (horns swept back). */
  tilt?: number;
  texture: MobTexture;
  /** The front face (-z), if it differs (a face with eyes). */
  front?: MobTexture;
}

export interface Model {
  /** Where the neck is: the head, and what moves with it, pitch about here. */
  headPivot: V3;
  parts: ModelPart[];
}

/** Four legs: front pair at z, back pair at back, x either side; front-left and back-right swing together. */
const fourLegs = (x: number, y: number, front: number, back: number): ModelPart['at'] => [
  { pivot: [-x, y, front], phase: 1 },
  { pivot: [x, y, front], phase: -1 },
  { pivot: [-x, y, back], phase: -1 },
  { pivot: [x, y, back], phase: 1 },
];

export const MODELS: Record<MobKind, Model> = {
  [MobKind.Mossback]: {
    headPivot: [0, 0.72, -0.48],
    parts: [
      { size: [0.8, 0.55, 1.1], at: [{ pivot: [0, 0.62, 0.05] }], offset: [0, 0, 0], anim: 'none', texture: 'mossFur' },
      { size: [0.84, 0.12, 0.86], at: [{ pivot: [0, 0.94, 0.1] }], offset: [0, 0, 0], anim: 'none', texture: 'moss' },
      { size: [0.46, 0.42, 0.42], at: [{ pivot: [0, 0.72, -0.48] }], offset: [0, 0.04, -0.2], anim: 'head', texture: 'mossFur', front: 'mossFace' },
      { size: [0.18, 0.4, 0.18], at: fourLegs(0.24, 0.4, -0.33, 0.42), offset: [0, -0.2, 0], anim: 'leg', texture: 'mossFur' },
    ],
  },
  [MobKind.Hopper]: {
    headPivot: [0, 0.32, -0.2],
    parts: [
      { size: [0.4, 0.32, 0.5], at: [{ pivot: [0, 0.22, 0.05] }], offset: [0, 0, 0], anim: 'body', texture: 'hopperFur' },
      { size: [0.3, 0.28, 0.3], at: [{ pivot: [0, 0.32, -0.2] }], offset: [0, 0.04, -0.1], anim: 'head', texture: 'hopperFur', front: 'hopperFace' },
      {
        size: [0.07, 0.26, 0.04],
        at: [{ pivot: [-0.08, 0.46, -0.28] }, { pivot: [0.08, 0.46, -0.28] }],
        offset: [0, 0.13, 0],
        anim: 'ear',
        onHead: true,
        texture: 'hopperEar',
      },
      // Big hind feet that push together, small front paws.
      {
        size: [0.12, 0.1, 0.26],
        at: [{ pivot: [-0.15, 0.06, 0.12], phase: 1 }, { pivot: [0.15, 0.06, 0.12], phase: 1 }],
        offset: [0, -0.01, 0.03],
        anim: 'leg',
        texture: 'hopperFur',
      },
      {
        size: [0.08, 0.12, 0.08],
        at: [{ pivot: [-0.09, 0.12, -0.12], phase: -1 }, { pivot: [0.09, 0.12, -0.12], phase: -1 }],
        offset: [0, -0.06, 0],
        anim: 'leg',
        texture: 'hopperFur',
      },
      { size: [0.12, 0.12, 0.1], at: [{ pivot: [0, 0.28, 0.32] }], offset: [0, 0, 0], anim: 'none', texture: 'hopperEar' },
    ],
  },
  [MobKind.CragGoat]: {
    headPivot: [0, 0.95, -0.38],
    parts: [
      { size: [0.5, 0.45, 0.85], at: [{ pivot: [0, 0.78, 0.05] }], offset: [0, 0, 0], anim: 'none', texture: 'goatWool' },
      { size: [0.3, 0.34, 0.38], at: [{ pivot: [0, 0.95, -0.38] }], offset: [0, 0.05, -0.15], anim: 'head', texture: 'goatWool', front: 'goatFace' },
      {
        size: [0.07, 0.26, 0.07],
        at: [{ pivot: [-0.1, 1.14, -0.46] }, { pivot: [0.1, 1.14, -0.46] }],
        offset: [0, 0.13, 0],
        anim: 'none',
        onHead: true,
        tilt: 0.6,
        texture: 'horn',
      },
      { size: [0.1, 0.14, 0.06], at: [{ pivot: [0, 0.8, -0.62] }], offset: [0, 0, 0], anim: 'none', onHead: true, texture: 'goatWool' },
      { size: [0.12, 0.56, 0.12], at: fourLegs(0.16, 0.56, -0.28, 0.36), offset: [0, -0.28, 0], anim: 'leg', texture: 'hoof' },
    ],
  },
  [MobKind.DuneBeetle]: {
    headPivot: [0, 0.2, -0.38],
    parts: [
      { size: [0.74, 0.26, 0.9], at: [{ pivot: [0, 0.24, 0.08] }], offset: [0, 0, 0], anim: 'none', texture: 'shell' },
      { size: [0.36, 0.18, 0.24], at: [{ pivot: [0, 0.2, -0.38] }], offset: [0, 0, -0.12], anim: 'head', texture: 'black', front: 'beetleFace' },
      // Six legs reaching out sideways, in two tripods.
      {
        size: [0.3, 0.06, 0.06],
        at: [-0.22, 0.06, 0.34].flatMap((z, i) => [
          { pivot: [-0.33, 0.1, z] as V3, phase: i % 2 ? -1 : 1, offset: [-0.15, -0.04, 0] as V3 },
          { pivot: [0.33, 0.1, z] as V3, phase: i % 2 ? 1 : -1, offset: [0.15, -0.04, 0] as V3 },
        ]),
        offset: [0, 0, 0],
        anim: 'legYaw',
        texture: 'black',
      },
      {
        size: [0.03, 0.03, 0.24],
        at: [{ pivot: [-0.08, 0.24, -0.48] }, { pivot: [0.08, 0.24, -0.48] }],
        offset: [0, 0.02, -0.12],
        anim: 'none',
        onHead: true,
        tilt: -0.3,
        texture: 'black',
      },
    ],
  },
};
