import type { Fx } from '../fx';
import { drawDog, drawDogFront, frontHeight, type DrawExtras } from './draw';
import { LIE, SIT, SLEEP, STAND, approachPose, clonePose, type Pose } from './pose';

export type DogState =
  | 'idle' | 'walk' | 'sniff' | 'run' | 'sit' | 'lie' | 'sleep'
  | 'alert' | 'eat' | 'happy' | 'bark' | 'drag' | 'fall' | 'land';

type Posture = 'stand' | 'sit' | 'lie' | 'sleep';

/** El "mundo" en píxeles CSS de la ventana. */
export interface World {
  width: number;
  floorY: number;
  cursorX: number;
  cursorY: number;
  cursorKnown: boolean;
}

export interface TreatTarget {
  x: number;
  landed: boolean;
}

export interface DogHooks {
  say(text: string, ms?: number): void;
  /** El premio más cercano que ya está en el suelo, si hay. */
  nearestTreat(x: number): TreatTarget | null;
  eatTreat(t: TreatTarget): void;
}

const TAU = Math.PI * 2;
const GRAVITY = 2300;
/** Distancia (en unidades del perro) entre su centro y la punta del hocico con la cabeza abajo. */
const MOUTH_REACH = 86;
/** Punto de la nuca del que cuelga al levantarlo, en unidades del perro. */
const SCRUFF_X = 25;
const SCRUFF_Y = -58;
/** Inclinación máxima (radianes) cuando cuelga del pellejo. */
const HANG_MAX = 0.4;
/** Altura (en unidades del perro) a la que gira para quedar colgando de frente, y a la que vuelve de lado. */
const FRONT_ON = 92;
const FRONT_OFF = 68;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

const POSTURES: Record<Posture, Pose> = { stand: STAND, sit: SIT, lie: LIE, sleep: SLEEP };

/** Cuánto y qué tan rápido mueve la cola en cada estado: [amplitud, frecuencia]. */
const WAG: Record<DogState, [number, number]> = {
  idle: [0.1, 5], walk: [0.18, 7], sniff: [0.2, 8], run: [0.25, 10], sit: [0.16, 6],
  lie: [0.06, 3], sleep: [0, 2], alert: [0.04, 4], eat: [0.45, 13], happy: [0.6, 17],
  bark: [0.3, 12], drag: [0, 4], fall: [0, 4], land: [0.12, 6],
};

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Desplazamiento de una pata según la fase del paso: apoyo (va hacia atrás) y vuelo (avanza levantada). */
function footOffset(phase: number, stride: number, lift: number): [number, number] {
  const ph = ((phase % 1) + 1) % 1;
  if (ph < 0.5) return [stride / 2 - stride * (ph / 0.5), 0];
  const u = (ph - 0.5) / 0.5;
  const e = u * u * (3 - 2 * u);
  return [-stride / 2 + stride * e, -lift * Math.sin(Math.PI * u)];
}

export class Dog {
  x = 0;
  y = 0;
  facing: 1 | -1 = -1;
  scale: number;
  state: DogState = 'idle';

  private stateT = 0;
  private stateDur = 2;
  private posture: Posture = 'stand';
  private pose: Pose = clonePose(STAND);
  private render: Pose = clonePose(STAND);
  private t = 0;

  private vx = 0;
  private vy = 0;
  private faceVis = -1;
  private targetX = 0;
  private gaitPhase = 0;
  private gait = 0;
  private stride = 13;
  private lift = 5;

  private wagAmp = 0.1;
  private wagFreq = 5;
  private wagPhase = 0;
  private blinkIn = 3;
  private blinkT = 0;

