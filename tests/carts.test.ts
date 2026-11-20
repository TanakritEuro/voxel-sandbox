import { afterEach, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { RECIPES } from '../src/survival/crafting';
import { Item } from '../src/survival/items';
import { Block, poweredRail, railOf } from '../src/world/blocks';
import { RAIL_ENDS, railPlacement } from '../src/world/rails';
import { putOnRail, railLength, railPoint, railTangent, stepCart } from '../src/vehicles/cart';
import { VehicleManager } from '../src/vehicles/manager';
import { createVehicle, VehicleKind } from '../src/vehicles/vehicle';
import { Grid } from './grid';

/** A grid that's a vehicle world too: every column loaded unless listed as gone. */
class Ground extends Grid {
  gone = new Set<string>();
  hasColumn(cx: number, cz: number): boolean {
    return !this.gone.has(`${cx},${cz}`);
  }
}

function lay(grid: Grid, places: readonly [number, number, number][], kind: Block = Block.Rail): void {
  for (const [x, y, z] of places) for (const [px, py, pz, pb] of railPlacement(grid, x, y, z, kind, 0)) grid.set(px, py, pz, pb);
}

/** A straight line of rails along x from x0 to x1 at height 1 on a floor. */
function line(x0: number, x1: number, kind: Block = Block.Rail): Ground {
  const g = new Ground().floor(x0 - 2, x1 + 2, -2, 2);
  lay(g, Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, 1, 0] as [number, number, number]), kind);
  return g;
}

/** A cart on the rail at (x, y, z), going `speed` along x (+ towards +x). */
function cartAt(grid: Grid, x: number, y: number, z: number, speed = 0) {
  const v = createVehicle(1, VehicleKind.Cart, x + 0.5, y, z + 0.5);
  v.body.vx = speed;
  expect(putOnRail(v, grid, x, y, z)).toBe(true);
  return v;
}

const STEP = TUNING.vehicles.step;
const saved = { ...TUNING.vehicles };
afterEach(() => Object.assign(TUNING.vehicles, saved));

describe("a rail's path", () => {
  it('runs from the middle of one end to the other, its tangent along it, slopes rising a block, curves a quarter circle', () => {
    for (let shape = 0; shape < 10; shape++) {
      const L = railLength(shape);
      const [e0, e1] = RAIL_ENDS[shape];
      const mid = (d: number) => [d === 0 ? 1 : d === 1 ? 0 : 0.5, d === 2 ? 1 : d === 3 ? 0 : 0.5];
      const [a, , b] = railPoint(shape, 0);
      const [c, , d] = railPoint(shape, L);
      expect([a, b]).toEqual(mid(e0).map((n) => expect.closeTo(n, 9)));
      expect([c, d]).toEqual(mid(e1).map((n) => expect.closeTo(n, 9)));
      // Each little step along it is its length times the tangent.
      for (let k = 0; k < 10; k++) {
        const s = (L * k) / 10;
        const p = railPoint(shape, s);
        const q = railPoint(shape, s + L / 1000);
        const t = railTangent(shape, s);
        expect(Math.hypot(...t)).toBeCloseTo(1, 9);
        for (let i = 0; i < 3; i++) expect((q[i] - p[i]) / (L / 1000)).toBeCloseTo(t[i], 2);
      }
    }
    expect(railPoint(2, 0)[1]).toBeCloseTo(1, 9); // rising towards +x, its first end
    expect(railPoint(2, railLength(2))[1]).toBeCloseTo(0, 9);
    expect(railLength(6)).toBeCloseTo(Math.PI / 4, 9);
  });
});

