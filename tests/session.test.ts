import { describe, expect, it } from 'vitest';
import { hostWorld } from '../src/net/hostWorld';
import { Network } from '../src/net/loopback';
import { PROTOCOL } from '../src/net/protocol';
import { GuestSession, HostSession } from '../src/net/session';
import { WorldSaver } from '../src/save/saver';
import { MemoryStore, newWorldRecord, type WorldMode } from '../src/save/store';
import { handleJob } from '../src/workers/jobs';
import { Block, gateOf } from '../src/world/blocks';
import { LogicFlow } from '../src/world/logic';
import { MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../src/world/coords';
import { World } from '../src/world/world';
import { hostSurvival } from '../src/net/hostSurvival';
import type { PlayerState } from '../src/net/playerState';
import { Furnace, Furnaces } from '../src/survival/furnace';
import { Chests } from '../src/survival/chest';
import { GroundItems } from '../src/survival/ground';
import { Item } from '../src/survival/items';
import type { Stack } from '../src/survival/inventory';
import { chest, door, doorOf, furnace, wheat } from '../src/world/blocks';
import { useAt } from '../src/world/parts';

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
  // The world's mode and guests' kept states, as the game holds them.
  const mode = { value: 'creative' as WorldMode };
  const kept = new Map<string, Record<string, unknown>>();
  // Its logic, woken by every edit as the game's is.
  const logic = new LogicFlow();
  // Its ground and furnaces, as the game's.
  const ground = new GroundItems();
  const furnaces = new Furnaces();
  const chests = new Chests();
  const edit = (x: number, y: number, z: number, b: Block) => {
    if (world.setBlock(x, y, z, b).length) saver.edited(world.getChunk(toChunk(x), toChunk(y), toChunk(z))!);
    logic.wake(x, y, z);
  };
  const room = env.net.room('ABCD');
  const session = new HostSession(
    room,
    hostWorld(world, saver, {
      time: () => 0.3,
      position: () => [1.5, 80, 2.5],
      allowed: () => allow.ok,
      edit,
      hitMob: () => {},
      ...hostSurvival(ground, furnaces, chests, (x, y, z) => world.getBlock(x, y, z), (id) => session.states().get(id)),
      mode: () => mode.value,
      kept: (name) => kept.get(name) ?? null,
      keep: (name, s) => void kept.set(name, s),
    }),
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
  return { world, saver, session, room, allow, hostEdit, tick, mode, kept, ground, furnaces, chests };
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
  /** The guest's own click on a switch, button, delay or door, as the game makes it: shown at once (a door's two halves), then the host asked to use it. */
  const guestUse = (x: number, y: number, z: number) => {
    for (const [px, py, pz, pb] of useAt(world, x, y, z)!) world.setBlock(px, py, pz, pb);
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

  it("opens and shuts both halves of the host's door for a guest's click, the same everywhere", async () => {
    const env = setup();
    const { host, a, b, run } = await circuit(env);
    host.hostEdit(2, Y - 1, 3, Block.Stone);
    host.hostEdit(2, Y, 3, door(2, false, false));
    host.hostEdit(2, Y + 1, 3, door(2, false, true));
    await run(3);
    a.guestUse(2, Y + 1, 3);
    expect(doorOf(a.world.getBlock(2, Y, 3))!.open).toBe(true); // at once on A's screen, both halves
    await env.pump(0.3);
    await run(3);
    for (const w of [host.world, a.world, b.world]) {
      expect(w.getBlock(2, Y, 3)).toBe(door(2, true, false));
      expect(w.getBlock(2, Y + 1, 3)).toBe(door(2, true, true));
    }
    // Shut by B, from the lower half.
    b.guestUse(2, Y, 3);
    await run(3);
    for (const w of [host.world, a.world, b.world]) expect(doorOf(w.getBlock(2, Y + 1, 3))!.open).toBe(false);
    for (const w of [a.world, b.world]) expect(difference(host.world, w)).toBe(null);
    // Refused (out of reach, say): both halves put back on A's screen.
    host.allow.ok = false;
    a.guestUse(2, Y, 3);
    expect(doorOf(a.world.getBlock(2, Y + 1, 3))!.open).toBe(true);
    await env.pump(0.3);
    expect(a.world.getBlock(2, Y, 3)).toBe(door(2, false, false));
    expect(a.world.getBlock(2, Y + 1, 3)).toBe(door(2, false, true));
    expect(a.session.unanswered).toBe(0);
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

describe('survival over the network', () => {
  it("gives a guest the host's mode, follows the host switching it, and keeps a guest's state by name for when it comes back", async () => {
    const env = setup();
    const host = await makeHost(env);
    host.mode.value = 'survival';
    const a = await makeGuest(env, host, 'Pim');
    expect(a.welcome.mode).toBe('survival');
    expect(a.welcome.kept).toBe(null); // first time here
    // The host switches: the guest hears.
    const heard: WorldMode[] = [];
    a.session.onMode = (m) => heard.push(m);
    host.session.shareMode('creative');
    await env.pump(0.3);
    expect(heard).toEqual(['creative']);
    host.mode.value = 'survival';
    // What the guest sends is kept under its name.
    const state = { inventory: [{ item: 3, count: 12 }, null, { item: 262, count: 1, wear: 4 }], health: { health: 13, air: 10 } };
    a.session.keep(state);
    await env.pump(0.3);
    expect(host.kept.get('Pim')).toEqual(state);
    // Gone, and back under the same name: it's in the welcome. Someone else gets nothing.
    a.session.leave();
    await env.pump(0.3);
    const again = await makeGuest(env, host, 'Pim');
    expect(again.welcome.kept).toEqual(state);
    const other = await makeGuest(env, host, 'Aroon');
    expect(other.welcome.kept).toBe(null);
  });

  /** A guest standing at (x, y, z), its clock learned first (states wait for that), and the host told. */
  async function standAt(env: Env, a: Awaited<ReturnType<typeof makeGuest>>, x: number, y: number, z: number) {
    for (let i = 0; i < 30 && !a.session.synced; i++) {
      a.session.update();
      await env.pump(0.1);
    }
    const st: Omit<PlayerState, 'time'> = { x, y, z, yaw: 0, pitch: 0, flying: false, crouching: false, swimming: false, onGround: true, held: Block.Air, swings: 0, digging: Block.Air };
    a.session.sendState(st);
    await env.pump(0.3);
  }

  it("puts a guest's drop on the host's ground, shows it to every guest near, and gives it to the first who asks", async () => {
    const env = setup();
    const host = await makeHost(env);
    host.mode.value = 'survival';
    const a = await makeGuest(env, host, 'Pim');
    const b = await makeGuest(env, host, 'Aroon');
    const y = surface(host.world, 4, 4);
    await standAt(env, a, 4.5, y, 4.5);
    await standAt(env, b, 5.5, y, 4.5);
    // A drops 5 coal at its feet: on the host's ground.
    a.session.drop({ item: Item.Coal, count: 5 }, 4.5, y + 0.5, 4.5);
    await env.pump(0.3);
    expect(host.ground.items.map((g) => [g.item, g.count])).toEqual([[Item.Coal, 5]]);
    // Shared: both see it where it lies.
    host.session.shareGround(host.ground.items);
    await env.pump(0.3);
    for (const g of [a, b]) expect(g.session.ground.map((it) => [it.item, it.count])).toEqual([[Item.Coal, 5]]);
    const id = a.session.ground[0].id;
    // Lying still, it isn't sent again for a second; then it is (in case one was lost).
    a.session.ground = [];
    host.session.shareGround(host.ground.items);
    await env.pump(0.3);
    expect(a.session.ground).toEqual([]);
    await env.pump(0.8);
    host.session.shareGround(host.ground.items);
    await env.pump(0.3);
    expect(a.session.ground.length).toBe(1);
    // Both ask for it at once: A for 3, B for all 5. A asked first: 3 for A, the 2 left for B.
    const given: [string, Stack][] = [];
    a.session.onGiven = (st) => given.push(['Pim', st]);
    b.session.onGiven = (st) => given.push(['Aroon', st]);
    a.session.take(id, 3);
    b.session.take(id, 5);
    await env.pump(0.5);
    expect(given.sort()).toEqual([
      ['Aroon', { item: Item.Coal, count: 2 }],
      ['Pim', { item: Item.Coal, count: 3 }],
    ]);
    expect(host.ground.items).toEqual([]);
    // Asked again, it's gone: nothing.
    a.session.take(id, 1);
    await env.pump(0.3);
    expect(given.length).toBe(2);
  });

  it('refuses a drop or a take far from where a guest was heard', async () => {
    const env = setup();
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'Pim');
    const y = surface(host.world, 4, 4);
    await standAt(env, a, 4.5, y, 4.5);
    a.session.drop({ item: Item.Coal, count: 5 }, 30.5, y + 0.5, 4.5);
    await env.pump(0.3);
    expect(host.ground.items).toEqual([]);
    const far = host.ground.drop(20.5, y + 0.5, 4.5, { item: Item.Stick, count: 2 });
    const got: Stack[] = [];
    a.session.onGiven = (st) => got.push(st);
    a.session.take(far.id, 2);
    await env.pump(0.3);
    expect(got).toEqual([]);
    expect(host.ground.items.length).toBe(1);
  });

  it("opens the host's furnace for a guest: what's in it and its changes, what's put in and taken out checked there", async () => {
    const env = setup();
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'Pim');
    const y = surface(host.world, 4, 4);
    host.hostEdit(6, y, 4, furnace(0, false));
    host.furnaces.at(6, y, 4).slots.slots[1] = { item: Item.Coal, count: 2 };
    await standAt(env, a, 4.5, y, 4.5);
    const seen: Furnace[] = [];
    a.session.onContainer = (_x, _y, _z, state) => seen.push(Furnace.from(state));
    const given: Stack[] = [];
    a.session.onGiven = (st) => given.push(st);
    a.session.openContainer(6, y, 4);
    await env.pump(0.3);
    expect(seen.at(-1)!.slots.slots[1]).toEqual({ item: Item.Coal, count: 2 });
    // Raw iron in: it's there, and the guest hears.
    a.session.containerPut(6, y, 4, 0, { item: Item.RawIron, count: 3 });
    await env.pump(0.3);
    expect(host.furnaces.at(6, y, 4).slots.slots[0]).toEqual({ item: Item.RawIron, count: 3 });
    expect(seen.at(-1)!.slots.slots[0]).toEqual({ item: Item.RawIron, count: 3 });
    // Sticks as fuel onto the coal: not the same, so they come back; raw iron as fuel: not a fuel, back.
    a.session.containerPut(6, y, 4, 1, { item: Item.Stick, count: 4 });
    a.session.containerPut(6, y, 4, 1, { item: Item.RawIron, count: 1 });
    await env.pump(0.3);
    expect(given).toEqual([
      { item: Item.Stick, count: 4 },
      { item: Item.RawIron, count: 1 },
    ]);
    expect(host.furnaces.at(6, y, 4).slots.slots[1]).toEqual({ item: Item.Coal, count: 2 });
    // The host's furnace burns: the guest hears it changed, and only when it has.
    const before = seen.length;
    host.session.shareContainers();
    await env.pump(0.2);
    expect(seen.length).toBe(before);
    host.furnaces.at(6, y, 4).step(1);
    host.session.shareContainers();
    await env.pump(0.2);
    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)!.progress).toBeGreaterThan(0);
    // What's left of the fuel taken: given, and gone from the furnace.
    a.session.containerTake(6, y, 4, 1);
    await env.pump(0.3);
    expect(given.at(-1)!.item).toBe(Item.Coal);
    expect(host.furnaces.at(6, y, 4).slots.slots[1]).toBe(null);
    // Closed: no more news.
    a.session.closeContainer();
    await env.pump(0.2);
    const closed = seen.length;
    host.furnaces.at(6, y, 4).step(1);
    host.session.shareContainers();
    await env.pump(0.2);
    expect(seen.length).toBe(closed);
    // Where there's no furnace: what's put in comes back.
    a.session.containerPut(9, y, 4, 0, { item: Item.RawIron, count: 1 });
    await env.pump(0.3);
    expect(given.at(-1)).toEqual({ item: Item.RawIron, count: 1 });
  });

  it("brings a hostile mob's hit to the guest it hit", async () => {
    const env = setup();
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'Pim');
    const hurts: number[][] = [];
    a.session.onHurt = (damage, push, fromX, fromZ) => hurts.push([damage, push, fromX, fromZ]);
    host.session.hurt(a.session.you, 2, 5, 3.5, -1);
    await env.pump(0.3);
    expect(hurts).toEqual([[2, 5, 3.5, -1]]);
  });

  it("opens the host's chest for a guest: its slots heard, a put and a take made there, a different item never swapped", async () => {
    const env = setup();
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'Pim');
    const y = surface(host.world, 4, 4);
    host.hostEdit(6, y, 4, chest(1));
    host.chests.at(6, y, 4).slots[0] = { item: Item.Coal, count: 5 };
    await standAt(env, a, 4.5, y, 4.5);
    const seen: (Stack | null)[][] = [];
    a.session.onContainer = (_x, _y, _z, state) => seen.push((state as { slots: (Stack | null)[] }).slots);
    const given: Stack[] = [];
    a.session.onGiven = (st) => given.push(st);
    a.session.openContainer(6, y, 4);
    await env.pump(0.3);
    expect(seen.at(-1)![0]).toEqual({ item: Item.Coal, count: 5 });
    expect(seen.at(-1)!.length).toBe(27);
    // Into the last slot: there, and heard.
    a.session.containerPut(6, y, 4, 26, { item: Item.Wheat, count: 9 });
    await env.pump(0.3);
    expect(host.chests.at(6, y, 4).slots[26]).toEqual({ item: Item.Wheat, count: 9 });
    expect(seen.at(-1)![26]).toEqual({ item: Item.Wheat, count: 9 });
    // Onto the coal: sticks come back; more coal goes on.
    a.session.containerPut(6, y, 4, 0, { item: Item.Stick, count: 3 });
    a.session.containerPut(6, y, 4, 0, { item: Item.Coal, count: 2 });
    await env.pump(0.3);
    expect(given).toEqual([{ item: Item.Stick, count: 3 }]);
    expect(host.chests.at(6, y, 4).slots[0]).toEqual({ item: Item.Coal, count: 7 });
    // Taken out: given, gone from the chest.
    a.session.containerTake(6, y, 4, 26);
    await env.pump(0.3);
    expect(given.at(-1)).toEqual({ item: Item.Wheat, count: 9 });
    expect(host.chests.at(6, y, 4).slots[26]).toBe(null);
    // Out of reach: nothing.
    await standAt(env, a, 40.5, y, 4.5);
    a.session.containerTake(6, y, 4, 0);
    await env.pump(0.3);
    expect(host.chests.at(6, y, 4).slots[0]).toEqual({ item: Item.Coal, count: 7 });
  });

  it("makes a guest's tilling and sowing where the ground allows it, and refuses them elsewhere", async () => {
    const env = setup();
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'Pim');
    for (const [cx, cz] of COLUMNS) await a.load(cx, cz);
    const y = surface(host.world, 4, 4);
    host.hostEdit(5, y, 5, Block.Grass);
    host.hostEdit(6, y, 5, Block.Stone);
    await env.pump(0.3);
    await standAt(env, a, 4.5, y + 1, 4.5);
    // Tilled grass: made. Tilled stone: put back.
    a.guestEdit(5, y, 5, Block.Farmland);
    a.guestEdit(6, y, 5, Block.Farmland);
    await env.pump(0.5);
    expect(host.world.getBlock(5, y, 5)).toBe(Block.Farmland);
    expect(host.world.getBlock(6, y, 5)).toBe(Block.Stone);
    expect(a.world.getBlock(6, y, 5)).toBe(Block.Stone);
    // Sown on the farmland: made. Sown on the stone, or wheat further on: put back.
    a.guestEdit(5, y + 1, 5, wheat(0));
    a.guestEdit(6, y + 1, 5, wheat(0));
    a.guestEdit(5, y + 1, 5, wheat(7));
    await env.pump(0.5);
    expect(host.world.getBlock(5, y + 1, 5)).toBe(wheat(0));
    expect(host.world.getBlock(6, y + 1, 5)).toBe(Block.Air);
    expect(a.world.getBlock(5, y + 1, 5)).toBe(wheat(0));
  });

  it("tells the host who is asleep", async () => {
    const env = setup();
    const host = await makeHost(env);
    const a = await makeGuest(env, host, 'Pim');
    await standAt(env, a, 4.5, 70, 4.5);
    expect(host.session.remotes.get(a.session.you)!.latest!.sleeping).toBe(false);
    a.session.sendState({ x: 4.5, y: 70, z: 4.5, yaw: 0, pitch: 0, flying: false, crouching: false, swimming: false, onGround: true, sleeping: true, held: Block.Air, swings: 0, digging: Block.Air });
    await env.pump(0.3);
    expect(host.session.remotes.get(a.session.you)!.latest!.sleeping).toBe(true);
  });
});
