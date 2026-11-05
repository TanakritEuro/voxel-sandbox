// The game, loaded by `main.ts` for `?world=<id>` (a saved world) or an unsaved one (`?seed=`,
// `?at=`, `?autofly`): world, saving, chunk loading, the player, block editing, the HUD and
// the pause menu.

import * as THREE from 'three';
import { heard, SoundCues, underfoot } from './audio/cues';
import { Sound } from './audio/sound';
import { Autofly } from './autofly';
import { Flood } from './flood';
import { ChunkLoader } from './chunkLoader';
import { TUNING } from './config';
import { Input } from './input';
import { Player } from './player';
import { loadSettings, saveSettings, type Settings } from './settings';
import { WorldSaver } from './save/saver';
import { IndexedDbStore, MemoryStore, modeOf, newWorldRecord, type PlayerState, type SurvivalRecord, type WorldStore } from './save/store';
import { isUnsavedUrl } from './save/worlds';
import { Inventory } from './ui/inventory';
import { KEYS, PauseMenu, SURVIVAL_KEYS } from './ui/pauseMenu';
import { Backpack } from './ui/backpack';
import { itemArt, itemIcons } from './render/itemIcons';
import { digTime } from './survival/drops';
import { HOTBAR_SLOTS, Inventory as SurvivalInventory } from './survival/inventory';
import { foodOf, isBlockItem, Item, itemInfo } from './survival/items';
import { breakWith, heldTool, placeableIn } from './survival/play';
import { type GroundItem, GroundItems } from './survival/ground';
import { type Furnace, Furnaces } from './survival/furnace';
import { Health } from './survival/health';
import { hash3 } from './math';
import { ChunkRenderer } from './render/chunkRenderer';
import { CrackOverlay } from './render/crack';
import { Clouds } from './render/clouds';
import { blendFog, easeFog, fogColour } from './render/fog';
import { HeldBlock } from './render/heldBlock';
import { blockIcons } from './render/icons';
import { brightness, ParticleMesh, Particles } from './render/particles';
import { GroundItemView } from './render/groundItems';
import { clock, skyAt } from './render/sky';
import { SkyDome } from './render/skyDome';
import { WaterView, waterFlow } from './render/water';
import { Stats } from './stats';
import { WorkerPool } from './workers/pool';
import type { Mob } from './mobs/brain';
import { mobOnRay } from './mobs/hit';
import { KINDS } from './mobs/kinds';
import { type MobSound, MobManager } from './mobs/mobs';
import { BlockCache } from './mobs/blockCache';
import { Bot } from './net/bot';
import { editAllowed, hostWorld } from './net/hostWorld';
import type { Room } from './net/link';
import { Network } from './net/loopback';
import { cleanName, type BlockChange } from './net/protocol';
import { cleanRoomCode } from './net/roomCode';
import { GuestSession, HostSession } from './net/session';
import { Traffic } from './net/traffic';
import { button, el, field } from './ui/dom';
import { PlayerRenderer } from './render/playerRenderer';
import { MobRenderer } from './render/mobRenderer';
import { Block, BLOCKS, furnace, furnaceOf, hotbarFrom, isThinLogic, isTorch, logicPlacement, torchFor, useBlock } from './world/blocks';
import { torchesHeldBy } from './world/torches';
import { CHUNK_SIZE, toChunk } from './world/coords';
import { Mining } from './world/mining';
import { overlapsBlock, touches } from './world/physics';
import { raycast, type RayHit } from './world/raycast';
import { WaterFlow, type WaterChange, type WaterWorld, wakeColumn } from './world/water';
import { isLogic, LogicFlow, type LogicChange, wakeLogicColumn } from './world/logic';
import { Circuit } from './circuit';
import { World } from './world/world';

const params = new URLSearchParams(location.search);
// `?radius=8` overrides the view radius, for measuring.
const radiusParam = Number(params.get('radius'));
const radiusHeld = Number.isInteger(radiusParam) && radiusParam > 0;
const settings = loadSettings();
TUNING.view.radius = radiusHeld ? radiusParam : settings.viewDistance;
// `?lod=0`: every column at full detail; `?lod=8,13`: half detail from 8 chunks, a quarter from 13 (for comparing).
const lodParam = params.get('lod');
if (lodParam === '0') TUNING.view.lod.near = TUNING.view.lod.far = Number.POSITIVE_INFINITY;
else if (lodParam) {
  const [near, far] = lodParam.split(',').map(Number);
  if (near > 0 && far >= near) TUNING.view.lod = { ...TUNING.view.lod, near, far };
}
// `?time=0.5` holds the time of day there (0 midnight, 0.5 noon), for screenshots and measuring;
// `?daylength=60` makes a day last that many seconds, to watch it go round.
const timeParam = params.get('time');
const timeHeld = timeParam !== null && Number.isFinite(Number(timeParam));
const dayLengthParam = Number(params.get('daylength'));
if (dayLengthParam > 0) TUNING.day.length = dayLengthParam;

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const info = document.querySelector<HTMLDivElement>('#info')!;
const hotbarEl = document.querySelector<HTMLDivElement>('#hotbar')!;

// Antialiasing and resolution from the settings; `?aa=0` turns antialiasing off and `?scale=0.5`
// draws at half the resolution on top, for measuring how much of the GPU's time goes on pixels.
// Antialiasing belongs to the WebGL context, so a change shows the next time a world is opened.
const scaleParam = Number(params.get('scale')) || 1;
const pixelRatio = (s: Settings) => Math.min(window.devicePixelRatio, 2) * s.resolution * scaleParam;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.antialias && params.get('aa') !== '0' });
renderer.setPixelRatio(pixelRatio(settings));
renderer.setSize(window.innerWidth, window.innerHeight);
// Draw calls and triangles counted over the whole frame (the world, then the held block), for `?stats`.
renderer.info.autoReset = false;

const viewDistance = TUNING.view.radius * CHUNK_SIZE;
const scene = new THREE.Scene();
scene.background = new THREE.Color(TUNING.sky.colour);
scene.fog = new THREE.Fog(TUNING.sky.colour, viewDistance * TUNING.sky.fogStartFraction, viewDistance * 0.95);

const camera = new THREE.PerspectiveCamera(TUNING.view.fov, window.innerWidth / window.innerHeight, 0.1, viewDistance * 1.5);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const waterView = new WaterView(scene);

// Joining a friend's world (`?join=<code>`, from the world list): connected before anything is
// made, since the world is theirs: its seed, its time, where they stand. Failing, back to the
// list with why. Everything sent and heard is counted for `?stats`.
const traffic = new Traffic(() => performance.now() / 1000);
const guest = params.has('join') ? await joinFriend(cleanRoomCode(params.get('join') ?? '')) : null;
const welcome = guest ? await guest.welcome : null;
const hostName = welcome?.players.find((p) => p.id === 0)?.name ?? 'Your friend';

/** Connect to the world with this code; on failure, back to the world list saying why (and never return). */
async function joinFriend(code: string | null): Promise<GuestSession> {
  const note = el(document.body, 'div', 'menu-root');
  el(el(note, 'div', 'menu'), 'div', 'menu-title', code ? `Joining ${code}…` : 'Joining…');
  try {
    if (!code) throw new Error('That isn’t a code: it’s four letters and numbers.');
    const { joinRoom } = await import('./net/link');
    const session = new GuestSession(traffic.link(await joinRoom(code)), settings.name, () => performance.now() / 1000);
    session.onClose = leaveFor;
    await session.welcome;
    note.remove();
    return session;
  } catch (e) {
    leaveFor(e instanceof Error ? e.message : 'Couldn’t join.');
    return new Promise<never>(() => {});
  }
}

/** Back to the world list, telling the player why. */
function leaveFor(reason: string): void {
  location.replace(`${location.pathname}?left=${encodeURIComponent(reason)}`);
}

