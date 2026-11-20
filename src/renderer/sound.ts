/** Ladridos sintetizados (sin archivos de audio). Solo suenan si los activas en Ajustes. */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return ctx;
  } catch {
    return null;
  }
}

function woof(a: AudioContext, t: number, pitch: number, volume: number): void {
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(volume, t + 0.012);
  out.gain.exponentialRampToValueAtTime(volume * 0.5, t + 0.07);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
  out.connect(a.destination);

  const body = a.createBiquadFilter();
  body.type = 'bandpass';
  body.frequency.setValueAtTime(1100 * pitch, t);
  body.frequency.exponentialRampToValueAtTime(600 * pitch, t + 0.15);
  body.Q.value = 1.4;
  body.connect(out);

  const voice = a.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(430 * pitch, t);
  voice.frequency.exponentialRampToValueAtTime(560 * pitch, t + 0.03);
  voice.frequency.exponentialRampToValueAtTime(240 * pitch, t + 0.18);
  voice.connect(body);
  voice.start(t);
  voice.stop(t + 0.2);

  if (noise) {
    const breath = a.createBufferSource();
    breath.buffer = noise;
    const g = a.createGain();
    g.gain.value = 0.45;
    breath.connect(g).connect(body);
    breath.start(t);
    breath.stop(t + 0.18);
  }
}

/** `times` ladridos seguidos, sincronizados con la animación (uno cada 0,42 s). */
export function bark(times = 1, volume = 0.22): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.02;
  for (let i = 0; i < times; i++) woof(a, t0 + i * 0.42, 1 + (Math.random() - 0.5) * 0.12, volume);
}

// ------------------------------------------------------------ ambiente

let ambientNodes: { stop(): void } | null = null;

function noiseBuffer(a: AudioContext, kind: 'brown' | 'pink', seconds = 6): AudioBuffer {
  const buf = a.createBuffer(2, Math.floor(a.sampleRate * seconds), a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      } else {
        b0 = 0.99765 * b0 + white * 0.099;
        b1 = 0.963 * b1 + white * 0.2965;
        b2 = 0.57 * b2 + white * 1.0526;
        d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
      }
    }
  }
  return buf;
}

/** Sonido ambiente para concentrarse, generado en el momento (sin archivos). */
export function setAmbient(kind: 'off' | 'rain' | 'waves' | 'brown', volume = 0.22): void {
  ambientNodes?.stop();
  ambientNodes = null;
  if (kind === 'off') return;
  const a = audio();
  if (!a) return;
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, a.currentTime);
  out.gain.exponentialRampToValueAtTime(volume, a.currentTime + 2.5);
  out.connect(a.destination);
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a, kind === 'rain' ? 'pink' : 'brown');
  src.loop = true;
  const timers: number[] = [];
  const extra: AudioScheduledSourceNode[] = [];

  if (kind === 'rain') {
    // Lluvia: ruido rosado filtrado más gotas sueltas.
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    src.connect(hp).connect(lp).connect(out);
    const drop = (): void => {
      const t = a.currentTime;
      const o = a.createOscillator();
      const g = a.createGain();
      o.frequency.setValueAtTime(1800 + Math.random() * 2500, t);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06 + Math.random() * 0.05, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.08);
      timers.push(window.setTimeout(drop, 40 + Math.random() * 260));
    };
    drop();
  } else if (kind === 'waves') {
    // Olas: ruido marrón que sube y baja despacio.
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const swell = a.createGain();
    swell.gain.value = 0.55;
    const lfo = a.createOscillator();
    lfo.frequency.value = 0.09;
    const depth = a.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(swell.gain);
    const lfo2 = a.createOscillator();
    lfo2.frequency.value = 0.09;
    const depth2 = a.createGain();
    depth2.gain.value = 500;
    lfo2.connect(depth2).connect(lp.frequency);
    src.connect(lp).connect(swell).connect(out);
    lfo.start();
    lfo2.start();
    extra.push(lfo, lfo2);
  } else {
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    src.connect(lp).connect(out);
  }
  src.start();
  extra.push(src);

  ambientNodes = {
    stop() {
      for (const t of timers) clearTimeout(t);
      const t = a.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      for (const n of extra) n.stop(t + 1.3);
      setTimeout(() => out.disconnect(), 1500);
    },
  };
}
