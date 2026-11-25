/**
 * Fully synthesized Web Audio sound. Every one-shot is pitched and stretched by
 * the current time scale, and a master low-pass + echo send closes in as time slows.
 */
interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  to?: number;
  attack?: number;
  pan?: number;
  delay?: number;
  raw?: boolean;
}
interface NoiseOpts {
  vol?: number;
  type?: BiquadFilterType;
  f?: number;
  to?: number;
  q?: number;
  pan?: number;
  attack?: number;
  delay?: number;
}

export class Sfx {
  ctx: AudioContext | null = null;
  rate = 1;
  private out!: GainNode;
  private lp!: BiquadFilterNode;
  private bus!: GainNode;
  private wet!: GainNode;
  private noiseBuf!: AudioBuffer;
  private drones: OscillatorNode[] = [];
  private droneBase: number[] = [];
  private windF!: BiquadFilterNode;
  private windG!: GainNode;

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = 0.85;
    this.out.connect(comp);

    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.lp.Q.value = 1.2;
    this.lp.connect(this.out);

    this.bus = ctx.createGain();
    this.bus.connect(this.lp);

    // Echo send – grows as time slows
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.21;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 1800;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.1;
    this.bus.connect(this.wet);
    this.wet.connect(delay);
    delay.connect(dlp);
    dlp.connect(fb);
    fb.connect(delay);
    dlp.connect(this.lp);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Wind bed
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.frequency.value = 500;
    this.windF.Q.value = 0.7;
    this.windG = ctx.createGain();
    this.windG.gain.value = 0.04;
    wind.connect(this.windF);
    this.windF.connect(this.windG);
    this.windG.connect(this.lp);
    wind.start();

    // Low drone that sags with time
    const droneG = ctx.createGain();
    droneG.gain.value = 0.03;
    const droneF = ctx.createBiquadFilter();
    droneF.type = 'lowpass';
    droneF.frequency.value = 380;
    droneF.connect(droneG);
    droneG.connect(this.lp);
    for (const f of [55, 82.6, 110.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(droneF);
      o.start();
      this.drones.push(o);
      this.droneBase.push(f);
    }
  }

  setTimeScale(ts: number): void {
    ts = Math.max(0, Math.min(1, ts));
    this.rate = 0.42 + 0.58 * ts;
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.lp.frequency.setTargetAtTime(320 + 17000 * ts * ts, t, 0.05);
    this.wet.gain.setTargetAtTime(0.08 + 0.4 * (1 - ts), t, 0.1);
    this.windG.gain.setTargetAtTime(0.015 + 0.06 * ts, t, 0.1);
    this.windF.frequency.setTargetAtTime(220 + 800 * ts, t, 0.1);
    this.drones.forEach((o, i) => o.frequency.setTargetAtTime(this.droneBase[i] * (0.6 + 0.4 * ts), t, 0.1));
  }

  private tone(freq: number, dur: number, o: ToneOpts = {}): void {
    try {
      this.toneRaw(freq, dur, o);
    } catch {
      /* never let audio break the game */
    }
  }