// The world chosen in the list, saved in this browser (IndexedDB) as it's played; or one the URL
// asks for to look at or measure (`?seed=`, `?at=`, `?autofly`), which starts fresh each time
// and is kept in memory only; or a friend's, as a guest, kept nowhere here. A world that isn't
// there (deleted in another tab) goes back to the list.
const unsaved = isUnsavedUrl(params) || guest !== null;
const store: WorldStore = unsaved ? new MemoryStore() : await openStore();
const found = unsaved ? undefined : await store.getWorld(params.get('world') ?? '');
if (!unsaved && !found) {
  // Back to the list, and nothing more here: the page is going.
  location.replace(location.pathname);
  await new Promise<never>(() => {});
}
const record =
  found ??
  (welcome
    ? newWorldRecord('guest', `${hostName}’s world`, welcome.seed, welcome.time)
    : newWorldRecord('unsaved', 'Unsaved world', Number(params.get('seed') ?? TUNING.world.seed), TUNING.day.start, params.has('survival') ? 'survival' : 'creative'));
// A guest starts where the host stands.
if (welcome) record.player = { x: welcome.at[0], y: welcome.at[1], z: welcome.at[2], yaw: 0, pitch: 0, flying: false };
// A guest plays the host's mode, with what the host kept for this name last time (cleaned below,
// by `Inventory.from` and `Health.from`, like a saved one).
if (welcome) {
  record.mode = welcome.mode;
  if (welcome.kept) record.survival = welcome.kept as unknown as SurvivalRecord;
}
record.played = Date.now();
const saver = await WorldSaver.open(store, record);
// Survival (`survival/`): what's gathered is what there is to build with. The inventory is the
// record's, so saved with it (a guest's, kept by the host).
let survival = modeOf(record) === 'survival';
const pack = SurvivalInventory.from(record.survival?.inventory);
const health = Health.from(record.survival?.health);
const survivalRecord = { inventory: pack.slots, health: health.toJSON() };
record.survival = survivalRecord;
/** Died, and not started again yet (the death screen is up). */
let dead = false;
// `?kit` (an unsaved world only): something of everything to try, a tool of each kind and tier,
// the metals, food and what crafting starts from.
if (unsaved && !guest && params.has('kit')) {
  for (const item of [Item.StonePick, Item.WoodAxe, Item.IronSpade, Block.Torch, Block.Planks, Item.WoodPick, Item.IronPick, Item.StoneAxe, Item.WoodSpade])
    pack.add(item, isBlockItem(item) ? 16 : 1);
  for (const [item, n] of [[Block.Wood, 12], [Block.Sand, 20], [Block.Stone, 30], [Item.Coal, 10], [Item.Copper, 12], [Item.Iron, 8], [Item.Crystal, 3], [Item.Stick, 6], [Block.Furnace, 1], [Item.RawCopper, 6], [Item.RawIron, 6], [Item.RawMeat, 4], [Item.Berries, 6]] as const) pack.add(item, n);
  // A little hungry, to try eating at once.
  health.hunger = 12;
}
/** Blocks broken in survival so far: with the place, what seeds a block's drops. */
let gathered = 0;
/** What lies on the ground: dropped by blocks broken in survival, and thrown (`survival/ground.ts`). */
const ground = new GroundItems();
/** Furnaces' contents by place (`survival/furnace.ts`), saved with the record. */
const furnaces = Furnaces.from(record.furnaces);
let time = timeHeld ? Number(timeParam) : record.time;

const world = new World(record.seed);
// Sounds wait for the first click or key (browsers allow audio only after a gesture).
const sound = new Sound(settings.volume, settings.muted);
const cues = new SoundCues();
window.addEventListener('pointerdown', () => sound.unlock());
window.addEventListener('keydown', () => sound.unlock());
const skyDome = new SkyDome(TUNING.sky.sunTilt);
scene.add(skyDome.group);
const clouds = new Clouds(record.seed, TUNING.sky.cloudCover, TUNING.sky.cloudHeight, TUNING.sky.cloudCell);
scene.add(clouds.mesh);
const particles = new Particles();
const particleMesh = new ParticleMesh(particles);
scene.add(particleMesh.mesh);
/** Daylight this frame, for lighting new particles. */
let daylightNow = 1;
// Mobs (`mobs/`): animals round the player, not saved. `?mobs=0` none, `?mobs=40` a cap of 40.
const mobsParam = Number(params.get('mobs') ?? Number.NaN);
const mobCap = Number.isFinite(mobsParam) ? Math.max(0, Math.floor(mobsParam)) : TUNING.mobs.max;
const mobs = mobCap > 0 && !guest ? new MobManager(world, record.seed ^ 0x6d6f62, mobCap) : null;
// Room for the most there can be: twice the cap when playing together.
const mobView = mobCap > 0 ? new MobRenderer(mobCap * 2) : null;
if (mobView) {
  scene.add(mobView.group);
  // Its shader compiled now, not when the first mob comes into view: compiling then made frames
  // of 40–65 ms flying (Chrome on Direct3D).
  renderer.compile(mobView.group, camera);
}
let mobsRead = performance.now();
/** `?showcase`: one of each kind in front of the player once the ground is there. */
let showcase = params.has('showcase');
/** The mobs line of `?stats`: how many of each kind, path searches a second since last read (and put off), time this frame. */
function mobLine(): string {
  if (guest) return `${guest.mobs.mobs.length} near, run by the host`;
  if (!mobs) return 'off (?mobs=0)';
  const now = performance.now();
  const seconds = Math.max((now - mobsRead) / 1000, 1e-3);
  const line =
    `${mobs.mobs.length} of ${mobs.limit} (${mobs.counts().map((n, k) => `${KINDS[k].name.toLowerCase()} ${n}`).join(', ')}), ` +
    `${(mobs.searches / seconds).toFixed(1)} paths a second (${(mobs.deferred / seconds).toFixed(1)} put off), ${mobs.ms.toFixed(2)} ms`;
  mobs.searches = mobs.deferred = 0;
  mobsRead = now;
  return line;
}
/** The fog where the player is (`fog.ts`), eased towards the biomes there each frame. */
let fog: ReturnType<typeof blendFog> | null = null;
// `?light` shows light as grey instead of textures.
const chunks = new ChunkRenderer(params.has('light'));
/** Items lying on the ground, drawn from the chunks' own texture pixels. */
const groundView = new GroundItemView(chunks.textures.image.data as Uint8Array);
scene.add(groundView.group);
/** The selected block, drawn in the lower right. */
const held = new HeldBlock(chunks.textures);
scene.add(chunks.group);
// `?workers=1` runs fewer workers, to see how a machine with fewer cores loads.
const workersParam = Number(params.get('workers'));
const pool = new WorkerPool(Number.isInteger(workersParam) && workersParam > 0 ? workersParam : undefined);
const loader = new ChunkLoader(world, chunks, pool, guest ? guest.saves : saver);

// Flowing water (`world/water.ts`): edits wake it, and it ticks every `TUNING.water.tickSeconds`.
const flow = new WaterFlow();
let waterClock = 0;
/** For `?stats`: the last tick's changes and times, and the slowest since the line was last read. */
let waterLast = { changes: 0, sim: 0, apply: 0 };
let waterWorst = 0;
// Logic blocks (`world/logic.ts`): edits wake them too, and they tick every `TUNING.logic.tickSeconds`.
const logic = new LogicFlow();
let logicClock = 0;
/** For `?stats`: the last tick that did something, and the slowest since the line was last read. */
let logicLast = { changes: 0, wires: 0, sim: 0, apply: 0, light: 0 };
let logicWorst = 0;
// A column read from the save carries on flowing, and its circuits carry on; one next to held-back
// water lets it through. On a guest, the host's edits that came for a column meanwhile are made in it.
loader.onColumnAdded = (cx, cz, saved) => {
  if (guest) return guest.columnAdded(cx, cz);
  wakeColumn(flow, world, cx, cz, saved);
  wakeLogicColumn(logic, world, cx, cz, saved);
};

/** Make a tick's changes (or `?flood`'s): the blocks and their light at once, then saving, and remeshing in the workers. */
function applyWater(changes: WaterChange[]): void {
  // Water washing a logic block away breaks its circuit.
  for (const [x, y, z] of changes) if (isLogic(world.getBlock(x, y, z))) logic.wake(x, y, z);
  applyChanges(changes);
}

/** Blocks set by a tick (water's or logic's), as `applyWater` says; shared with guests to be made the same way. */
function applyChanges(changes: WaterChange[] | LogicChange[]): void {
  const stale = world.setBlocks(changes);
  host?.shareEdits(changes, 0, 0, true);
  const edited = new Set<string>();
  for (const [x, y, z] of changes) {
    const c = world.getChunk(toChunk(x), toChunk(y), toChunk(z));
    if (c && !edited.has(c.key)) {
      edited.add(c.key);
      saver.edited(c);
    }
  }
  remeshSoon(stale);
}

