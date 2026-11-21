/**
 * Estilo "Realista": el perro es un video de un perro de verdad (con fondo
 * transparente), uno por cada movimiento. Este módulo elige qué video mostrar
 * según lo que esté haciendo el perro, encadena las transiciones (sentarse,
 * levantarse) y lo ubica en pantalla.
 *
 * Los videos salen de scripts/clips/process.py (ver media/clips/LEEME.md).
 */
import manifest from '../../assets/dog/manifest.json';
import type { DogState } from './dog/dog';

type ClipName = keyof typeof manifest.clips;
type Clip = (typeof manifest.clips)[ClipName];

import type { Mask, MaskTable } from './masks';

/**
 * Las siluetas pesan más de 1 MB y solo cambian cuando cambian los videos, así
 * que viven en su propio archivo y se cargan aparte (sin frenar el arranque).
 * Mientras llegan, el perro se toca por su rectángulo.
 */
let MASKS: MaskTable | null = null;
let masksLoading: Promise<void> | null = null;
function loadMasks(): void {
  masksLoading ??= import('./masks').then((m) => {
    MASKS = m.MASKS;
  });
}
const decoded = new Map<string, Uint8Array>();
function bits(m: Mask, name: ClipName, frame: number): Uint8Array {
  const key = `${name}:${frame}`;
  let out = decoded.get(key);
  if (!out) {
    const raw = atob(m.frames[frame]);
    out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    if (decoded.size > 4000) decoded.clear();
    decoded.set(key, out);
  }
  return out;
}

/** Largo del perro (cola a nariz) en unidades del dibujo: así mide lo mismo que en los otros estilos. */
const DOG_LENGTH_UNITS = 175;
/** Las transiciones se aceleran: en el video original duran más de lo que conviene en pantalla. */
const TRANSITION_RATE = 1.7;

export interface VideoView {
  state: DogState;
  posture: 'stand' | 'sit' | 'lie' | 'sleep';
  facing: 1 | -1;
  squash: number;
  /** Rotación en pantalla (radianes) alrededor de `pivot`. */
  tilt: number;
  /** Punto agarrado, en píxeles relativos al punto de apoyo. */
  pivotX: number;
  pivotY: number;
  /** Cuánto dura el estado actual (el plato de comida dura más que un premio). */
  stateDur: number;
}

const WALK: DogState[] = ['walk', 'carry'];
/** Con la nariz en el suelo: olfatear, comer, recoger la pelota. */
const NOSE_DOWN: DogState[] = ['sniff', 'pickup', 'search'];
/** Velocidad de algunos videos que se ven una vez (comer dura más que la animación del perro). */
const RATE: Partial<Record<ClipName, number>> = { comer: 1.3 };
/** Fundido cuando se pasa de un video a otro sin transición filmada. */
const FADE_MS = 110;

type Pose = 'stand' | 'sit' | 'lie';
const RUN: DogState[] = ['run', 'fetch', 'chase'];

export class DogVideo {
  private readonly videos = new Map<ClipName, HTMLVideoElement>();
  private current: ClipName | null = null;
  /** Pose que se ve ahora (de pie o sentado), para saber si hace falta una transición. */
  private shownPose: Pose = 'stand';
  private transition: { clip: ClipName; then: ClipName } | null = null;
  private visible = true;
  private lastFacing: 1 | -1 = 1;
  /** Cómo quedó ubicado el video en el último cuadro (para pasar de pantalla a video y viceversa). */
  private place = { left: 0, top: 0, k: 1, flip: false, squash: 1, tilt: 0, px: 0, py: 0 };

