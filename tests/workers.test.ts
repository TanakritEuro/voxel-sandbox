import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/mesh/mesher';
import { encodeRle } from '../src/save/rle';
import { paddedBlocks, paddedLight } from '../src/mesh/padding';
import { handleJob } from '../src/workers/jobs';
import { jobTransferables, resultTransferables } from '../src/workers/protocol';
import { Block } from '../src/world/blocks';
import { CHUNK_VOLUME, MAX_CHUNK_Y, MIN_CHUNK_Y } from '../src/world/coords';
import { Generator } from '../src/world/generate';
import { lightColumn } from '../src/world/light';
import { World } from '../src/world/world';

/** Send through structured clone with the transfer list, as postMessage does: transferred buffers detach. */
function send<T>(message: T, transfer: ArrayBuffer[]): T {
  expect(new Set(transfer).size).toBe(transfer.length);
  const copy = structuredClone(message, { transfer });
  for (const b of transfer) expect(b.byteLength).toBe(0);
  return copy;
}

describe('chunk worker jobs', () => {
  it('generate and light a column, transferring every non-empty chunk and every light array', () => {
    const result = handleJob({ kind: 'generate', id: 7, seed: 20261022, cx: 2, cz: -3, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y, saved: [] });
    const expected = new Generator(20261022).generateColumn(2, -3, MIN_CHUNK_Y, MAX_CHUNK_Y);
    if (result.kind !== 'generate') throw new Error('wrong kind');
    expect(result.id).toBe(7);
    expect(result.chunks).toEqual(expected);
    const light = lightColumn(expected);
    expect(result.light).toEqual(light);
    const arrays = [...expected, ...light].filter((a) => a instanceof Uint8Array).length;
    expect(resultTransferables(result)).toHaveLength(arrays);
    const received = send(result, resultTransferables(result));
    expect(received.chunks).toEqual(expected);
    expect(received.light).toEqual(light);
  });

  it('put saved chunks in place of the generated ones, and light the column with them', () => {
    const edited = new Uint8Array(CHUNK_VOLUME).fill(Block.Lamp, 0, 32); // a row of lamps in the air
    const saved = [{ cy: MAX_CHUNK_Y, data: encodeRle(edited) }];
    const job = { kind: 'generate' as const, id: 8, seed: 20261022, cx: 2, cz: -3, cyMin: MIN_CHUNK_Y, cyMax: MAX_CHUNK_Y, saved };
    expect(jobTransferables(job)).toEqual([saved[0].data.buffer]);
    const result = handleJob(send(job, jobTransferables(job)));
    if (result.kind !== 'generate') throw new Error('wrong kind');
    const expected = new Generator(20261022).generateColumn(2, -3, MIN_CHUNK_Y, MAX_CHUNK_Y);
    expected[MAX_CHUNK_Y - MIN_CHUNK_Y] = edited;
    expect(result.chunks).toEqual(expected);
    expect(result.light).toEqual(lightColumn(expected));
  });

  it('mesh a padded chunk, transferring the vertex buffers and the padded copies back', () => {
    const world = new World(20261022);
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) world.ensureColumn(cx, cz);
    const padded = paddedBlocks(world, 0, 1, 0);
    const light = paddedLight(world, 0, 1, 0);
    const expected = meshChunk(paddedBlocks(world, 0, 1, 0), 0, 1, 0, paddedLight(world, 0, 1, 0));
    const message = { kind: 'mesh' as const, id: 3, cx: 0, cy: 1, cz: 0, version: 5, padded, paddedLight: light };
    const job = send(message, jobTransferables(message));
    const result = handleJob(job);
    if (result.kind !== 'mesh') throw new Error('wrong kind');
    expect(result.version).toBe(5);
    expect(result.mesh).toEqual(expected);
    // The padded copies, then positions, colours, texture coordinates and indices of both passes.
    expect(resultTransferables(result)).toHaveLength(10);
    const received = send(result, resultTransferables(result));
    expect(received.mesh).toEqual(expected);
    expect(received.padded).toEqual(paddedBlocks(world, 0, 1, 0));
    expect(received.paddedLight).toEqual(paddedLight(world, 0, 1, 0));
  });
});