/** These chunks' columns remeshed in the workers, the old meshes shown meanwhile. */
function remeshSoon(stale: readonly { cx: number; cz: number }[]): void {
  const columns = new Set<string>();
  for (const c of stale) {
    if (columns.has(`${c.cx},${c.cz}`)) continue;
    columns.add(`${c.cx},${c.cz}`);
    loader.remeshSoon(c.cx, c.cz);
  }
}

/**
 * A guest makes the blocks the host set: flowing water at once and remeshed in the workers, as the
 * host does; edits one by one, remeshed now. Someone else's edit is heard where it is (its own come
 * back already made, and change nothing).
 */
function fromHost(changes: BlockChange[], water: boolean): void {
  if (water) {
    remeshSoon(world.setBlocks(changes));
    return;
  }
  const p = camera.position;
  for (const [x, y, z, b] of changes) {
    const was = world.getBlock(x, y, z);
    if (was === b) continue;
    for (const c of world.setBlock(x, y, z, b)) loader.remesh(c.cx, c.cy, c.cz);
    const h = heard(x + 0.5, y + 0.5, z + 0.5, p.x, p.y, p.z, input.yaw);
    if (h) sound.play(b === Block.Air ? { name: 'break', material: BLOCKS[was].sound, gain: h.gain } : { name: 'place', material: BLOCKS[b].sound, gain: h.gain });
  }
}

/** A tick's changes, made the frame after it ran (and its simulation time). */
let waterDue: { changes: WaterChange[]; sim: number } | null = null;

/**
 * Once a frame (not while paused): a water tick when one is due. Its changes are made on the
 * next frame, so a busy tick's two halves (working them out, then the blocks and light) fall on
 * different frames; they're made long before the next tick, as the flow needs.
 */
function flowWater(dt: number): void {
  if (waterDue) {
    const { changes, sim } = waterDue;
    waterDue = null;
    const t0 = performance.now();
    applyWater(changes);
    const apply = performance.now() - t0;
    waterLast = { changes: changes.length, sim, apply };
    waterWorst = Math.max(waterWorst, sim, apply);
    flood?.tick(changes.length, sim, apply);
    return;
  }
  const T = TUNING.water.tickSeconds;
  waterClock += dt;
  if (waterClock < T) return;
  waterClock = Math.min(waterClock - T, T); // never more than one tick behind
  if (!flow.pending) return;
  const t0 = performance.now();
  const cache = new BlockCache(world);
  const blocks: WaterWorld = { getBlock: (x, y, z) => cache.getBlock(x, y, z), hasColumn: (cx, cz) => world.hasColumn(cx, cz) };
  const changes = flow.tick(blocks);
  const sim = performance.now() - t0;
  if (changes.length) waterDue = { changes, sim };
  else waterLast = { changes: 0, sim, apply: 0 };
}

/**
 * Once a frame (not while paused): a logic tick when one is due, its few changes made at once (a
 * lamp's light with them), so a click shows on the next tick.
 */
function tickLogic(dt: number): void {
  const T = TUNING.logic.tickSeconds;
  logicClock += dt;
  if (logicClock < T) return;
  logicClock = Math.min(logicClock - T, T); // never more than one tick behind
  if (!logic.pending) return;
  const t0 = performance.now();
  const cache = new BlockCache(world);
  const changes = logic.tick({ getBlock: (x, y, z) => cache.getBlock(x, y, z), hasColumn: (cx, cz) => world.hasColumn(cx, cz) });
  const t1 = performance.now();
  if (changes.length) applyChanges(changes);
  const t2 = performance.now();
  logicWorst = Math.max(logicWorst, t2 - t0);
  if (!changes.length) return;
  logicLast = { changes: changes.length, wires: logic.wires, sim: t1 - t0, apply: t2 - t1, light: world.lightMs };
  circuit?.tick(changes.length, t1 - t0, t2 - t1);
}

/** The logic line of `?stats`: what's waiting, the last tick that changed something, and the slowest tick since last read. */
function logicLine(): string {
  const l = logicLast;
  const line =
    `${logic.pending} waiting; last change ${l.changes} blocks, ${l.wires} wires, ${l.sim.toFixed(2)} ms working out, ` +
    `${l.apply.toFixed(2)} ms making them (${l.light.toFixed(2)} light); slowest tick ${logicWorst.toFixed(2)} ms`;
  logicWorst = 0;
  return line;
}

/** The water line of `?stats`: blocks waiting, the last tick, and the slowest tick since last read. */
function waterLine(): string {
  const w = waterLast;
  const line =
    `${flow.pending} woken; last tick ${w.changes} changes, ${w.sim.toFixed(2)} ms simulating, ${w.apply.toFixed(2)} ms making them; ` +
    `slowest half a tick ${waterWorst.toFixed(2)} ms`;
  waterWorst = 0;
  return line;
}
// `?nolock`: the mouse counts as captured without the browser's pointer lock (for testing from outside).
const input = new Input(canvas, params.has('nolock'));

/** Are the columns around (x, z) loaded? The player holds still until they are. */
function columnsLoaded(x: number, z: number): boolean {
  const cx = toChunk(Math.floor(x));
  const cz = toChunk(Math.floor(z));
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!world.hasColumn(cx + dx, cz + dz)) return false;
  return true;
}

// Back where the player was in a saved world; otherwise standing on dry land near the origin,
// or near `?at=x,z`.
const [atX, atZ] = (params.get('at') ?? '0,0').split(',').map((v) => Math.floor(Number(v)) || 0);
const spawn = world.generator.findLand(atX, atZ ?? 0);
/** Where a new player stands, and a survival player starts again. */
const spawnFeet = { x: spawn.x + 0.5, y: world.generator.height(spawn.x, spawn.z) + 1, z: spawn.z + 0.5 };
const player = new Player(
  camera,
  input,
  world,
  columnsLoaded,
  record.player ?? spawnFeet,
);
if (record.player) {
  input.yaw = record.player.yaw;
  input.pitch = record.player.pitch;
  player.flying = record.player.flying;
}
player.canFly = !survival;

// Playing together (`net/`): this world opened to friends from the pause menu (the host), or a
// friend's joined (`guest`). `?bot` opens it at once to a test guest in this page, over the test
// network, walking circles round the start and building (`net/bot.ts`).
let host: HostSession | null = null;
const network = params.has('bot') ? new Network() : null;
const bots: Bot[] = [];
const playerView = new PlayerRenderer();
scene.add(playerView.group);
renderer.compile(playerView.group, camera);
// A guest makes the host's edits in this world, hears who comes and goes, and keeps the host's time.
if (guest) {
  guest.attach({ apply: fromHost, hasColumn: (cx, cz) => world.hasColumn(cx, cz) });
  guest.onEvent = (text) => {
    say(text);
    pauseMenu.refresh();
  };
  guest.onTime = (t) => {
    if (!timeHeld) time = t;
  };
  // The host switched the world's mode: everyone plays it.
  guest.onMode = (mode) => setMode(mode === 'survival');
  setInterval(sendKept, TUNING.net.keptEvery * 1000);
  guest.onMobSounds = (sounds) => {
    const p = camera.position;
    for (const s of sounds) {
      const h = heard(s.x, s.y + 0.5, s.z, p.x, p.y, p.z, input.yaw);
      if (h) sound.play({ name: 'mob', voice: s.voice, kind: s.kind, ...h });
      if (s.voice === 'puff') {
        const k = KINDS[s.kind];
        particles.puff(s.x, s.y, s.z, k.halfWidth, k.height, brightness(world.getLight(Math.floor(s.x), Math.floor(s.y + 0.5), Math.floor(s.z)), daylightNow));
      }
    }
  };
}