  private rot = 0;
  private rotV = 0;
  private rotTarget = 0;
  private squash = 1;
  private squashV = 0;
  private grabDX = 0;
  private grabDY = 0;
  /** 0..1: cuánto cuelga del pellejo (crece al separarlo del suelo). */
  private hang = 0;
  /** true cuando está lo bastante alto como para verse de frente. */
  private frontOn = false;
  /** 0 = de lado, 1 = de frente (pasa por 0,5 como un giro de papel). */
  private front = 0;
  /** Lo soltaron estando de frente: cae y aterriza sentado mirando hacia afuera. */
  private frontFall = false;
  private frontSit = 0;
  private frontScruff = 0;
  private frontEars = 0;

  private awayMode = false;
  private focusMode = false;
  private goalTreat: TreatTarget | null = null;
  private ate = false;
  private fxTimer = 0;
  private lookBehindT = 0;
  private world: World = { width: 800, floorY: 600, cursorX: 0, cursorY: 0, cursorKnown: false };

  constructor(scale: number, private fx: Fx, private hooks: DogHooks) {
    this.scale = scale;
  }

  // ---------------------------------------------------------------- estado

  /** true si conviene dibujar a pocos cuadros por segundo. */
  get calm(): boolean {
    return this.state === 'idle' || this.state === 'sit' || this.state === 'lie' || this.state === 'sleep';
  }

  get sleeping(): boolean {
    return this.state === 'sleep';
  }

  get dragging(): boolean {
    return this.state === 'drag';
  }

  /** Posición de la cabeza respecto del punto de apoyo, en píxeles. */
  headOffset(): { x: number; y: number } {
    return { x: this.pose.headX * this.facing * this.scale, y: this.pose.headY * this.scale };
  }

  place(x: number, world: World): void {
    this.world = world;
    this.x = x;
    this.y = world.floorY;
  }

  setScale(scale: number): void {
    this.scale = scale;
  }

  private enter(state: DogState, dur = 0): void {
    this.state = state;
    this.stateT = 0;
    this.stateDur = dur;
    this.fxTimer = 0;
    switch (state) {
      case 'sit': this.posture = 'sit'; break;
      case 'lie': this.posture = 'lie'; break;
      case 'sleep': this.posture = 'sleep'; break;
      case 'happy':
      case 'bark':
        if (this.posture === 'sleep') this.posture = 'lie';
        break;
      default: this.posture = 'stand';
    }
    if (state === 'walk') { this.stride = 13; this.lift = 5; }
    if (state === 'sniff') { this.stride = 9; this.lift = 3; }
    if (state === 'run') { this.stride = 21; this.lift = 8; }
    if (state === 'eat') this.ate = false;
  }

  /** Vuelve a la rutina después de una interrupción (caricia, ladrido). */
  private resume(): void {
    if (this.awayMode) this.enter('lie', 1.2);
    else if (this.posture === 'sit') this.enter('sit', rand(4, 9));
    else if (this.posture === 'lie' || this.posture === 'sleep') this.enter('lie', rand(5, 12));
    else this.enter('idle', rand(1, 3));
  }

  private bounds(): [number, number] {
    const m = 70 * this.scale;
    return [m, Math.max(m, this.world.width - m)];
  }

  // ------------------------------------------------------------ interacción

  /** ¿El punto (en píxeles de la ventana) cae sobre el perro? */
  hitTest(px: number, py: number): boolean {
    const lx = (px - this.x) / (this.scale * this.facing);
    const ly = (py - this.y) / this.scale;
    const p = this.pose;
    const pad = 5;
    if (distToSegment(lx, ly, p.rumpX, p.rumpY, p.chestX, p.chestY) < 17 + pad) return true;
    if (Math.hypot(lx - p.headX, ly - p.headY) < 16.5 + pad) return true;
    const sx = p.headX + 9, sy = p.headY + 3.5;
    if (distToSegment(lx, ly, sx, sy, sx + Math.cos(p.snoutAng) * 28, sy + Math.sin(p.snoutAng) * 28) < 9 + pad) return true;
    if (distToSegment(lx, ly, p.chestX + 4, p.chestY - 7, p.headX - 3, p.headY + 5) < 12 + pad) return true;
    return lx > p.rumpX - 12 && lx < p.chestX + 12 && ly > p.rumpY && ly < 3;
  }

