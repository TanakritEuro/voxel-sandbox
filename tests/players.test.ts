import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { editAllowed } from '../src/net/hostWorld';
import { Network } from '../src/net/loopback';
import { packState, type PlayerState, STATE_BYTES, unpackState } from '../src/net/playerState';
import { parseMessage } from '../src/net/protocol';
import { RemotePlayer } from '../src/net/remotePlayer';
import { GuestSession, HostSession, type HostWorld } from '../src/net/session';
import { Block } from '../src/world/blocks';

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  time: 10,
  x: 1.5,
  y: 70,
  z: -3.25,
  yaw: 0.5,
  pitch: -0.2,
  flying: false,
  crouching: true,
  swimming: false,
  onGround: true,
  held: Block.Torch,
  swings: 3,
  digging: Block.Stone,
  ...over,
});

describe('player states', () => {
  it('pack into 80 bytes and come back as they were', () => {
    const s = state({ time: 123456.789012, flying: true, swimming: true });
    const data = packState(s);
    expect(data.byteLength).toBe(STATE_BYTES);
    expect(unpackState(data)).toEqual(s);
    expect(parseMessage({ type: 'state', id: 2, data })).toEqual({ type: 'state', id: 2, data });
  });

  it("aren't taken when they don't make sense", () => {
    expect(unpackState(new ArrayBuffer(72))).toBe(null);
    const bad = (i: number, v: number) => {
      const a = new Float64Array(packState(state()));
      a[i] = v;
      return unpackState(a.buffer);
    };
    expect(bad(1, Number.NaN)).toBe(null);
    expect(bad(3, 1e9)).toBe(null); // far beyond the world
    expect(bad(7, 300)).toBe(null); // no such block
    expect(bad(6, 1.5)).toBe(null);
    expect(parseMessage({ type: 'state', id: 4, data: packState(state()) })).toBe(null);
  });
});

describe('another player, drawn', () => {
  const behind = TUNING.net.behind;

  it('is drawn between the states either side of a moment ago, turning the short way', () => {
    const r = new RemotePlayer();
    expect(r.poseAt(0)).toBe(null);
    r.push(state({ time: 1, x: 0, yaw: 3 }));
    r.push(state({ time: 1.05, x: 0.2, yaw: -3 }));
    r.push(state({ time: 1.1, x: 0.4, yaw: -3 }));
    const p = r.poseAt(1.025 + behind)!;
    expect(p.x).toBeCloseTo(0.1);
    // From 3 to -3 the short way is through π, not back through 0.
    expect(Math.abs(Math.abs(p.yaw) - Math.PI)).toBeLessThan(0.15);
  });

  it('is guessed on for a moment past the newest state, then held', () => {
    const r = new RemotePlayer();
    r.push(state({ time: 1, x: 0 }));
    r.push(state({ time: 1.05, x: 0.2 })); // 4 blocks a second
    expect(r.poseAt(1.1 + behind)!.x).toBeCloseTo(0.4);
    expect(r.poseAt(5 + behind)!.x).toBeCloseTo(0.2 + 4 * TUNING.net.extrapolate);
  });

  it('drops a state older than the newest (late, or out of order)', () => {
    const r = new RemotePlayer();
    r.push(state({ time: 2, x: 5 }));
    r.push(state({ time: 1, x: 99 }));
    r.push(state({ time: 2, x: 99 }));
    expect(r.latest!.x).toBe(5);
  });

  it('counts the ground walked, but not a jump across the map, and swings an arm on a new swing', () => {
    const r = new RemotePlayer();
    let x = 0;
    for (let i = 0; i <= 20; i++) {
      r.push(state({ time: i * 0.05, x, swings: i < 10 ? 3 : 4 }));
      x += 0.2;
      r.poseAt(i * 0.05 + behind);
    }
    const walked = r.poseAt(1 + behind)!.walked;
    expect(walked).toBeGreaterThan(3.5);
    expect(walked).toBeLessThan(4.1);
    r.push(state({ time: 1.05, x: 500 }));
    r.push(state({ time: 1.1, x: 500 }));
    expect(r.poseAt(1.2 + behind)!.walked).toBeCloseTo(walked, 0);
    // The swing came with the state at 0.5 s.
    const fresh = new RemotePlayer();
    fresh.push(state({ time: 0, swings: 3 }));
    fresh.poseAt(behind);
    fresh.push(state({ time: 0.5, swings: 4 }));
    expect(fresh.poseAt(0.5 + behind)!.sinceSwing).toBe(0);
    expect(fresh.poseAt(0.7 + behind)!.sinceSwing).toBeCloseTo(0.2);
  });
});