/** Open this world to friends in `room`: from now on the host. */
function openToFriends(room: Room): HostSession {
  room.onError = (reason) => say(reason);
  const session = new HostSession(
    traffic.room(room),
    hostWorld(world, saver, {
      time: () => time,
      position: () => [player.body.x, player.body.y, player.body.z],
      allowed: (id, x, y, z, block): boolean => editAllowed(session.states().get(id), session.states().values(), x, y, z, block),
      edit: (x, y, z, block) => guestEdit(x, y, z, block),
      hitMob: (id, mobId) => guestHit(id, mobId),
      mode: () => modeOf(record),
      kept: (name) => {
        const k = record.guests?.[name];
        return k ? { ...k } : null;
      },
      // A guest's state, cleaned as a saved one is, kept in this world's record by name.
      keep: (name, s) => {
        (record.guests ??= {})[name] = { inventory: SurvivalInventory.from(s.inventory).toJSON(), health: Health.from(s.health).toJSON() };
      },
    }),
    settings.name,
    () => performance.now() / 1000,
  );
  session.onEvent = (text) => {
    say(text);
    pauseMenu.refresh();
  };
  host = session;
  pauseMenu.refresh();
  return session;
}

/** Close this world to friends: they're sent home. */
function closeToFriends(): void {
  host?.close();
  host = null;
  loader.setOthers([]);
  pauseMenu.refresh();
}

/**
 * The world goes on (water, mobs, time, furnaces) except in the pause menu playing alone: an
 * inventory screen or the picker leaves it going, so a furnace burns as you watch, and playing
 * together it never stops.
 */
const worldRuns = () => !paused() || host !== null || guest !== null || backpack.open || inventory.open;
/** Arm swings so far (digging hits, breaks, places), for the others to see. */
let swings = 0;
let lastStateSent = Number.NEGATIVE_INFINITY;
let lastMobsSent = Number.NEGATIVE_INFINITY;
let lastTimeSent = Number.NEGATIVE_INFINITY;
/** Mob sounds made since the mobs were last sent to guests. */
let mobSoundsOut: MobSound[] = [];

/** Where the players the mobs live round are: this one, and those it plays with. */
function mobPlayers(): [number, number][] {
  const out: [number, number][] = [[player.body.x, player.body.z]];
  if (host) for (const r of host.remotes.values()) if (r.latest) out.push([r.latest.x, r.latest.z]);
  return out;
}

/** A line on screen for a moment (someone joined or left, a problem). */
const eventsEl = el(document.body, 'div', 'events');
function say(text: string): void {
  const line = el(eventsEl, 'div', 'event', text);
  setTimeout(() => line.classList.add('fading'), 5000);
  setTimeout(() => line.remove(), 6000);
}

/** A guest hit mob `mobId`: made as this player's hit would be, if it was in reach of where they were last heard. */
function guestHit(id: number, mobId: number): void {
  const mob = mobs?.byId(mobId);
  const who = host?.states().get(id);
  if (!mob || !who) return;
  const b = mob.body;
  const far = Math.hypot(b.x - who.x, b.y + b.height / 2 - (who.y + TUNING.player.eyeHeight), b.z - who.z);
  if (far <= TUNING.edit.reach + TUNING.net.reachSlack + 1) hitMob(mob, who.x, who.z);
}

/** Once a frame, playing together: this player's state now and then, the others drawn; a host also sends mobs and time, and keeps the others' land loaded. */
function playTogether(now: number): void {
  const net = host ?? guest;
  network?.advance(now / 1000);
  for (const b of bots) b.update();
  guest?.update();
  if (!net) return;
  if (now / 1000 - lastStateSent >= 1 / TUNING.net.stateRate) {
    lastStateSent = now / 1000;
    const b = player.body;
    net.sendState({
      x: b.x,
      y: b.y,
      z: b.z,
      yaw: input.yaw,
      pitch: input.pitch,
      flying: player.flying,
      crouching: player.crouching(),
      swimming: b.inWater,
      onGround: b.onGround,
      held: heldBlock(),
      swings,
      digging: mining.target?.block ?? 0,
    });
  }
  // The mobs near each guest, and the sounds they made; the time of day now and then.
  if (host && mobs && now / 1000 - lastMobsSent >= 1 / TUNING.net.mobRate) {
    lastMobsSent = now / 1000;
    host.shareMobs(mobs.mobs, mobSoundsOut);
    mobSoundsOut = [];
  }
  if (host && now / 1000 - lastTimeSent >= TUNING.net.timeEvery) {
    lastTimeSent = now / 1000;
    host.shareTime(time);
  }
  const clockNow = net.clock();
  const others = [...net.remotes].flatMap(([id, remote]) => {
    const pose = remote.poseAt(clockNow);
    return pose ? [{ id, name: net.players.find((p) => p.id === id)?.name ?? '', pose }] : [];
  });
  if (host) loader.setOthers(others.map((o) => [o.pose.x, o.pose.z]));
  playerView.update(others, world, daylightNow);
}

/** The network line of `?stats`: who, and what goes each way. */
function netLine(): string {
  if (!host && !guest) return 'playing alone';
  const r = traffic.rates();
  const who = host ? `hosting ${host.code}, ${host.players.length} in` : `in ${hostName}’s world, ${guest!.players.length} in, round trip ${Math.round(guest!.rtt * 1000)} ms`;
  return `${who}; ${(r.up / 1024).toFixed(1)} KB/s out, ${(r.down / 1024).toFixed(1)} KB/s in, ${Math.round(r.messages)} messages a second`;
}

// Measuring: `?stats` overlay (F3), `?autofly` scripted flight.
const autoflySeconds = Autofly.seconds(params);
const stats = new Stats(
  renderer,
  () => ({
    chunks: world.chunks.size,
    visible: loader.visibleChunks,
    meshed: chunks.count,
    pages: chunks.pages,
    levels: loader.levels,
    mobs: mobLine(),
    water: waterLine(),
    logic: logicLine(),
    net: netLine(),
    mouse: { now: input.takeBiggestMove(), ever: input.biggestMoveEver, raw: input.raw, dropped: input.spikes.dropped },
    queued: loader.queued,
    inFlight: loader.inFlight,
    workerBusy: pool.busy(),
    chunkBytes: world.blockBytes,
    lightBytes: world.lightBytes,
    geometryBytes: chunks.bytes,
    sceneTriangles: chunks.triangles,
    lastEdit,
    time: `${clock(time)}, daylight ${skyAt(time).daylight.toFixed(2)}${timeHeld ? ' (held)' : ''}`,
    saving:
      (unsaved ? 'off (this world is not kept)' : `${saver.unsaved} edited chunks to write`) +
      (saver.last ? `; last wrote ${saver.last.chunks} chunks, ${(saver.last.bytes / 1024).toFixed(1)} KB in ${saver.last.ms.toFixed(1)} ms` : ''),
  }),
  params.has('stats') || autoflySeconds !== null,
);
const autofly =
  autoflySeconds === null
    ? null
    : new Autofly(player, loader, autoflySeconds, (report, text) => {
        stats.note = text;
        console.log(`[autofly]\n${text}\n${JSON.stringify(report)}`);
      });
// `?flood`: the sea let into a room under it at once, to measure the worst case (`flood.ts`).
const flood = params.has('flood')
  ? new Flood(world, flow, applyWater, (report, text) => {
      stats.note = text;
      console.log(`[flood]\n${text}\n${JSON.stringify(report)}`);
    })
  : null;
// `?circuit`: a clock, a chaser and a big grid of wire built in the air, to measure the logic (`circuit.ts`).
const circuit = params.has('circuit')
  ? new Circuit(
      (changes) => {
        for (const [x, y, z, b] of changes) if (isLogic(b) || isLogic(world.getBlock(x, y, z))) logic.wake(x, y, z);
        applyChanges(changes);
      },
      (x, y, z) => {
        player.body.x = x;
        player.body.y = y;
        player.body.z = z;
        player.body.vx = player.body.vy = player.body.vz = 0;
        input.yaw = -Math.PI / 2;
        input.pitch = -0.35;
      },
      (report, text) => {
        stats.note = text;
        console.log(`[circuit]\n${text}\n${JSON.stringify(report)}`);
      },
    )
  : null;

// Outline around the block you're looking at.
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x111111 }),
);
outline.visible = false;
scene.add(outline);
const cracks = new CrackOverlay();
scene.add(cracks.mesh);

// --- Editing -----------------------------------------------------------------------------

let selected = 0;
/** For `?stats`: what the last edit cost. */
let lastEdit: { ms: number; lightMs: number; chunks: number } | null = null;
let target: RayHit | null = null;
const mining = new Mining();
// In survival a block takes as long as the tool held (or the hand) makes it.
mining.timeOf = (block) => (survival ? digTime(block, heldTool(pack, selected)) : BLOCKS[block].hardness);