describe('carts on rails', () => {
  it('roll about a hundred blocks on the level from top speed, then stop', () => {
    const g = line(0, 220);
    const v = cartAt(g, 1, 1, 0, TUNING.vehicles.cart.max);
    for (let t = 0; t < 120 && v.speed !== 0; t += STEP) stepCart(v, g);
    expect(v.speed).toBe(0);
    expect(v.body.x).toBeGreaterThan(80);
    expect(v.body.x).toBeLessThan(130);
    expect(v.rail).not.toBe(null);
  });

  it('stop at a dead end, at its end', () => {
    const g = line(0, 10);
    const v = cartAt(g, 2, 1, 0, 6);
    for (let t = 0; t < 5; t += STEP) stepCart(v, g);
    expect(v.speed).toBe(0);
    expect(v.body.x).toBeCloseTo(11, 5);
  });

  it('roll down a slope from a standstill, faster for the drop', () => {
    // Level at y 3 for x < 0, a slope a block down at each of x 0..2 (stairs of floor), level at y 0 after.
    const g = new Ground();
    for (let x = -4; x <= 12; x++) {
      const top = x < 0 ? 3 : x <= 2 ? 2 - x : -1;
      for (let z = -1; z <= 1; z++) g.set(x, top, z, Block.Stone);
    }
    const places: [number, number, number][] = [];
    for (let x = -3; x <= 12; x++) places.push([x, x < 0 ? 4 : x <= 2 ? 3 - x : 0, 0]);
    lay(g, places);
    expect([0, 1, 2].map((x) => railOf(g.getBlock(x, 3 - x, 0))!.shape)).toEqual([3, 3, 3]); // rising towards -x
    const v = cartAt(g, -1, 4, 0, 0.5);
    let fastest = 0;
    for (let t = 0; t < 4; t += STEP) {
      stepCart(v, g);
      fastest = Math.max(fastest, v.speed);
    }
    // Three blocks down: well past the push it was given.
    expect(fastest).toBeGreaterThan(4);
    expect(v.body.y).toBeCloseTo(0, 5);
  });

  it('keep to the rails round a loop at top speed, pushed by powered rails that are on, braked by those that are off', () => {
    const g = new Ground().floor(-12, 12, -12, 12);
    const ring: [number, number, number][] = [];
    for (let x = -8; x < 8; x++) ring.push([x, 1, -5]);
    for (let z = -5; z < 5; z++) ring.push([8, 1, z]);
    for (let x = 8; x > -8; x--) ring.push([x, 1, 5]);
    for (let z = 5; z > -5; z--) ring.push([-8, 1, z]);
    lay(g, ring);
    // Powered rails on, along a stretch of the near side.
    for (let x = -4; x <= 4; x++) g.set(x, 1, -5, poweredRail(1, true)); // straight along x, on
    const v = cartAt(g, -6, 1, -5, 2);
    let laps = 0;
    let lastX = v.body.x;
    let slowest = Infinity;
    for (let t = 0; t < 40; t += STEP) {
      stepCart(v, g);
      expect(v.rail).not.toBe(null);
      // Never off the ring: on its rectangle's edge.
      const onEdge = Math.abs(Math.abs(v.body.z - 0.5) - 5.5) < 1 || Math.abs(Math.abs(v.body.x - 0.5) - 8) < 1;
      expect(onEdge).toBe(true);
      if (t > 5) slowest = Math.min(slowest, Math.abs(v.speed));
      if (lastX < 0 && v.body.x >= 0 && v.body.z < 0) laps++;
      lastX = v.body.x;
    }
    expect(laps).toBeGreaterThan(3);
    expect(slowest).toBeGreaterThan(2);
    // The same powered rails off: it stops on them.
    for (let x = -4; x <= 4; x++) g.set(x, 1, -5, poweredRail(1, false));
    for (let t = 0; t < 30 && v.speed !== 0; t += STEP) stepCart(v, g);
    expect(v.speed).toBe(0);
    expect(v.body.x).toBeGreaterThan(-5);
    expect(v.body.x).toBeLessThan(6);
    expect(v.body.z).toBeCloseTo(-4.5, 5);
  });

  it('start off a powered rail that is on, away from a dead end; and a rider pushes one off from a standstill', () => {
    const g = line(0, 30);
    g.set(0, 1, 0, poweredRail(1, true));
    const v = cartAt(g, 0, 1, 0);
    for (let t = 0; t < 2; t += STEP) stepCart(v, g);
    // (Speed is along the rail's path, from its first end, +x, to its second: going +x is backwards along it.)
    expect(Math.abs(v.speed)).toBeGreaterThan(1);
    expect(v.body.x).toBeGreaterThan(2);
    const w = cartAt(g, 20, 1, 0);
    for (let t = 0; t < 0.5; t += STEP) stepCart(w, g, STEP, [-1, 0]);
    expect(w.body.x).toBeLessThan(20.3); // the way the rider looks: -x
    expect(Math.abs(w.speed)).toBeGreaterThan(0.5);
    expect(Math.abs(w.speed)).toBeLessThanOrEqual(TUNING.vehicles.cart.pushUpTo + 1e-9);
  });

  it('fall and slide off rails, and land back on one', () => {
    const g = line(0, 10);
    const v = createVehicle(1, VehicleKind.Cart, 5.5, 4, 0.5);
    for (let t = 0; t < 2; t += STEP) stepCart(v, g);
    expect(v.rail).toMatchObject({ x: 5, y: 1, z: 0 });
  });
});

