import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { paddedBlocks } from '../src/mesh/padding';
import { handleJob } from '../src/workers/jobs';
import { jobTransferables, resultTransferables } from '../src/workers/protocol';
import { MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { Generator } from '../src/world/generate';
import { World } from '../src/world/world';

/** Send through structured clone with the transfer list, as postMessage does: transferred buffers detach. */
function send<T>(message: T, transfer: ArrayBuffer[]): T {
  expect(new Set(transfer).size).toBe(transfer.length);
  const copy = structuredClone(message, { transfer });
  for (const b of transfer) expect(b.byteLength).toBe(0);
  return copy;
}

describe('chunk worker jobs', () => {
  it('generate a column, transferring every non-empty chunk', () => {
    const result = handleJob({ kind: 'generate', id: 7, seed: 20261022, cx: 2, cz: -3, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y });
    const expected = new Generator(20261022).generateColumn(2, -3, MIN_CHUNK_Y, MAX_CHUNK_Y);
    if (result.kind !== 'generate') throw new Error('wrong kind');
    expect(result.id).toBe(7);
    expect(result.chunks).toEqual(expected);
    expect(resultTransferables(result)).toHaveLength(expected.filter((c) => c).length);
    const received = send(result, resultTransferables(result));
    expect(received.chunks).toEqual(expected);
  });

  it('mesh a padded chunk, transferring the vertex buffers and the padded copy back', () => {
    const world = new World(20261022);
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
    const padded = paddedBlocks(world, 0, 1, 0);
    const expected = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0);
    const job = send({ kind: 'mesh' as const, id: 3, cx: 0, cy: 1, cz: 0, version: 5, padded }, jobTransferables({ kind: 'mesh', id: 3, cx: 0, cy: 1, cz: 0, version: 5, padded }));
    const result = handleJob(job);
    if (result.kind !== 'mesh') throw new Error('wrong kind');
    expect(result.version).toBe(5);
    expect(result.mesh).toEqual(expected);
    // The padded copy, then positions, colours, texture coordinates and indices of both passes.
    expect(resultTransferables(result)).toHaveLength(9);
    const received = send(result, resultTransferables(result));
    expect(received.mesh).toEqual(expected);
    expect(received.padded).toEqual(paddedBlocks(world, 0, 1, 0));
  });
});