/** The world's hotbar (kept in its record, so saved with it), and every block's icon. */
const hotbar = hotbarFrom(record.hotbar);
record.hotbar = hotbar;
const icons = blockIcons();

// The block picker: choosing a block puts it in the selected slot, and the world remembers it.
const inventory = new Inventory(document.body, icons, (block) => {
  hotbar[selected] = block;
  renderHotbar();
  void saveRecord();
});
function openInventory(): void {
  inventory.show(selected, hotbar[selected]);
  input.unlock();
}
function closeInventory(): void {
  inventory.hide();
  input.lock();
}

// Survival's inventory screen (E), with crafting.
const itemIconUrls = itemIcons();
/** An item's icon: a block's from the textures, anything else its own picture. */
const iconOf = (item: number): string => (isBlockItem(item) ? icons[item] : (itemIconUrls.get(item) ?? ''));
const backpack = new Backpack(document.body, pack, iconOf, {
  changed: () => renderHotbar(),
  lost: (s) => dropAtFeet(s),
});
/** The inventory screen, with crafting, or with `furnace` (opened from one). */
function openBackpack(furnace: Furnace | null = null): void {
  backpack.show(furnace);
  input.unlock();
}

/**
 * Once a frame (not on a guest): every furnace in loaded land burns and smelts, and its block is lit
 * or put out to match, all at once as a tick of water is (light in one update, remeshed in the
 * workers). A furnace kept where there's no furnace block any more is forgotten.
 */
function tickFurnaces(dt: number): void {
  const gone: [number, number, number][] = [];
  const changes: LogicChange[] = [];
  for (const [x, y, z, f] of furnaces.entries()) {
    if (!world.hasColumn(toChunk(x), toChunk(z))) continue;
    const block = furnaceOf(world.getBlock(x, y, z));
    if (!block) {
      gone.push([x, y, z]);
      continue;
    }
    f.step(dt);
    if (block.lit !== f.lit) changes.push([x, y, z, furnace(block.facing, f.lit)]);
  }
  if (changes.length) applyChanges(changes);
  for (const [x, y, z] of gone) {
    if (backpack.showing === furnaces.get(x, y, z)) closeBackpack();
    furnaces.remove(x, y, z);
  }
}
function closeBackpack(): void {
  backpack.hide();
  input.lock();
}
/** Items' pictures, made once each, for holding them. */
const arts = new Map<number, Uint8Array | null>();
const artOf = (item: number): Uint8Array | null => {
  if (!arts.has(item)) arts.set(item, itemArt(item));
  return arts.get(item)!;
};

/** The block in the hand: the selected slot's (in survival, nothing if it isn't a block). */
function heldBlock(): Block {
  return survival ? (placeableIn(pack, selected) ?? Block.Air) : hotbar[selected];
}

function renderHotbar(): void {
  inventory.refresh(selected, hotbar[selected]);
  if (!survival) {
    hotbarEl.innerHTML = hotbar.map(
      (b, i) =>
        `<div class="slot${i === selected ? ' selected' : ''}" title="${BLOCKS[b].name}"><span style="background-image: url(${icons[b]})"></span><em>${i + 1}</em></div>`,
    ).join('');
    return;
  }
  // Survival: the inventory's first nine, with counts, and how worn a tool is.
  hotbarEl.innerHTML = pack.slots
    .slice(0, HOTBAR_SLOTS)
    .map((s, i) => {
      const cls = `slot${i === selected ? ' selected' : ''}`;
      if (!s) return `<div class="${cls}"><em>${i + 1}</em></div>`;
      const info = itemInfo(s.item);
      const look = `<span style="background-image: url(${iconOf(s.item)})"></span>`;
      const count = s.count > 1 ? `<b>${s.count}</b>` : '';
      const wear = info.tool ? `<i style="width: ${Math.round(100 * (1 - (s.wear ?? 0) / info.tool.wear))}%"></i>` : '';
      return `<div class="${cls}" title="${info.name}">${look}<em>${i + 1}</em>${count}${wear}</div>`;
    })
    .join('');
}

/**
 * What block `block` at (x, y, z) gives in survival, dropped there with a hop in a random direction
 * (`wear`: the tool held wears).
 */
function gather(block: Block, x: number, y: number, z: number, wear = true): void {
  const G = TUNING.survival.ground;
  const broke = breakWith(pack, selected, block, hash3(record.seed ^ gathered++, x, y, z), wear);
  for (const [item, count] of broke.drops) {
    const a = Math.random() * Math.PI * 2;
    const out = Math.random() * G.scatter;
    ground.drop(x + 0.5, y + 0.5, z + 0.5, { item, count }, Math.cos(a) * out, G.hop, Math.sin(a) * out);
  }
  if (broke.woreOut !== null) say(`Your ${itemInfo(broke.woreOut).name.toLowerCase()} wore out.`);
  renderHotbar();
}

/** An item on the ground reached in survival: as much of it as fits goes into the inventory; returns what's left. */
function pickUp(g: GroundItem): number {
  const left = pack.add(g.item, g.count, g.wear);
  if (left < g.count) {
    sound.play({ name: 'pickup', gain: 1 });
    renderHotbar();
  }
  return left;
}

/** Q: one of the selected item thrown the way the player looks (Shift: all of it). */
function throwSelected(all: boolean): void {
  const s = pack.slots[selected];
  if (!s) return;
  const G = TUNING.survival.ground;
  const n = all ? s.count : 1;
  const stack = { ...s, count: n };
  s.count -= n;
  if (!s.count) pack.slots[selected] = null;
  const d = player.direction();
  const eye = camera.position;
  ground.drop(eye.x + d.x * 0.4, eye.y - 0.3 + d.y * 0.4, eye.z + d.z * 0.4, stack, d.x * G.throwSpeed, d.y * G.throwSpeed + G.throwUp, d.z * G.throwSpeed, G.throwDelay);
  swing();
  renderHotbar();
}

/** What a stack picked up on the inventory screen does when there's no room to put it back: it drops at the feet. */
function dropAtFeet(stack: { item: number; count: number; wear?: number }): void {
  const b = player.body;
  ground.drop(b.x, b.y + 0.5, b.z, stack, 0, 1, 0, TUNING.survival.ground.throwDelay);
}

/** Creative or survival from now on, saved with the world; each keeps its own hotbar. */
function setMode(toSurvival: boolean): void {
  survival = toSurvival;
  record.mode = toSurvival ? 'survival' : 'creative';
  player.canFly = !toSurvival;
  mining.target = null;
  if (inventory.open) closeInventory();
  if (backpack.open) closeBackpack();
  renderHotbar();
  renderVitals();
  host?.shareMode(record.mode);
  void saveRecord();
}

// Health (survival): pips over the hotbar, bubbles under water, a red flash when hurt, and a screen
// to start again after dying (back at the spawn, with everything still carried).
const vitalsEl = el(document.body, 'div', 'vitals hidden');
const hurtEl = el(document.body, 'div', 'hurt-flash');
const deathRoot = el(document.body, 'div', 'menu-root death hidden');
const deathPanel = el(deathRoot, 'div', 'menu');
el(deathPanel, 'div', 'menu-title', 'You died');
const deathWhy = el(deathPanel, 'p', 'menu-help');
el(deathPanel, 'p', 'menu-help', 'Everything you carried is still with you.');
button(el(deathPanel, 'div', 'menu-row'), 'Start again', () => startAgain(), 'menu-go');
const CAUSES = { fall: 'You fell too far.', drowning: 'You ran out of air.', cactus: 'A cactus got you.', starving: 'You starved.' } as const;
/** What the HUD shows now, so it's redrawn only when that changes. */
let vitalsShown = '';