  private toneRaw(freq: number, dur: number, o: ToneOpts): void {
    const c = this.ctx;
    if (!c) return;
    const r = o.raw ? 1 : Math.max(0.3, this.rate);
    const t0 = Math.max(0, c.currentTime) + Math.max(0, o.delay ?? 0);
    const d = o.raw ? dur : dur / (0.45 + 0.55 * r);
    const a = o.attack ?? 0.004;
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq * r, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to * r, t0 + a + d);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.2, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    const p = c.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    osc.connect(g);
    g.connect(p);
    p.connect(o.raw ? this.out : this.bus);
    osc.start(t0);
    osc.stop(t0 + a + d + 0.05);
  }

  private noise(dur: number, o: NoiseOpts = {}): void {
    try {
      this.noiseRaw(dur, o);
    } catch {
      /* never let audio break the game */
    }
  }

  private noiseRaw(dur: number, o: NoiseOpts): void {
    const c = this.ctx;
    if (!c) return;
    const r = Math.max(0.3, this.rate);
    const t0 = Math.max(0, c.currentTime) + Math.max(0, o.delay ?? 0);
    const d = dur / (0.45 + 0.55 * r);
    const a = o.attack ?? 0.003;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.6 + 0.4 * r;
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime((o.f ?? 1000) * r, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to * r, t0 + a + d);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    const p = c.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    src.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(this.bus);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + a + d + 0.05);
  }

  swing(): void {
    this.noise(0.17, { f: 500, to: 2600, q: 1.4, vol: 0.32 });
    this.tone(200, 0.1, { type: 'triangle', to: 90, vol: 0.05 });
  }
  shatter(pan = 0): void {
    this.noise(0.4, { type: 'highpass', f: 2800, vol: 0.45, pan });
    this.tone(130, 0.25, { to: 40, vol: 0.35, pan });
    for (let i = 0; i < 7; i++) {
      this.tone(1700 + Math.random() * 3600, 0.25 + Math.random() * 0.6, { vol: 0.05 + Math.random() * 0.05, pan, delay: Math.random() * 0.08 });
    }
  }
  clang(perfect: boolean): void {
    const m = perfect ? 1.25 : 1;
    for (const f of [523, 1342, 2207, 3171]) this.tone(f * m, perfect ? 0.9 : 0.55, { type: 'triangle', vol: 0.11 });
    this.noise(0.08, { type: 'highpass', f: 2500, vol: 0.35 });
  }
  arrowShot(pan = 0): void {
    this.tone(240, 0.14, { type: 'triangle', to: 170, vol: 0.18, pan });
    this.noise(0.22, { f: 1800, to: 900, q: 2, vol: 0.12, pan });
  }
  orbCast(pan = 0): void {
    this.tone(280, 0.4, { type: 'sawtooth', to: 900, vol: 0.06, pan });
    this.tone(560, 0.35, { to: 1800, vol: 0.06, pan });
  }
  fireball(): void {
    this.noise(0.5, { type: 'lowpass', f: 350, to: 1600, vol: 0.45 });
    this.tone(90, 0.35, { type: 'sawtooth', to: 170, vol: 0.08 });
  }
  explosion(pan = 0): void {
    this.noise(1.1, { type: 'lowpass', f: 1200, to: 70, vol: 0.7, q: 0.7, pan });
    this.tone(75, 0.8, { to: 28, vol: 0.5, pan });
  }
  push(): void {
    this.tone(170, 0.55, { to: 38, vol: 0.5 });
    this.noise(0.45, { f: 300, to: 3500, q: 0.8, vol: 0.35 });
  }
  thunk(pan = 0): void {
    this.tone(150, 0.08, { type: 'triangle', to: 70, vol: 0.12, pan });
    this.noise(0.05, { f: 900, vol: 0.12, pan });
  }
  fizz(pan = 0): void {
    this.noise(0.25, { type: 'highpass', f: 1500, to: 5000, vol: 0.15, pan });
  }
  spawn(pan = 0): void {
    this.tone(1200, 0.5, { to: 300, vol: 0.05, pan });
    this.tone(1800, 0.5, { to: 450, vol: 0.03, pan, delay: 0.04 });
  }
  death(): void {
    this.tone(320, 1.6, { type: 'sawtooth', to: 35, vol: 0.22 });
    this.noise(1.3, { type: 'lowpass', f: 2500, to: 90, vol: 0.55 });
    this.shatter(0);
  }
  empty(): void {
    this.tone(110, 0.09, { type: 'square', vol: 0.04 });
  }
  waveStart(): void {
    [220, 277.2, 329.6].forEach((f, i) => this.tone(f, 1.1, { type: 'triangle', vol: 0.07, delay: i * 0.07, raw: true }));
  }
  victory(): void {
    [330, 415.3, 494, 659.3, 830.6].forEach((f, i) => this.tone(f, 1.2, { type: 'triangle', vol: 0.08, delay: i * 0.12, raw: true }));
  }
  heartbeat(vol: number): void {
    this.tone(58, 0.13, { to: 34, vol: vol * 0.9, raw: true });
    this.tone(52, 0.13, { to: 30, vol: vol * 0.6, raw: true, delay: 0.17 });
  }
  hit(pan = 0): void {
    this.noise(0.09, { type: 'highpass', f: 1800, vol: 0.3, pan });
    this.tone(320, 0.12, { type: 'triangle', to: 120, vol: 0.2, pan });
    this.tone(2400 + Math.random() * 1200, 0.2, { vol: 0.05, pan });
  }
  freeze(pan = 0): void {
    this.noise(0.5, { type: 'highpass', f: 5000, to: 1800, vol: 0.22, pan });
    for (let i = 0; i < 5; i++) this.tone(2200 + i * 420, 0.5, { to: 1500 + i * 300, vol: 0.05, pan, delay: i * 0.03 });
  }
  zap(pan = 0): void {
    this.noise(0.16, { f: 3200, q: 6, vol: 0.4, pan });
    this.tone(1100, 0.18, { type: 'sawtooth', to: 160, vol: 0.12, pan });
    this.noise(0.3, { type: 'lowpass', f: 600, to: 120, vol: 0.25, pan, delay: 0.04 });
  }
  hurt(): void {
    this.tone(210, 0.5, { type: 'sawtooth', to: 55, vol: 0.25 });
    this.noise(0.4, { type: 'lowpass', f: 1800, to: 150, vol: 0.5 });
  }
  catchArrow(): void {
    this.tone(180, 0.06, { type: 'triangle', to: 90, vol: 0.2 });
    this.tone(740, 0.16, { type: 'triangle', to: 1180, vol: 0.12, delay: 0.03 });
  }
  immune(pan = 0): void {
    this.tone(190, 0.12, { type: 'square', to: 150, vol: 0.06, pan });
    this.noise(0.08, { f: 700, q: 3, vol: 0.12, pan });
  }
  levelUp(): void {
    [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, 0.9, { type: 'triangle', vol: 0.08, delay: i * 0.07, raw: true }));
  }
  click(): void {
    this.tone(660, 0.06, { type: 'triangle', vol: 0.06, raw: true });
  }
}
