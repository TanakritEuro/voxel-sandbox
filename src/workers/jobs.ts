// What a chunk worker does with a job. Pure apart from a generator per seed, so tests (and a
// main-thread fallback) can call it directly.

import { meshChunk } from '../mesh/mesher';
import { Generator } from '../world/generate';
import { ALL_CONNECTED, chunkConnectivity } from '../world/visibility';
import type { Job, JobResult } from './protocol';

const generators = new Map<number, Generator>();

export function handleJob(job: Job): JobResult {
  const t0 = performance.now();
  if (job.kind === 'generate') {
    let generator = generators.get(job.seed);
    if (!generator) {
      generator = new Generator(job.seed);
      generators.set(job.seed, generator);
    }
    const chunks = generator.generateColumn(job.cx, job.cz, job.cyMin, job.cyMax);
    const connectivity = chunks.map((c) => (c ? chunkConnectivity(c) : ALL_CONNECTED));
    return { kind: 'generate', id: job.id, cx: job.cx, cz: job.cz, cyMin: job.cyMin, chunks, connectivity, ms: performance.now() - t0 };
  }
  const mesh = meshChunk(job.padded, job.cx, job.cy, job.cz);
  const { id, cx, cy, cz, version, padded } = job;
  return { kind: 'mesh', id, cx, cy, cz, version, mesh, padded, ms: performance.now() - t0 };
}
