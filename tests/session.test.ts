import { describe, expect, it } from 'vitest';
import { hostWorld } from '../src/net/hostWorld';
import { Network } from '../src/net/loopback';
import { PROTOCOL } from '../src/net/protocol';
import { GuestSession, HostSession } from '../src/net/session';
import { WorldSaver } from '../src/save/saver';
import { MemoryStore, newWorldRecord } from '../src/save/store';
import { handleJob } from '../src/workers/jobs';
import { Block, gateOf, useBlock } from '../src/world/blocks';
import { LogicFlow } from '../src/world/logic';
import { MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../src/world/coords';
import { World } from '../src/world/world';

const SEED = 20261022;
/** The columns everyone loads: blocks -32..63 each way. */
const COLUMNS: [number, number][] = [];
for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) COLUMNS.push([cx, cz]);

/** One test's network and its virtual clock. */
function setup(delay = 0.04, jitter = 0.02) {
  const net = new Network({ delay, jitter, seed: 7 });
  let t = 0;
  const now = () => t;
  /** Let the network and any promises run for `seconds` of virtual time. */
  const pump = async (seconds = 0.5) => {
    for (let s = 0; s < seconds; s += 0.01) {
      t += 0.01;
      net.advance(t);
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  /** Pump until `p` settles. */
  const until = async <T>(p: Promise<T>, most = 10): Promise<T> => {
    let done = false;
    p.then(
      () => (done = true),
      () => (done = true),
    );
    for (let s = 0; s < most && !done; s += 0.1) await pump(0.1);
    return p;
  };
  return { net, now, pump, until };
}

type Env = ReturnType<typeof setup>;

async function makeHost(env: Env) {
  const world = new World(SEED);
  for (const [cx, cz] of COLUMNS) world.ensureColumn(cx, cz);
  const saver = await WorldSaver.open(new MemoryStore(), newWorldRecord('w', 'World', SEED, 0.3));
  const allow = { ok: true };
  // Its logic, woken by every edit as the game's is.
  const logic = new LogicFlow();
  const edit = (x: number, y: number, z: number, b: Block) => {
    if (world.setBlock(x, y, z, b).length) saver.edited(world.getChunk(toChunk(x), toChunk(y), toChunk(z))!);
    logic.wake(x, y, z);
  };
  const room = env.net.room('ABCD');
  const session = new HostSession(
    room,
    hostWorld(world, saver, { time: () => 0.3, position: () => [1.5, 80, 2.5], allowed: () => allow.ok, edit, hitMob: () => {} }),
    'Host',
    env.now,
  );
  /** The host's own edit, as the game makes it: done, then shared. */
  const hostEdit = (x: number, y: number, z: number, b: Block) => {
    edit(x, y, z, b);
    session.shareEdits([[x, y, z, b]]);
  };
  /** A logic tick, its changes made and shared as the game does (as flowing water's are). */
  const tick = () => {
    const changes = logic.tick(world);
    world.setBlocks(changes);
    session.shareEdits(changes, 0, 0, true);
  };
  return { world, saver, session, room, allow, hostEdit, tick };
}

async function makeGuest(env: Env, host: Awaited<ReturnType<typeof makeHost>>, name: string) {
  const { guest } = host.room.join();
  const session = new GuestSession(guest, name, env.now);
  const welcome = await env.until(session.welcome);
  const world = new World(welcome.seed);
  session.attach({ apply: (changes) => world.setBlocks(changes), hasColumn: (cx, cz) => world.hasColumn(cx, cz) });
  /** Load a column as the game's loader does: its edited chunks from the host first, then generated with them. */
  const load = async (cx: number, cz: number) => {
    const saved = session.saves.has(cx, cz) ? await env.until(session.saves.load(cx, cz)) : [];
    const r = handleJob({ kind: 'generate', id: 1, seed: welcome.seed, cx, cz, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y, saved });
    if (r.kind !== 'generate') throw new Error('not generated');
    world.addColumn(cx, cz, r.chunks, r.connectivity, r.light);
    session.columnAdded(cx, cz);
  };
  /** The guest's own edit, as the game makes it: shown at once, then asked of the host. */
  const guestEdit = (x: number, y: number, z: number, b: Block) => {
    world.setBlock(x, y, z, b);
    session.edit(x, y, z, b);
  };
  /** The guest's own click on a switch, button or delay, as the game makes it: shown at once, then the host asked to use it. */
  const guestUse = (x: number, y: number, z: number) => {
    world.setBlock(x, y, z, useBlock(world.getBlock(x, y, z))!);
    session.use(x, y, z);
  };
  return { session, world, welcome, load, guestEdit, guestUse };
}

/** The first chunk (and place in it) where two worlds differ in blocks or light over COLUMNS, or null. */
function difference(a: World, b: World): string | null {
  for (const [cx, cz] of COLUMNS) {
    for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) {
      const ca = a.getChunk(cx, cy, cz);
      const cb = b.getChunk(cx, cy, cz);
      if (!ca || !cb) return `${cx},${cy},${cz} missing`;
      for (let i = 0; i < ca.blocks.length; i++) {
        if (ca.blocks[i] !== cb.blocks[i]) return `${cx},${cy},${cz} block ${i}: ${ca.blocks[i]} / ${cb.blocks[i]}`;
        if (ca.light[i] !== cb.light[i]) return `${cx},${cy},${cz} light ${i}: ${ca.light[i]} / ${cb.light[i]}`;
      }
    }
  }
  return null;
}

/** Ground level at (x, z): the first air above the ground, in `world`. */
function surface(world: World, x: number, z: number): number {
  let y = 255;
  while (y > 0 && world.getBlock(x, y - 1, z) === Block.Air) y--;
  return y;
}

describe('joining', () => {
  it("gives a guest the world's seed, time, players, the host's place and the edited columns", async () => {
    const env = setup();
    const host = await makeHost(env);
    host.hostEdit(5, surface(host.world, 5, 5), 5, Block.Planks);
    host.hostEdit(-20, surface(host.world, -20, 40), 40, Block.Lamp);
    const g = await makeGuest(env, host, 'Pim');
    expect(g.welcome).toMatchObject({ you: 1, seed: SEED, time: 0.3, at: [1.5, 80, 2.5] });
    expect(g.welcome.players).toEqual([
      { id: 0, name: 'Host' },
      { id: 1, name: 'Pim' },
    ]);
    expect(g.session.saves.has(0, 0)).toBe(true);
    expect(g.session.saves.has(-1, 1)).toBe(true);
    expect(g.session.saves.has(1, 1)).toBe(false);
    expect(host.session.players.map((p) => p.name)).toEqual(['Host', 'Pim']);
  });

  it('turns away a fourth guest and another version, and tells the others who joins and leaves', async () => {
    const env = setup();
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'A');
    const events: string[] = [];
    a.session.onEvent = (e) => events.push(e);
    const b = await makeGuest(env, host, 'B');
    await makeGuest(env, host, 'C');
    // The fourth guest: full.
    const { guest } = host.room.join();
    const late = new GuestSession(guest, 'D', env.now);
    await expect(env.until(late.welcome)).rejects.toThrow(/full/);
    // Another version.
    const old = host.room.join();
    const heard: unknown[] = [];
    old.guest.onMessage = (m) => heard.push(m);
    old.guest.send({ type: 'hello', version: PROTOCOL + 1, name: 'Old' });
    await env.pump(0.3);
    expect(heard).toEqual([{ type: 'reject', reason: expect.stringMatching(/version/) }]);
    expect(host.session.players.map((p) => p.name)).toEqual(['Host', 'A', 'B', 'C']);
    // B leaves; A hears of it, and the host makes room.
    b.session.leave();
    await env.pump(0.3);
    expect(events).toEqual(['B joined.', 'C joined.', 'B left.']);
    expect(host.session.players.map((p) => p.id)).toEqual([0, 1, 3]);
    expect(a.session.players.map((p) => p.id)).toEqual([0, 1, 3]);
  });

  it('notices a guest going quiet, and sends guests home when the host closes', async () => {
    const env = setup();
    const host = await makeHost(env);
    const { guest, cut } = host.room.join();
    const quiet = new GuestSession(guest, 'Quiet', env.now);
    await env.until(quiet.welcome);
    const stays = await makeGuest(env, host, 'Stays');
    cut();
    await env.pump(7);
    expect(host.session.players.map((p) => p.name)).toEqual(['Host', 'Stays']);
    let why = '';
    stays.session.onClose = (r) => (why = r);
    host.session.close();
    await env.pump(0.3);
    expect(why).toBe('The host closed the world.');
  });
});

