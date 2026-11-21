import { SIZE_SCALE, type PetBridge, type PetEvent, type PetReport, type PetSize } from '../shared/types';
import { Ball } from './ball';
import type { Dog3D } from './dog3d/dog3d';
import { DogVideo } from './dogvideo';
import { Bubble } from './bubble';
import { TimerPill } from './timer';
import { DEMO_TASKBAR, setupDemo } from './demo';
import { Dog, type World } from './dog/dog';
import { Fx } from './fx';
import { bark, setAmbient } from './sound';
import { STR } from './strings';
import { FOOD_NAME, Treats, type TreatKind } from './treats';

declare global {
  interface Window {
    pet?: PetBridge;
    /** Solo en la vista previa: acceso para pruebas. */
    __pet?: { dog: Dog; emit: (e: PetEvent) => void; ball: () => Ball | null; reports: PetReport[]; hit: (x: number, y: number) => boolean };
  }
}

// Caja del lienzo en unidades del perro; el origen es su punto de apoyo en el suelo.
const BOX_W = 330;
const BOX_H = 300;
const ORIGIN_X = 160;
const ORIGIN_Y = 210;

const bridge = window.pet;
const demo = !bridge;
const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('dog') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

/** Perro en 3D: lienzo WebGL debajo del lienzo 2D (que sigue dibujando corazones, "z", gotas…). */
let dog3d: Dog3D | null = null;
let canvas3d: HTMLCanvasElement | null = null;
let want3d = false;
let loading3d = false;

/** ¿El punto cae sobre el perro? En el estilo realista se usa la silueta del video. */
function hitDog(x: number, y: number): boolean {
  return photo && dogVideo ? dogVideo.hitTest(x, y) : dog.hitTest(x, y);
}

