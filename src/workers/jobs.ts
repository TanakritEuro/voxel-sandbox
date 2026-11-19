// What a chunk worker does with a job. Pure apart from a generator per seed, so tests (and a
// main-thread fallback) can call it directly.

import { prepareLod } from '../mesh/lod';
import { meshChunk } from '../mesh/mesher';
import { decodeRle } from '../save/rle';
import { Generator } from '../world/generate';
import { lightColumn } from '../world/light';
import { chunkRegions } from '../world/visibility';
import type { Job, JobResult } from './protocol';

/** By seed and generation version. */
const generators = new Map<string, Generator>();

export function handleJob(job: Job): JobResult {
  const t0 = performance.now();
  if (job.kind === 'generate') {
    const key = `${job.seed}/${job.generation}`;
    let generator = generators.get(key);
    if (!generator) {
      generator = new Generator(job.seed, { generation: job.generation });
      generators.set(key, generator);
    }
    const chunks = generator.generateColumn(job.cx, job.cz, job.cyMin, job.cyMax);
    // Edited chunks as they were saved, in place of the generated ones.
    for (const s of job.saved) chunks[s.cy - job.cyMin] = decodeRle(s.data);
    const regions = chunks.map((c) => (c ? chunkRegions(c) : null));
    const light = lightColumn(chunks);
    return { kind: 'generate', id: job.id, cx: job.cx, cz: job.cz, cyMin: job.cyMin, chunks, regions, light, ms: performance.now() - t0 };
  }
  // Coarsened and walled in place: the padded copies are the main thread's scratch buffers.
  if (job.lod || job.seams) prepareLod(job.padded, job.paddedLight, job.lod ?? 0, job.seams ?? 0);
  const mesh = meshChunk(job.padded, job.cx, job.cy, job.cz, job.paddedLight, (job.lod ?? 0) > 0);
  const { id, cx, cy, cz, version, padded, paddedLight } = job;
  return { kind: 'mesh', id, cx, cy, cz, version, mesh, padded, paddedLight, ms: performance.now() - t0 };
}
