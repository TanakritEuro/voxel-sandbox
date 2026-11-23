// Sound, after the racing game's (itself after five-a-side's): every sound is synthesised with
// the Web Audio API, no sound files. Browsers only allow audio after a user gesture, so nothing
// plays until `unlock()` is called from one (the first click or key).
//
// Each block material is a recipe: a burst of noise through a filter, with a short envelope,
// and for some a pitched click (stone's sharp tick, wood's hollow knock, glass's ring). A step
// is the recipe once; digging a quieter, shorter one; breaking a louder, longer crunch in two
// bursts; placing a soft low thump with the material on top; landing a deeper thud. Pitch and
// level vary a little each time so repeats don't sound mechanical.
//
// Mobs have voices: a pitched oscillator gliding through a filter, with a wobble. A mossback
// groans low, a hopper chirps twice, a crag goat bleats, a dune beetle chitters, a gloamer rasps, a delver grinds; hurt, the call
// comes higher and shorter over a thump. A hopper lands with a soft thump; a mob that's gone
// leaves a rising whoosh of noise. Each is panned to the side it came from.
//
// The weather (`weather.ts` says how loud): rain is a looped bed of noise with drops in it, through
// a low-pass that closes under cover; thunder a rumble of noise in a few swells over a deep boom,
// with a crack on top from near.
//
// In survival, being hurt is a low thump with a quick falling grunt; picking something up a soft
// rising blip; a bite of food a short crunch.