function renderVitals(): void {
  const S = TUNING.survival;
  const bubbles = health.air < S.air ? Math.ceil((health.air / S.air) * 10) : -1;
  const key = survival ? `${health.health},${health.hunger},${bubbles}` : '';
  if (key === vitalsShown) return;
  vitalsShown = key;
  vitalsEl.classList.toggle('hidden', !survival);
  if (!survival) return;
  // Health on the left, hunger on the right (its pips filling from the right), a pip for two points.
  const pips = (points: number, most: number, kind: string) => {
    let row = `<div class="pips ${kind}">`;
    for (let i = 0; i < most / 2; i++) {
      const left = points - i * 2;
      row += `<span class="pip${left >= 2 ? ' full' : left === 1 ? ' half' : ''}"></span>`;
    }
    return row + '</div>';
  };
  let html = `<div class="vitals-row">${pips(health.health, S.maxHealth, 'health')}${pips(health.hunger, S.maxHunger, 'food')}</div>`;
  if (bubbles >= 0) {
    html += '<div class="bubbles">';
    for (let i = 0; i < 10; i++) html += `<span class="bubble${i < bubbles ? ' full' : ''}"></span>`;
    html += '</div>';
  }
  vitalsEl.innerHTML = html;
}

/** Once a frame while playing in survival: hurt, healed or out of air by how the body is. */
function live(dt: number): void {
  if (dead || player.waiting) return;
  const b = player.body;
  const lost = health.step(dt, {
    y: b.y,
    onGround: b.onGround,
    inWater: b.inWater,
    flying: player.flying,
    eyeInWater: player.eyeInWater,
    touchingCactus: touches(b, world, Block.Cactus),
    sprinting: player.sprinting && !player.flying,
    swimming: b.inWater,
    digging: mining.target !== null,
  });
  if (lost) {
    sound.play({ name: 'hurt', gain: Math.min(1, 0.6 + lost * 0.1) });
    hurtEl.classList.remove('on');
    void hurtEl.offsetWidth; // start the flash again
    hurtEl.classList.add('on');
  }
  renderVitals();
  if (health.dead) die();
}

function die(): void {
  dead = true;
  mining.target = null;
  if (backpack.open) backpack.hide();
  deathWhy.textContent = health.cause ? CAUSES[health.cause] : '';
  deathRoot.classList.remove('hidden');
  input.unlock();
  void saveRecord();
}

function startAgain(): void {
  dead = false;
  deathRoot.classList.add('hidden');
  health.reset();
  player.moveTo(spawnFeet.x, spawnFeet.y, spawnFeet.z);
  renderVitals();
  input.lock();
  void saveRecord();
}

/** Seconds the right button has been held with food selected; and whether this press was turned down (full). */
let eatingFor = 0;
let eatRefused = false;

/** Survival: holding the right button with food selected eats it, a mouthful at a time, after `eatSeconds`. */
function eating(dt: number): void {
  const food = survival && !dead ? foodOf(pack.slots[selected]?.item) : 0;
  if (!food || !input.isHeld('Mouse2')) {
    eatingFor = 0;
    eatRefused = false;
    return;
  }
  if (eatRefused) return;
  if (health.hunger >= TUNING.survival.maxHunger) {
    say('You aren’t hungry.');
    eatRefused = true;
    return;
  }
  const before = eatingFor;
  eatingFor += dt;
  // A bite every quarter second: a sound and the hand going to the mouth.
  if (Math.floor(eatingFor / 0.25) > Math.floor(before / 0.25)) {
    sound.play({ name: 'eat', gain: 0.8 });
    held.motion.swing();
  }
  if (eatingFor < TUNING.survival.eatSeconds) return;
  eatingFor = 0;
  if (health.eat(food)) {
    pack.takeOne(selected);
    renderHotbar();
    renderVitals();
  }
}

/** The pause menu's part for the world's mode, and switching it. */
function modeMenu(panel: HTMLElement, refresh: () => void): void {
  el(panel, 'p', 'menu-help', survival ? 'Survival: you build with what you gather.' : 'Creative: every block, and flying.');
  button(el(panel, 'div', 'menu-row'), survival ? 'Switch to creative' : 'Switch to survival', () => {
    setMode(!survival);
    refresh();
  });
}

/**
 * Set a block (and its light), and remesh what changed at once. Open to others, it goes to them
 * too (`share`; not when it's a guest's edit, which the session shares as theirs).
 */
function edit(x: number, y: number, z: number, block: Block, share = true): void {
  const t0 = performance.now();
  const stale = world.setBlock(x, y, z, block);
  if (stale.length) saver.edited(world.getChunk(toChunk(x), toChunk(y), toChunk(z))!);
  for (const c of stale) loader.remesh(c.cx, c.cy, c.cz);
  // The water round it may flow now (in, out, or on), and the circuits round it change; a guest's
  // are the host's to run.
  if (stale.length && !guest) {
    flow.wake(x, y, z);
    logic.wake(x, y, z);
  }
  if (stale.length && share) {
    host?.shareEdits([[x, y, z, block]]);
    guest?.edit(x, y, z, block);
  }
  lastEdit = { ms: performance.now() - t0, lightMs: world.lightMs, chunks: stale.length };
}

/** A guest's edit, checked by the session: made as the host's would be, the torches a broken block held going too. */
function guestEdit(x: number, y: number, z: number, block: Block): void {
  const held = block === Block.Air ? torchesHeldBy(world, x, y, z) : [];
  edit(x, y, z, block, false);
  for (const [tx, ty, tz] of held) edit(tx, ty, tz, Block.Air);
}

/** The arm swings: the held block here, the avatar's arm for the others. */
function swing(): void {
  held.motion.swing();
  swings++;
}

/** A hit on a mob from (fromX, fromZ): knocked back (or gone in a puff on the last hit). This player's own (from where it stands) swings. */
function hitMob(mob: Mob, fromX = player.body.x, fromZ = player.body.z): void {
  if (!mobs) return;
  if (fromX === player.body.x && fromZ === player.body.z) swing();
  const b = mob.body;
  if (mobs.hit(mob, fromX, fromZ)) {
    const light = brightness(world.getLight(Math.floor(b.x), Math.floor(b.y + 0.5), Math.floor(b.z)), daylightNow);
    particles.puff(b.x, b.y, b.z, b.halfWidth, b.height, light);
    // In survival it leaves raw meat.
    if (survival) {
      const [least, most] = TUNING.survival.meat;
      const count = least + Math.floor(Math.random() * (most - least + 1));
      ground.drop(b.x, b.y + b.height / 2, b.z, { item: Item.RawMeat, count }, 0, TUNING.survival.ground.hop, 0);
    }
  }
}

/** Breaking (hold the left button) and placing (a click of the right one), once per frame. */
function editing(dt: number): void {
  const broken = mining.update(target, input.isHeld('Mouse0'), dt);
  if (broken) {
    const info = BLOCKS[broken.block];
    edit(broken.x, broken.y, broken.z, Block.Air);
    sound.play({ name: 'break', material: info.sound, gain: 1 });
    swing();
    particles.burst(broken.x, broken.y, broken.z, [info.top, info.side], brightness(world.getLight(broken.x, broken.y, broken.z), daylightNow));
    if (survival) gather(broken.block, broken.x, broken.y, broken.z);
    // A furnace broken: what's in it drops too (in survival), and it's forgotten.
    const kept = furnaceOf(broken.block) ? furnaces.remove(broken.x, broken.y, broken.z) : undefined;
    if (kept) {
      if (backpack.showing === kept) closeBackpack();
      if (survival) for (const s of kept.contents()) ground.drop(broken.x + 0.5, broken.y + 0.5, broken.z + 0.5, s, (Math.random() - 0.5) * 2, TUNING.survival.ground.hop, (Math.random() - 0.5) * 2);
    }
    // Torches go with the block they stood on or hung from (in survival, into the inventory).
    for (const [x, y, z] of torchesHeldBy(world, broken.x, broken.y, broken.z)) {
      if (survival) gather(world.getBlock(x, y, z), x, y, z, false);
      edit(x, y, z, Block.Air);
    }
  }
  if (input.take('Mouse2') && target) {
    // A switch, button or delay clicked is used (flipped, pressed, set to the next delay), not
    // built against; with Shift held it's built against as usual.
    const shift = input.isHeld('ShiftLeft') || input.isHeld('ShiftRight');
    const used = shift ? null : useBlock(target.block);
    // A furnace clicked in survival opens (a guest's furnaces are the host's: to come).
    if (survival && !guest && !shift && furnaceOf(target.block)) openBackpack(furnaces.at(target.x, target.y, target.z));
    else if (used !== null) {
      // A guest shows it at once and asks the host to use the block as the host has it.
      if (used !== target.block) {
        edit(target.x, target.y, target.z, used, !guest);
        guest?.use(target.x, target.y, target.z);
      }
      sound.play({ name: 'place', material: BLOCKS[target.block].sound, gain: 0.6 });
      swing();
    } else place(target);
  }
  eating(dt);
  cracks.show(mining.target, mining.stage);
}