/** Sombra del perro realista: una suave bajo el cuerpo y una más oscura bajo cada pata apoyada. */
function drawVideoShadow(v: DogVideo): void {
  const sh = v.shadow();
  if (!sh) return;
  const lift = Math.max(0, world.floorY - dog.y);
  const air = Math.min(1, lift / (110 * scale));
  if (air >= 1) return;
  const fade = 1 - air;
  const gy = world.floorY - dog.y + 1.5 * scale;
  const soft = (cx: number, rx: number, ry: number, alpha: number): void => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(30,22,16,${alpha})`);
    g.addColorStop(0.55, `rgba(30,22,16,${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(30,22,16,0)');
    ctx.save();
    ctx.translate(cx - dog.x, gy);
    ctx.scale(rx, ry);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const width = Math.max(20 * scale, sh.x1 - sh.x0);
  soft((sh.x0 + sh.x1) / 2, (width / 2) * (1.08 - 0.25 * air), 9 * scale * (1 - 0.3 * air), 0.26 * fade);
  for (const f of sh.feet) soft(f.x, Math.max(6 * scale, f.w * 0.9), 2.8 * scale, 0.32 * fade);
}

/** Perro realista: videos de un perro de verdad, debajo del lienzo 2D. */
let dogVideo: DogVideo | null = null;
let photo = false;

async function setStyle(style: '2d' | '3d' | 'photo'): Promise<void> {
  photo = style === 'photo';
  dog.photo = photo;
  if (photo && !dogVideo) {
    dogVideo = new DogVideo(stage, canvas, '../assets/dog/');
    dog.photoSpeeds = DogVideo.groundSpeeds();
  }
  dogVideo?.setVisible(photo);
  want3d = style === '3d';
  dog.style3d = want3d && !!dog3d;
  if (!want3d) {
    if (canvas3d) canvas3d.style.display = 'none';
    return;
  }
  if (dog3d) {
    canvas3d!.style.display = '';
    dog.style3d = true;
    return;
  }
  if (loading3d) return;
  loading3d = true;
  try {
    const { Dog3D } = await import('./dog3d/dog3d');
    canvas3d = document.createElement('canvas');
    canvas3d.id = 'dog3d';
    stage.insertBefore(canvas3d, canvas);
    dog3d = new Dog3D(canvas3d);
    dog3d.setLook(look.coat, look.outfit);
    sizeCanvas();
    dog.style3d = want3d;
    if (!want3d) canvas3d.style.display = 'none';
  } catch (err) {
    // Sin WebGL (o si algo falla): se queda el dibujo 2D.
    console.error('No se pudo iniciar el 3D:', err);
    canvas3d?.remove();
    canvas3d = null;
    dog3d = null;
    dog.style3d = false;
  } finally {
    loading3d = false;
  }
}

const look: { coat: string; outfit: 'santa' | 'witch' | 'scarf' | null } = { coat: 'red', outfit: null };

const fx = new Fx();
const timerPill = new TimerPill(stage);
const treats = new Treats(stage);
const bubble = new Bubble(stage);

let scale = SIZE_SCALE.m;
let dpr = 1;
let soundOn = false;
/** Leer los avisos en voz alta. */
let speakOn = false;
/** "No molestar": sin ladridos. */
let dnd = false;
let ball: Ball | null = null;
/** Cuándo fue el último aviso de agua: un clic en el perro poco después cuenta como "ya tomé". */
let waterAskedAt = 0;
const reports: PetReport[] = [];
/** Cuándo avisó del descanso: un clic en el perro poco después empieza la rutina de estiramiento. */
let breakAskedAt = 0;
/** Rutina guiada en curso (estiramiento o respiración). */
interface Guided {
  steps: [string, number][];
  icon: string;
  done: string;
  report?: PetReport;
  /** Por cada paso: qué hace el perro. */
  onStep?: (i: number) => void;
}
let routine: { g: Guided; step: number; left: number; timer: number } | null = null;

function stopRoutine(done: boolean): void {
  if (!routine) return;
  const g = routine.g;
  clearInterval(routine.timer);
  routine = null;
  if (done) {
    dog.remind(g.done, 5000);
    if (g.report) report(g.report);
  } else {
    dog.remind(STR.stretchStop, 4000);
  }
}

/** Una rutina guiada: un paso a la vez, con cuenta regresiva en el globo. */
function startGuided(g: Guided): void {
  if (routine) stopRoutine(false);
  breakAskedAt = 0;
  const show = (): void => {
    if (!routine) return;
    const [text] = g.steps[routine.step];
    // Si llegó otro mensaje (un hábito, un aviso), se deja leer unos segundos antes de volver a la rutina.
    if (!bubble.text.startsWith(g.icon) && performance.now() - bubble.saidAt < 4000) return;
    bubble.say(`${g.icon} ${text}\n${routine.left} s`, 2000);
  };
  routine = {
    g,
    step: 0,
    left: g.steps[0][1],
    timer: window.setInterval(() => {
      if (!routine) return;
      routine.left--;
      if (routine.left <= 0) {
        routine.step++;
        if (routine.step >= g.steps.length) return stopRoutine(true);
        routine.left = g.steps[routine.step][1];
        g.onStep?.(routine.step);
      }
      show();
    }, 1000),
  };
  g.onStep?.(0);
  // La pediste tú: se muestra de inmediato aunque haya otro mensaje en pantalla.
  bubble.saidAt = 0;
  show();
}

function startRoutine(): void {
  const n = STR.stretchSteps.length;
  startGuided({
    steps: STR.stretchSteps.map(([t, sec], i) => [`${i + 1}/${n} · ${t}`, sec] as [string, number]),
    icon: '🧘',
    done: STR.stretchDone,
    report: 'stretched',
    onStep: (i) => {
      dog.stretchAlong();
      if (i > 0 && soundOn && !dnd) bark(1, 0.12);
    },
  });
}

/** Respiración en caja: inhala 4, sostén 4, exhala 4, sostén 4; cuatro vueltas. */
function startBreathing(): void {
  const cycle: [string, number][] = [['Inhala por la nariz…', 4], ['Sostén el aire…', 4], ['Exhala despacio…', 4], ['Sostén…', 4]];
  startGuided({
    steps: [['Ponte cómodo. Vamos a respirar juntos.', 3], ...cycle, ...cycle, ...cycle, ...cycle],
    icon: '🌬️',
    done: STR.breatheDone,
    onStep: (i) => {
      if (i === 0) dog.restAlong();
    },
  });
}

function report(kind: PetReport): void {
  if (demo) reports.push(kind);
  bridge?.report(kind);
}

const world: World = { width: 0, floorY: 0, cursorX: -9999, cursorY: -9999, cursorKnown: false };

const dog = new Dog(scale, fx, {
  say: (text, ms) => bubble.say(text, ms),
  nearestTreat: (x) => treats.nearest(x),
  eatTreat: (t) => {
    const kind = treats.kindOf(t);
    const fromRain = treats.isRain(t);
    treats.remove(t);
    if (fromRain && rain) rain.score++;
    else if (!fromRain) onAte(kind);
  },
  hiddenTreat: () => treats.hiddenOne(),
  revealTreat: (t) => treats.reveal(t),
  laser: () => (laserUntil > performance.now() && world.cursorKnown ? { x: laserX } : null),
  ball: () => ball,
  carryBall: (x, y) => ball?.carry(x, y),
  dropBall: (vx) => ball?.drop(vx),
  played: () => onFetched(),
});

/** Ladra (si el sonido está activado) y muestra el mensaje. */
function remind(text: string, ms?: number): void {
  dog.remind(text, ms);
  if (soundOn && !dnd) bark(3);
  say(text);
}

/** Lee el aviso en voz alta (sin los emojis). */
function say(text: string): void {
  if (!speakOn || dnd || !('speechSynthesis' in window)) return;
  const clean = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'es-ES';
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('es'));
    if (voice) u.voice = voice;
    u.rate = 1.02;
    speechSynthesis.speak(u);
  } catch {
    // Sin voz disponible: no pasa nada.
  }
}

