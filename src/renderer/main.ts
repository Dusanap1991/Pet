import { SIZE_SCALE, type PetBridge, type PetEvent, type PetSize } from '../shared/types';
import { Bubble } from './bubble';
import { DEMO_TASKBAR, setupDemo } from './demo';
import { Dog, type World } from './dog/dog';
import { Fx } from './fx';
import { STR } from './strings';
import { Treats } from './treats';

declare global {
  interface Window {
    pet?: PetBridge;
    /** Solo en la vista previa: acceso para pruebas. */
    __pet?: { dog: Dog; emit: (e: PetEvent) => void };
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

const fx = new Fx();
const treats = new Treats(stage);
const bubble = new Bubble(stage);

let scale = SIZE_SCALE.m;
let dpr = 1;

const world: World = { width: 0, floorY: 0, cursorX: -9999, cursorY: -9999, cursorKnown: false };

const dog = new Dog(scale, fx, {
  say: (text, ms) => bubble.say(text, ms),
  nearestTreat: (x) => treats.nearest(x),
  eatTreat: (t) => treats.remove(t),
});

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
      dog.remind(STR.breakDue(e.minutes));
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
    case 'notice':
      dog.remind(e.text);
      break;
    case 'settings':
      setSize(e.size);
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
  if (pressing && !dragging && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 6) {
    dragging = true;
    dog.grab(pressX, pressY);
    bridge?.setDragging(true);
  }
});

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  setCursor(e.clientX, e.clientY);
  if (!dog.hitTest(e.clientX, e.clientY)) return;
  pressing = true;
  dragging = false;
  pressX = e.clientX;
  pressY = e.clientY;
  e.preventDefault();
});

function endPress(): void {
  if (!pressing) return;
  if (dragging) {
    dog.release();
    bridge?.setDragging(false);
  } else {
    dog.pet();
  }
  pressing = false;
  dragging = false;
}

window.addEventListener('pointerup', endPress);
window.addEventListener('pointercancel', endPress);
window.addEventListener('blur', endPress);

/** Decide si la ventana debe atrapar clics: solo cuando el cursor está sobre el perro. */
function updateInteractivity(dt: number): void {
  const over = world.cursorKnown && dog.hitTest(world.cursorX, world.cursorY);
  const want = pressing || over;
  if (want !== interactive) {
    interactive = want;
    bridge?.setInteractive(want);
  }
  document.body.style.cursor = dragging ? 'grabbing' : over ? 'grab' : '';

  // Pasar el cursor de un lado a otro sobre el perro también cuenta como caricia.
  const moved = Math.hypot(world.cursorX - lastCursorX, world.cursorY - lastCursorY);
  lastCursorX = world.cursorX;
  lastCursorY = world.cursorY;
  strokeCooldown = Math.max(0, strokeCooldown - dt);
  strokeAcc = Math.max(0, strokeAcc - 90 * dt);
  if (over && !pressing && moved < 200) {
    strokeAcc += moved;
    if (strokeAcc > 240 && strokeCooldown === 0) {
      strokeAcc = 0;
      strokeCooldown = 2.5;
      dog.pet();
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
  const busy = treats.active || pressing || (fx.active && !dog.sleeping);
  const minStep = busy ? 0 : dog.sleeping ? 1 / 15 : dog.calm ? 1 / 30 : 0;
  if (elapsed < minStep - 0.004) return;
  last = now;
  const dt = Math.min(elapsed, 0.1);

  if (dragging) dog.dragTo(world.cursorX, world.cursorY, dt);
  treats.update(dt, world.floorY);
  dog.update(dt, world);
  fx.update(dt);
  updateInteractivity(dt);

  canvas.style.transform = `translate(${dog.x - ORIGIN_X * scale}px, ${dog.y - ORIGIN_Y * scale}px)`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, BOX_W * scale, BOX_H * scale);
  ctx.translate(ORIGIN_X * scale, ORIGIN_Y * scale);
  dog.draw(ctx);
  fx.draw(ctx);

  const head = dog.headOffset();
  bubble.update(now, dog.x + head.x, dog.y + head.y - 22 * scale, world.width);
}

window.addEventListener('resize', () => {
  measure();
  sizeCanvas();
});

measure();
sizeCanvas();
dog.place(world.width * 0.72, world);

if (bridge) {
  bridge.onEvent(handle);
  bridge.ready();
} else {
  setupDemo(handle);
  window.__pet = { dog, emit: handle };
}

requestAnimationFrame(frame);
