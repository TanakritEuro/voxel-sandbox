import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { createMob } from '../src/mobs/brain';
import { KINDS, MobKind } from '../src/mobs/kinds';
import { MobManager, type MobSound } from '../src/mobs/mobs';
import { Network } from '../src/net/loopback';
import { MobMirror } from '../src/net/mobMirror';
import { type MobSnap, packMobs, packMobSounds, unpackMobs, unpackMobSounds } from '../src/net/mobState';
import type { PlayerState } from '../src/net/playerState';
import { type BlockChange, parseMessage } from '../src/net/protocol';
import { GuestSession, HostSession, type HostWorld } from '../src/net/session';
import { Block } from '../src/world/blocks';
import { World } from '../src/world/world';

const snap = (over: Partial<MobSnap> = {}): MobSnap => ({
  id: 7,
  kind: MobKind.CragGoat,
  x: 10.5,
  y: 70,
  z: -4.25,
  yaw: 1,
  state: 'wander',
  vx: 1,
  vz: 0,
  vy: 0,
  onGround: true,
  walked: 3,
  sinceHurt: 99,
  ...over,
});

describe('mobs on the wire', () => {
  it('pack 52 bytes a mob and come back as they were', () => {
    const mob = createMob(7, MobKind.CragGoat, 10.5, 70, -4.25, 1);
    mob.yaw = 1;
    mob.state = 'flee';
    mob.walked = 3.5;
    mob.sinceHurt = 0.25;
    const data = packMobs([mob, createMob(8, MobKind.Hopper, 0.5, 64, 0.5, 2)]);
    expect(data.byteLength).toBe(104);
    const [a, b] = unpackMobs(data)!;
    expect(a).toMatchObject({ id: 7, kind: MobKind.CragGoat, x: 10.5, y: 70, z: -4.25, state: 'flee', walked: 3.5, sinceHurt: 0.25, onGround: false });
    expect(a.yaw).toBeCloseTo(1, 6);
    expect(b.sinceHurt).toBe(99); // never hit: as long ago as it goes
    const sounds: MobSound[] = [{ voice: 'puff', kind: MobKind.Hopper, x: 1.5, y: 64, z: -2 }];
    expect(unpackMobSounds(packMobSounds(sounds))).toEqual(sounds);
  });

  it("aren't taken when they don't make sense", () => {
    const bad = (i: number, v: number) => {
      const a = new Float32Array(packMobs([createMob(1, MobKind.Mossback, 0, 70, 0, 1)]));
      a[i] = v;
      return unpackMobs(a.buffer);
    };
    expect(bad(1, KINDS.length)).toBe(null); // no such kind
    expect(bad(6, 9)).toBe(null); // no such state
    expect(bad(2, Number.NaN)).toBe(null);
    expect(bad(0, 1.5)).toBe(null);
    expect(unpackMobs(new ArrayBuffer(51))).toBe(null);
  });
});

describe('mobs round several players', () => {
  // The spawn's land, and a stretch 200 blocks south of it.
  const world = new World(20261022);
  for (let cz = -2; cz <= 9; cz++) for (let cx = -2; cx <= 2; cx++) world.ensureColumn(cx, cz);
  const a: [number, number] = [16, 16];
  const b: [number, number] = [16, 216];

  it('spawn round each of them, up to the cap for each, twice the cap at most', () => {
    const m = new MobManager(world, 11, 6);
    for (let i = 0; i < 2000 && m.mobs.length < 12; i++) m.update(0.25, [a, b], 1);
    expect(m.mobs.length).toBe(12);
    const near = (p: [number, number]) => m.mobs.filter((mob) => Math.hypot(mob.body.x - p[0], mob.body.z - p[1]) <= TUNING.mobs.spawnDistance[1] + 4).length;
    expect(near(a)).toBeGreaterThan(0);
    expect(near(b)).toBeGreaterThan(0);
    // Never within spawning distance of either.
    for (const mob of m.mobs) for (const p of [a, b]) expect(Math.hypot(mob.body.x - p[0], mob.body.z - p[1])).toBeGreaterThan(TUNING.mobs.spawnDistance[0] - 4);
    // Three players: still twice the cap.
    for (let i = 0; i < 400; i++) m.update(0.25, [a, b, [16, 116]], 1);
    expect(m.mobs.length).toBeLessThanOrEqual(12);
  });

  it('let a mob go only when it is far from every player', () => {
    const m = new MobManager(world, 12, 6);
    const mob = createMob(1, MobKind.Mossback, b[0] + 0.5, 70, b[1] + 0.5, 1);
    m.mobs.push(mob);
    m.update(0, [a, b], 1);
    expect(m.mobs).toContain(mob); // far from A, near B
    m.update(0, [a], 1);
    expect(m.mobs).not.toContain(mob);
  });
});