describe('the world over the network', () => {
  it("is the host's for a guest after loading the same columns, edited chunks and all", async () => {
    const env = setup();
    const host = await makeHost(env);
    // Edits saved and written, and edits not yet written.
    for (let i = 0; i < 12; i++) host.hostEdit(-30 + i * 7, surface(host.world, -30 + i * 7, i * 5) - 1, i * 5, Block.Air);
    await host.saver.writeDirty();
    for (let i = 0; i < 8; i++) host.hostEdit(i * 9 - 20, surface(host.world, i * 9 - 20, -25 + i), -25 + i, Block.Glass);
    const g = await makeGuest(env, host, 'Pim');
    for (const [cx, cz] of COLUMNS) await g.load(cx, cz);
    expect(difference(host.world, g.world)).toBe(null);
  });

  it("makes a guest's edits for everyone, and puts back one the host refuses", async () => {
    const env = setup();
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'A');
    const b = await makeGuest(env, host, 'B');
    for (const g of [a, b]) for (const [cx, cz] of COLUMNS) await g.load(cx, cz);
    const y = surface(host.world, 3, 3);
    a.guestEdit(3, y, 3, Block.Planks);
    a.guestEdit(4, y - 1, 3, Block.Air);
    expect(a.world.getBlock(3, y, 3)).toBe(Block.Planks); // at once on A's screen
    await env.pump(0.3);
    expect(a.session.unanswered).toBe(0);
    for (const w of [host.world, b.world]) expect([w.getBlock(3, y, 3), w.getBlock(4, y - 1, 3)]).toEqual([Block.Planks, Block.Air]);
    // Refused (the game said no: out of reach, say): put back on A's screen.
    host.allow.ok = false;
    a.guestEdit(10, y + 3, 10, Block.Stone);
    await env.pump(0.3);
    expect(a.world.getBlock(10, y + 3, 10)).toBe(host.world.getBlock(10, y + 3, 10));
    // Not a block a player can set (flowing water): refused whatever the game says.
    host.allow.ok = true;
    a.guestEdit(11, y + 3, 10, Block.WaterFlow3);
    await env.pump(0.3);
    expect(a.world.getBlock(11, y + 3, 10)).toBe(Block.Air);
    expect(a.session.unanswered).toBe(0);
    for (const w of [a.world, b.world]) expect(difference(host.world, w)).toBe(null);
  });

  it('ends the same everywhere when two players set the same block at once, in the order the host made them', async () => {
    const env = setup(0.05, 0.04);
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'A');
    const b = await makeGuest(env, host, 'B');
    for (const g of [a, b]) for (const [cx, cz] of COLUMNS) await g.load(cx, cz);
    for (let i = 0; i < 20; i++) {
      const x = i - 10;
      const y = surface(host.world, x, 7);
      a.guestEdit(x, y, 7, Block.Planks);
      b.guestEdit(x, y, 7, Block.Glass);
      if (i % 3 === 0) host.hostEdit(x, y, 7, Block.Lamp);
    }
    await env.pump(1);
    for (const w of [a.world, b.world]) expect(difference(host.world, w)).toBe(null);
  });

  it("lands an edit that arrives while its column is still being made", async () => {
    const env = setup();
    const host = await makeHost(env);
    host.hostEdit(40, surface(host.world, 40, 40), 40, Block.Planks); // column (1, 1) edited
    const g = await makeGuest(env, host, 'Pim');
    for (const [cx, cz] of COLUMNS) if (cx !== 1 || cz !== 1) await g.load(cx, cz);
    // The guest's loader has asked for (1, 1) and has the answer, but hasn't made it yet...
    const saved = await env.until(g.session.saves.load(1, 1));
    // ...when the host edits it again, and an untouched column (it hasn't got either) too.
    const y = surface(host.world, 50, 33);
    host.hostEdit(50, y, 33, Block.Lamp);
    await env.pump(0.3);
    const r = handleJob({ kind: 'generate', id: 1, seed: SEED, cx: 1, cz: 1, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y, saved });
    if (r.kind !== 'generate') throw new Error('not generated');
    g.world.addColumn(1, 1, r.chunks, r.connectivity, r.light);
    g.session.columnAdded(1, 1);
    expect(g.world.getBlock(50, y, 33)).toBe(Block.Lamp);
    expect(difference(host.world, g.world)).toBe(null);
  });

  it('times the round trip to the host', async () => {
    const env = setup(0.05, 0);
    const host = await makeHost(env);
    const g = await makeGuest(env, host, 'Pim');
    g.session.update();
    await env.pump(0.5);
    expect(g.session.rtt).toBeGreaterThan(0.09);
    expect(g.session.rtt).toBeLessThan(0.13);
  });
});