  /** Una caricia. */
  pet(): void {
    if (this.state === 'drag' || this.state === 'fall' || this.state === 'land' || this.state === 'eat') return;
    if (this.state === 'run' || this.state === 'alert') return;
    this.enter('happy', 1.9);
    this.spawnHeart();
  }

  grab(cx: number, cy: number): void {
    this.grabDX = cx - this.x;
    this.grabDY = cy - this.y;
    this.vx = 0;
    this.vy = 0;
    this.enter('drag');
  }

  dragTo(cx: number, cy: number, dt: number): void {
    if (this.state !== 'drag') return;
    // El agarre se desliza hasta la nuca: siempre termina colgando del pellejo.
    const slide = 1 - Math.exp(-14 * dt);
    this.grabDX += (SCRUFF_X * this.scale * this.facing - this.grabDX) * slide;
    this.grabDY += (SCRUFF_Y * this.scale - this.grabDY) * slide;
    const edge = this.bounds()[0] * 0.4;
    const nx = clamp(cx - this.grabDX, edge, this.world.width - edge);
    const ny = Math.min(cy - this.grabDY, this.world.floorY);
    if (dt > 0) {
      const k = 0.35;
      this.vx += ((nx - this.x) / dt - this.vx) * k;
      this.vy += ((ny - this.y) / dt - this.vy) * k;
    }
    this.x = nx;
    this.y = ny;
  }

  release(): void {
    if (this.state !== 'drag') return;
    this.vx = clamp(this.vx, -1500, 1500);
    this.vy = clamp(this.vy, -1500, 1500);
    this.frontFall = this.frontOn;
    if (this.frontFall) {
      // De frente se dibuja desde los pies: el punto de apoyo pasa a estar bajo el perro colgado.
      this.x += this.grabDX;
      this.y = Math.min(this.y + this.grabDY + frontHeight(0) * this.scale, this.world.floorY);
      this.grabDX = 0;
      this.grabDY = 0;
    }
    this.enter('fall');
  }

  // --------------------------------------------------- avisos desde la app

  onAway(): void {
    this.awayMode = true;
    if (this.state === 'idle' || this.state === 'walk' || this.state === 'sniff' || this.state === 'sit') {
      this.enter('lie', 1.2);
    } else if (this.state === 'lie') {
      this.stateDur = Math.min(this.stateDur, this.stateT + 1.2);
    }
  }

  onBack(awaySec: number, greeting: string): void {
    const wasResting = this.awayMode && (this.state === 'sleep' || this.state === 'lie');
    this.awayMode = false;
    if (!wasResting) return;
    if (awaySec >= 300) {
      this.posture = 'stand';
      this.hooks.say(greeting, 4500);
      this.enter('happy', 2.4);
      this.spawnHeart();
    } else {
      this.enter('idle', rand(1, 2));
    }
  }

  /** Ladra para llamar la atención y muestra un mensaje. */
  remind(text: string, ms = 9000): void {
    if (this.state === 'drag' || this.state === 'fall') {
      this.hooks.say(text, ms);
      return;
    }
    this.posture = 'stand';
    this.hooks.say(text, ms);
    this.enter('bark', 1.4);
  }

  focusStart(text: string): void {
    this.focusMode = true;
    this.remind(text, 5000);
  }

  focusEnd(text: string | null): void {
    this.focusMode = false;
    if (text) this.remind(text);
    else if (this.state === 'lie' || this.state === 'sleep') this.enter('idle', rand(1, 2));
  }

  // -------------------------------------------------------------- lógica

