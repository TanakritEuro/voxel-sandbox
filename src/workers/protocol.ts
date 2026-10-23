// Messages between the main thread and the chunk workers. Block arrays and vertex buffers
// travel as transferables (moved, not copied); the sender loses them.

import type { ChunkMesh } from '../mesh/mesher';

export type Job =
  | { kind: 'generate'; id: number; seed: number; cx: number; cz: number; cyMin: number; cyMax: number }
  | {
      kind: 'mesh';
      id: number;
      cx: number;
      cy: number;
      cz: number;
      /** The chunk's version when the job was made: a result for an older version is stale. */
      version: number;
      /** `paddedBlocks` output; comes back in the result to be reused. */
      padded: Uint8Array;
    };

export type JobResult =
  | {
      kind: 'generate';
      id: number;
      cx: number;
      cz: number;
      cyMin: number;
      /** Chunks cyMin.. upwards; null for all air. */
      chunks: (Uint8Array | null)[];
      /** Each chunk's face connectivity (`visibility.ts`), worked out here rather than on the main thread. */
      connectivity: number[];
      /** Time the worker spent on the job. */
      ms: number;
    }
  | { kind: 'mesh'; id: number; cx: number; cy: number; cz: number; version: number; mesh: ChunkMesh; padded: Uint8Array; ms: number };

/** Runs jobs somewhere (a worker pool, or synchronously in tests) and hands back results. */
export interface JobRunner {
  /** Jobs that can usefully be in flight at once. */
  readonly capacity: number;
  /** Start a job; its result arrives later through `onResult`. */
  run(job: Job): void;
  onResult: (result: JobResult) => void;
}

// The buffers to transfer with each message. Every one is a whole buffer of its own (the
// mesher's `build()` and the generator allocate exactly-sized arrays).

export const jobTransferables = (job: Job): ArrayBuffer[] => (job.kind === 'mesh' ? [job.padded.buffer as ArrayBuffer] : []);

export function resultTransferables(result: JobResult): ArrayBuffer[] {
  if (result.kind === 'generate') return result.chunks.flatMap((c) => (c ? [c.buffer as ArrayBuffer] : []));
  const { opaque, transparent } = result.mesh;
  return [result.padded, ...[opaque, transparent].flatMap((d) => [d.positions, d.colors, d.uvl, d.indices])].map((a) => a.buffer as ArrayBuffer);
}
