// Block particles: when a block breaks, a burst of small cubes in its colours flies out of where
// it was; while it's being dug, a few smaller chips come off the face being hit. They fall,
// bounce off solid blocks (a point test against the world, one axis at a time, so they never
// end up inside one), slow down on the ground and shrink away over about a second.
//
// `Particles` is the simulation, pure (struct of arrays, at most MAX_PARTICLES; when full, the
// oldest slot is reused). `ParticleMesh` draws them all as one InstancedMesh: one draw call.
// Colours are lit once, when they're made, by the light where they appear (`brightness`).

import * as THREE from 'three';
import { TUNING } from '../config';

export const MAX_PARTICLES = 512;

type RGB = [number, number, number];

/** How bright the packed light (sun << 4 | block light) is as a colour factor, with `daylight` as the shader has it. */
export function brightness(light: number, daylight: number): number {
  const f = TUNING.render.lightFalloff;
  const darkest = f ** 15;
  const curve = (level: number) => (f ** (15 - level) - darkest) / (1 - darkest);
  return Math.max(curve(light >> 4) * daylight, curve(light & 15));
}

export class Particles {
  readonly position = new Float32Array(MAX_PARTICLES * 3);
  readonly velocity = new Float32Array(MAX_PARTICLES * 3);
  readonly colour = new Float32Array(MAX_PARTICLES * 3);
  readonly size = new Float32Array(MAX_PARTICLES);
  readonly age = new Float32Array(MAX_PARTICLES);
  /** Seconds each lives; 0 for an empty slot. */
  readonly life = new Float32Array(MAX_PARTICLES);
  /** Where the next one goes: slots are used in turn, so a full buffer reuses the oldest. */
  private next = 0;

  constructor(private readonly random: () => number = Math.random) {}

  /** Particles alive now. */
  get alive(): number {
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) if (this.life[i] > 0) n++;
    return n;
  }

  /** A block at (x, y, z) has broken: a burst out of its whole volume, in `colours` times `light` (a factor). */
  burst(x: number, y: number, z: number, colours: readonly RGB[], light: number): void {
    const P = TUNING.particles;
    for (let n = 0; n < P.breakCount; n++) {
      const px = x + 0.15 + this.random() * 0.7;
      const py = y + 0.15 + this.random() * 0.7;
      const pz = z + 0.15 + this.random() * 0.7;
      // Outwards from the middle, and up.
      const speed = P.speed * (0.5 + this.random());
      this.add(px, py, pz, (px - x - 0.5) * speed, P.lift * (0.5 + this.random()), (pz - z - 0.5) * speed, colours, light, P.size);
    }
  }

  /** The face of block (x, y, z) towards (nx, ny, nz) is being dug: a few chips off it. */
  chips(x: number, y: number, z: number, nx: number, ny: number, nz: number, colours: readonly RGB[], light: number): void {
    const P = TUNING.particles;
    for (let n = 0; n < P.digCount; n++) {
      // Somewhere on the face, just in front of it.
      const along = (a: number) => (a !== 0 ? 0.5 + a * 0.56 : 0.1 + this.random() * 0.8);
      const px = x + along(nx);
      const py = y + along(ny);
      const pz = z + along(nz);
      const s = P.speed * 0.5;
      this.add(px, py, pz, nx * s + (this.random() - 0.5) * s, ny * s + P.lift * 0.4 * this.random(), nz * s + (this.random() - 0.5) * s, colours, light, P.digSize);
    }
  }

  /** Move them all `dt` seconds on; `solid(x, y, z)` says whether the block at those integer coordinates stops them. */
  step(dt: number, solid: (x: number, y: number, z: number) => boolean): void {
    const P = TUNING.particles;
    const pos = this.position;
    const vel = this.velocity;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.life[i] = 0;
        continue;
      }
      vel[i * 3 + 1] -= P.gravity * dt;
      let grounded = false;
      // One axis at a time: a move into a solid block is undone and bounces back, softly.
      for (let a = 0; a < 3; a++) {
        const k = i * 3 + a;
        const from = pos[k];
        pos[k] += vel[k] * dt;
        if (solid(Math.floor(pos[i * 3]), Math.floor(pos[i * 3 + 1]), Math.floor(pos[i * 3 + 2]))) {
          pos[k] = from;
          if (a === 1 && vel[k] < 0) grounded = true;
          vel[k] *= -P.bounce;
        }
      }
      if (grounded) {
        vel[i * 3] *= P.friction;
        vel[i * 3 + 2] *= P.friction;
      }
    }
  }

  private add(x: number, y: number, z: number, vx: number, vy: number, vz: number, colours: readonly RGB[], light: number, size: number): void {
    const P = TUNING.particles;
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.position.set([x, y, z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    const c = colours[Math.floor(this.random() * colours.length)];
    const shade = light * (0.85 + this.random() * 0.3);
    this.colour.set([Math.min(1, c[0] * shade), Math.min(1, c[1] * shade), Math.min(1, c[2] * shade)], i * 3);
    this.size[i] = size * (0.75 + this.random() * 0.5);
    this.age[i] = 0;
    this.life[i] = P.life[0] + this.random() * (P.life[1] - P.life[0]);
  }
}

/** All the particles as one InstancedMesh of small cubes, shrinking over the last part of their lives. */
export class ParticleMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly colour = new THREE.Color();

  constructor(private readonly particles: Particles) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ fog: true }), MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // Colours exist from the start (setColorAt creates the attribute on first use).
    this.mesh.setColorAt(0, this.colour.set(0xffffff));
  }

  /** Once a frame, after `step`: copy the living particles into the instances. */
  update(): void {
    const p = this.particles;
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (p.life[i] <= 0) continue;
      const left = 1 - p.age[i] / p.life[i];
      const s = p.size[i] * Math.min(1, left * 3);
      this.matrix.makeScale(s, s, s).setPosition(p.position[i * 3], p.position[i * 3 + 1], p.position[i * 3 + 2]);
      this.mesh.setMatrixAt(n, this.matrix);
      this.mesh.setColorAt(n, this.colour.setRGB(p.colour[i * 3], p.colour[i * 3 + 1], p.colour[i * 3 + 2], THREE.SRGBColorSpace));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
