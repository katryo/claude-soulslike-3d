/**
 * Fully procedural audio: every sound effect and the music are synthesized
 * at runtime with the WebAudio API, so the game ships with zero audio assets.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private music: { stop: () => void } | null = null;
  private ambience: { stop: () => void } | null = null;
  private fire: { gain: GainNode; stop: () => void } | null = null;
  masterVolume = 0.8;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.4);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.35;
    this.reverb.connect(revGain).connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.sfxBus.connect(this.reverb);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.5;
    this.ambBus.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.masterVolume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private noise(dest: AudioNode, t0: number, dur: number, opts: {
    type?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number; gain?: number; attack?: number;
  }): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.5;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  private tone(dest: AudioNode, t0: number, dur: number, opts: {
    type?: OscillatorType; freq: number; freqEnd?: number; gain?: number; attack?: number; detune?: number;
  }): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private get ok(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  swing(heavy = false): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.noise(this.sfxBus, t, heavy ? 0.42 : 0.26, {
      type: 'bandpass', freq: heavy ? 500 : 900, freqEnd: heavy ? 1600 : 3200, q: 2.5, gain: heavy ? 0.35 : 0.25, attack: 0.06,
    });
  }

  hit(heavy = false): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.noise(this.sfxBus, t, 0.18, { type: 'lowpass', freq: 2400, freqEnd: 300, gain: 0.7 });
    this.tone(this.sfxBus, t, heavy ? 0.35 : 0.2, { type: 'sine', freq: heavy ? 110 : 160, freqEnd: 45, gain: 0.8 });
    this.noise(this.sfxBus, t + 0.01, 0.09, { type: 'highpass', freq: 3000, gain: 0.2 });
  }

  clang(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    for (const [f, g] of [[620, 0.18], [1240, 0.12], [1873, 0.09], [2710, 0.06], [3920, 0.04]] as const) {
      this.tone(this.sfxBus, t, 0.9, { type: 'sine', freq: f * (0.98 + Math.random() * 0.04), gain: g });
    }
    this.noise(this.sfxBus, t, 0.08, { type: 'highpass', freq: 2500, gain: 0.5 });
  }

  parry(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.clang();
    this.tone(this.sfxBus, t, 1.4, { type: 'triangle', freq: 1480, freqEnd: 1400, gain: 0.15 });
    this.tone(this.sfxBus, t + 0.02, 1.2, { type: 'sine', freq: 2960, gain: 0.08 });
  }

  roll(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.noise(this.sfxBus, t, 0.3, { type: 'lowpass', freq: 700, freqEnd: 200, gain: 0.35, attack: 0.03 });
    this.noise(this.sfxBus, t + 0.25, 0.15, { type: 'lowpass', freq: 500, gain: 0.25 });
  }

  step(volume = 0.12): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.noise(this.sfxBus, t, 0.09, { type: 'bandpass', freq: 380 + Math.random() * 180, q: 1.2, gain: volume });
  }

  heavyStep(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(this.sfxBus, t, 0.4, { type: 'sine', freq: 70, freqEnd: 35, gain: 0.5 });
    this.noise(this.sfxBus, t, 0.2, { type: 'lowpass', freq: 400, gain: 0.3 });
  }

  slam(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(this.sfxBus, t, 1.0, { type: 'sine', freq: 60, freqEnd: 25, gain: 1.0 });
    this.noise(this.sfxBus, t, 0.8, { type: 'lowpass', freq: 1200, freqEnd: 120, gain: 0.8 });
    this.noise(this.sfxBus, t + 0.05, 1.2, { type: 'bandpass', freq: 300, q: 0.7, gain: 0.3, attack: 0.1 });
  }

  fireBurst(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.noise(this.sfxBus, t, 1.1, { type: 'lowpass', freq: 300, freqEnd: 2500, gain: 0.6, attack: 0.15 });
    this.tone(this.sfxBus, t, 1.0, { type: 'sawtooth', freq: 80, freqEnd: 40, gain: 0.15, attack: 0.1 });
  }

  hurt(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(this.sfxBus, t, 0.25, { type: 'sawtooth', freq: 220, freqEnd: 120, gain: 0.08 });
  }

  enemyDeath(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(this.sfxBus, t, 1.2, { type: 'sawtooth', freq: 180, freqEnd: 50, gain: 0.1, attack: 0.05 });
    this.noise(this.sfxBus, t, 1.4, { type: 'bandpass', freq: 600, freqEnd: 150, q: 3, gain: 0.25, attack: 0.1 });
  }

  souls(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784, 1046].forEach((f, i) =>
      this.tone(this.sfxBus, t + i * 0.05, 0.8, { type: 'sine', freq: f, gain: 0.07, attack: 0.02 }),
    );
  }

  heal(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.noise(this.sfxBus, t, 1.0, { type: 'bandpass', freq: 600, freqEnd: 4000, q: 4, gain: 0.15, attack: 0.3 });
    [392, 494, 587, 784].forEach((f, i) =>
      this.tone(this.sfxBus, t + 0.1 + i * 0.09, 1.2, { type: 'triangle', freq: f, gain: 0.06, attack: 0.05 }),
    );
  }

  bonfireLit(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.fireBurst();
    [196, 247, 294, 392].forEach((f, i) =>
      this.tone(this.musicBus, t + 0.2 + i * 0.12, 3, { type: 'triangle', freq: f, gain: 0.08, attack: 0.2 }),
    );
  }

  uiMove(): void {
    if (!this.ok) return;
    this.tone(this.sfxBus, this.ctx!.currentTime, 0.08, { type: 'sine', freq: 880, gain: 0.05 });
  }

  uiConfirm(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(this.sfxBus, t, 0.2, { type: 'sine', freq: 660, gain: 0.07 });
    this.tone(this.sfxBus, t + 0.06, 0.25, { type: 'sine', freq: 990, gain: 0.07 });
  }

  youDied(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(this.musicBus, t, 4, { type: 'sawtooth', freq: 55, gain: 0.25, attack: 0.4 });
    this.tone(this.musicBus, t, 4, { type: 'sawtooth', freq: 82.4, gain: 0.15, attack: 0.4, detune: 6 });
    this.tone(this.musicBus, t, 4, { type: 'sine', freq: 110, gain: 0.2, attack: 0.4 });
    this.noise(this.musicBus, t, 3.5, { type: 'lowpass', freq: 200, gain: 0.4, attack: 0.3 });
  }

  victory(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    [261.6, 329.6, 392, 523.2, 659.2].forEach((f, i) =>
      this.tone(this.musicBus, t + i * 0.15, 5, { type: 'triangle', freq: f, gain: 0.08, attack: 0.3 }),
    );
  }

  /** Looping wind ambience. */
  startAmbience(): void {
    if (!this.ctx || this.ambience) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 400;
    f.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.18;
    src.connect(f).connect(g).connect(this.ambBus);
    src.start();
    lfo.start();
    this.ambience = { stop: () => { src.stop(); lfo.stop(); } };

    // Fire crackle loop whose gain is driven by distance to the nearest bonfire.
    const fsrc = ctx.createBufferSource();
    fsrc.buffer = this.noiseBuf;
    fsrc.loop = true;
    const ff = ctx.createBiquadFilter();
    ff.type = 'lowpass';
    ff.frequency.value = 900;
    const fg = ctx.createGain();
    fg.gain.value = 0;
    fsrc.connect(ff).connect(fg).connect(this.ambBus);
    fsrc.start();
    let alive = true;
    const crackle = () => {
      if (!alive || !this.ctx) return;
      if (fg.gain.value > 0.01) {
        this.noise(fg, this.ctx.currentTime, 0.03, { type: 'highpass', freq: 2000 + Math.random() * 3000, gain: 0.5 + Math.random() });
      }
      setTimeout(crackle, 40 + Math.random() * 180);
    };
    crackle();
    this.fire = { gain: fg, stop: () => { alive = false; fsrc.stop(); } };
  }

  setFireProximity(v: number): void {
    if (!this.ctx || !this.fire) return;
    this.fire.gain.gain.setTargetAtTime(v * 0.35, this.ctx.currentTime, 0.2);
  }

  /** Procedural boss music: drone, minor pad progression and war drums. */
  startBossMusic(phase2 = false): void {
    if (!this.ctx) return;
    this.stopMusic();
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
    out.connect(this.musicBus);
    const nodes: AudioScheduledSourceNode[] = [];

    const drone = (freq: number, type: OscillatorType, gain: number, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(lp).connect(g).connect(out);
      o.start();
      nodes.push(o);
    };
    drone(36.7, 'sawtooth', 0.18);
    drone(36.7, 'sawtooth', 0.14, 9);
    drone(55, 'triangle', 0.12);

    // Chord progression (D minor-ish, ominous).
    const chords = phase2
      ? [[146.8, 174.6, 220], [138.6, 164.8, 207.7], [130.8, 155.6, 196], [138.6, 174.6, 207.7]]
      : [[146.8, 174.6, 220], [116.5, 146.8, 174.6], [130.8, 164.8, 196], [110, 138.6, 164.8]];
    const bpm = phase2 ? 132 : 104;
    const beat = 60 / bpm;
    let step = 0;
    let next = ctx.currentTime + 0.1;
    let alive = true;
    const schedule = () => {
      if (!alive || !this.ctx) return;
      while (next < ctx.currentTime + 0.5) {
        const bar = Math.floor(step / 8);
        const s = step % 8;
        if (s === 0) {
          const chord = chords[bar % chords.length];
          for (const f of chord) {
            for (const det of [-7, 7]) {
              this.tone(out, next, beat * 8.2, { type: 'sawtooth', freq: f, gain: 0.025, attack: beat * 2, detune: det });
            }
            this.tone(out, next, beat * 8.2, { type: 'sine', freq: f * 2, gain: 0.02, attack: beat * 3 });
          }
        }
        // War drums
        const pattern = phase2 ? [1, 0, 1, 1, 1, 0, 1, 1] : [1, 0, 0, 1, 1, 0, 0, 0];
        if (pattern[s]) {
          const accent = s === 0 || s === 4;
          this.tone(out, next, 0.5, { type: 'sine', freq: accent ? 70 : 90, freqEnd: 38, gain: accent ? 0.55 : 0.35 });
          this.noise(out, next, 0.12, { type: 'lowpass', freq: 900, gain: accent ? 0.25 : 0.12 });
        }
        if (phase2 && s % 2 === 1) this.noise(out, next, 0.05, { type: 'highpass', freq: 6000, gain: 0.05 });
        next += beat / 2;
        step++;
      }
      setTimeout(schedule, 100);
    };
    schedule();
    this.music = {
      stop: () => {
        alive = false;
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
        setTimeout(() => {
          nodes.forEach((n) => n.stop());
          out.disconnect();
        }, 2700);
      },
    };
  }

  stopMusic(): void {
    if (this.music) {
      this.music.stop();
      this.music = null;
    }
  }
}

export const audio = new AudioEngine();