describe("a guest's mobs", () => {
  const behind = TUNING.net.mobBehind;

  it('are drawn between the snapshots either side of a moment ago, and go when a snapshot leaves them out', () => {
    const mirror = new MobMirror();
    mirror.push(1, [snap({ x: 0, yaw: 3 }), snap({ id: 9, kind: MobKind.Hopper, x: 50 })]);
    mirror.push(1.1, [snap({ x: 1, yaw: -3 }), snap({ id: 9, kind: MobKind.Hopper, x: 50 })]);
    mirror.update(1.05 + behind);
    const goat = mirror.byId(7)!;
    expect(goat.body.x).toBeCloseTo(0.5);
    expect(Math.abs(Math.abs(goat.yaw) - Math.PI)).toBeLessThan(0.15); // the short way
    expect(goat.kind).toBe(MobKind.CragGoat);
    expect(goat.body.halfWidth).toBe(KINDS[MobKind.CragGoat].halfWidth);
    // An older snapshot (out of order) changes nothing; a newer one without the hopper drops it.
    mirror.push(1.05, [snap({ x: 99 })]);
    expect(mirror.mobs.length).toBe(2);
    mirror.push(1.2, [snap({ x: 2 })]);
    expect(mirror.mobs.map((m) => m.id)).toEqual([7]);
    // Held at the newest, past it.
    mirror.update(9);
    expect(goat.body.x).toBe(2);
  });

  it('flash red for as long after a hit as they would on the host', () => {
    const mirror = new MobMirror();
    mirror.push(1, [snap({ sinceHurt: 0 })]);
    mirror.update(1 + behind + 0.1);
    expect(mirror.byId(7)!.sinceHurt).toBeCloseTo(0.1);
  });
});

describe('what the host runs, for its guests', () => {
  function setup() {
    const net = new Network({ delay: 0.03 });
    let t = 0;
    const hits: [number, number][] = [];
    const world: HostWorld = {
      seed: 1,
      time: () => 0.4,
      position: () => [0, 70, 0],
      editedColumns: () => [],
      columnChunks: async () => [],
      edit: () => true,
      blockAt: () => Block.Air,
      hitMob: (player, id) => hits.push([player, id]),
    };
    const room = net.room();
    const host = new HostSession(room, world, 'Host', () => t);
    const guest = new GuestSession(room.join().guest, 'G', () => t);
    const applied: { changes: BlockChange[]; water: boolean }[] = [];
    guest.attach({ apply: (changes, water) => applied.push({ changes, water }), hasColumn: () => true });
    const run = async (seconds: number) => {
      for (let s = 0; s < seconds; s += 0.01) {
        t += 0.01;
        net.advance(t);
        guest.update();
        await Promise.resolve();
      }
    };
    const here = (x: number, z: number): Omit<PlayerState, 'time'> => ({
      x,
      y: 70,
      z,
      yaw: 0,
      pitch: 0,
      flying: false,
      crouching: false,
      swimming: false,
      onGround: true,
      held: 0,
      swings: 0,
      digging: 0,
    });
    return { host, guest, hits, applied, run, here };
  }

  it('sends a guest the mobs near it, and the sounds within its hearing', async () => {
    const { host, guest, run, here } = setup();
    await run(0.2);
    guest.sendState(here(100, 0));
    await run(0.1);
    const near = createMob(1, MobKind.Mossback, 120, 70, 0, 1);
    const far = createMob(2, MobKind.Mossback, -100, 70, 0, 2);
    let sounds: MobSound[] = [];
    guest.onMobSounds = (s) => (sounds = s);
    host.shareMobs([near, far], [
      { voice: 'puff', kind: MobKind.Mossback, x: 110, y: 70, z: 0 },
      { voice: 'call', kind: MobKind.Mossback, x: -100, y: 70, z: 0 },
    ]);
    await run(0.1);
    expect(guest.mobs.mobs.map((m) => m.id)).toEqual([1]);
    expect(sounds.map((s) => s.voice)).toEqual(['puff']);
  });

  it("passes a guest's hit to the host's game, tells guests when blocks are flowing water, and shares the time", async () => {
    const { host, guest, hits, applied, run } = setup();
    await run(0.2);
    expect(guest.time).toBe(0.4); // from the welcome
    guest.hit(41);
    host.shareEdits([[1, 70, 1, Block.WaterFlow3]], 0, 0, true);
    host.shareEdits([[2, 70, 1, Block.Stone]]);
    let heard = -1;
    guest.onTime = (time) => (heard = time);
    host.shareTime(0.55);
    await run(0.1);
    expect(hits).toEqual([[guest.you, 41]]);
    expect(applied.map((a) => a.water)).toEqual([true, false]);
    expect([heard, guest.time]).toEqual([0.55, 0.55]);
    expect(parseMessage({ type: 'hit', id: 41 })).toEqual({ type: 'hit', id: 41 });
  });
});