function measure(): void {
  world.width = window.innerWidth;
  world.floorY = window.innerHeight - (demo ? DEMO_TASKBAR : 0) - 2;
}

function sizeCanvas(): void {
  dpr = window.devicePixelRatio || 1;
  const w = BOX_W * scale;
  const h = BOX_H * scale;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  if (dog3d && canvas3d) {
    canvas3d.style.width = `${w}px`;
    canvas3d.style.height = `${h}px`;
    dog3d.resize({ w: BOX_W, h: BOX_H, originX: ORIGIN_X, originY: ORIGIN_Y }, scale, dpr);
  }
}

function setSize(size: PetSize): void {
  scale = SIZE_SCALE[size] ?? SIZE_SCALE.m;
  dog.setScale(scale);
  sizeCanvas();
}

function handle(e: PetEvent): void {
  switch (e.type) {
    case 'cursor':
      world.cursorX = e.x;
      world.cursorY = e.y;
      world.cursorKnown = true;
      break;
    case 'away':
      dog.onAway();
      break;
    case 'back':
      dog.onBack(e.awaySec, STR.welcomeBack);
      break;
    case 'break-due':
      remind(STR.breakDue(e.minutes));
      breakAskedAt = performance.now();
      break;
    case 'focus-start':
      dog.focusStart(STR.focusStart(e.minutes));
      break;
    case 'focus-end':
      dog.focusEnd(e.completed ? STR.focusEnd(e.minutes) : null);
      break;
    case 'treat': {
      const kind = e.kind ?? TREAT_KINDS[Math.floor(Math.random() * TREAT_KINDS.length)];
      dropTreat(kind, e.x);
      if (!e.kind) dog.remind(`Sorpresa: ¡${FOOD_NAME[kind]}!`, 2200);
      break;
    }
    case 'meal':
      treats.serve(farSpot(), scale);
      dog.remind('¡Comida! 🍽️', 2000);
      break;
    case 'hide': {
      const kind = TREAT_KINDS[Math.floor(Math.random() * TREAT_KINDS.length)];
      const margin = 90 * scale;
      let x = margin + Math.random() * (world.width - 2 * margin);
      if (Math.abs(x - dog.x) < 250 * scale) x = farSpot();
      treats.hide(x, scale, kind);
      break;
    }
    case 'laser':
      laserUntil = performance.now() + e.seconds * 1000;
      break;
    case 'command': {
      const ok = dog.command(e.cmd, e.chance);
      if (ok) {
        report('obeyed');
        const praise = ['¡Hecho! 🐾', '¡Listo, jefe!', '¡Así? 🐶', '¡Mírame!'];
        // Solo el globo: un aviso normal lo haría ladrar y deshacer la orden.
        bubble.say(e.cmd === 'bark' ? '¡Guau! ¡Guau!' : e.cmd === 'stay' ? 'Quieto… 🧘 (no me muevo)' : praise[Math.floor(Math.random() * praise.length)], 2500);
        if (e.cmd === 'bark' && soundOn && !dnd) bark(2);
      } else {
        const confused = ['¿Eh? 🤔', '¿Qué cosa?', 'Mmm… no entendí 🙃'];
        bubble.say(confused[Math.floor(Math.random() * confused.length)], 2500);
      }
      break;
    }
    case 'treatRain':
      startTreatRain(e.seconds);
      break;
    case 'water': {
      remind(STR.water[Math.floor(Math.random() * STR.water.length)], 8000);
      waterAskedAt = performance.now();
      const head = dog.headOffset();
      for (let i = 0; i < 4; i++) fx.drop(head.x, head.y - 30 * scale, scale, i * 0.18);
      break;
    }
    case 'reminder':
      // Se queda hasta que hagas clic en el perro (o un minuto).
      remind(e.text.startsWith('📅') || e.text.startsWith('🔋') ? e.text : `⏰ ${e.text}`, 60_000);
      break;
    case 'notice':
      dog.remind(e.text, e.text.includes('\n') ? 12_000 : 9000);
      say(e.text);
      break;
    case 'settings':
      setSize(e.size);
      soundOn = e.sound;
      speakOn = e.speak;
      dog.setLook(e.coat, e.outfit);
      look.coat = e.coat;
      look.outfit = e.outfit;
      dog3d?.setLook(e.coat, e.outfit);
      void setStyle(e.style);
      break;
    case 'eyes':
      // Regla 20-20-20: el globo se queda los 20 segundos y después da las gracias.
      remind('👀 Mira algo lejano por 20 segundos…', 20_000);
      setTimeout(() => dog.remind('¡Listo! Tus ojos te lo agradecen.', 3500), 20_500);
      break;
    case 'stretch':
      startRoutine();
      break;
    case 'breathe':
      startBreathing();
      break;
    case 'dnd':
      dnd = e.on;
      break;
    case 'timer':
      timerPill.set(e.endsAt, e.icon, e.label);
      break;
    case 'ambient':
      setAmbient(e.kind);
      break;
    case 'come':
      dog.comeTo(e.x);
      break;
    case 'mood':
      dog.setMood(e.joy, e.food);
      break;
    case 'ball':
      if (e.out && !ball) {
        // Cae desde arriba, lejos del perro, para que corra a buscarla.
        const x = dog.x < world.width / 2 ? world.width * 0.75 : world.width * 0.25;
        ball = new Ball(stage, x, 40, scale);
        ball.vx = (Math.random() - 0.5) * 300;
      } else if (!e.out && ball) {
        ball.remove();
        ball = null;
      }
      break;
  }
}

