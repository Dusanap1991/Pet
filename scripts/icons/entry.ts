// Dibuja los íconos con el mismo código que dibuja al perro. Lo usa make-icons.mjs.
import { DACHSHUND, drawDog, type Palette } from '../../src/renderer/dog/draw';
import { STAND, type Pose } from '../../src/renderer/dog/pose';

const EXTRAS = { breath: 0, wag: 0, wagLag: 0 };
const HAPPY: Pose = { ...STAND, mouthOpen: 0.42, tongue: 1, snoutAng: 0.02, earAng: 0.1 };
const BLACK: Palette = Object.fromEntries(Object.keys(DACHSHUND).map((k) => [k, '#000'])) as unknown as Palette;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

/** Ícono de la app: retrato del perro sobre un cuadrado redondeado. */
function appIcon(size: number): string {
  const [c, ctx] = makeCanvas(size, size);
  const u = size / 1024;
  const grad = ctx.createLinearGradient(0, 100 * u, 0, 924 * u);
  grad.addColorStop(0, '#8FD0F5');
  grad.addColorStop(1, '#D9F0FF');
  ctx.beginPath();
  ctx.roundRect(100 * u, 100 * u, 824 * u, 824 * u, 186 * u);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Suelo
  ctx.fillStyle = '#F6D58E';
  ctx.fillRect(100 * u, 760 * u, 824 * u, 164 * u);
  const k = 6.9 * u;
  ctx.translate(150 * u, 800 * u);
  ctx.scale(k, k);
  drawDog(ctx, HAPPY, EXTRAS);
  ctx.restore();
  return c.toDataURL('image/png');
}

/** Bandeja de Windows: la cabeza a color. */
function trayHead(size: number): string {
  const [c, ctx] = makeCanvas(size, size);
  const k = size / 68;
  ctx.translate(size / 2, size / 2);
  ctx.scale(k, k);
  ctx.translate(-69, 60);
  ctx.beginPath();
  ctx.rect(36, -90, 70, 62);
  ctx.clip();
  drawDog(ctx, { ...STAND, snoutAng: 0.05 }, EXTRAS);
  return c.toDataURL('image/png');
}

/** Barra de menú de macOS: silueta negra (imagen "template"). */
function traySilhouette(w: number, h: number): string {
  const [c, ctx] = makeCanvas(w, h);
  const k = w / 196;
  ctx.translate(w / 2, h / 2);
  ctx.scale(k, k);
  ctx.translate(-9.5, 42.5);
  drawDog(ctx, STAND, EXTRAS, BLACK);
  return c.toDataURL('image/png');
}

(window as unknown as { __icons: Record<string, string> }).__icons = {
  'build/icon.png': appIcon(1024),
  'assets/tray.png': trayHead(16),
  'assets/tray@2x.png': trayHead(32),
  'assets/tray@3x.png': trayHead(48),
  'assets/trayTemplate.png': traySilhouette(30, 16),
  'assets/trayTemplate@2x.png': traySilhouette(60, 32),
};
