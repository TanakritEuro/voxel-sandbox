// Sound, after the racing game's (itself after five-a-side's): every sound is synthesised with
// the Web Audio API, no sound files. Browsers only allow audio after a user gesture, so nothing
// plays until `unlock()` is called from one (the first click or key).
//
// Each block material is a recipe: a burst of noise through a filter, with a short envelope,
// and for some a pitched click (stone's sharp tick, wood's hollow knock, glass's ring). A step
// is the recipe once; digging a quieter, shorter one; breaking a louder, longer crunch in two
// bursts; placing a soft low thump with the material on top; landing a deeper thud. Pitch and
// level vary a little each time so repeats don't sound mechanical.

import type { BlockSound } from '../world/blocks';
import type { SoundEvent } from './cues';

interface Recipe {
  /** The noise: filter type, centre or cut-off (Hz), Q, how long it rings (s), level. */
  filter: BiquadFilterType;
  frequency: number;
  q: number;
  decay: number;
  gain: number;
  /** Bursts in a row (gravel's grains, grass's rustle), this far apart (s). */
  bursts?: number;
  spacing?: number;
  /** A pitched click on top: frequency (Hz), how long (s), level. */
  click?: { frequency: number; decay: number; gain: number };
}

const RECIPES: Record<BlockSound, Recipe> = {
  stone: { filter: 'bandpass', frequency: 1600, q: 1.4, decay: 0.07, gain: 0.9, click: { frequency: 1100, decay: 0.03, gain: 0.25 } },
  dirt: { filter: 'lowpass', frequency: 800, q: 0.7, decay: 0.09, gain: 1 },
  grass: { filter: 'bandpass', frequency: 2400, q: 0.6, decay: 0.07, gain: 0.7, bursts: 2, spacing: 0.035 },
  sand: { filter: 'bandpass', frequency: 3600, q: 0.8, decay: 0.08, gain: 0.6, bursts: 2, spacing: 0.03 },
  gravel: { filter: 'bandpass', frequency: 1300, q: 1, decay: 0.05, gain: 0.8, bursts: 3, spacing: 0.025 },
  snow: { filter: 'bandpass', frequency: 2000, q: 0.5, decay: 0.12, gain: 0.6 },
  wood: { filter: 'lowpass', frequency: 1300, q: 1, decay: 0.06, gain: 0.7, click: { frequency: 300, decay: 0.07, gain: 0.5 } },
  leaves: { filter: 'bandpass', frequency: 3200, q: 0.5, decay: 0.09, gain: 0.45, bursts: 2, spacing: 0.04 },
  glass: { filter: 'highpass', frequency: 5000, q: 0.7, decay: 0.04, gain: 0.5, click: { frequency: 2600, decay: 0.09, gain: 0.3 } },
  water: { filter: 'lowpass', frequency: 700, q: 0.8, decay: 0.2, gain: 0.9 },
};

/** A random factor around 1, ± `spread` (sounds only; not world code). */
const vary = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;

export class Sound {
  private ctx: AudioContext | null = null;
  /** Everything goes through here: volume and mute. */
  private master: GainNode | null = null;
  /** A few seconds of white noise, shared by every noisy sound. */
  private noise: AudioBuffer | null = null;

  constructor(
    private volume: number,
    private muted: boolean,
  ) {}

  get isMuted(): boolean {
    return this.muted;
  }

  /** Create the context (call from a user gesture); later calls resume it. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.level();
    this.master.connect(ctx.destination);
    this.noise = makeNoise(ctx, 3);
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }

  play(e: SoundEvent): void {
    if (!this.ctx || this.level() === 0) return;
    switch (e.name) {
      case 'step':
        this.material(e.material, e.gain, 1, 0);
        break;
      case 'dig':
        this.material(e.material, e.gain, 0.7, 0);
        break;
      case 'break':
        // A crunch in two bursts, longer than a step.
        this.material(e.material, e.gain * 1.2, 1.8, 0);
        this.material(e.material, e.gain * 0.8, 1.4, 0.05);
        break;
      case 'place':
        this.thump(130, 0.12, e.gain * 0.5);
        this.material(e.material, e.gain * 0.6, 1, 0);
        break;
      case 'land':
        this.thump(85, 0.2, e.gain);
        this.material(e.material, 0.4 + 0.6 * e.gain, 1.3, 0);
        break;
      case 'splash':
        this.material('water', e.gain * 1.2, 2.2, 0);
        this.material('water', e.gain * 0.6, 1.5, 0.08);
        break;
    }
  }

  private level(): number {
    return this.muted ? 0 : this.volume;
  }

  /** The material's recipe at `gain`, its decay stretched by `length`, `delay` seconds from now. */
  private material(material: BlockSound, gain: number, length: number, delay: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const r = RECIPES[material];
    const pitch = vary(0.08);
    const t0 = ctx.currentTime + delay;
    const bursts = r.bursts ?? 1;
    for (let i = 0; i < bursts; i++) {
      const t = t0 + i * (r.spacing ?? 0) * vary(0.2);
      const level = r.gain * gain * vary(0.12) * (i === 0 ? 1 : 0.7);
      const decay = r.decay * length;
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = r.filter;
      f.frequency.value = r.frequency * pitch;
      f.Q.value = r.q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);
      n.connect(f).connect(g).connect(this.master);
      n.start(t, Math.random() * 2);
      n.stop(t + decay + 0.02);
    }
    if (r.click) this.tone(r.click.frequency * pitch, r.click.decay * length, r.click.gain * gain, t0);
  }

  /** A low thump: a sine sliding down an octave. */
  private thump(frequency: number, decay: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(frequency * vary(0.06), t);
    o.frequency.exponentialRampToValueAtTime(frequency / 2, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  /** A short pitched tick at time `t`. */
  private tone(frequency: number, decay: number, gain: number, t: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(frequency, t);
    o.frequency.exponentialRampToValueAtTime(frequency * 0.7, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