  update(dt: number, world: World): void {
    this.world = world;
    this.t += dt;
    this.stateT += dt;

    this.think(dt);

    const airborne = this.state === 'drag' || this.state === 'fall';
    if (!airborne) {
      this.y = world.floorY;
      const [lo, hi] = this.bounds();
      this.x = clamp(this.x, lo, hi);
    }

    // Pose: se acerca suavemente al objetivo del estado actual.
    approachPose(this.pose, this.targetPose(), dt, 9, 30);

    // Giro "de papel" al cambiar de lado.
    this.faceVis += (this.facing - this.faceVis) * (1 - Math.exp(-16 * dt));

    // Marcha: las patas se mueven según la distancia recorrida, así no patinan.
    const moving = this.state === 'walk' || this.state === 'sniff' || this.state === 'run';
    this.gait += ((moving ? 1 : 0) - this.gait) * (1 - Math.exp(-12 * dt));

    // Cola.
    const [amp, freq] = WAG[this.state];
    this.wagAmp += (amp - this.wagAmp) * (1 - Math.exp(-8 * dt));
    this.wagFreq += (freq - this.wagFreq) * (1 - Math.exp(-8 * dt));
    this.wagPhase += this.wagFreq * dt;

    // Parpadeo.
    this.blinkIn -= dt;
    this.blinkT -= dt;
    if (this.blinkIn <= 0) {
      this.blinkT = 0.13;
      this.blinkIn = rand(2.2, 6);
    }

    // Resortes: balanceo al ser arrastrado y aplastamiento al caer.
    this.rotTarget = this.state === 'drag' ? clamp(-this.vx * 0.0011, -0.55, 0.55) : 0;
    this.rotV += ((this.rotTarget - this.rot) * 90 - this.rotV * 11) * dt;
    this.rot += this.rotV * dt;
    const hangTarget = this.state === 'drag' ? clamp((world.floorY - this.y) / (70 * this.scale), 0, 1) : 0;
    this.hang += (hangTarget - this.hang) * (1 - Math.exp(-(this.state === 'drag' ? 9 : 16) * dt));
    const lift = (world.floorY - this.y) / this.scale;
    if (this.state !== 'drag') this.frontOn = false;
    else if (lift > FRONT_ON) this.frontOn = true;
    else if (lift < FRONT_OFF) this.frontOn = false;
    if (this.state !== 'fall' && this.state !== 'land') this.frontFall = false;
    const ease = (rate: number): number => 1 - Math.exp(-rate * dt);
    this.front += ((this.frontOn || this.frontFall ? 1 : 0) - this.front) * ease(14);
    const held = this.state === 'drag';
    this.frontSit += ((held || this.state === 'fall' ? 0 : 1) - this.frontSit) * ease(16);
    this.frontScruff += ((held ? 1 : 0) - this.frontScruff) * ease(16);
    this.frontEars += ((this.state === 'fall' ? 1 : 0) - this.frontEars) * ease(12);
    this.squashV += (-(this.squash - 1) * 320 - this.squashV * 16) * dt;
    this.squash += this.squashV * dt;

    this.buildRenderPose();
  }

