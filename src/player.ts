// Scaffold player: a free-flying camera (no gravity, no collision) with mouse look.
// Milestone 2 adds a walking player with an AABB that collides with the blocks.

import * as THREE from 'three';
import { TUNING } from './config';

export class FlyCamera {
  yaw = 0;
  pitch = -0.25;
  private readonly keys = new Set<string>();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = TUNING.fly.mouseSensitivity;
      this.yaw -= e.movementX * s;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * s));
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Unit vector the camera looks along. */
  direction(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  /** Fly by the keys. */
  update(dt: number): void {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    this.move(dt, k('KeyW') - k('KeyS'), k('KeyD') - k('KeyA'), k('Space') - k('ShiftLeft'), this.keys.has('ControlLeft'));
  }

  /** Fly with the given inputs (each -1..1) along the current yaw. `?autofly` drives this directly. */
  move(dt: number, forward: number, strafe: number, lift: number, sprint: boolean): void {
    const speed = TUNING.fly.speed * (sprint ? TUNING.fly.sprintMultiplier : 1);

    // Move on the horizontal plane by yaw only, so looking down doesn't slow you.
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = f.multiplyScalar(forward).add(r.multiplyScalar(strafe));
    if (move.lengthSq() > 0) move.normalize();
    move.y = lift;
    this.camera.position.addScaledVector(move, speed * dt);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