import { MobKind } from '../mobs/kinds';
import type { MobVoice } from '../mobs/mobs';
import { TUNING } from '../config';
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
  /** Rain's noise, made when it's first heard. */
  private drops: AudioBuffer | null = null;
  /** The rain's bed while it's heard. */
  private bed: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; level: number; open: number } | null = null;

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

  /** The rain's bed, once a frame: `level` 0–1 (0 silent), `open` 0 muffled – 1 bright. Eased. */
  rain(level: number, open: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const wanted = this.level() === 0 ? 0 : level;
    let bed = this.bed;
    if (wanted < 0.002) {
      if (!bed) return;
      bed.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      bed.source.stop(ctx.currentTime + 1);
      this.bed = null;
      return;
    }
    if (!bed) {
      this.drops ??= makeRain(ctx, 5.3);
      const source = ctx.createBufferSource();
      source.buffer = this.drops;
      source.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = 'highpass';
      low.frequency.value = 180;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      filter.frequency.value = rainCutoff(open);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(low).connect(filter).connect(gain).connect(this.master);
      source.start(ctx.currentTime, Math.random() * 5);
      bed = this.bed = { source, filter, gain, level: -1, open: -1 };
    }
    // Only changes are set: an automation event a frame would pile up.
    if (Math.abs(wanted - bed.level) > 0.004) {
      bed.level = wanted;
      bed.gain.gain.setTargetAtTime(wanted * TUNING.weather.hearing.level, ctx.currentTime, 0.2);
    }
    if (Math.abs(open - bed.open) > 0.01) {
      bed.open = open;
      bed.filter.frequency.setTargetAtTime(rainCutoff(open), ctx.currentTime, 0.2);
    }
  }

  play(e: SoundEvent): void {
    if (!this.ctx || this.level() === 0) return;
    switch (e.name) {
      case 'thunder':
        this.thunder(e.gain, e.bright, e.pan);
        break;
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
      case 'mob':
        this.mob(e.kind, e.voice, e.gain, e.pan);
        break;
      case 'hurt':
        this.thump(110, 0.18, e.gain * 0.8);
        this.glide('sawtooth', 320, 150, 0.14, e.gain * 0.12, 900);
        this.material('dirt', e.gain * 0.5, 1.2, 0);
        break;
      case 'eat':
        this.material('leaves', e.gain * 0.7, 0.7, 0);
        this.thump(180, 0.05, e.gain * 0.25);
        break;
      case 'pickup':
        this.glide('triangle', 620, 1050, 0.07, e.gain * 0.18, 4000);
        break;
      case 'click':
        // A button pressed: a soft wooden tock.
        this.thump(380, 0.035, e.gain * 0.22);
        this.glide('triangle', 1300, 900, 0.03, e.gain * 0.05, 3000);
        break;
      case 'tick':
        // A slot or tab changed: a tiny tick.
        this.glide('triangle', 1900, 1600, 0.02, e.gain * 0.045, 5000);
        break;
    }
  }

  /** Thunder at `gain`, `bright` near and open, dull from far off, panned by `pan`. */
  private thunder(gain: number, bright: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const out = ctx.createStereoPanner();
    out.pan.value = pan;
    out.connect(this.master);
    const t = ctx.currentTime;
    const length = 2.6 + (1 - bright) * 1.4;
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(340 + 1400 * bright, t);
    f.frequency.exponentialRampToValueAtTime(140, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    // Sharp from near, a slow swell from far; then a few rolls, dying away.
    const attack = 0.04 + 0.3 * (1 - bright);
    // A low-pass takes most of noise's power: made up, or thunder from far off was under the rain.
    const body = gain * (0.75 + 0.75 * (1 - bright));
    g.gain.linearRampToValueAtTime(body, t + attack);
    let at = attack;
    for (let i = 1; i <= 3; i++) {
      const dip = at + 0.28 * vary(0.3);
      const swell = dip + 0.3 * vary(0.3);
      const level = body * (0.95 - i * 0.18);
      g.gain.linearRampToValueAtTime(level * 0.45, t + dip);
      g.gain.linearRampToValueAtTime(level, t + swell);
      at = swell;
    }
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    rumble.connect(f).connect(g).connect(out);
    rumble.start(t, Math.random() * 2);
    rumble.stop(t + length + 0.02);
    this.thump(62, 0.9, gain * 0.35, out);
    if (bright > 0.4) {
      const crack = ctx.createBufferSource();
      crack.buffer = this.noise;
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 1400;
      const c = ctx.createGain();
      c.gain.setValueAtTime(0, t);
      c.gain.linearRampToValueAtTime(gain * (bright - 0.4) * 0.6, t + 0.01);
      c.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      crack.connect(high).connect(c).connect(out);
      crack.start(t, Math.random() * 2);
      crack.stop(t + 0.24);
    }
  }

  /** A mob's call, cry, landing or puff, at `gain`, panned by `pan`. */
  private mob(kind: MobKind, voice: MobVoice, gain: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const out = ctx.createStereoPanner();
    out.pan.value = pan;
    out.connect(this.master);
    const t = ctx.currentTime;
    if (voice === 'land') {
      this.thump(150, 0.08, gain * 0.35, out);
      return;
    }
    if (voice === 'puff') {
      // A whoosh: noise through a band rising in pitch.
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(2800, t + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * 0.7, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      n.connect(f).connect(g).connect(out);
      n.start(t, Math.random() * 2);
      n.stop(t + 0.42);
      return;
    }
    const hurt = voice === 'hurt';
    if (hurt) this.thump(110, 0.1, gain * 0.5, out);
    const p = (hurt ? 1.35 : 1) * vary(0.06);
    const len = hurt ? 0.6 : 1;
    switch (kind) {
      case MobKind.Mossback:
        this.voiced('sawtooth', 105 * p, 82 * p, 0.75 * len, 650, 5, 3, gain * 0.45, t, out);
        break;
      case MobKind.Hopper:
        this.voiced('sine', 2300 * p, 3100 * p, 0.06, 6000, 0, 0, gain * 0.25, t, out);
        this.voiced('sine', 2400 * p, 3300 * p, 0.05, 6000, 0, 0, gain * 0.2, t + 0.09, out);
        break;
      case MobKind.CragGoat:
        this.voiced('sawtooth', 430 * p, 380 * p, 0.5 * len, 1500, 17, 28, gain * 0.3, t, out);
        break;
      case MobKind.DuneBeetle:
        for (let i = 0; i < (hurt ? 3 : 5); i++) this.tone(3300 * p * vary(0.05), 0.018, gain * 0.25, t + i * 0.032, out);
        break;
      case MobKind.Ambler:
        // A low hoot, then a lower one.
        this.voiced('sine', 190 * p, 165 * p, 0.22 * len, 900, 4, 3, gain * 0.5, t, out);
        if (!hurt) this.voiced('sine', 150 * p, 128 * p, 0.32, 900, 4, 3, gain * 0.45, t + 0.3, out);
        break;
      case MobKind.Wader:
        // A croaking burble: short low rasps in a row.
        for (let i = 0; i < (hurt ? 2 : 4); i++) this.voiced('square', 96 * p * vary(0.05), 80 * p, 0.07, 900, 30, 8, gain * 0.22, t + i * 0.09, out);
        break;
      case MobKind.Delver:
        // A deep grinding rumble, like stone on stone; hurt, a crack.
        this.voiced('sawtooth', 52 * p, 40 * p, 1.3 * len, 320, 9, 6, gain * 0.6, t, out);
        this.voiced('square', 64 * p, 48 * p, 0.9 * len, 260, 13, 5, gain * 0.25, t + 0.15, out);
        if (hurt) this.thump(70, 0.15, gain * 0.6, out);
        break;
      case MobKind.Hearthfolk:
        if (voice === 'greet') {
          // A greeting: two warm notes rising, "hm-ho".
          this.voiced('triangle', 190 * p, 200 * p, 0.16, 1400, 5, 2, gain * 0.4, t, out);
          this.voiced('triangle', 250 * p, 270 * p, 0.24, 1400, 5, 3, gain * 0.4, t + 0.2, out);
        } else if (hurt) {
          // A short "oof", falling.
          this.voiced('triangle', 230 * p, 160 * p, 0.14, 1100, 0, 0, gain * 0.45, t, out);
        } else {
          // Humming to itself: three soft notes, gliding.
          const notes = [1, 1.125, 0.9][Math.floor(Math.random() * 3)];
          for (let i = 0; i < 3; i++) this.voiced('sine', 150 * p * (i === 1 ? notes : 1), 152 * p * (i === 2 ? notes : 1), 0.32, 700, 4, 2, gain * 0.32, t + i * 0.34, out);
        }
        break;
      case MobKind.Gloamer:
        // A low rasp, shaking fast; hurt, a hiss over it.
        this.voiced('sawtooth', 74 * p, 52 * p, 1.1 * len, 480, 23, 14, gain * 0.55, t, out);
        if (hurt) this.voiced('square', 900, 700, 0.25, 3000, 40, 60, gain * 0.12, t, out);
        break;
    }
  }

  /**
   * A voice: an oscillator gliding from `from` to `to` Hz over `length` s through a low-pass at
   * `cutoff`, wobbling `depth` Hz `rate` times a second, starting at `t`.
   */
  private voiced(type: OscillatorType, from: number, to: number, length: number, cutoff: number, rate: number, depth: number, gain: number, t: number, out: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + length);
    const stop = t + length + 0.02;
    if (depth > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const amount = ctx.createGain();
      amount.gain.value = depth;
      lfo.connect(amount).connect(o.frequency);
      lfo.start(t);
      lfo.stop(stop);
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.05, length * 0.25));
    g.gain.setValueAtTime(gain, t + length * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(stop);
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

  /** A low thump: a sine sliding down an octave (to `out`, or the master). */
  /** A tone gliding from `from` to `to` Hz over `decay` s, through a low-pass at `cutoff`. */
  private glide(type: OscillatorType, from: number, to: number, decay: number, gain: number, cutoff: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    const k = vary(0.05);
    o.frequency.setValueAtTime(from * k, t);
    o.frequency.exponentialRampToValueAtTime(to * k, t + decay);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  private thump(frequency: number, decay: number, gain: number, out?: AudioNode): void {
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
    o.connect(g).connect(out ?? this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  /** A short pitched tick at time `t` (to `out`, or the master). */
  private tone(frequency: number, decay: number, gain: number, t: number, out?: AudioNode): void {
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
    o.connect(g).connect(out ?? this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }
}

/** The rain bed's low-pass (Hz): 450 muffled, 4,800 in the open (more was hiss). */
const rainCutoff = (open: number): number => 450 * (4800 / 450) ** Math.max(0, Math.min(1, open));

/** Rain: soft noise with a couple of hundred little drops a second in it. */
function makeRain(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.floor(rate * seconds), rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  for (let n = 0; n < seconds * 220; n++) {
    const length = Math.floor(rate * (0.002 + Math.random() * 0.006));
    const from = Math.floor(Math.random() * (data.length - length));
    const loud = 0.2 + Math.random() * 0.4;
    for (let i = 0; i < length; i++) data[from + i] += (Math.random() * 2 - 1) * loud * (1 - i / length);
  }
  return buffer;
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
