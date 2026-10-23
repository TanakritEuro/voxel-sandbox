// A pool of chunk workers. Hands each job to the worker with the fewest jobs in flight and
// passes results back through `onResult`. Scheduling (what to run, in what order, what to
// throw away) is the chunk loader's job, on the main thread.

import { TUNING } from '../config';
import { type Job, jobTransferables, type JobResult, type JobRunner } from './protocol';

const BUSY_WINDOW_MS = 1000;

export class WorkerPool implements JobRunner {
  readonly capacity: number;
  onResult: (result: JobResult) => void = () => {};
  private readonly workers: Worker[] = [];
  /** Jobs in flight per worker. */
  private readonly load: number[] = [];
  /** Finished jobs: [time, worker ms], for the busy fraction. */
  private readonly finished: [number, number][] = [];

  constructor(readonly size = WorkerPool.defaultSize()) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<JobResult>) => {
        this.load[i]--;
        this.finished.push([performance.now(), e.data.ms]);
        this.onResult(e.data);
      };
      worker.onerror = (e) => console.error('chunk worker:', e.message);
      this.workers.push(worker);
      this.load.push(0);
    }
    this.capacity = size * TUNING.workers.jobsPerWorker;
  }

  /** One worker per core but one (the main thread's), within `TUNING.workers.max`. */
  static defaultSize(): number {
    return Math.max(1, Math.min(TUNING.workers.max, (navigator.hardwareConcurrency || 2) - 1));
  }

  get inFlight(): number {
    return this.load.reduce((a, b) => a + b, 0);
  }

  run(job: Job): void {
    let best = 0;
    for (let i = 1; i < this.size; i++) if (this.load[i] < this.load[best]) best = i;
    this.load[best]++;
    this.workers[best].postMessage(job, { transfer: jobTransferables(job) });
  }

  /** Fraction of the pool's time spent on jobs over the last second. */
  busy(now = performance.now()): number {
    while (this.finished.length && this.finished[0][0] < now - BUSY_WINDOW_MS) this.finished.shift();
    const ms = this.finished.reduce((s, f) => s + f[1], 0);
    return Math.min(1, ms / (this.size * BUSY_WINDOW_MS));
  }
}