  private think(dt: number): void {
    switch (this.state) {
      case 'idle':
        if (this.noticeTreat()) return;
        this.turnTowardCursor(dt);
        if (this.stateT >= this.stateDur) this.chooseFromIdle();
        break;

      case 'walk':
        if (this.noticeTreat()) return;
        if (this.moveToward(dt, 42)) this.enter('idle', rand(1.5, 5));
        break;

      case 'sniff':
        if (this.noticeTreat()) return;
        if (this.moveToward(dt, 20)) this.enter('idle', rand(1.5, 4));
        break;

      case 'sit':
        if (this.noticeTreat()) return;
        if (this.stateT >= this.stateDur) {
          const r = Math.random();
          if (this.awayMode || this.focusMode || r < 0.3) this.enter('lie', rand(8, 18));
          else if (r < 0.85) this.enter('idle', rand(1.5, 4));
          else this.enter('sit', rand(4, 8));
        }
        break;

      case 'lie':
        if (this.noticeTreat()) return;
        if (this.stateT >= this.stateDur) {
          const r = Math.random();
          if (this.awayMode) this.enter('sleep');
          else if (this.focusMode) r < 0.35 ? this.enter('sleep', rand(20, 45)) : this.enter('lie', rand(20, 40));
          else if (r < 0.4) this.enter('sleep', rand(25, 70));
          else if (r < 0.88) this.enter('idle', rand(1.5, 4));
          else this.enter('lie', rand(6, 12));
        }
        break;

      case 'sleep':
        if (!this.awayMode && this.noticeTreat()) return;
        this.fxTimer -= dt;
        if (this.fxTimer <= 0) {
          const h = this.headOffset();
          this.fx.z(h.x + 4 * this.scale * this.facing, h.y - 20 * this.scale, this.scale);
          this.fxTimer = 1.5;
        }
        if (!this.awayMode && this.stateT >= this.stateDur) this.enter('lie', rand(2, 4));
        break;

      case 'alert':
        if (this.goalTreat) this.facing = this.goalTreat.x >= this.x ? 1 : -1;
        if (this.stateT >= this.stateDur) this.enter(this.goalTreat ? 'run' : 'idle', 1);
        break;

      case 'run': {
        const treat = this.goalTreat;
        if (!treat) {
          this.enter('idle', 1);
          break;
        }
        const reach = MOUTH_REACH * this.scale;
        // Se detiene con el hocico sobre el premio, del lado desde el que viene.
        const side = treat.x >= this.x ? 1 : -1;
        this.targetX = treat.x - side * reach;
        const [lo, hi] = this.bounds();
        if (this.targetX < lo || this.targetX > hi) this.targetX = treat.x + side * reach;
        if (this.moveToward(dt, 175)) {
          this.facing = treat.x >= this.x ? 1 : -1;
          this.enter('eat', 1.9);
        }
        break;
      }

      case 'eat': {
        const treat = this.goalTreat;
        this.fxTimer -= dt;
        if (!this.ate && this.fxTimer <= 0 && this.stateT > 0.25) {
          const m = this.mouthOffset();
          this.fx.crumb(m.x, m.y, this.scale);
          this.fxTimer = 0.09;
        }
        if (!this.ate && this.stateT >= this.stateDur * 0.6) {
          this.ate = true;
          if (treat) this.hooks.eatTreat(treat);
          this.goalTreat = null;
        }
        if (this.stateT >= this.stateDur) {
          this.enter('happy', 1.6);
          this.spawnHeart();
        }
        break;
      }

      case 'happy':
        this.fxTimer += dt;
        if (this.fxTimer >= 0.38) {
          this.fxTimer = 0;
          this.spawnHeart();
        }
        if (this.stateT >= this.stateDur) this.resume();
        break;

      case 'bark':
        if (this.stateT >= this.stateDur) this.resume();
        break;

      case 'drag':
        break;

      case 'fall': {
        this.vy += GRAVITY * dt;
        this.vx *= Math.exp(-1.2 * dt);
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const [lo, hi] = this.bounds();
        if (this.x < lo) { this.x = lo; this.vx = Math.abs(this.vx) * 0.4; }
        if (this.x > hi) { this.x = hi; this.vx = -Math.abs(this.vx) * 0.4; }
        if (this.y >= this.world.floorY) {
          this.y = this.world.floorY;
          this.squash = clamp(1 - this.vy / 3600, 0.62, 0.97);
          this.squashV = 0;
          this.vx = 0;
          this.vy = 0;
          this.enter('land', this.frontFall ? 1.3 : 0.4);
        }
        break;
      }

      case 'land':
        if (this.stateT >= this.stateDur) {
          // Tras caer sentado de frente, se para y sale caminando.
          if (this.frontFall) this.startWalk();
          else this.enter('idle', rand(0.8, 2));
        }
        break;
    }
  }

  private chooseFromIdle(): void {
    if (this.awayMode) return this.enter('lie', 1.2);
    if (this.focusMode) return this.enter('lie', rand(20, 40));
    const r = Math.random();
    if (r < 0.45) this.startWalk();
    else if (r < 0.62) this.startSniff();
    else if (r < 0.82) this.enter('sit', rand(5, 11));
    else if (r < 0.94) this.enter('lie', rand(8, 18));
    else this.enter('idle', rand(1.5, 4));
  }