  constructor(parent: HTMLElement, before: Element | null, base: string) {
    loadMasks();
    for (const name of Object.keys(manifest.clips) as ClipName[]) {
      const clip = manifest.clips[name];
      const v = document.createElement('video');
      v.className = 'dog-video';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.loop = clip.loop;
      v.poster = `${base}${clip.poster}`;
      v.src = `${base}${clip.file}`;
      v.style.width = `${clip.width}px`;
      v.style.height = `${clip.height}px`;
      v.style.visibility = 'hidden';
      v.addEventListener('ended', () => this.onEnded(name));
      parent.insertBefore(v, before);
      this.videos.set(name, v);
    }
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const [name, v] of this.videos) {
      v.style.display = on ? '' : 'none';
      if (!on) v.pause();
      else if (name === this.current) void v.play().catch(() => {});
    }
  }

  private frameOf(name: ClipName): number {
    const v = this.videos.get(name)!;
    const clip = manifest.clips[name];
    const n = MASKS?.[name].frames.length ?? clip.frames;
    return Math.min(n - 1, Math.max(0, Math.floor(v.currentTime * manifest.clips[name].fps))) % n;
  }

  /** Del video (px del recorte) a la pantalla. */
  private toScreen(u: number, w: number): { x: number; y: number } {
    const p = this.place;
    const x = p.flip ? p.left - u * p.k : p.left + u * p.k;
    const y = p.top + w * p.k * p.squash;
    const c = Math.cos(p.tilt), s = Math.sin(p.tilt);
    return { x: p.px + (x - p.px) * c - (y - p.py) * s, y: p.py + (x - p.px) * s + (y - p.py) * c };
  }

  /** ¿Hay perro en este punto de la pantalla? Usa la silueta real del cuadro que se ve ahora. */
  hitTest(sx: number, sy: number, pad = 4): boolean {
    const name = this.current;
    if (!name || !this.visible) return false;
    const p = this.place;
    const c = Math.cos(-p.tilt), s = Math.sin(-p.tilt);
    const x = p.px + (sx - p.px) * c - (sy - p.py) * s;
    const y = p.py + (sx - p.px) * s + (sy - p.py) * c;
    const u = p.flip ? (p.left - x) / p.k : (x - p.left) / p.k;
    const w = (y - p.top) / (p.k * p.squash);
    const m = MASKS?.[name];
    if (!m) {
      const clip = manifest.clips[name];
      return u >= -pad && u <= clip.width + pad && w >= -pad && w <= clip.height + pad;
    }
    const data = bits(m, name, this.frameOf(name));
    const r = Math.max(0, Math.ceil(pad / (p.k * m.cell)));
    const cx = Math.floor(u / m.cell), cy = Math.floor(w / m.cell);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const col = cx + dx, row = cy + dy;
        if (col < 0 || row < 0 || col >= m.cols || row >= m.rows) continue;
        const i = row * m.cols + col;
        if (data[i >> 3] & (0x80 >> (i & 7))) return true;
      }
    }
    return false;
  }

  /** Lo alto de la cabeza y la punta de la nariz, en pantalla (para globos, corazones y la boca). */
  landmarks(): { head: { x: number; y: number }; nose: { x: number; y: number } } | null {
    const name = this.current;
    const m = name && MASKS?.[name];
    if (!name || !m) return null;
    const f = this.frameOf(name);
    const [hx, hy] = m.head[f];
    const [nx, ny] = m.nose[f];
    return { head: this.toScreen(hx, hy), nose: this.toScreen(nx, ny) };
  }

  /** Para la sombra: dónde está el suelo, el ancho del cuerpo y cada pata apoyada, en pantalla. */
  shadow(): { groundY: number; x0: number; x1: number; feet: { x: number; w: number }[] } | null {
    const name = this.current;
    if (!name) return null;
    const m = MASKS?.[name];
    const clip = manifest.clips[name];
    const f = this.frameOf(name);
    const ground = this.toScreen(clip.anchorX, clip.anchorY);
    const span = m?.span?.[f] ?? [0, clip.width];
    const a = this.toScreen(span[0], clip.anchorY).x;
    const b = this.toScreen(span[1], clip.anchorY).x;
    const feet = (m?.feet?.[f] ?? []).map(([x, w]) => ({ x: this.toScreen(x, clip.anchorY).x, w: w * this.place.k }));
    return { groundY: ground.y, x0: Math.min(a, b), x1: Math.max(a, b), feet };
  }

  /** Velocidad del suelo en los videos con cinta, en unidades del dibujo por segundo (o null si no se midió). */
  static groundSpeeds(): { walk: number | null; run: number | null; sniff: number | null } {
    const toUnits = (px: number | null | undefined): number | null => (px ? (px * DOG_LENGTH_UNITS) / manifest.dogLengthPx : null);
    const c = manifest.clips as Record<string, { groundSpeed?: number | null }>;
    return { walk: toUnits(c.caminar?.groundSpeed), run: toUnits(c.correr?.groundSpeed), sniff: toUnits(c.olfatear?.groundSpeed) };
  }

  private target(view: VideoView): ClipName {
    if (view.state === 'eat') return 'comer';
    if (NOSE_DOWN.includes(view.state)) return 'olfatear';
    if (WALK.includes(view.state)) return 'caminar';
    if (RUN.includes(view.state)) return 'correr';
    if (view.posture === 'sleep') return 'dormir';
    if (view.posture === 'lie') return 'echado';
    if (view.posture === 'sit') return 'sentado';
    if (view.state === 'happy' || view.state === 'land') return 'feliz';
    if (view.state === 'bark') return 'ladrar';
    return 'quieto';
  }

  private poseOf(clip: ClipName): Pose {
    if (clip === 'sentado' || clip === 'sentarse') return 'sit';
    if (clip === 'echado' || clip === 'dormir') return 'lie';
    return 'stand';
  }

  private play(name: ClipName, rate = 1): void {
    if (this.current === name) return;
    const next = this.videos.get(name)!;
    const prev = this.current ? this.videos.get(this.current) : null;
    next.playbackRate = rate;
    if (!manifest.clips[name].loop) next.currentTime = 0;
    next.style.visibility = 'visible';
    if (prev) {
      // Fundido corto: el nuevo aparece encima mientras el anterior se desvanece.
      next.style.transition = 'none';
      next.style.opacity = '0';
      void next.offsetWidth;
      next.style.transition = `opacity ${FADE_MS}ms ease`;
      next.style.opacity = '1';
      // El anterior se va más rápido que lo que tarda en aparecer el nuevo: casi no se ve doble.
      prev.style.transition = `opacity ${Math.round(FADE_MS * 0.6)}ms ease-in`;
      prev.style.opacity = '0';
      setTimeout(() => {
        if (this.current !== name) return;
        prev.style.visibility = 'hidden';
        prev.pause();
      }, FADE_MS);
    }
    this.current = name;
    if (this.visible) void next.play().catch(() => {});
  }

  private onEnded(name: ClipName): void {
    if (this.transition && this.transition.clip === name) {
      const then = this.transition.then;
      this.transition = null;
      this.shownPose = this.poseOf(then);
      this.play(then);
    }
  }

  /** Coloca el video: `x, y` es el punto de apoyo en la ventana; `scale` el tamaño del perro. */
  update(view: VideoView, x: number, y: number, scale: number): void {
    const want = this.target(view);
    const dragging = view.state === 'drag' || view.state === 'fall';

    if (dragging) {
      // Levantado o cayendo: no hay video para eso; se usa el de estar de pie, inclinado.
      this.transition = null;
      this.shownPose = 'stand';
      this.play('quieto');
    } else if (!this.transition) {
      const wantPose = this.poseOf(want);
      // De pie ↔ sentado o echado: se usa el video de sentarse o levantarse. Entre sentado
      // y echado no hay transición filmada: basta el fundido.
      if (wantPose !== this.shownPose && (wantPose === 'stand' || this.shownPose === 'stand')) {
        const clip: ClipName = wantPose === 'stand' ? 'levantarse' : 'sentarse';
        this.transition = { clip, then: want };
        this.play(clip, TRANSITION_RATE);
      } else {
        this.shownPose = wantPose;
        // Comer del plato dura más: el video va a velocidad normal para que alcance.
        const rate = want === 'comer' && view.stateDur > 3 ? 1 : RATE[want] ?? 1;
        this.play(want, rate);
      }
    }

    const name = this.current ?? 'quieto';
    const clip: Clip = manifest.clips[name];
    const k = (DOG_LENGTH_UNITS * scale) / manifest.dogLengthPx;
    const flip = view.facing === -1;
    const left = flip ? x + clip.anchorX * k : x - clip.anchorX * k;
    const top = y - clip.anchorY * k * view.squash;
    const px = x + view.pivotX, py = y + view.pivotY;
    this.place = { left, top, k, flip, squash: view.squash, tilt: view.tilt, px, py };
    const v = this.videos.get(name)!;
    if (view.facing !== this.lastFacing) {
      // Al darse vuelta: un parpadeo breve disimula el espejo instantáneo.
      this.lastFacing = view.facing;
      v.style.transition = 'none';
      v.style.opacity = '0.25';
      void v.offsetWidth;
      v.style.transition = 'opacity 200ms ease-out';
      v.style.opacity = '1';
    }
    v.style.transform =
      `translate(${px}px, ${py}px) rotate(${view.tilt}rad) translate(${-px}px, ${-py}px) ` +
      `translate(${left}px, ${top}px) scale(${flip ? -k : k}, ${k * view.squash})`;
  }
}
