import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import type { Controls } from '../src/input';
import { Player } from '../src/player';
import { Block } from '../src/world/blocks';
import { createBody, overlapsBlock } from '../src/world/physics';

const FLOOR = 41;
const flat = { getBlock: (_x: number, y: number) => (y < FLOOR ? Block.Stone : Block.Air) };

class FakeInput implements Controls {
  yaw = 0;
  pitch = 0;
  readonly held = new Set<string>();
  readonly pressed = new Set<string>();
  isHeld(code: string): boolean {
    return this.held.has(code);
  }
  axis(code: string): number {
    return this.held.has(code) ? 1 : 0;
  }
  take(code: string): boolean {
    return this.pressed.delete(code);
  }
  /** A press and release between two frames. */
  tap(code: string): void {
    this.pressed.add(code);
  }
}

function setup(loaded = () => true) {
  const input = new FakeInput();
  const camera = new THREE.PerspectiveCamera();
  const player = new Player(camera, input, flat, loaded, { x: 0.5, y: FLOOR, z: 0.5 });
  const frames = (seconds: number, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i++) player.update(1 / fps);
  };
  return { input, camera, player, frames };
}

describe('player', () => {
  it('holds still until the blocks around are loaded', () => {
    let ready = false;
    const { player, frames } = setup(() => ready);
    player.body.y = 60;
    frames(1);
    expect(player.waiting).toBe(true);
    expect(player.body.y).toBe(60);
    ready = true;
    frames(3);
    expect(player.waiting).toBe(false);
    expect(player.body.y).toBe(FLOOR);
  });

  it('jumps on a tap shorter than a physics step', () => {
    const { input, player, frames } = setup();
    frames(0.2);
    input.tap('Space');
    frames(1 / 60);
    expect(player.body.y).toBeGreaterThan(FLOOR);
    expect(player.flying).toBe(false);
  });

  it('starts flying on two quick taps of Space, not two slow ones', () => {
    const slow = setup();
    slow.frames(0.2);
    slow.input.tap('Space');
    slow.frames(0.5);
    slow.input.tap('Space');
    slow.frames(0.1);
    expect(slow.player.flying).toBe(false);

    const quick = setup();
    quick.frames(0.2);
    quick.input.tap('Space');
    quick.frames(0.15);
    quick.input.tap('Space');
    quick.frames(0.1);
    expect(quick.player.flying).toBe(true);
  });

  it('toggles flying on F, flies up on Space, and lands on Shift', () => {
    const { input, player, frames } = setup();
    frames(0.2);
    input.tap('KeyF');
    input.held.add('Space');
    frames(1);
    expect(player.flying).toBe(true);
    expect(player.body.y).toBeCloseTo(FLOOR + TUNING.fly.speed, 6);
    input.held.delete('Space');
    frames(1);
    expect(player.body.y).toBeCloseTo(FLOOR + TUNING.fly.speed, 6); // no gravity
    input.held.add('ShiftLeft');
    frames(3);
    expect(player.body.y).toBe(FLOOR);
    expect(player.flying).toBe(false); // landing ends the flight
  });

  it('sprints from a tap of Ctrl until it stops moving forward', () => {
    const { input, player, frames } = setup();
    const speed = () => Math.hypot(player.body.vx, player.body.vz);
    frames(0.2);
    input.tap('ControlLeft'); // standing still: nothing to sprint
    frames(0.1);
    input.held.add('KeyW');
    frames(1);
    expect(speed()).toBeCloseTo(TUNING.player.walkSpeed, 9);
    input.tap('ControlLeft');
    frames(1);
    expect(player.sprinting).toBe(true);
    expect(speed()).toBeCloseTo(TUNING.player.sprintSpeed, 9);
    input.held.delete('KeyW');
    frames(0.5);
    input.held.add('KeyW');
    frames(1);
    expect(player.sprinting).toBe(false);
    expect(speed()).toBeCloseTo(TUNING.player.walkSpeed, 9);
    input.tap('ControlRight');
    frames(0.2);
    input.tap('ControlLeft'); // a second tap ends it too
    frames(1);
    expect(player.sprinting).toBe(false);
    expect(speed()).toBeCloseTo(TUNING.player.walkSpeed, 9);
  });

  it('puts the camera at the eye, between the last two steps', () => {
    const { input, camera, player, frames } = setup();
    frames(0.2);
    input.held.add('KeyW');
    // Frames that don't line up with steps leave the camera part way between two of them.
    for (let i = 0; i < 50; i++) player.update(1 / 144);
    expect(camera.position.y).toBe(FLOOR + TUNING.player.eyeHeight);
    // Walking forward is along -z, so the camera, a fraction of a step behind, is at a larger z.
    expect(camera.position.z).toBeGreaterThan(player.body.z);
    expect(camera.position.z).toBeLessThan(player.body.z + TUNING.player.walkSpeed * TUNING.player.step);
  });
});

describe('placing blocks', () => {
  const body = createBody(10.5, FLOOR, 10.5);

  it('is refused where the block would overlap the player', () => {
    expect(overlapsBlock(body, 10, FLOOR, 10)).toBe(true); // feet
    expect(overlapsBlock(body, 10, FLOOR + 1, 10)).toBe(true); // head
    const straddling = createBody(11, FLOOR, 10.5); // half in x = 10, half in x = 11
    expect(overlapsBlock(straddling, 10, FLOOR, 10)).toBe(true);
    expect(overlapsBlock(straddling, 11, FLOOR, 10)).toBe(true);
  });

  it('is allowed right next to the player, above the head and under the feet', () => {
    expect(overlapsBlock(body, 11, FLOOR, 10)).toBe(false);
    expect(overlapsBlock(body, 10, FLOOR, 11)).toBe(false);
    expect(overlapsBlock(body, 10, FLOOR + 2, 10)).toBe(false);
    expect(overlapsBlock(body, 10, FLOOR - 1, 10)).toBe(false);
    // Mid-jump, the block the feet just left.
    const jumping = createBody(10.5, FLOOR + 1.1, 10.5);
    expect(overlapsBlock(jumping, 10, FLOOR, 10)).toBe(false);
    // Touching the side of the box exactly is not overlapping.
    const atFace = createBody(10.3, FLOOR, 10.5);
    expect(overlapsBlock(atFace, 9, FLOOR, 10)).toBe(false);
  });
});