describe('states over the network', () => {
  const world: HostWorld = {
    seed: 1,
    time: () => 0.5,
    position: () => [0, 70, 0],
    editedColumns: () => [],
    columnChunks: async () => [],
    edit: () => true,
    use: () => true,
    blockAt: () => Block.Air,
    hitMob: () => {},
  };

  it("go from each guest to the host and the other guests, and the host's to everyone, on the host's clock", async () => {
    const net = new Network({ delay: 0.04, jitter: 0.01 });
    let t = 100;
    const room = net.room();
    const host = new HostSession(room, world, 'Host', () => t);
    // The guests' clocks are 100 s behind the host's: they learn the difference from pings.
    const guestNow = () => t - 100;
    const a = new GuestSession(room.join().guest, 'A', guestNow);
    const b = new GuestSession(room.join().guest, 'B', guestNow);
    const run = async (seconds: number) => {
      for (let s = 0; s < seconds; s += 0.01) {
        t += 0.01;
        net.advance(t);
        a.update();
        b.update();
        await Promise.resolve();
      }
    };
    await run(0.2);
    // Not before the host's clock is known.
    expect(a.synced).toBe(true);
    expect(Math.abs(a.clock() - t)).toBeLessThan(0.02);
    a.sendState(state({ x: 11 }));
    host.sendState(state({ x: 22 }));
    await run(0.2);
    // Numbers go by whose hello the host heard first.
    expect(host.remotes.get(a.you)!.latest!.x).toBe(11);
    expect(b.remotes.get(a.you)!.latest!.x).toBe(11);
    expect(b.remotes.get(0)!.latest!.x).toBe(22);
    expect(a.remotes.get(0)!.latest!.x).toBe(22);
    expect(a.remotes.has(a.you)).toBe(false); // not its own
    // Stamped on the host's clock, near enough.
    expect(Math.abs(host.remotes.get(a.you)!.latest!.time - (t - 0.2))).toBeLessThan(0.1);
    // Where everyone is, for checking edits.
    expect([...host.states().keys()].sort()).toEqual([0, a.you]);
    // A leaves: gone from the others' lists.
    a.leave();
    await run(0.2);
    expect(host.remotes.has(a.you)).toBe(false);
    expect(b.remotes.has(a.you)).toBe(false);
  });
});

describe('checking an edit', () => {
  const at = (x: number, y: number, z: number) => state({ x, y, z, crouching: false });

  it('allows it within reach of where the player was heard, with some slack, and no further', () => {
    const me = at(0.5, 70, 0.5);
    const eye = 70 + TUNING.player.eyeHeight;
    const reach = TUNING.edit.reach + TUNING.net.reachSlack;
    expect(editAllowed(me, [me], 0, Math.floor(eye) + Math.floor(reach) - 1, 0, Block.Stone)).toBe(true);
    expect(editAllowed(me, [me], Math.ceil(reach) + 2, Math.floor(eye), 0, Block.Stone)).toBe(false);
    expect(editAllowed(undefined, [], 0, 70, 0, Block.Stone)).toBe(false); // not heard from yet
  });

  it("refuses a solid block inside anyone, but not one you can walk through", () => {
    const me = at(0.5, 70, 0.5);
    const friend = at(3.5, 70, 0.5);
    expect(editAllowed(me, [me, friend], 3, 71, 0, Block.Stone)).toBe(false);
    expect(editAllowed(me, [me, friend], 0, 70, 0, Block.Stone)).toBe(false);
    expect(editAllowed(me, [me, friend], 3, 71, 0, Block.Torch)).toBe(true);
    expect(editAllowed(me, [me, friend], 2, 70, 0, Block.Stone)).toBe(true);
  });
});
