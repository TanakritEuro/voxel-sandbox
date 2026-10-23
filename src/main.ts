// Entry point: world, chunk loading, fly camera, block editing and the HUD.

import * as THREE from 'three';
import { Autofly } from './autofly';
import { ChunkLoader } from './chunkLoader';
import { TUNING } from './config';
import { FlyCamera } from './player';
import { ChunkRenderer } from './render/chunkRenderer';
import { Stats } from './stats';
import { WorkerPool } from './workers/pool';
import { Block, BLOCKS, HOTBAR } from './world/blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, toChunk } from './world/coords';
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

const world = new World(seed);
const chunks = new ChunkRenderer();
scene.add(chunks.group);
const pool = new WorkerPool();
const loader = new ChunkLoader(world, chunks, pool);
const fly = new FlyCamera(camera, canvas);

// Spawn above dry land near the origin.
const spawn = world.generator.findLand(0, 0);
camera.position.set(spawn.x + 0.5, world.generator.height(spawn.x, spawn.z) + 12, spawn.z + 0.5);

// Measuring: `?stats` overlay (F3), `?autofly` scripted flight.
const autoflySeconds = Autofly.seconds(params);
const stats = new Stats(
  renderer,
  () => ({
    chunks: world.chunks.size,
    meshed: chunks.count,
    queued: loader.queued,
    inFlight: loader.inFlight,
    workerBusy: pool.busy(),
    chunkBytes: world.chunks.size * CHUNK_VOLUME,
    geometryBytes: chunks.bytes,
    sceneTriangles: chunks.triangles,
  }),
  params.has('stats') || autoflySeconds !== null,
);
const autofly =
  autoflySeconds === null
    ? null
    : new Autofly(fly, loader, autoflySeconds, (report, text) => {
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

// --- Editing -----------------------------------------------------------------------------

let selected = 0;
let target: RayHit | null = null;

function renderHotbar(): void {
  hotbarEl.innerHTML = HOTBAR.map((b, i) => {
    const [r, g, bl] = BLOCKS[b].top.map((c) => Math.round(c * 255));
    return `<div class="slot${i === selected ? ' selected' : ''}" title="${BLOCKS[b].name}"><span style="background: rgb(${r},${g},${bl})"></span><em>${i + 1}</em></div>`;
  }).join('');
}

function edit(x: number, y: number, z: number, block: Block): void {
  for (const c of world.setBlock(x, y, z, block)) loader.remesh(c.cx, c.cy, c.cz);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (!fly.locked || !target) return;
  if (e.button === 0) edit(target.x, target.y, target.z, Block.Air);
  if (e.button === 2) {
    const x = target.x + target.nx;
    const y = target.y + target.ny;
    const z = target.z + target.nz;
    const p = camera.position;
    const inCamera = x === Math.floor(p.x) && y === Math.floor(p.y) && z === Math.floor(p.z);
    if (!inCamera) edit(x, y, z, HOTBAR[selected]);
  }
});
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
  help.hidden = fly.locked;
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
  else fly.update(dt);
  loader.update(camera.position.x, camera.position.z);

  const dir = fly.direction();
  target = raycast(world, camera.position, dir, TUNING.edit.reach);
  outline.visible = target !== null;
  if (target) outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);

  const p = camera.position;
  info.textContent =
    `${Math.round(fps)} fps · xyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · ` +
    `chunk ${toChunk(Math.floor(p.x))} ${toChunk(Math.floor(p.y))} ${toChunk(Math.floor(p.z))} · ` +
    `${world.chunks.size} chunks, ${Math.round(chunks.triangles / 1000)}k tris` +
    (loader.pending ? ` · loading ${loader.pending}` : '') +
    (target ? ` · ${BLOCKS[target.block].name}` : '');

  renderer.render(scene, camera);
  const work = performance.now() - start;
  stats.frame(now, interval, work);
  autofly?.frameWork(work);
  requestAnimationFrame(frame);
}

renderHotbar();
requestAnimationFrame(frame);
