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
