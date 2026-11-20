import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { RECIPES } from '../src/survival/crafting';
import { Item } from '../src/survival/items';
import { Block } from '../src/world/blocks';
import { toChunk } from '../src/world/coords';
import { stepBoat, surfaceAt, waterOnRay } from '../src/vehicles/boat';
import { VehicleManager } from '../src/vehicles/manager';
import { createVehicle, seatHeight, VehicleKind } from '../src/vehicles/vehicle';
import { Grid } from './grid';

const B = TUNING.vehicles.boat;
const STEP = TUNING.vehicles.step;

/** A pool of still water 3 deep (surface at y 3) over x0..x1, z -6..6, on stone, with stone round it up to y 4. */
function pool(x0 = -10, x1 = 30): Grid & { hasColumn(): boolean } {
  const g = Object.assign(new Grid(), { hasColumn: () => true });
  for (let x = x0 - 1; x <= x1 + 1; x++)
    for (let z = -7; z <= 7; z++) {
      g.set(x, -1, z, Block.Stone);
      const wall = x < x0 || x > x1 || Math.abs(z) > 6;
      for (let y = 0; y < 3; y++) g.set(x, y, z, wall ? Block.Stone : Block.Water);
      if (wall) g.set(x, 3, z, Block.Stone);
    }
  return g;
}

const boatAt = (x: number, y: number, z: number, yaw = 0) => createVehicle(1, VehicleKind.Boat, x, y, z, yaw);

describe('boats', () => {
  it('find the water surface under them, full blocks or flowing', () => {
    const g = pool();
    expect(surfaceAt(g, 0.5, 2.8, 0.5)).toBe(3);
    expect(surfaceAt(g, 0.5, 1.2, 0.5)).toBe(3); // from under the surface too
    g.set(40, 0, 0, Block.WaterFlow4);
    expect(surfaceAt(g, 40.5, 0.3, 0.5)).toBe(0.5);
    expect(surfaceAt(g, 50.5, 3, 0.5)).toBe(null);
  });

  it('float with their bottom a little under the surface, settling there from a drop', () => {
    const g = pool();
    const v = boatAt(0.5, 4, 0.5);
    for (let t = 0; t < 3; t += STEP) stepBoat(v, g);
    expect(v.body.y).toBeCloseTo(3 - B.draft, 2);
    expect(Math.abs(v.body.vy)).toBeLessThan(0.05);
    expect(v.body.inWater).toBe(true);
  });

  it('row faster than swimming, turn, and stop when rowing stops', () => {
    const g = pool();
    // Facing +x (yaw -π/2), rowing for 4 s.
    const v = boatAt(-8.5, 3 - B.draft, 0.5, -Math.PI / 2);
    for (let t = 0; t < 4; t += STEP) stepBoat(v, g, STEP, { forward: 1, turn: 0 });
    expect(Math.hypot(v.body.vx, v.body.vz)).toBeGreaterThan(TUNING.player.swim.speed * 1.8);
    expect(v.body.vx).toBeCloseTo(B.speed, 0);
    expect(v.body.x).toBeGreaterThan(-8.5 + 12);
    expect(Math.abs(v.body.z - 0.5)).toBeLessThan(0.01);
    // Turning right for half a second: the facing's angle down by turn × 0.5.
    const yaw = v.yaw;
    for (let t = 0; t < 0.5 - 1e-9; t += STEP) stepBoat(v, g, STEP, { forward: 0, turn: 1 });
    expect(v.yaw).toBeCloseTo(yaw - B.turn * 0.5, 1);
    // No more rowing: it glides to a stop.
    for (let t = 0; t < 4; t += STEP) stepBoat(v, g);
    expect(Math.hypot(v.body.vx, v.body.vz)).toBeLessThan(0.05);
  });

  it('stop against a shore', () => {
    const g = pool(-10, 5);
    const v = boatAt(0.5, 3 - B.draft, 0.5, -Math.PI / 2);
    for (let t = 0; t < 5; t += STEP) stepBoat(v, g, STEP, { forward: 1, turn: 0 });
    // The wall from x 6 (stone up to y 4): the boat's side against it.
    expect(v.body.x).toBeCloseTo(6 - B.halfWidth, 3);
  });

  it('are carried by flowing water, down its slope', () => {
    const g = Object.assign(new Grid(), { hasColumn: () => true });
    // Flowing water from seven eighths deep at x 0 down to an eighth at x 6, walled at both ends and the sides.
    for (let x = -1; x <= 7; x++)
      for (let z = -3; z <= 3; z++) {
        g.set(x, -1, z, Block.Stone);
        const wall = x < 0 || x > 6 || Math.abs(z) > 2;
        g.set(x, 0, z, wall ? Block.Stone : ((Block.WaterFlow7 - x) as Block));
      }
    const v = boatAt(1.5, 0.875 - 1 / 8 - B.draft, 0.5);
    for (let t = 0; t < 1; t += STEP) stepBoat(v, g);
    expect(v.body.vx).toBeGreaterThan(0.5);
    expect(v.body.x).toBeGreaterThan(1.8);
  });

  it('fall onto land and drag to a stop there, rowed only feebly', () => {
    const g = new Grid().floor(-10, 10, -10, 10, 0);
    const v = boatAt(0.5, 3, 0.5, -Math.PI / 2);
    for (let t = 0; t < 2; t += STEP) stepBoat(v, g, STEP, { forward: 1, turn: 0 });
    expect(v.body.y).toBeCloseTo(0, 5);
    expect(v.body.onGround).toBe(true);
    expect(v.body.vx).toBeLessThanOrEqual(B.landSpeed + 1e-9);
  });

  it('are put on the first water a ray reaches, not through something solid', () => {
    const g = pool();
    // Looking down at the water from above.
    expect(waterOnRay(g, [2.3, 5, 0.7], [0, -1, 0], 5)).toEqual([2.5, 3 - B.draft, 0.5]);
    g.set(2, 4, 0, Block.Stone);
    expect(waterOnRay(g, [2.3, 5.5, 0.7], [0, -1, 0], 5)).toBe(null);
    expect(waterOnRay(g, [2.3, 9, 0.7], [0, -1, 0], 2)).toBe(null); // out of reach
  });

  it('are made from 5 planks, put down, ridden low, broken back into a boat, saved and loaded', () => {
    expect(RECIPES.find((r) => r.makes === Item.Boat)).toMatchObject({ count: 1, cost: [[Block.Planks, 5]] });
    const g = pool();
    const m = new VehicleManager(g);
    const v = m.placeBoat(0.5, 3 - B.draft, 0.5, 0)!;
    expect(seatHeight(v)).toBe(B.seat);
    expect(m.ride(v, 0)).toBe(true);
    // Rowed by its rider's input through the manager.
    for (let i = 0; i < 60; i++) m.update(1 / 60, new Map([[0, { forward: 1, turn: 0, look: [0, -1] as const }]]));
    expect(v.body.z).toBeLessThan(0.3); // yaw 0 faces -z
    const saved = JSON.parse(JSON.stringify(m.records()));
    const n = new VehicleManager(g);
    n.load(saved);
    n.columnLoaded(toChunk(Math.floor(v.body.x)), toChunk(Math.floor(v.body.z)));
    expect(n.vehicles[0].kind).toBe(VehicleKind.Boat);
    expect(n.vehicles[0].body.halfWidth).toBe(B.halfWidth);
    m.leave(0);
    expect(m.hit(v, true)).toEqual([{ item: Item.Boat, count: 1 }]);
  });
});
