import { describe, expect, it } from 'vitest';
import { GpuTimer } from '../src/render/gpuTimer';

const EXT = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

/** Just enough of WebGL2 for the timer: queries whose results are ready after `ready` reads. */
function fakeGl(withExt: boolean, results: number[], disjoint = () => false) {
  let next = 0;
  const begun: number[] = [];
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getExtension: () => (withExt ? EXT : null),
    createQuery: () => ({ id: next++ }),
    beginQuery: (_t: number, q: { id: number }) => begun.push(q.id),
    endQuery: () => {},
    deleteQuery: () => {},
    getQueryParameter: (q: { id: number }, p: number) => (p === 1 ? q.id < results.length : results[q.id]),
    getParameter: (p: number) => (p === EXT.GPU_DISJOINT_EXT ? disjoint() : 0),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, begun };
}

describe('GPU timer', () => {
  it('reports nothing where the browser has no timer queries', () => {
    const { gl, begun } = fakeGl(false, [1e6]);
    const t = new GpuTimer(gl);
    t.begin();
    t.end();
    expect(t.available).toBe(false);
    expect(t.read()).toEqual([]);
    expect(begun).toEqual([]);
  });

  it('reads frames in order, in milliseconds, once their results are in', () => {
    const { gl } = fakeGl(true, [2.5e6, 4e6]);
    const t = new GpuTimer(gl);
    for (let i = 0; i < 3; i++) {
      t.begin();
      t.end();
    }
    // The third frame's result isn't in yet: it waits, and nothing after it is read.
    expect(t.read()).toEqual([2.5, 4]);
    expect(t.read()).toEqual([]);
  });

  it('drops results from a disjoint GPU clock', () => {
    const { gl } = fakeGl(true, [3e6], () => true);
    const t = new GpuTimer(gl);
    t.begin();
    t.end();
    expect(t.read()).toEqual([]);
  });
});
