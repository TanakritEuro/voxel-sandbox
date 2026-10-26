// Entry point: world, chunk loading, the player, block editing and the HUD.

import * as THREE from 'three';
import { Autofly } from './autofly';
import { ChunkLoader } from './chunkLoader';
import { TUNING } from './config';
import { Input } from './input';
import { Player } from './player';
import { textureIcon } from './render/blockMaterial';
import { ChunkRenderer } from './render/chunkRenderer';
import { CrackOverlay } from './render/crack';
import { WaterView } from './render/water';
import { Stats } from './stats';
import { WorkerPool } from './workers/pool';
import { Block, BLOCKS, HOTBAR } from './world/blocks';
import { CHUNK_SIZE, toChunk } from './world/coords';
import { Mining } from './world/mining';
import { overlapsBlock } from './world/physics';
import { raycast, type RayHit } from './world/raycast';
import { World } from './world/world';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? TUNING.world.seed);
// `?radius=8` overrides the view radius, for measuring.
const radiusParam = Number(params.get('radius'));
if (Number.isInteger(radiusParam) && radiusParam > 0) TUNING.view.radius = radiusParam;

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const info = document.querySelector<HTMLDivElement>('#info')!;
const hotbarEl = document.querySelector<HTMLDivElement>('#hotbar')!;
const help = document.querySelector<HTMLDivElement>('#help')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

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

const world = new World(seed);
// `?light` shows light as grey instead of textures.
const chunks = new ChunkRenderer(params.has('light'));
scene.add(chunks.group);
// `?workers=1` runs fewer workers, to see how a machine with fewer cores loads.
const workersParam = Number(params.get('workers'));
const pool = new WorkerPool(Number.isInteger(workersParam) && workersParam > 0 ? workersParam : undefined);
const loader = new ChunkLoader(world, chunks, pool);
const input = new Input(canvas);

/** Are the columns around (x, z) loaded? The player holds still until they are. */
function columnsLoaded(x: number, z: number): boolean {
  const cx = toChunk(Math.floor(x));
  const cz = toChunk(Math.floor(z));
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!world.hasColumn(cx + dx, cz + dz)) return false;
  return true;
}

// Spawn standing on dry land near the origin, or near `?at=x,z`.
const [atX, atZ] = (params.get('at') ?? '0,0').split(',').map((v) => Math.floor(Number(v)) || 0);
const spawn = world.generator.findLand(atX, atZ ?? 0);
const player = new Player(camera, input, world, columnsLoaded, {
  x: spawn.x + 0.5,
  y: world.generator.height(spawn.x, spawn.z) + 1,
  z: spawn.z + 0.5,
});

// Measuring: `?stats` overlay (F3), `?autofly` scripted flight.
const autoflySeconds = Autofly.seconds(params);
const stats = new Stats(
  renderer,
  () => ({
    chunks: world.chunks.size,
    visible: loader.visibleChunks,
    meshed: chunks.count,
    queued: loader.queued,
    inFlight: loader.inFlight,
    workerBusy: pool.busy(),
    chunkBytes: world.blockBytes,
    lightBytes: world.lightBytes,
    geometryBytes: chunks.bytes,
    sceneTriangles: chunks.triangles,
    lastEdit,
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

/** Each hotbar block shown by its icon, or else its side texture. */
const hotbarIcons = HOTBAR.map((b) => textureIcon(BLOCKS[b].icon ?? BLOCKS[b].textures.side));

function renderHotbar(): void {
  hotbarEl.innerHTML = HOTBAR.map(
    (b, i) =>
      `<div class="slot${i === selected ? ' selected' : ''}" title="${BLOCKS[b].name}"><span style="background-image: url(${hotbarIcons[i]})"></span><em>${i + 1}</em></div>`,
  ).join('');
}

/** Set a block (and its light), and remesh what changed at once. */
function edit(x: number, y: number, z: number, block: Block): void {
  const t0 = performance.now();
  const stale = world.setBlock(x, y, z, block);
  for (const c of stale) loader.remesh(c.cx, c.cy, c.cz);
  lastEdit = { ms: performance.now() - t0, lightMs: world.lightMs, chunks: stale.length };
}

/** Breaking (hold the left button) and placing (a click of the right one), once per frame. */
function editing(dt: number): void {
  const broken = mining.update(target, input.isHeld('Mouse0'), dt);
  if (broken) {
    edit(broken.x, broken.y, broken.z, Block.Air);
    // A torch goes with the block it stood on.
    if (world.getBlock(broken.x, broken.y + 1, broken.z) === Block.Torch) edit(broken.x, broken.y + 1, broken.z, Block.Air);
  }
  if (input.take('Mouse2') && target) {
    const x = target.x + target.nx;
    const y = target.y + target.ny;
    const z = target.z + target.nz;
    const block = HOTBAR[selected];
    // Not inside the player (water and other passable blocks can go there); torches only on
    // top of a solid block, in air.
    const torchFits = BLOCKS[world.getBlock(x, y - 1, z)].opaque && world.getBlock(x, y, z) === Block.Air;
    if (block === Block.Torch ? torchFits : BLOCKS[block].passable || !overlapsBlock(player.body, x, y, z)) edit(x, y, z, block);
  }
  cracks.show(mining.target, mining.stage);
}
window.addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= HOTBAR.length) {
    selected = n - 1;
    renderHotbar();
  }
});
window.addEventListener('wheel', (e) => {
  selected = (selected + Math.sign(e.deltaY) + HOTBAR.length) % HOTBAR.length;
  renderHotbar();
});
document.addEventListener('pointerlockchange', () => {
  help.hidden = input.locked;
});

// --- Loop ----------------------------------------------------------------------------------

let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const start = performance.now();
  const interval = now - last;
  const dt = Math.min(interval / 1000, 0.1);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  if (autofly?.active) autofly.update(now, dt, interval);
  else player.update(dt);
  waterView.update(player.eyeInWater);
  const dir = player.direction();
  loader.update(camera.position.x, camera.position.y, camera.position.z, dir.x, dir.z);

  target = raycast(world, camera.position, dir, TUNING.edit.reach);
  editing(dt);
  outline.visible = target !== null;
  if (target) outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);

  const p = camera.position;
  info.textContent =
    `${Math.round(fps)} fps · ${player.waiting ? 'waiting for the ground to load' : player.flying ? 'flying' : 'walking'} · ` +
    `xyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · ` +
    `chunk ${toChunk(Math.floor(p.x))} ${toChunk(Math.floor(p.y))} ${toChunk(Math.floor(p.z))} · ` +
    `${world.chunks.size} chunks, ${Math.round(chunks.triangles / 1000)}k tris` +
    (loader.pending ? ` · loading ${loader.pending}` : '') +
    (target ? ` · ${BLOCKS[target.block].name}` : '');

  renderer.render(scene, camera);
  const work = performance.now() - start;
  stats.frame(now, interval, work, player.physicsMs, player.physicsSteps);
  autofly?.frameWork(work);
  requestAnimationFrame(frame);
}

renderHotbar();
requestAnimationFrame(frame);
