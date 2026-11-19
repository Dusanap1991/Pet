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
}

const WALK: DogState[] = ['walk', 'carry', 'pickup'];
/** Fundido cuando se pasa de un video a otro sin transición filmada. */
const FADE_MS = 280;

type Pose = 'stand' | 'sit' | 'lie';
const RUN: DogState[] = ['run', 'fetch', 'chase'];

export class DogVideo {
  private readonly videos = new Map<ClipName, HTMLVideoElement>();
  private current: ClipName | null = null;
  /** Pose que se ve ahora (de pie o sentado), para saber si hace falta una transición. */
  private shownPose: Pose = 'stand';
  private transition: { clip: ClipName; then: ClipName } | null = null;
  private visible = true;

  constructor(parent: HTMLElement, before: Element | null, base: string) {
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

  private target(view: VideoView): ClipName {
    if (view.state === 'sniff') return 'olfatear';
    if (WALK.includes(view.state)) return 'caminar';
    if (RUN.includes(view.state)) return 'correr';
    if (view.posture === 'sleep') return 'dormir';
    if (view.posture === 'lie') return 'echado';
    if (view.posture === 'sit') return 'sentado';
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
      prev.style.transition = `opacity ${FADE_MS}ms ease`;
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
        this.play(want);
      }
    }

    const name = this.current ?? 'quieto';
    const clip: Clip = manifest.clips[name];
    const k = (DOG_LENGTH_UNITS * scale) / manifest.dogLengthPx;
    const flip = view.facing === -1;
    const left = flip ? x + clip.anchorX * k : x - clip.anchorX * k;
    const top = y - clip.anchorY * k * view.squash;
    const px = x + view.pivotX, py = y + view.pivotY;
    const v = this.videos.get(name)!;
    v.style.transform =
      `translate(${px}px, ${py}px) rotate(${view.tilt}rad) translate(${-px}px, ${-py}px) ` +
      `translate(${left}px, ${top}px) scale(${flip ? -k : k}, ${k * view.squash})`;
  }
}