describe('the vehicle manager', () => {
  it('steps the same however the frames fall', () => {
    const run = (frames: number[]) => {
      const g = line(0, 100);
      const m = new VehicleManager(g);
      const v = m.placeCart(VehicleKind.Cart, 3, 1, 0, -Math.PI / 2)!;
      v.speed = 5;
      for (const dt of frames) m.update(dt);
      return [v.body.x, v.speed];
    };
    expect(run(Array(120).fill(1 / 60))).toEqual(run(Array(60).fill(1 / 30)));
  });

  it('puts carts only on rails, up to the most a world has; a chest cart carries 27 slots and is never ridden', () => {
    const g = line(0, 10);
    const m = new VehicleManager(g);
    expect(m.placeCart(VehicleKind.Cart, 3, 2, 0, 0)).toBe(null); // no rail there
    const cart = m.placeCart(VehicleKind.Cart, 3, 1, 0, 0)!;
    const chest = m.placeCart(VehicleKind.ChestCart, 6, 1, 0, 0)!;
    expect(chest.slots!.size).toBe(27);
    expect(m.ride(chest, 0)).toBe(false);
    expect(m.ride(cart, 0)).toBe(true);
    expect(m.ride(cart, 1)).toBe(false); // taken
    expect(m.ridden(0)).toBe(cart);
    m.leave(0);
    expect(cart.rider).toBe(-1);
    TUNING.vehicles.most = 2;
    expect(m.placeCart(VehicleKind.Cart, 8, 1, 0, 0)).toBe(null);
  });

  it('breaks one after three hits close together (one in creative), giving it back, a chest cart its contents too', () => {
    const g = line(0, 10);
    const m = new VehicleManager(g);
    const cart = m.placeCart(VehicleKind.Cart, 3, 1, 0, 0)!;
    expect(m.hit(cart)).toBe(null);
    m.update(TUNING.vehicles.hitMemory + 1); // forgotten
    expect(m.hit(cart)).toBe(null);
    expect(m.hit(cart)).toBe(null);
    expect(m.hit(cart)).toEqual([{ item: Item.Cart, count: 1 }]);
    expect(m.vehicles).toEqual([]);
    const chest = m.placeCart(VehicleKind.ChestCart, 5, 1, 0, 0)!;
    chest.slots!.slots[4] = { item: Item.Coal, count: 9 };
    expect(m.hit(chest, true)).toEqual([
      { item: Item.ChestCart, count: 1 },
      { item: Item.Coal, count: 9 },
    ]);
    expect(RECIPES.find((r) => r.makes === Item.Cart)).toMatchObject({ count: 1, cost: [[Item.Iron, 5]] });
    expect(RECIPES.find((r) => r.makes === Item.ChestCart)).toMatchObject({ cost: [[Item.Cart, 1], [Block.Chest, 1]] });
  });

  it('stores carts when their column unloads (not one being ridden) and gives them back when it loads', () => {
    const g = line(0, 40);
    const m = new VehicleManager(g);
    const v = m.placeCart(VehicleKind.ChestCart, 35, 1, 0, 0)!;
    v.slots!.slots[0] = { item: Item.Iron, count: 3 };
    const ridden = m.placeCart(VehicleKind.Cart, 36, 1, 0, 0)!;
    m.ride(ridden, 0);
    g.gone.add('1,0');
    m.update(STEP);
    expect(m.vehicles).toEqual([ridden]);
    expect(m.count).toBe(2);
    g.gone.clear();
    m.columnLoaded(1, 0);
    const back = m.vehicles.find((x) => x.kind === VehicleKind.ChestCart)!;
    expect(back.rail).toMatchObject({ x: 35, y: 1, z: 0 });
    expect(back.slots!.slots[0]).toEqual({ item: Item.Iron, count: 3 });
  });

  it('saves and loads them all, here and stored, cleaning what was saved', () => {
    const g = line(0, 10);
    const m = new VehicleManager(g);
    const v = m.placeCart(VehicleKind.Cart, 3, 1, 0, 0)!;
    v.speed = 4;
    const saved = JSON.parse(JSON.stringify(m.records()));
    const n = new VehicleManager(g);
    n.load([...saved, { kind: 9, x: 0, y: 0, z: 0 }, { kind: VehicleKind.Cart, x: 'a', y: 1, z: 1 }, null, { kind: VehicleKind.Cart, x: 1, y: 2, z: 3, speed: 999, rail: [1, 2] }]);
    expect(n.count).toBe(2);
    n.columnLoaded(0, 0);
    const [a, b] = n.vehicles;
    expect(a.rail).toMatchObject({ x: 3, y: 1, z: 0 });
    expect(a.speed).toBe(4);
    expect(b.rail).toBe(null);
    expect(b.speed).toBe(TUNING.vehicles.cart.max);
    const o = new VehicleManager(g);
    o.load('junk');
    expect(o.count).toBe(0);
  });
});