/**
 * The selected block put against the face looked at: a torch on a top or a side, a thin logic block
 * on a top (a gate facing the way the player looks), both in air on a solid block; anything else
 * not inside the player (water and other passable blocks can go there).
 */
function place(target: RayHit): void {
  const x = target.x + target.nx;
  const y = target.y + target.ny;
  const z = target.z + target.nz;
  const selectedBlock = survival ? placeableIn(pack, selected) : hotbar[selected];
  if (selectedBlock === null) return;
  const block = isTorch(selectedBlock) ? torchFor(target.nx, target.ny, target.nz) : logicPlacement(selectedBlock, target.ny, input.yaw);
  if (block === null) return;
  const standing = isTorch(selectedBlock) || isThinLogic(selectedBlock);
  const fits = standing
    ? BLOCKS[world.getBlock(target.x, target.y, target.z)].opaque && world.getBlock(x, y, z) === Block.Air
    : BLOCKS[block].passable || !overlapsBlock(player.body, x, y, z);
  if (!fits) return;
  edit(x, y, z, block);
  sound.play({ name: 'place', material: BLOCKS[block].sound, gain: 1 });
  swing();
  if (survival) {
    pack.takeOne(selected);
    renderHotbar();
  }
}

window.addEventListener('keydown', (e) => {
  // M mutes and unmutes (a setting, so it's remembered).
  if (e.code === 'KeyM' && input.locked) {
    settings.muted = !settings.muted;
    saveSettings(settings);
    applySettings(settings);
  }
  // Q throws one of the selected item, Shift + Q all of it (survival).
  if (e.code === 'KeyQ' && input.locked && survival && !dead) throwSelected(e.shiftKey);
  // E or Tab opens and closes the block picker (creative) or the inventory (survival); Esc closes them too.
  if (e.code === 'KeyE' || e.code === 'Tab') {
    e.preventDefault();
    if (inventory.open) closeInventory();
    else if (backpack.open) closeBackpack();
    else if (input.locked) (survival ? openBackpack : openInventory)();
  } else if (e.code === 'Escape') {
    if (inventory.open) closeInventory();
    if (backpack.open) closeBackpack();
  }
  const n = Number(e.key);
  if (n >= 1 && n <= hotbar.length) {
    selected = n - 1;
    renderHotbar();
  }
});
window.addEventListener('wheel', (e) => {
  selected = (selected + Math.sign(e.deltaY) + hotbar.length) % hotbar.length;
  renderHotbar();
});
// Paused whenever the mouse isn't captured (at the start, and after Esc), except under `?autofly`.
const pauseMenu = new PauseMenu(
  document.body,
  record.name,
  guest ? { saved: false, note: `Playing in ${hostName}’s world: what you build stays in theirs.`, quitLabel: 'Leave' } : { saved: !unsaved },
  settings,
  {
    onPlay: () => input.lock(),
    onQuit: () => void quit(),
    onSettings: applySettings,
    together: togetherMenu,
    ...(guest ? {} : { mode: modeMenu }),
    keys: () => (survival ? SURVIVAL_KEYS : KEYS),
  },
);

/** The pause menu's part for playing together: who's in, and (for this world's owner) opening it to friends. */
function togetherMenu(panel: HTMLElement, refresh: () => void): void {
  const names = (host ?? guest)?.players.map((p) => p.name) ?? [];
  if (guest) {
    el(panel, 'p', 'menu-help', `Here: ${names.join(', ')}.`);
    return;
  }
  if (host) {
    el(panel, 'p', 'menu-code', `Open to friends · code ${host.code}`);
    el(panel, 'p', 'menu-help', names.length > 1 ? `Here: ${names.join(', ')}.` : 'Friends join with this code, from “Join a friend” in their world list.');
    button(el(panel, 'div', 'menu-row'), 'Close to friends', () => {
      closeToFriends();
      refresh();
    });
    return;
  }
  const row = el(panel, 'div', 'menu-row');
  button(row, 'Open to friends', () => {
    // A name to go by, then a code.
    panel.replaceChildren();
    const status = el(panel, 'p', 'menu-help', 'Up to three friends can join. The world stays yours, saved here.');
    const open = async () => {
      const name = cleanName(nameInput.value);
      if (!name) return void (status.textContent = 'Give yourself a name.');
      settings.name = name;
      saveSettings(settings);
      status.textContent = 'Opening…';
      openButton.disabled = true;
      try {
        const { openRoom } = await import('./net/link');
        openToFriends(await openRoom());
      } catch (e) {
        status.textContent = e instanceof Error ? e.message : 'Couldn’t open the world to friends.';
        openButton.disabled = false;
        return;
      }
      refresh();
    };
    const nameInput = field(panel, 'Your name', settings.name, '', () => void open(), refresh);
    nameInput.maxLength = 16;
    const actions = el(panel, 'div', 'menu-row');
    const openButton = button(actions, 'Open', () => void open(), 'menu-go');
    button(actions, 'Cancel', refresh);
    nameInput.select();
  });
}
applySettings(settings);
const paused = () => !input.locked && !autofly;
// The picker frees the mouse too, without the pause menu.
const showPause = () => (pauseMenu.visible = paused() && !inventory.open && !backpack.open && !dead);
document.addEventListener('pointerlockchange', showPause);
showPause();

// --- Loop ----------------------------------------------------------------------------------

let last = performance.now();
/** Where the feet were last frame, for footsteps. */
let lastFeet = { x: player.body.x, z: player.body.z };
let fps = 60;

