// The host's world as its session sees it (`HostWorld`): the real world and its saver.
//
// A column's edited chunks come from memory when the column is loaded (so edits not yet written
// are in them), else from the save. A guest's edit is made if it's a block a player can set (air,
// a block from the picker, a torch on a wall) in a column the host has loaded; the game's own
// checks (reach, not inside a player) are passed in.

import { encodeRle } from '../save/rle';
import type { WorldSaver } from '../save/saver';
import type { SavedChunk } from '../workers/protocol';
import { Block, BLOCKS, isTorch } from '../world/blocks';
import { MAX_CHUNK_Y, MIN_CHUNK_Y, toChunk } from '../world/coords';
import type { World } from '../world/world';
import type { HostWorld } from './session';

export interface HostGame {
  time(): number;
  position(): [number, number, number];
  /** Is player `player` allowed this edit as far as the game goes (reach, not inside anyone)? */
  allowed(player: number, x: number, y: number, z: number, block: Block): boolean;
  /** Make an edit as the game does (blocks and light, remeshing, saving, waking the water). */
  edit(x: number, y: number, z: number, block: Block): void;
}

/** A block a player can set: air (breaking), one from the picker, or a torch (on a floor or a wall). */
export const settable = (block: number): boolean => block === Block.Air || BLOCKS[block]?.pickable === true || (BLOCKS[block] !== undefined && isTorch(block as Block));

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
    blockAt: (x, y, z) => world.getBlock(x, y, z),
  };
}