/** Se comió algo: cada cosa llena distinto; la salchicha es su favorita. */
function onAte(kind: TreatKind | 'meal'): void {
  if (kind === 'meal') {
    report('meal');
    dog.remind('¡Qué rico! Quedé lleno 😋', 4000);
    return;
  }
  report(`treat-${kind}` as PetReport);
  if (kind === 'sausage') {
    dog.remind('¡Salchicha! ¡Mi favorita! 🌭', 3500);
    const h = dog.headOffset();
    for (let i = 0; i < 3; i++) fx.heart(h.x, h.y - 22 * scale, scale);
  }
}

/** Lluvia de premios: caen galletas al azar y el perro atrapa todas las que puede. */
let rain: { score: number; timer: number; endsAt: number } | null = null;
function startTreatRain(seconds: number): void {
  if (rain) return;
  rain = { score: 0, endsAt: performance.now() + seconds * 1000, timer: 0 };
  dog.remind(`🌧️ ¡Lluvia de premios! ${seconds} segundos`, 2500);
  const drop = (): void => {
    if (!rain) return;
    if (performance.now() > rain.endsAt) {
      // Espera a que caigan los últimos y da el resultado.
      window.setTimeout(finishTreatRain, 4500);
      return;
    }
    const margin = 70 * scale;
    treats.spawn(margin + Math.random() * (world.width - 2 * margin), scale, 'cookie', true);
    rain.timer = window.setTimeout(drop, 700 + Math.random() * 700);
  };
  drop();
}