function frame(now: number): void {
  const start = performance.now();
  renderer.info.reset();
  const interval = now - last;
  const dt = Math.min(interval / 1000, 0.1);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  // Paused: the player and the clock stand still; the world goes on loading.
  if (autofly?.active) autofly.update(now, dt, interval);
  else if (!paused()) {
    player.update(dt);
    if (survival) live(dt);
    // Footsteps, landing, splashing and digging, from how the player moved this frame.
    const b = player.body;
    const moved = Math.hypot(b.x - lastFeet.x, b.z - lastFeet.z);
    const digging = mining.target ? BLOCKS[mining.target.block].sound : null;
    const ground = underfoot(world, b.x, b.y, b.z);
    for (const e of cues.frame({ dt, moved, vy: b.vy, onGround: b.onGround, flying: player.flying, inWater: b.inWater, ground, digging })) {
      sound.play(e);
      // Each digging hit knocks a few chips off the face being dug.
      if (e.name === 'dig') swing();
      if (e.name === 'dig' && target) {
        const t = target;
        const info = BLOCKS[t.block];
        particles.chips(t.x, t.y, t.z, t.nx, t.ny, t.nz, [info.top, info.side], brightness(world.getLight(t.x + t.nx, t.y + t.ny, t.z + t.nz), daylightNow));
      }
    }
    particles.step(dt, (x, y, z) => !BLOCKS[world.getBlock(x, y, z)].passable);
    // The held block bobs with the steps walked on the ground.
    held.motion.update(dt, b.onGround && !player.flying ? moved : 0);
  }
  lastFeet = { x: player.body.x, z: player.body.z };
  if (!timeHeld && worldRuns()) time = (time + dt / TUNING.day.length) % 1;
  const sky = skyAt(time);
  daylightNow = sky.daylight;
  particleMesh.update();
  groundView.update(ground.items, (x, y, z) => brightness(world.getLight(Math.floor(x), Math.floor(y), Math.floor(z)), daylightNow), now / 1000);
  chunks.setSunlight(sky.sunlight);
  chunks.setWaterFlow(waterFlow(now / 1000, TUNING.water.flow));
  // The air of the biomes here, tinting the horizon (fog, background and sky dome alike).
  const air = blendFog(world.generator.climate.weights(camera.position.x, camera.position.z));
  fog = fog ? easeFog(fog, air, dt, TUNING.fog.ease) : air;
  const horizon = fogColour(sky.colour, fog, sky.daylight);
  const distance = TUNING.view.radius * CHUNK_SIZE;
  waterView.setRange(distance * fog.start, distance * 0.95);
  waterView.update(player.eyeInWater, horizon, sky.daylight);
  skyDome.update(camera, { ...sky, colour: horizon }, TUNING.sky.glow, player.eyeInWater);
  clouds.update(camera, now / 1000, TUNING.sky.cloudWind, sky.clouds, TUNING.view.radius * CHUNK_SIZE, player.eyeInWater);
  const dir = player.direction();
  loader.update(camera.position.x, camera.position.y, camera.position.z, dir.x, dir.z);

  if (!guest && worldRuns()) {
    flowWater(dt);
    tickLogic(dt);
    tickFurnaces(dt);
  }
  backpack.tick();
  // Items on the ground fall and settle, and are picked up by a survival player within reach.
  if (ground.items.length && worldRuns())
    ground.update(dt, world, (x, z) => world.hasColumn(toChunk(Math.floor(x)), toChunk(Math.floor(z))), survival && !dead && !player.waiting ? [player.body] : [], pickUp);
  // `?flood=guest` waits for a guest to be in, to measure what the water sends.
  circuit?.update(now, interval, player.body.x, player.body.y, player.body.z, player.waiting);
  flood?.update(now, interval, player.body.x, player.body.z, player.waiting || (params.get('flood') === 'guest' && (host?.players.length ?? 0) < 2));
  target = raycast(world, camera.position, dir, TUNING.edit.reach);
  // A mob nearer than the block looked at takes the left button instead: hit, not dug (and no
  // outline on the block behind it).
  const shown = mobs?.mobs ?? guest?.mobs.mobs;
  const aimed = shown && !paused() ? mobOnRay(shown, camera.position, dir, target ? target.distance : TUNING.edit.reach) : null;
  if (aimed) target = null;
  if (input.take('Mouse0') && aimed) {
    // A guest's hit is the host's to make: the knockback and any puff come back with the mobs.
    if (guest) {
      swing();
      guest.hit(aimed.mob.id);
    } else hitMob(aimed.mob);
  }
  editing(dt);
  // The mobs think and move (not while paused), then are drawn where they are.
  if (mobs && mobView) {
    mobs.update(worldRuns() ? dt : 0, mobPlayers(), daylightNow);
    if (showcase && !player.waiting) {
      mobs.showcase(player.body.x, player.body.y, player.body.z, input.yaw);
      showcase = false;
    }
    mobView.update(mobs, world, daylightNow, now / 1000);
    const p = camera.position;
    for (const s of mobs.takeSounds()) {
      const h = heard(s.x, s.y + 0.5, s.z, p.x, p.y, p.z, input.yaw);
      if (h) sound.play({ name: 'mob', voice: s.voice, kind: s.kind, ...h });
      if (host) mobSoundsOut.push(s);
    }
  }
  // A guest's mobs, where the host's snapshots put them.
  if (guest && mobView) {
    guest.mobs.update(guest.clock());
    mobView.update(guest.mobs, world, daylightNow, now / 1000);
  }
  playTogether(now);
  outline.visible = target !== null;
  if (target) outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);

  const p = camera.position;
  info.textContent =
    `${Math.round(fps)} fps · ${paused() ? 'paused' : player.waiting ? 'waiting for the ground to load' : player.flying ? 'flying' : 'walking'} · ` +
    `xyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · ` +
    `chunk ${toChunk(Math.floor(p.x))} ${toChunk(Math.floor(p.y))} ${toChunk(Math.floor(p.z))} · ` +
    `${world.chunks.size} chunks, ${Math.round(chunks.triangles / 1000)}k tris` +
    (loader.pending ? ` · loading ${loader.pending}` : '') +
    (target ? ` · ${BLOCKS[target.block].name}` : '');

  stats.gpuBegin();
  renderer.render(scene, camera);
  const eye = camera.position;
  const eyeLight = world.getLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
  // A tool or a stick is held as its picture made solid; a block as a block.
  const heldItem = survival ? pack.slots[selected]?.item : undefined;
  const art = heldItem === undefined || isBlockItem(heldItem) ? null : artOf(heldItem);
  if (art) held.setItem(heldItem!, art, brightness(eyeLight, daylightNow));
  else held.set(heldBlock(), eyeLight, sky.sunlight);
  held.render(renderer, camera.aspect, !autofly);
  stats.gpuEnd();
  const work = performance.now() - start;
  stats.frame(now, interval, work, player.physicsMs, player.physicsSteps);
  autofly?.frameWork(work);
  requestAnimationFrame(frame);
}

// --- Settings ----------------------------------------------------------------------------------

/**
 * Settings take effect at once: the view distance (unless `?radius` holds it) moves the
 * loader's radius, the fog and the far plane; field of view, resolution, the mouse and the
 * volume. Antialiasing waits for the next world opened.
 */
function applySettings(s: Settings): void {
  if (renderer.getPixelRatio() !== pixelRatio(s)) renderer.setPixelRatio(pixelRatio(s));
  if (!radiusHeld && s.viewDistance !== TUNING.view.radius) {
    TUNING.view.radius = s.viewDistance;
    loader.radiusChanged();
  }
  const distance = TUNING.view.radius * CHUNK_SIZE;
  camera.far = distance * 1.5;
  camera.fov = s.fov;
  camera.updateProjectionMatrix();
  TUNING.fly.mouseSensitivity = s.sensitivity / 1000;
  input.invertY = s.invertY;
  sound.setVolume(s.volume, s.muted);
}

// --- Saving ----------------------------------------------------------------------------------

/** Where the player is, to come back to (dead: where they'll start again). */
function playerState(): PlayerState {
  const { x, y, z } = dead ? spawnFeet : player.body;
  return { x, y, z, yaw: input.yaw, pitch: input.pitch, flying: player.flying };
}

/** What a guest last sent the host of its survival state (as JSON), so it's sent only when it changes. */
let keptSent = '';

/** A guest's survival state to the host, if it changed, for it to keep (and give back next time). */
function sendKept(): void {
  if (!guest || !survival) return;
  const state = { inventory: pack.toJSON(), health: health.toJSON() };
  const json = JSON.stringify(state);
  if (json === keptSent) return;
  keptSent = json;
  guest.keep(state);
}

/** The record saved: where the player is, the time, and in it the survival inventory and health as they are. */
function saveRecord(): Promise<void> {
  survivalRecord.health = health.toJSON();
  record.furnaces = furnaces.toJSON();
  return saver.saveRecord(playerState(), time);
}

// Edited chunks go within TUNING.save.delayMs of an edit (`saver.edited`); where the player is
// and the time, every TUNING.save.recordIntervalMs; everything when the page is hidden or left.
setInterval(() => {
  if (!autofly?.active) void saveRecord();
}, TUNING.save.recordIntervalMs);
function saveAll(): void {
  void saver.writeDirty();
  void saveRecord();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveAll();
});
window.addEventListener('pagehide', () => {
  saveAll();
  // Tell the others at once, rather than leaving them to notice the silence.
  sendKept();
  guest?.leave();
  host?.close('The host left.');
});

/** Write everything, then back to the world list (a guest just leaves; a host's friends are sent home). */
async function quit(): Promise<void> {
  if (guest) {
    sendKept();
    guest.leave();
    location.href = location.pathname;
    return;
  }
  closeToFriends();
  pauseMenu.quitting();
  await saver.writeDirty();
  await saveRecord();
  location.href = location.pathname;
}

/** IndexedDB, or (where it's unavailable, as in some private windows) memory, with a warning. */
async function openStore(): Promise<WorldStore> {
  try {
    return await IndexedDbStore.open();
  } catch (e) {
    console.warn('Saving is off, the world will be lost on reload:', e);
    return new MemoryStore();
  }
}

renderHotbar();
renderVitals();
// `?bot` (`?bot=3`: up to three): open to the test guests now that everything is made.
if (network) {
  const room = network.room('BOT1');
  openToFriends(room);
  const count = Math.min(3, Math.max(1, Number(params.get('bot')) || 1));
  for (let i = 0; i < count; i++)
    bots.push(new Bot(room, world, [player.body.x, player.body.z], () => performance.now() / 1000, count > 1 ? `Bot ${i + 1}` : 'Bot', 6 + i * 4));
}
requestAnimationFrame(frame);
