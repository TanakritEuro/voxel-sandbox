// The host's world as its session sees it (`HostWorld`): the real world and its saver.
//
// A column's edited chunks come from memory when the column is loaded (so edits not yet written
// are in them), else from the save. A guest's edit is made if it's a block a player can set (air,
// a block from the picker, a torch on a wall, a gate facing any way) in a column the host has
// loaded, and the game allows it (`editAllowed`: within reach of where the player was last heard,
// and a solid block not inside anyone). A guest's use of a block (a switch, a button, a delay) is
// made on the block as the host has it, if it's one to use and within reach.

import { TUNING } from '../config';
import { encodeRle } from '../save/rle';
import type { WorldSaver } from '../save/saver';
import type { SavedChunk } from '../workers/protocol';
import { Block, BLOCKS, delay, FACINGS, furnace, inverter, isTorch, useBlock } from '../world/blocks';
import { MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../world/coords';
import { createBody, overlapsBlock } from '../world/physics';
import type { World } from '../world/world';
import type { WorldMode } from '../save/store';
import type { PlayerState } from './playerState';
import type { HostWorld } from './session';

export interface HostGame {
  time(): number;
  position(): [number, number, number];
  /** Is player `player` allowed this edit as far as the game goes (reach, not inside anyone)? */
  allowed(player: number, x: number, y: number, z: number, block: Block): boolean;
  /** Make an edit as the game does (blocks and light, remeshing, saving, waking the water). */
  edit(x: number, y: number, z: number, block: Block): void;
  /** Player `player` hit mob `id` for `points`: check it's in reach, and make the hit. */
  hitMob(player: number, id: number, points: number): void;
  /** Guests' survival on the host's ground and in its furnaces (`HostWorld`'s). */
  drop: HostWorld['drop'];
  take: HostWorld['take'];
  furnace: HostWorld['furnace'];
  furnacePut: HostWorld['furnacePut'];
  furnaceTake: HostWorld['furnaceTake'];
  /** The world's mode, and guests' survival states kept by name (`HostWorld`'s). */
  mode(): WorldMode;
  kept(name: string): Record<string, unknown> | null;
  keep(name: string, survival: Record<string, unknown>): void;
}

/**
 * May the player at `who` (as last heard) set block (x, y, z) to `block`? Within reach of their eye
 * (with `TUNING.net.reachSlack` for the delay, and half the block's diagonal, since reach is
 * measured to the face looked at), and a block you can't walk through not inside anyone in
 * `everyone` (them included).
 */
export function editAllowed(who: PlayerState | undefined, everyone: Iterable<PlayerState>, x: number, y: number, z: number, block: number): boolean {
  if (!who) return false;
  const P = TUNING.player;
  const eye = who.y + (who.crouching ? P.crouchEyeHeight : P.eyeHeight);
  const far = Math.hypot(x + 0.5 - who.x, y + 0.5 - eye, z + 0.5 - who.z);
  if (far > TUNING.edit.reach + TUNING.net.reachSlack + 0.87) return false;
  if (!BLOCKS[block].passable) for (const p of everyone) if (overlapsBlock(createBody(p.x, p.y, p.z), x, y, z)) return false;
  return true;
}

/** Gates as placed: off, facing any way (a delay set to 1). */
const PLACED_GATES = new Set<number>(FACINGS.flatMap((_, f) => [inverter(f, false), delay(f, 1, false), furnace(f, false)]));

/**
 * A block a player can set: air (breaking), one from the picker, a torch (on a floor or a wall), or
 * a gate as placed (facing the way the player looks). Not a logic block in any other state (wire
 * with power in it, a switch on, a lamp lit, a gate on): those are the signals' to set, or come of
 * using a block (`use`).
 */
export const settable = (block: number): boolean =>
  block === Block.Air ||
  BLOCKS[block]?.pickable === true ||
  (BLOCKS[block] !== undefined && isTorch(block as Block)) ||
  PLACED_GATES.has(block);

export function hostWorld(world: World, saver: WorldSaver, game: HostGame): HostWorld {
  return {
    seed: world.generator.seed,
    time: () => game.time(),
    position: () => game.position(),
    editedColumns: () => {
      // Saved or waiting to be, and edited in memory since loading (the saver hears of every edit, so these agree; both for safety).
      const keys = new Set<string>();
      const out = saver.editedColumns();
      for (let i = 0; i < out.length; i += 2) keys.add(`${out[i]},${out[i + 1]}`);
      for (const c of world.chunks.values()) {
        if (!c.modified || keys.has(`${c.cx},${c.cz}`)) continue;
        keys.add(`${c.cx},${c.cz}`);
        out.push(c.cx, c.cz);
      }
      return out;
    },
    columnChunks: async (cx, cz) => {
      if (!world.hasColumn(cx, cz)) return saver.load(cx, cz);
      const heights = new Set(saver.heights(cx, cz));
      for (let cy = MIN_CHUNK_Y; cy <= MAX_CHUNK_Y; cy++) if (world.getChunk(cx, cy, cz)!.modified) heights.add(cy);
      return [...heights].sort((a, b) => a - b).map((cy): SavedChunk => ({ cy, data: encodeRle(world.getChunk(cx, cy, cz)!.blocks) }));
    },
    edit: (player, x, y, z, block) => {
      if (!settable(block) || !world.hasColumn(toChunk(x), toChunk(z))) return false;
      if (!game.allowed(player, x, y, z, block as Block)) return false;
      if (world.getBlock(x, y, z) !== block) game.edit(x, y, z, block as Block);
      return true;
    },
    use: (player, x, y, z) => {
      if (!world.hasColumn(toChunk(x), toChunk(z))) return false;
      const was = world.getBlock(x, y, z);
      const used = useBlock(was);
      if (used === null || !game.allowed(player, x, y, z, was)) return false;
      if (used !== was) game.edit(x, y, z, used);
      return true;
    },
    blockAt: (x, y, z) => world.getBlock(x, y, z),
    hitMob: (player, id, points) => game.hitMob(player, id, points),
    drop: (...a) => game.drop(...a),
    take: (...a) => game.take(...a),
    furnace: (...a) => game.furnace(...a),
    furnacePut: (...a) => game.furnacePut(...a),
    furnaceTake: (...a) => game.furnaceTake(...a),
    mode: () => game.mode(),
    kept: (name) => game.kept(name),
    keep: (name, survival) => game.keep(name, survival),
  };
}