describe('logic over the network', () => {
  /**
   * On a stone ledge in the air at y 100, x 0 to 8, z 0: a switch at x 0, wire 1–5, a lamp at 6;
   * and a delay at (4, 1) facing +x with nothing behind it, to be set. A host and two guests, every
   * column loaded.
   */
  const Y = 100;
  async function circuit(env: Env) {
    const host = await makeHost(env);
    for (let x = 0; x <= 8; x++) host.hostEdit(x, Y - 1, 0, Block.Stone);
    host.hostEdit(0, Y, 0, Block.Switch);
    for (let x = 1; x <= 5; x++) host.hostEdit(x, Y, 0, Block.Wire);
    host.hostEdit(6, Y, 0, Block.SignalLamp);
    host.hostEdit(5, Y, 1, Block.Stone);
    host.hostEdit(4, Y, 1, Block.Delay); // facing +x, set to 1
    for (let t = 0; t < 5; t++) host.tick();
    const a = await makeGuest(env, host, 'A');
    const b = await makeGuest(env, host, 'B');
    for (const g of [a, b]) for (const [cx, cz] of COLUMNS) await g.load(cx, cz);
    /** Ticks on the host, the network running between them. */
    const run = async (ticks: number) => {
      for (let t = 0; t < ticks; t++) {
        host.tick();
        await env.pump(0.1);
      }
      await env.pump(0.3);
    };
    return { host, a, b, run };
  }

  it("runs on the host: a guest's switch lights the host's lamp, and every guest sees it, light and all", async () => {
    const env = setup();
    const { host, a, b, run } = await circuit(env);
    expect(difference(host.world, a.world)).toBe(null);
    a.guestUse(0, Y, 0);
    expect(a.world.getBlock(0, Y, 0)).toBe(Block.SwitchOn); // at once on A's screen
    await env.pump(0.3);
    expect(a.session.unanswered).toBe(0);
    expect(host.world.getBlock(0, Y, 0)).toBe(Block.SwitchOn);
    await run(3);
    expect(host.world.getBlock(6, Y, 0)).toBe(Block.SignalLampOn);
    for (const w of [a.world, b.world]) expect(difference(host.world, w)).toBe(null);
    // Off again, by B.
    b.guestUse(0, Y, 0);
    await run(3);
    expect(host.world.getBlock(6, Y, 0)).toBe(Block.SignalLamp);
    for (const w of [a.world, b.world]) expect(difference(host.world, w)).toBe(null);
  });

  it('uses the block as the host has it: two guests flipping a switch at once end with it as it was, the same everywhere', async () => {
    const env = setup(0.05, 0.04);
    const { host, a, b, run } = await circuit(env);
    a.guestUse(0, Y, 0);
    b.guestUse(0, Y, 0);
    // Each sees it on at once; the host flips it twice.
    expect([a.world.getBlock(0, Y, 0), b.world.getBlock(0, Y, 0)]).toEqual([Block.SwitchOn, Block.SwitchOn]);
    await run(4);
    expect(host.world.getBlock(0, Y, 0)).toBe(Block.Switch);
    for (const w of [a.world, b.world]) expect(difference(host.world, w)).toBe(null);
    // A delay set on twice at once goes on two settings.
    a.guestUse(4, Y, 1);
    b.guestUse(4, Y, 1);
    await run(1);
    expect(gateOf(host.world.getBlock(4, Y, 1))!.setting).toBe(3);
    for (const w of [a.world, b.world]) expect(difference(host.world, w)).toBe(null);
  });

  it("refuses a use out of reach or of a block that isn't one to use, and a guest's edit setting a state, putting them back", async () => {
    const env = setup();
    const { host, a, run } = await circuit(env);
    host.allow.ok = false;
    a.guestUse(0, Y, 0);
    await run(2);
    expect(a.world.getBlock(0, Y, 0)).toBe(Block.Switch);
    host.allow.ok = true;
    // A lamp isn't used; asked anyway (a guest's game wouldn't), it's refused.
    a.session.use(6, Y, 0);
    // Lit, powered or on: the signals' to set, not a guest's.
    for (const [x, b] of [[6, Block.SignalLampOn], [0, Block.SwitchOn], [3, Block.Wire + 12]] as const) a.guestEdit(x, Y, 0, b);
    await run(2);
    expect(a.session.unanswered).toBe(0);
    expect([host.world.getBlock(6, Y, 0), host.world.getBlock(0, Y, 0), host.world.getBlock(3, Y, 0)]).toEqual([Block.SignalLamp, Block.Switch, Block.Wire]);
    expect(difference(host.world, a.world)).toBe(null);
  });
});
