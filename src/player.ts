// The player: walks or flies through the world with the physics in `world/physics.ts`, at a
// fixed step, and puts the camera at the eye, drawn between the last two steps so it moves
// smoothly at any refresh rate.

import * as THREE from 'three';
import { TUNING } from './config';
import type { Controls } from './input';
import { FixedStep } from './math';
import { BLOCKS } from './world/blocks';
import { type BlockSource, type Body, createBody, type MoveInput, stepPlayer } from './world/physics';

/** Two presses of Space closer together than this (seconds) start or stop flying. */
const DOUBLE_TAP = 0.3;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class Player {
  readonly body: Body;
  flying = false;
  /**
   * Sprinting, or flying fast: a tap of Ctrl starts it (holding Ctrl and pressing W would close
   * the tab: browsers keep Ctrl+W), another tap or no longer moving forward ends it.
   */
  sprinting = false;
  /** Holding still because the blocks around aren't loaded yet (so nobody falls through an unloaded world). */
  waiting = true;
  /** The camera is inside a liquid block: draw the underwater view. */
  eyeInWater = false;
  /** Time spent on physics steps in the last update (ms), and how many steps, for `?stats`. */
  physicsMs = 0;
  physicsSteps = 0;
  /** Eye above the feet now: eases between standing and crouching heights. */
  private eye = TUNING.player.eyeHeight;
  /** Where the body was before the last step; the camera is drawn between this and the body. */
  private readonly previous = { x: 0, y: 0, z: 0 };
  private readonly clock = new FixedStep(TUNING.player.step);
  private time = 0;
  private lastSpace = -Infinity;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly input: Controls,
    private readonly world: BlockSource,
    /** Are the blocks around this column loaded? */
    private readonly loaded: (x: number, z: number) => boolean,
    feet: { x: number; y: number; z: number },
  ) {
    this.body = createBody(feet.x, feet.y, feet.z);
    this.keepPosition();
    this.placeCamera(1);
  }

  /** Once per frame: read the input, run the physics steps due, place the camera. */
  update(dt: number): void {
    const input = this.input;
    this.time += dt;
    if (input.take('KeyF')) this.flying = !this.flying;
    const space = input.take('Space');
    if (space) {
      if (this.time - this.lastSpace < DOUBLE_TAP) {
        this.flying = !this.flying;
        this.lastSpace = -Infinity;
      } else this.lastSpace = this.time;
    }
    const ctrlLeft = input.take('ControlLeft');
    const ctrlRight = input.take('ControlRight');
    if (ctrlLeft || ctrlRight) this.sprinting = !this.sprinting;
    if (input.axis('KeyW') - input.axis('KeyS') <= 0 || this.crouching()) this.sprinting = false;
    const eye = this.crouching() ? TUNING.player.crouchEyeHeight : TUNING.player.eyeHeight;
    this.eye += (eye - this.eye) * (1 - Math.exp(-TUNING.player.eyeEase * dt));

    const steps = this.clock.advance(dt);
    this.waiting = !this.loaded(this.body.x, this.body.z);
    if (this.waiting) {
      this.physicsMs = this.physicsSteps = 0;
      this.keepPosition();
      this.placeCamera(1);
      return;
    }
    const start = performance.now();
    const move = this.moveInput();
    // A tap of Space between two steps still jumps, once.
    move.jump ||= space;
    for (let i = 0; i < steps; i++) {
      this.keepPosition();
      move.flying = this.flying;
      move.crouch = this.crouching();
      stepPlayer(this.body, move, this.world);
      move.jump = input.isHeld('Space');
      // Coming down onto the ground ends a flight, as it would anywhere.
      if (this.flying && this.body.onGround) this.flying = false;
    }
    this.physicsMs = performance.now() - start;
    this.physicsSteps = steps;
    this.placeCamera(this.clock.alpha);
  }

  /** Fly straight along the facing at full flying speed, through anything. For `?autofly`. */
  autopilot(dt: number, forward: number): void {
    this.waiting = false; // flies through anything, loaded or not
    const speed = TUNING.fly.speed * TUNING.fly.sprintMultiplier * forward;
    this.body.x -= Math.sin(this.input.yaw) * speed * dt;
    this.body.z -= Math.cos(this.input.yaw) * speed * dt;
    this.keepPosition();
    this.placeCamera(1);
  }

  /** Unit vector the camera looks along. */
  direction(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.input.pitch, this.input.yaw, 0, 'YXZ'));
  }

  /** Shift while walking crouches; while flying it goes down. */
  private crouching(): boolean {
    return !this.flying && (this.input.isHeld('ShiftLeft') || this.input.isHeld('ShiftRight'));
  }

  private moveInput(): MoveInput {
    const i = this.input;
    return {
      forward: i.axis('KeyW') - i.axis('KeyS'),
      strafe: i.axis('KeyD') - i.axis('KeyA'),
      yaw: i.yaw,
      jump: i.isHeld('Space'),
      sprint: this.sprinting,
      crouch: this.crouching(),
      flying: this.flying,
      up: i.axis('Space') - Math.max(i.axis('ShiftLeft'), i.axis('ShiftRight')),
    };
  }

  private keepPosition(): void {
    this.previous.x = this.body.x;
    this.previous.y = this.body.y;
    this.previous.z = this.body.z;
  }

  /** Camera at the eye, `t` of the way from the previous step's position to the current one. */
  private placeCamera(t: number): void {
    const p = this.previous;
    const b = this.body;
    const c = this.camera.position.set(lerp(p.x, b.x, t), lerp(p.y, b.y, t) + this.eye, lerp(p.z, b.z, t));
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0, 'YXZ');
    this.eyeInWater = BLOCKS[this.world.getBlock(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z))].liquid;
  }
}