  private startWalk(): void {
    const [lo, hi] = this.bounds();
    const minDist = 90 * this.scale;
    let tx = rand(lo, hi);
    if (Math.abs(tx - this.x) < minDist) {
      tx = this.x - lo > hi - this.x ? this.x - rand(minDist, minDist * 3) : this.x + rand(minDist, minDist * 3);
    }
    this.targetX = clamp(tx, lo, hi);
    this.enter('walk');
  }

  private startSniff(): void {
    const [lo, hi] = this.bounds();
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.targetX = clamp(this.x + dir * rand(60, 170) * this.scale, lo, hi);
    this.enter('sniff');
  }

  /** Si hay un premio en el suelo, se pone alerta y va por él. */
  private noticeTreat(): boolean {
    const treat = this.hooks.nearestTreat(this.x);
    if (!treat) return false;
    this.goalTreat = treat;
    this.enter('alert', 0.5);
    this.facing = treat.x >= this.x ? 1 : -1;
    const h = this.headOffset();
    this.fx.bang(h.x, h.y - 34 * this.scale, this.scale);
    return true;
  }

  /** Avanza hacia `targetX`; devuelve true al llegar. */
  private moveToward(dt: number, speed: number): boolean {
    const dx = this.targetX - this.x;
    const step = speed * this.scale * dt;
    const dist = Math.min(Math.abs(dx), step);
    this.gaitPhase = (this.gaitPhase + dist / this.scale / (2 * this.stride)) % 1;
    if (Math.abs(dx) <= step) {
      this.x = this.targetX;
      return true;
    }
    this.facing = dx > 0 ? 1 : -1;
    this.x += Math.sign(dx) * step;
    return false;
  }

  /** Parado y quieto: si el cursor lleva un rato a su espalda, se da vuelta. */
  private turnTowardCursor(dt: number): void {
    const w = this.world;
    if (!w.cursorKnown) return;
    const dx = (w.cursorX - this.x) * this.facing;
    const near = Math.hypot(w.cursorX - this.x, w.cursorY - this.y) < 420 * this.scale;
    if (near && dx < -50 * this.scale) {
      this.lookBehindT += dt;
      if (this.lookBehindT > 0.7) {
        this.facing = this.facing === 1 ? -1 : 1;
        this.lookBehindT = 0;
      }
    } else {
      this.lookBehindT = 0;
    }
  }

  private spawnHeart(): void {
    const h = this.headOffset();
    this.fx.heart(h.x, h.y - 22 * this.scale, this.scale);
  }

  private mouthOffset(): { x: number; y: number } {
    const p = this.pose;
    const mx = p.headX + 9 + Math.cos(p.snoutAng) * 26;
    const my = p.headY + 3.5 + Math.sin(p.snoutAng) * 26 + 5;
    return { x: mx * this.facing * this.scale, y: my * this.scale };
  }

  // ----------------------------------------------------------------- pose

