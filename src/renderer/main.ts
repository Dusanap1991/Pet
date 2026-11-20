import { SIZE_SCALE, type PetBridge, type PetEvent, type PetReport, type PetSize } from '../shared/types';
import { Ball } from './ball';
import type { Dog3D } from './dog3d/dog3d';
import { DogVideo } from './dogvideo';
import { Bubble } from './bubble';
import { DEMO_TASKBAR, setupDemo } from './demo';
import { Dog, type World } from './dog/dog';
import { Fx } from './fx';
import { bark, setAmbient } from './sound';
import { STR } from './strings';
import { Treats } from './treats';

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

/** Perro realista: videos de un perro de verdad, debajo del lienzo 2D. */
let dogVideo: DogVideo | null = null;
let photo = false;

async function setStyle(style: '2d' | '3d' | 'photo'): Promise<void> {
  photo = style === 'photo';
  dog.photo = photo;
  if (photo && !dogVideo) dogVideo = new DogVideo(stage, canvas, '../assets/dog/');
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
const treats = new Treats(stage);
const bubble = new Bubble(stage);

let scale = SIZE_SCALE.m;
let dpr = 1;
let soundOn = false;
let ball: Ball | null = null;
/** Cuándo fue el último aviso de agua: un clic en el perro poco después cuenta como "ya tomé". */
let waterAskedAt = 0;
const reports: PetReport[] = [];
/** Cuándo avisó del descanso: un clic en el perro poco después empieza la rutina de estiramiento. */
let breakAskedAt = 0;
/** Rutina de estiramiento en curso. */
let routine: { step: number; left: number; timer: number } | null = null;

function stopRoutine(done: boolean): void {
  if (!routine) return;
  clearInterval(routine.timer);
  routine = null;
  if (done) {
    dog.remind(STR.stretchDone, 5000);
    report('stretched');
  } else {
    dog.remind(STR.stretchStop, 4000);
  }
}

/** Rutina guiada de 2 minutos: un paso a la vez, con cuenta regresiva en el globo. */
function startRoutine(): void {
  if (routine) return;
  breakAskedAt = 0;
  const steps = STR.stretchSteps;
  const show = (): void => {
    if (!routine) return;
    const [text] = steps[routine.step];
    // Si llegó otro mensaje (un hábito, un aviso), se deja leer unos segundos antes de volver a la rutina.
    if (!bubble.text.startsWith('🧘') && performance.now() - bubble.saidAt < 4000) return;
    bubble.say(`🧘 ${routine.step + 1}/${steps.length} · ${text}\n${routine.left} s`, 2000);
  };
  routine = {
    step: 0,
    left: steps[0][1],
    timer: window.setInterval(() => {
      if (!routine) return;
      routine.left--;
      if (routine.left <= 0) {
        routine.step++;
        if (routine.step >= steps.length) return stopRoutine(true);
        routine.left = steps[routine.step][1];
        dog.stretchAlong();
        if (soundOn) bark(1, 0.12);
      }
      show();
    }, 1000),
  };
  dog.stretchAlong();
  show();
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
    treats.remove(t);
    report('treat');
  },
  ball: () => ball,
  carryBall: (x, y) => ball?.carry(x, y),
  dropBall: (vx) => ball?.drop(vx),
  played: () => report('play'),
});

/** Ladra (si el sonido está activado) y muestra el mensaje. */
function remind(text: string, ms?: number): void {
  dog.remind(text, ms);
  if (soundOn) bark(3);
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
    case 'treat':
      dropTreat();
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
      break;
    case 'settings':
      setSize(e.size);
      soundOn = e.sound;
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

/** El premio cae lejos del perro para que tenga que correr a buscarlo. */
function dropTreat(): void {
  const margin = 60 * scale;
  const lo = margin;
  const hi = Math.max(lo, world.width - margin);
  let x = lo + Math.random() * (hi - lo);
  const minDist = Math.min(260 * scale, (hi - lo) / 3);
  if (Math.abs(x - dog.x) < minDist) {
    x = dog.x - lo > hi - dog.x ? dog.x - minDist : dog.x + minDist;
  }
  treats.spawn(Math.max(lo, Math.min(hi, x)), scale);
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
  const busy = treats.active || pressing || holdingBall || (ball?.moving ?? false) || (fx.active && !dog.sleeping);
  const minStep = busy ? 0 : dog.sleeping ? 1 / 15 : dog.calm ? 1 / 30 : 0;
  if (elapsed < minStep - 0.004) return;
  last = now;
  const dt = Math.min(elapsed, 0.1);

  if (dragging) dog.dragTo(world.cursorX, world.cursorY, dt);
  treats.update(dt, world.floorY);
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
    const lm = dogVideo.landmarks();
    if (lm) {
      // Globos y corazones sobre la cabeza real; la pelota y las migas, en la boca real.
      dog.headHint = { x: lm.head.x - dog.x, y: lm.head.y - dog.y + 14 * scale };
      dog.mouthHint = { x: lm.nose.x - dog.x - 6 * scale * dog.facing, y: lm.nose.y - dog.y + 7 * scale };
    }
    dog.drawShadow(ctx);
  } else if (dog3d && dog.style3d && canvas3d) {
    canvas3d.style.transform = boxTransform;
    dog3d.render(dog.view3d());
  } else {
    dog.draw(ctx);
  }
  fx.draw(ctx);

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