function finishTreatRain(): void {
  if (!rain) return;
  const score = rain.score;
  rain = null;
  let best = 0;
  try {
    best = Number(localStorage.getItem('pet.rainRecord') ?? 0);
    if (score > best) localStorage.setItem('pet.rainRecord', String(score));
  } catch {
    // Sin almacenamiento: no hay récord.
  }
  report('play');
  remind(score > best && best > 0 ? `🏆 ¡Récord! Atrapé ${score} premios` : `¡Atrapé ${score} premio${score === 1 ? '' : 's'}!${best ? ` (récord: ${Math.max(best, score)})` : ''}`, 5000);
}

/** Premios al azar para "sorpresa". */
const TREAT_KINDS: TreatKind[] = ['cookie', 'bone', 'sausage'];

/** Juego de la pelota: cuenta las atrapadas seguidas, se cansa si son muchas y te pide otra. */
let fetches: number[] = [];
let inviteTimer: number | undefined;
function onFetched(): void {
  report('play');
  const now = performance.now();
  fetches = fetches.filter((t) => now - t < 4 * 60_000);
  fetches.push(now);
  const n = fetches.length;
  clearTimeout(inviteTimer);
  if (n >= 8) {
    fetches = [];
    dog.tire(45);
    remind('¡Uf, estoy agotado! Descansemos un ratito 😮‍💨', 5000);
    report('tired');
    return;
  }
  if (n === 3 || n === 5) dog.remind(`¡${n} seguidas! 🎾`, 2500);
  // Si no se la vuelves a tirar, te la pide.
  const id = ball?.throwId;
  inviteTimer = window.setTimeout(() => {
    if (ball && ball.throwId === id && ball.holder === 'none') remind('¡Otra vez! ¡Tírala! 🎾', 3000);
  }, 7000);
}

/** Puntero láser: un punto rojo en el suelo que sigue al cursor por unos segundos. */
let laserUntil = 0;
let laserX = 0;
const laserEl = document.createElement('div');
laserEl.className = 'laser';
stage.appendChild(laserEl);
function updateLaser(): void {
  const on = laserUntil > performance.now() && world.cursorKnown;
  laserEl.classList.toggle('on', on);
  if (!on) return;
  laserX = Math.max(20, Math.min(world.width - 20, world.cursorX));
  laserEl.style.transform = `translate(${Math.round(laserX)}px, ${Math.round(world.floorY - 5)}px)`;
}

/** El premio cae lejos del perro para que tenga que correr a buscarlo. */
function dropTreat(kind: TreatKind = 'bone', at?: number): void {
  if (at !== undefined && at > 20 && at < world.width - 20) {
    treats.spawn(at, scale, kind);
    return;
  }
  const margin = 60 * scale;
  const lo = margin;
  const hi = Math.max(lo, world.width - margin);
  let x = lo + Math.random() * (hi - lo);
  const minDist = Math.min(260 * scale, (hi - lo) / 3);
  if (Math.abs(x - dog.x) < minDist) {
    x = dog.x - lo > hi - dog.x ? dog.x - minDist : dog.x + minDist;
  }
  treats.spawn(Math.max(lo, Math.min(hi, x)), scale, kind);
}

