// Chunk worker entry: generates and meshes chunks for the main thread (see `pool.ts`).

import { handleJob } from './jobs';
import { type Job, resultTransferables } from './protocol';

self.onmessage = (e: MessageEvent<Job>) => {
  const result = handleJob(e.data);
  self.postMessage(result, { transfer: resultTransferables(result) });
};
