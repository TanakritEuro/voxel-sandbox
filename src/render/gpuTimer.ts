// GPU time per frame, for `?stats`: a WebGL2 timer query around the frame's draw calls. The
// main thread only submits work; this is how long the GPU takes to do it, which is what
// limits the frame rate once the main thread is fast. Results arrive a few frames late.
// Browsers without EXT_disjoint_timer_query_webgl2 (Firefox, Safari) report nothing.

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  private readonly ext: TimerExt | null;
  /** Queries ended but not read yet, oldest first. */
  private readonly waiting: WebGLQuery[] = [];
  private running: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get available(): boolean {
    return this.ext !== null;
  }

  /** Before the frame's first draw call. */
  begin(): void {
    if (!this.ext || this.running || this.waiting.length > 4) return;
    this.running = this.gl.createQuery();
    if (this.running) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.running);
  }

  /** After the frame's last draw call. */
  end(): void {
    if (!this.ext || !this.running) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.waiting.push(this.running);
    this.running = null;
  }

  /** GPU milliseconds of the frames whose results are in, oldest first. */
  read(): number[] {
    const out: number[] = [];
    const { gl, ext } = this;
    if (!ext) return out;
    while (this.waiting.length && gl.getQueryParameter(this.waiting[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.waiting.shift()!;
      // Disjoint: the GPU's clock was interrupted, so the result means nothing.
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    return out;
  }
}