/** Lejos del perro, del lado con más espacio. */
function farSpot(): number {
  const margin = 110 * scale;
  return dog.x < world.width / 2 ? world.width - margin : margin;
}

// ------------------------------------------------------------ puntero

let pressing = false;
let dragging = false;
let holdingBall = false;
let pressX = 0;
let pressY = 0;
let interactive = false;
let strokeAcc = 0;
let strokeCooldown = 0;
let lastCursorX = 0;
let lastCursorY = 0;

function setCursor(x: number, y: number): void {
  world.cursorX = x;
  world.cursorY = y;
  world.cursorKnown = true;
}

window.addEventListener('pointermove', (e) => {
  setCursor(e.clientX, e.clientY);
  if (holdingBall && ball) ball.dragTo(e.clientX, e.clientY, world.floorY);
  if (pressing && !dragging && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 6) {
    dragging = true;
    dog.grab(pressX, pressY);
    bridge?.setDragging(true);
  }
});

window.addEventListener('pointerdown', (e) => {
  setCursor(e.clientX, e.clientY);
  if (e.button === 0 && ball && ball.hitTest(e.clientX, e.clientY)) {
    // La pelota va primero: aunque la tenga el perro en la boca, se la puedes quitar.
    holdingBall = true;
    ball.grab();
    ball.dragTo(e.clientX, e.clientY, world.floorY);
    bridge?.setDragging(true);
    e.preventDefault();
    return;
  }
  if (!hitDog(e.clientX, e.clientY)) return;
  if (e.button === 2) {
    bridge?.showMenu();
    return;
  }
  if (e.button !== 0) return;
  pressing = true;
  dragging = false;
  pressX = e.clientX;
  pressY = e.clientY;
  e.preventDefault();
});

function endPress(): void {
  if (holdingBall) {
    holdingBall = false;
    ball?.throw();
    bridge?.setDragging(false);
    return;
  }
  if (!pressing) return;
  if (dragging) {
    dog.release();
    bridge?.setDragging(false);
  } else {
    if (routine) {
      stopRoutine(false);
      return endPressReset();
    }
    if (breakAskedAt && performance.now() - breakAskedAt < 120_000) {
      startRoutine();
      return endPressReset();
    }
    bubble.dismiss();
    dog.pet();
    report('pet');
    if (waterAskedAt && performance.now() - waterAskedAt < 120_000) {
      waterAskedAt = 0;
      report('drank');
    }
  }
  pressing = false;
  dragging = false;
}

function endPressReset(): void {
  pressing = false;
  dragging = false;
}

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerup', endPress);
window.addEventListener('pointercancel', endPress);
window.addEventListener('blur', endPress);

/** Decide si la ventana debe atrapar clics: solo cuando el cursor está sobre el perro. */
function updateInteractivity(dt: number): void {
  const overDog = world.cursorKnown && hitDog(world.cursorX, world.cursorY);
  const overBall = world.cursorKnown && !!ball && ball.hitTest(world.cursorX, world.cursorY);
  const over = overDog || overBall;
  const want = pressing || holdingBall || over;
  if (want !== interactive) {
    interactive = want;
    bridge?.setInteractive(want);
  }
  document.body.style.cursor = dragging || holdingBall ? 'grabbing' : over ? 'grab' : '';

  // Pasar el cursor de un lado a otro sobre el perro también cuenta como caricia.
  const moved = Math.hypot(world.cursorX - lastCursorX, world.cursorY - lastCursorY);
  lastCursorX = world.cursorX;
  lastCursorY = world.cursorY;
  strokeCooldown = Math.max(0, strokeCooldown - dt);
  strokeAcc = Math.max(0, strokeAcc - 90 * dt);
  if (overDog && !pressing && !holdingBall && moved < 200) {
    strokeAcc += moved;
    if (strokeAcc > 240 && strokeCooldown === 0) {
      strokeAcc = 0;
      strokeCooldown = 2.5;
      dog.pet();
      report('pet');
    }
  }
}