  private targetPose(): Pose {
    const tp = clonePose(POSTURES[this.posture]);
    const st = this.stateT;

    switch (this.state) {
      case 'sniff':
        tp.headX = 59;
        tp.headY = -27;
        tp.snoutAng = 0.62 + 0.05 * Math.sin(this.t * 22);
        tp.earAng = 0.05;
        break;
      case 'eat':
        tp.headX = 60;
        tp.headY = -25;
        tp.snoutAng = 0.72;
        tp.earAng = 0;
        tp.mouthOpen = st < this.stateDur * 0.85 ? (Math.sin(st * 20) > 0 ? 0.55 : 0.08) : 0;
        break;
      case 'alert':
        tp.headY -= 4;
        tp.earAng = -0.35;
        tp.eyeOpen = 1.3;
        tp.tailAng = -2.15;
        break;
      case 'run':
        tp.earAng = 0.95;
        tp.tailAng = -2.95;
        tp.tailCurl = 0.12;
        tp.mouthOpen = 0.3;
        tp.tongue = 0.9;
        tp.headX += 3;
        tp.headY += 3;
        break;
      case 'happy': {
        tp.eyeHappy = 1;
        tp.mouthOpen = 0.4;
        tp.tongue = 1;
        if (this.posture === 'stand') {
          const hop = Math.abs(Math.sin(st * 9));
          tp.chestY -= 3 * hop;
          tp.headY -= 5 * hop;
          tp.ffy -= 3 * hop;
          tp.ffy2 -= 3 * hop;
        } else {
          tp.headY -= 2;
        }
        break;
      }
      case 'bark': {
        const cycle = st % 0.42;
        const pulse = st < 1.26 && cycle < 0.26 ? Math.sin((Math.PI * cycle) / 0.26) : 0;
        tp.mouthOpen = pulse;
        tp.snoutAng -= 0.1 + 0.3 * pulse;
        tp.headY -= 2 + 4 * pulse;
        tp.chestY -= 2.5 * pulse;
        tp.earAng += 0.25 * pulse;
        break;
      }
      case 'drag': {
        // Cuelga del pellejo: patas, orejas y cola caen hacia el suelo aunque el cuerpo esté inclinado.
        const a = this.hang * HANG_MAX;
        const dx = -Math.sin(a), dy = Math.cos(a);
        const len = 21;
        const k = Math.sin(this.t * 9) * 3 * this.hang;
        tp.ffx = tp.chestX - 2 + dx * len + k;
        tp.ffy = tp.chestY + 9 + dy * len;
        tp.ffx2 = tp.chestX - 10 + dx * len - k;
        tp.ffy2 = tp.chestY + 8 + dy * len;
        tp.rfx = tp.rumpX + 2 + dx * len - k;
        tp.rfy = tp.rumpY + 9 + dy * len;
        tp.rfx2 = tp.rumpX - 7 + dx * len + k;
        tp.rfy2 = tp.rumpY + 8 + dy * len;
        tp.tailAng = -Math.PI * 1.5 + a + 0.3;
        tp.tailCurl = 0.22;
        tp.earAng = 0.1 + a * 0.9;
        tp.headY += 3;
        // La cabeza no acompaña del todo la inclinación: queda mirando al frente.
        tp.snoutAng += a * 0.7;
        tp.eyeOpen = 1.3;
        tp.scruff = 1;
        break;
      }
      case 'fall':
        tp.ffx += 9;
        tp.ffx2 += 9;
        tp.rfx -= 9;
        tp.rfx2 -= 9;
        tp.ffy = 0;
        tp.ffy2 = 0;
        tp.rfy = 0;
        tp.rfy2 = 0;
        tp.earAng = 2.2;
        tp.tailAng = -2.0;
        tp.eyeOpen = 1.3;
        break;
      default:
        break;
    }

    // Sigue al cursor con la cabeza cuando está tranquilo.
    const w = this.world;
    const looks = this.state === 'idle' || this.state === 'sit' || this.state === 'lie';
    if (looks && w.cursorKnown) {
      const hx = this.x + tp.headX * this.facing * this.scale;
      const hy = this.y + tp.headY * this.scale;
      const lx = (w.cursorX - hx) * this.facing;
      const ly = w.cursorY - hy;
      if (lx > 12 * this.scale && Math.hypot(lx, ly) < 420 * this.scale) {
        const look = clamp(Math.atan2(ly, lx), -0.75, 0.55);
        tp.snoutAng += look * 0.55;
        tp.headY += look * 4;
        tp.earAng -= look * 0.12;
      }
    }

    if (this.blinkT > 0 && tp.eyeOpen > 0.5 && tp.eyeHappy < 0.5) tp.eyeOpen = 0;
    return tp;
  }

  /** Pose final = pose suavizada + lo que oscila rápido (pasos, rebote). */
  private buildRenderPose(): void {
    const r = this.render;
    Object.assign(r, this.pose);
    const g = this.gait;
    if (g > 0.01) {
      const ph = this.gaitPhase;
      const [ax, ay] = footOffset(ph, this.stride, this.lift);
      const [bx, by] = footOffset(ph + 0.5, this.stride, this.lift);
      r.ffx += ax * g;
      r.ffy += ay * g;
      r.rfx2 += ax * g;
      r.rfy2 += ay * g;
      r.ffx2 += bx * g;
      r.ffy2 += by * g;
      r.rfx += bx * g;
      r.rfy += by * g;
      const bob = Math.abs(Math.sin(TAU * ph)) * (this.state === 'run' ? 2.6 : 1.3) * g;
      const bob2 = Math.abs(Math.cos(TAU * ph)) * (this.state === 'run' ? 2.2 : 1.0) * g;
      r.chestY -= bob;
      r.headY -= bob * 1.2;
      r.rumpY -= bob2;
      r.earAng += 0.12 * g * Math.sin(TAU * 2 * ph);
    }
  }

  // --------------------------------------------------------------- dibujo

  /** Dibuja con el origen del contexto en el punto de apoyo del perro. */
  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.scale;
    const height = this.world.floorY - this.y;
    const air = clamp(height / (130 * s), 0, 1);
    if (air < 1) {
      ctx.save();
      ctx.globalAlpha = 0.16 * (1 - air);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(4 * s * this.facing, height + 1.5 * s, 64 * s * (1 - 0.3 * air), 5.5 * s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    const extras: DrawExtras = {
      breath: Math.sin(this.t * (this.posture === 'sleep' ? 1.7 : 2.8)) * (this.posture === 'sleep' ? 1.6 : 0.8),
      wag: this.wagAmp * Math.sin(this.wagPhase),
      wagLag: this.wagAmp * Math.sin(this.wagPhase - 0.9),
    };

    if (this.front >= 0.5) {
      // Colgando del pellejo, de frente: se balancea como un péndulo desde la mano.
      ctx.save();
      if (this.state === 'drag') {
        ctx.translate(this.grabDX, this.grabDY);
      } else {
        // Cayendo o sentado: se dibuja desde los pies y se aplasta contra el suelo al aterrizar.
        ctx.scale(1 + (1 - this.squash) * 0.5, this.squash);
        ctx.translate(0, -frontHeight(this.frontSit) * s);
      }
      ctx.scale(s * Math.max(0.06, this.front * 2 - 1), s);
      ctx.rotate(this.rot);
      drawDogFront(ctx, {
        t: this.t,
        eyeOpen: this.blinkT > 0 ? 0 : 1,
        sit: this.frontSit,
        scruff: this.frontScruff,
        earLift: this.frontEars,
      });
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.scale(1 + (1 - this.squash) * 0.5, this.squash);
    const fv = Math.abs(this.faceVis) < 0.06 ? 0.06 * (this.faceVis < 0 ? -1 : 1) : this.faceVis;
    ctx.scale(s * fv, s);
    if (this.front > 0.001) {
      // Giro de papel alrededor de la nuca al pasar de lado a de frente.
      const pivotX = this.grabDX / (s * this.facing);
      ctx.translate(pivotX, 0);
      ctx.scale(Math.max(0.06, 1 - this.front * 2), 1);
      ctx.translate(-pivotX, 0);
    }
    if (Math.abs(this.rot) > 0.001 || this.hang > 0.001) {
      const px = this.grabDX / (s * this.facing);
      const py = this.grabDY / s;
      ctx.translate(px, py);
      // Cabeza arriba y cola abajo al colgar, más el balanceo por el movimiento.
      ctx.rotate(this.rot * this.facing - this.hang * HANG_MAX);
      ctx.translate(-px, -py);
    }
    drawDog(ctx, this.render, extras);
    ctx.restore();
  }
}