// --------------------------------------------------------------- ciclo

let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = (now - last) / 1000;
  // Con el perro quieto no hace falta dibujar a 60 cuadros por segundo.
  // (Las "z" del sueño flotan despacio: no justifican subir el ritmo.)
  const busy = treats.active || laserUntil > now || pressing || holdingBall || (ball?.moving ?? false) || (fx.active && !dog.sleeping);
  // En movimiento, 60 como máximo: en pantallas de 120 Hz el doble no se nota y gasta el doble.
  const minStep = busy ? 1 / 60 : dog.sleeping ? 1 / 15 : dog.calm ? 1 / 30 : 1 / 60;
  if (elapsed < minStep - 0.004) return;
  last = now;
  const dt = Math.min(elapsed, 0.1);

  if (dragging) dog.dragTo(world.cursorX, world.cursorY, dt);
  treats.update(dt, world.floorY);
  updateLaser();
  dog.update(dt, world);
  ball?.update(dt, world.floorY, world.width);
  fx.update(dt);
  updateInteractivity(dt);

  const boxTransform = `translate(${dog.x - ORIGIN_X * scale}px, ${dog.y - ORIGIN_Y * scale}px)`;
  canvas.style.transform = boxTransform;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, BOX_W * scale, BOX_H * scale);
  ctx.translate(ORIGIN_X * scale, ORIGIN_Y * scale);
  if (photo && dogVideo) {
    dogVideo.update(dog.videoView(), dog.x, dog.y, scale);
    drawVideoShadow(dogVideo);
    const lm = dogVideo.landmarks();
    if (lm) {
      // Globos y corazones sobre la cabeza real; la pelota y las migas, en la boca real.
      dog.headHint = { x: lm.head.x - dog.x, y: lm.head.y - dog.y + 14 * scale };
      dog.mouthHint = { x: lm.nose.x - dog.x - 6 * scale * dog.facing, y: lm.nose.y - dog.y + 7 * scale };
    }
  } else if (dog3d && dog.style3d && canvas3d) {
    canvas3d.style.transform = boxTransform;
    dog3d.render(dog.view3d());
  } else {
    dog.draw(ctx);
  }
  fx.draw(ctx);

  timerPill.update(dog.x, world.floorY, dog.facing, scale);
  const head = dog.headOffset();
  bubble.update(now, dog.x + head.x, dog.y + head.y - 22 * scale, world.width);
}

window.addEventListener('resize', () => {
  measure();
  sizeCanvas();
});

/** De noche (22:00 a 6:00) está más dormilón. */
function updateNight(): void {
  const h = new Date().getHours();
  dog.night = h >= 22 || h < 6;
}
updateNight();
setInterval(updateNight, 60_000);

measure();
sizeCanvas();
dog.place(world.width * 0.72, world);

// Archivos arrastrados hacia el perro: se pone atento. (El soltado lo maneja el preload.)
window.addEventListener('dragenter', () => dog.curious());

/** Batería: el proceso principal decide cuándo avisar. */
function watchBattery(): void {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener(t: string, f: () => void): void }> };
  void nav.getBattery?.().then((b) => {
    const send = (): void => bridge?.battery(b.level, b.charging);
    send();
    b.addEventListener('levelchange', send);
    b.addEventListener('chargingchange', send);
  }).catch(() => {});
}

if (bridge) {
  bridge.onEvent(handle);
  bridge.ready();
  watchBattery();
} else {
  setupDemo(handle);
  window.__pet = { dog, emit: handle, ball: () => ball, reports, hit: hitDog };
}

requestAnimationFrame(frame);
